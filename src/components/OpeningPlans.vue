<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue'
import {
  ElAlert, ElButton, ElCard, ElDescriptions, ElDescriptionsItem, ElDialog,
  ElEmpty, ElForm, ElFormItem, ElImage, ElImageViewer, ElInput, ElInputNumber,
  ElMessage, ElMessageBox, ElOption, ElPagination, ElRadioButton, ElRadioGroup,
  ElSelect, ElSkeleton, ElTable, ElTableColumn, ElTag, ElUpload, genFileId,
} from 'element-plus'
import type { FormInstance, FormRules, TableInstance, UploadFile, UploadInstance, UploadRawFile, UploadUserFile } from 'element-plus'
import { ArrowLeft, ArrowRight, Check, ClipboardPenLine, ImagePlus, Pencil, Plus, Save } from 'lucide-vue-next'
import PlanStatusMenu from './PlanStatusMenu.vue'
import SymbolSelect from './SymbolSelect.vue'
import PlanReviewEntry from './PlanReviewEntry.vue'
import { statusInfo, type PlanStatus } from '../plan-status'
import '../plans.css'

interface PlanImage { id: string; name: string; mimeType: string; size: number; url: string }
type CreatedAtOrder = 'ascending' | 'descending'
type PlanSide = '' | 'buy' | 'sell'
type MarketState = 'uptrend' | 'downtrend' | 'range' | 'uncertain'
interface Plan {
  id: string; symbol: string; side: PlanSide; timeframe: string;
  marketState: MarketState; keyStructure: string; reason: string;
  entryPrice: number | null; stopLoss: number | null; takeProfit: number | null;
  status: PlanStatus; statusChangedAt: string | null; abandonReason: string;
  createdAt: string; updatedAt: string; images: PlanImage[];
}
interface PlanForm extends Omit<Plan, 'id' | 'images' | 'createdAt' | 'updatedAt' | 'entryPrice' | 'stopLoss' | 'takeProfit' | 'status' | 'statusChangedAt' | 'abandonReason'> {
  entryPrice: number | undefined; stopLoss: number | undefined; takeProfit: number | undefined;
}
interface PlanUpload extends UploadUserFile { existingId?: string }

