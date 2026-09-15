<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import { ElAlert, ElButton, ElCard, ElEmpty, ElOption, ElPagination, ElSelect, ElSkeleton, ElTable, ElTableColumn, ElTabPane, ElTabs, ElTag } from 'element-plus'
import type { TableInstance } from 'element-plus'
import { ArrowRight, BookOpenCheck, CheckCheck, CircleDollarSign, Percent, Plus, RefreshCw } from 'lucide-vue-next'
import { request } from '../reviews/api'
import { practiceMoney, practiceReviewLabel, practiceSide, practiceStats, practiceStatus, practiceStatuses, practiceTime, type PracticeRecord } from '../practice'
import PracticeRecordDetail from './PracticeRecord.vue'
import '../practice.css'
const records = ref<PracticeRecord[]>([]), loading = ref(false), error = ref(''), tab = ref('board')
const currency = ref('USD'), status = ref('all'), reviewStatus = ref('pending'), page = ref(1)
const order = ref<'ascending' | 'descending'>('descending'), table = ref<TableInstance>()
const activeId = ref(''), reviewFirst = ref(false), detail = ref<InstanceType<typeof PracticeRecordDetail>>()
const currencies = computed(() => [...new Set(['USD', ...records.value.map(record => record.currency)])].sort())
const scoped = computed(() => records.value.filter(record => record.currency === currency.value))
const stats = computed(() => practiceStats(scoped.value))
const displayed = computed(() => scoped.value.filter(record => tab.value === 'reviews'
  ? record.status === 'closed' && (reviewStatus.value === 'all' || (reviewStatus.value === 'completed' ? record.review.state === 'completed' : record.review.state !== 'completed'))
  : status.value === 'all' || record.status === status.value).sort((a, b) => {
    const diff = a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id)
    return order.value === 'ascending' ? diff : -diff
  }))
