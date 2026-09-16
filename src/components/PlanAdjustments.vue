<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { ElAlert, ElButton, ElCard, ElEmpty, ElForm, ElFormItem, ElInput, ElInputNumber, ElMessage, ElMessageBox, ElOption, ElSelect, ElSkeleton, ElTag } from 'element-plus'
import PriceOcr from './PriceOcr.vue'

interface Position {
  positionId: string; ticket: string; symbol: string; side: string; entryPrice: number | null
  source?: { broker?: string; server?: string; accountNumber?: string; currency?: string } | null
}
interface Entry {
  id: string; recordTime: string; requestId: string; entryPrice: number | null
  stopLoss: number | null; takeProfit: number | null; reason: string; sourceSnapshot: Position | null
}
interface Group {
  id: string; origin: 'mt5' | 'manual'; manualTicket: string; sourceSnapshot: Position | null
  createdAt: string; boundAt: string | null; entries: Entry[]
}
interface Journal { version: 1; groups: Group[] }
interface Draft { entryPrice: number | undefined; stopLoss: number | undefined; takeProfit: number | undefined; reason: string }
interface Attempt { fingerprint: string; requestId: string }
const props = defineProps<{ planId: string; disabled?: boolean }>()
const emit = defineEmits<{ saved: [plan: { id: string; updatedAt: string }] }>()
const journal = ref<Journal>({ version: 1, groups: [] }), positions = ref<Position[]>([])
const loading = ref(false), ready = ref(false), saving = ref(false), confirming = ref(false), error = ref('')
const showForm = ref(false), target = ref('manual'), positionId = ref(''), manualTicket = ref(''), bindingPositionId = ref('')
const draft = ref<Draft>(emptyDraft()), initialDraft = ref(''), ocrOpen = ref(false)
const appendAttempt = ref<Attempt>(), bindAttempt = ref<Attempt>()
let ocrTarget = '', generation = 0
let readController: AbortController | undefined, writeController: AbortController | undefined

const selectedGroup = computed(() => journal.value.groups.find(group => `group:${group.id}` === target.value))
const busy = computed(() => saving.value || ocrOpen.value || confirming.value)
const locked = computed(() => !!props.disabled || busy.value || loading.value || !ready.value)
const availablePositions = computed(() => positions.value.filter(position => !journal.value.groups.some(group => group.sourceSnapshot?.positionId === position.positionId)))
const groupLinked = computed(() => !selectedGroup.value?.sourceSnapshot || positions.value.some(position => position.positionId === selectedGroup.value?.sourceSnapshot?.positionId))
const appendContent = computed(() => ({
  groupId: selectedGroup.value?.id || '',
  positionId: target.value === 'mt5' ? positionId.value : '',
  manualTicket: target.value === 'manual' ? manualTicket.value.trim() : '',
  entryPrice: draft.value.entryPrice ?? null, stopLoss: draft.value.stopLoss ?? null,
  takeProfit: draft.value.takeProfit ?? null, reason: draft.value.reason.trim(),
}))
const appendFingerprint = computed(() => JSON.stringify({ planId: props.planId, target: target.value, ...appendContent.value }))
const bindFingerprint = computed(() => JSON.stringify({ planId: props.planId, groupId: selectedGroup.value?.id || '', positionId: bindingPositionId.value }))
const dirty = computed(() => showForm.value && (appendFingerprint.value !== initialDraft.value || !!bindingPositionId.value || !!appendAttempt.value))
const needsBeforeUnload = computed(() => dirty.value || busy.value)
const retryingAppend = computed(() => appendAttempt.value?.fingerprint === appendFingerprint.value)
const retryingBind = computed(() => bindAttempt.value?.fingerprint === bindFingerprint.value)
const bindingPositions = computed(() => positions.value.filter(position => availablePositions.value.includes(position) || (retryingBind.value && position.positionId === bindingPositionId.value)))
const targetReady = computed(() => retryingAppend.value || (target.value === 'manual' ? !!manualTicket.value.trim()
  : target.value === 'mt5' ? availablePositions.value.some(position => position.positionId === positionId.value)
  : !!selectedGroup.value && groupLinked.value))
