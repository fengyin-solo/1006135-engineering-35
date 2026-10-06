/**
 * 共享数据内核：Node 的准备/恢复脚本与浏览器本地数据层都走这一份。
 * 归一化、范围校验、存量回填、沉降联动、指标统计只在此实现一次，两边不分两套。
 * 纯 ESM、无运行时依赖，.mjs 脚本与 Vite 都能直接 import。
 */

// 内核版本：进入样例清单的指纹，规则变了老的进度不能当已完成，会自动重灌。
export const KERNEL_VERSION = 3

// 需要按数值读的字段：容器/本地拿到字符串时统一归一成 number，页面不再读出空串或错类型。
export const NUMERIC_FIELDS = {
  building: ['距隧道距离', '允许沉降', '实测沉降'],
  settlement: ['初始高程', '累计沉降', '沉降速率', '预警阈值'],
}

// 范围规则（共享实现，准备阶段与页面登记都查它）：越限记录在准备阶段就被报出来。
export const FIELD_RULES = [
  { module: 'building', field: '距隧道距离', min: 0, max: 100 },
  { module: 'building', field: '允许沉降', min: 0, max: 100 },
  { module: 'building', field: '实测沉降', min: 0, max: 100 },
  { module: 'settlement', field: '初始高程', min: -1000, max: 1000 },
  { module: 'settlement', field: '累计沉降', min: -100, max: 100 },
  { module: 'settlement', field: '沉降速率', min: -50, max: 50 },
  { module: 'settlement', field: '预警阈值', min: 0, max: 100 },
]

// 建筑监测状态 -> 地表沉降状态：同源联动用。
export const SETTLEMENT_STATUS_BY_BUILDING = {
  待布点: '正常',
  监测中: '预警',
  已报警: '报警',
  已解除: '已稳定',
}

const DAY_MS = 24 * 60 * 60 * 1000
// 存量记录没有创建时间时，按数组顺序（即创建先后）从 2026-09-01 起逐日回填。
const BACKFILL_BASE_TS = Date.UTC(2026, 8, 1)

function toFiniteNumber(value) {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null
  }
  if (typeof value === 'string' && value.trim() !== '') {
    const n = Number(value.trim())
    return Number.isFinite(n) ? n : null
  }
  return null
}

function toTimestamp(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim() !== '') {
    const t = Date.parse(value)
    return Number.isFinite(t) ? t : null
  }
  return null
}

function seedTemplateFor(seedRows, id) {
  const byId = (seedRows || []).find((row) => Number(row && row.id) === id)
  return byId || (seedRows && seedRows[0]) || null
}

/** id 统一成 number：本地与容器里对象编号类型不一致的问题在此收口。 */
export function normalizeId(value, fallback) {
  const n = toFiniteNumber(value)
  if (n !== null && Number.isInteger(n)) return n
  return fallback
}

/**
 * 归一化一批记录（兼容存量读取方式，不整块丢弃）：
 * - id 转 number；status/pending/abnormal 缺省补齐
 * - 缺的业务字段照着同 id（否则第一条）样例补上
 * - 数值字段能转就转 number，转不了保留原值
 * - createdAt 缺失的按创建先后回填
 */
export function normalizeRows(moduleKey, rows, seedRows) {
  const list = Array.isArray(rows) ? rows.filter((row) => row && typeof row === 'object') : []
  const numericFields = NUMERIC_FIELDS[moduleKey] || []
  // id 必须是 number；存量里非数字的 id 按创建先后补发，不能覆盖已有数字 id。
  const usedIds = new Set(
    list.map((row) => Number(row.id)).filter((n) => Number.isInteger(n)),
  )
  let seq = 0
  const nextId = () => {
    do {
      seq += 1
    } while (usedIds.has(seq))
    usedIds.add(seq)
    return seq
  }

  return list.map((raw, order) => {
    const parsed = Number(raw.id)
    const id = Number.isInteger(parsed) ? parsed : nextId()
    const template = seedTemplateFor(seedRows, id) || {}
    const row = { ...raw, id }

    if (typeof row.status !== 'string' || row.status.trim() === '') {
      row.status = typeof template.status === 'string' ? template.status : ''
    }
    if (typeof row.pending !== 'boolean') {
      row.pending = typeof template.pending === 'boolean' ? template.pending : false
    }
    if (typeof row.abnormal !== 'boolean') {
      row.abnormal = typeof template.abnormal === 'boolean' ? template.abnormal : false
    }

    for (const key of Object.keys(template)) {
      if (key === 'id' || key === 'status' || key === 'pending' || key === 'abnormal' || key === 'createdAt') {
        continue
      }
      const missing = row[key] === undefined || row[key] === null || row[key] === ''
      if (missing && template[key] !== undefined && template[key] !== null && template[key] !== '') {
        row[key] = template[key]
      }
    }

    for (const field of numericFields) {
      if (row[field] !== undefined) {
        const n = toFiniteNumber(row[field])
        if (n !== null) row[field] = n
      }
    }

    if (toTimestamp(row.createdAt) === null) {
      row.createdAt = BACKFILL_BASE_TS + order * DAY_MS
    } else {
      row.createdAt = toTimestamp(row.createdAt)
    }
    return row
  })
}

