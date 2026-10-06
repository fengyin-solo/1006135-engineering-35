// 建筑监测样例准备入口（seed / reset 同读 seed.json 这一套样例）。
// 幂等：同一对象编号重复执行只 upsert，一次，不翻倍；
// 可续跑：每灌成功一条推进一格水位，跑一半停了下次从断点继续；
// 存量记录：按创建时间排队，缺字段的照对应样例补齐，绝不整块丢弃；
// 范围校验：越限记录在准备阶段就报出来，任何一条不过就不写库。
import { MODULE_BY_KEY } from './modules'
import {
  clearPrepareProgress,
  getPrepareProgress,
  listRows,
  saveMany,
  saveRows,
  seedRows,
  setPrepareProgress,
} from './local-store'
import { BUILDING_KEY, SETTLEMENT_KEY, buildingObjectKey } from './link'
import { validateRow } from './range'
import type { EntryRow, PrepareResult, RangeViolation } from './types'

type LegacyOutcome = {
  rows: EntryRow[]
  backfilled: number
  violations: RangeViolation[]
}

// 存量记录按创建时间排队（创建时间相同按 id，保证本地/容器结果一致）。
function sortByCreated(rows: EntryRow[]): EntryRow[] {
  return [...rows].sort((a, b) => {
    const ta = String(a.createdAt ?? '')
    const tb = String(b.createdAt ?? '')
    if (ta !== tb) {
      return ta < tb ? -1 : 1
    }
    return Number(a.id) - Number(b.id)
  })
}

// 同一条记录被递了两次只算一次：按对象编号合并，
// 保留先创建那条的身份与状态，后一条里有值而前一条缺的字段补到前一条上。
function dedupeByKey(rows: EntryRow[]): { rows: EntryRow[]; merged: number } {
  const chosen = new Map<string, EntryRow>()
  let merged = 0
  for (const row of sortByCreated(rows)) {
    const key = buildingObjectKey(row)
    const existing = key === '' ? undefined : chosen.get(key)
    if (!existing) {
      chosen.set(key || `__row_${Number(row.id)}`, row)
      continue
    }
    merged += 1
    for (const field of Object.keys(row)) {
      const filled = existing[field]
      const incoming = row[field]
      const empty = filled === undefined || filled === null || String(filled).trim() === ''
      if (empty && incoming !== undefined && incoming !== null && String(incoming).trim() !== '') {
        existing[field] = incoming
      }
    }
  }
  return { rows: [...chosen.values()], merged }
}

// 缺字段的存量记录照着对应样例补（按排队顺序取同序号样例，样例不够循环取）：
// 只补空列，已有值一律保留；缺创建时间的按排队顺序回填。
function repairLegacy(rows: EntryRow[], samples: EntryRow[], fields: string[]): LegacyOutcome {
  const ordered = sortByCreated(rows)
  let backfilled = 0
  const repaired = ordered.map((row, index) => {
    const template = samples[index % samples.length]
    const next: EntryRow = { ...row }
    for (const field of fields) {
      const value = next[field]
      if (value === undefined || value === null || String(value).trim() === '') {
        const fill = template[field]
        if (fill !== undefined && fill !== null) {
          next[field] = fill
          backfilled += 1
        }
      }
    }
    if (!next.createdAt && template.createdAt) {
      // 排队序号体现在分钟上，同一天创建的也能排开。
      const base = template.createdAt.slice(0, 11)
      next.createdAt = `${base}${String(index).padStart(2, '0')}:00:00.000Z`
      backfilled += 1
    }
    return next
  })
  const violations = repaired.flatMap((row) => validateRow(BUILDING_KEY, row))
  return { rows: repaired, backfilled, violations }
}

function describeViolations(violations: RangeViolation[]): string {
  return violations
    .slice(0, 5)
    .map((item) => `对象 ${item.id} 的「${item.field}」${item.reason}`)
    .join('；')
}

