<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import {
  ElAlert, ElButton, ElCard, ElDialog, ElEmpty, ElForm, ElFormItem, ElImage, ElInput,
  ElInputNumber, ElMessage, ElMessageBox, ElOption, ElPopover,
  ElSelect, ElSkeleton, ElTable, ElTableColumn, ElTag,
} from 'element-plus'
import { Check, ChevronDown, ImagePlus, LockKeyhole, Plus, ReceiptText } from 'lucide-vue-next'
import { emptyOrder, orderRiskReward, orderStatusLabels, type OcrOrderRow, type OrderFields, type OrderStatus, type RecordedOrder } from '../orders'

interface DraftRow { id: string; fields: OrderFields; warnings: string[]; raw?: Record<string, string> }
interface OcrResult { rows: OcrOrderRow[]; detectedStatus: OrderStatus; ambiguous: boolean; warnings: string[] }
type CompareField = 'volume' | 'reportedSL' | 'reportedTP'
type UpdateEmotion = 'calm' | 'confident' | 'hesitant' | 'nervous' | 'fearful' | 'greedy' | 'impulsive'
interface CompareChange { field: CompareField; from: number | null; to: number }
interface ComparisonDraft { order: RecordedOrder; changes: CompareChange[] }
const props = defineProps<{ planId: string; active: boolean; disabled?: boolean }>()
const emit = defineEmits<{ stateChange: [state: { dirty: boolean; busy: boolean }] }>()

const orders = ref<RecordedOrder[]>([]), drafts = ref<DraftRow[]>([]), currentId = ref('')
const loading = ref(false), recognizing = ref(false), saving = ref(false), changingId = ref('')
const openStatusMenuId = ref('')
const lockingId = ref('')
const error = ref(''), warnings = ref<string[]>([]), preview = ref('')
const compareDialog = ref(false), compareRecognizing = ref(false), compareSaving = ref(false)
const comparePreview = ref(''), compareError = ref(''), compareWarnings = ref<string[]>([]), comparison = ref<ComparisonDraft | null>(null)
const compareReason = ref(''), compareEmotion = ref<UpdateEmotion | ''>('')
const fileInput = ref<HTMLInputElement>(), compareFileInput = ref<HTMLInputElement>()
let generation = 0, readController: AbortController | undefined, ocrController: AbortController | undefined
let compareController: AbortController | undefined, writeController: AbortController | undefined
const current = computed(() => drafts.value.find(row => row.id === currentId.value))
const dirty = computed(() => drafts.value.length > 0 || !!preview.value || !!comparePreview.value || !!comparison.value)
const busy = computed(() => loading.value || recognizing.value || saving.value || compareRecognizing.value || compareSaving.value || !!changingId.value || !!lockingId.value)
const locked = computed(() => !!props.disabled || busy.value)
const hasUpdatableOrders = computed(() => orders.value.some(order => !order.lockedAt))
const fieldKeys: (keyof OrderFields)[] = ['ticket', 'status', 'symbol', 'side', 'volume', 'pendingTime', 'pendingPrice',
  'openTime', 'openPrice', 'closeTime', 'closePrice', 'reportedSL', 'reportedTP', 'reportedProfit']
const compareLabels: Record<CompareField, string> = { volume: '手数', reportedSL: '止损', reportedTP: '止盈' }
const emotionOptions: { value: UpdateEmotion; label: string }[] = [
  { value: 'calm', label: '平静' }, { value: 'confident', label: '自信' }, { value: 'hesitant', label: '犹豫' },
  { value: 'nervous', label: '紧张' }, { value: 'fearful', label: '恐惧' }, { value: 'greedy', label: '贪婪' },
  { value: 'impulsive', label: '冲动' },
]
const canSaveComparison = computed(() => !!comparison.value?.changes.length
  && !!compareReason.value.trim() && compareReason.value.trim().length <= 500 && !!compareEmotion.value)
const statusMenuOptions: { value: OrderStatus; description: string }[] = [
  { value: 'pending', description: '等待成交' },
  { value: 'open', description: '订单已成交' },
  { value: 'closed', description: '交易已结束' },
]

watch([dirty, busy], ([nextDirty, nextBusy]) => emit('stateChange', { dirty: nextDirty, busy: nextBusy }), { immediate: true })

