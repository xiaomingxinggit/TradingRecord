<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { ElAlert, ElButton, ElCard, ElDescriptions, ElDescriptionsItem, ElDialog, ElEmpty, ElForm, ElFormItem, ElImage, ElInput, ElMessage, ElMessageBox, ElOption, ElRadioButton, ElRadioGroup, ElSelect, ElSkeleton, ElTag } from 'element-plus'
import { ArrowLeft, Check, Pencil, RefreshCw, Save } from 'lucide-vue-next'
import { statusInfo } from '../plan-status'
import { ApiError, jsonBody, request } from '../reviews/api'
import { adherenceOptions, amount, purposes, reviewLabel, sideLabel, timeLabel, type Adherence, type Position, type Purpose, type QueuePlan, type ReviewDetailData, type Summary } from '../reviews/types'
import ExecutionTable from './ExecutionTable.vue'
import LinkPositionsDialog from './LinkPositionsDialog.vue'
const props = defineProps<{ planId: string; plans: QueuePlan[] }>()
const emit = defineEmits<{ back: []; updated: []; openPlan: [id: string, edit: boolean] }>()
const detail = ref<ReviewDetailData | null>(null), loading = ref(false), saving = ref(false), mutating = ref(false), confirming = ref(false)
const error = ref(''), stale = ref(false), baseline = ref(''), expectedRevision = ref(0)
const form = ref<{ adherence: Adherence; good: string; improve: string }>({ adherence: 'unrated', good: '', improve: '' })
const editDialog = ref(false), moveDialog = ref(false), selected = ref<Position | null>(null)
const linkForm = ref<{ purpose: Purpose; note: string }>({ purpose: 'unclassified', note: '' }), linkError = ref('')
const busy = computed(() => loading.value || saving.value || mutating.value || confirming.value)
const dirty = computed(() => !!detail.value && JSON.stringify(form.value) !== baseline.value)
const markets: Record<string, string> = { uptrend: '上涨趋势', downtrend: '下跌趋势', range: '震荡', uncertain: '不确定' }
const summaryFields = (r: Summary) => ({ adherence: r.adherence, good: r.good, improve: r.improve })
async function load(preserve = false) {
  loading.value = true; error.value = ''
  try {
    const next = await request<ReviewDetailData>(`/api/reviews/plans/${encodeURIComponent(props.planId)}`)
    const previousSummary = detail.value ? JSON.stringify(summaryFields(detail.value.review)) : ''
    const nextSummary = JSON.stringify(summaryFields(next.review))
    if (preserve && dirty.value) {
      if (previousSummary !== nextSummary) { stale.value = true; error.value = '其他页面修改了复盘总结。当前输入仍保留，请刷新并核对最新版本后再保存。' }
      else if (!stale.value) expectedRevision.value = next.review.revision
    } else {
      form.value = summaryFields(next.review); baseline.value = JSON.stringify(form.value)
      expectedRevision.value = next.review.revision; stale.value = false
    }
    detail.value = next
  } catch (e) { error.value = (e as Error).message; if (preserve) stale.value = true }
  finally { loading.value = false }
}
async function confirmDiscard() {
  if (!dirty.value) return true
  if (confirming.value) return false
  confirming.value = true
  try { await ElMessageBox.confirm('当前复盘文字尚未保存。继续将丢弃这些修改。', '离开复盘编辑', { confirmButtonText: '丢弃修改并继续', cancelButtonText: '继续编辑', type: 'warning' }); return true }
  catch { return false }
  finally { confirming.value = false }
}
async function canLeave() {
  if (busy.value) return false
  if (editDialog.value || moveDialog.value) { ElMessage.info('请先完成或关闭当前关联窗口。'); return false }
  return confirmDiscard()
}
async function refresh() { if (!busy.value && await confirmDiscard()) await load() }
async function back() { if (await canLeave()) emit('back') }
async function save(state: 'draft' | 'completed') {
  if (busy.value || !detail.value || stale.value) return
  if (state === 'completed' && (!form.value.good.trim() && !form.value.improve.trim())) { error.value = '完成复盘前，请至少填写一项文字总结。'; return }
  saving.value = true; error.value = ''
  try {
    const result = await request<{ review: Summary }>(`/api/reviews/plans/${encodeURIComponent(props.planId)}/summary`, jsonBody('PUT', { ...form.value, state, expectedRevision: expectedRevision.value }))
    detail.value.review = result.review; form.value = summaryFields(result.review); baseline.value = JSON.stringify(form.value); expectedRevision.value = result.review.revision
    ElMessage.success(state === 'completed' ? '复盘已完成' : '复盘草稿已保存'); emit('updated')
  } catch (e) { error.value = (e as Error).message; if (e instanceof ApiError && e.status === 409) stale.value = true }
  finally { saving.value = false }
}
function editLink(p: Position) { if (!busy.value && p.link) { selected.value = p; linkForm.value = { purpose: p.link.purpose, note: p.link.note }; linkError.value = ''; editDialog.value = true } }
function move(p: Position) { if (!busy.value) { selected.value = p; moveDialog.value = true } }
function closeEdit(done?: () => void) { if (!mutating.value) { if (done) done(); else editDialog.value = false } }
async function saveLink() {
  if (!selected.value || busy.value) return
  mutating.value = true; linkError.value = ''
  try {
    await request(`/api/reviews/links/${encodeURIComponent(selected.value.id)}`, jsonBody('PATCH', { ...linkForm.value, planId: props.planId }))
    editDialog.value = false; await load(true); emit('updated'); ElMessage.success('关联信息已保存')
  } catch (e) { linkError.value = (e as Error).message }
  finally { mutating.value = false }
}
async function unlink(p: Position) {
  if (busy.value) return
  confirming.value = true
  try { await ElMessageBox.confirm(`解除 ${p.symbol} #${p.ticket} 与本计划的关联？持仓会回到待关联列表，原复盘文字保留。`, '解除关联', { confirmButtonText: '解除关联', cancelButtonText: '取消', type: 'warning' }) }
  catch { confirming.value = false; return }
  confirming.value = false; mutating.value = true; error.value = ''
  try { await request(`/api/reviews/links/${encodeURIComponent(p.id)}`, jsonBody('DELETE', { planId: props.planId })); await load(true); emit('updated'); ElMessage.success('已解除关联') }
  catch (e) { error.value = (e as Error).message }
  finally { mutating.value = false }
}
async function moved() { await load(true); emit('updated'); ElMessage.success('已更换关联计划') }
function beforeUnload(event: BeforeUnloadEvent) { if (dirty.value || busy.value) { event.preventDefault(); event.returnValue = '' } }
watch(() => props.planId, () => { detail.value = null; void load() }, { immediate: true })
onMounted(() => window.addEventListener('beforeunload', beforeUnload))
onBeforeUnmount(() => window.removeEventListener('beforeunload', beforeUnload))
defineExpose({ canLeave })
</script>
<template>
  <section class="review-detail page-stack">
    <div class="review-heading"><div><ElButton link :disabled="busy" @click="back"><ArrowLeft :size="16"/>返回交易复盘</ElButton><h1>计划复盘 <ElTag v-if="detail" :type="detail.review.state === 'completed' ? 'success' : 'warning'">{{ reviewLabel(detail.review.state) }}</ElTag></h1><p>回看原计划、核对实际执行，再留下下一次的改进。</p></div><ElButton :disabled="busy" @click="refresh"><RefreshCw :size="15"/>刷新资料</ElButton></div>
    <ElAlert v-if="error" :title="error" type="error" show-icon :closable="false"/>
    <ElSkeleton v-if="loading && !detail" :rows="10" animated/>
    <template v-if="detail">
      <ElAlert v-if="detail.review.state === 'needs_update'" title="有更新待补充：关联或实际执行资料已变化，原总结已保留，请核对后重新完成复盘。" type="warning" :closable="false" show-icon/>
      <ElCard shadow="never"><template #header><div class="review-section-title"><h2>01 · 原开仓计划</h2><ElButton link type="primary" :disabled="busy" @click="emit('openPlan', planId, true)"><Pencil :size="14"/>编辑原计划</ElButton></div></template>
        <div class="review-plan-title"><strong>{{ detail.plan.symbol || '未填品种' }}</strong><ElTag>{{ sideLabel(detail.plan.side) }}</ElTag><ElTag type="info">{{ statusInfo(detail.plan.status).label }}</ElTag><span>{{ timeLabel(detail.plan.createdAt) }}</span></div>
        <ElDescriptions :column="2" border class="review-original-fields"><ElDescriptionsItem label="分析周期">{{ detail.plan.timeframe || '未填写' }}</ElDescriptionsItem><ElDescriptionsItem label="市场状态">{{ markets[detail.plan.marketState] || '未填写' }}</ElDescriptionsItem><ElDescriptionsItem label="计划入场价">{{ amount(detail.plan.entryPrice) }}</ElDescriptionsItem><ElDescriptionsItem label="计划止损 / 止盈">{{ amount(detail.plan.stopLoss) }} / {{ amount(detail.plan.takeProfit) }}</ElDescriptionsItem><ElDescriptionsItem label="关键结构" :span="2"><span class="preserve-text">{{ detail.plan.keyStructure || '未填写' }}</span></ElDescriptionsItem><ElDescriptionsItem label="入场理由" :span="2"><span class="preserve-text">{{ detail.plan.reason || '未填写' }}</span></ElDescriptionsItem></ElDescriptions>
        <div v-if="detail.plan.images.length" class="review-images"><ElImage v-for="(image, index) in detail.plan.images" :key="image.id" :src="image.url" :alt="image.name" fit="cover" :preview-src-list="detail.plan.images.map(i => i.url)" :initial-index="index" preview-teleported/></div>
      </ElCard>
      <ElCard shadow="never"><template #header><div class="review-section-title"><h2>02 · 实际执行</h2><ElTag type="info">{{ detail.positions.length }} 个独立持仓</ElTag></div></template>
        <p class="review-hint">按账户和币种分别统计。未平仓或信息不完整的持仓不计入已实现净额；报告 SL / TP 不代表最初设置。</p>
        <div v-if="detail.totals.length" class="review-totals"><div v-for="total in detail.totals" :key="total.source.id" class="review-total"><small>{{ total.source.accountNumber }} · {{ total.source.currency }} · {{ total.source.server }}</small><strong>{{ amount(total.netProfit) }} <small>{{ total.source.currency }}</small></strong><span>{{ total.closed }} 个完整平仓 · {{ total.open }} 个未平仓 · {{ total.incomplete }} 个不完整</span></div></div>
        <ExecutionTable v-if="detail.positions.length" :positions="detail.positions" editable :busy="busy" @edit="editLink" @unlink="unlink" @move="move"/>
        <ElEmpty v-else description="尚未关联持仓。请从待关联交易中选择持仓并关联本计划。"/>
      </ElCard>
      <ElCard shadow="never"><template #header><div class="review-section-title"><h2>03 · 复盘总结</h2><span v-if="detail.review.completedAt" class="review-hint">上次完成 {{ timeLabel(detail.review.completedAt) }}</span></div></template>
        <ElForm label-position="top" :disabled="busy">
          <ElFormItem label="是否遵守原计划"><ElRadioGroup v-model="form.adherence"><ElRadioButton v-for="option in adherenceOptions" :key="option.value" :value="option.value">{{ option.label }}</ElRadioButton></ElRadioGroup></ElFormItem>
          <div class="review-summary-grid"><ElFormItem label="做得好的地方"><ElInput v-model="form.good" type="textarea" :rows="6" maxlength="5000" show-word-limit placeholder="哪些判断和执行值得保留？"/></ElFormItem><ElFormItem label="下次改进"><ElInput v-model="form.improve" type="textarea" :rows="6" maxlength="5000" show-word-limit placeholder="下一次遇到相同情况，准备怎样做？"/></ElFormItem></div>
          <div class="review-save-bar"><span class="review-hint">{{ dirty ? '有未保存的修改。' : '已显示保存版本。' }}完成复盘至少填写一项文字总结。</span><div><ElButton :loading="saving" :disabled="busy || stale" @click="save('draft')"><Save :size="15"/>保存草稿</ElButton><ElButton type="primary" :loading="saving" :disabled="busy || stale || !detail.positions.length" @click="save('completed')"><Check :size="16"/>{{ detail.review.state === 'completed' ? '保存并保持已复盘' : '完成复盘' }}</ElButton></div></div>
        </ElForm>
      </ElCard>
    </template>
    <ElDialog v-model="editDialog" title="持仓用途与关联备注" width="min(520px, calc(100vw - 32px))" :before-close="closeEdit" :close-on-click-modal="false" :close-on-press-escape="!mutating" :show-close="!mutating">
      <ElAlert v-if="linkError" :title="linkError" type="error" :closable="false"/>
      <ElForm label-position="top" :disabled="mutating"><ElFormItem label="用途"><ElSelect v-model="linkForm.purpose"><ElOption v-for="p in purposes" :key="p.value" :value="p.value" :label="p.label"/></ElSelect></ElFormItem><ElFormItem label="备注"><ElInput v-model="linkForm.note" type="textarea" :rows="3" maxlength="300" show-word-limit/></ElFormItem></ElForm>
      <template #footer><ElButton :disabled="mutating" @click="closeEdit()">取消</ElButton><ElButton type="primary" :loading="mutating" @click="saveLink">保存关联信息</ElButton></template>
    </ElDialog>
    <LinkPositionsDialog v-model="moveDialog" :positions="selected ? [selected] : []" :plans="plans" :from-plan-id="planId" @busy="value => mutating = value" @saved="moved"/>
  </section>
</template>
