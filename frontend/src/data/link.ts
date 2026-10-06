// 建筑监测 → 地表沉降的同源实现：沉降测点清单里属于建筑物的部分一律由
// 建筑监测清单推导，编号、条数都来自同一份 building 数据，两边不再各写一份。
// 准备入口灌建筑样例后，这里读到的条数随之同步，不需要再单独准备沉降样例。
import type { EntryRow } from './types'

export const BUILDING_KEY = 'building'
export const SETTLEMENT_KEY = 'settlement'

const SETTLEMENT_STATUS_FROM_BUILDING: Record<string, string> = {
  待布点: '待复核',
  监测中: '预警',
  已报警: '报警',
  已解除: '已稳定',
}

export function buildingObjectKey(row: EntryRow): string {
  return String(row['对象编号'] ?? '').trim()
}

// 沉降测点记录反向找到所属建筑对象时，优先认“关联对象编号”，
// 兼容存量里把对象编号写进测点记录、或用 SETT-B<对象编号> 命名的老读法。
export function settlementObjectKey(row: EntryRow): string {
  const linked = row['关联对象编号']
  if (linked !== undefined && String(linked).trim() !== '') {
    return String(linked).trim()
  }
  // 老读法里测点编号就是「SETT-」加对象编号（SETT-BUIL-0001 ↔ BUIL-0001）。
  const code = String(row['测点编号'] ?? '').trim()
  const matched = code.match(/^SETT-(.+)$/)
  return matched ? matched[1] : ''
}

function numberText(value: unknown): string {
  if (value === undefined || value === null || String(value).trim() === '') {
    return ''
  }
  return String(value)
}

// 由一条建筑监测记录推出它在沉降清单里对应的测点（1:1，条数天然相等）。
// 存量沉降测点已经记录过测量值的，合并时保留其测量值（见 mergeLinkedRows）。
export function deriveSettlementRow(building: EntryRow): EntryRow {
  const objectKey = buildingObjectKey(building)
  return {
    id: building.id,
    status: SETTLEMENT_STATUS_FROM_BUILDING[building.status] ?? building.status,
    pending: building.pending,
    abnormal: building.abnormal,
    createdAt: building.createdAt,
    测点编号: `SETT-${objectKey}`,
    关联对象编号: objectKey,
    测点位置: `${building['建筑物名称'] ?? ''}（关联建筑监测）`,
    初始高程: '',
    累计沉降: numberText(building['实测沉降']),
    沉降速率: '',
    预警阈值: numberText(building['允许沉降']),
    监测日期: (building.createdAt ?? '').slice(0, 10),
    测点状态: SETTLEMENT_STATUS_FROM_BUILDING[building.status] ?? building.status,
  }
}

// 已有沉降测点记录里若有更新过的测量值，用它覆盖推导出的默认值；
// 身份列（测点编号、关联对象）以建筑监测为准，保证两边永远同源。
function mergeMeasurement(derived: EntryRow, existing: EntryRow): EntryRow {
  const measurementFields = ['初始高程', '累计沉降', '沉降速率', '预警阈值', '监测日期']
  const merged: EntryRow = { ...derived }
  for (const field of measurementFields) {
    const value = existing[field]
    if (value !== undefined && String(value).trim() !== '') {
      merged[field] = value
    }
  }
  if (String(existing.status ?? '') !== '') {
    merged.status = String(existing.status)
  }
  merged.pending = Boolean(existing.pending)
  merged.abnormal = Boolean(existing.abnormal)
  return merged
}

export type SettlementView = {
  rows: EntryRow[]
  linkedCount: number
  orphanCount: number
}

// 沉降清单的读入口：建筑监测推导出的联测点 + 关联不上任何对象的存量测点（保留不丢）。
// 联测部分的条数永远等于建筑监测条数；准备结果从这里反映到沉降清单。
export function buildSettlementView(
  buildingRows: EntryRow[],
  settlementRows: EntryRow[],
): SettlementView {
  const byObject = new Map<string, EntryRow>()
  for (const row of settlementRows) {
    const key = settlementObjectKey(row)
    if (key !== '' && !byObject.has(key)) {
      byObject.set(key, row)
    }
  }
  const linked = buildingRows.map((building) => {
    const existing = byObject.get(buildingObjectKey(building))
    return existing ? mergeMeasurement(deriveSettlementRow(building), existing) : deriveSettlementRow(building)
  })

  const linkedKeys = new Set(buildingRows.map(buildingObjectKey))
  const orphans = settlementRows.filter((row) => {
    const key = settlementObjectKey(row)
    return key === '' || !linkedKeys.has(key)
  })

  return { rows: [...linked, ...orphans], linkedCount: linked.length, orphanCount: orphans.length }
}
