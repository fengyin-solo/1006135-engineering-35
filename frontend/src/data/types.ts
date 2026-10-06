/** 纯前端数据层的公共类型：与全栈版后端返回的结构保持一致，换回后端时页面不用改。 */

export type EntryRow = {
  // 存量数据里 id 可能被存成字符串（"3"），统一在读取层归一化为数字，
  // 但类型上先兼容两种，避免旧数据在归一化前就让页面崩掉。
  id: number | string
  status: string
  pending: boolean
  abnormal: boolean
  // 创建时间：样例与准备结果都带；存量缺这列的记录在准备阶段按顺序回填。
  createdAt?: string
  [field: string]: string | number | boolean | null | undefined
}

export type ModuleMeta = {
  key: string
  name: string
  entity: string
  desc: string
  fields: string[]
  statuses: string[]
  actions: string[]
  actionTargets: Record<string, string>
  metrics: string[]
}

export type PageResult = {
  items: EntryRow[]
  total: number
  page: number
  size: number
}

export type ActionResult = {
  ok: boolean
  message: string
}

export type OverviewResult = {
  cards: { label: string; value: number }[]
  modules: { name: string; created: number; pending: number; abnormal: number }[]
}

// 范围规则：准备阶段（前端）与构建期校验（scripts/check-seed.mjs）共用
// range-rules.json 这一份，规则不再散落在页面或脚本里。
export type RangeRule = {
  min: number
  max: number
  unit?: string
}

export type RangeRules = Record<string, Record<string, RangeRule>>

export type RangeViolation = {
  module: string
  id: number | string
  field: string
  value: string
  rule: RangeRule
  reason: string
}

export type PrepareResult = {
  ok: boolean
  prepared: number
  skipped: number
  backfilled: number
  violations: RangeViolation[]
  message: string
}
