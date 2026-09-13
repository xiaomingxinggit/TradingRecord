<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import { ElAlert, ElButton, ElCard, ElCheckbox, ElDatePicker, ElEmpty, ElInput, ElMessage, ElOption, ElPagination, ElSelect, ElSkeleton, ElTabPane, ElTabs, ElTag } from 'element-plus'
import { ArrowRight, CheckCheck, ClipboardPenLine, Link2, RefreshCw, Upload } from 'lucide-vue-next'
import { request } from '../reviews/api'
import { reviewLabel, sideLabel, timeLabel, type Board, type ImportResult, type Position } from '../reviews/types'
import ExecutionTable from './ExecutionTable.vue'
import LinkPositionsDialog from './LinkPositionsDialog.vue'
import ReviewDetail from './ReviewDetail.vue'
import '../reviews.css'
const emit = defineEmits<{ openPlan: [id: string, edit: boolean] }>()
const board = ref<Board>({ accounts: [], positions: [], plans: [], counts: { unlinked: 0, pending: 0, completed: 0 } })
const loading = ref(false), importing = ref(false), linking = ref(false), error = ref(''), importResult = ref<ImportResult | null>(null)
const activePlanId = ref(''), tab = ref('unlinked'), page = ref(1), planPage = ref(1)
const symbol = ref(''), sourceId = ref(''), dates = ref<[string, string] | null>(null), showLinked = ref(false)
const selected = ref<Position[]>([]), linkDialog = ref(false), table = ref<InstanceType<typeof ExecutionTable>>()
const fileInput = ref<HTMLInputElement>(), detailRef = ref<InstanceType<typeof ReviewDetail>>()
const busy = computed(() => loading.value || importing.value || linking.value)
const filtered = computed(() => board.value.positions.filter(p => (showLinked.value || !p.link)
  && (!sourceId.value || p.source.id === sourceId.value) && p.symbol.toLowerCase().includes(symbol.value.trim().toLowerCase())
  && (!dates.value || (p.openTime.slice(0, 10) >= dates.value[0] && p.openTime.slice(0, 10) <= dates.value[1]))))
