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
      <article v-for="item in statsCards" :key="item.label" class="stat-card">
        <span class="stat-label">{{ item.label }}</span>
        <strong class="stat-value">{{ item.value }}</strong>
      </article>
    </div>

    <p class="status-legend">
      <span v-for="item in statusSummary" :key="item.status" class="legend-item">
        {{ item.status }}：{{ item.count }}
      </span>
      <span class="legend-item">当前样品重量口径：{{ weightRuleVersion }}</span>
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
          <td v-for="column in columns" :key="column">{{ displayValue(row, column) }}</td>
          <td>{{ row.status }}</td>
          <td class="row-actions">
            <button class="link" type="button" @click="openDetail(row)">查看详情</button>
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
          <td :colspan="columns.length + 2" class="empty-state">{{ emptyText }}</td>
        </tr>
      </tbody>
    </table>

    <footer class="page-foot">
      <span>共 {{ total }} 条浮选样品记录</span>
      <span v-if="errorMessage" class="error-text">{{ errorMessage }}</span>
    </footer>

    <section class="ledger-block">
      <h3>浮选送检台账</h3>
      <p class="page-desc">浮选样品确认完成后自动回写；重复确认同一样品只保留一条台账。</p>
      <table class="data-table">
        <thead>
          <tr>
            <th v-for="column in ledgerColumns" :key="column">{{ column }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="row in ledgerRows" :key="String(row.id)">
            <td v-for="column in ledgerColumns" :key="column">{{ displayValue(row, column) }}</td>
          </tr>
          <tr v-if="!ledgerRows.length">
            <td :colspan="ledgerColumns.length" class="empty-state">
              送检台账暂无记录：浮选样品还没有出结果，完成「确认完成」后会自动回写到这里
            </td>
          </tr>
        </tbody>
      </table>
    </section>

    <!-- 批量登记弹窗 -->
    <div v-if="creating" class="modal-overlay" @click.self="closeCreate">
      <div class="modal">
        <header class="modal-head">
          <h3>登记浮选样品</h3>
          <button class="link" type="button" @click="closeCreate">关闭</button>
        </header>
        <p class="page-desc">
          样品重量、炭化种子数随每条记录一次写全；逐条即时落库，中断后重新整批提交会自动跳过已登记的样品，从失败处接着走。
        </p>

        <div class="draft-toolbar">
          <button class="btn" type="button" @click="addDraft">添加一行</button>
          <button class="btn ghost" type="button" @click="resetDrafts">清空重填</button>
        </div>

        <table class="data-table draft-table">
          <thead>
            <tr>
              <th>样品编号*</th>
              <th>采样单位</th>
              <th>样品重量*（千克）</th>
              <th>浮选日期</th>
              <th>炭屑含量</th>
              <th>炭化种子数*</th>
              <th>送检去向</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="(draft, index) in drafts" :key="index">
              <td><input v-model="draft.样品编号" placeholder="如 FLOT-0010" /></td>
              <td><input v-model="draft.采样单位" placeholder="采样单位" /></td>
              <td><input v-model="draft.样品重量" inputmode="decimal" placeholder="非负数值" /></td>
              <td><input v-model="draft.浮选日期" type="date" :placeholder="today" /></td>
              <td><input v-model="draft.炭屑含量" placeholder="炭屑含量" /></td>
              <td><input v-model="draft.炭化种子数" inputmode="numeric" placeholder="非负整数" /></td>
              <td><input v-model="draft.送检去向" placeholder="送检去向" /></td>
              <td><button class="link" type="button" @click="removeDraft(index)">删除</button></td>
            </tr>
          </tbody>
        </table>

        <div v-if="batchResult" class="batch-result">
          <p>
            共 {{ batchResult.total }} 条：新增 {{ batchResult.created }} 条，
            已存在跳过 {{ batchResult.existed }} 条，同批重复跳过 {{ batchResult.duplicated }} 条。
          </p>
          <ul v-if="batchResult.items.length" class="result-list">
            <li v-for="item in batchResult.items" :key="item.index">
              <span :class="['result-tag', item.outcome]">{{ outcomeLabel[item.outcome] }}</span>
              第 {{ item.index + 1 }} 行 · {{ item.message }}
            </li>
          </ul>
          <p v-if="!batchResult.ok" class="error-text">
            在第 {{ Number(batchResult.failedIndex) + 1 }} 行中断：已成功的记录不会重录，
            修改该行后重新提交，将从这里继续。
          </p>
        </div>

        <footer class="modal-foot">
          <button class="btn primary" type="button" @click="submitBatch">提交登记</button>
        </footer>
      </div>
    </div>

    <!-- 详情弹窗：与列表读同一份记录 -->
    <div v-if="detail" class="modal-overlay" @click.self="detail = undefined">
      <div class="modal">
        <header class="modal-head">
          <h3>浮选样品详情</h3>
          <button class="link" type="button" @click="detail = undefined">关闭</button>
        </header>
        <dl class="detail-list">
          <template v-for="field in detailFields" :key="field">
            <dt>{{ field }}</dt>
            <dd>{{ displayValue(detail, field) || '（未填写）' }}</dd>
          </template>
          <dt>当前状态</dt>
          <dd>{{ detail.status }}</dd>
        </dl>
        <p class="page-desc">
          样品重量按登记时「{{ displayValue(detail, '重量口径版本') || '历史未标注口径' }}」落库的值显示，口径调整后不重算。
        </p>
      </div>
    </div>

    <!-- 记录找不到时的空态说明弹窗 -->
    <div v-else-if="detailMissing" class="modal-overlay" @click.self="detailMissing = false">
      <div class="modal">
        <header class="modal-head">
          <h3>浮选样品详情</h3>
          <button class="link" type="button" @click="detailMissing = false">关闭</button>
        </header>
        <p class="empty-state">没有可用记录：该浮选样品不存在或已被删除，请回到列表重新选择。</p>
      </div>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

import {
  downloadEntries,
  getEntry,
  listEntries,
  listFlotationLedger,
  moduleMeta,
  registerFlotationBatch,
  runAction as applyAction,
} from '@/api/local-service'
import { fieldText, today, WEIGHT_RULE_VERSION } from '@/data/flotation'
import type { EntryRow, FlotationBatchItem, FlotationDraft } from '@/data/types'

const meta = moduleMeta('flotation')
const columns = ['样品编号', '采样单位', '样品重量', '浮选日期', '炭屑含量', '炭化种子数', '送检去向', '样品状态']
const ledgerColumns = ['台账编号', '样品编号', '采样单位', '样品重量', '重量口径版本', '炭屑含量', '炭化种子数', '送检去向', '完成日期']
const actions = ['提交浮选', '确认完成', '登记废弃']
const statuses = ['待浮选', '浮选中', '已完成', '已废弃']
const weightRuleVersion = WEIGHT_RULE_VERSION

// 列表与详情共用的展示取值：空值统一显示「—」，重量只取落库原值不重算。
function displayValue(row: EntryRow, field: string): string {
  const value = fieldText(row, field)
  return value === '' ? '—' : value
}

const detailFields = [...columns, '重量口径版本']

const rows = ref<EntryRow[]>([])
const ledgerRows = ref<EntryRow[]>([])
const total = ref(0)
const errorMessage = ref('')
const filters = ref<Record<string, string>>({})
const filterFields = columns.slice(0, 3)

const statsCards = computed(() => [
  { label: '待浮选样品', value: rows.value.filter((row) => row.status === '待浮选').length },
  { label: '浮选中样品', value: rows.value.filter((row) => row.status === '浮选中').length },
  { label: '已出结果样品', value: rows.value.filter((row) => row.status === '已完成').length },
])

const statusSummary = computed(() =>
  statuses.map((status: string) => ({
    status,
    count: rows.value.filter((row) => String(row.status) === status).length,
  })),
)

const hasFilter = computed(() =>
  Object.values(filters.value).some((value) => value.trim() !== ''),
)
const emptyText = computed(() =>
  hasFilter.value
    ? '没有符合筛选条件的浮选样品，可调整筛选条件或重置后再查'
    : '暂无浮选样品数据，可先登记浮选样品',
)

function reload() {
  errorMessage.value = ''
  try {
    const payload = listEntries(meta.key, filters.value)
    rows.value = payload.items
    total.value = payload.total
    ledgerRows.value = listFlotationLedger()
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '浮选样品列表读取失败'
  }
}

function resetFilters() {
  filters.value = {}
  reload()
}

function exportRows() {
  downloadEntries(meta.key)
}

// ---- 详情：直接按 id 从同一份存储里取，列表和详情不会两边对不上 ----
const detail = ref<EntryRow | undefined>(undefined)
const detailMissing = ref(false)

function openDetail(row: EntryRow) {
  const found = getEntry(meta.key, Number(row.id))
  if (!found) {
    detail.value = undefined
    detailMissing.value = true
    return
  }
  detail.value = found
  detailMissing.value = false
}

// ---- 批量登记 ----
const creating = ref(false)
const drafts = ref<FlotationDraft[]>([])
const batchResult = ref<ReturnType<typeof registerFlotationBatch> | null>(null)

const outcomeLabel: Record<FlotationBatchItem['outcome'], string> = {
  created: '新增',
  existed: '已存在',
  duplicated: '批内重复',
  failed: '中断',
}

function emptyDraft(): FlotationDraft {
  return {
    样品编号: '',
    采样单位: '',
    样品重量: '',
    浮选日期: today(),
    炭屑含量: '',
    炭化种子数: '',
    送检去向: '',
  }
}

function openCreate() {
  if (!drafts.value.length) {
    drafts.value = [emptyDraft(), emptyDraft(), emptyDraft()]
  }
  batchResult.value = null
  creating.value = true
}

function closeCreate() {
  creating.value = false
}

function addDraft() {
  drafts.value.push(emptyDraft())
}

function removeDraft(index: number) {
  drafts.value.splice(index, 1)
}

function resetDrafts() {
  drafts.value = [emptyDraft(), emptyDraft(), emptyDraft()]
  batchResult.value = null
}

function submitBatch() {
  errorMessage.value = ''
  try {
    batchResult.value = registerFlotationBatch(drafts.value)
    reload()
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '浮选样品登记失败'
  }
}

function runAction(action: string, row: EntryRow) {
  errorMessage.value = ''
  const result = applyAction(meta.key, Number(row.id), action)
  if (!result.ok) {
    errorMessage.value = result.message
    return
  }
  errorMessage.value = result.message
  reload()
}

onMounted(reload)
</script>
