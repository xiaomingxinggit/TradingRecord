<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { ElAlert, ElButton, ElCard, ElEmpty, ElForm, ElFormItem, ElInput, ElInputNumber, ElMessage, ElMessageBox, ElOption, ElSelect, ElSkeleton, ElTag } from 'element-plus'
import PriceOcr from './PriceOcr.vue'

interface SourceSnapshot {
  ticket: string; symbol: string; side: string; entryPrice: number | null
  source?: { broker?: string; server?: string; accountNumber?: string; currency?: string } | null
}
interface Entry {
  id: string; type?: string; recordTime: string; requestId: string; entryPrice: number | null
  stopLoss: number | null; takeProfit: number | null; reason: string; sourceSnapshot: SourceSnapshot | null
}
interface Group {
  id: string; origin: 'mt5' | 'manual'; manualTicket: string; sourceSnapshot: SourceSnapshot | null
  createdAt: string; boundAt: string | null; entries: Entry[]
}
interface EmotionEntry { id: string; type: 'emotion'; recordTime: string; groupId: string; emotion: string; note: string }
interface Journal { version: 1; groups: Group[]; emotions?: EmotionEntry[] }
interface Draft { entryPrice: number | undefined; stopLoss: number | undefined; takeProfit: number | undefined; reason: string }
interface EmotionDraft { groupId: string; emotion: string; note: string }
interface Attempt { fingerprint: string; requestId: string }
const props = defineProps<{ planId: string; disabled?: boolean }>()
const emit = defineEmits<{ saved: [plan: { id: string; updatedAt: string }] }>()
const emotions = ['平静', '焦虑', '恐惧', '贪婪', '急躁', '其他']
const journal = ref<Journal>({ version: 1, groups: [], emotions: [] })
const loading = ref(false), ready = ref(false), saving = ref<'append' | 'emotion' | null>(null), confirming = ref(false), error = ref('')
const showForm = ref(false), target = ref('manual'), manualTicket = ref('')
const draft = ref<Draft>(emptyDraft()), initialDraft = ref(''), ocrOpen = ref(false)
const emotionDraft = ref<EmotionDraft>(emptyEmotionDraft())
const appendAttempt = ref<Attempt>(), emotionAttempt = ref<Attempt>()
let ocrTarget = '', generation = 0
let readController: AbortController | undefined, writeController: AbortController | undefined

const selectedGroup = computed(() => journal.value.groups.find(group => `group:${group.id}` === target.value))
const busy = computed(() => loading.value || !!saving.value || ocrOpen.value || confirming.value)
const locked = computed(() => !!props.disabled || busy.value || !ready.value)
const appendContent = computed(() => ({
  groupId: selectedGroup.value?.id || '',
  manualTicket: target.value === 'manual' ? manualTicket.value.trim() : '',
  entryPrice: draft.value.entryPrice ?? null, stopLoss: draft.value.stopLoss ?? null,
  takeProfit: draft.value.takeProfit ?? null, reason: draft.value.reason.trim(),
}))
const emotionContent = computed(() => ({ groupId: emotionDraft.value.groupId, emotion: emotionDraft.value.emotion, note: emotionDraft.value.note.trim() }))
const appendFingerprint = computed(() => JSON.stringify({ planId: props.planId, target: target.value, ...appendContent.value }))
const emotionFingerprint = computed(() => JSON.stringify({ planId: props.planId, ...emotionContent.value }))
const priceDirty = computed(() => showForm.value && (appendFingerprint.value !== initialDraft.value || !!appendAttempt.value))
const emotionDirty = computed(() => !!(emotionDraft.value.groupId || emotionDraft.value.emotion || emotionDraft.value.note || emotionAttempt.value))
const dirty = computed(() => priceDirty.value || emotionDirty.value)
const needsBeforeUnload = computed(() => dirty.value || busy.value)
const retryingAppend = computed(() => appendAttempt.value?.fingerprint === appendFingerprint.value)
const targetReady = computed(() => retryingAppend.value || (target.value === 'manual' ? !!manualTicket.value.trim() : !!selectedGroup.value))
const targetLabel = computed(() => selectedGroup.value ? groupLabel(selectedGroup.value) : `手动持仓 ${manualTicket.value || '待填写编号'}`)
const emotionHistory = computed(() => journal.value.emotions || [])

