// 存量记录兼容层：本地与容器里历史写法不一致（id 被存成字符串、字段名换过叫法），
// 读取时统一在这里归一化，页面和服务层都拿到同一形状的数据。
// 不丢弃任何记录，只做“补字段、统一类型”，原样写库仍由保存动作负责。
import type { EntryRow } from './types'

export const MODULE_ALIASES: Record<string, Record<string, string>> = {
  building: {
    // 「距隧道距离」旧叫法：存量记录里可能叫这两个，读出来同一栏，不再为空。
    距隧道净距: '距隧道距离',
    隧道净距: '距隧道距离',
    对象编码: '对象编号',
    建筑名称: '建筑物名称',
    允许沉降量: '允许沉降',
    实测沉降量: '实测沉降',
  },
  settlement: {
    测点编码: '测点编号',
    关联监测对象: '关联对象编号',
    建筑物编号: '关联对象编号',
    对象编号: '关联对象编号',
  },
}

const MAX_AUTO_ID = 100000

// 同一存储里 id 类型不一致（本地 number、旧容器里 string）时按顺序归一化：
// 能转成数字的一律转数字；转不出来的用“负的占位序号”兜底，保证动作流转还能定位到行。
// 纯数字字符串（"3"）与数字（3）会被视为同一条，不会再各算各的。
export function normalizeId(value: unknown, index: number): number {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value
  }
  if (typeof value === 'string') {
    const trimmed = value.trim()
    if (/^\d+$/.test(trimmed)) {
      return Number(trimmed)
    }
  }
  return -(MAX_AUTO_ID + index + 1)
}

export function normalizeRow(moduleKey: string, raw: Record<string, unknown>, index: number): EntryRow {
  const aliases = MODULE_ALIASES[moduleKey] ?? {}
  const row: EntryRow = {
    ...(raw as EntryRow),
    id: normalizeId(raw.id, index),
    status: raw.status === undefined || raw.status === null ? '' : String(raw.status),
    pending: Boolean(raw.pending),
    abnormal: Boolean(raw.abnormal),
  }
  for (const [legacy, canonical] of Object.entries(aliases)) {
    const legacyValue = (raw as Record<string, unknown>)[legacy]
    const canonicalValue = (raw as Record<string, unknown>)[canonical]
    const canonicalEmpty =
      canonicalValue === undefined || canonicalValue === null || String(canonicalValue).trim() === ''
    if (legacyValue !== undefined && legacyValue !== null && canonicalEmpty) {
      row[canonical] = typeof legacyValue === 'boolean' ? legacyValue : String(legacyValue)
    }
  }
  if (typeof raw.createdAt === 'string' && raw.createdAt.trim() !== '') {
    row.createdAt = raw.createdAt
  }
  return row
}

export function normalizeModule(moduleKey: string, rows: unknown[]): EntryRow[] {
  return (rows ?? []).map((raw, index) => normalizeRow(moduleKey, (raw ?? {}) as Record<string, unknown>, index))
}
