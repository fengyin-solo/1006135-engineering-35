#!/usr/bin/env node
// 构建期样例校验：与准备阶段共用 range-rules.json 这一份范围规则，
// 越限样例或“建筑监测/地表沉降条数不同源”都会让构建直接失败。
// 用法：node scripts/check-seed.mjs
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const dataDir = resolve(here, '..', 'src', 'data')

const seed = JSON.parse(readFileSync(resolve(dataDir, 'seed.json'), 'utf8'))
const rules = JSON.parse(readFileSync(resolve(dataDir, 'range-rules.json'), 'utf8'))

const BUILDING_FIELDS = ['对象编号', '建筑物名称', '结构类型', '距隧道距离', '允许沉降', '实测沉降', '监测频次', '监测状态']
const SETTLEMENT_FIELDS = ['测点编号', '测点位置', '初始高程', '累计沉降', '沉降速率', '预警阈值', '监测日期', '测点状态']

const problems = []

function readNumeric(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  if (value === null || value === undefined) return null
  const matched = String(value).match(/-?\d+(?:\.\d+)?/)
  return matched ? Number(matched[0]) : null
}

for (const [moduleKey, fieldRules] of Object.entries(rules)) {
  const rows = seed[moduleKey]
  if (!Array.isArray(rows)) {
    problems.push(`范围规则里登记了模块 ${moduleKey}，但 seed.json 里没有它的样例`)
    continue
  }
  for (const row of rows) {
    for (const [field, rule] of Object.entries(fieldRules)) {
      const num = readNumeric(row[field])
      if (num === null) {
        problems.push(`${moduleKey}#${row.id} 的「${field}」不是数值样例：${JSON.stringify(row[field])}`)
      } else if (num < rule.min || num > rule.max) {
        problems.push(`${moduleKey}#${row.id} 的「${field}」=${num} 越限（允许 ${rule.min}~${rule.max}${rule.unit ?? ''}）`)
      }
    }
  }
}

// 样例本身也要满足“准备结果反映到地表沉降”：两份样例同条数、对象编号一一对应。
const buildingRows = seed.building ?? []
const settlementRows = seed.settlement ?? []
if (buildingRows.length !== settlementRows.length) {
  problems.push(`建筑监测样例 ${buildingRows.length} 条与地表沉降样例 ${settlementRows.length} 条数量不一致`)
}

for (const row of buildingRows) {
  for (const field of BUILDING_FIELDS) {
    if (row[field] === undefined || String(row[field]).trim() === '') {
      problems.push(`建筑监测样例 ${row.id} 缺字段「${field}」`)
    }
  }
}
for (const row of settlementRows) {
  for (const field of SETTLEMENT_FIELDS) {
    if (row[field] === undefined || String(row[field]).trim() === '') {
      problems.push(`地表沉降样例 ${row.id} 缺字段「${field}」`)
    }
  }
  const linked = buildingRows.find((item) => item['对象编号'] === row['关联对象编号'])
  if (!linked) {
    problems.push(`地表沉降样例 ${row.id} 的关联对象编号 ${row['关联对象编号']} 在建筑监测样例里找不到`)
  }
}

if (problems.length > 0) {
  console.error('样例数据校验失败：')
  for (const item of problems) {
    console.error(`  - ${item}`)
  }
  process.exit(1)
}

console.log(`样例数据校验通过：${Object.keys(seed).length} 个模块，建筑监测/地表沉降各 ${buildingRows.length} 条且同源`)
