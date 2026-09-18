<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { ElAlert, ElButton, ElCard, ElEmpty, ElForm, ElFormItem, ElMessage, ElMessageBox, ElOption, ElSelect, ElSkeleton } from 'element-plus'
interface Source { positionId?: string; ticket?: string; symbol?: string; side?: string; entryPrice?: number; sourceFile?: string; reportDate?: string; source?: { broker?: string; server?: string; accountNumber?: string; currency?: string } }
interface Entry { id: string; recordTime: string; entryPrice: number | null; stopLoss: number | null; takeProfit: number | null; reason: string; sourceSnapshot?: Source; orderId?: string }
interface Group { id: string; origin: string; manualTicket: string; orderId?: string; orderBoundAt?: string; sourceSnapshot?: Source; entries: Entry[]; createdAt: string }
interface Emotion { id: string; emotion: string; note: string; recordTime: string; groupId?: string; orderId?: string }
interface Journal { groups: Group[]; emotions?: Emotion[] }
interface Order { id: string; ticket: string; symbol: string }
const props = defineProps<{ planId: string; disabled?: boolean; ordersVersion?: number }>()
const emit = defineEmits<{ saved: [plan: { id: string; updatedAt: string }] }>()
const journal = ref<Journal>({ groups: [], emotions: [] }), orders = ref<Order[]>([])
const binding = ref({ groupId: '', orderId: '' }), error = ref(''), ready = ref(false), loading = ref(false), saving = ref(false), confirming = ref(false)
const attempt = ref<{ fingerprint: string; requestId: string }>()
const fingerprint = computed(() => JSON.stringify({ planId: props.planId, ...binding.value }))
const busy = computed(() => loading.value || saving.value || confirming.value)
const dirty = computed(() => !!(binding.value.groupId || binding.value.orderId || attempt.value))
const needsBeforeUnload = computed(() => busy.value || dirty.value)
const locked = computed(() => !!props.disabled || busy.value || !ready.value)
const retry = computed(() => attempt.value?.fingerprint === fingerprint.value)
const groups = computed(() => journal.value.groups.filter(g => !g.orderId || (retry.value && g.id === binding.value.groupId)))
const available = computed(() => orders.value.filter(o => !journal.value.groups.some(g => g.orderId === o.id) || (retry.value && o.id === binding.value.orderId)))
let generation = 0, controller: AbortController | undefined
const refreshPending = ref(false)
watch(fingerprint, () => { attempt.value = undefined }, { flush: 'sync' })
function time(value: string) { return new Date(value).toLocaleString('zh-CN', { hour12: false }) }
function source(value?: Source) {
  if (!value) return '手动记录，无来源快照'
  return `${value.ticket || '未知编号'} · ${value.symbol || ''} · ${value.side === 'buy' ? '做多' : value.side === 'sell' ? '做空' : '方向未知'}\n${value.source?.broker || '未知公司'} / ${value.source?.server || '未知服务器'} / ${value.source?.accountNumber || '未知账户'} / ${value.source?.currency || '未知币种'}\n参考开仓价：${value.entryPrice ?? '未记录'} · 持仓 ID：${value.positionId || '未记录'}\n来源文件：${value.sourceFile || '未记录'} · 报告日期：${value.reportDate || '未记录'}`
}
function label(group: Group) { return `${group.manualTicket || group.sourceSnapshot?.ticket || '历史组'} · ${group.id.slice(0, 8)}` }
async function request<T>(suffix: string, body?: object) {
  const current = new AbortController(); controller = current
  const timer = window.setTimeout(() => current.abort(), 30000)
  try {
    const response = await fetch(`/api/plans/${encodeURIComponent(props.planId)}/adjustments${suffix}`, { signal: current.signal, ...(body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {}) })
    const result = await response.json(); if (!response.ok) throw new Error(result.error || '历史过程读取或绑定失败。'); return result as T
  } finally { window.clearTimeout(timer); if (controller === current) controller = undefined }
}
async function load() {
  if (busy.value || props.disabled) return
  const version = generation; refreshPending.value = false; loading.value = true; error.value = ''
  try { const data = await request<{ journal: Journal; orders: Order[] }>(''); if (version === generation) { journal.value = data.journal; orders.value = data.orders || []; ready.value = true } }
  catch (e) { if (version === generation) error.value = (e as Error).name === 'AbortError' ? '读取超时，请重试。' : (e as Error).message }
  finally { if (version === generation) loading.value = false }
}
async function bind() {
  if (locked.value || !binding.value.groupId || !binding.value.orderId) return
  const group = groups.value.find(g => g.id === binding.value.groupId), order = available.value.find(o => o.id === binding.value.orderId)
  if (!group || !order) { error.value = '请选择未绑定的历史组及当前计划订单。'; return }
  confirming.value = true
  try { await ElMessageBox.confirm(`将历史组 ${label(group)} 绑定到订单 ${order.ticket}？只建立可追溯来源，不复制或改写旧条目，不合并其他组。`, '核对历史来源', { confirmButtonText: '确认绑定', cancelButtonText: '继续核对', closeOnClickModal: false }) }
  catch { return } finally { confirming.value = false }
  const version = generation; const operation = attempt.value?.fingerprint === fingerprint.value ? attempt.value : { fingerprint: fingerprint.value, requestId: crypto.randomUUID() }; attempt.value = operation
  saving.value = true; error.value = ''
  try {
    const data = await request<{ journal: Journal; plan: { id: string; updatedAt: string } }>('/bind-order', { ...binding.value, requestId: operation.requestId })
    if (version !== generation) return
    journal.value = data.journal; binding.value = { groupId: '', orderId: '' }; attempt.value = undefined; emit('saved', data.plan); ElMessage.success('历史过程来源已绑定，旧记录保持原样。')
  } catch (e) { if (version === generation) error.value = (e as Error).name === 'AbortError' ? '结果尚未确认，可保持相同选择重试。' : (e as Error).message }
  finally { if (version === generation) saving.value = false }
}
watch(() => props.planId, () => { generation++; controller?.abort(); loading.value = false; saving.value = false; ready.value = false; journal.value = { groups: [], emotions: [] }; binding.value = { groupId: '', orderId: '' }; error.value = ''; void load() }, { immediate: true })
watch(() => props.disabled, value => { if (!value && !ready.value && !busy.value && !error.value) void load() })
watch(() => props.ordersVersion, () => { refreshPending.value = true })
watch([refreshPending, busy, () => props.disabled], () => { if (refreshPending.value && !busy.value && !props.disabled) void load() })
onBeforeUnmount(() => { generation++; controller?.abort() })
defineExpose({ busy, dirty, needsBeforeUnload })
</script>
<template>
  <ElCard shadow="never" class="legacy-process">
    <template #header><div class="plan-card-heading"><h2>历史计划过程</h2><ElButton :disabled="busy || disabled" @click="load">刷新来源</ElButton></div></template>
    <ElAlert title="这是旧版计划级记录，完整保留。新的调整、情绪和截图请进入具体订单记录；不要按相同编号自动迁移。" type="info" :closable="false"/>
    <ElAlert v-if="error" :title="error" type="error" :closable="false"/>
    <ElSkeleton v-if="loading" :rows="3" animated/>
    <ElForm v-if="groups.length || dirty" label-position="top" :disabled="locked" @submit.prevent.stop="bind">
      <h3>明确绑定历史来源</h3><ElFormItem label="历史组"><ElSelect v-model="binding.groupId" clearable><ElOption v-for="group in groups" :key="group.id" :value="group.id" :label="label(group)"/></ElSelect></ElFormItem>
      <ElFormItem label="当前计划关联订单"><ElSelect v-model="binding.orderId" clearable><ElOption v-for="order in available" :key="order.id" :value="order.id" :label="`${order.ticket} · ${order.symbol}`"/></ElSelect></ElFormItem>
      <ElButton type="primary" native-type="submit" :disabled="locked || !binding.groupId || !binding.orderId" :loading="saving">核对并绑定来源</ElButton>
    </ElForm>
    <ElEmpty v-if="ready && !journal.groups.length && !journal.emotions?.length" description="没有历史计划过程"/>
    <article v-for="group in journal.groups" :key="group.id"><h3>{{ label(group) }}</h3><p>建立于 {{ time(group.createdAt) }} · {{ source(group.sourceSnapshot) }}</p><p v-if="group.orderId">已绑定订单 ID：{{ group.orderId }}<span v-if="group.orderBoundAt"> · {{ time(group.orderBoundAt) }}</span></p>
      <ol><li v-for="entry in group.entries" :key="entry.id"><time>{{ time(entry.recordTime) }}</time><p>参考入场 {{ entry.entryPrice ?? '未填写' }} · 止损 {{ entry.stopLoss ?? '本次未设置' }} · 止盈 {{ entry.takeProfit ?? '本次未设置' }}</p><p>{{ entry.reason || '未填写原因' }}</p><p>当时来源：{{ source(entry.sourceSnapshot) }}</p><p v-if="entry.orderId">当时订单 ID：{{ entry.orderId }}</p></li></ol>
    </article>
    <article v-for="entry in journal.emotions || []" :key="entry.id"><h3>{{ time(entry.recordTime) }} · {{ entry.emotion }}</h3><p>{{ entry.note || '未填写备注' }}</p><p>历史组：{{ entry.groupId || '计划整体' }} · 当时订单：{{ entry.orderId || '未关联' }}</p></article>
  </ElCard>
</template>
<style scoped>.legacy-process{margin-top:20px}.legacy-process .el-form{margin-top:20px}.legacy-process h3{margin:16px 0 12px}.legacy-process article{border-top:1px solid var(--el-border-color-light);margin-top:20px;padding-top:8px}.legacy-process p{white-space:pre-wrap;overflow-wrap:anywhere;font-size:13px;line-height:1.8;color:var(--el-text-color-secondary)}.legacy-process li{margin-bottom:14px}</style>
