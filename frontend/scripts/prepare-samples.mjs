#!/usr/bin/env node
/**
 * 准备入口：把样例灌进发布制品。
 * - 样例单一真源：src/data/seed-rows.json（浏览器首开与 reset 入口读的是同一份）
 * - 幂等：按 id upsert，重复执行不会翻倍；每步记 journal，跑一半停了再跑只续未完成的步
 * - 越限记录在这里就报出来并以非零码退出，不把坏数据带进制品
 */
import { mkdirSync, readFileSync, renameSync, writeFileSync, existsSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  KERNEL_VERSION,
  buildInitialDataset,
  mergeSamplesIntoDataset,
} from '../src/data/kernel.js'

const here = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(here, '..')
const SEED_PATH = resolve(ROOT, 'src/data/seed-rows.json')
const DATA_DIR = resolve(ROOT, '.data')
const JOURNAL_PATH = resolve(DATA_DIR, 'prepare-journal.json')
const ARTIFACT_DIR = resolve(ROOT, 'public/data')
const ARTIFACT_PATH = resolve(ARTIFACT_DIR, 'prepared-samples.json')

const readJson = (path) => JSON.parse(readFileSync(path, 'utf8'))
const writeJsonAtomic = (path, value) => {
  mkdirSync(dirname(path), { recursive: true })
  const tmp = `${path}.tmp`
  writeFileSync(tmp, JSON.stringify(value, null, 2) + '\n')
  renameSync(tmp, path) // 先落临时文件再改名，避免读到半截文件
}

function loadJournal() {
  if (!existsSync(JOURNAL_PATH)) {
    return { kernel: KERNEL_VERSION, seedChecksum: '', steps: {} }
  }
  try {
    return readJson(JOURNAL_PATH)
  } catch {
    // journal 损坏时从空进度重跑，已完成的 upsert 天然幂等，不会翻倍。
    return { kernel: KERNEL_VERSION, seedChecksum: '', steps: {} }
  }
}

function checksumOf(value) {
  let hash = 0
  const text = JSON.stringify(value)
  for (let i = 0; i < text.length; i += 1) {
    hash = (hash * 31 + text.charCodeAt(i)) | 0
  }
  return `v${KERNEL_VERSION}-${(hash >>> 0).toString(16)}`
}

function run() {
  const seedRaw = readJson(SEED_PATH)
  const checksum = checksumOf(seedRaw)
  const journal = loadJournal()

  // 内核规则或样例变了：旧进度作废，但已经灌进去的记录靠 upsert 幂等收口，仍不翻倍。
  if (journal.kernel !== KERNEL_VERSION || journal.seedChecksum !== checksum) {
    journal.kernel = KERNEL_VERSION
    journal.seedChecksum = checksum
    journal.steps = {}
  }

  // 步骤 1：初始数据集（样例自身的范围校验）。越限直接报，不继续。
  if (!journal.steps.validated) {
    const initial = buildInitialDataset(seedRaw)
    if (initial.violations.length > 0) {
      console.error('[prepare] 样例存在越限记录，准备中止：')
      for (const v of initial.violations) {
        console.error(
          `  - 模块 ${v.module} 编号 ${v.id} 字段「${v.field}」=${v.value}` +
            (v.reason === 'out-of-range' ? `，允许区间 [${v.min}, ${v.max}]` : '，不是数值'),
        )
      }
      process.exit(1)
    }
    journal.steps.validated = true
    writeJsonAtomic(JOURNAL_PATH, journal)
  }

  // 步骤 2：合并进当前制品数据集（断点续跑：没有制品就从头灌，有就只补缺）。
  let merged
  if (!journal.steps.merged) {
    const current = existsSync(ARTIFACT_PATH)
      ? readJson(ARTIFACT_PATH).dataset || {}
      : {}
    merged = mergeSamplesIntoDataset(current, seedRaw)
    if (merged.violations.length > 0) {
      console.error('[prepare] 合并后存在越限记录，准备中止：')
      for (const v of merged.violations) {
        console.error(
          `  - 模块 ${v.module} 编号 ${v.id} 字段「${v.field}」=${v.value}` +
            (v.reason === 'out-of-range' ? `，允许区间 [${v.min}, ${v.max}]` : '，不是数值'),
        )
      }
      process.exit(1)
    }
    journal.steps.merged = true
    writeJsonAtomic(JOURNAL_PATH, journal)
  } else {
    merged = mergeSamplesIntoDataset(
      existsSync(ARTIFACT_PATH) ? readJson(ARTIFACT_PATH).dataset || {} : {},
      seedRaw,
    )
  }

  // 步骤 3：写发布制品（样例随制品走，镜像里谁都能看到）。
  if (!journal.steps.published) {
    const buildingCount = merged.dataset.building?.length ?? 0
    const settlementCount = merged.dataset.settlement?.length ?? 0
    if (buildingCount !== settlementCount) {
      console.error(
        `[prepare] 建筑监测 ${buildingCount} 条与地表沉降 ${settlementCount} 条不一致，准备中止`,
      )
      process.exit(1)
    }
    const artifact = {
      kernel: KERNEL_VERSION,
      checksum,
      preparedAt: new Date().toISOString(),
      counts: Object.fromEntries(
        Object.keys(merged.dataset).map((key) => [key, merged.dataset[key].length]),
      ),
      dataset: merged.dataset,
    }
    writeJsonAtomic(ARTIFACT_PATH, artifact)
    journal.steps.published = true
    writeJsonAtomic(JOURNAL_PATH, journal)
  }

  const artifact = readJson(ARTIFACT_PATH)
  const addedThisRun = merged ? merged.added.length : 0
  console.log(
    `[prepare] 完成（checksum ${checksum}），本次新增/补齐 ${addedThisRun} 条；` +
      `建筑监测 ${artifact.counts.building} 条，地表沉降 ${artifact.counts.settlement} 条`,
  )
}

run()