const pagePositions = computed(() => filtered.value.slice((page.value - 1) * 20, page.value * 20))
const queue = computed(() => board.value.plans.filter(p => p.positionCount && (tab.value === 'completed' ? p.review.state === 'completed' : p.review.state !== 'completed')))
const queuePage = computed(() => queue.value.slice((planPage.value - 1) * 12, planPage.value * 12))
watch([symbol, sourceId, dates, showLinked], () => { page.value = 1; clearSelection() })
watch(tab, () => { planPage.value = 1; clearSelection() })
function clearSelection() { selected.value = []; table.value?.clearSelection() }
async function load() {
  loading.value = true; error.value = ''
  try { board.value = await request<Board>('/api/reviews'); clearSelection(); page.value = Math.min(page.value, Math.max(1, Math.ceil(filtered.value.length / 20))); planPage.value = Math.min(planPage.value, Math.max(1, Math.ceil(queue.value.length / 12))) }
  catch (e) { error.value = (e as Error).message }
  finally { loading.value = false }
}
async function importFile(event: Event) {
  const input = event.target as HTMLInputElement, file = input.files?.[0]; input.value = ''
  if (!file || busy.value) return
  if (!/\.(html?|xlsx)$/i.test(file.name)) { error.value = '报告仅支持 HTML、HTM 或 XLSX。'; return }
  if (!file.size || file.size > 25 * 1024 * 1024) { error.value = '请选择非空且不超过 25 MB 的报告。'; return }
  importing.value = true; error.value = ''; importResult.value = null
  try {
    const data = new FormData(); data.append('report', file)
    importResult.value = await request<ImportResult>('/api/reviews/import', { method: 'POST', body: data })
    tab.value = 'unlinked'; await load(); ElMessage.success('报告处理完成，请查看导入结果')
  } catch (e) { error.value = (e as Error).message }
  finally { importing.value = false }
}
async function canLeave() {
  if (busy.value) return false
  if (linkDialog.value) { ElMessage.info('请先完成或关闭关联窗口。'); return false }
  return detailRef.value ? detailRef.value.canLeave() : true
}
async function showReview(id: string) {
  // A cross-page entry may arrive while the board is still loading its choices.
  if ((!activePlanId.value && !linkDialog.value && !importing.value && !linking.value) || await canLeave()) {
    activePlanId.value = id; await nextTick(); window.scrollTo({ top: 0 })
  }
}
async function showBoard() { if (await canLeave()) { activePlanId.value = ''; await load() } }
function backFromDetail() { activePlanId.value = ''; void load() }
async function linked(id: string) { clearSelection(); await load(); activePlanId.value = id; window.scrollTo({ top: 0 }) }
function openLinkDialog() { if (selected.value.length && selected.value.length <= 100 && !busy.value) linkDialog.value = true }
onMounted(load)
defineExpose({ canLeave, showReview, showBoard })
</script>
<template>
  <ReviewDetail v-if="activePlanId" ref="detailRef" :key="activePlanId" :plan-id="activePlanId" :plans="board.plans" @back="backFromDetail" @updated="load" @open-plan="(id, edit) => emit('openPlan', id, edit)"/>
  <section v-else class="review-workspace page-stack">
    <div class="review-heading"><div><span class="review-eyebrow">TRADE REVIEW</span><h1>交易复盘</h1><p>把实际入场关联回计划，让每一笔交易留下经验。</p></div><div class="review-toolbar"><ElButton :disabled="busy" @click="load"><RefreshCw :size="15"/>刷新</ElButton><ElButton type="primary" :loading="importing" :disabled="busy" @click="fileInput?.click()"><Upload v-if="!importing" :size="16"/>导入 MT5 报告</ElButton><input ref="fileInput" hidden type="file" accept=".html,.htm,.xlsx" @change="importFile"/></div></div>
    <ElAlert v-if="error" :title="error" type="error" show-icon :closable="false"/>
    <div class="review-stats"><ElCard shadow="never"><Link2 :size="21"/><span>待关联持仓</span><strong>{{ loading ? '—' : board.counts.unlinked }}</strong><small>尚未归入计划的独立持仓</small></ElCard><ElCard shadow="never"><ClipboardPenLine :size="21"/><span>待复盘计划</span><strong>{{ loading ? '—' : board.counts.pending }}</strong><small>含“有更新待补充”，每份计划计一次</small></ElCard><ElCard shadow="never"><CheckCheck :size="21"/><span>已复盘计划</span><strong>{{ loading ? '—' : board.counts.completed }}</strong><small>当前已完成且仍关联持仓的计划</small></ElCard></div>
    <ElCard v-if="importResult" shadow="never" class="import-result"><template #header><div class="review-section-title"><h2>本次导入结果</h2><ElButton text @click="importResult = null">收起</ElButton></div></template><p>{{ importResult.source.broker }} · {{ importResult.source.server }} · {{ importResult.source.accountNumber }} · {{ importResult.source.currency }}</p><div class="review-result-tags"><ElTag type="success">新增 {{ importResult.added }}</ElTag><ElTag>更新 {{ importResult.updated }}</ElTag><ElTag type="info">重复 {{ importResult.duplicate }}</ElTag><ElTag :type="importResult.conflicts.length ? 'danger' : 'info'">冲突 {{ importResult.conflicts.length }}</ElTag><ElTag type="warning">不完整 {{ importResult.incomplete }}</ElTag></div><p class="review-hint">资金流水 {{ importResult.ignoredCashFlows }} 条已忽略，不计为交易盈亏。已有持仓不会因报告范围缩小而被删除。</p><ul v-if="importResult.warnings.length" class="import-notices"><li v-for="(warning, i) in importResult.warnings" :key="i">{{ warning }}</li></ul><div v-if="importResult.conflicts.length" class="import-conflicts"><p>以下持仓未覆盖原记录：</p><ul><li v-for="(conflict, i) in importResult.conflicts" :key="i">#{{ conflict.ticket }}：{{ conflict.reason }}</li></ul></div></ElCard>
    <ElCard shadow="never" class="review-board-card">
      <ElTabs v-model="tab"><ElTabPane label="待关联交易" name="unlinked"/><ElTabPane label="待复盘" name="pending"/><ElTabPane label="已复盘" name="completed"/></ElTabs>
      <p class="review-hint">看板数量覆盖全部账户，不随下方筛选变化。计划的手动状态与复盘状态各自保存。</p>
      <template v-if="tab === 'unlinked'">
        <div class="review-filters"><ElInput v-model="symbol" placeholder="筛选交易品种" clearable :disabled="busy"/><ElSelect v-model="sourceId" placeholder="全部来源账户" clearable :disabled="busy"><ElOption v-for="a in board.accounts" :key="a.id" :value="a.id" :label="`${a.accountNumber} · ${a.currency} · ${a.server}`"/></ElSelect><ElDatePicker v-model="dates" type="daterange" value-format="YYYY-MM-DD" start-placeholder="开仓开始日期" end-placeholder="结束日期" :disabled="busy"/></div>
        <div class="review-selection-bar"><ElCheckbox v-model="showLinked" :disabled="busy">同时显示已关联持仓</ElCheckbox><div><span>已选 {{ selected.length }} / 100</span><ElButton type="primary" :disabled="busy || !selected.length || selected.length > 100" @click="openLinkDialog">关联到开仓计划<ArrowRight :size="15"/></ElButton></div></div>
        <ElAlert v-if="selected.length > 100" title="单次最多关联 100 个持仓，请减少选择。" type="warning" :closable="false"/>
        <ElSkeleton v-if="loading && !board.positions.length" :rows="6" animated/>
        <template v-else-if="board.positions.length"><ExecutionTable ref="table" :positions="pagePositions" :plans="board.plans" selectable :busy="busy" @selection="rows => selected = rows" @open="showReview"/><ElPagination v-model:current-page="page" :disabled="busy" :page-size="20" :total="filtered.length" layout="total, prev, pager, next" background class="review-pagination"/></template>
        <ElEmpty v-else description="还没有导入持仓"><p class="review-hint">导入注明 Hedge / 对冲模式的 MT5 完整历史报告，支持 HTML、HTM、XLSX，单份 ≤ 25 MB。</p><ElButton type="primary" :disabled="busy" @click="fileInput?.click()">导入第一份报告</ElButton></ElEmpty>
      </template>
      <template v-else><ElEmpty v-if="!queue.length" :description="tab === 'completed' ? '还没有已完成的复盘' : '当前没有待复盘计划'"><p class="review-hint">只有关联了持仓的计划才会进入复盘队列。</p></ElEmpty><div v-else class="review-queue"><ElCard v-for="plan in queuePage" :key="plan.id" shadow="never" class="review-plan-card"><div class="review-section-title"><strong>{{ plan.symbol || '未填品种' }} · {{ sideLabel(plan.side) }}</strong><ElTag :type="plan.review.state === 'completed' ? 'success' : 'warning'">{{ reviewLabel(plan.review.state) }}</ElTag></div><small>计划创建 {{ timeLabel(plan.createdAt) }}</small><p class="review-plan-reason">{{ plan.reason || '未填写入场理由' }}</p><div class="review-section-title"><span>{{ plan.positionCount }} 个关联持仓</span><ElButton link type="primary" :disabled="busy" @click="showReview(plan.id)">{{ tab === 'completed' ? '查看 / 编辑复盘' : '开始复盘' }}<ArrowRight :size="15"/></ElButton></div></ElCard></div><ElPagination v-if="queue.length" v-model:current-page="planPage" :page-size="12" :total="queue.length" layout="total, prev, pager, next" background class="review-pagination"/></template>
    </ElCard>
    <p class="review-hint">导入仅提取报告中的持仓资料，不连接账户、不执行交易。独立“未平仓持仓”分区及仅有订单 / 成交的报告暂不支持。交易时间沿用服务器时间。</p>
    <LinkPositionsDialog v-model="linkDialog" :positions="selected" :plans="board.plans" @busy="value => linking = value" @saved="linked"/>
  </section>
</template>
