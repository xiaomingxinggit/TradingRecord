<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { ElAlert, ElButton, ElCard, ElEmpty, ElForm, ElFormItem, ElImage, ElInput, ElInputNumber, ElMessage, ElOption, ElSelect, ElSkeleton, ElTag } from 'element-plus'
import PriceOcr from './PriceOcr.vue'

type EventType = 'price' | 'emotion' | 'note'
interface ProcessImage { id: string; name: string; url: string; mimeType: string; size: number }
interface ProcessEvent {
  id: string; type: EventType; recordedAt: string; entryPrice: number | null; stopLoss: number | null
  takeProfit: number | null; emotion: string; note: string; images: ProcessImage[]
}
interface SourceSnapshot {
  ticket?: string; symbol?: string; side?: string
  source?: { broker?: string; server?: string; accountNumber?: string; currency?: string } | null
}
interface LegacyEntry {
  id: string; recordTime: string; entryPrice: number | null; stopLoss: number | null; takeProfit: number | null
  reason: string; sourceSnapshot?: SourceSnapshot | null; orderId?: string
}
interface LegacyGroup {
  id: string; origin: string; manualTicket: string; sourceSnapshot?: SourceSnapshot | null
  createdAt: string; boundAt?: string | null; orderId?: string; orderBoundAt?: string; entries: LegacyEntry[]
}
interface LegacyEmotion { id: string; recordTime: string; emotion: string; note: string; groupId?: string; orderId?: string }
interface ProcessHistory { events: ProcessEvent[]; legacy: { groups: LegacyGroup[]; emotions: LegacyEmotion[] } }
interface DraftImage { id: string; file: File; url: string }
interface Draft { entryPrice: number | undefined; stopLoss: number | undefined; takeProfit: number | undefined; emotion: string; note: string; images: DraftImage[] }
interface Attempt { fingerprint: string; requestId: string }
const props = withDefaults(defineProps<{ orderId: string; disabled?: boolean; active?: boolean }>(), { active: true })
const emit = defineEmits<{ saved: [] }>()
const types: EventType[] = ['price', 'emotion', 'note']
const labels: Record<EventType, string> = { price: '价位调整', emotion: '情绪记录', note: '判断 / 备注' }
const emotions = ['平静', '焦虑', '恐惧', '贪婪', '急躁', '其他']
const selectedType = ref<EventType>('price')
const drafts = ref<Record<EventType, Draft>>({ price: emptyDraft(), emotion: emptyDraft(), note: emptyDraft() })
const attempts = ref<Partial<Record<EventType, Attempt>>>({})
const history = ref<ProcessHistory>({ events: [], legacy: { groups: [], emotions: [] } })
const loading = ref(false), saving = ref(false), ready = ref(false), ocrOpen = ref(false), error = ref('')
const input = ref<HTMLInputElement>()
let generation = 0, ocrTarget = '', fileTarget = ''
let readController: AbortController | undefined, writeController: AbortController | undefined
const currentDraft = computed(() => drafts.value[selectedType.value])
const busy = computed(() => loading.value || saving.value || ocrOpen.value)
const locked = computed(() => !!props.disabled || !props.active || !ready.value || busy.value)
// OCR owns its modal controls; its own open state must not disable that modal.
const formDisabled = computed(() => !!props.disabled || !props.active || !ready.value || loading.value || saving.value)
const fingerprints = computed(() => Object.fromEntries(types.map(type => [type, JSON.stringify({ orderId: props.orderId, ...payload(type), images: drafts.value[type].images.map(image => image.id) })])) as Record<EventType, string>)
const dirty = computed(() => types.some(type => draftDirty(type)))
const needsBeforeUnload = computed(() => dirty.value || busy.value)
const hasLegacy = computed(() => history.value.legacy.groups.length || history.value.legacy.emotions.length)