const rows = computed(() => displayed.value.slice((page.value - 1) * 12, page.value * 12))
watch([tab, currency, status, reviewStatus, order], () => { page.value = 1 })
async function load(initial = false) {
  loading.value = true; error.value = ''
  try { records.value = (await request<{ records: PracticeRecord[] }>('/api/practice')).records; if (initial && records.value.length && !records.value.some(record => record.currency === currency.value)) currency.value = records.value[0]!.currency; page.value = Math.min(page.value, Math.max(1, Math.ceil(displayed.value.length / 12))) }
  catch (e) { error.value = (e as Error).message }
  finally { loading.value = false }
}
function remember(record: PracticeRecord) { records.value = [record, ...records.value.filter(item => item.id !== record.id)]; currency.value = record.currency }
function open(id: string, review = false) { if (!loading.value) { activeId.value = id; reviewFirst.value = review; window.scrollTo({ top: 0 }) } }
function back() { activeId.value = ''; page.value = Math.min(page.value, Math.max(1, Math.ceil(displayed.value.length / 12))); window.scrollTo({ top: 0 }) }
async function canLeave() { return !loading.value && (detail.value ? await detail.value.canLeave() : true) }
async function showBoard() { if (await canLeave()) { back(); tab.value = 'board'; await load() } }
function sort({ order: next }: { order: 'ascending' | 'descending' | null }) {
  order.value = next || (order.value === 'ascending' ? 'descending' : 'ascending')
  if (!next) void nextTick(() => table.value?.sort('createdAt', order.value))
}
onMounted(() => load(true))
defineExpose({ canLeave, showBoard })
</script>
<template>
  <PracticeRecordDetail v-if="activeId" ref="detail" :key="activeId" :record-id="activeId === 'new' ? undefined : activeId" :review-first="reviewFirst" @back="back" @saved="remember"/>
  <section v-else class="practice-workspace page-stack">
    <div class="practice-heading"><div><span class="practice-eyebrow">SIMULATION JOURNAL</span><h1>模拟练习</h1><p>在外部工具回放行情，在这里记下分析、交易结果与复盘。</p></div><div class="practice-actions"><ElButton :disabled="loading" @click="load()"><RefreshCw :size="15"/>刷新</ElButton><ElButton type="primary" :disabled="loading" @click="open('new')"><Plus :size="16"/>新建模拟记录</ElButton></div></div>
    <ElAlert v-if="error" :title="error" type="error" show-icon :closable="false"/>
    <ElCard shadow="never" class="practice-tabs-card"><div class="practice-scope"><ElTabs v-model="tab"><ElTabPane name="board" label="看板"/><ElTabPane name="records" label="交易记录"/><ElTabPane name="reviews" label="复盘"/></ElTabs><div><label for="practice-currency">币种范围</label><ElSelect id="practice-currency" v-model="currency" :disabled="loading" aria-label="模拟统计及列表币种范围"><ElOption v-for="code in currencies" :key="code" :value="code" :label="code || '未填币种（仅草稿 / 持仓中）'"/></ElSelect></div></div><p class="practice-hint">当前看板与列表仅包含 {{ currency || '未填币种的' }} 模拟记录，共 {{ scoped.length }} 条。不同币种分别统计，与真实交易数据独立。</p></ElCard>
    <ElSkeleton v-if="loading && !records.length" :rows="8" animated/>
    <template v-else-if="tab === 'board'">
      <div class="practice-stats"><ElCard shadow="never"><CheckCheck :size="22"/><span>已平仓笔数</span><strong>{{ stats.closed }}</strong><small>仅统计明确填写结果的已平仓记录</small></ElCard><ElCard shadow="never"><Percent :size="22"/><span>胜率</span><strong>{{ stats.winRate === null ? '—' : `${stats.winRate.toFixed(1)}%` }}</strong><small>净盈利笔数 / 已平仓笔数</small></ElCard><ElCard shadow="never"><CircleDollarSign :size="22"/><span>累计净盈亏 · {{ currency || '未填币种' }}</span><strong :class="stats.netProfit < 0 ? 'practice-loss' : stats.netProfit > 0 ? 'practice-win' : ''">{{ practiceMoney(stats.netProfit) }}</strong><small>手填净盈亏（含费用）合计</small></ElCard><ElCard shadow="never"><BookOpenCheck :size="22"/><span>待复盘笔数</span><strong>{{ stats.pending }}</strong><small>已平仓且待复盘 / 待补充</small></ElCard></div>
      <ElCard shadow="never"><div class="practice-outcomes"><span>盈利 <strong class="practice-win">{{ stats.wins }}</strong> 笔</span><span>亏损 <strong class="practice-loss">{{ stats.losses }}</strong> 笔</span><span>持平 <strong>{{ stats.even }}</strong> 笔</span><ElButton link type="primary" @click="tab = 'reviews'; reviewStatus = 'pending'">去复盘<ArrowRight :size="15"/></ElButton></div><p class="practice-hint">持平计入胜率分母。草稿和模拟持仓中不计入已实现盈亏或胜率；未填净盈亏不当作 0。</p></ElCard>
      <ElCard v-if="!scoped.length" shadow="never"><ElEmpty description="当前币种还没有模拟记录"><ElButton type="primary" @click="open('new')">直接记录第一笔</ElButton></ElEmpty></ElCard>
      <ElCard v-else shadow="never"><div class="practice-section-head"><div><h2>一次记录，持续补充</h2><p class="practice-hint">先保存草稿，模拟开仓后补充信息，平仓后填写净盈亏并完成复盘。</p></div><ElButton type="primary" plain @click="tab = 'records'">查看交易记录<ArrowRight :size="15"/></ElButton></div></ElCard>
    </template>
    <ElCard v-else shadow="never" class="practice-list-card">
      <template #header><div class="practice-section-head"><h2>{{ tab === 'records' ? '模拟交易记录' : '已平仓模拟复盘' }} <ElTag type="info" size="small">{{ displayed.length }}</ElTag></h2><ElSelect v-if="tab === 'records'" v-model="status" aria-label="模拟记录状态筛选" class="practice-filter"><ElOption label="全部状态" value="all"/><ElOption v-for="s in practiceStatuses" :key="s.value" :label="s.label" :value="s.value"/></ElSelect><ElSelect v-else v-model="reviewStatus" aria-label="模拟复盘状态筛选" class="practice-filter"><ElOption label="待复盘 / 待补充" value="pending"/><ElOption label="已复盘" value="completed"/><ElOption label="全部已平仓" value="all"/></ElSelect></div></template>
      <ElTable v-if="displayed.length" ref="table" :data="rows" row-key="id" :default-sort="{ prop: 'createdAt', order }" @sort-change="sort" @row-click="(row: PracticeRecord) => open(row.id, tab === 'reviews')">
        <ElTableColumn label="品种 / 方向" min-width="160"><template #default="{ row }"><strong>{{ row.symbol || '未填品种' }}</strong><small>{{ practiceSide(row.side) }} · {{ row.timeframe || '未填周期' }}</small></template></ElTableColumn>
        <ElTableColumn label="回放开仓 / 平仓时间" min-width="190"><template #default="{ row }"><span>{{ row.openTime || '未填写' }}</span><small>{{ row.closeTime || '未填写平仓' }}</small></template></ElTableColumn>
        <ElTableColumn label="手填净盈亏" min-width="150" align="right"><template #default="{ row }"><span :class="row.status !== 'closed' ? '' : row.netProfit > 0 ? 'practice-win' : row.netProfit < 0 ? 'practice-loss' : ''">{{ practiceMoney(row.netProfit) }} {{ row.currency }}</span><small v-if="row.status !== 'closed'">未计入已实现盈亏</small></template></ElTableColumn>
        <ElTableColumn prop="createdAt" label="创建时间" min-width="190" sortable="custom" :sort-orders="['descending', 'ascending']"><template #default="{ row }">{{ practiceTime(row.createdAt) }}</template></ElTableColumn>
        <ElTableColumn label="状态" min-width="155" align="center"><template #default="{ row }"><ElTag :type="row.status === 'closed' ? 'success' : row.status === 'open' ? 'warning' : 'info'">{{ practiceStatus(row.status) }}</ElTag><small v-if="row.status === 'closed'">{{ practiceReviewLabel(row.review.state) }}</small></template></ElTableColumn>
        <ElTableColumn label="操作" width="100" align="center" fixed="right"><template #default="{ row }"><ElButton link type="primary" @click.stop="open(row.id, tab === 'reviews')">{{ tab === 'reviews' ? '复盘' : '查看' }}<ArrowRight :size="13"/></ElButton></template></ElTableColumn>
      </ElTable>
      <ElEmpty v-else :description="tab === 'reviews' ? '当前筛选下没有已平仓复盘记录' : '当前筛选下没有模拟记录'"><ElButton type="primary" @click="open('new')">新建模拟记录</ElButton></ElEmpty>
      <ElPagination v-if="displayed.length" v-model:current-page="page" :total="displayed.length" :page-size="12" layout="total, prev, pager, next" class="practice-pagination"/>
    </ElCard>
  </section>
</template>
