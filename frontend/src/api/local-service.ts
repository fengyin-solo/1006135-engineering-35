import { MODULE_BY_KEY } from '@/data/modules'
import { allRows, listRows, resetRows, saveRows } from '@/data/local-store'
import {
  BUILDING_KEY,
  SETTLEMENT_KEY,
  buildSettlementView,
  deriveSettlementRow,
  settlementObjectKey,
} from '@/data/link'
import { moduleStats } from '@/data/stats'
import { prepareBuildingSamples, resetBuildingSamples } from '@/data/prepare'
import type {
  ActionResult,
  EntryRow,
  ModuleMeta,
  OverviewResult,
  PageResult,
  PrepareResult,
} from '@/data/types'
import type { StatCard } from '@/data/stats'

// 会写进数据的「往回走」动作：命中就把这条记录标成异常态，看板上能一眼看出来。
const NEGATIVE_ACTIONS = ['撤销', '作废', '拒绝', '驳回', '停用', '忽略', '下线', '回滚']

export function moduleMeta(key: string): ModuleMeta {
  const meta = MODULE_BY_KEY.get(key)
  if (!meta) {
    throw new Error(`没有登记名为 ${key} 的业务模块`)
  }
  return meta
}

export function filterRows(rows: EntryRow[], filters: Record<string, string>): EntryRow[] {
  const pairs = Object.entries(filters).filter(([, value]) => value.trim() !== '')
  if (pairs.length === 0) {
    return rows
  }
  return rows.filter((row) =>
    pairs.every(([field, value]) => String(row[field] ?? '').includes(value.trim())),
  )
}

// 统一读入口：地表沉降清单里的联测点由建筑监测同源推导，准备结果直接反映到这里，
// 两处条数始终同步；关联不上建筑的存量测点作为孤立记录保留在末尾，不丢弃。
export function getRows(key: string): EntryRow[] {
  if (key === SETTLEMENT_KEY) {
    return buildSettlementView(listRows(BUILDING_KEY), listRows(SETTLEMENT_KEY)).rows
  }
  return listRows(key)
}

export function listEntries(key: string, filters: Record<string, string> = {}): PageResult {
  const matched = filterRows(getRows(key), filters)
  return { items: matched, total: matched.length, page: 1, size: matched.length }
}

// 沉降测点是否仍在跟进：末态「已稳定」不再待处理，其余状态待处理。
function isSettlementPending(status: string): boolean {
  return status !== moduleMeta(SETTLEMENT_KEY).statuses.at(-1)
}

// 沉降联测点第一次执行动作时，库里还没有对应的测点记录：
// 按同源推导结果落一条，之后再合并回清单（编号仍来自建筑监测，不会多出条数）。
function persistSettlementAction(
  effectiveRow: EntryRow,
  target: string,
  abnormal: boolean,
): void {
  const stored = listRows(SETTLEMENT_KEY)
  const objectKey = settlementObjectKey(effectiveRow)
  const index = stored.findIndex(
    (row) => Number(row.id) === Number(effectiveRow.id) || settlementObjectKey(row) === objectKey,
  )
  const updated: EntryRow =
    index >= 0
      ? { ...stored[index], status: target, pending: isSettlementPending(target), abnormal }
      : {
          ...deriveSettlementRow(
            listRows(BUILDING_KEY).find((building) => Number(building.id) === Number(effectiveRow.id)) ??
              effectiveRow,
          ),
          status: target,
          pending: isSettlementPending(target),
          abnormal,
        }
  const next = [...stored]
  if (index >= 0) {
    next[index] = updated
  } else {
    next.push(updated)
  }
  saveRows(SETTLEMENT_KEY, next)
}