for (const type of types) watch(() => fingerprints.value[type], () => { delete attempts.value[type] }, { flush: 'sync' })
function emptyDraft(): Draft { return { entryPrice: undefined, stopLoss: undefined, takeProfit: undefined, emotion: '', note: '', images: [] } }
function draftDirty(type: EventType) {
  const draft = drafts.value[type]
  return !!(attempts.value[type] || draft.images.length || draft.note || (type === 'emotion' && draft.emotion)
    || (type === 'price' && [draft.entryPrice, draft.stopLoss, draft.takeProfit].some(value => value != null)))
}
function payload(type: EventType) {
  const draft = drafts.value[type]
  return { type, note: draft.note.trim(), ...(type === 'price' ? {
    entryPrice: draft.entryPrice ?? null, stopLoss: draft.stopLoss ?? null, takeProfit: draft.takeProfit ?? null,
  } : type === 'emotion' ? { emotion: draft.emotion } : {}) }
}
function releaseImages(type: EventType) { drafts.value[type].images.forEach(image => URL.revokeObjectURL(image.url)) }
function resetDraft(type: EventType) { releaseImages(type); drafts.value[type] = emptyDraft(); delete attempts.value[type] }
function changeType(value: EventType) { if (!locked.value && types.includes(value)) selectedType.value = value }
function addImages(files: File[]) {
  if (locked.value || !files.length) return
  if (currentDraft.value.images.length + files.length > 4) { error.value = '每次事件最多保存 4 张图片；现有附件已保留。'; return }
  if (files.some(file => !['image/png', 'image/jpeg', 'image/webp'].includes(file.type) || !file.size || file.size > 5 * 1024 * 1024)) {
    error.value = '请选择单张不超过 5 MB 的 PNG、JPEG 或 WebP 图片。'; return
  }
  const additions: DraftImage[] = []
  try {
    for (const file of files) additions.push({ id: crypto.randomUUID(), file, url: URL.createObjectURL(file) })
    currentDraft.value.images.push(...additions); error.value = ''
  } catch {
    additions.forEach(image => URL.revokeObjectURL(image.url)); error.value = '无法读取所选图片，请重新选择。'
  }
}
function chooseImages() {
  if (locked.value) return
  fileTarget = `${generation}:${props.orderId}:${selectedType.value}`; input.value?.click()
}
function pickImages(event: Event) {
  const element = event.target as HTMLInputElement
  if (fileTarget === `${generation}:${props.orderId}:${selectedType.value}`) addImages(Array.from(element.files || []))
  element.value = ''
}
function removeImage(id: string) {
  if (locked.value) return
  const index = currentDraft.value.images.findIndex(image => image.id === id)
  if (index < 0) return
  URL.revokeObjectURL(currentDraft.value.images[index]!.url); currentDraft.value.images.splice(index, 1)
}
function paste(event: ClipboardEvent) {
  if (locked.value || event.defaultPrevented) return
  const files = Array.from(event.clipboardData?.files || []).filter(file => file.type.startsWith('image/'))
  if (!files.length) return
  // Scoped bubbling avoids sibling forms; PriceOcr intercepts its modal at capture.
  event.preventDefault(); event.stopPropagation(); addImages(files)
}
function ocrActive(active: boolean) {
  if (active) ocrTarget = `${generation}:${props.orderId}:${selectedType.value}`
  ocrOpen.value = active
}
function applyOcr(row: { entryPrice: number; stopLoss: number | null; takeProfit: number | null }) {
  if (formDisabled.value || selectedType.value !== 'price' || ocrTarget !== `${generation}:${props.orderId}:price`) return
  drafts.value.price.entryPrice = row.entryPrice
  drafts.value.price.stopLoss = row.stopLoss ?? undefined; drafts.value.price.takeProfit = row.takeProfit ?? undefined
}
async function responseHistory(response: Response): Promise<ProcessHistory> {
  const data = await response.json().catch(() => { throw new Error('服务返回无效响应。草稿已保留，请保持内容不变并重试。') })
  if (!response.ok) throw new Error(typeof data.error === 'string' ? data.error : '请求失败，请稍后重试。')
  if (!Array.isArray(data.events) || !data.legacy || !Array.isArray(data.legacy.groups) || !Array.isArray(data.legacy.emotions)) {
    throw new Error('过程历史响应不完整。草稿已保留，请保持内容不变并重试。')
  }
  return { events: data.events, legacy: data.legacy }
}
async function load() {
  if (busy.value || props.disabled || !props.active || !props.orderId) return
  const id = props.orderId, current = generation, controller = new AbortController()
  readController = controller; loading.value = true; error.value = ''
  const timeout = window.setTimeout(() => controller.abort(), 30000)
  try {
    const data = await responseHistory(await fetch(`/api/orders/${encodeURIComponent(id)}/process`, { signal: controller.signal }))
    if (generation !== current || props.orderId !== id) return
    history.value = data; ready.value = true
  } catch (e) {
    if (generation === current) error.value = (e as Error).name === 'AbortError' ? '读取超时，请重新读取；草稿已保留。' : (e as Error).message
  } finally {
    window.clearTimeout(timeout)
    if (generation === current) { loading.value = false; readController = undefined }
  }
}
async function save() {
  if (locked.value) return
  const type = selectedType.value, draft = drafts.value[type]
  if (type === 'price' && [draft.entryPrice, draft.stopLoss, draft.takeProfit].some(value => value != null && (!Number.isFinite(value) || value <= 0))) {
    error.value = '已填价格必须为正有限数；允许保本或锁盈止损。'; return
  }
  if (type === 'emotion' && !emotions.includes(draft.emotion)) { error.value = '请选择本次情绪。'; return }
  if (type === 'note' && !draft.note.trim() && !draft.images.length) { error.value = '判断 / 备注至少填写文字或添加一张图片。'; return }
  const id = props.orderId, current = generation, fingerprint = fingerprints.value[type]
  const prior = attempts.value[type]
  const attempt = prior?.fingerprint === fingerprint ? prior : { fingerprint, requestId: crypto.randomUUID() }
  attempts.value[type] = attempt
  const body = new FormData(); body.append('payload', JSON.stringify({ ...payload(type), requestId: attempt.requestId }))
  for (const image of draft.images) body.append('images', image.file, image.file.name)
  const controller = new AbortController(); writeController = controller; saving.value = true; error.value = ''
  const timeout = window.setTimeout(() => controller.abort(), 60000)
  try {
    const data = await responseHistory(await fetch(`/api/orders/${encodeURIComponent(id)}/process`, { method: 'POST', body, signal: controller.signal }))
    if (generation !== current || props.orderId !== id) return
    history.value = data; resetDraft(type); emit('saved')
    ElMessage.success(`${labels[type]}已保存，其他类型的草稿保留。`)
  } catch (e) {
    if (generation === current) error.value = (e as Error).name === 'AbortError'
      ? '保存超时，结果尚未确认。文字与图片已保留，请保持内容不变并重试，避免重复记录。' : (e as Error).message
  } finally {
    window.clearTimeout(timeout)
    if (generation === current) { saving.value = false; writeController = undefined }
  }
}
function imageUrl(event: ProcessEvent, image: ProcessImage) {
  return `/api/orders/${encodeURIComponent(props.orderId)}/process/${encodeURIComponent(event.id)}/images/${encodeURIComponent(image.id)}`
}
function time(value: string) { return new Date(value).toLocaleString('zh-CN', { hour12: false }) }
function sourceLabel(source: SourceSnapshot) {
  return `持仓 ${source.ticket || '未记录'} · ${source.symbol || '未记录品种'} · ${source.side || '未记录方向'} · ${source.source?.broker || '未知公司'} / ${source.source?.server || '未知服务器'} / 账户 ${source.source?.accountNumber || '未记录'}${source.source?.currency ? ` / ${source.source.currency}` : ''}`
}
function groupLabel(group: LegacyGroup) {
  return `${group.origin === 'manual' ? `原手动编号 ${group.manualTicket}` : group.origin === 'order' ? '原订单过程组' : '历史 MT5 来源'}${group.sourceSnapshot ? ` · ${sourceLabel(group.sourceSnapshot)}` : ''}`
}
function legacyEmotionGroup(groupId?: string) {
  if (!groupId) return '原计划级情绪'
  const group = history.value.legacy.groups.find(item => item.id === groupId)
  return group ? `${groupLabel(group)} · 组 ${group.id}` : `原过程组 ${groupId}`
}
watch(() => props.orderId, () => {
  generation++; readController?.abort(); writeController?.abort()
  types.forEach(resetDraft); selectedType.value = 'price'; history.value = { events: [], legacy: { groups: [], emotions: [] } }
  loading.value = false; saving.value = false; ocrOpen.value = false; ready.value = false; error.value = ''; void load()
}, { immediate: true, flush: 'sync' })
watch([() => props.disabled, () => props.active], () => { if (!props.disabled && props.active && !ready.value && !error.value) void load() })
onBeforeUnmount(() => { generation++; readController?.abort(); writeController?.abort(); types.forEach(releaseImages) })
defineExpose({ busy, dirty, needsBeforeUnload })
</script>

