<template>
  <section class="page" data-module="flotation">
    <header class="page-head">
      <div>
        <h2>浮选样品管理</h2>
        <p class="page-desc">维护浮选样品，围绕样品编号、采样单位、样品重量、浮选日期做登记、筛选与状态流转。</p>
      </div>
      <div class="page-actions">
        <button class="btn primary" type="button" @click="openCreate">登记浮选样品</button>
        <button class="btn" type="button" @click="exportRows">导出浮选样品清单</button>
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

    <form class="filter-bar" @submit.prevent="reload">
      <label v-for="field in filterFields" :key="field" class="filter-item">
        <span>{{ field }}</span>
        <input v-model="filters[field]" :placeholder="`按${field}检索`" />
      </label>
      <button class="btn" type="submit">查询</button>
      <button class="btn ghost" type="button" @click="resetFilters">重置条件</button>
    </form>

    <table class="data-table clickable">
      <thead>
        <tr>
          <th v-for="column in columns" :key="column">{{ column }}</th>
          <th>当前状态</th>
          <th>可执行动作</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in rows" :key="String(row.id)" @click="openDetail(row)">
          <td v-for="column in columns" :key="column">{{ displayCell(row, column) }}</td>
          <td>{{ row.status }}</td>
          <td class="row-actions">
            <button
              v-for="action in actions"
              :key="action"
              class="link"
              type="button"
              @click.stop="runAction(action, row)"
            >
              {{ action }}
            </button>
          </td>
        </tr>
        <tr v-if="!rows.length">
          <td :colspan="columns.length + 2" class="empty-state">
            <template v-if="totalAll === 0">
              暂无浮选样品记录：点击右上角「登记浮选样品」批量录入，样品重量与炭化种子数会随每条记录一次写全并保存。
            </template>
            <template v-else>
              当前筛选条件下没有匹配的浮选样品（库内共 {{ totalAll }} 条），可点「重置条件」查看全部。
            </template>
          </td>
        </tr>
      </tbody>
    </table>

    <footer class="page-foot">
      <span>共 {{ total }} 条浮选样品记录</span>
      <span v-if="infoMessage" class="info-text">{{ infoMessage }}</span>
      <span v-if="errorMessage" class="error-text">{{ errorMessage }}</span>
    </footer>

    <!-- 样品详情：按 id 从列表同一份数据里取，两处不会各存一份 -->
    <div v-if="detail" class="modal-mask" @click.self="closeDetail">
      <div class="modal-panel">
        <header class="modal-head">
          <h3>浮选样品详情 · {{ detail['样品编号'] }}</h3>
          <button class="btn ghost" type="button" @click="closeDetail">关闭</button>
        </header>
        <dl class="detail-grid">
          <template v-for="column in columns" :key="column">
            <dt>{{ column }}</dt>
            <dd>{{ displayCell(detail, column) }}</dd>
          </template>
          <dt>当前状态</dt>
          <dd>{{ detail.status }}</dd>
        </dl>
        <p class="caliber-note">{{ weightNote }}</p>
      </div>
    </div>

    <!-- 批量登记：逐条落库，中断后从失败那条接着走 -->
    <div v-if="dialogOpen" class="modal-mask" @click.self="closeCreate">
      <div class="modal-panel wide">
        <header class="modal-head">
          <h3>登记浮选样品（当前重量口径：{{ caliberText }}）</h3>
          <button class="btn ghost" type="button" @click="closeCreate">关闭</button>
        </header>
        <p class="modal-desc">
          样品重量、炭化种子数随每条记录一次写全；每条落库成功再写下一条，中断后从失败那条接着登记，已成功的不会重来；同一份样品编号重复提交只落一条。
        </p>
        <p v-if="resumed" class="info-text">已恢复上次未完成的登记批次，已落库的记录不会重复写入。</p>
        <table class="data-table draft-table">
          <thead>
            <tr>
              <th>#</th>
              <th v-for="field in draftFields" :key="field.name">
                {{ field.label }}<em v-if="field.required">*</em>
              </th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="(draft, index) in drafts"
              :key="index"
              :class="{ 'row-error': index === failedIndex }"
            >
              <td>{{ index + 1 }}</td>
              <td v-for="field in draftFields" :key="field.name">
                <input v-model="draft[field.name]" :placeholder="field.placeholder" />
              </td>
              <td>
                <button class="link" type="button" @click="removeDraft(index)">移除</button>
              </td>
            </tr>
            <tr v-if="!drafts.length">
              <td :colspan="draftFields.length + 2" class="empty-state">
                登记批次为空：点击下方「添加一条」录入样品
              </td>
            </tr>
          </tbody>
        </table>
        <footer class="modal-foot">
          <button class="btn" type="button" @click="addDraft">添加一条</button>
          <span v-if="batchMessage" class="error-text">{{ batchMessage }}</span>
          <button class="btn primary" type="button" @click="submitBatch">
            {{ failedIndex >= 0 ? '从失败条目继续登记' : '提交登记' }}
          </button>
        </footer>
      </div>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'

import {
  blankFlotationDraft,
  clearFlotationDrafts,
  describeFlotationWeight,
  downloadEntries,
  flotationWeightCaliber,
  getEntry,
  listEntries,
  loadFlotationDrafts,
  moduleMeta,
  registerFlotationBatch,
  runAction as applyAction,
  saveFlotationDrafts,
} from '@/api/local-service'
import type { FlotationDraft } from '@/api/local-service'
import type { EntryRow } from '@/data/types'

