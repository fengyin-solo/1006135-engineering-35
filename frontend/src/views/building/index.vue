<template>
  <section class="page" data-module="building">
    <header class="page-head">
      <div>
        <h2>建筑监测管理</h2>
        <p class="page-desc">维护监测对象，围绕对象编号、建筑物名称、结构类型、距隧道距离做登记、筛选与状态流转。</p>
      </div>
      <div class="page-actions">
        <button class="btn primary" type="button" @click="openCreate">登记监测对象</button>
        <button class="btn" type="button" @click="exportRows">导出建筑监测清单</button>
        <button class="btn ghost" type="button" @click="prepareSamples">灌入样例</button>
        <button class="btn ghost" type="button" @click="restoreSamples">恢复初始样例</button>
      </div>
    </header>

    <div class="stat-row">
      <article v-for="item in stats" :key="item.label" class="stat-card">
        <span class="stat-label">{{ item.label }}</span>
        <strong class="stat-value">{{ item.value }}</strong>
      </article>
    </div>

    <p class="status-legend">
      <span v-for="item in statusSummary" :key="item.status" class="legend-item">
        {{ item.status }}：{{ item.count }}
      </span>
    </p>

    <form v-if="creating" class="filter-bar" @submit.prevent="submitCreate">
      <label v-for="field in formFields" :key="field" class="filter-item">
        <span>{{ field }}</span>
        <input v-model="form[field]" :placeholder="`请输入${field}`" />
      </label>
      <button class="btn primary" type="submit">提交登记</button>
      <button class="btn ghost" type="button" @click="creating = false">取消</button>
    </form>

    <form class="filter-bar" @submit.prevent="reload">
      <label v-for="field in filterFields" :key="field" class="filter-item">
        <span>{{ field }}</span>
        <input v-model="filters[field]" :placeholder="`按${field}检索`" />
      </label>
      <button class="btn" type="submit">查询</button>
      <button class="btn ghost" type="button" @click="resetFilters">重置条件</button>
    </form>

    <table class="data-table">
      <thead>
        <tr>
          <th v-for="column in columns" :key="column">{{ column }}</th>
          <th>当前状态</th>
          <th>可执行动作</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in rows" :key="String(row.id)">
          <td v-for="column in columns" :key="column">{{ row[column] ?? '—' }}</td>
          <td>{{ row.status }}</td>
          <td class="row-actions">
            <button
              v-for="action in actions"
              :key="action"
              class="link"
              type="button"
              @click="runAction(action, row)"
            >
              {{ action }}
            </button>
          </td>
        </tr>
        <tr v-if="!rows.length">
          <td :colspan="columns.length + 2" class="empty-state">暂无建筑监测数据，可先登记监测对象</td>
        </tr>
      </tbody>
    </table>

    <footer class="page-foot">
      <span>共 {{ total }} 条建筑监测记录，地表沉降清单 {{ settlementCount }} 条（两处同源）</span>
      <span v-if="errorMessage" class="error-text">{{ errorMessage }}</span>
    </footer>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

import {
  createBuildingEntry,
  downloadEntries,
  listEntries,
  moduleMeta,
  moduleStats,
  prepareModuleSamples,
  resetAllModules,
  runAction as applyAction,
} from '@/api/local-service'
import { listRows } from '@/data/local-store'
import type { EntryRow } from '@/data/types'

const meta = moduleMeta('building')
const columns = ["对象编号", "建筑物名称", "结构类型", "距隧道距离", "允许沉降", "实测沉降", "监测频次", "监测状态"]
const actions = ["布设测点", "发布报警", "解除报警"]
const statuses = ["待布点", "监测中", "已报警", "已解除"]
// 登记时可填的字段（监测状态由状态动作维护，不在这里直接写）
const formFields = ["对象编号", "建筑物名称", "结构类型", "距隧道距离", "允许沉降", "实测沉降", "监测频次"]

const rows = ref<EntryRow[]>([])
const total = ref(0)
const errorMessage = ref('')
const filters = ref<Record<string, string>>({})
const filterFields = columns.slice(0, 3)
const creating = ref(false)
const form = ref<Record<string, string>>({})

// 指标与状态统计都从数据层实时算，不再在页面写死一份数字。
const stats = ref<{ label: string; value: number }[]>([])
const settlementCount = ref(0)
const statusSummary = computed(() =>
  statuses.map((status: string) => ({
    status,
    count: rows.value.filter((row) => String(row.status) === status).length,
  })),
)

function resetFilters() {
  filters.value = {}
  reload()
}

function exportRows() {
  downloadEntries(meta.key)
}

function openCreate() {
  errorMessage.value = ''
  form.value = { 监测频次: '1次/日' }
  creating.value = true
}

function submitCreate() {
  errorMessage.value = ''
  // 同一条重复递两次只记一次、越限即报、写库失败就地撤销，都在服务层收口。
  const result = createBuildingEntry({
    status: '待布点',
    pending: true,
    abnormal: false,
    监测状态: '待布点',
    ...form.value,
  } as unknown as Omit<EntryRow, 'id'>)
  if (!result.ok) {
    errorMessage.value = result.message
    return
  }
  creating.value = false
  reload()
}

function prepareSamples() {
  const result = prepareModuleSamples()
  errorMessage.value = result.ok ? result.message : result.message
  reload()
}

function restoreSamples() {
  const result = resetAllModules()
  errorMessage.value = result.message
  reload()
}

function runAction(action: string, row: EntryRow) {
  errorMessage.value = ''
  const result = applyAction(meta.key, Number(row.id), action)
  if (!result.ok) {
    errorMessage.value = result.message
    return
  }
  reload()
}

function reload() {
  errorMessage.value = ''
  try {
    const payload = listEntries(meta.key, filters.value)
    rows.value = payload.items
    total.value = payload.total
    stats.value = moduleStats(meta.key)
    settlementCount.value = listRows('settlement').length
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '建筑监测列表读取失败'
  }
}

onMounted(reload)
</script>