async function json<T>(response: Response): Promise<T> {
  const result = await response.json().catch(() => ({ error: '服务返回无效响应，当前草稿已保留。' }))
  if (!response.ok) throw new Error(result.error || '操作失败，当前草稿已保留。')
  return result as T
}
function resetPreview() { if (preview.value) URL.revokeObjectURL(preview.value); preview.value = ''; warnings.value = [] }
function resetComparison() {
  if (comparePreview.value) URL.revokeObjectURL(comparePreview.value)
  comparePreview.value = ''; compareWarnings.value = []; compareError.value = ''; comparison.value = null
  compareReason.value = ''; compareEmotion.value = ''
}
function timestamp(value: string) { return new Date(value).toLocaleString('zh-CN', { hour12: false }) }
function sideLabel(value: string) { return value === 'buy' ? '做多' : '做空' }
function displayNumber(value: number | null) { return value === null ? '未记录' : String(value) }
function sameNumber(left: number | null, right: number) {
  return left !== null && Math.abs(left - right) <= Number.EPSILON * Math.max(1, Math.abs(left), Math.abs(right)) * 8
}
function addManual() {
  if (locked.value) return
  const row = { id: crypto.randomUUID(), fields: emptyOrder(), warnings: [] }
  drafts.value.push(row); currentId.value = row.id; error.value = ''
}
async function load() {
  generation++; const version = generation
  readController?.abort(); const controller = new AbortController(); readController = controller
  loading.value = true; error.value = ''
  try {
    const result = await json<{ orders: RecordedOrder[] }>(await fetch(`/api/plans/${encodeURIComponent(props.planId)}/orders`, { signal: controller.signal }))
    if (version === generation) orders.value = result.orders
  } catch (problem) {
    if (version === generation && (problem as Error).name !== 'AbortError') error.value = (problem as Error).message
  } finally { if (version === generation) { loading.value = false; readController = undefined } }
}
function validate(fields: OrderFields) {
  if (!/^\d+$/.test(fields.ticket.trim())) return '请核对完整的纯数字订单号。'
  if (!fields.symbol.trim()) return '请填写品种。'
  if (!['buy', 'sell'].includes(fields.side)) return '请选择方向。'
  for (const [key, label, positive] of [
    ['volume', '手数', true], ['pendingPrice', '挂单目标价', true], ['openPrice', '开仓价', true],
    ['closePrice', '平仓价', true], ['reportedSL', '止损', true], ['reportedTP', '止盈', true],
    ['reportedProfit', '截图盈利', false],
  ] as const) {
    const value = fields[key]
    if (value !== null && (!Number.isFinite(value) || (positive && value <= 0))) return `${label}格式无效，未知请留空。`
  }
  for (const [key, label] of [['pendingTime', '挂单时间'], ['openTime', '开仓时间'], ['closeTime', '平仓时间']] as const) {
    const value = fields[key]
    if (value && !/^\d{4}\.\d{2}\.\d{2} \d{2}:\d{2}:\d{2}$/.test(value)) return `${label}请使用 YYYY.MM.DD HH:mm:ss。`
  }
  return ''
}
async function saveCurrent() {
  if (!current.value || locked.value) return
  const row = current.value, fields = { ...row.fields, ticket: row.fields.ticket.trim(), symbol: row.fields.symbol.trim() }
  const problem = validate(fields)
  if (problem) { error.value = problem; return }
  const version = generation, controller = new AbortController(); writeController = controller
  saving.value = true; error.value = ''
  try {
    const result = await json<{ order: RecordedOrder; created: boolean }>(await fetch(`/api/plans/${encodeURIComponent(props.planId)}/orders`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(fields), signal: controller.signal,
    }))
    if (version !== generation) return
    orders.value = [...orders.value.filter(order => order.id !== result.order.id), result.order]
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id))
    drafts.value = drafts.value.filter(item => item.id !== row.id); currentId.value = drafts.value[0]?.id || ''
    if (!drafts.value.length) resetPreview()
    ElMessage({ type: result.created ? 'success' : 'info', message: result.created ? '订单已创建并关联当前计划。' : '该订单已关联当前计划，未重复创建。' })
  } catch (problem) { if (version === generation && (problem as Error).name !== 'AbortError') error.value = (problem as Error).message }
  finally { if (version === generation) { saving.value = false; writeController = undefined } }
}
async function discardCurrent() {
  if (!current.value || locked.value) return
  try {
    await ElMessageBox.confirm('丢弃当前这行未保存订单草稿？', '丢弃草稿', { confirmButtonText: '丢弃', cancelButtonText: '继续核对', type: 'warning' })
    drafts.value = drafts.value.filter(row => row.id !== currentId.value); currentId.value = drafts.value[0]?.id || ''
    if (!drafts.value.length) resetPreview()
  } catch { /* keep draft */ }
}
async function recognize(file?: File) {
  if (!file || locked.value) return
  if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type) || !file.size || file.size > 5 * 1024 * 1024) {
    error.value = '请选择一张不超过 5 MB 的 PNG、JPEG 或 WEBP 图片。'; return
  }
  if (dirty.value) { error.value = '请先保存或丢弃当前识别草稿，再导入下一张截图。'; return }
  resetPreview(); preview.value = URL.createObjectURL(file); error.value = ''; warnings.value = []
  const version = generation, controller = new AbortController(); ocrController = controller; recognizing.value = true
  try {
    const body = new FormData(); body.append('image', file)
    const result = await json<OcrResult>(await fetch('/api/order-ocr', { method: 'POST', body, signal: controller.signal }))
    if (version !== generation) return
    drafts.value = result.rows.map(row => {
      const defaults = emptyOrder(result.detectedStatus)
      const fields = Object.fromEntries(fieldKeys.map(key => [key, row[key] ?? defaults[key]])) as unknown as OrderFields
      return { id: crypto.randomUUID(), fields, warnings: row.warnings || [], raw: row.raw }
    })
    currentId.value = drafts.value[0]?.id || ''; warnings.value = result.warnings || []
    if (!drafts.value.length) error.value = '未识别到可核对行，请换用完整宽度的清晰截图。'
  } catch (problem) { if (version === generation && (problem as Error).name !== 'AbortError') error.value = (problem as Error).message }
  finally { if (version === generation) { recognizing.value = false; ocrController = undefined } }
}
function chooseImage(event: Event) { const input = event.target as HTMLInputElement; void recognize(input.files?.[0]); input.value = '' }
function openComparison() {
  if (locked.value || !hasUpdatableOrders.value) return
  compareError.value = ''; compareDialog.value = true
}
async function recognizeComparison(file?: File) {
  if (!file || locked.value) return
  if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type) || !file.size || file.size > 5 * 1024 * 1024) {
    compareError.value = '请选择一张不超过 5 MB 的 PNG、JPEG 或 WEBP 图片。'; return
  }
  if (comparePreview.value || comparison.value) { compareError.value = '请先取消当前对比，再选择另一张截图。'; return }
  compareReason.value = ''; compareEmotion.value = ''
  comparePreview.value = URL.createObjectURL(file); compareError.value = ''; compareWarnings.value = []
  const version = generation, controller = new AbortController(); compareController = controller; compareRecognizing.value = true
  try {
    const body = new FormData(); body.append('image', file)
    const result = await json<OcrResult>(await fetch('/api/order-ocr', { method: 'POST', body, signal: controller.signal }))
    if (version !== generation) return
    compareWarnings.value = result.warnings || []
    if (result.rows.length !== 1) { compareError.value = result.rows.length ? '订单对比只接受一行截图，请重新截取单行。' : '截图未识别到订单行。'; return }
    const row = result.rows[0], ticket = row.ticket?.trim()
    if (!ticket) { compareError.value = '截图未可靠识别订单号，未匹配或更新任何订单。'; return }
    const order = orders.value.find(item => item.ticket === ticket)
    if (!order) { compareError.value = `订单号 ${ticket} 不属于当前计划，未更新任何订单。`; return }
    if (order.lockedAt) { compareError.value = `订单号 ${ticket} 已锁定，无法再修改手数、止损和止盈。`; return }
    const changes: CompareChange[] = []
    for (const field of ['volume', 'reportedSL', 'reportedTP'] as const) {
      const value = row[field]
      if (typeof value === 'number' && Number.isFinite(value) && value > 0 && !sameNumber(order[field], value)) {
        changes.push({ field, from: order[field], to: value })
      }
    }
    comparison.value = { order, changes }
  } catch (problem) {
    if (version === generation && (problem as Error).name !== 'AbortError') compareError.value = (problem as Error).message
  } finally { if (version === generation) { compareRecognizing.value = false; compareController = undefined } }
}
function chooseComparisonImage(event: Event) { const input = event.target as HTMLInputElement; void recognizeComparison(input.files?.[0]); input.value = '' }
async function saveComparison() {
  if (!comparison.value?.changes.length || locked.value) return
  const reason = compareReason.value.trim()
  if (!reason) { compareError.value = '请填写本次修改原因。'; return }
  if (reason.length > 500) { compareError.value = '修改原因不能超过 500 字。'; return }
  if (!compareEmotion.value) { compareError.value = '请选择当时情绪。'; return }
  if (comparison.value.order.lockedAt || orders.value.find(order => order.id === comparison.value?.order.id)?.lockedAt) {
    compareError.value = '订单已锁定，无法再修改手数、止损和止盈。'; return
  }
  const draft = comparison.value, version = generation, controller = new AbortController(); writeController = controller
  compareSaving.value = true; compareError.value = ''
  try {
    const fields = Object.fromEntries(draft.changes.map(change => [change.field, change.to]))
    const result = await json<{ order: RecordedOrder; changed: boolean }>(await fetch(`/api/plans/${encodeURIComponent(props.planId)}/orders/${encodeURIComponent(draft.order.id)}/compared-fields`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ expectedUpdatedAt: draft.order.updatedAt, reason, emotion: compareEmotion.value, ...fields }), signal: controller.signal,
    }))
    if (version !== generation) return
    orders.value = orders.value.map(order => order.id === result.order.id ? result.order : order)
    if (result.changed) {
      resetComparison(); compareDialog.value = false; ElMessage.success('截图中的订单变化已确认保存。')
    } else {
      comparison.value = { order: result.order, changes: [] }; ElMessage.info('未发现可更新变化。')
    }
  } catch (problem) {
    if (version === generation && (problem as Error).name !== 'AbortError') compareError.value = (problem as Error).message
  } finally { if (version === generation) { compareSaving.value = false; writeController = undefined } }
}
async function closeComparison(done?: () => void) {
  if (compareRecognizing.value || compareSaving.value) return
  if (comparePreview.value || comparison.value) {
    try {
      await ElMessageBox.confirm('取消本次订单截图对比？未确认的变化不会保存。', '取消截图对比', {
        confirmButtonText: '取消对比', cancelButtonText: '继续核对', type: 'warning', closeOnClickModal: false,
      })
    } catch { return }
  }
  resetComparison()
  if (done) done(); else compareDialog.value = false
}
function pasteImage(event: ClipboardEvent) {
  if (!props.active || locked.value) return
  const files = Array.from(event.clipboardData?.files || []).filter(file => file.type.startsWith('image/'))
  if (!files.length) return
  event.preventDefault(); event.stopImmediatePropagation()
  if (files.length !== 1) {
    if (compareDialog.value) compareError.value = '每次只能粘贴一张订单截图。'
    else error.value = '每次只能粘贴一张订单截图。'
    return
  }
  if (compareDialog.value) void recognizeComparison(files[0])
  else void recognize(files[0])
}
async function changeStatus(order: RecordedOrder, status: OrderStatus) {
  if (locked.value || order.lockedAt || order.status === status) return false
  changingId.value = order.id; error.value = ''
  try {
    const result = await json<{ order: RecordedOrder }>(await fetch(`/api/plans/${encodeURIComponent(props.planId)}/orders/${encodeURIComponent(order.id)}/status`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status }),
    }))
    orders.value = orders.value.map(item => item.id === order.id ? result.order : item)
    ElMessage.success(`订单已更新为${orderStatusLabels[result.order.status]}。`)
    return true
  } catch (problem) { error.value = (problem as Error).message; return false }
  finally { changingId.value = '' }
}
function setStatusMenuVisibility(orderId: string, visible: boolean) {
  if (changingId.value || (visible && (locked.value || orders.value.find(order => order.id === orderId)?.lockedAt))) return
  openStatusMenuId.value = visible ? orderId : ''
}
async function selectStatusFromMenu(value: unknown, status: OrderStatus) {
  const order = value as RecordedOrder
  if (locked.value || order.lockedAt) return
  if (order.status === status) { openStatusMenuId.value = ''; return }
  if (await changeStatus(order, status)) openStatusMenuId.value = ''
}
async function lockOrder(order: RecordedOrder) {
  if (locked.value || order.lockedAt || order.status !== 'closed') return
  const version = generation
  lockingId.value = order.id; openStatusMenuId.value = ''; error.value = ''
  try {
    try {
      await ElMessageBox.confirm('锁定后订单视为完结，无法再修改状态、手数、止损和止盈。此操作不可撤销，不能解锁。', `锁定订单 ${order.ticket}`, {
        confirmButtonText: '确认永久锁定', cancelButtonText: '取消', type: 'warning', closeOnClickModal: false,
      })
    } catch { return }
    if (version !== generation) return
    const controller = new AbortController(); writeController = controller
    const result = await json<{ order: RecordedOrder; changed: boolean }>(await fetch(`/api/plans/${encodeURIComponent(props.planId)}/orders/${encodeURIComponent(order.id)}/lock`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ expectedUpdatedAt: order.updatedAt }), signal: controller.signal,
    }))
    if (version !== generation) return
    orders.value = orders.value.map(item => item.id === result.order.id ? result.order : item)
    ElMessage({ type: result.changed ? 'success' : 'info', message: result.changed ? '订单已锁定，视为完结。' : '订单已经锁定。' })
  } catch (problem) {
    if (version === generation && (problem as Error).name !== 'AbortError') error.value = (problem as Error).message
  } finally { lockingId.value = ''; if (version === generation) writeController = undefined }
}
async function confirmDiscard() {
  if (busy.value) return false
  if (!dirty.value) return true
  try {
    await ElMessageBox.confirm('订单截图或核对草稿尚未保存。离开后将丢弃，已保存订单仍会保留。', '离开关联订单', {
      confirmButtonText: '离开并丢弃', cancelButtonText: '继续核对', type: 'warning', closeOnClickModal: false,
    })
    drafts.value = []; currentId.value = ''; resetPreview(); resetComparison(); compareDialog.value = false; error.value = ''
    return true
  } catch { return false }
}

