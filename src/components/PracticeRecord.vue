<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { ElAlert, ElButton, ElCard, ElDatePicker, ElDescriptions, ElDescriptionsItem, ElForm, ElFormItem, ElImage, ElInput, ElInputNumber, ElMessage, ElMessageBox, ElOption, ElRadioButton, ElRadioGroup, ElSelect, ElSkeleton, ElTag, genFileId } from 'element-plus'
import { ArrowLeft, Check, Pencil, RefreshCw, Save } from 'lucide-vue-next'
import { ApiError, jsonBody, request } from '../reviews/api'
import { contentOf, emptyPractice, practiceMoney, practiceReviewLabel, practiceSide, practiceStatus, practiceStatuses, practiceTime, type PracticeAttachment, type PracticeRecord, type PracticeReview } from '../practice'
import SymbolSelect from './SymbolSelect.vue'
import PracticeImages from './PracticeImages.vue'
const props = defineProps<{ recordId?: string; reviewFirst?: boolean }>()
const emit = defineEmits<{ back: []; saved: [record: PracticeRecord] }>()
const record = ref<PracticeRecord | null>(null), mode = ref<'view' | 'edit'>(props.recordId ? 'view' : 'edit')
const loading = ref(false), saving = ref(false), confirming = ref(false), error = ref(''), conflict = ref(false)
const form = ref(emptyPractice()), files = ref<PracticeAttachment[]>([]), pendingSymbol = ref<string | null>(null)
const reviewForm = ref<Pick<PracticeReview, 'adherence' | 'good' | 'improve'>>({ adherence: 'unrated', good: '', improve: '' })
const baseline = ref(''), reviewBaseline = ref('')
const busy = computed(() => loading.value || saving.value || confirming.value)
const editing = computed(() => mode.value === 'edit')
const dirty = computed(() => editing.value ? snapshot() !== baseline.value : JSON.stringify(reviewForm.value) !== reviewBaseline.value)
const periods = ['M1', 'M5', 'M15', 'M30', 'H1', 'H4', 'D1', 'W1', 'MN1']
const markets = [{ value: 'uncertain', label: '不确定' }, { value: 'uptrend', label: '上涨趋势' }, { value: 'downtrend', label: '下跌趋势' }, { value: 'range', label: '震荡' }]
const adherence = [{ value: 'unrated', label: '未评价' }, { value: 'yes', label: '是' }, { value: 'partial', label: '部分' }, { value: 'no', label: '否' }]
watch(error, message => { if (message) window.scrollTo({ top: 0 }) })
function snapshot() { return JSON.stringify({ form: form.value, pending: pendingSymbol.value, files: files.value.map(file => ({ uid: file.uid, id: file.existingId, purpose: file.purpose })) }) }
function prepareReview() { const review = record.value?.review; reviewForm.value = { adherence: review?.adherence || 'unrated', good: review?.good || '', improve: review?.improve || '' }; reviewBaseline.value = JSON.stringify(reviewForm.value) }
function prepareEditor() {
  form.value = record.value ? contentOf(record.value) : emptyPractice()
  files.value = record.value?.images.map(image => ({ uid: genFileId(), name: image.name, url: image.url, status: 'success', existingId: image.id, purpose: image.purpose })) || []
  pendingSymbol.value = null; baseline.value = snapshot(); conflict.value = false
}
async function load() {
  const id = record.value?.id || props.recordId
  if (!id) return
  loading.value = true; error.value = ''
  try {
    const result = await request<{ record: PracticeRecord }>(`/api/practice/${encodeURIComponent(id)}`)
    record.value = result.record; prepareReview(); if (editing.value) prepareEditor(); conflict.value = false; emit('saved', result.record)
  } catch (e) { error.value = (e as Error).message }
  finally { loading.value = false }
}
async function canLeave() {
  if (busy.value) return false
  if (!dirty.value) return true
  confirming.value = true
  try { await ElMessageBox.confirm('当前模拟记录或复盘有未保存的修改，继续将丢弃这些修改。', '离开编辑', { type: 'warning', confirmButtonText: '丢弃修改并继续', cancelButtonText: '继续编辑' }); return true }
  catch { return false }
  finally { confirming.value = false }
}
async function back() { if (await canLeave()) emit('back') }
async function reload() { if (await canLeave()) await load() }
async function edit() { if (await canLeave()) { prepareReview(); prepareEditor(); mode.value = 'edit'; error.value = '' } }
async function cancelEdit() { if (await canLeave()) { mode.value = 'view'; files.value = []; prepareReview(); error.value = ''; conflict.value = false; await load() } }
async function saveRecord() {
  if (busy.value || conflict.value) return
  error.value = ''
  if (pendingSymbol.value !== null) { error.value = '请先选择品种候选或按 Enter 确认输入。'; return }
  saving.value = true
  try {
    const body = { ...form.value, expectedRevision: record.value?.recordRevision,
      keepImages: files.value.filter(file => file.existingId).map(file => ({ id: file.existingId, purpose: file.purpose })),
      newImagePurposes: files.value.filter(file => file.raw).map(file => file.purpose) }
    const data = new FormData(); data.append('payload', JSON.stringify(body))
    files.value.forEach(file => { if (file.raw) data.append('images', file.raw, file.name) })
    const result = await request<{ record: PracticeRecord }>(record.value ? `/api/practice/${encodeURIComponent(record.value.id)}` : '/api/practice', { method: record.value ? 'PUT' : 'POST', body: data })
    record.value = result.record; mode.value = 'view'; files.value = []; prepareReview(); emit('saved', result.record); ElMessage.success('模拟记录已保存')
  } catch (e) { error.value = (e as Error).message; conflict.value = e instanceof ApiError && e.status === 409 }
  finally { saving.value = false }
}
async function saveReview(state: 'draft' | 'completed') {
  if (!record.value || busy.value || conflict.value) return
  if (state === 'completed' && !reviewForm.value.good.trim() && !reviewForm.value.improve.trim()) { error.value = '完成复盘前，请至少填写一项文字总结。'; return }
  saving.value = true; error.value = ''
  try {
    const result = await request<{ record: PracticeRecord }>(`/api/practice/${encodeURIComponent(record.value.id)}/review`, jsonBody('PUT', { ...reviewForm.value, state, expectedRecordRevision: record.value.recordRevision, expectedReviewRevision: record.value.reviewRevision }))
    record.value = result.record; prepareReview(); emit('saved', result.record); ElMessage.success(state === 'completed' ? '模拟复盘已完成' : '复盘草稿已保存')
  } catch (e) { error.value = (e as Error).message; conflict.value = e instanceof ApiError && e.status === 409 }
  finally { saving.value = false }
}
function beforeUnload(event: BeforeUnloadEvent) { if (dirty.value || busy.value) { event.preventDefault(); event.returnValue = '' } }
prepareEditor(); prepareReview()
onMounted(async () => { window.addEventListener('beforeunload', beforeUnload); await load() })
onBeforeUnmount(() => window.removeEventListener('beforeunload', beforeUnload))
defineExpose({ canLeave })
</script>
<template>
  <section class="practice-record page-stack">
    <div class="practice-heading"><div><ElButton link :disabled="busy" @click="back"><ArrowLeft :size="16"/>返回模拟练习</ElButton><h1>{{ editing ? record ? '编辑模拟记录' : '新建模拟记录' : '模拟记录详情' }}</h1><p>回放在外部工具进行，这里记录你的分析、执行与结果。</p></div><div class="practice-actions"><ElButton v-if="record || recordId" :disabled="busy" @click="reload"><RefreshCw :size="15"/>重新读取</ElButton><ElButton v-if="!editing && record" type="primary" :disabled="busy" @click="edit"><Pencil :size="15"/>编辑记录 / 截图</ElButton></div></div>
    <ElAlert v-if="error" :title="error" type="error" show-icon :closable="false"/>
    <ElSkeleton v-if="loading && !record" :rows="10" animated/>
    <ElCard v-else-if="editing" shadow="never">
      <ElForm label-position="top" :disabled="busy" @submit.prevent="saveRecord">
        <div class="practice-form-grid"><ElFormItem label="记录状态"><ElSelect v-model="form.status"><ElOption v-for="s in practiceStatuses" :key="s.value" :value="s.value" :label="s.label"/></ElSelect></ElFormItem><ElFormItem :label="`交易品种${form.status === 'draft' ? '（选填）' : ''}`" :required="form.status !== 'draft'"><SymbolSelect v-model="form.symbol" :disabled="busy" @pending-change="value => pendingSymbol = value"/></ElFormItem><ElFormItem :label="`方向${form.status === 'draft' ? '（选填）' : ''}`" :required="form.status !== 'draft'"><ElSelect v-model="form.side" clearable><ElOption label="做多" value="buy"/><ElOption label="做空" value="sell"/></ElSelect></ElFormItem><ElFormItem :label="`分析周期${form.status === 'draft' ? '（选填）' : ''}`" :required="form.status !== 'draft'"><ElSelect v-model="form.timeframe" clearable><ElOption v-for="period in periods" :key="period" :value="period" :label="period"/></ElSelect></ElFormItem></div>
        <p class="practice-hint practice-form-note">草稿可先保存不完整内容。模拟持仓中需填写品种、方向、周期与开仓时间 / 价；已平仓还需平仓时间 / 价、净盈亏及币种。</p>
        <h2 class="practice-section-title">模拟开平仓</h2><p class="practice-hint practice-form-note">以下时间是你在外部工具回放的行情时间，手动填写，不使用记录创建时间代替。</p>
        <div class="practice-form-grid"><ElFormItem :label="`模拟开仓时间${form.status === 'draft' ? '（选填）' : ''}`" :required="form.status !== 'draft'"><ElDatePicker v-model="form.openTime" type="datetime" value-format="YYYY-MM-DD HH:mm:ss" placeholder="回放行情时间"/></ElFormItem><ElFormItem :label="`模拟开仓价${form.status === 'draft' ? '（选填）' : ''}`" :required="form.status !== 'draft'"><ElInputNumber v-model="form.openPrice" :controls="false" placeholder="填写价格"/></ElFormItem><ElFormItem label="仓位 / 手数（选填）"><ElInputNumber v-model="form.volume" :controls="false" placeholder="选填"/></ElFormItem><ElFormItem :label="`模拟平仓时间${form.status === 'closed' ? '' : '（选填）'}`" :required="form.status === 'closed'"><ElDatePicker v-model="form.closeTime" type="datetime" value-format="YYYY-MM-DD HH:mm:ss" placeholder="回放行情时间"/></ElFormItem><ElFormItem :label="`模拟平仓价${form.status === 'closed' ? '' : '（选填）'}`" :required="form.status === 'closed'"><ElInputNumber v-model="form.closePrice" :controls="false" placeholder="选填"/></ElFormItem><ElFormItem :label="`净盈亏（含费用）${form.status === 'closed' ? '' : '（选填）'}`" :required="form.status === 'closed'"><ElInputNumber v-model="form.netProfit" :controls="false" placeholder="持平请填 0"/></ElFormItem><ElFormItem :label="`币种${form.status === 'closed' ? '' : '（选填）'}`" :required="form.status === 'closed'"><ElInput v-model="form.currency" maxlength="12" placeholder="USD"/></ElFormItem></div>
        <h2 class="practice-section-title">分析与截图（选填）</h2>
        <ElFormItem label="行情截图"><PracticeImages v-model="files" :disabled="busy" :default-purpose="reviewFirst ? 'review' : 'before'"/></ElFormItem>
        <div class="practice-form-grid"><ElFormItem label="市场状态（选填）"><ElSelect v-model="form.marketState"><ElOption v-for="market in markets" :key="market.value" :value="market.value" :label="market.label"/></ElSelect></ElFormItem><ElFormItem label="计划止损（选填）"><ElInputNumber v-model="form.stopLoss" :controls="false"/></ElFormItem><ElFormItem label="计划止盈（选填）"><ElInputNumber v-model="form.takeProfit" :controls="false"/></ElFormItem></div>
        <ElFormItem label="关键结构（选填）"><ElInput v-model="form.keyStructure" maxlength="300" placeholder="一句话记下关键结构，也可写“见图”"/></ElFormItem><ElFormItem label="开仓分析（选填）"><ElInput v-model="form.reason" type="textarea" :rows="4" maxlength="5000" show-word-limit placeholder="为什么准备在这里开仓？"/></ElFormItem>
        <div class="practice-save-bar"><span class="practice-hint">净盈亏由你填写，系统不根据开平仓价格推算。</span><div><ElButton v-if="record" :disabled="busy" @click="cancelEdit">取消编辑</ElButton><ElButton type="primary" native-type="submit" :loading="saving" :disabled="busy || conflict"><Save :size="15"/>保存{{ practiceStatus(form.status) }}</ElButton></div></div>
      </ElForm>
    </ElCard>
    <template v-else-if="record">
      <ElCard shadow="never"><template #header><div class="practice-section-head"><h2>{{ record.symbol || '未填品种' }} · {{ practiceSide(record.side) }}</h2><ElTag :type="record.status === 'closed' ? 'success' : record.status === 'open' ? 'warning' : 'info'">{{ practiceStatus(record.status) }}</ElTag></div></template>
        <ElDescriptions :column="2" border><ElDescriptionsItem label="分析周期">{{ record.timeframe || '未填写' }}</ElDescriptionsItem><ElDescriptionsItem label="仓位 / 手数">{{ practiceMoney(record.volume) }}</ElDescriptionsItem><ElDescriptionsItem label="模拟开仓时间">{{ record.openTime || '未填写' }}</ElDescriptionsItem><ElDescriptionsItem label="模拟开仓价">{{ practiceMoney(record.openPrice) }}</ElDescriptionsItem><ElDescriptionsItem label="模拟平仓时间">{{ record.closeTime || '未填写' }}</ElDescriptionsItem><ElDescriptionsItem label="模拟平仓价">{{ practiceMoney(record.closePrice) }}</ElDescriptionsItem><ElDescriptionsItem label="净盈亏（含费用）">{{ practiceMoney(record.netProfit) }} {{ record.currency }}</ElDescriptionsItem><ElDescriptionsItem label="计划止损 / 止盈">{{ practiceMoney(record.stopLoss) }} / {{ practiceMoney(record.takeProfit) }}</ElDescriptionsItem><ElDescriptionsItem label="实际创建时间">{{ practiceTime(record.createdAt) }}</ElDescriptionsItem><ElDescriptionsItem label="实际更新时间">{{ practiceTime(record.updatedAt) }}</ElDescriptionsItem></ElDescriptions>
        <p class="practice-hint practice-form-note">模拟开平仓时间为手填回放行情时间。{{ record.status !== 'closed' ? '当前记录未平仓，不计已实现盈亏或胜率。' : '已平仓净盈亏参与所填币种的模拟统计。' }}</p>
        <h3>市场状态</h3><p class="practice-analysis">{{ markets.find(m => m.value === record?.marketState)?.label || '未填写' }}</p><h3>关键结构</h3><p class="practice-analysis">{{ record.keyStructure || '未填写' }}</p><h3>开仓分析</h3><p class="practice-analysis">{{ record.reason || '未填写' }}</p>
        <div v-if="record.images.length" class="practice-image-grid"><div v-for="(image, index) in record.images" :key="image.id"><ElImage :src="image.url" :alt="image.name" fit="contain" :preview-src-list="record.images.map(item => item.url)" :initial-index="index" preview-teleported/><ElTag size="small" type="info">{{ image.purpose === 'review' ? '复盘' : '开仓前' }}</ElTag></div></div><p v-else class="practice-hint">未添加截图。可通过“编辑记录 / 截图”补充并标注用途。</p>
      </ElCard>
      <div class="practice-review-anchor"><ElCard shadow="never"><template #header><div class="practice-section-head"><h2>这笔模拟交易的复盘</h2><ElTag v-if="record.status === 'closed'" :type="record.review.state === 'completed' ? 'success' : 'warning'">{{ practiceReviewLabel(record.review.state) }}</ElTag></div></template>
        <ElAlert v-if="record.review.state === 'needs_update'" title="记录内容或截图已更新，原总结保留，请核对后补充复盘。" type="warning" show-icon :closable="false"/>
        <ElAlert v-if="record.status !== 'closed'" title="保存为已平仓后可填写复盘；已有总结保留，当前不进入已平仓复盘队列。" type="info" show-icon :closable="false"/>
        <ElForm label-position="top" :disabled="busy || record.status !== 'closed'" class="practice-review-form"><ElFormItem label="是否按自己的分析执行"><ElRadioGroup v-model="reviewForm.adherence"><ElRadioButton v-for="item in adherence" :key="item.value" :value="item.value">{{ item.label }}</ElRadioButton></ElRadioGroup></ElFormItem><div class="practice-review-grid"><ElFormItem label="做得好的地方"><ElInput v-model="reviewForm.good" type="textarea" :rows="5" maxlength="5000" show-word-limit/></ElFormItem><ElFormItem label="问题与改进"><ElInput v-model="reviewForm.improve" type="textarea" :rows="5" maxlength="5000" show-word-limit/></ElFormItem></div><p v-if="record.review.completedAt" class="practice-hint">上次完成 {{ practiceTime(record.review.completedAt) }}</p><div class="practice-save-bar"><span class="practice-hint">完成复盘至少填写一项非空总结。</span><div><ElButton :loading="saving" :disabled="busy || conflict || record.status !== 'closed'" @click="saveReview('draft')"><Save :size="15"/>保存复盘草稿</ElButton><ElButton type="primary" :loading="saving" :disabled="busy || conflict || record.status !== 'closed'" @click="saveReview('completed')"><Check :size="15"/>{{ record.review.state === 'completed' ? '保存已完成复盘' : '完成复盘' }}</ElButton></div></div></ElForm>
      </ElCard></div>
    </template>
  </section>
</template>