const targetLabel = computed(() => selectedGroup.value ? groupLabel(selectedGroup.value)
  : target.value === 'manual' ? `手动持仓 ${manualTicket.value || '待填写编号'}`
    : positionLabel(positions.value.find(position => position.positionId === positionId.value)))

// Failed retries reuse the same ID. Changing that operation's content invalidates it.
watch(appendFingerprint, () => { appendAttempt.value = undefined }, { flush: 'sync' })
watch(bindFingerprint, () => { bindAttempt.value = undefined }, { flush: 'sync' })
function emptyDraft(): Draft { return { entryPrice: undefined, stopLoss: undefined, takeProfit: undefined, reason: '' } }
function sourceLabel(position?: Position | null) {
  if (!position) return '未绑定来源'
  return `${position.source?.broker || '未知公司'} / ${position.source?.server || '未知服务器'} / 账户 ${position.source?.accountNumber || '未记录'}${position.source?.currency ? ` / ${position.source.currency}` : ''}`
}
function positionLabel(position?: Position) {
  return position ? `持仓 ${position.ticket} · ${position.symbol} · ${sourceLabel(position)}` : '请选择已关联持仓'
}
function groupLabel(group: Group) {
  return group.sourceSnapshot ? `${group.origin === 'manual' ? `手动 ${group.manualTicket} → ` : ''}${positionLabel(group.sourceSnapshot)}`
    : `手动 ${group.manualTicket} · 组 ${group.id.slice(0, 8)}`
}
function time(value: string) { return new Date(value).toLocaleString('zh-CN', { hour12: false }) }
function resetDraft(nextTarget = 'manual') {
  target.value = nextTarget; positionId.value = ''; manualTicket.value = ''; bindingPositionId.value = ''
  draft.value = emptyDraft(); appendAttempt.value = undefined; bindAttempt.value = undefined
  initialDraft.value = appendFingerprint.value
}
async function confirmDiscard(message: string) {
  if (busy.value || props.disabled) return false
  confirming.value = true
  try {
    await ElMessageBox.confirm(message, '未保存的内容', { confirmButtonText: '确认离开', cancelButtonText: '继续填写', type: 'warning', closeOnClickModal: false })
    return true
  } catch { return false }
  finally { confirming.value = false }
}
async function canLeave({ preserveDraft = false, planDirty = false } = {}) {
  if (busy.value || props.disabled) return false
  if (preserveDraft || (!dirty.value && !planDirty)) return true
  const content = [planDirty ? '计划正文' : '', dirty.value ? '持仓调整草稿（含未保存的绑定选择）' : ''].filter(Boolean).join('和')
  return confirmDiscard(`${content}尚未保存。离开后将丢弃未保存的输入；已单独保存的调整仍会保留。`)
}
async function toggleForm() {
  if (locked.value) return
  if (showForm.value && !await canLeave()) return
  resetDraft(); showForm.value = !showForm.value; error.value = ''
}
async function changeTarget(value: string) {
  if (locked.value || value === target.value) return
  if (dirty.value && !await confirmDiscard('更换持仓将清空当前调整草稿和未保存的绑定选择。已保存历史不变。')) return
  resetDraft(value); error.value = ''
}
async function changePosition(value: string) {
  if (locked.value || value === positionId.value) return
  if (([draft.value.entryPrice, draft.value.stopLoss, draft.value.takeProfit].some(price => price != null) || draft.value.reason || appendAttempt.value)
    && !await confirmDiscard('更换持仓将清空当前价位草稿，请确认后重新录入或识别。')) return
  positionId.value = value; draft.value = emptyDraft(); error.value = ''
}
function ocrActive(active: boolean) {
  if (active) ocrTarget = `${props.planId}:${target.value}:${positionId.value}:${manualTicket.value}`
  ocrOpen.value = active
}
function applyOcr(row: { entryPrice: number; stopLoss: number | null; takeProfit: number | null }) {
  if (!showForm.value || props.disabled || saving.value || !targetReady.value
    || ocrTarget !== `${props.planId}:${target.value}:${positionId.value}:${manualTicket.value}`) return
  draft.value.entryPrice = row.entryPrice
  draft.value.stopLoss = row.stopLoss ?? undefined; draft.value.takeProfit = row.takeProfit ?? undefined
}
async function jsonResponse<T>(response: Response): Promise<T> {
  const data = await response.json().catch(() => { throw new Error('服务返回无效响应；输入已保留，可使用相同内容重试。') })
  if (!response.ok) throw new Error(data.error || '保存失败，请稍后重试。')
  return data as T
}
async function load() {
  if (loading.value || saving.value || ocrOpen.value) return
  const id = props.planId, current = generation
  const controller = new AbortController(); readController = controller
  const timeout = window.setTimeout(() => controller.abort(), 30000)
  loading.value = true; error.value = ''
  try {
    const data = await jsonResponse<{ journal: Journal; positions: Position[] }>(await fetch(`/api/plans/${encodeURIComponent(id)}/adjustments`, { signal: controller.signal }))
    if (current !== generation || id !== props.planId) return
    journal.value = data.journal; positions.value = data.positions; ready.value = true
  } catch (e) {
    if (current === generation) error.value = (e as Error).name === 'AbortError' ? '读取超时，请重试。' : (e as Error).message
  } finally {
    window.clearTimeout(timeout)
    if (current === generation) { loading.value = false; readController = undefined }
  }
}
async function write(kind: 'append' | 'bind') {
  if (locked.value) return
  if (kind === 'append') {
    if (!targetReady.value) { error.value = '请填写手动持仓编号或选择当前计划已关联的持仓。'; return }
    if ([draft.value.entryPrice, draft.value.stopLoss, draft.value.takeProfit].some(value => value != null && (!Number.isFinite(value) || value <= 0))) {
      error.value = '已填价格必须为正有限数；允许保本或锁盈止损。'; return
    }
  } else if (!retryingBind.value && (!selectedGroup.value || selectedGroup.value.origin !== 'manual' || selectedGroup.value.sourceSnapshot
    || !availablePositions.value.some(position => position.positionId === bindingPositionId.value))) {
    error.value = '请选择未绑定的手动组及当前计划已关联、尚无调整组的持仓。'; return
  }
  const id = props.planId, current = generation
  const fingerprint = kind === 'append' ? appendFingerprint.value : bindFingerprint.value
  const prior = kind === 'append' ? appendAttempt.value : bindAttempt.value
  const attempt = prior?.fingerprint === fingerprint ? prior : { fingerprint, requestId: crypto.randomUUID() }
  if (kind === 'append') appendAttempt.value = attempt; else bindAttempt.value = attempt
  const content = kind === 'append' ? appendContent.value : { groupId: selectedGroup.value!.id, positionId: bindingPositionId.value }
  const controller = new AbortController(); writeController = controller
  const timeout = window.setTimeout(() => controller.abort(), 30000)
  saving.value = true; error.value = ''
  try {
    const data = await jsonResponse<{ journal: Journal; plan: { id: string; updatedAt: string }; changed: boolean }>(await fetch(
      `/api/plans/${encodeURIComponent(id)}/adjustments${kind === 'bind' ? '/bind' : ''}`,
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...content, requestId: attempt.requestId }), signal: controller.signal },
    ))
    if (current !== generation || id !== props.planId) return
    journal.value = data.journal; emit('saved', data.plan)
    if (kind === 'append') {
      const savedGroup = data.journal.groups.find(group => group.entries.some(entry => entry.requestId === attempt.requestId))
      if (savedGroup) target.value = `group:${savedGroup.id}`
      positionId.value = ''; manualTicket.value = ''; draft.value = emptyDraft()
      appendAttempt.value = undefined; initialDraft.value = appendFingerprint.value
      // A separately selected binding remains pending; saving prices doesn't bind it.
      ElMessage.success('调整已单独保存，原计划价位和未保存正文不变。')
    } else {
      bindAttempt.value = undefined; bindingPositionId.value = ''
      // Binding changes only source identity: keep the price/reason inputs.
      ElMessage.success('持仓已绑定；当前价位草稿保留，尚未保存。')
    }
  } catch (e) {
    if (current === generation) error.value = (e as Error).name === 'AbortError'
      ? '保存超时，结果尚未确认；请保持内容不变并重试，避免重复记录。' : (e as Error).message
  } finally {
    window.clearTimeout(timeout)
    if (current === generation) { saving.value = false; writeController = undefined }
  }
}
watch(() => props.planId, () => {
  generation++; readController?.abort(); writeController?.abort()
  loading.value = false; saving.value = false; ready.value = false; showForm.value = false; ocrOpen.value = false
  journal.value = { version: 1, groups: [] }; positions.value = []; resetDraft(); void load()
}, { immediate: true, flush: 'sync' })
onBeforeUnmount(() => { generation++; readController?.abort(); writeController?.abort() })
defineExpose({ canLeave, busy, needsBeforeUnload })
</script>