const emit = defineEmits<{ openReview: [planId: string] }>()
const plans = ref<Plan[]>([]), loading = ref(true), error = ref(''), imageError = ref('')
const mode = ref<'list' | 'view' | 'new' | 'edit'>('list'), activePlan = ref<Plan | null>(null)
const formRef = ref<FormInstance>(), uploadRef = ref<UploadInstance>()
const tableRef = ref<TableInstance>(), createdAtOrder = ref<CreatedAtOrder>('descending')
const files = ref<PlanUpload[]>([]), saving = ref(false), pageNumber = ref(1)
const previewOpen = ref(false), previewIndex = ref(0)
const selectedStatus = ref<'draft' | 'ready'>('draft'), initialSnapshot = ref('')
const pendingSymbol = ref<string | null>(null)
const changingStatusId = ref(''), statusError = ref(''), viewingPlan = ref(false)
const abandonDialog = ref(false), abandonPlan = ref<Plan | null>(null), abandonReason = ref(''), abandonError = ref('')
const temporaryUrls = new Set<string>()
const timeframes = ['M1', 'M5', 'M15', 'M30', 'H1', 'H4', 'D1', 'W1', 'MN1']
const markets: { value: MarketState; label: string }[] = [
  { value: 'uptrend', label: '上涨趋势' }, { value: 'downtrend', label: '下跌趋势' },
  { value: 'range', label: '震荡' }, { value: 'uncertain', label: '不确定' },
]
const allowedTypes = new Set(['image/png', 'image/jpeg', 'image/webp'])
const maxImageCount = 4, maxImageSize = 5 * 1024 * 1024
const form = ref<PlanForm>(emptyForm())
const editing = computed(() => mode.value === 'new' || mode.value === 'edit')
const actionBusy = computed(() => saving.value || !!changingStatusId.value || viewingPlan.value)
const requiredBasics = computed(() => ['ready', 'executed'].includes(mode.value === 'edit' ? activePlan.value?.status || 'draft' : selectedStatus.value))
const sortedPlans = computed(() => {
  const direction = createdAtOrder.value === 'ascending' ? 1 : -1
  return [...plans.value].sort((a, b) => {
    const timeDifference = Date.parse(a.createdAt) - Date.parse(b.createdAt)
    const idDifference = a.id === b.id ? 0 : a.id < b.id ? -1 : 1
    return direction * (timeDifference || idDifference)
  })
})
const pagePlans = computed(() => sortedPlans.value.slice((pageNumber.value - 1) * 10, pageNumber.value * 10))
const previewUrls = computed(() => editing.value ? files.value.flatMap(f => f.url ? [f.url] : []) : activePlan.value?.images.map(i => i.url) || [])
const title = computed(() => ({ list: '开仓计划', view: '计划详情', new: '新建计划', edit: '编辑计划' })[mode.value])
const planRatio = computed(() => riskReward(editing.value ? form.value : activePlan.value))
const rules = computed<FormRules<PlanForm>>(() => ({
  symbol: [{ validator: (_rule, _value, callback) => callback(pendingSymbol.value !== null ? new Error('请先选择品种候选或按 Enter 确认输入，当前输入尚未保存。') : undefined), trigger: 'change' }, { required: requiredBasics.value, whitespace: true, message: '待执行或已执行计划需要交易品种。', trigger: 'blur' }, { max: 40, message: '品种最多 40 个字符。', trigger: 'blur' }],
  side: [{ required: requiredBasics.value, message: '待执行或已执行计划需要选择做多或做空。', trigger: 'change' }],
  timeframe: [{ required: requiredBasics.value, message: '待执行或已执行计划需要分析周期。', trigger: 'change' }],
  reason: [{ required: requiredBasics.value, whitespace: true, message: '待执行或已执行计划需要入场理由。', trigger: 'blur' }, { max: 5000, message: '入场理由最多 5000 字。', trigger: 'blur' }],
  keyStructure: [{ max: 300, message: '关键结构最多 300 字。', trigger: 'blur' }],
  entryPrice: [{ validator: priceValidator, trigger: 'blur' }],
  stopLoss: [{ validator: priceValidator, trigger: 'blur' }],
  takeProfit: [{ validator: priceValidator, trigger: 'blur' }],
}))