<template>
  <section class="order-process" @paste="paste">
    <ElCard shadow="never">
      <template #header><div class="process-heading"><h2>订单持仓过程</h2><ElButton native-type="button" :disabled="busy || disabled || !active" @click="load">刷新历史</ElButton></div></template>
      <p class="process-help">记录属于当前订单。价位、情绪、判断分别保存；切换类型保留各自草稿，不修改订单成交事实或计划。</p>
      <ElAlert v-if="error" :title="error" type="error" :closable="false" show-icon class="process-alert"/>
      <ElSkeleton v-if="loading" :rows="3" animated/>
      <ElForm label-position="top" :disabled="formDisabled" @submit.prevent.stop="save">
        <ElFormItem label="记录类型">
          <ElSelect :model-value="selectedType" :disabled="locked" aria-label="订单过程记录类型" @update:model-value="changeType">
            <ElOption v-for="type in types" :key="type" :value="type" :label="`${labels[type]}${draftDirty(type) ? ' · 有草稿' : ''}`"/>
          </ElSelect>
        </ElFormItem>
        <template v-if="selectedType === 'price'">
          <div class="process-ocr"><PriceOcr :key="orderId" :disabled="formDisabled" :target-label="`订单 ${orderId} · 价位调整草稿`" @active-change="ocrActive" @apply="applyOcr"/><span>仅填入本次价位；识别图片不会自动保存为附件。</span></div>
          <div class="process-prices">
            <ElFormItem label="参考入场价（选填）"><ElInputNumber v-model="currentDraft.entryPrice" :controls="false" :disabled="locked" placeholder="未填写"/></ElFormItem>
            <ElFormItem label="本次止损"><ElInputNumber v-model="currentDraft.stopLoss" :controls="false" :disabled="locked" placeholder="本次未设置"/></ElFormItem>
            <ElFormItem label="本次止盈"><ElInputNumber v-model="currentDraft.takeProfit" :controls="false" :disabled="locked" placeholder="本次未设置"/></ElFormItem>
          </div>
          <p class="process-help">空白止损 / 止盈表示本次未设置；允许保本或锁盈。情绪与备注不会覆盖价位历史。</p>
        </template>
        <ElFormItem v-if="selectedType === 'emotion'" label="本次情绪" required>
          <ElSelect v-model="currentDraft.emotion" :disabled="locked" placeholder="选择一种情绪" aria-label="订单过程情绪"><ElOption v-for="emotion in emotions" :key="emotion" :value="emotion" :label="emotion"/></ElSelect>
        </ElFormItem>
        <ElFormItem :label="selectedType === 'price' ? '调整原因（选填）' : selectedType === 'emotion' ? '情绪备注（选填）' : '判断 / 备注'">
          <ElInput v-model="currentDraft.note" type="textarea" :rows="3" maxlength="2000" :disabled="locked" :placeholder="selectedType === 'note' ? '记录当时判断；也可以仅添加图片' : '记录当时想法或原因'"/>
        </ElFormItem>
        <div class="attachment-area" tabindex="0" aria-label="过程图片附件，点击后可粘贴截图">
          <input ref="input" type="file" accept="image/png,image/jpeg,image/webp" multiple hidden :disabled="locked" @change="pickImages"/>
          <ElButton native-type="button" :disabled="locked || currentDraft.images.length >= 4" @click="chooseImages">添加图片（{{ currentDraft.images.length }}/4）</ElButton>
          <p class="process-help">在本栏点击后粘贴截图，或选择文件。每条记录最多 4 张，单张不超过 5 MB，支持 PNG、JPEG、WebP。</p>
          <div v-if="currentDraft.images.length" class="process-images">
            <figure v-for="image in currentDraft.images" :key="image.id">
              <ElImage :src="image.url" :alt="image.file.name" fit="contain" :preview-src-list="currentDraft.images.map(item => item.url)" :initial-index="currentDraft.images.indexOf(image)" preview-teleported/>
              <figcaption>{{ image.file.name }}<ElButton native-type="button" link type="danger" :disabled="locked" @click="removeImage(image.id)">移除</ElButton></figcaption>
            </figure>
          </div>
        </div>
        <ElButton class="process-save" type="primary" native-type="submit" :loading="saving" :disabled="locked">保存这次{{ labels[selectedType] }}</ElButton>
      </ElForm>
    </ElCard>
    <ElCard shadow="never" class="process-history">
      <template #header><h2>订单过程历史</h2></template>
      <ElEmpty v-if="ready && !history.events.length" description="还没有订单过程记录"/>
      <ol class="process-timeline">
        <li v-for="event in history.events" :key="event.id">
          <div class="event-heading"><ElTag>{{ labels[event.type] }}</ElTag><time :datetime="event.recordedAt" :title="event.recordedAt">{{ time(event.recordedAt) }}</time></div>
          <div v-if="event.type === 'price'" class="event-prices"><span>参考入场价 {{ event.entryPrice ?? '未填写' }}</span><span>止损 {{ event.stopLoss ?? '本次未设置' }}</span><span>止盈 {{ event.takeProfit ?? '本次未设置' }}</span></div>
          <p v-if="event.type === 'emotion'">情绪：{{ event.emotion }}</p>
          <p v-if="event.note" class="event-note">{{ event.note }}</p>
          <div v-if="event.images?.length" class="process-images">
            <figure v-for="(image, index) in event.images" :key="image.id"><ElImage :src="imageUrl(event, image)" :alt="image.name" fit="contain" :preview-src-list="event.images.map(item => imageUrl(event, item))" :initial-index="index" preview-teleported/><figcaption>{{ image.name }}</figcaption></figure>
          </div>
        </li>
      </ol>
    </ElCard>
    <ElCard v-if="hasLegacy" shadow="never" class="process-history">
      <template #header><h2>历史计划过程来源</h2></template>
      <p class="process-help">以下是明确关联的旧计划过程，只读保留原编号、来源与时间。它们未复制为新的订单过程事件。</p>
      <article v-for="group in history.legacy.groups" :key="group.id" class="legacy-group">
        <h3>{{ groupLabel(group) }}</h3>
        <p class="process-help">原组 {{ group.id }} · 建立于 {{ time(group.createdAt) }}<span v-if="group.boundAt"> · 历史来源绑定于 {{ time(group.boundAt) }}</span><span v-if="group.orderBoundAt"> · 订单绑定于 {{ time(group.orderBoundAt) }}</span><span v-if="group.orderId"> · 订单 ID {{ group.orderId }}</span></p>
        <ol class="process-timeline">
          <li v-for="entry in group.entries" :key="entry.id">
            <time :datetime="entry.recordTime" :title="entry.recordTime">{{ time(entry.recordTime) }}</time>
            <div class="event-prices"><span>参考入场价 {{ entry.entryPrice ?? '未填写' }}</span><span>止损 {{ entry.stopLoss ?? '本次未设置' }}</span><span>止盈 {{ entry.takeProfit ?? '本次未设置' }}</span></div>
            <p v-if="entry.reason" class="event-note">{{ entry.reason }}</p>
            <p class="process-help">记录时来源：{{ entry.sourceSnapshot ? sourceLabel(entry.sourceSnapshot) : group.origin === 'manual' ? `手动 ${group.manualTicket}（当时未绑定来源）` : '当时无来源快照' }} · 记录时订单：{{ entry.orderId || '当时未关联订单' }}</p>
          </li>
        </ol>
      </article>
      <h3 v-if="history.legacy.emotions.length">历史情绪记录</h3>
      <ol class="process-timeline">
        <li v-for="emotion in history.legacy.emotions" :key="emotion.id">
          <div class="event-heading"><ElTag type="info">情绪 · {{ emotion.emotion }}</ElTag><time :datetime="emotion.recordTime" :title="emotion.recordTime">{{ time(emotion.recordTime) }}</time></div>
          <p class="process-help">{{ legacyEmotionGroup(emotion.groupId) }} · 记录时订单：{{ emotion.orderId || '当时未关联订单' }}</p>
          <p v-if="emotion.note" class="event-note">{{ emotion.note }}</p>
        </li>
      </ol>
    </ElCard>
  </section>