<template>
  <ElCard shadow="never" class="plan-adjustments">
    <template #header><div class="plan-card-heading"><h2>持仓调整记录</h2><ElButton native-type="button" :disabled="locked" @click="toggleForm">{{ showForm ? '收起 / 取消草稿' : '追加调整' }}</ElButton></div></template>
    <p class="adjustment-help">每笔持仓单独记录。调整与绑定独立保存，不保存或丢弃计划正文，不改原计划价位。空白止盈、止损表示本次未设置；允许保本与锁盈。</p>
    <ElAlert v-if="error" :title="error" type="error" :closable="false" show-icon class="plan-alert"/>
    <ElButton v-if="error" native-type="button" :disabled="busy || disabled || loading" @click="load">重新读取历史与可选持仓（保留草稿）</ElButton>
    <ElSkeleton v-if="loading" :rows="3" animated/>
    <ElForm v-if="showForm" label-position="top" :disabled="disabled || loading || saving || confirming || !ready" @submit.prevent.stop="write('append')">
      <ElFormItem label="记录到哪笔持仓" required>
        <ElSelect :model-value="target" :disabled="locked" @update:model-value="changeTarget" aria-label="选择持仓调整记录组">
          <ElOption label="新建手动持仓组" value="manual"/><ElOption label="选择已关联 MT5 持仓，新建记录组" value="mt5"/>
          <ElOption v-for="group in journal.groups" :key="group.id" :label="groupLabel(group)" :value="`group:${group.id}`"/>
        </ElSelect>
      </ElFormItem>
      <ElFormItem v-if="target === 'manual'" label="手动持仓编号" required>
        <ElInput v-model="manualTicket" :disabled="locked" maxlength="100" placeholder="必填；相同编号也会建立独立记录组"/>
      </ElFormItem>
      <ElFormItem v-if="target === 'mt5'" label="当前计划已关联持仓" required>
        <ElSelect :model-value="positionId" :disabled="locked" @update:model-value="changePosition" placeholder="选择编号、公司、服务器及账户" filterable clearable>
          <ElOption v-for="position in availablePositions" :key="position.positionId" :label="positionLabel(position)" :value="position.positionId"/>
        </ElSelect>
      </ElFormItem>
      <p class="adjustment-help">{{ targetLabel }}</p>
      <ElAlert v-if="selectedGroup && !groupLinked" title="此组来源已不再关联当前计划。历史仍保留，重新关联后才可追加。" type="warning" :closable="false"/>
      <div class="adjustment-ocr">
        <PriceOcr :key="planId" :disabled="disabled || loading || saving || confirming || !targetReady" :target-label="`调整草稿 · ${targetLabel}`" @active-change="ocrActive" @apply="applyOcr"/>
        <span>当前识别不返回可靠持仓编号，请手填编号或核对所选来源。单行自动填入，多行选择一行；图片不保存。</span>
      </div>
      <div class="plan-three-columns">
        <ElFormItem label="参考入场价（选填）"><ElInputNumber v-model="draft.entryPrice" :disabled="locked" :controls="false" placeholder="选填"/></ElFormItem>
        <ElFormItem label="本次止损"><ElInputNumber v-model="draft.stopLoss" :disabled="locked" :controls="false" placeholder="本次未设置"/></ElFormItem>
        <ElFormItem label="本次止盈"><ElInputNumber v-model="draft.takeProfit" :disabled="locked" :controls="false" placeholder="本次未设置"/></ElFormItem>
      </div>
      <ElFormItem label="调整原因（选填）"><ElInput v-model="draft.reason" :disabled="locked" maxlength="2000" type="textarea" :rows="2" placeholder="例如移动到保本或锁定利润"/></ElFormItem>
      <ElButton type="primary" native-type="submit" :loading="saving" :disabled="locked || !targetReady">单独保存这次调整</ElButton>
    </ElForm>
    <ElForm v-if="showForm && selectedGroup?.origin === 'manual' && (!selectedGroup.sourceSnapshot || retryingBind)" label-position="top" :disabled="locked" class="adjustment-binding" @submit.prevent.stop="write('bind')">
        <h3>将此手动组绑定到已关联持仓</h3>
        <p class="adjustment-help">核对编号与来源后明确绑定；保留原手动编号及历史，不与其他组自动合并。绑定不保存或清空上面的价位草稿。</p>
        <ElFormItem label="绑定目标">
          <ElSelect v-model="bindingPositionId" :disabled="locked" clearable filterable placeholder="选择当前计划已关联的持仓">
            <ElOption v-for="position in bindingPositions" :key="position.positionId" :label="positionLabel(position)" :value="position.positionId"/>
          </ElSelect>
        </ElFormItem>
        <ElButton native-type="submit" :disabled="locked || !bindingPositionId">确认绑定所选持仓</ElButton>
    </ElForm>
    <ElEmpty v-if="ready && !loading && !journal.groups.length" description="还没有持仓调整记录"/>
    <article v-for="group in journal.groups" :key="group.id" class="adjustment-group">
      <h3><ElTag size="small">{{ group.origin === 'manual' ? '手动建立' : 'MT5 持仓' }}</ElTag> {{ groupLabel(group) }}</h3>
      <p class="adjustment-help">记录组 {{ group.id }}<span v-if="group.boundAt"> · 绑定于 {{ time(group.boundAt) }}</span></p>
      <ol class="adjustment-timeline">
        <li v-for="entry in group.entries" :key="entry.id">
          <time :datetime="entry.recordTime" :title="`UTC ${entry.recordTime}`">{{ time(entry.recordTime) }}</time>
          <div class="adjustment-entry"><span>参考入场价 {{ entry.entryPrice ?? '未填写' }}</span><span>止损 {{ entry.stopLoss ?? '本次未设置' }}</span><span>止盈 {{ entry.takeProfit ?? '本次未设置' }}</span></div>
          <p v-if="entry.reason" class="adjustment-reason">{{ entry.reason }}</p>
          <p class="adjustment-help">记录时来源：{{ entry.sourceSnapshot ? positionLabel(entry.sourceSnapshot) : `手动 ${group.manualTicket}（当时未绑定来源）` }}</p>
        </li>
      </ol>
    </article>
  </ElCard>
