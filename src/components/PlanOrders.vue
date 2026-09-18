<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { ElAlert, ElButton, ElCard, ElForm, ElFormItem, ElImage, ElInput, ElInputNumber, ElMessage, ElMessageBox, ElOption, ElSelect, ElSkeleton, ElTable, ElTableColumn } from 'element-plus'
import { emptyOrder, orderFieldLabels, orderStates, pendingTypes, type OrderFields, type OrderOcrRow, type OrderState, type RecordedOrder, type OrderPlan, planLabel } from '../orders'

interface DraftRow { id: string; fields: OrderFields; source: 'manual' | 'screenshot'; observationKey: string; warnings: string[]; raw?: Record<string, string>; attempt?: { fingerprint: string; requestId: string } }
interface Conflict { field: string; label?: string; existing: unknown; incoming: unknown }
interface Failure extends Error { details?: { conflicts?: Conflict[]; ownerPlanId?: string; ownerPlanLabel?: string } }
const props = defineProps<{ planId?: string | null; order?: RecordedOrder; disabled?: boolean; active?: boolean }>()
const emit = defineEmits<{ saved: [order: RecordedOrder] }>()
const plans = ref<OrderPlan[]>([]), selectedPlanId = ref<string | null>(props.planId || null)
const ready = ref(false), loading = ref(false), saving = ref(false), recognizing = ref(false), confirming = ref(false)
const rows = ref<DraftRow[]>([]), currentId = ref(''), error = ref(''), conflicts = ref<Conflict[]>([]), owner = ref('')
const ocrMode = ref<'pending' | 'open' | 'closed'>('closed'), captureOpen = ref(false), preview = ref(''), ocrWarnings = ref<string[]>([])
const imageInput = ref<HTMLInputElement>()
let generation = 0, readController: AbortController | undefined, writeController: AbortController | undefined, ocrController: AbortController | undefined
const current = computed(() => rows.value.find(row => row.id === currentId.value))
const busy = computed(() => loading.value || saving.value || recognizing.value || confirming.value)
const dirty = computed(() => rows.value.length > 0 || !!preview.value || (!props.order && (selectedPlanId.value || null) !== (props.planId || null)))
const needsBeforeUnload = computed(() => busy.value || dirty.value)
const terminal = computed(() => !!props.order && ['cancelled', 'expired'].includes(props.order.state))
const locked = computed(() => !!props.disabled || busy.value || !ready.value || terminal.value)

