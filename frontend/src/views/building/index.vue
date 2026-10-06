<template>
  <section class="page" data-module="building">
    <header class="page-head">
      <div>
        <h2>建筑监测管理</h2>
        <p class="page-desc">维护监测对象，围绕对象编号、建筑物名称、结构类型、距隧道距离做登记、筛选与状态流转。</p>
      </div>
      <div class="page-actions">
        <button class="btn primary" type="button" @click="prepareSamples">准备样例</button>
        <button class="btn" type="button" @click="restoreSamples">恢复初始状态</button>
        <button class="btn" type="button" @click="exportRows">导出建筑监测清单</button>
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
      <span class="legend-item">地表沉降同源条数：{{ linkedCount }}</span>
    </p>

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
          <td :colspan="columns.length + 2" class="empty-state">暂无建筑监测数据，可先点「准备样例」灌入</td>
        </tr>
      </tbody>
    </table>

    <footer class="page-foot">
      <span>共 {{ total }} 条建筑监测记录，地表沉降同源 {{ linkedCount }} 条</span>
      <span v-if="message" :class="messageOk ? 'ok-text' : 'error-text'">{{ message }}</span>
    </footer>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

import {
  buildingSettlementSync,
  downloadEntries,
  listEntries,
  moduleCards,
  moduleMeta,
  prepareBuilding,
  resetBuilding,
  runAction as applyAction,
} from '@/api/local-service'
import type { StatCard } from '@/data/stats'
import type { EntryRow } from '@/data/types'

const meta = moduleMeta('building')
const columns = meta.fields
const actions = meta.actions
const statuses = meta.statuses

const rows = ref<EntryRow[]>([])
const total = ref(0)
const linkedCount = ref(0)
const stats = ref<StatCard[]>([])
const message = ref('')
const messageOk = ref(true)
const filters = ref<Record<string, string>>({})
const filterFields = columns.slice(0, 3)
const statusSummary = computed(() =>
  statuses.map((status: string) => ({
    status,
    count: rows.value.filter((row) => String(row.status) === status).length,
  })),
)

function notify(text: string, ok = true) {
  message.value = text
  messageOk.value = ok
}

function resetFilters() {
  filters.value = {}
  reload()
}

function exportRows() {
  downloadEntries(meta.key)
}

// 准备入口：幂等、可续跑；越限记录会在结果里带出来，存量缺字段会被回填。
function prepareSamples() {
  try {
    const result = prepareBuilding()
    notify(result.message, result.ok)
  } catch (error) {
    notify(error instanceof Error ? error.message : '样例准备失败', false)
  }
  reload()
}

// 恢复入口：与准备读同一套样例，建筑监测与地表沉降一起回到初始状态。
function restoreSamples() {
  try {
    resetBuilding()
    notify('已恢复为初始样例，建筑监测与地表沉降两处同步复原')
  } catch (error) {
    notify(error instanceof Error ? error.message : '恢复初始状态失败', false)
  }
  reload()
}

function runAction(action: string, row: EntryRow) {
  message.value = ''
  const result = applyAction(meta.key, Number(row.id), action)
  if (!result.ok) {
    notify(result.message, false)
    return
  }
  reload()
}

function reload() {
  message.value = ''
  try {
    const payload = listEntries(meta.key, filters.value)
    rows.value = payload.items
    total.value = payload.total
    stats.value = moduleCards(meta.key)
    linkedCount.value = buildingSettlementSync().linked
  } catch (error) {
    notify(error instanceof Error ? error.message : '建筑监测列表读取失败', false)
  }
}

onMounted(reload)
</script>