const meta = moduleMeta('flotation')
const columns = ["样品编号", "采样单位", "样品重量", "重量口径", "浮选日期", "炭屑含量", "炭化种子数", "送检去向", "样品状态"]
const actions = ["提交浮选", "确认完成", "登记废弃"]
const statuses = ["待浮选", "浮选中", "已完成", "已废弃"]

const rows = ref<EntryRow[]>([])
const allRowsCache = ref<EntryRow[]>([])
const total = ref(0)
const totalAll = ref(0)
const errorMessage = ref('')
const infoMessage = ref('')
const filters = ref<Record<string, string>>({})
const filterFields = columns.slice(0, 3)

function countStatus(status: string): number {
  return allRowsCache.value.filter((row) => String(row.status) === status).length
}

const stats = computed(() => [
  { label: '待浮选样品', value: countStatus('待浮选') },
  { label: '浮选中样品', value: countStatus('浮选中') },
  { label: '已出结果样品', value: countStatus('已完成') },
])
const statusSummary = computed(() =>
  statuses.map((status: string) => ({
    status,
    count: countStatus(status),
  })),
)

function displayCell(row: EntryRow, column: string): string {
  const value = row[column]
  if (value === undefined || value === null || value === '') {
    return column === '重量口径' ? '未记录口径' : '—'
  }
  if (column === '样品重量') {
    return `${value} kg`
  }
  return String(value)
}

// 详情与列表取同一份本地数据：按 id 重新取，不另存副本
const detail = ref<EntryRow | null>(null)
const weightNote = computed(() => (detail.value ? describeFlotationWeight(detail.value) : ''))

function openDetail(row: EntryRow) {
  const found = getEntry(meta.key, Number(row.id))
  if (!found) {
    errorMessage.value = '未找到该样品记录，可能已被移除'
    return
  }
  detail.value = found
}

function closeDetail() {
  detail.value = null
}

// 批量登记
type DraftField = {
  name: keyof FlotationDraft
  label: string
  required: boolean
  placeholder: string
}

const draftFields: DraftField[] = [
  { name: '样品编号', label: '样品编号', required: true, placeholder: '如 FLOT-0004' },
  { name: '采样单位', label: '采样单位', required: false, placeholder: '如 T0101③层' },
  { name: '样品重量', label: '样品重量(kg)', required: true, placeholder: '如 18.5' },
  { name: '浮选日期', label: '浮选日期', required: false, placeholder: '如 2026-10-02' },
  { name: '炭屑含量', label: '炭屑含量', required: false, placeholder: '如 丰富 / 中等 / 少量' },
  { name: '炭化种子数', label: '炭化种子数', required: true, placeholder: '如 128' },
  { name: '送检去向', label: '送检去向', required: false, placeholder: '如 省考古院植物考古实验室' },
]

const caliber = flotationWeightCaliber()
const caliberText = `${caliber.version}·${caliber.name}（${caliber.desc}）`

const dialogOpen = ref(false)
const drafts = ref<FlotationDraft[]>([])
const failedIndex = ref(-1)
const batchMessage = ref('')
const resumed = ref(false)

// 登记中的批次随时暂存本地：刷新或误关页面后打开登记框能接着填
watch(
  drafts,
  (value) => {
    if (dialogOpen.value) {
      saveFlotationDrafts(value)
    }
  },
  { deep: true },
)

function openCreate() {
  errorMessage.value = ''
  infoMessage.value = ''
  const restored = loadFlotationDrafts()
  drafts.value = restored ?? [blankFlotationDraft()]
  resumed.value = restored !== null
  failedIndex.value = -1
  batchMessage.value = ''
  dialogOpen.value = true
}

function closeCreate() {
  dialogOpen.value = false
}

function addDraft() {
  drafts.value.push(blankFlotationDraft())
}

function removeDraft(index: number) {
  drafts.value.splice(index, 1)
  if (failedIndex.value === index) {
    failedIndex.value = -1
  }
}

function submitBatch() {
  batchMessage.value = ''
  if (!drafts.value.length) {
    batchMessage.value = '登记批次为空，请先添加样品'
    return
  }
  const result = registerFlotationBatch(drafts.value)
  if (!result.ok && result.failure) {
    failedIndex.value = result.failure.index
    const done = result.added + result.merged + result.skipped
    const failedNo = drafts.value[result.failure.index].样品编号 || '未填编号'
    batchMessage.value = `第 ${result.failure.index + 1} 条「${failedNo}」未落库：${result.failure.reason}。已成功的 ${done} 条已保存，修正后点「从失败条目继续登记」即可，不会重复写入。`
    return
  }
  clearFlotationDrafts()
  dialogOpen.value = false
  failedIndex.value = -1
  infoMessage.value = `登记完成：新增 ${result.added} 条，合并重复 ${result.merged} 条，跳过相同 ${result.skipped} 条`
  reload()
}

function resetFilters() {
  filters.value = {}
  reload()
}

function exportRows() {
  downloadEntries(meta.key)
}

function runAction(action: string, row: EntryRow) {
  errorMessage.value = ''
  infoMessage.value = ''
  const result = applyAction(meta.key, Number(row.id), action)
  if (!result.ok) {
    errorMessage.value = result.message
    return
  }
  infoMessage.value = result.message
  reload()
}

function reload() {
  errorMessage.value = ''
  try {
    allRowsCache.value = listEntries(meta.key).items
    totalAll.value = allRowsCache.value.length
    const payload = listEntries(meta.key, filters.value)
    rows.value = payload.items
    total.value = payload.total
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '浮选样品列表读取失败'
  }
}

onMounted(reload)
</script>