const fieldKeys = Object.keys(orderFieldLabels) as (keyof OrderFields)[]
function display(value: unknown, field?: string) {
  if (value === null || value === undefined || value === '') return '未记录'
  if (field === 'state') return orderStates[value as OrderState] || String(value)
  if (field === 'side') return value === 'buy' ? '做多' : value === 'sell' ? '做空' : String(value)
  return typeof value === 'object' ? JSON.stringify(value) : String(value)
}
function clearError() { error.value = ''; conflicts.value = []; owner.value = '' }
function showError(e: unknown, fallback: string) {
  const failure = e as Failure
  error.value = failure.name === 'AbortError' ? fallback : failure.message
  conflicts.value = failure.details?.conflicts || []; owner.value = failure.details?.ownerPlanLabel || failure.details?.ownerPlanId || ''
}
async function json<T>(response: Response): Promise<T> {
  const data = await response.json().catch(() => { throw new Error('服务返回无效响应，草稿已保留。') })
  if (!response.ok) throw Object.assign(new Error(data.error || '操作失败。'), { details: data.details })
  return data as T
}
async function confirm(message: string) {
  confirming.value = true
  try { await ElMessageBox.confirm(message, '确认操作', { confirmButtonText: '确认', cancelButtonText: '保留当前内容', type: 'warning', closeOnClickModal: false }); return true }
  catch { return false } finally { confirming.value = false }
}
function resetImage() { if (preview.value) URL.revokeObjectURL(preview.value); preview.value = ''; ocrWarnings.value = [] }
function selectRow(id: string) { if (locked.value) return; currentId.value = id; clearError() }
function addManual(order?: RecordedOrder) {
  if (locked.value) return
  order = order || props.order
  const fields = order ? Object.fromEntries(fieldKeys.map(key => [key, order[key]])) as unknown as OrderFields : emptyOrder()
  // This is a new observation, independent of earlier screenshot identities.
  const row: DraftRow = { id: crypto.randomUUID(), fields, source: 'manual', observationKey: `manual:${crypto.randomUUID()}`, warnings: [] }
  rows.value.push(row); currentId.value = row.id; clearError()
}
async function discardRow() {
  if (locked.value || !current.value || !await confirm('丢弃当前这一行未保存的订单草稿？其他行及已保存订单会保留。')) return
  rows.value = rows.value.filter(row => row.id !== currentId.value); currentId.value = rows.value[0]?.id || ''; clearError()
}
async function closeCapture() {
  if (locked.value) return
  if (preview.value && !await confirm('关闭原图预览？识别生成的订单草稿会继续保留。')) return
  resetImage(); captureOpen.value = false
}
async function changeState(value: OrderState) {
  if (locked.value || !current.value || value === current.value.fields.state) return
  if (!await confirm('切换当前观察的阶段？挂单目标价、实际开仓和实际平仓使用不同字段；不适用的草稿字段会清空，已保存订单不受影响。')) return
  const fields = current.value.fields; fields.state = value
  if (value === 'pending') fields.orderType = ''
  else if (['buy', 'sell'].includes(fields.orderType)) fields.orderType = ''
  if (['pending', 'cancelled', 'expired'].includes(value)) { fields.volume = null; fields.openTime = ''; fields.openPrice = null }
  if (value !== 'closed') { fields.closeTime = ''; fields.closePrice = null; fields.reportedProfit = null; fields.closeReason = '' }
  clearError()
}
function normalized(fields: OrderFields): OrderFields {
  const value = { ...fields, ticket: fields.ticket.trim(), symbol: fields.symbol.trim(), openTime: fields.openTime.trim(), closeTime: fields.closeTime.trim() }
  for (const key of ['volume', 'pendingVolume', 'pendingPrice', 'openPrice', 'closePrice', 'reportedSL', 'reportedTP', 'reportedProfit'] as const) value[key] = value[key] ?? null
  if (['pending', 'cancelled', 'expired'].includes(value.state)) { value.volume = null; value.openPrice = null; value.openTime = '' }
  if (value.state !== 'closed') { value.closeTime = ''; value.closePrice = null; value.reportedProfit = null; value.closeReason = '' }
  return value
}
function problem(fields: OrderFields) {
  if (!/^\d+$/.test(fields.ticket)) return '请核对并填写纯数字订单号，订单号必须完整。'
  if (!fields.symbol || !['buy', 'sell'].includes(fields.side)) return '请补齐品种和方向。'
  for (const key of ['volume', 'pendingVolume', 'pendingPrice', 'openPrice', 'closePrice', 'reportedSL', 'reportedTP'] as const) {
    const value = fields[key]
    if (value !== null && (!Number.isFinite(value) || value <= 0)) return `${orderFieldLabels[key]}须为正有限数。`
  }
  if (fields.reportedProfit !== null && !Number.isFinite(fields.reportedProfit)) return '截图盈利须为有效数字，未知请留空。'
  if (fields.state === 'pending' && (!pendingTypes.includes(fields.orderType) || fields.pendingPrice === null || fields.pendingVolume === null)) return '挂单需填写类型、目标价和挂单手数。'
  if (['open', 'closed'].includes(fields.state) && (fields.openPrice === null || fields.volume === null)) return '请填写实际开仓价和实际成交手数。'
  if (fields.state === 'closed' && fields.closePrice === null) return '已平仓需填写实际平仓价；时间未知可留空。'
  for (const key of ['openTime', 'closeTime', 'pendingTime', 'expiresAt'] as const) if (fields[key] && !/^\d{4}\.\d{2}\.\d{2} \d{2}:\d{2}:\d{2}$/.test(fields[key])) return `${orderFieldLabels[key]}格式为 YYYY.MM.DD HH:mm:ss。`
  return ''
}
async function load() {
  if (props.disabled || busy.value) return
  clearError()
  const version = generation, controller = new AbortController(); readController = controller
  const timer = window.setTimeout(() => controller.abort(), 30000); loading.value = true
  try {
    const data = await json<{ plans: OrderPlan[] }>(await fetch('/api/plans', { signal: controller.signal }))
    if (version === generation) { plans.value = data.plans; ready.value = true }
  } catch (e) { if (version === generation) showError(e, '读取超时，请重试；当前草稿保留。') }
  finally { window.clearTimeout(timer); if (version === generation) { loading.value = false; readController = undefined } }
}
async function save() {
  if (locked.value || !current.value) return
  const row = current.value, fields = normalized(row.fields), message = problem(fields)
  clearError(); if (message) { error.value = message; return }
  if (props.order && fields.ticket.replace(/^0+(?=\d)/, '') !== props.order.ticket) { error.value = '此处只能补充当前订单；其他订单请返回列表录入。'; return }
  if (!props.order && selectedPlanId.value && !await confirm(`确认将本行订单关联计划 ${selectedPlanId.value}？保存后不自动转移归属。`)) return
  const body = { ...fields, source: row.source, observationKey: row.observationKey, ...(!props.order ? { planId: selectedPlanId.value || null } : {}) }
  const fingerprint = JSON.stringify(body)
  const attempt = row.attempt?.fingerprint === fingerprint ? row.attempt : { fingerprint, requestId: crypto.randomUUID() }
  row.attempt = attempt
  const version = generation, controller = new AbortController(); writeController = controller
  const timer = window.setTimeout(() => controller.abort(), 30000); saving.value = true
  try {
    const data = await json<{ orders: RecordedOrder[]; order: RecordedOrder; changed: boolean }>(await fetch(props.order ? `/api/orders/${encodeURIComponent(props.order.id)}/observations` : '/api/orders', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...body, requestId: attempt.requestId }), signal: controller.signal,
    }))
    if (version !== generation) return
    rows.value = rows.value.filter(item => item.id !== row.id); currentId.value = rows.value[0]?.id || ''
    if (!rows.value.length) resetImage()
    emit('saved', data.order); ElMessage.success(data.changed ? '订单观察已保存。' : '此观察已记录，无需重复保存。')
  } catch (e) { if (version === generation) showError(e, '保存超时，结果待确认。请保留相同内容重试；草稿未丢弃。') }
  finally { window.clearTimeout(timer); if (version === generation) { saving.value = false; writeController = undefined } }
}
async function recognize(file?: File) {
  if (!file || locked.value) return
  if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type) || !file.size || file.size > 5 * 1024 * 1024) { error.value = '请选择一张不超过 5 MB 的 PNG、JPEG 或 WEBP 图片。'; return }
  if (rows.value.some(row => row.source === 'screenshot')) { error.value = '请先保存或丢弃当前图片的所有识别草稿，再识别下一张；手工草稿可保留。'; return }
  resetImage(); preview.value = URL.createObjectURL(file); captureOpen.value = true; clearError()
  const version = generation, mode = ocrMode.value, controller = new AbortController(); ocrController = controller
  const timer = window.setTimeout(() => controller.abort(), 180000); recognizing.value = true
  try {
    const body = new FormData(); body.append('image', file)
    const data = await json<{ rows: OrderOcrRow[]; imageHash: string; warnings: string[] }>(await fetch(`/api/order-ocr/${mode}`, { method: 'POST', body, signal: controller.signal }))
    if (version !== generation) return
    const candidates: DraftRow[] = data.rows.map(item => ({ id: crypto.randomUUID(), fields: { ...emptyOrder(mode), ...Object.fromEntries(fieldKeys.map(key => [key, item[key] ?? emptyOrder(mode)[key]])) } as OrderFields,
      source: 'screenshot', observationKey: `image:${data.imageHash}:${mode}:${item.rowIndex}`, warnings: item.warnings || [], raw: item.raw }))
    for (const row of candidates) {
      if (mode === 'pending') { row.fields.pendingVolume = row.fields.volume; row.fields.volume = null }
      else row.fields.orderType = '' // buy/sell is direction evidence, not the original execution type.
    }
    rows.value.push(...candidates); currentId.value = candidates[0]?.id || currentId.value; ocrWarnings.value = data.warnings || []
    if (!candidates.length) error.value = '未找到可核对的订单行，请手动补录。'
  } catch (e) { if (version === generation) showError(e, '识别超时，未保存任何订单。可稍后重试或手动补录。') }
  finally { window.clearTimeout(timer); if (version === generation) { recognizing.value = false; ocrController = undefined } }
}
function chooseImage(event: Event) { const input = event.target as HTMLInputElement; void recognize(input.files?.[0]); input.value = '' }
function pasteImage(event: ClipboardEvent) {
  if (!captureOpen.value || !props.active || props.disabled) return
  const images = Array.from(event.clipboardData?.files || []).filter(file => file.type.startsWith('image/'))
  if (!images.length) return
  event.preventDefault(); event.stopImmediatePropagation()
  if (images.length !== 1) { error.value = '请每次粘贴一张图片。'; return }
  void recognize(images[0])
}
watch([() => props.planId, () => props.order?.id], () => {
  selectedPlanId.value = props.order?.planId || props.planId || null
  generation++; readController?.abort(); writeController?.abort(); ocrController?.abort(); resetImage()
  loading.value = false; saving.value = false; recognizing.value = false; confirming.value = false
  rows.value = []; currentId.value = ''; captureOpen.value = false; ready.value = false; clearError(); void load()
}, { immediate: true })
watch(() => props.disabled, value => { if (!value && !ready.value && !busy.value && !error.value) void load() })
window.addEventListener('paste', pasteImage, true)
onBeforeUnmount(() => { generation++; readController?.abort(); writeController?.abort(); ocrController?.abort(); resetImage(); window.removeEventListener('paste', pasteImage, true) })
defineExpose({ dirty, busy, needsBeforeUnload, addManual })
</script>