export function runAction(key: string, id: number, action: string): ActionResult {
  const meta = moduleMeta(key)
  const target = meta.actionTargets[action]
  if (!target) {
    return { ok: false, message: `${meta.entity}没有登记「${action}」这个动作` }
  }
  const rows = getRows(key)
  const index = rows.findIndex((row) => Number(row.id) === id)
  if (index < 0) {
    return { ok: false, message: `没有找到编号为 ${id} 的${meta.entity}` }
  }
  if (String(rows[index].status) === target) {
    return { ok: false, message: `${meta.entity}已经是「${target}」，不用重复操作` }
  }
  const abnormal = NEGATIVE_ACTIONS.some((verb) => action.startsWith(verb))
  try {
    if (key === SETTLEMENT_KEY) {
      persistSettlementAction(rows[index], target, abnormal)
    } else {
      const stored = listRows(key)
      const storedIndex = stored.findIndex((row) => Number(row.id) === id)
      if (storedIndex < 0) {
        return { ok: false, message: `没有找到编号为 ${id} 的${meta.entity}` }
      }
      const lastStatus = meta.statuses[meta.statuses.length - 1]
      const updated: EntryRow = {
        ...stored[storedIndex],
        status: target,
        pending: target !== lastStatus,
        abnormal,
      }
      const next = [...stored]
      next[storedIndex] = updated
      saveRows(key, next)
    }
  } catch (error) {
    // 写库失败就地撤销（saveRows 已回滚内存），把失败如实告诉页面。
    return {
      ok: false,
      message: `写库失败，已撤销本次操作：${error instanceof Error ? error.message : '未知错误'}`,
    }
  }
  return { ok: true, message: `${meta.entity}已${action}，当前状态「${target}」` }
}

// 准备入口：把样例灌进建筑监测；幂等可续跑，越限与回填结果在 PrepareResult 里。
export function prepareBuilding(): PrepareResult {
  return prepareBuildingSamples()
}

// 恢复入口：回到初始样例，与准备入口读同一套 seed.json。
export function resetBuilding(): PageResult {
  resetBuildingSamples()
  return listEntries(BUILDING_KEY)
}

export function resetModule(key: string): PageResult {
  resetRows(key)
  return listEntries(key)
}

// 页面卡片数字统一走这里，建筑监测与地表沉降共用 stats 口径、读同一份清单。
export function moduleCards(key: string): StatCard[] {
  return moduleStats(key, getRows(key))
}

// 建筑监测页展示的“地表沉降同源条数”：直接来自联测推导，两处条数一眼对上。
export function buildingSettlementSync(): { linked: number; orphan: number } {
  const view = buildSettlementView(listRows(BUILDING_KEY), listRows(SETTLEMENT_KEY))
  return { linked: view.linkedCount, orphan: view.orphanCount }
}

export function exportEntries(key: string): { filename: string; content: string } {
  const meta = moduleMeta(key)
  const header = ['编号', ...meta.fields, '当前状态']
  const lines = [header.join(',')]
  for (const row of getRows(key)) {
    lines.push([row.id, ...meta.fields.map((field) => row[field] ?? ''), row.status].join(','))
  }
  return { filename: `${meta.name}-清单.csv`, content: `﻿${lines.join('\n')}` }
}

export function downloadEntries(key: string): void {
  const { filename, content } = exportEntries(key)
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  document.body.appendChild(anchor)
  anchor.click()
  document.body.removeChild(anchor)
  URL.revokeObjectURL(url)
}

export function loadOverview(): OverviewResult {
  const stored = allRows()
  const effective: Record<string, EntryRow[]> = {
    ...stored,
    [SETTLEMENT_KEY]: getRows(SETTLEMENT_KEY),
  }
  const modules = [...MODULE_BY_KEY.values()].map((meta) => {
    const entries = effective[meta.key] ?? []
    return {
      name: meta.name,
      created: entries.length,
      pending: entries.filter((row) => row.pending).length,
      abnormal: entries.filter((row) => row.abnormal).length,
    }
  })
  const cards = [
    { label: '业务模块', value: modules.length },
    { label: '登记总量', value: modules.reduce((sum, item) => sum + item.created, 0) },
    { label: '待处理', value: modules.reduce((sum, item) => sum + item.pending, 0) },
    { label: '异常量', value: modules.reduce((sum, item) => sum + item.abnormal, 0) },
  ]
  return { cards, modules }
}