</template>

<style scoped>
.order-process{min-width:0}.process-heading,.event-heading{display:flex;align-items:center;gap:12px;flex-wrap:wrap}.process-heading{justify-content:space-between}
h2,h3{margin:0;font-size:17px;line-height:1.6;overflow-wrap:anywhere}h3{font-size:15px}.process-help,.process-ocr{font-size:13px;line-height:1.7;color:var(--el-text-color-secondary);overflow-wrap:anywhere}.process-help{margin:10px 0 16px}.process-alert{margin-bottom:16px}.process-ocr{display:flex;align-items:center;flex-wrap:wrap;gap:12px;margin-bottom:16px}
.process-prices{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:16px}.process-prices :deep(.el-input-number){width:100%}.attachment-area{border:1px dashed var(--el-border-color);border-radius:var(--el-border-radius-base);padding:14px}.attachment-area:focus-visible{outline:2px solid var(--el-color-primary);outline-offset:2px}.process-save{margin-top:16px}
.process-images{display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,240px));gap:12px}.process-images figure{margin:0;min-width:0}.process-images :deep(.el-image){display:block;height:160px;width:100%;background:var(--el-fill-color-light);border:1px solid var(--el-border-color-light);border-radius:4px}.process-images figcaption{display:flex;align-items:center;justify-content:space-between;gap:8px;overflow-wrap:anywhere;font-size:12px;color:var(--el-text-color-secondary);padding-top:6px}
.process-history{margin-top:20px}.process-timeline{list-style:none;padding:0;margin:12px 0 0}.process-timeline>li{padding:16px 0;border-bottom:1px solid var(--el-border-color-light)}.process-timeline>li:last-child{border-bottom:0}time{font-size:13px;color:var(--el-text-color-secondary)}.event-prices{display:flex;gap:8px 20px;flex-wrap:wrap;margin-top:12px}.event-note{white-space:pre-wrap;overflow-wrap:anywhere;line-height:1.8}.legacy-group{padding:16px 0;border-bottom:1px solid var(--el-border-color-light)}
@media(max-width:640px){.process-prices{grid-template-columns:minmax(0,1fr);gap:0}.process-images{grid-template-columns:repeat(2,minmax(0,1fr))}}
</style>