<template>
  <ElCard shadow="never" class="plan-orders">
    <template #header><div class="plan-card-heading"><h2>{{ order ? '补充订单观察' : '录入交易订单' }}</h2><div><ElButton :disabled="locked" @click="captureOpen = true">截图录入订单</ElButton><ElButton :disabled="locked" @click="addManual()">手动补录</ElButton></div></div></template>
    <div v-if="!order" class="order-plan-choice"><label>关联计划（可不选）</label><ElSelect v-model="selectedPlanId" clearable filterable :disabled="locked" placeholder="计划外订单"><ElOption v-for="plan in plans" :key="plan.id" :value="plan.id" :label="planLabel(plan)"/></ElSelect></div>
    <p class="order-help">{{ order ? (order.planId ? `归属计划：${order.planId}` : '计划外订单') : (selectedPlanId ? `本次创建关联计划：${selectedPlanId}` : '本次创建为计划外订单') }}</p>
    <ElAlert v-if="terminal" title="此订单已取消或失效，保留历史，不追加新的成交观察。" type="info" :closable="false"/>
    <p class="order-help">同一订单号持续补充挂单、持仓和成交过程，仅记录一个账户。先核对，再确认保存；截图止损 / 止盈不改原计划价位。</p>
    <ElAlert v-if="error" :title="error" type="error" show-icon :closable="false"/>
    <p v-if="owner" class="order-help">订单已有归属计划：{{ owner }}。当前计划不会复制或转移该订单。</p>
    <ElTable v-if="conflicts.length" :data="conflicts" size="small"><ElTableColumn label="冲突字段"><template #default="{ row }">{{ row.label || orderFieldLabels[row.field as keyof OrderFields] || row.field }}</template></ElTableColumn><ElTableColumn label="已保存"><template #default="{ row }">{{ display(row.existing, row.field) }}</template></ElTableColumn><ElTableColumn label="本次输入"><template #default="{ row }">{{ display(row.incoming, row.field) }}</template></ElTableColumn></ElTable>
    <section v-if="captureOpen" class="order-capture">
      <h3>订单截图识别</h3>
      <p class="order-help">请选择截图所处阶段，保留完整列宽。支持固定布局的表格和无表头单行；当前市价和浮盈不作为平仓结果。选择图片或在此区域打开时粘贴图片。</p>
      <p v-if="ocrMode === 'open'" class="order-help">持仓中截图请保留以下列顺序与整行宽度：品种、订单号、开仓时间、类型、交易量、开仓价、止损、止盈、当前价、浮动盈利。可以只截一行，不需要表头。订单号与开仓时间分别识别，右侧当前价与浮盈不录入；空白或不可靠的字段需核对补填。</p>
      <div class="order-actions"><ElSelect v-model="ocrMode" :disabled="locked || !!preview || rows.some(row => row.source === 'screenshot')" aria-label="截图阶段" style="width:160px"><ElOption label="挂单" value="pending"/><ElOption label="持仓中" value="open"/><ElOption label="已平仓" value="closed"/></ElSelect><ElButton :disabled="locked" :loading="recognizing" @click="imageInput?.click()">选择截图</ElButton><ElButton :disabled="locked" @click="closeCapture">关闭原图预览</ElButton></div>
      <input ref="imageInput" type="file" accept="image/png,image/jpeg,image/webp" hidden @change="chooseImage"/>
      <ElImage v-if="preview" :src="preview" :preview-src-list="[preview]" preview-teleported fit="contain" class="order-image" alt="本次订单截图，请核对每行数据"/>
      <ElAlert v-for="(warning, index) in ocrWarnings" :key="index" :title="warning" type="warning" :closable="false" class="order-warning"/>
      <p class="order-help">图片只在本机识别，原图不会保存为附件；识别可能有误，订单号及每项数值均需核对。同一图片重复录入按同一次观察处理；若确为新的相同价位观察，请用“手动补录”或“补充观察”创建新观察。</p>
    </section>
    <ElSkeleton v-if="loading" :rows="3" animated/>
    <section v-if="rows.length" class="order-drafts">
      <h3>待核对 {{ rows.length }} 行</h3>
      <ElTable :data="rows" row-key="id" size="small"><ElTableColumn type="index" width="45"/><ElTableColumn label="订单号"><template #default="{ row }">{{ row.fields.ticket || '待补订单号' }}</template></ElTableColumn><ElTableColumn label="品种 / 阶段"><template #default="{ row }">{{ row.fields.symbol || '待补品种' }} · {{ orderStates[row.fields.state as OrderState] }}</template></ElTableColumn><ElTableColumn width="90"><template #default="{ row }"><ElButton link type="primary" :disabled="locked" @click="selectRow(row.id)">{{ row.id === currentId ? '当前行' : '核对此行' }}</ElButton></template></ElTableColumn></ElTable>
      <ElForm v-if="current" label-position="top" :disabled="locked" class="order-form" @submit.prevent.stop="save">
        <ElAlert v-for="(warning, index) in current.warnings" :key="index" :title="warning" type="warning" :closable="false" class="order-warning"/>
        <div class="order-fields">
          <ElFormItem label="订单号" required><ElInput v-model="current.fields.ticket" maxlength="100" inputmode="numeric" placeholder="完整数字编号，按文字保存"/></ElFormItem>
          <ElFormItem label="本次观察阶段" required><ElSelect :model-value="current.fields.state" @update:model-value="changeState"><ElOption v-for="(label, value) in orderStates" :key="value" :value="value" :label="label" :disabled="['cancelled', 'expired'].includes(value) && (current.source === 'screenshot' || !order || !['pending', 'cancelled', 'expired'].includes(order.state))"/></ElSelect></ElFormItem>
          <ElFormItem label="品种" required><ElInput v-model="current.fields.symbol" maxlength="40" placeholder="按截图实际品种代码填写"/></ElFormItem>
          <ElFormItem label="方向" required><ElSelect v-model="current.fields.side"><ElOption label="做多 buy" value="buy"/><ElOption label="做空 sell" value="sell"/></ElSelect></ElFormItem>
          <ElFormItem v-if="['open', 'closed'].includes(current.fields.state)" label="实际成交手数" required><ElInputNumber v-model="current.fields.volume" :controls="false"/></ElFormItem>
          <template v-if="current.fields.state === 'pending'">
            <ElFormItem label="挂单手数" required><ElInputNumber v-model="current.fields.pendingVolume" :controls="false"/></ElFormItem>
            <ElFormItem label="挂单类型" required><ElSelect v-model="current.fields.orderType"><ElOption v-for="type in pendingTypes" :key="type" :value="type" :label="type"/></ElSelect></ElFormItem>
            <ElFormItem label="挂单目标价" required><ElInputNumber v-model="current.fields.pendingPrice" :controls="false"/></ElFormItem>
          </template>
          <template v-if="current.fields.state === 'open' || current.fields.state === 'closed'">
            <ElFormItem label="开仓时间（报告时钟，选填）"><ElInput v-model="current.fields.openTime" maxlength="30" placeholder="YYYY.MM.DD HH:mm:ss"/></ElFormItem>
            <ElFormItem label="实际开仓价" required><ElInputNumber v-model="current.fields.openPrice" :controls="false"/></ElFormItem>
          </template>
          <template v-if="current.fields.state === 'closed'">
            <ElFormItem label="平仓时间（报告时钟，选填）"><ElInput v-model="current.fields.closeTime" maxlength="30" placeholder="YYYY.MM.DD HH:mm:ss"/></ElFormItem>
            <ElFormItem label="实际平仓价" required><ElInputNumber v-model="current.fields.closePrice" :controls="false"/></ElFormItem>
            <ElFormItem label="截图盈利（选填，非净盈亏）"><ElInputNumber v-model="current.fields.reportedProfit" :controls="false" placeholder="未知留空，可负数或 0"/></ElFormItem>
          </template>
          </div><details><summary>更多字段：订单类型、时间与止损止盈</summary><div class="order-fields">
          <ElFormItem v-if="current.fields.state !== 'pending'" label="订单类型"><ElSelect v-model="current.fields.orderType" clearable placeholder="未知可留空"><ElOption label="市价 market" value="market"/><ElOption v-for="type in pendingTypes" :key="type" :value="type" :label="type"/></ElSelect></ElFormItem>
          <ElFormItem label="挂单时间（选填）"><ElInput v-model="current.fields.pendingTime" placeholder="YYYY.MM.DD HH:mm:ss"/></ElFormItem>
          <ElFormItem label="挂单有效期（选填）"><ElInput v-model="current.fields.expiresAt" placeholder="YYYY.MM.DD HH:mm:ss"/></ElFormItem>
          <ElFormItem v-if="current.fields.state === 'closed'" label="平仓原因（选填）"><ElInput v-model="current.fields.closeReason" maxlength="1000"/></ElFormItem>
          <ElFormItem label="截图止损（选填）"><ElInputNumber v-model="current.fields.reportedSL" :controls="false" placeholder="本次未设置或未识别"/></ElFormItem>
          <ElFormItem label="截图止盈（选填）"><ElInputNumber v-model="current.fields.reportedTP" :controls="false" placeholder="本次未设置或未识别"/></ElFormItem>
        </div>
        </details><p class="order-help">时间按截图的报告时钟填写，不转换时区。未录字段保持未知；成交事实冲突会展示差异，不静默覆盖，不支持分批平仓。取消/失效仅用于手工明确结束未成交挂单。</p>
        <details v-if="current.raw"><summary>查看本行识别原文</summary><pre class="order-raw">{{ JSON.stringify(current.raw, null, 2) }}</pre></details>
        <div class="order-actions"><ElButton type="primary" native-type="submit" :disabled="locked" :loading="saving">已核对，保存此行观察</ElButton><ElButton :disabled="locked" @click="discardRow">丢弃当前草稿行</ElButton></div>
      </ElForm>
    </section>
    <ElButton v-if="!ready" text :disabled="busy || disabled" @click="load">重新读取可关联计划</ElButton>
  </ElCard>
