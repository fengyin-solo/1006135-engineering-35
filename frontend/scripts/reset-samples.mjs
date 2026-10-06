#!/usr/bin/env node
/**
 * 恢复入口：回到初始样例状态。
 * 与 prepare 读同一套样例（src/data/seed-rows.json）和同一个内核，区别只是：
 * 清掉准备进度与已灌制品，再按样例重建一份干净的初始清单。
 */
import { mkdirSync, readFileSync, writeFileSync, renameSync, rmSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { KERNEL_VERSION, buildInitialDataset } from '../src/data/kernel.js'

const here = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(here, '..')
const SEED_PATH = resolve(ROOT, 'src/data/seed-rows.json')
const DATA_DIR = resolve(ROOT, '.data')
const ARTIFACT_DIR = resolve(ROOT, 'public/data')
const ARTIFACT_PATH = resolve(ARTIFACT_DIR, 'prepared-samples.json')

const writeJsonAtomic = (path, value) => {
  mkdirSync(dirname(path), { recursive: true })
  const tmp = `${path}.tmp`
  writeFileSync(tmp, JSON.stringify(value, null, 2) + '\n')
  renameSync(tmp, path)
}

const seedRaw = JSON.parse(readFileSync(SEED_PATH, 'utf8'))
const { dataset, violations } = buildInitialDataset(seedRaw)
if (violations.length > 0) {
  console.error('[reset] 初始样例存在越限记录，恢复中止：')
  for (const v of violations) {
    console.error(
      `  - 模块 ${v.module} 编号 ${v.id} 字段「${v.field}」=${v.value}` +
        (v.reason === 'out-of-range' ? `，允许区间 [${v.min}, ${v.max}]` : '，不是数值'),
    )
  }
  process.exit(1)
}

// 清掉准备入口的进度与制品，再写回初始状态
rmSync(DATA_DIR, { recursive: true, force: true })
const buildingCount = dataset.building?.length ?? 0
const settlementCount = dataset.settlement?.length ?? 0
if (buildingCount !== settlementCount) {
  console.error(`[reset] 建筑监测 ${buildingCount} 条与地表沉降 ${settlementCount} 条不一致，恢复中止`)
  process.exit(1)
}
writeJsonAtomic(ARTIFACT_PATH, {
  kernel: KERNEL_VERSION,
  checksum: 'initial',
  preparedAt: new Date().toISOString(),
  counts: Object.fromEntries(Object.keys(dataset).map((key) => [key, dataset[key].length])),
  dataset,
})
console.log(
  `[reset] 已恢复初始样例：建筑监测 ${buildingCount} 条，地表沉降 ${settlementCount} 条，` +
    '浏览器侧重置见页面「恢复初始样例」按钮（清 localStorage 后同样回到这份）',
)