function emptyForm(): PlanForm {
  return { symbol: 'XAUUSD', side: '', timeframe: '',
    marketState: 'uncertain', keyStructure: '', reason: '', entryPrice: undefined,
    stopLoss: undefined, takeProfit: undefined }
}
function sideLabel(value: PlanSide) { return value === 'buy' ? '做多' : value === 'sell' ? '做空' : '未填写' }
function marketLabel(value: MarketState) { return markets.find(m => m.value === value)?.label || '不确定' }
function timestamp(value: string) { return new Date(value).toLocaleString('zh-CN', { hour12: false }) }
function changeCreatedAtOrder({ prop, order }: { prop: string | null; order: CreatedAtOrder | null }) {
  if (prop !== 'createdAt') return
  const nextOrder = order ?? (createdAtOrder.value === 'descending' ? 'ascending' : 'descending')
  if (nextOrder !== createdAtOrder.value) { createdAtOrder.value = nextOrder; pageNumber.value = 1 }
  // Clicking the active caret clears Element Plus sorting even with two sort
  // orders. Reapply the other direction so the arrow always matches the list.
  if (!order) tableRef.value?.sort('createdAt', nextOrder)
}
function priceProblem(value: Pick<PlanForm, 'side' | 'entryPrice' | 'stopLoss' | 'takeProfit'> | Plan): string {
  const { side, entryPrice: entry, stopLoss: stop, takeProfit: target } = value
  const prices = [entry, stop, target].filter(p => p != null)
  if (prices.some(p => typeof p !== 'number' || !Number.isFinite(p) || p <= 0)) return '填写的价位必须是大于 0 的有效数字。'
  if (side === 'buy') {
    if (stop != null && entry != null && stop >= entry) return '做多时，止损价必须低于入场价。'
    if (target != null && entry != null && target <= entry) return '做多时，止盈价必须高于入场价。'
    if (stop != null && target != null && stop >= target) return '做多时，止损价必须低于止盈价。'
  }
  if (side === 'sell') {
    if (stop != null && entry != null && stop <= entry) return '做空时，止损价必须高于入场价。'
    if (target != null && entry != null && target >= entry) return '做空时，止盈价必须低于入场价。'
    if (stop != null && target != null && stop <= target) return '做空时，止损价必须高于止盈价。'
  }
  return ''
}
function priceValidator(_rule: unknown, _value: unknown, callback: (error?: Error) => void) {
  const problem = priceProblem(form.value)
  callback(problem ? new Error(problem) : undefined)
}
function riskReward(value: Plan | PlanForm | null): number | null {
  if (!value || !value.side || priceProblem(value)) return null
  const { entryPrice: entry, stopLoss: stop, takeProfit: target } = value
  if (entry == null || stop == null || target == null || entry === stop) return null
  const ratio = Math.abs(target - entry) / Math.abs(entry - stop)
  return Number.isFinite(ratio) ? ratio : null
}
async function request<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(url, options)
  const result = await response.json().catch(() => ({ error: '服务返回了无效响应，请确认后端已重启到最新版本。' }))
  if (!response.ok) throw new Error(result.error || '操作失败，请稍后重试。')
  return result as T
}
async function loadPlans() {
  loading.value = true; error.value = ''
  try { plans.value = (await request<{ plans: Plan[] }>('/api/plans')).plans }
  catch (e) { error.value = (e as Error).message }
  finally { loading.value = false }
}
function rememberPlan(plan: Plan) {
  plans.value = [plan, ...plans.value.filter(p => p.id !== plan.id)]
  if (activePlan.value?.id === plan.id) activePlan.value = plan
}
async function updateStatus(plan: Plan, status: PlanStatus, reason?: string) {
  if (actionBusy.value || editing.value) return false
  changingStatusId.value = plan.id; statusError.value = ''; abandonError.value = ''
  try {
    const result = await request<{ plan: Plan; changed: boolean }>(`/api/plans/${encodeURIComponent(plan.id)}/status`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status, ...(status === 'abandoned' ? { abandonReason: reason ?? '' } : {}) }),
    })
    rememberPlan(result.plan)
    ElMessage({ type: result.changed ? 'success' : 'info', message: result.changed
      ? `计划已标记为${statusInfo(result.plan.status).label}` : `计划当前已是${statusInfo(result.plan.status).label}` })
    return true
  } catch (e) {
    const message = (e as Error).message
    if (abandonDialog.value) abandonError.value = message
    else statusError.value = message
    return false
  } finally { changingStatusId.value = '' }
}
function chooseStatus(plan: Plan, status: PlanStatus) {
  if (actionBusy.value || editing.value || abandonDialog.value || plan.status === status) return
  statusError.value = ''
  if (status === 'abandoned') {
    abandonPlan.value = plan; abandonReason.value = plan.abandonReason || ''; abandonError.value = ''; abandonDialog.value = true
  } else void updateStatus(plan, status)
}
async function confirmAbandon() {
  if (abandonPlan.value && await updateStatus(abandonPlan.value, 'abandoned', abandonReason.value)) abandonDialog.value = false
}
function closeAbandon(done?: () => void) {
  if (changingStatusId.value) return
  if (done) done()
  else abandonDialog.value = false
}
function snapshot() {
  return JSON.stringify({ form: form.value, pendingSymbol: pendingSymbol.value, files: files.value.map(f => ({ uid: f.uid, id: f.existingId })) })
}
function symbolPendingChanged(query: string | null) {
  pendingSymbol.value = query
  if (query === null) formRef.value?.clearValidate('symbol')
}
function releasePreviews() { temporaryUrls.forEach(url => URL.revokeObjectURL(url)); temporaryUrls.clear() }
function prepareForm(plan?: Plan) {
  releasePreviews()
  pendingSymbol.value = null
  form.value = plan ? { symbol: plan.symbol, side: plan.side,
    timeframe: plan.timeframe, marketState: plan.marketState, keyStructure: plan.keyStructure,
    reason: plan.reason, entryPrice: plan.entryPrice ?? undefined, stopLoss: plan.stopLoss ?? undefined,
    takeProfit: plan.takeProfit ?? undefined } : emptyForm()
  files.value = plan ? plan.images.map(i => ({ uid: genFileId(), name: i.name, url: i.url, status: 'success', existingId: i.id })) : []
  selectedStatus.value = 'draft'
  error.value = ''; imageError.value = ''; previewOpen.value = false
  initialSnapshot.value = snapshot()
  void nextTick(() => formRef.value?.clearValidate())
}
function createPlan() {
  if (actionBusy.value || abandonDialog.value) return
  statusError.value = ''
  activePlan.value = null; prepareForm(); mode.value = 'new'
  void nextTick(() => document.querySelector<HTMLInputElement>('#plan-symbol')?.focus())
}
async function viewPlan(plan: Pick<Plan, 'id'>) {
  if (actionBusy.value || abandonDialog.value) return false
  viewingPlan.value = true
  statusError.value = ''
  error.value = ''
  try { activePlan.value = (await request<{ plan: Plan }>(`/api/plans/${encodeURIComponent(plan.id)}`)).plan; mode.value = 'view'; return true }
  catch (e) { error.value = (e as Error).message; return false }
  finally { viewingPlan.value = false }
}
function editPlan() { if (activePlan.value && !actionBusy.value && !abandonDialog.value) { statusError.value = ''; prepareForm(activePlan.value); mode.value = 'edit' } }
async function canLeave() {
  if (actionBusy.value || abandonDialog.value) return false
  if (editing.value && snapshot() !== initialSnapshot.value) {
    try { await ElMessageBox.confirm('当前修改尚未保存。离开后将丢弃这些修改。', '离开编辑', { confirmButtonText: '离开', cancelButtonText: '继续编辑', type: 'warning' }) }
    catch { return false }
  }
  return true
}
async function backToList() {
  if (!await canLeave()) return false
  releasePreviews(); files.value = []; mode.value = 'list'; error.value = ''; imageError.value = ''
  window.scrollTo({ top: 0 })
  return true
}
async function openPlanById(id: string, edit = false) {
  if (!await canLeave()) return
  if (await viewPlan({ id }) && edit) editPlan()
}
function imageChanged(file: UploadFile) {
  if (!file.raw) return
  if (file.url?.startsWith('blob:')) temporaryUrls.add(file.url)
  const problem = !allowedTypes.has(file.raw.type) ? '仅支持 PNG、JPEG 和 WEBP 图片。'
    : !file.raw.size ? '不能添加空图片。' : file.raw.size > maxImageSize ? '每张截图不能超过 5 MB。' : ''
  if (problem) {
    imageError.value = `${file.name}：${problem}`
    files.value = files.value.filter(f => f.uid !== file.uid)
    if (file.url?.startsWith('blob:')) { URL.revokeObjectURL(file.url); temporaryUrls.delete(file.url) }
  } else imageError.value = ''
}
function imageRemoved(file: UploadFile) {
  if (file.url?.startsWith('blob:')) { URL.revokeObjectURL(file.url); temporaryUrls.delete(file.url) }
  imageError.value = ''
}
function imagePreview(file: UploadFile) {
  previewIndex.value = Math.max(0, previewUrls.value.indexOf(file.url || '')); previewOpen.value = true
}
function pasteImages(event: ClipboardEvent) {
  if (!editing.value || saving.value || previewOpen.value) return
  const images = Array.from(event.clipboardData?.items || []).filter(i => i.kind === 'file' && i.type.startsWith('image/')).map(i => i.getAsFile()).filter((f): f is File => !!f)
  if (!images.length) return
  event.preventDefault()
  if (files.value.length + images.length > maxImageCount) { imageError.value = '每份计划最多保存 4 张截图，请先移除多余图片。'; return }
  for (const image of images) {
    const extension = image.type === 'image/jpeg' ? 'jpg' : image.type === 'image/webp' ? 'webp' : 'png'
    const raw = new File([image], `行情截图-${Date.now()}.${extension}`, { type: image.type }) as UploadRawFile
    raw.uid = genFileId(); uploadRef.value?.handleStart(raw)
  }
}
async function savePlan(status: 'draft' | 'ready' = 'draft') {
  if (actionBusy.value) return
  const isEditing = mode.value === 'edit'
  if (!isEditing) selectedStatus.value = status
  saving.value = true; error.value = ''
  try {
    await nextTick()
    if (!await formRef.value?.validate().catch(() => false)) return
    const payload = { ...form.value,
      entryPrice: form.value.entryPrice ?? null, stopLoss: form.value.stopLoss ?? null,
      takeProfit: form.value.takeProfit ?? null, ...(!isEditing ? { status } : {}),
      keepImageIds: files.value.flatMap(f => f.existingId ? [f.existingId] : []) }
    const multipart = new FormData(); multipart.append('payload', JSON.stringify(payload))
    for (const file of files.value) if (file.raw) multipart.append('images', file.raw, file.name)
    const path = mode.value === 'edit' && activePlan.value ? `/api/plans/${encodeURIComponent(activePlan.value.id)}` : '/api/plans'
    const { plan } = await request<{ plan: Plan }>(path, { method: mode.value === 'edit' ? 'PUT' : 'POST', body: multipart })
    rememberPlan(plan)
    activePlan.value = plan; releasePreviews(); files.value = []; mode.value = 'view'
    ElMessage.success(isEditing ? '修改已保存，计划状态已保留' : status === 'ready' ? '计划已标记为待执行' : '草稿已保存')
  } catch (e) { error.value = (e as Error).message }
  finally { saving.value = false }
}
function beforeUnload(event: BeforeUnloadEvent) {
  if (editing.value && snapshot() !== initialSnapshot.value) { event.preventDefault(); event.returnValue = '' }
}
onMounted(() => { void loadPlans(); window.addEventListener('paste', pasteImages); window.addEventListener('beforeunload', beforeUnload) })
onBeforeUnmount(() => { releasePreviews(); window.removeEventListener('paste', pasteImages); window.removeEventListener('beforeunload', beforeUnload) })
defineExpose({ showList: backToList, canLeave, openPlanById })
</script>