// Each operation retains its own request ID after a failure or history refresh.
watch(appendFingerprint, () => { appendAttempt.value = undefined }, { flush: 'sync' })
watch(emotionFingerprint, () => { emotionAttempt.value = undefined }, { flush: 'sync' })
function emptyDraft(): Draft { return { entryPrice: undefined, stopLoss: undefined, takeProfit: undefined, reason: '' } }
function emptyEmotionDraft(): EmotionDraft { return { groupId: '', emotion: '', note: '' } }
function sourceLabel(position: SourceSnapshot) {
  return `${position.source?.broker || '未知公司'} / ${position.source?.server || '未知服务器'} / 账户 ${position.source?.accountNumber || '未记录'}${position.source?.currency ? ` / ${position.source.currency}` : ''}`
}
function positionLabel(position: SourceSnapshot) {
  return `持仓 ${position.ticket} · ${position.symbol} · ${sourceLabel(position)}`
}
function groupLabel(group: Group) {
  const label = group.sourceSnapshot ? `${group.origin === 'manual' ? `手动 ${group.manualTicket} → ` : ''}${positionLabel(group.sourceSnapshot)}` : `手动 ${group.manualTicket}`
  return `${label} · 组 ${group.id.slice(0, 8)}`
}
function emotionGroupLabel(groupId: string) {
  if (!groupId) return '本计划整体'
  const group = journal.value.groups.find(item => item.id === groupId)
  return group ? groupLabel(group) : `历史持仓组 ${groupId}`
}
function time(value: string) { return new Date(value).toLocaleString('zh-CN', { hour12: false }) }
function resetPriceDraft(nextTarget = 'manual') {
  target.value = nextTarget; manualTicket.value = ''; draft.value = emptyDraft(); appendAttempt.value = undefined
  initialDraft.value = appendFingerprint.value
}
async function confirmDiscard(message: string) {
  if (busy.value || props.disabled) return false
  confirming.value = true
  try {
    await ElMessageBox.confirm(message, '未保存的内容', { confirmButtonText: '确认丢弃', cancelButtonText: '继续填写', type: 'warning', closeOnClickModal: false })
    return true
  } catch { return false }
  finally { confirming.value = false }
}
async function canLeave({ preserveDraft = false, planDirty = false } = {}) {
  if (busy.value || props.disabled) return false
  if (preserveDraft || (!dirty.value && !planDirty)) return true
  const content = [planDirty ? '计划正文' : '', priceDirty.value ? '价位调整草稿' : '', emotionDirty.value ? '情绪草稿' : ''].filter(Boolean).join('、')
  return confirmDiscard(`${content}尚未保存。离开后将丢弃未保存的输入；已单独保存的过程记录仍会保留。`)
}
async function toggleForm() {
  if (locked.value) return
  if (showForm.value && priceDirty.value && !await confirmDiscard('收起将丢弃当前价位调整草稿；情绪草稿和已保存历史保留。')) return
  resetPriceDraft(); showForm.value = !showForm.value; error.value = ''
}
async function changeTarget(value: string) {
  if (locked.value || value === target.value) return
  if (priceDirty.value && !await confirmDiscard('更换持仓将清空当前价位调整草稿。情绪草稿和已保存历史保留。')) return
  resetPriceDraft(value); error.value = ''
}
function currentOcrTarget() { return JSON.stringify([props.planId, target.value, manualTicket.value]) }
function ocrActive(active: boolean) {
  if (active) ocrTarget = currentOcrTarget()
  ocrOpen.value = active
}
function applyOcr(row: { entryPrice: number; stopLoss: number | null; takeProfit: number | null }) {
  if (!showForm.value || props.disabled || saving.value || !targetReady.value || ocrTarget !== currentOcrTarget()) return
  draft.value.entryPrice = row.entryPrice
  draft.value.stopLoss = row.stopLoss ?? undefined; draft.value.takeProfit = row.takeProfit ?? undefined
}
async function jsonResponse<T>(response: Response): Promise<T> {
  const data = await response.json().catch(() => { throw new Error('服务返回无效响应；输入已保留，可使用相同内容重试。') })
  if (!response.ok) throw new Error(data.error || '请求失败，请稍后重试。')
  return data as T
}
async function load() {
  if (busy.value || props.disabled) return
  const id = props.planId, current = generation
  const controller = new AbortController(); readController = controller
  const timeout = window.setTimeout(() => controller.abort(), 30000)
  loading.value = true; error.value = ''
  try {
    const data = await jsonResponse<{ journal: Journal }>(await fetch(`/api/plans/${encodeURIComponent(id)}/adjustments`, { signal: controller.signal }))
    if (current !== generation || id !== props.planId) return
    journal.value = data.journal; ready.value = true
  } catch (e) {
    if (current === generation) error.value = (e as Error).name === 'AbortError' ? '读取超时，请重试。' : (e as Error).message
  } finally {
    window.clearTimeout(timeout)
    if (current === generation) { loading.value = false; readController = undefined }
  }
}
async function write(kind: 'append' | 'emotion') {
  if (locked.value) return
  if (kind === 'append') {
    if (!targetReady.value) { error.value = '请填写手动持仓编号或选择已有持仓组。'; return }
    if ([draft.value.entryPrice, draft.value.stopLoss, draft.value.takeProfit].some(value => value != null && (!Number.isFinite(value) || value <= 0))) {
      error.value = '已填价格必须为正有限数；允许保本或锁盈止损。'; return
    }
  } else {
    if (!emotions.includes(emotionDraft.value.emotion)) { error.value = '请选择本次情绪。'; return }
    if (emotionDraft.value.groupId && !journal.value.groups.some(group => group.id === emotionDraft.value.groupId)) {
      error.value = '请选择已有持仓组，或留空以记录本计划整体情绪。'; return
    }
  }
  const id = props.planId, current = generation
  const fingerprint = kind === 'append' ? appendFingerprint.value : emotionFingerprint.value
  const prior = kind === 'append' ? appendAttempt.value : emotionAttempt.value
  const attempt = prior?.fingerprint === fingerprint ? prior : { fingerprint, requestId: crypto.randomUUID() }
  if (kind === 'append') appendAttempt.value = attempt; else emotionAttempt.value = attempt
  const content = kind === 'append' ? appendContent.value : emotionContent.value
  const controller = new AbortController(); writeController = controller
  const timeout = window.setTimeout(() => controller.abort(), 30000)
  saving.value = kind; error.value = ''
  try {
    const data = await jsonResponse<{ journal: Journal; plan: { id: string; updatedAt: string }; changed: boolean }>(await fetch(
      `/api/plans/${encodeURIComponent(id)}/${kind === 'append' ? 'adjustments' : 'emotions'}`,
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...content, requestId: attempt.requestId }), signal: controller.signal },
    ))
    if (current !== generation || id !== props.planId) return
    journal.value = data.journal; emit('saved', data.plan)
    if (kind === 'append') {
      const savedGroup = data.journal.groups.find(group => group.entries.some(entry => entry.requestId === attempt.requestId))
      resetPriceDraft(savedGroup ? `group:${savedGroup.id}` : target.value)
      ElMessage.success('价位调整已保存，情绪草稿和开仓计划保持不变。')
    } else {
      emotionDraft.value = emptyEmotionDraft(); emotionAttempt.value = undefined
      ElMessage.success('情绪已保存，价位调整草稿和开仓计划保持不变。')
    }
  } catch (e) {
    if (current === generation) error.value = (e as Error).name === 'AbortError'
      ? '保存超时，结果尚未确认；请保持内容不变并重试，避免重复记录。' : (e as Error).message
  } finally {
    window.clearTimeout(timeout)
    if (current === generation) { saving.value = null; writeController = undefined }
  }
}
watch(() => props.planId, () => {
  generation++; readController?.abort(); writeController?.abort()
  loading.value = false; saving.value = null; ready.value = false; showForm.value = false; ocrOpen.value = false; error.value = ''
  journal.value = { version: 1, groups: [], emotions: [] }; resetPriceDraft()
  emotionDraft.value = emptyEmotionDraft(); emotionAttempt.value = undefined; void load()
}, { immediate: true, flush: 'sync' })
watch(() => props.disabled, disabled => { if (!disabled && !ready.value && !error.value) void load() })
onBeforeUnmount(() => { generation++; readController?.abort(); writeController?.abort() })