watch(() => props.planId, () => { generation++; readController?.abort(); ocrController?.abort(); compareController?.abort(); writeController?.abort(); drafts.value = []; currentId.value = ''; openStatusMenuId.value = ''; resetPreview(); resetComparison(); compareDialog.value = false; void load() }, { immediate: true })
window.addEventListener('paste', pasteImage, true)
onBeforeUnmount(() => { generation++; readController?.abort(); ocrController?.abort(); compareController?.abort(); writeController?.abort(); resetPreview(); resetComparison(); window.removeEventListener('paste', pasteImage, true); emit('stateChange', { dirty: false, busy: false }) })
defineExpose({ confirmDiscard })
</script>

<template>
  <div class="linked-orders">
    <ElCard shadow="never" class="order-import-card">
      <template #header><div class="plan-card-heading"><div><h2>导入订单</h2><span>本机识别 · 原图不保存</span></div><div class="order-actions"><ElButton type="primary" :disabled="locked" :loading="recognizing" @click="fileInput?.click()"><ImagePlus :size="15"/>选择截图</ElButton><ElButton plain :disabled="locked || !hasUpdatableOrders" @click="openComparison">更新订单</ElButton><ElButton text :disabled="locked" @click="addManual"><Plus :size="15"/>手动添加一行</ElButton></div></div></template>
      <input ref="fileInput" type="file" hidden accept="image/png,image/jpeg,image/webp" @change="chooseImage"/>
      <div class="order-import-intro"><p class="order-help">选择或粘贴一张完整宽度的 MT5 挂单、持仓中或已平仓截图，支持浅色表格及整行蓝色选中的单行截图，建议每次截取一行。系统自动判断布局；识别草稿必须对照原图核对后保存。</p></div>
      <ElAlert v-if="error" :title="error" type="error" show-icon :closable="false"/>
      <ElImage v-if="preview" :src="preview" :preview-src-list="[preview]" preview-teleported fit="contain" class="order-preview"/>
      <ElAlert v-for="(warning, index) in warnings" :key="index" :title="warning" type="warning" :closable="false" class="order-warning"/>
      <section v-if="drafts.length" class="order-drafts">
        <ElTable :data="drafts" row-key="id" size="small" class="order-draft-table"><ElTableColumn type="index" width="48"/><ElTableColumn label="订单号"><template #default="{ row }"><strong class="order-ticket">{{ row.fields.ticket || '待补' }}</strong></template></ElTableColumn><ElTableColumn label="品种"><template #default="{ row }">{{ row.fields.symbol || '待补' }}</template></ElTableColumn><ElTableColumn label="状态"><template #default="{ row }">{{ orderStatusLabels[row.fields.status as OrderStatus] }}</template></ElTableColumn><ElTableColumn width="94"><template #default="{ row }"><ElButton link type="primary" :disabled="locked" @click="currentId = row.id">{{ currentId === row.id ? '正在核对' : '核对此行' }}</ElButton></template></ElTableColumn></ElTable>
        <ElForm v-if="current" label-position="top" :disabled="locked" class="order-draft-form" @submit.prevent.stop="saveCurrent">
          <ElAlert v-for="(warning, index) in current.warnings" :key="index" :title="warning" type="warning" :closable="false" class="order-warning"/>
          <div class="order-fields order-fields-primary">
            <ElFormItem label="订单号" required><ElInput v-model="current.fields.ticket" maxlength="100" inputmode="numeric"/></ElFormItem>
            <ElFormItem label="状态" required><ElSelect v-model="current.fields.status"><ElOption v-for="(label, value) in orderStatusLabels" :key="value" :value="value" :label="label"/></ElSelect></ElFormItem>
            <ElFormItem label="品种" required><ElInput v-model="current.fields.symbol" maxlength="40"/></ElFormItem>
            <ElFormItem label="方向" required><ElSelect v-model="current.fields.side"><ElOption label="做多" value="buy"/><ElOption label="做空" value="sell"/></ElSelect></ElFormItem>
            <ElFormItem label="手数"><ElInputNumber v-model="current.fields.volume" :controls="false" :step="0.01" :step-strictly="false" placeholder="未知留空"/></ElFormItem>
          </div>
          <details><summary>核对时间、价格、止损止盈与盈利</summary><div class="order-fields">
            <ElFormItem label="挂单时间"><ElInput v-model="current.fields.pendingTime" placeholder="YYYY.MM.DD HH:mm:ss"/></ElFormItem>
            <ElFormItem label="挂单目标价"><ElInputNumber v-model="current.fields.pendingPrice" :controls="false" :step="0.00001" :step-strictly="false" placeholder="未知留空"/></ElFormItem>
            <ElFormItem label="开仓时间"><ElInput v-model="current.fields.openTime" placeholder="YYYY.MM.DD HH:mm:ss"/></ElFormItem>
            <ElFormItem label="开仓价"><ElInputNumber v-model="current.fields.openPrice" :controls="false" :step="0.00001" :step-strictly="false" placeholder="未知留空"/></ElFormItem>
            <ElFormItem label="平仓时间"><ElInput v-model="current.fields.closeTime" placeholder="YYYY.MM.DD HH:mm:ss"/></ElFormItem>
            <ElFormItem label="平仓价"><ElInputNumber v-model="current.fields.closePrice" :controls="false" :step="0.00001" :step-strictly="false" placeholder="未知留空"/></ElFormItem>
            <ElFormItem label="截图止损"><ElInputNumber v-model="current.fields.reportedSL" :controls="false" :step="0.00001" :step-strictly="false" placeholder="未知留空"/></ElFormItem>
            <ElFormItem label="截图止盈"><ElInputNumber v-model="current.fields.reportedTP" :controls="false" :step="0.00001" :step-strictly="false" placeholder="未知留空"/></ElFormItem>
            <ElFormItem label="截图盈利"><ElInputNumber v-model="current.fields.reportedProfit" :controls="false" :step="0.01" :step-strictly="false" placeholder="未知留空，可为负数或 0"/></ElFormItem>
          </div></details>
          <p class="order-help">时间保留 MT5 报告时钟，不转换时区。未知字段留空；切换草稿状态不会清空已识别字段。</p>
          <details v-if="current.raw"><summary>查看本行识别原文</summary><pre class="order-raw">{{ JSON.stringify(current.raw, null, 2) }}</pre></details>
          <div class="order-actions"><ElButton type="primary" native-type="submit" :loading="saving" :disabled="locked">已核对，创建并关联</ElButton><ElButton :disabled="locked" @click="discardCurrent">丢弃此行</ElButton></div>
        </ElForm>
      </section>
    </ElCard>

    <ElCard shadow="never" class="order-list-card">
      <template #header><div class="plan-card-heading order-list-heading"><div><h2>关联订单 <ElTag size="small" round effect="light" class="order-count-tag">{{ orders.length }} 笔</ElTag></h2><span>已保存并关联到当前计划</span></div></div></template>
      <ElSkeleton v-if="loading" :rows="3" animated/>
      <ElTable v-else-if="orders.length" :data="orders" size="small" class="order-list-table">
        <ElTableColumn label="订单号" min-width="190" align="left" header-align="left"><template #default="{ row }"><div class="saved-order-ticket"><span><ReceiptText :size="15"/></span><strong>{{ row.ticket }}</strong></div></template></ElTableColumn>
        <ElTableColumn label="品种" width="120" align="center"><template #default="{ row }"><ElTag size="small" type="info" effect="plain" class="order-symbol-tag">{{ row.symbol }}</ElTag></template></ElTableColumn>
        <ElTableColumn label="方向" width="90" align="center"><template #default="{ row }"><ElTag size="small" :type="row.side === 'buy' ? 'success' : 'danger'" effect="light" class="order-side-tag">{{ sideLabel(row.side) }}</ElTag></template></ElTableColumn>
        <ElTableColumn label="手数" width="90" align="center"><template #default="{ row }"><span class="order-number" :class="{ muted: row.volume === null }">{{ row.volume ?? '—' }}</span></template></ElTableColumn>
        <ElTableColumn label="开仓价" width="125" align="center"><template #default="{ row }"><span class="order-number" :class="{ muted: row.openPrice === null }">{{ row.openPrice ?? '—' }}</span></template></ElTableColumn>
        <ElTableColumn label="止损" width="125" align="center"><template #default="{ row }"><span class="order-number order-stop" :class="{ muted: row.reportedSL === null }">{{ row.reportedSL ?? '—' }}</span></template></ElTableColumn>
        <ElTableColumn label="止盈" width="125" align="center"><template #default="{ row }"><span class="order-number order-target" :class="{ muted: row.reportedTP === null }">{{ row.reportedTP ?? '—' }}</span></template></ElTableColumn>
        <ElTableColumn label="盈亏比" width="120" align="center"><template #default="{ row }"><span class="order-number order-ratio" :class="{ muted: orderRiskReward(row as RecordedOrder) === '—' }" title="当前止盈距离 / 止损距离，不计交易成本，不代表实际盈利">{{ orderRiskReward(row as RecordedOrder) }}</span></template></ElTableColumn>
        <ElTableColumn label="当前状态" width="135" align="center"><template #default="{ row }">
          <ElTag v-if="row.lockedAt" class="order-status-tag is-locked" effect="plain" type="success">{{ orderStatusLabels[row.status as OrderStatus] }}</ElTag>
          <ElPopover v-else trigger="click" placement="bottom" :width="220" popper-class="order-status-popover"
            :visible="openStatusMenuId === row.id" :disabled="locked && changingId !== row.id"
            @update:visible="visible => setStatusMenuVisibility(row.id, visible)">
            <template #reference><ElTag class="order-status-tag" :class="{ 'is-open': openStatusMenuId === row.id }" effect="plain" :type="row.status === 'closed' ? 'success' : row.status === 'open' ? 'warning' : 'info'" tabindex="0" role="button" aria-haspopup="menu" :aria-expanded="openStatusMenuId === row.id" :aria-label="`修改订单 ${row.ticket} 状态`" @keydown.enter.prevent="setStatusMenuVisibility(row.id, openStatusMenuId !== row.id)" @keydown.space.prevent="setStatusMenuVisibility(row.id, openStatusMenuId !== row.id)">{{ orderStatusLabels[row.status as OrderStatus] }}<ChevronDown :size="13"/></ElTag></template>
            <div class="status-menu" role="menu" :aria-label="`修改订单 ${row.ticket} 状态`">
              <div class="status-menu-title">修改订单状态</div>
              <ElButton v-for="option in statusMenuOptions" :key="option.value" text class="status-menu-option"
                :class="[`status-${option.value}`, { selected: row.status === option.value }]" :disabled="locked"
                role="menuitemradio" :aria-checked="row.status === option.value" @click="selectStatusFromMenu(row, option.value)">
                <span class="status-menu-row"><span class="status-menu-dot"/><span class="status-menu-copy"><strong>{{ orderStatusLabels[option.value] }}</strong><small>{{ option.description }}</small></span><Check v-if="row.status === option.value" :size="15" class="status-menu-check"/></span>
              </ElButton>
            </div>
          </ElPopover>
        </template></ElTableColumn>
        <ElTableColumn label="锁定状态" width="140" align="center"><template #default="{ row }">
          <ElTag v-if="row.lockedAt" class="order-lock-tag" effect="light" type="info" :title="`锁定于 ${timestamp(row.lockedAt)}`"><LockKeyhole :size="13"/>已锁定</ElTag>
          <ElButton v-else-if="row.status === 'closed'" size="small" plain :disabled="locked" :loading="lockingId === row.id" @click="lockOrder(row as RecordedOrder)">锁定订单</ElButton>
          <span v-else class="order-lock-pending">待平仓</span>
        </template></ElTableColumn>
        <ElTableColumn label="更新时间" min-width="180" align="center"><template #default="{ row }"><span class="order-updated-at">{{ timestamp(row.updatedAt) }}</span></template></ElTableColumn>
      </ElTable>
      <ElEmpty v-else description="当前计划还没有关联订单"/>
    </ElCard>

    <ElDialog v-model="compareDialog" class="order-compare-dialog" title="更新订单" width="min(720px, calc(100vw - 32px))" :before-close="closeComparison" :close-on-click-modal="false" :close-on-press-escape="!busy">
      <div class="order-compare-content">
        <p class="order-help">选择或粘贴一张完整宽度的单行 MT5 订单截图，支持浅色表格及整行蓝色选中。系统自动判断挂单、持仓中或已平仓布局，只用订单号匹配当前计划，并比较手数、止损、止盈；不会修改状态或其他字段。</p>
        <input ref="compareFileInput" type="file" hidden accept="image/png,image/jpeg,image/webp" @change="chooseComparisonImage"/>
        <div class="compare-picker"><ElButton :disabled="locked || !!comparePreview" :loading="compareRecognizing" @click="compareFileInput?.click()"><ImagePlus :size="15"/>选择对比截图</ElButton></div>
        <ElAlert v-if="compareError" :title="compareError" type="error" show-icon :closable="false" class="compare-alert"/>
        <ElImage v-if="comparePreview" :src="comparePreview" :preview-src-list="[comparePreview]" preview-teleported fit="contain" class="order-preview"/>
        <div v-if="compareWarnings.length" class="compare-warnings"><ElAlert v-for="(warning, index) in compareWarnings" :key="index" :title="warning" type="warning" :closable="false" class="order-warning"/></div>
        <section v-if="comparison" class="compare-result">
          <div class="compare-order"><span>匹配订单</span><strong>{{ comparison.order.ticket }}</strong></div>
          <ElTable v-if="comparison.changes.length" :data="comparison.changes" size="small">
            <ElTableColumn label="字段"><template #default="{ row }">{{ compareLabels[row.field as CompareField] }}</template></ElTableColumn>
            <ElTableColumn label="当前记录"><template #default="{ row }">{{ displayNumber(row.from) }}</template></ElTableColumn>
            <ElTableColumn label="截图识别"><template #default="{ row }">{{ displayNumber(row.to) }}</template></ElTableColumn>
          </ElTable>
          <div v-if="comparison.changes.length" class="compare-context">
            <ElForm label-position="top">
              <ElFormItem label="修改原因" required>
                <ElInput v-model="compareReason" type="textarea" :rows="3" maxlength="500" show-word-limit resize="vertical" placeholder="记录本次调整的原因" :disabled="compareSaving"/>
              </ElFormItem>
              <ElFormItem label="当时情绪" required>
                <div class="emotion-options" role="radiogroup" aria-label="当时情绪">
                  <ElButton v-for="option in emotionOptions" :key="option.value" size="small"
                    :type="compareEmotion === option.value ? 'primary' : 'default'" :plain="compareEmotion !== option.value"
                    :disabled="compareSaving" role="radio" :aria-checked="compareEmotion === option.value"
                    @click="compareEmotion = option.value">{{ option.label }}</ElButton>
                </div>
              </ElFormItem>
            </ElForm>
          </div>
          <ElAlert v-else title="未发现可更新变化" type="info" show-icon :closable="false"/>
        </section>
      </div>
      <template #footer><ElButton :disabled="compareRecognizing || compareSaving" @click="closeComparison()">取消</ElButton><ElButton type="primary" :loading="compareSaving" :disabled="locked || !!comparison?.order.lockedAt || !canSaveComparison" @click="saveComparison">确认更新</ElButton></template>
    </ElDialog>
  </div>