<template>

    <section class="opening-plans">
      <div class="page-heading">
        <div><div class="eyebrow">BEFORE THE TRADE</div><h1>{{ title }}</h1><p>贴一张行情图，记下这次入场的想法。</p></div>
        <ElButton v-if="mode === 'list'" type="primary" :disabled="loading || actionBusy" @click="createPlan"><Plus :size="16"/>新建计划</ElButton>
        <div v-else class="plan-heading-actions">
          <ElButton :disabled="actionBusy" @click="backToList"><ArrowLeft :size="15"/>返回列表</ElButton>
          <template v-if="mode === 'view' && activePlan">
            <ElButton type="primary" :disabled="actionBusy" @click="editPlan"><Pencil :size="15"/>编辑计划</ElButton>
          </template>
        </div>
      </div>
      <ElAlert v-if="error" :title="error" type="error" show-icon :closable="false" class="plan-alert"/>
      <ElAlert v-if="statusError" :title="statusError" type="error" show-icon class="plan-alert" @close="statusError = ''"/>

      <template v-if="mode === 'list'">
        <ElCard shadow="never" class="plan-list-card">
          <template #header><div class="plan-card-heading"><h2>我的计划 <ElTag type="info" size="small" round>{{ plans.length }}</ElTag></h2><span>{{ createdAtOrder === 'descending' ? '最新优先' : '最早优先' }} · 点击创建时间切换</span></div></template>
          <ElSkeleton v-if="loading" :rows="5" animated/>
          <template v-else-if="error"><ElEmpty description="暂时无法读取计划"><ElButton @click="loadPlans">重新加载</ElButton></ElEmpty></template>
          <template v-else-if="plans.length">
            <ElTable ref="tableRef" :data="pagePlans" row-key="id" class="plan-table" :default-sort="{ prop: 'createdAt', order: createdAtOrder }" @sort-change="changeCreatedAtOrder" @row-click="viewPlan">
              <ElTableColumn label="品种" min-width="190" align="left" header-align="left"><template #default="{ row }"><div class="plan-symbol"><span class="plan-symbol-icon"><ClipboardPenLine :size="19"/></span><strong>{{ row.symbol || '未填写品种' }}</strong></div></template></ElTableColumn>
              <ElTableColumn label="方向" min-width="100" align="center" header-align="center"><template #default="{ row }"><ElTag :type="row.side === 'buy' ? 'success' : row.side === 'sell' ? 'danger' : 'info'" effect="light">{{ sideLabel(row.side) }}</ElTag></template></ElTableColumn>
              <ElTableColumn label="分析周期" min-width="110" align="center" header-align="center"><template #default="{ row }">{{ row.timeframe || '未填写' }}</template></ElTableColumn>
              <ElTableColumn prop="createdAt" label="创建时间" min-width="200" align="center" header-align="center" sortable="custom" :sort-orders="['descending', 'ascending']"><template #default="{ row }">{{ timestamp(row.createdAt) }}</template></ElTableColumn>
              <ElTableColumn label="状态" min-width="120" align="center" header-align="center"><template #default="{ row }"><PlanStatusMenu :status="row.status" :disabled="actionBusy || abandonDialog" :loading="changingStatusId === row.id" @change="chooseStatus(row as Plan, $event)"/></template></ElTableColumn>
              <ElTableColumn label="操作" width="100" align="center" header-align="center"><template #default="{ row }">
                <ElButton link type="primary" :disabled="actionBusy" :aria-label="`查看 ${row.symbol || '草稿'} 计划`" @click.stop="viewPlan(row as Plan)">查看<ArrowRight :size="13"/></ElButton>
              </template></ElTableColumn>
            </ElTable>
            <ElPagination v-if="plans.length > 10" v-model:current-page="pageNumber" :total="plans.length" :page-size="10" layout="total, prev, pager, next" class="plan-pagination"/>
          </template>
          <ElEmpty v-else description="还没有开仓计划"><template #image><ClipboardPenLine :size="64" stroke-width="1" class="plan-empty-icon"/></template><ElButton type="primary" @click="createPlan">创建第一份计划</ElButton></ElEmpty>
        </ElCard>
        <p class="plan-footnote">计划与截图保存在本机，编辑完成后请再次保存。</p>
      </template>

      <ElCard v-else-if="editing" shadow="never" class="plan-editor-card">
        <template #header><div class="plan-card-heading"><h2>{{ mode === 'new' ? '这次准备怎样交易？' : '补充或调整计划' }}</h2><span>{{ mode === 'new' ? '保存草稿可稍后补全' : '保存修改会保留当前状态' }}</span></div></template>
        <ElForm ref="formRef" :model="form" :rules="rules" label-position="top" :validate-on-rule-change="false" :disabled="saving" scroll-to-error @submit.prevent="savePlan()">
          <div class="plan-three-columns">
            <ElFormItem label="交易品种" prop="symbol"><SymbolSelect v-model="form.symbol" :disabled="saving" @pending-change="symbolPendingChanged"/></ElFormItem>
            <ElFormItem label="方向" prop="side"><ElSelect v-model="form.side" placeholder="选择方向" clearable><ElOption label="做多" value="buy"/><ElOption label="做空" value="sell"/></ElSelect></ElFormItem>
            <ElFormItem label="分析周期" prop="timeframe"><ElSelect v-model="form.timeframe" placeholder="选择周期" clearable><ElOption v-for="timeframe in timeframes" :key="timeframe" :label="timeframe" :value="timeframe"/></ElSelect></ElFormItem>
          </div>
          <ElFormItem label="行情截图">
            <div class="plan-upload-area">
              <ElUpload ref="uploadRef" v-model:file-list="files" :auto-upload="false" :limit="maxImageCount" multiple accept="image/png,image/jpeg,image/webp" list-type="picture-card" :on-change="imageChanged" :on-remove="imageRemoved" :on-preview="imagePreview" :on-exceed="() => imageError = '每份计划最多保存 4 张截图，请先移除多余图片。'">
                <div class="plan-upload-trigger"><ImagePlus :size="25"/><span>添加截图</span></div>
                <template #tip><div class="el-upload__tip">可以直接粘贴剪贴板图片（Ctrl / ⌘ + V）。PNG、JPEG 或 WEBP，每张 ≤ 5 MB，最多 4 张；保存计划时一并保存。</div></template>
              </ElUpload>
              <ElAlert v-if="imageError" :title="imageError" type="warning" show-icon :closable="false" class="plan-image-alert"/>
            </div>
          </ElFormItem>
          <ElFormItem label="市场状态" prop="marketState"><ElRadioGroup v-model="form.marketState"><ElRadioButton v-for="market in markets" :key="market.value" :value="market.value">{{ market.label }}</ElRadioButton></ElRadioGroup></ElFormItem>
          <ElFormItem label="关键结构" prop="keyStructure"><ElInput v-model="form.keyStructure" maxlength="300" placeholder="一句话描述关键结构，也可以写「见图」" clearable/></ElFormItem>
          <ElFormItem label="入场理由" prop="reason"><ElInput v-model="form.reason" type="textarea" :rows="4" maxlength="5000" show-word-limit placeholder="为什么准备入场？等什么信号？出现什么情况就放弃？"/></ElFormItem>
          <div class="plan-prices-heading"><h3>计划价位</h3><span>选填，填写单个价格</span></div>
          <div class="plan-three-columns">
            <ElFormItem label="计划入场价" prop="entryPrice"><ElInputNumber v-model="form.entryPrice" :controls="false" placeholder="选填"/></ElFormItem>
            <ElFormItem label="止损价" prop="stopLoss"><ElInputNumber v-model="form.stopLoss" :controls="false" placeholder="选填"/></ElFormItem>
            <ElFormItem label="止盈价" prop="takeProfit"><ElInputNumber v-model="form.takeProfit" :controls="false" placeholder="选填"/></ElFormItem>
          </div>
          <div v-if="planRatio !== null" class="plan-ratio"><span>计划收益 / 风险倍数</span><strong>{{ planRatio.toFixed(2) }} <small>倍</small></strong><span>按价格距离计算，未计交易成本</span></div>
          <div class="plan-form-footer">
            <span>{{ mode === 'edit' && activePlan ? `保留${statusInfo(activePlan.status).label}状态；状态可在列表或详情中更改` : '待执行需填写品种、方向、周期和入场理由' }}</span>
            <div>
              <ElButton v-if="mode === 'edit'" type="primary" native-type="submit" :loading="saving" :disabled="saving"><Save :size="15"/>保存修改</ElButton>
              <template v-else><ElButton :loading="saving && selectedStatus === 'draft'" :disabled="saving" @click="savePlan('draft')"><Save :size="15"/>保存草稿</ElButton><ElButton type="primary" :loading="saving && selectedStatus === 'ready'" :disabled="saving" @click="savePlan('ready')"><Check :size="15"/>标记待执行</ElButton></template>
            </div>
          </div>
        </ElForm>
      </ElCard>

      <ElCard v-else-if="activePlan" shadow="never" class="plan-detail-card">
        <template #header><div class="plan-card-heading"><h2>{{ activePlan.symbol || '未填写品种' }}<PlanStatusMenu :status="activePlan.status" :disabled="actionBusy || abandonDialog" :loading="changingStatusId === activePlan.id" @change="activePlan && chooseStatus(activePlan, $event)"/></h2><span>更新于 {{ timestamp(activePlan.updatedAt) }}</span></div></template>
        <ElDescriptions :column="2" border>
          <ElDescriptionsItem label="方向">{{ sideLabel(activePlan.side) }}</ElDescriptionsItem>
          <ElDescriptionsItem label="分析周期">{{ activePlan.timeframe || '未填写' }}</ElDescriptionsItem>
          <ElDescriptionsItem label="市场状态">{{ marketLabel(activePlan.marketState) }}</ElDescriptionsItem>
          <ElDescriptionsItem label="创建时间">{{ timestamp(activePlan.createdAt) }}</ElDescriptionsItem>
          <ElDescriptionsItem label="状态变更时间" :span="2">{{ activePlan.statusChangedAt ? timestamp(activePlan.statusChangedAt) : '未记录' }}</ElDescriptionsItem>
        </ElDescriptions>
        <p class="plan-status-description">{{ statusInfo(activePlan.status).description }}</p>
        <div v-if="activePlan.status === 'abandoned' || activePlan.abandonReason" class="plan-detail-section"><h3>{{ activePlan.status === 'abandoned' ? '放弃原因' : '上次放弃原因' }}</h3><p :class="{ 'plan-unfilled': !activePlan.abandonReason }">{{ activePlan.abandonReason || '未填写' }}</p></div>
        <div class="plan-detail-section"><h3>行情截图 <span v-if="activePlan.images.length">{{ activePlan.images.length }} 张 · 点击放大</span></h3><div v-if="activePlan.images.length" class="plan-screenshot-grid" :class="{ single: activePlan.images.length === 1 }"><ElImage v-for="(image, index) in activePlan.images" :key="image.id" :src="image.url" :alt="image.name" fit="contain" :preview-src-list="activePlan.images.map(i => i.url)" :initial-index="index" preview-teleported :z-index="4000"><template #error><span class="plan-broken-image">截图无法读取</span></template></ElImage></div><p v-else class="plan-unfilled">未添加截图</p></div>
        <div class="plan-detail-section"><h3>关键结构</h3><p :class="{ 'plan-unfilled': !activePlan.keyStructure }">{{ activePlan.keyStructure || '未填写' }}</p></div>
        <div class="plan-detail-section"><h3>入场理由</h3><p :class="{ 'plan-unfilled': !activePlan.reason }">{{ activePlan.reason || '未填写' }}</p></div>
        <div class="plan-detail-section"><h3>计划价位</h3><div class="plan-three-columns plan-price-values"><div><span>计划入场价</span><strong>{{ activePlan.entryPrice ?? '—' }}</strong></div><div><span>止损价</span><strong>{{ activePlan.stopLoss ?? '—' }}</strong></div><div><span>止盈价</span><strong>{{ activePlan.takeProfit ?? '—' }}</strong></div></div></div>
        <div v-if="planRatio !== null" class="plan-ratio"><span>计划收益 / 风险倍数</span><strong>{{ planRatio.toFixed(2) }} <small>倍</small></strong><span>按价格距离计算，未计交易成本</span></div>
        <p class="plan-footnote">记录入场前的思考，保留这次计划的依据。</p>
      </ElCard>
      <PlanReviewEntry v-if="mode === 'view' && activePlan" :key="activePlan.id" :plan-id="activePlan.id" :disabled="actionBusy || abandonDialog" style="margin-top: 20px" @open="id => emit('openReview', id)"/>
      <ElDialog v-model="abandonDialog" title="标记已放弃" width="min(420px, calc(100vw - 32px))" align-center :show-close="!changingStatusId" :close-on-click-modal="!changingStatusId" :close-on-press-escape="!changingStatusId" :before-close="closeAbandon" @closed="abandonPlan = null; abandonReason = ''; abandonError = ''">
        <ElAlert v-if="abandonError" :title="abandonError" type="error" show-icon :closable="false" class="plan-alert"/>
        <ElForm label-position="top" :disabled="!!changingStatusId" @submit.prevent="confirmAbandon">
          <ElFormItem label="放弃原因（选填）"><ElInput v-model="abandonReason" type="textarea" :rows="4" maxlength="2000" show-word-limit placeholder="记下这次不执行的原因"/></ElFormItem>
        </ElForm>
        <p class="plan-status-description">改回其他状态后，原因保留为“上次放弃原因”；再次放弃时可修改。</p>
        <template #footer><ElButton :disabled="!!changingStatusId" @click="closeAbandon()">取消</ElButton><ElButton type="primary" :loading="!!changingStatusId" :disabled="!!changingStatusId" @click="confirmAbandon">确认放弃</ElButton></template>
      </ElDialog>
      <ElImageViewer v-if="previewOpen && previewUrls.length" :url-list="previewUrls" :initial-index="previewIndex" :z-index="4000" teleported hide-on-click-modal @close="previewOpen = false"/>
    </section>

</template>
