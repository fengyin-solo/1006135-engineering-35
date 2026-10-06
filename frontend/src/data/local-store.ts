import { SEED_ROWS } from './seed'
import { buildInitialDataset, mergeSamplesIntoDataset } from './kernel.js'
import type { EntryRow } from './types'

// 本地持久化：数据放在 localStorage 里，刷新、关掉再打开都还在。
const STORAGE_KEY = 'shield-tunnel-construction:entries'

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function writeStorage(dataset: Record<string, EntryRow[]>): void {
  if (typeof window !== 'undefined' && window.localStorage) {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(dataset))
  }
}

// 读存量时按共享内核做一次迁移：id 归一成 number、缺字段照样例补、createdAt 按创建先后回填、
// 地表沉降与建筑监测对齐。兼容旧的读取方式，记录只修不丢，不整块丢弃。
function migrate(raw: Record<string, EntryRow[]>): Record<string, EntryRow[]> {
  const { dataset } = mergeSamplesIntoDataset(raw, clone(SEED_ROWS))
  return dataset
}

function readStorage(): Record<string, EntryRow[]> {
  const fallback = clone(SEED_ROWS)
  if (typeof window === 'undefined' || !window.localStorage) {
    return fallback
  }
  const raw = window.localStorage.getItem(STORAGE_KEY)
  if (!raw) {
    writeStorage(fallback)
    return fallback
  }
  try {
    const parsed = JSON.parse(raw) as Record<string, EntryRow[]>
    const migrated = migrate(parsed)
    writeStorage(migrated)
    return migrated
  } catch {
    writeStorage(fallback)
    return fallback
  }
}

let cache: Record<string, EntryRow[]> | null = null

export function allRows(): Record<string, EntryRow[]> {
  if (cache === null) {
    cache = readStorage()
  }
  return cache
}

export function listRows(key: string): EntryRow[] {
  return allRows()[key] ?? []
}

export function saveRows(key: string, rows: EntryRow[]): void {
  const next = { ...allRows(), [key]: rows }
  cache = next
  writeStorage(next)
}

/**
 * 事务式写入：基于同一快照改出下一份数据，先整份写库，失败就回滚内存与存储到旧快照。
 * mutate 抛错（含范围校验失败）时，已做的改动就地撤销，不留半截状态。
 */
export function commit(mutate: (draft: Record<string, EntryRow[]>) => void): Record<string, EntryRow[]> {
  const before = allRows()
  const draft = clone(before)
  mutate(draft)
  cache = draft
  try {
    writeStorage(draft)
  } catch (error) {
    cache = before
    writeStorage(before)
    throw error
  }
  return draft
}

export function resetRows(key: string): EntryRow[] {
  const rows = clone(SEED_ROWS[key] ?? [])
  saveRows(key, rows)
  return rows
}

// 浏览器侧准备入口：与 Node 的 prepare 入口读同一套样例、走同一个合并内核，幂等不翻倍。
export function prepareSamples(): Record<string, EntryRow[]> {
  const { dataset } = mergeSamplesIntoDataset(allRows(), clone(SEED_ROWS))
  cache = dataset
  writeStorage(dataset)
  return dataset
}

// 浏览器侧恢复入口：清掉本机改动，回到与 Node reset 同源的初始样例。
export function resetAllSamples(): Record<string, EntryRow[]> {
  const { dataset } = buildInitialDataset(clone(SEED_ROWS))
  cache = dataset
  writeStorage(dataset)
  return dataset
}

export function storageKey(): string {
  return STORAGE_KEY
}