</template>

<style scoped>
.order-plan-choice{display:grid;gap:8px;margin:12px 0}.order-help{color:var(--el-text-color-secondary);font-size:13px;line-height:1.8;margin:12px 0;overflow-wrap:anywhere}.order-capture,.order-drafts{margin-top:18px;padding:16px;border:1px solid var(--el-border-color-light);border-radius:8px}.order-image{width:100%;max-height:300px;margin:16px 0;background:var(--el-fill-color-light)}.order-actions{display:flex;gap:10px;flex-wrap:wrap;margin-top:16px}.order-actions .el-button{margin:0}.order-warning{margin:10px 0}.order-fields{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:0 16px}.order-fields .el-input-number{width:100%}.order-form{margin-top:18px}.order-raw{white-space:pre-wrap;overflow-wrap:anywhere;color:var(--el-text-color-secondary)}.order-history-title{margin:24px 0 12px}.order-details{padding:16px}.order-events{padding-left:22px}.order-events li{margin:16px 0}.order-events dl{display:grid;grid-template-columns:minmax(120px,1fr) 2fr;gap:6px 12px;font-size:13px}.order-events dt{color:var(--el-text-color-secondary)}.order-events dd{margin:0;overflow-wrap:anywhere}.order-reload{margin-top:16px}@media(max-width:850px){.order-fields{grid-template-columns:repeat(2,minmax(0,1fr))}}@media(max-width:540px){.order-fields{grid-template-columns:1fr}.order-capture,.order-drafts{padding:12px}.order-details{padding:6px}}
</style>
