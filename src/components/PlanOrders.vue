<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import {
  ElAlert, ElButton, ElCard, ElDialog, ElEmpty, ElForm, ElFormItem, ElImage, ElInput,
  ElInputNumber, ElMessage, ElMessageBox, ElOption, ElPopover, ElRadioButton,
  ElRadioGroup, ElSelect, ElSkeleton, ElTable, ElTableColumn, ElTag,
} from 'element-plus'
import { ImagePlus, Plus } from 'lucide-vue-next'
import { emptyOrder, orderStatusLabels, type OcrOrderRow, type OrderFields, type OrderStatus, type RecordedOrder } from '../orders'

interface DraftRow { id: string; fields: OrderFields; warnings: string[]; raw?: Record<string, string> }
interface OcrResult { rows: OcrOrderRow[]; detectedStatus: OrderStatus; ambiguous: boolean; warnings: string[] }
type CompareField = 'volume' | 'reportedSL' | 'reportedTP'
interface CompareChange { field: CompareField; from: number | null; to: number }
interface ComparisonDraft { order: RecordedOrder; changes: CompareChange[] }
const props = defineProps<{ planId: string; active: boolean; disabled?: boolean }>()
const emit = defineEmits<{ stateChange: [state: { dirty: boolean; busy: boolean }] }>()

const orders = ref<RecordedOrder[]>([]), drafts = ref<DraftRow[]>([]), currentId = ref('')
const loading = ref(false), recognizing = ref(false), saving = ref(false), changingId = ref('')
const error = ref(''), warnings = ref<string[]>([]), preview = ref('')
const compareDialog = ref(false), compareRecognizing = ref(false), compareSaving = ref(false)
const comparePreview = ref(''), compareError = ref(''), compareWarnings = ref<string[]>([]), comparison = ref<ComparisonDraft | null>(null)
const fileInput = ref<HTMLInputElement>(), compareFileInput = ref<HTMLInputElement>()
let generation = 0, readController: AbortController | undefined, ocrController: AbortController | undefined
let compareController: AbortController | undefined, writeController: AbortController | undefined
const current = computed(() => drafts.value.find(row => row.id === currentId.value))
const dirty = computed(() => drafts.value.length > 0 || !!preview.value || !!comparePreview.value || !!comparison.value)
const busy = computed(() => loading.value || recognizing.value || saving.value || compareRecognizing.value || compareSaving.value || !!changingId.value)
const locked = computed(() => !!props.disabled || busy.value)
const fieldKeys: (keyof OrderFields)[] = ['ticket', 'status', 'symbol', 'side', 'volume', 'pendingTime', 'pendingPrice',
  'openTime', 'openPrice', 'closeTime', 'closePrice', 'reportedSL', 'reportedTP', 'reportedProfit']
const compareLabels: Record<CompareField, string> = { volume: '手数', reportedSL: '止损', reportedTP: '止盈' }

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
  if (locked.value) return
  compareError.value = ''; compareDialog.value = true
}
async function recognizeComparison(file?: File) {
  if (!file || locked.value) return
  if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type) || !file.size || file.size > 5 * 1024 * 1024) {
    compareError.value = '请选择一张不超过 5 MB 的 PNG、JPEG 或 WEBP 图片。'; return
  }
  if (comparePreview.value || comparison.value) { compareError.value = '请先取消当前对比，再选择另一张截图。'; return }
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
  const draft = comparison.value, version = generation, controller = new AbortController(); writeController = controller
  compareSaving.value = true; compareError.value = ''
  try {
    const fields = Object.fromEntries(draft.changes.map(change => [change.field, change.to]))
    const result = await json<{ order: RecordedOrder; changed: boolean }>(await fetch(`/api/plans/${encodeURIComponent(props.planId)}/orders/${encodeURIComponent(draft.order.id)}/compared-fields`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ expectedUpdatedAt: draft.order.updatedAt, ...fields }), signal: controller.signal,
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
  if (locked.value || order.status === status) return
  changingId.value = order.id; error.value = ''
  try {
    const result = await json<{ order: RecordedOrder }>(await fetch(`/api/plans/${encodeURIComponent(props.planId)}/orders/${encodeURIComponent(order.id)}/status`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status }),
    }))
    orders.value = orders.value.map(item => item.id === order.id ? result.order : item)
    ElMessage.success(`订单已更新为${orderStatusLabels[result.order.status]}。`)
  } catch (problem) { error.value = (problem as Error).message }
  finally { changingId.value = '' }
}
function changeStatusFromTable(order: unknown, status: unknown) { void changeStatus(order as RecordedOrder, status as OrderStatus) }
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