/** 由一条建筑监测记录同源派生一条地表沉降测点：一一对应，两处条数由此同步。 */
export function deriveSettlement(buildingRow, seq) {
  const id = normalizeId(buildingRow.id, seq)
  const suffix = String(buildingRow['对象编号'] || '').replace(/^[^-]+-/, '') || String(id).padStart(4, '0')
  const day = String(((id - 1) % 28) + 1).padStart(2, '0')
  const buildingStatus = String(buildingRow.status)
  const status = SETTLEMENT_STATUS_BY_BUILDING[buildingStatus] || '正常'
  return {
    id,
    status,
    pending: buildingRow.pending !== false,
    abnormal: buildingRow.abnormal === true,
    测点编号: `SETT-${suffix}`,
    测点位置: buildingRow['建筑物名称'] || '',
    初始高程: 0,
    累计沉降: toFiniteNumber(buildingRow['实测沉降']) ?? 0,
    沉降速率: 0,
    预警阈值: toFiniteNumber(buildingRow['允许沉降']) ?? 0,
    监测日期: `2026-09-${day}`,
    测点状态: status,
    createdAt: toTimestamp(buildingRow.createdAt) ?? BACKFILL_BASE_TS + (id - 1) * DAY_MS,
  }
}

/** 让地表沉降与建筑监测对齐：缺的测点按建筑对象补，存量测点保留，绝不整块丢弃。 */
export function reconcileSettlement(dataset) {
  const added = []
  const building = dataset.building || []
  const settlement = dataset.settlement || []
  const haveIds = new Set(settlement.map((row) => Number(row.id)))
  building.forEach((row, index) => {
    if (!haveIds.has(Number(row.id))) {
      const derived = deriveSettlement(row, index + 1)
      settlement.push(derived)
      added.push(derived)
    }
  })
  settlement.sort((a, b) => Number(a.id) - Number(b.id))
  dataset.settlement = settlement
  return added
}

/** 范围校验：越限记录在这里报出来。空值不判越限（缺字段在归一化阶段补）。 */
export function validateRanges(dataset) {
  const violations = []
  for (const rule of FIELD_RULES) {
    const rows = dataset[rule.module] || []
    for (const row of rows) {
      const value = row[rule.field]
      if (value === undefined || value === null || value === '') continue
      const n = toFiniteNumber(value)
      if (n === null) {
        violations.push({ module: rule.module, id: Number(row.id), field: rule.field, value: row[rule.field], reason: 'not-a-number' })
        continue
      }
      if (n < rule.min || n > rule.max) {
        violations.push({ module: rule.module, id: Number(row.id), field: rule.field, value: n, min: rule.min, max: rule.max, reason: 'out-of-range' })
      }
    }
  }
  return violations
}

/**
 * 归一化整个数据集（存量迁移用）：各模块记录就地修复，缺模块按样例补，
 * 地表沉降与建筑监测对齐，返回越限清单（不阻断存量读取，准备阶段才阻断）。
 */
export function normalizeDataset(input, seed) {
  const dataset = {}
  const modules = new Set([...Object.keys(input || {}), ...Object.keys(seed || {})])
  for (const moduleKey of modules) {
    const current = (input && input[moduleKey]) || []
    dataset[moduleKey] = normalizeRows(moduleKey, current, seed && seed[moduleKey])
  }
  reconcileSettlement(dataset)
  const violations = validateRanges(dataset)
  return { dataset, violations }
}

/** 初始数据集：样例归一化后，地表沉降完全按建筑监测派生（同源、同条数）。 */
export function buildInitialDataset(seed) {
  const dataset = {}
  for (const moduleKey of Object.keys(seed || {})) {
    if (moduleKey === 'settlement') continue
    dataset[moduleKey] = normalizeRows(moduleKey, seed[moduleKey], seed[moduleKey])
  }
  dataset.settlement = (dataset.building || []).map((row, index) => deriveSettlement(row, index + 1))
  const violations = validateRanges(dataset)
  return { dataset, violations }
}

/**
 * 准备入口的合并逻辑（Node 与浏览器共用）：
 * 存量先归一化迁移（缺字段补样例、createdAt 回填、不清空），样例按 id 幂等 upsert，
 * 再按建筑对象补齐沉降测点。重复执行只补缺，不翻倍。
 */
export function mergeSamplesIntoDataset(current, seed) {
  const { dataset, violations: migrationViolations } = normalizeDataset(current || {}, seed)
  const added = []
  for (const moduleKey of Object.keys(seed || {})) {
    if (moduleKey === 'settlement') continue
    const existing = new Set((dataset[moduleKey] || []).map((row) => Number(row.id)))
    for (const row of normalizeRows(moduleKey, seed[moduleKey], seed[moduleKey])) {
      if (!existing.has(Number(row.id))) {
        dataset[moduleKey].push(row)
        added.push({ module: moduleKey, id: Number(row.id) })
        existing.add(Number(row.id))
      }
    }
  }
  for (const derived of reconcileSettlement(dataset)) {
    added.push({ module: 'settlement', id: Number(derived.id) })
  }
  const violations = validateRanges(dataset)
  void migrationViolations
  return { dataset, added, violations }
}

const STATUS_ALIASES = { 报警: '已报警' }

/**
 * 指标统计的共享实现：两个页面的数字同此同源。
 * 「最大累计沉降」取数值列最大值；其余标签按状态计数（支持「报警对象→已报警」这类别名）。
 */
export function metricValue(meta, rows, label) {
  const list = Array.isArray(rows) ? rows : []
  const maxField = /最大(.*)$/.exec(label)
  if (maxField) {
    const field = maxField[1]
    let max = 0
    for (const row of list) {
      const n = toFiniteNumber(row[field])
      if (n !== null && n > max) max = n
    }
    return max
  }
  const statuses = meta.statuses || []
  let target = statuses.find((status) => label.includes(status))
  if (!target) {
    for (const [alias, real] of Object.entries(STATUS_ALIASES)) {
      if (label.includes(alias) && statuses.includes(real)) {
        target = real
        break
      }
    }
  }
  if (!target) return 0
  return list.filter((row) => String(row.status) === target).length
}

export function computeStats(meta, rows) {
  return (meta.metrics || []).map((label) => ({ label, value: metricValue(meta, rows, label) }))
}