</template>

<style scoped>
.plan-adjustments{margin-top:20px}
.adjustment-help,.adjustment-ocr{color:var(--el-text-color-secondary);font-size:13px;line-height:1.7;margin:10px 0 16px;overflow-wrap:anywhere}
.adjustment-ocr{display:flex;align-items:center;gap:12px;flex-wrap:wrap}
.adjustment-binding{border:1px solid var(--el-border-color-light);border-radius:var(--el-border-radius-base);padding:16px;margin-top:20px}
.adjustment-group{padding:20px 0;border-bottom:1px solid var(--el-border-color-light);overflow-wrap:anywhere}
.adjustment-group h3{line-height:1.8}
.adjustment-timeline{padding-left:22px;margin:12px 0 0;border-left:2px solid var(--el-border-color-light);list-style:none}
.adjustment-timeline li{padding:0 0 20px;position:relative}
.adjustment-timeline li::before{content:'';position:absolute;width:8px;height:8px;border-radius:50%;background:var(--el-color-primary);left:-27px;top:5px}
.adjustment-timeline time{color:var(--el-text-color-secondary);font-size:13px}
.adjustment-entry{display:flex;flex-wrap:wrap;gap:8px 20px;margin-top:8px;color:var(--el-text-color-primary)}
.adjustment-reason{white-space:pre-wrap;margin-top:8px;line-height:1.7}
</style>