watch(() => props.planId, () => { generation++; readController?.abort(); ocrController?.abort(); compareController?.abort(); writeController?.abort(); drafts.value = []; currentId.value = ''; resetPreview(); resetComparison(); compareDialog.value = false; void load() }, { immediate: true })
window.addEventListener('paste', pasteImage, true)
onBeforeUnmount(() => { generation++; readController?.abort(); ocrController?.abort(); compareController?.abort(); writeController?.abort(); resetPreview(); resetComparison(); window.removeEventListener('paste', pasteImage, true); emit('stateChange', { dirty: false, busy: false }) })
defineExpose({ confirmDiscard })
</script>

<template>
  <div class="linked-orders">
    <ElCard shadow="never" class="order-import-card">
      <template #header><div class="plan-card-heading"><div><h2>导入订单</h2><span>本机识别 · 原图不保存</span></div><div class="order-actions"><ElButton :disabled="locked" :loading="recognizing" @click="fileInput?.click()"><ImagePlus :size="15"/>选择截图</ElButton><ElButton :disabled="locked || !orders.length" @click="openComparison">对比订单截图</ElButton><ElButton :disabled="locked" @click="addManual"><Plus :size="15"/>手动添加一行</ElButton></div></div></template>
      <input ref="fileInput" type="file" hidden accept="image/png,image/jpeg,image/webp" @change="chooseImage"/>
      <p class="order-help">选择或粘贴一张完整宽度的浅色 MT5 挂单、持仓中或已平仓截图，建议每次截取一行。系统自动判断布局；识别草稿必须对照原图核对后保存。</p>
      <ElAlert v-if="error" :title="error" type="error" show-icon :closable="false"/>
      <ElImage v-if="preview" :src="preview" :preview-src-list="[preview]" preview-teleported fit="contain" class="order-preview"/>
      <ElAlert v-for="(warning, index) in warnings" :key="index" :title="warning" type="warning" :closable="false" class="order-warning"/>
      <section v-if="drafts.length" class="order-drafts">
        <ElTable :data="drafts" row-key="id" size="small"><ElTableColumn type="index" width="48"/><ElTableColumn label="订单号"><template #default="{ row }">{{ row.fields.ticket || '待补' }}</template></ElTableColumn><ElTableColumn label="品种"><template #default="{ row }">{{ row.fields.symbol || '待补' }}</template></ElTableColumn><ElTableColumn label="状态"><template #default="{ row }">{{ orderStatusLabels[row.fields.status as OrderStatus] }}</template></ElTableColumn><ElTableColumn width="94"><template #default="{ row }"><ElButton link type="primary" :disabled="locked" @click="currentId = row.id">{{ currentId === row.id ? '正在核对' : '核对此行' }}</ElButton></template></ElTableColumn></ElTable>
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
      <template #header><div class="plan-card-heading"><div><h2>关联订单</h2><span>{{ orders.length }} 笔</span></div></div></template>
      <ElSkeleton v-if="loading" :rows="3" animated/>
      <ElTable v-else-if="orders.length" :data="orders" size="small" class="order-list-table">
        <ElTableColumn prop="ticket" label="订单号" min-width="150"/>
        <ElTableColumn prop="symbol" label="品种" min-width="110"/>
        <ElTableColumn label="方向" width="82"><template #default="{ row }">{{ sideLabel(row.side) }}</template></ElTableColumn>
        <ElTableColumn label="手数" width="90"><template #default="{ row }">{{ row.volume ?? '—' }}</template></ElTableColumn>
        <ElTableColumn label="开仓价" min-width="110"><template #default="{ row }">{{ row.openPrice ?? '—' }}</template></ElTableColumn>
        <ElTableColumn label="止损" min-width="110"><template #default="{ row }">{{ row.reportedSL ?? '—' }}</template></ElTableColumn>
        <ElTableColumn label="止盈" min-width="110"><template #default="{ row }">{{ row.reportedTP ?? '—' }}</template></ElTableColumn>
        <ElTableColumn label="当前状态" width="116"><template #default="{ row }"><ElPopover trigger="click" placement="bottom" :width="250" :disabled="locked"><template #reference><ElTag class="order-status-tag" effect="plain" :type="row.status === 'closed' ? 'success' : row.status === 'open' ? 'warning' : 'info'">{{ orderStatusLabels[row.status as OrderStatus] }}</ElTag></template><ElRadioGroup :model-value="row.status" size="small" :disabled="locked || changingId === row.id" @change="value => changeStatusFromTable(row, value)"><ElRadioButton v-for="(label, value) in orderStatusLabels" :key="value" :value="value">{{ label }}</ElRadioButton></ElRadioGroup></ElPopover></template></ElTableColumn>
        <ElTableColumn label="更新时间" min-width="170"><template #default="{ row }">{{ timestamp(row.updatedAt) }}</template></ElTableColumn>
      </ElTable>
      <ElEmpty v-else description="当前计划还没有关联订单"/>
    </ElCard>

    <ElDialog v-model="compareDialog" title="对比订单截图" width="min(720px, calc(100vw - 32px))" :before-close="closeComparison" :close-on-click-modal="false" :close-on-press-escape="!busy">
      <p class="order-help">选择或粘贴一张完整宽度的单行订单截图。系统只用订单号匹配当前计划，并比较手数、止损、止盈；不会修改状态或其他字段。</p>
      <input ref="compareFileInput" type="file" hidden accept="image/png,image/jpeg,image/webp" @change="chooseComparisonImage"/>
      <ElButton :disabled="locked || !!comparePreview" :loading="compareRecognizing" @click="compareFileInput?.click()"><ImagePlus :size="15"/>选择对比截图</ElButton>
      <ElAlert v-if="compareError" :title="compareError" type="error" show-icon :closable="false" class="compare-alert"/>
      <ElImage v-if="comparePreview" :src="comparePreview" :preview-src-list="[comparePreview]" preview-teleported fit="contain" class="order-preview"/>
      <ElAlert v-for="(warning, index) in compareWarnings" :key="index" :title="warning" type="warning" :closable="false" class="order-warning"/>
      <section v-if="comparison" class="compare-result">
        <div class="compare-order"><span>匹配订单</span><strong>{{ comparison.order.ticket }}</strong></div>
        <ElTable v-if="comparison.changes.length" :data="comparison.changes" size="small">
          <ElTableColumn label="字段"><template #default="{ row }">{{ compareLabels[row.field as CompareField] }}</template></ElTableColumn>
          <ElTableColumn label="当前记录"><template #default="{ row }">{{ displayNumber(row.from) }}</template></ElTableColumn>
          <ElTableColumn label="截图识别"><template #default="{ row }">{{ displayNumber(row.to) }}</template></ElTableColumn>
        </ElTable>
        <ElAlert v-else title="未发现可更新变化" type="info" show-icon :closable="false"/>
      </section>
      <template #footer><ElButton :disabled="compareRecognizing || compareSaving" @click="closeComparison()">取消</ElButton><ElButton type="primary" :loading="compareSaving" :disabled="locked || !comparison?.changes.length" @click="saveComparison">确认更新</ElButton></template>
    </ElDialog>
  </div>
