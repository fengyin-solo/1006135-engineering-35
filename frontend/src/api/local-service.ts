import { MODULE_BY_KEY } from '@/data/modules'
import {
  allRows,
  commit,
  listRows,
  prepareSamples,
  resetAllSamples,
  resetRows,
  saveRows,
} from '@/data/local-store'
import {
  computeStats,
  deriveSettlement,
  metricValue,
  normalizeRows,
  validateRanges,
} from '@/data/kernel.js'
import type {
  ActionResult,
  EntryRow,
  ModuleMeta,
  OverviewResult,
  PageResult,
  RangeViolation,
} from '@/data/types'

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

export function listEntries(key: string, filters: Record<string, string> = {}): PageResult {
  const matched = filterRows(listRows(key), filters)
  return { items: matched, total: matched.length, page: 1, size: matched.length }
}

export function runAction(key: string, id: number, action: string): ActionResult {
  const meta = moduleMeta(key)
  const target = meta.actionTargets[action]
  if (!target) {
    return { ok: false, message: `${meta.entity}没有登记「${action}」这个动作` }
  }
  const rows = listRows(key)
  const index = rows.findIndex((row) => Number(row.id) === id)
  if (index < 0) {
    return { ok: false, message: `没有找到编号为 ${id} 的${meta.entity}` }
  }
  const current = String(rows[index].status)
  if (current === target) {
    return { ok: false, message: `${meta.entity}已经是「${target}」，不用重复操作` }
  }
  const lastStatus = meta.statuses[meta.statuses.length - 1]
  const updated: EntryRow = {
    ...rows[index],
    status: target,
    pending: target !== lastStatus,
    abnormal: NEGATIVE_ACTIONS.some((verb) => action.startsWith(verb)),
  }
  const next = [...rows]
  next[index] = updated
  saveRows(key, next)
  return { ok: true, message: `${meta.entity}已${action}，当前状态「${target}」` }
}

export function resetModule(key: string): PageResult {
  resetRows(key)
  return listEntries(key)
}

/**
 * 登记监测对象（建筑监测）：
 * - 范围校验走共享内核，越限在写入前就报出来
 * - 同一对象编号重复递只记一次
 * - 建筑与联动沉降在同一事务里落库，写库失败就地撤销（两边都不会留半截）
 */
export function createBuildingEntry(input: Omit<EntryRow, 'id'>): ActionResult {
  const meta = moduleMeta('building')
  const code = String(input['对象编号'] ?? '').trim()
  if (code === '') {
    return { ok: false, message: '对象编号不能为空' }
  }

  const rows = listRows('building')
  if (rows.some((row) => String(row['对象编号'] ?? '') === code)) {
    return { ok: false, message: `对象编号 ${code} 已存在，重复提交不重复登记` }
  }

  const id = rows.reduce((max, row) => Math.max(max, Number(row.id) || 0), 0) + 1
  const fullRow: EntryRow = {
    status: '待布点',
    pending: true,
    abnormal: false,
    ...input,
    id,
  }
  const row = normalizeRows('building', [fullRow], rows)[0]
  const candidate = { ...allRows(), building: [...rows, row] }
  const violations = validateRanges(candidate).filter((item) => item.module === 'building')
  if (violations.length > 0) {
    return { ok: false, message: formatViolations(meta, violations) }
  }

  try {
    commit((draft) => {
      draft.building.push(row)
      const linked = deriveSettlement(row, row.id)
      const have = new Set(draft.settlement.map((item) => Number(item.id)))
      if (!have.has(Number(linked.id))) {
        draft.settlement.push(linked)
        draft.settlement.sort((a, b) => Number(a.id) - Number(b.id))
      }
    })
  } catch {
    return { ok: false, message: '写库失败，已就地撤销，本次登记未生效' }
  }
  return { ok: true, message: `监测对象 ${code} 已登记，并同步了 ${row['建筑物名称']} 的沉降测点` }
}

// 准备 / 恢复入口（浏览器侧）：与 Node 脚本同源，重复执行幂等。
export function prepareModuleSamples(): ActionResult {
  const before = allRows()
  const after = prepareSamples()
  const added =
    Object.values(after).reduce((sum, list) => sum + list.length, 0) -
    Object.values(before).reduce((sum, list) => sum + list.length, 0)
  return {
    ok: true,
    message: `样例已灌入：补齐 ${added} 条，建筑监测 ${after.building.length} 条、地表沉降 ${after.settlement.length} 条`,
  }
}

export function resetAllModules(): ActionResult {
  const after = resetAllSamples()
  return {
    ok: true,
    message: `已恢复初始样例：建筑监测 ${after.building.length} 条、地表沉降 ${after.settlement.length} 条`,
  }
}

function formatViolations(meta: ModuleMeta, violations: RangeViolation[]): string {
  return violations
    .map((v) => {
      if (v.reason === 'not-a-number') {
        return `${meta.entity}编号 ${v.id} 的「${v.field}」不是数值`
      }
      return `${meta.entity}编号 ${v.id} 的「${v.field}」=${v.value}，允许区间 [${v.min}, ${v.max}]`
    })
    .join('；')
}

export function moduleStats(key: string): Array<{ label: string; value: number }> {
  const meta = moduleMeta(key)
  return computeStats(meta, listRows(key))
}

export { metricValue }

export function exportEntries(key: string): { filename: string; content: string } {
  const meta = moduleMeta(key)
  const header = ['编号', ...meta.fields, '当前状态']
  const lines = [header.join(',')]
  for (const row of listRows(key)) {
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
  const rows = allRows()
  const modules = [...MODULE_BY_KEY.values()].map((meta) => {
    const entries = rows[meta.key] ?? []
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