</template>

<style scoped>
.linked-orders{min-width:0}.order-ratio{white-space:nowrap}.order-status-tag.is-locked{cursor:default}.order-status-tag.is-locked:hover{filter:none;box-shadow:none}.order-lock-tag :deep(.el-tag__content){display:flex;align-items:center;gap:5px}.order-lock-pending{font-size:12px;color:var(--el-text-color-placeholder)}
.order-compare-content{display:grid;gap:14px}.order-compare-content .compare-alert,.order-compare-content .order-preview,.order-compare-content .order-warning,.order-compare-content .compare-result{margin-top:0;margin-bottom:0}.compare-picker{display:flex;align-items:center}.compare-picker .el-button{margin:0}.compare-warnings{display:grid;gap:10px}.compare-warnings .order-warning{margin:0}
.compare-context{padding-top:2px}.compare-context :deep(.el-form-item:last-child){margin-bottom:0}.emotion-options{display:flex;gap:8px;flex-wrap:wrap}.emotion-options .el-button{margin:0}
.linked-orders{display:grid;gap:18px}.order-import-card{border-top:3px solid var(--el-color-primary-light-7)}.order-help{font-size:12px;line-height:1.8;color:var(--el-text-color-secondary);overflow-wrap:anywhere}.order-import-intro{padding:12px 14px;border-left:3px solid var(--el-color-primary-light-5);border-radius:0 8px 8px 0;background:var(--el-color-primary-light-9)}.order-actions{display:flex;align-items:center;gap:8px;flex-wrap:wrap}.order-actions .el-button{margin:0}.order-preview{display:block;width:100%;max-height:320px;margin:16px 0;padding:8px;background:var(--el-fill-color-extra-light);border:1px solid var(--el-border-color-lighter);border-radius:10px}.order-warning{margin-top:10px}.order-drafts{margin-top:20px;padding-top:20px;border-top:1px solid var(--el-border-color-lighter)}.order-draft-table{--el-table-header-bg-color:var(--el-fill-color-extra-light);border-radius:8px;overflow:hidden}.order-draft-form{margin-top:18px;padding:18px;border:1px solid var(--el-border-color-lighter);border-radius:10px;background:color-mix(in srgb,var(--el-fill-color-extra-light) 64%,transparent)}.order-fields{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:0 16px;margin-top:14px}.order-fields-primary{grid-template-columns:repeat(5,minmax(0,1fr))}.order-fields .el-input-number{width:100%}.order-raw{margin-top:10px;padding:12px;white-space:pre-wrap;overflow-wrap:anywhere;color:var(--el-text-color-secondary);font-size:12px;background:var(--el-fill-color-extra-light);border-radius:8px}.order-list-card :deep(.el-card__body){padding:0}.order-list-card :deep(.el-empty){padding:24px}.order-list-table{width:100%;--el-table-header-bg-color:var(--plan-table-bg,var(--el-fill-color-extra-light));--el-table-row-hover-bg-color:var(--el-fill-color-extra-light)}.order-list-table :deep(.el-table__cell){padding-block:12px}.order-ticket{font:650 12px/1.4 'Manrope Variable',sans-serif;color:var(--el-text-color-primary);letter-spacing:.2px}.order-status-tag{cursor:pointer;font-weight:550}.compare-alert{margin-top:14px}.compare-result{display:grid;gap:14px;margin-top:18px;padding:16px;border:1px solid var(--el-border-color-lighter);border-radius:10px;background:var(--el-fill-color-extra-light)}.compare-order{display:flex;gap:12px;align-items:center;font-size:13px}.compare-order span{color:var(--el-text-color-secondary)}.compare-order strong{font-family:'Manrope Variable',sans-serif}summary{width:max-content;max-width:100%;padding:8px 0;cursor:pointer;color:var(--el-color-primary);font-size:13px;font-weight:550}details+details{margin-top:6px}@media(max-width:900px){.order-fields-primary,.order-fields{grid-template-columns:repeat(2,minmax(0,1fr))}.plan-card-heading{align-items:flex-start;flex-direction:column}.order-actions{width:100%}}@media(max-width:560px){.order-fields-primary,.order-fields{grid-template-columns:1fr}.order-actions .el-button{flex:1}.order-actions .el-button:first-child{flex-basis:100%}.order-draft-form{padding:14px}}
.order-list-heading h2{gap:9px}.order-count-tag{--el-tag-bg-color:var(--el-color-primary-light-9);--el-tag-border-color:var(--el-color-primary-light-7);--el-tag-text-color:var(--el-color-primary);font-weight:600}.order-list-card{overflow:hidden}.order-list-table{--el-table-header-bg-color:var(--el-fill-color-extra-light);--el-table-header-text-color:var(--el-text-color-secondary);--el-table-border-color:var(--el-border-color-extra-light);--el-table-row-hover-bg-color:var(--el-color-primary-light-9)}.order-list-table :deep(.cell){padding-inline:14px}.order-list-table :deep(.el-table__header th.el-table__cell){padding-block:11px;font-size:11px;font-weight:600;letter-spacing:.35px}.order-list-table :deep(.el-table__body td.el-table__cell){height:58px;padding-block:12px;border-bottom-color:var(--el-border-color-extra-light)}.order-list-table :deep(.el-table__row:last-child td.el-table__cell){border-bottom:0}.order-list-table :deep(.el-table__inner-wrapper::before){background:var(--el-border-color-extra-light)}.saved-order-ticket{display:flex;align-items:center;gap:9px;min-width:0}.saved-order-ticket>span{width:29px;height:29px;display:grid;place-items:center;flex:0 0 auto;border-radius:8px;color:var(--el-color-primary);background:var(--el-color-primary-light-9)}.saved-order-ticket strong{overflow:hidden;text-overflow:ellipsis;font:650 12px/1.4 'Manrope Variable',sans-serif;color:var(--el-text-color-primary);letter-spacing:.25px}.order-symbol-tag{max-width:100%;font-weight:550}.order-symbol-tag :deep(.el-tag__content){overflow:hidden;text-overflow:ellipsis}.order-side-tag{min-width:46px;justify-content:center;font-weight:600}.order-number{font:600 12px/1.4 'Manrope Variable',sans-serif;font-variant-numeric:tabular-nums;color:var(--el-text-color-primary)}.order-number.muted{color:var(--el-text-color-placeholder);font-weight:500}.order-stop:not(.muted){color:color-mix(in srgb,var(--el-color-danger) 82%,var(--el-text-color-primary))}.order-target:not(.muted){color:color-mix(in srgb,var(--el-color-success) 82%,var(--el-text-color-primary))}.order-status-tag{min-height:28px;border-radius:7px;transition:background-color .18s ease,border-color .18s ease,box-shadow .18s ease}.order-status-tag :deep(.el-tag__content){display:flex;align-items:center;gap:4px}.order-status-tag:hover{filter:saturate(1.08);box-shadow:0 2px 8px color-mix(in srgb,var(--el-text-color-primary) 10%,transparent)}.order-status-tag:focus-visible{outline:2px solid var(--el-color-primary-light-5);outline-offset:2px}.order-updated-at{white-space:nowrap;font:500 11px/1.5 'Manrope Variable',sans-serif;font-variant-numeric:tabular-nums;color:var(--el-text-color-secondary)}@media(max-width:760px){.order-list-table :deep(.el-table__body td.el-table__cell){height:54px}.order-status-tag{min-height:30px}.saved-order-ticket>span{width:31px;height:31px}}
.order-status-tag svg{transition:transform .18s ease}.order-status-tag.is-open svg{transform:rotate(180deg)}:global(.order-status-popover.el-popover){padding:7px;border-color:var(--el-border-color-light);border-radius:10px;background:var(--el-bg-color-overlay);box-shadow:var(--el-box-shadow-light)}.status-menu{display:grid;gap:3px}.status-menu-title{padding:5px 8px 8px;border-bottom:1px solid var(--el-border-color-extra-light);margin-bottom:2px;font-size:11px;font-weight:600;color:var(--el-text-color-secondary)}.status-menu-option.el-button{width:100%;height:auto;margin:0;padding:0;border-radius:7px;color:var(--el-text-color-primary)}.status-menu-option.el-button :deep(>span){width:100%}.status-menu-row{display:grid;grid-template-columns:9px minmax(0,1fr) 16px;align-items:center;gap:10px;width:100%;padding:8px 9px;text-align:left}.status-menu-dot{width:8px;height:8px;border-radius:50%;background:var(--el-color-info)}.status-menu-copy{display:grid;gap:2px;min-width:0}.status-menu-copy strong{font-size:12px;font-weight:600;line-height:1.4;color:var(--el-text-color-primary)}.status-menu-copy small{font-size:10px;font-weight:400;line-height:1.4;color:var(--el-text-color-secondary)}.status-menu-check{color:var(--el-color-primary)}.status-menu-option:hover,.status-menu-option:focus-visible{background:var(--el-fill-color-light)}.status-menu-option:focus-visible{outline:2px solid var(--el-color-primary-light-5);outline-offset:-2px}.status-menu-option.status-pending.selected{background:var(--el-color-info-light-9)}.status-menu-option.status-open.selected{background:var(--el-color-warning-light-9)}.status-menu-option.status-closed.selected{background:var(--el-color-success-light-9)}.status-menu-option.status-open .status-menu-dot{background:var(--el-color-warning)}.status-menu-option.status-closed .status-menu-dot{background:var(--el-color-success)}.status-menu-option.status-pending .status-menu-check{color:var(--el-color-info)}.status-menu-option.status-open .status-menu-check{color:var(--el-color-warning)}.status-menu-option.status-closed .status-menu-check{color:var(--el-color-success)}
</style>