</template>

<style scoped>
.linked-orders{display:grid;gap:18px}.order-help{font-size:12px;line-height:1.8;color:var(--el-text-color-secondary);overflow-wrap:anywhere}.order-actions{display:flex;gap:10px;flex-wrap:wrap}.order-actions .el-button{margin:0}.order-preview{width:100%;max-height:320px;margin:16px 0;background:var(--el-fill-color-light);border-radius:8px}.order-warning{margin-top:10px}.order-drafts{margin-top:18px;border-top:1px solid var(--el-border-color-lighter);padding-top:18px}.order-draft-form{margin-top:20px}.order-fields{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:0 16px;margin-top:14px}.order-fields-primary{grid-template-columns:repeat(5,minmax(0,1fr))}.order-fields .el-input-number{width:100%}.order-raw{white-space:pre-wrap;overflow-wrap:anywhere;color:var(--el-text-color-secondary);font-size:12px}.order-list-card :deep(.el-card__body){padding:0}.order-list-card :deep(.el-empty){padding:34px}.order-status-tag{cursor:pointer}.order-list-table{--el-table-header-bg-color:var(--plan-table-bg,#fcfbfe)}.compare-alert{margin-top:14px}.compare-result{display:grid;gap:14px;margin-top:18px}.compare-order{display:flex;gap:12px;align-items:center;font-size:13px}.compare-order span{color:var(--el-text-color-secondary)}summary{cursor:pointer;color:var(--el-color-primary);font-size:13px}@media(max-width:900px){.order-fields-primary,.order-fields{grid-template-columns:repeat(2,minmax(0,1fr))}}@media(max-width:560px){.order-fields-primary,.order-fields{grid-template-columns:1fr}.plan-card-heading{align-items:flex-start}.order-actions{width:100%}}
</style>