// 准备入口：幂等 upsert + 断点续跑 + 存量修复 + 越限拦截。
export function prepareBuildingSamples(): PrepareResult {
  const meta = MODULE_BY_KEY.get(BUILDING_KEY)
  if (!meta) {
    throw new Error(`没有登记名为 ${BUILDING_KEY} 的业务模块`)
  }
  const samples = seedRows(BUILDING_KEY)
  const { rows: deduped, merged } = dedupeByKey(listRows(BUILDING_KEY))
  const legacy = repairLegacy(deduped, samples, meta.fields)

  // 先校验存量：越限的记录在准备阶段就报出来，一条不过整体不落库。
  if (legacy.violations.length > 0) {
    return {
      ok: false,
      prepared: 0,
      skipped: 0,
      backfilled: legacy.backfilled,
      violations: legacy.violations,
      message: `准备中止：发现 ${legacy.violations.length} 处越限记录，${describeViolations(legacy.violations)}`,
    }
  }

  // 存量修复结果先落库（去重 + 补字段），随后逐条 upsert 样例并推进水位。
  let current = legacy.rows
  if (merged > 0 || legacy.backfilled > 0) {
    saveRows(BUILDING_KEY, current)
  }

  let prepared = 0
  let skipped = 0
  let startIndex = getPrepareProgress(BUILDING_KEY)
  if (startIndex > samples.length) {
    startIndex = 0
  }

  for (let index = startIndex; index < samples.length; index += 1) {
    const sample = samples[index]
    const sampleKey = buildingObjectKey(sample)
    const existingIndex = current.findIndex((row) => buildingObjectKey(row) === sampleKey)

    // 已存在且各字段齐全：视为上次已完成，仅推进水位，不翻倍。
    const alreadyComplete =
      existingIndex >= 0 &&
      meta.fields.every((field) => {
        const value = current[existingIndex][field]
        return value !== undefined && value !== null && String(value).trim() !== ''
      })
    if (alreadyComplete) {
      skipped += 1
      setPrepareProgress(BUILDING_KEY, index + 1)
      continue
    }

    // 写入前再做一次范围校验；写库失败由 saveRows 就地撤销，水位不前移 → 下次续跑。
    const candidate: EntryRow =
      existingIndex >= 0
        ? { ...current[existingIndex], ...sample, id: current[existingIndex].id }
        : sample
    const violations = validateRow(BUILDING_KEY, candidate)
    if (violations.length > 0) {
      return {
        ok: false,
        prepared,
        skipped,
        backfilled: legacy.backfilled,
        violations,
        message: `准备中止：样例 ${sampleKey} 越限，${describeViolations(violations)}`,
      }
    }

    const next = [...current]
    if (existingIndex >= 0) {
      next[existingIndex] = candidate
    } else {
      next.push(candidate)
    }
    saveRows(BUILDING_KEY, next)
    current = next
    prepared += 1
    setPrepareProgress(BUILDING_KEY, index + 1)
  }

  // 全部完成：清掉续跑水位。幂等由“同对象编号只 upsert 一次”保证，
  // 水位只是半成品续跑的抓手，重复执行时存量齐全会全部走跳过。
  clearPrepareProgress(BUILDING_KEY)

  const message =
    `样例准备完成：新灌 ${prepared} 条，已存在跳过 ${skipped} 条` +
    (legacy.backfilled > 0 ? `，存量回填 ${legacy.backfilled} 个字段` : '') +
    (merged > 0 ? `，合并重复记录 ${merged} 条` : '') +
    '；地表沉降清单已同源同步。'

  return {
    ok: true,
    prepared,
    skipped,
    backfilled: legacy.backfilled,
    violations: [],
    message,
  }
}

// 恢复初始状态入口：与准备入口读同一套样例（seed.json），并清掉续跑水位。
// 建筑与地表沉降是同源关系，恢复时两处一起回到同一套样例。
export function resetBuildingSamples(): EntryRow[] {
  const rows = seedRows(BUILDING_KEY)
  clearPrepareProgress(BUILDING_KEY)
  saveMany({
    [BUILDING_KEY]: rows,
    [SETTLEMENT_KEY]: seedRows(SETTLEMENT_KEY),
  })
  return rows
}