defineExpose({ canLeave, busy, dirty, needsBeforeUnload })
</script>

<template>
  <ElCard shadow="never" class="plan-adjustments">
    <template #header><div class="plan-card-heading"><h2>持仓过程</h2><ElButton native-type="button" :disabled="locked" @click="toggleForm">{{ showForm ? '收起 / 取消价位草稿' : '追加价位调整' }}</ElButton></div></template>
    <p class="adjustment-help">价位调整按持仓编号分别保留，情绪可独立记录。两类记录各自保存，不改开仓计划。已有来源仅保留为历史快照，可继续追加。</p>
    <ElAlert v-if="error" :title="error" type="error" :closable="false" show-icon class="plan-alert"/>
    <ElButton v-if="error" native-type="button" :disabled="busy || disabled" @click="load">重新读取历史（保留两类草稿）</ElButton>
    <ElSkeleton v-if="loading" :rows="3" animated/>
    <!-- Keep OCR's own dialog enabled while locking the surrounding inputs. -->
    <ElForm v-if="showForm" label-position="top" :disabled="disabled || loading || !!saving || confirming || !ready" @submit.prevent.stop="write('append')">
      <ElFormItem label="记录到哪笔持仓" required>
        <ElSelect :model-value="target" :disabled="locked" @update:model-value="changeTarget" aria-label="选择持仓调整记录组">
          <ElOption label="新建手动持仓组" value="manual"/>
          <ElOption v-for="group in journal.groups" :key="group.id" :label="groupLabel(group)" :value="`group:${group.id}`"/>
        </ElSelect>
      </ElFormItem>
      <ElFormItem v-if="target === 'manual'" label="手动持仓编号" required>
        <ElInput v-model="manualTicket" :disabled="locked" maxlength="100" placeholder="必填；相同编号也会建立独立记录组"/>
      </ElFormItem>
      <p class="adjustment-help">{{ targetLabel }}</p>
      <div class="adjustment-ocr">
        <PriceOcr :key="planId" :disabled="disabled || loading || !!saving || confirming || !ready || !targetReady" :target-label="`调整草稿 · ${targetLabel}`" @active-change="ocrActive" @apply="applyOcr"/>
        <span>请手填编号或选择已有组后识别。单行自动填入，多行选择一行；图片不保存。</span>
      </div>
      <div class="plan-three-columns">
        <ElFormItem label="参考入场价（选填）"><ElInputNumber v-model="draft.entryPrice" :disabled="locked" :controls="false" placeholder="选填"/></ElFormItem>
        <ElFormItem label="本次止损"><ElInputNumber v-model="draft.stopLoss" :disabled="locked" :controls="false" placeholder="本次未设置"/></ElFormItem>
        <ElFormItem label="本次止盈"><ElInputNumber v-model="draft.takeProfit" :disabled="locked" :controls="false" placeholder="本次未设置"/></ElFormItem>
      </div>
      <p class="adjustment-help">空白止盈、止损表示本次未设置；允许保本与锁盈。</p>
      <ElFormItem label="调整原因（选填）"><ElInput v-model="draft.reason" :disabled="locked" maxlength="2000" type="textarea" :rows="2" placeholder="例如移动到保本或锁定利润"/></ElFormItem>
      <ElButton type="primary" native-type="submit" :loading="saving === 'append'" :disabled="locked || !targetReady">保存这次价位调整</ElButton>
    </ElForm>
    <ElForm label-position="top" :disabled="locked" class="emotion-form" @submit.prevent.stop="write('emotion')">
      <h3>记录此刻情绪</h3>
      <p class="adjustment-help">无需填写价格；保存情绪不会改变价位调整草稿或上一次价位记录。</p>
      <div class="emotion-fields">
        <ElFormItem label="本次情绪" required>
          <ElSelect v-model="emotionDraft.emotion" placeholder="选择一种情绪" aria-label="本次情绪">
            <ElOption v-for="emotion in emotions" :key="emotion" :label="emotion" :value="emotion"/>
          </ElSelect>
        </ElFormItem>
        <ElFormItem label="关联已有持仓组（选填）">
          <ElSelect v-model="emotionDraft.groupId" clearable filterable placeholder="留空表示本计划整体" aria-label="情绪关联持仓组">
            <ElOption v-for="group in journal.groups" :key="group.id" :label="groupLabel(group)" :value="group.id"/>
          </ElSelect>
        </ElFormItem>
      </div>
      <ElFormItem label="情绪备注（选填）"><ElInput v-model="emotionDraft.note" maxlength="2000" type="textarea" :rows="2" placeholder="记录当时的想法、触发原因或应对方式"/></ElFormItem>
      <ElButton type="primary" native-type="submit" :loading="saving === 'emotion'" :disabled="locked || !emotionDraft.emotion">保存这次情绪</ElButton>
    </ElForm>
    <h3 class="history-heading">价位调整历史</h3>
    <ElEmpty v-if="ready && !loading && !journal.groups.length" description="还没有持仓调整记录"/>
    <article v-for="group in journal.groups" :key="group.id" class="adjustment-group">
      <h3><ElTag size="small">{{ group.origin === 'manual' ? '手动建立' : '历史 MT5 来源' }}</ElTag> {{ groupLabel(group) }}</h3>
      <p class="adjustment-help">记录组 {{ group.id }} · 建立于 {{ time(group.createdAt) }}<span v-if="group.boundAt"> · 历史绑定于 {{ time(group.boundAt) }}</span></p>
      <ol class="adjustment-timeline">
        <li v-for="entry in group.entries" :key="entry.id">
          <time :datetime="entry.recordTime" :title="`UTC ${entry.recordTime}`">{{ time(entry.recordTime) }}</time>
          <div class="adjustment-entry"><span>参考入场价 {{ entry.entryPrice ?? '未填写' }}</span><span>止损 {{ entry.stopLoss ?? '本次未设置' }}</span><span>止盈 {{ entry.takeProfit ?? '本次未设置' }}</span></div>
          <p v-if="entry.reason" class="adjustment-reason">{{ entry.reason }}</p>
          <p class="adjustment-help">记录时来源：{{ entry.sourceSnapshot ? positionLabel(entry.sourceSnapshot) : `手动 ${group.manualTicket}（当时未绑定来源）` }}</p>
        </li>
      </ol>
    </article>
    <h3 class="history-heading">情绪记录历史</h3>
    <ElEmpty v-if="ready && !loading && !emotionHistory.length" description="还没有情绪记录"/>
    <ol v-if="emotionHistory.length" class="adjustment-timeline emotion-history">
      <li v-for="entry in emotionHistory" :key="entry.id">
        <time :datetime="entry.recordTime" :title="`UTC ${entry.recordTime}`">{{ time(entry.recordTime) }}</time>
        <div class="adjustment-entry"><ElTag size="small" type="info">情绪 · {{ entry.emotion }}</ElTag></div>
        <p class="adjustment-help">{{ emotionGroupLabel(entry.groupId) }}</p>
        <p v-if="entry.note" class="adjustment-reason">{{ entry.note }}</p>
      </li>
    </ol>
  </ElCard>
