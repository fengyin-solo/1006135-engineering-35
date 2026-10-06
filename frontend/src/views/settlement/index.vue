<template>
  <section class="page" data-module="settlement">
    <header class="page-head">
      <div>
        <h2>地表沉降管理</h2>
        <p class="page-desc">维护沉降测点，围绕测点编号、测点位置、初始高程、累计沉降做登记、筛选与状态流转。建筑物测点与建筑监测清单同源。</p>
      </div>
      <div class="page-actions">
        <button class="btn" type="button" @click="exportRows">导出地表沉降清单</button>
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
      <span class="legend-item">建筑监测同源条数：{{ linkedCount }}</span>
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
          <td :colspan="columns.length + 2" class="empty-state">暂无地表沉降数据，可先在建筑监测页点「准备样例」</td>
        </tr>
      </tbody>
    </table>

    <footer class="page-foot">
      <span>共 {{ total }} 条地表沉降记录，其中 {{ linkedCount }} 条与建筑监测同源</span>
      <span v-if="errorMessage" class="error-text">{{ errorMessage }}</span>
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
  runAction as applyAction,
} from '@/api/local-service'
import type { StatCard } from '@/data/stats'
import type { EntryRow } from '@/data/types'

const meta = moduleMeta('settlement')
const columns = meta.fields
const actions = meta.actions
const statuses = meta.statuses

const rows = ref<EntryRow[]>([])
const total = ref(0)
const linkedCount = ref(0)
const stats = ref<StatCard[]>([])
const errorMessage = ref('')
const filters = ref<Record<string, string>>({})
const filterFields = columns.slice(0, 3)
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
    // 卡片数字与建筑监测走同一个统计实现、同一份清单，不分两份。
    stats.value = moduleCards(meta.key)
    linkedCount.value = buildingSettlementSync().linked
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '地表沉降列表读取失败'
  }
}

onMounted(reload)
</script>
