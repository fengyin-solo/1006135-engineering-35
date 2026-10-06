import { SEED_ROWS } from './seed'
import { normalizeModule } from './normalize'
import { BUILDING_KEY, SETTLEMENT_KEY } from './link'
import type { EntryRow } from './types'

// 本地持久化：数据放在 localStorage 里，刷新、关掉再打开都还在。
export const STORAGE_PREFIX = 'shield-tunnel-construction:'
export const STORAGE_KEY = `${STORAGE_PREFIX}entries`
// 准备入口的续跑水位：记录已灌到哪一条样例，跑一半停了下次接着跑、不重复灌。
const PROGRESS_PREFIX = `${STORAGE_PREFIX}prepare:`

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function canUseStorage(): boolean {
  return typeof window !== 'undefined' && Boolean(window.localStorage)
}

function seedFallback(): Record<string, EntryRow[]> {
  const fallback = clone(SEED_ROWS)
  return Object.fromEntries(
    Object.entries(fallback).map(([key, rows]) => [key, normalizeModule(key, rows)]),
  )
}

function readStorage(): Record<string, EntryRow[]> {
  const fallback = seedFallback()
  if (!canUseStorage()) {
    return fallback
  }
  const storage = window.localStorage
  const raw = storage.getItem(STORAGE_KEY)
  if (!raw) {
    storage.setItem(STORAGE_KEY, JSON.stringify(fallback))
    return fallback
  }
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown[]>
    const merged: Record<string, EntryRow[]> = { ...fallback }
    for (const [key, rows] of Object.entries(parsed)) {
      if (Array.isArray(rows)) {
        // 读取即归一化：修掉 id 的 number/string 不一致与旧字段名，页面拿到的总是统一形状。
        merged[key] = normalizeModule(key, rows)
      }
    }
    return merged
  } catch {
    storage.setItem(STORAGE_KEY, JSON.stringify(fallback))
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

// 写库失败就地撤销：先留内存快照，localStorage 抛错（配额满、隐私模式）时
// 把内存回滚到写之前的样子并向上抛，避免“界面改了、库里没有”的半截状态。
// 写入同样过一遍归一化：页面或存量直接塞进来的字符串 id、旧字段名在落库前就统一。
export function saveRows(key: string, rows: EntryRow[]): void {
  const snapshot = cache
  const next = { ...allRows(), [key]: normalizeModule(key, rows) }
  cache = next
  if (canUseStorage()) {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
    } catch (error) {
      cache = snapshot
      throw error instanceof Error ? error : new Error('数据写入失败')
    }
  }
}

// 多条一起落库：中途失败撤销本次已经写入的全部键，要么全成、要么回到调用前。
export function saveMany(patch: Record<string, EntryRow[]>): void {
  const snapshot = cache
  const normalized: Record<string, EntryRow[]> = {}
  for (const [key, rows] of Object.entries(patch)) {
    normalized[key] = normalizeModule(key, rows)
  }
  cache = { ...allRows(), ...normalized }
  if (canUseStorage()) {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(cache))
    } catch (error) {
      cache = snapshot
      throw error instanceof Error ? error : new Error('数据写入失败')
    }
  }
}

export function seedRows(key: string): EntryRow[] {
  return normalizeModule(key, clone(SEED_ROWS[key] ?? []))
}

// 恢复初始状态：建筑监测回到样例的同时，把它同源的地表沉降联测部分一并复原，
// 两条入口（准备/恢复）读的都是 seed.json 这一套样例。
export function resetRows(key: string): EntryRow[] {
  if (key === BUILDING_KEY) {
    clearPrepareProgress(BUILDING_KEY)
    saveMany({
      [BUILDING_KEY]: seedRows(BUILDING_KEY),
      [SETTLEMENT_KEY]: seedRows(SETTLEMENT_KEY),
    })
    return listRows(BUILDING_KEY)
  }
  const rows = seedRows(key)
  saveRows(key, rows)
  return rows
}

// ===== 准备入口的续跑水位 =====

function progressKey(moduleKey: string): string {
  return `${PROGRESS_PREFIX}${moduleKey}`
}

export function getPrepareProgress(moduleKey: string): number {
  if (!canUseStorage()) {
    return 0
  }
  const raw = window.localStorage.getItem(progressKey(moduleKey))
  const num = raw === null ? 0 : Number(raw)
  return Number.isFinite(num) && num >= 0 ? Math.floor(num) : 0
}

export function setPrepareProgress(moduleKey: string, index: number): void {
  if (!canUseStorage()) {
    return
  }
  window.localStorage.setItem(progressKey(moduleKey), String(index))
}

export function clearPrepareProgress(moduleKey: string): void {
  if (!canUseStorage()) {
    return
  }
  window.localStorage.removeItem(progressKey(moduleKey))
}

export function storageKey(): string {
  return STORAGE_KEY
}