</template>

<style scoped>
.plan-adjustments{margin-top:20px}
.adjustment-help,.adjustment-ocr{color:var(--el-text-color-secondary);font-size:13px;line-height:1.7;margin:10px 0 16px;overflow-wrap:anywhere}
.adjustment-ocr{display:flex;align-items:center;gap:12px;flex-wrap:wrap}
.emotion-form{border:1px solid var(--el-border-color-light);border-radius:var(--el-border-radius-base);padding:16px;margin-top:20px}
.emotion-fields{display:grid;grid-template-columns:minmax(140px,1fr) minmax(200px,2fr);gap:16px}
.history-heading{margin:24px 0 12px}
.adjustment-group{padding:20px 0;border-bottom:1px solid var(--el-border-color-light);overflow-wrap:anywhere}
.adjustment-group h3{line-height:1.8}
.adjustment-timeline{padding-left:22px;margin:12px 0 0;border-left:2px solid var(--el-border-color-light);list-style:none}
.adjustment-timeline li{padding:0 0 20px;position:relative}
.adjustment-timeline li::before{content:'';position:absolute;width:8px;height:8px;border-radius:50%;background:var(--el-color-primary);left:-27px;top:5px}
.adjustment-timeline time{color:var(--el-text-color-secondary);font-size:13px}
.adjustment-entry{display:flex;flex-wrap:wrap;gap:8px 20px;margin-top:8px;color:var(--el-text-color-primary)}
.adjustment-reason{white-space:pre-wrap;margin-top:8px;line-height:1.7;overflow-wrap:anywhere}
.emotion-history li::before{background:var(--el-color-info)}
@media(max-width:640px){.emotion-fields{grid-template-columns:minmax(0,1fr);gap:0}}
</style>
