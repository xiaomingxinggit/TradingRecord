<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { ElAlert, ElButton, ElCard, ElEmpty, ElMessage, ElMessageBox, ElOption, ElSelect, ElSkeleton, ElTable, ElTableColumn, ElTag } from 'element-plus'
interface Order { id: string; ticket: string; symbol: string; state: string; planId: string | null; revision: number }
const props = defineProps<{ planId: string; disabled?: boolean }>()
const emit = defineEmits<{ open: [id: string]; create: []; updated: [orders: Order[]] }>()
const orders = ref<Order[]>([]), available = ref<Order[]>([]), selected = ref(''), error = ref('')
const loading = ref(false), saving = ref(false), confirming = ref(false), ready = ref(false)
const states: Record<string, string> = { pending: '挂单中', open: '持仓中', closed: '已平仓', cancelled: '取消', expired: '失效' }
const busy = computed(() => loading.value || saving.value || confirming.value), dirty = computed(() => !!selected.value)
const locked = computed(() => !!props.disabled || busy.value || !ready.value)
const counts = computed(() => ({ pending: orders.value.filter(o => o.state === 'pending').length, open: orders.value.filter(o => o.state === 'open').length, closed: orders.value.filter(o => o.state === 'closed').length, ended: orders.value.filter(o => ['cancelled', 'expired'].includes(o.state)).length }))
let generation = 0, controller: AbortController | undefined
async function request<T>(url: string, options?: RequestInit) {
  const active = new AbortController(); controller = active
  const timeout = window.setTimeout(() => active.abort(), 30000)
  try {
    const response = await fetch(url, { ...options, signal: active.signal }); const result = await response.json()
    if (!response.ok) throw new Error(result.error || '订单关联失败。')
    return result as T
  } finally { window.clearTimeout(timeout); if (controller === active) controller = undefined }
}
async function load() {
  if (busy.value || props.disabled) return
  const version = generation; loading.value = true; error.value = ''
  try {
    const data = await request<{ orders: Order[] }>('/api/orders')
    if (version !== generation) return
    orders.value = data.orders.filter(order => order.planId === props.planId); available.value = data.orders.filter(order => !order.planId)
    ready.value = true; emit('updated', orders.value)
  } catch (e) { if (version === generation) error.value = (e as Error).name === 'AbortError' ? '读取超时，请重试。' : (e as Error).message }
  finally { if (version === generation) loading.value = false }
}
async function link() {
  if (locked.value || !selected.value) return
  const order = available.value.find(item => item.id === selected.value)
  if (!order) { error.value = '所选订单已不在未关联列表，请刷新核对。'; return }
  confirming.value = true
  try { await ElMessageBox.confirm(`将订单 ${order.ticket}（${order.symbol}）关联到当前计划？订单事实与历史保留，不自动更改计划状态。`, '确认关联计划', { confirmButtonText: '确认关联', cancelButtonText: '返回核对', closeOnClickModal: false }) }
  catch { return } finally { confirming.value = false }
  const version = generation; saving.value = true; error.value = ''
  try {
    await request(`/api/orders/${encodeURIComponent(order.id)}/plan`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ planId: props.planId, revision: order.revision }) })
    if (version !== generation) return
    selected.value = ''; ElMessage.success('订单已关联到此计划。')
  } catch (e) { if (version === generation) error.value = (e as Error).name === 'AbortError' ? '关联结果待确认，请刷新列表核对后重试。' : (e as Error).message }
  finally { if (version === generation) saving.value = false }
  if (version === generation && !error.value) await load()
}
watch(() => props.planId, () => { generation++; controller?.abort(); loading.value = false; saving.value = false; ready.value = false; selected.value = ''; orders.value = []; available.value = []; error.value = ''; void load() }, { immediate: true })
watch(() => props.disabled, value => { if (!value && !ready.value && !busy.value && !error.value) void load() })
onBeforeUnmount(() => { generation++; controller?.abort() })
defineExpose({ busy, dirty })
</script>

<template>
  <ElCard shadow="never">
    <template #header><div class="plan-card-heading"><h2>关联订单</h2><ElButton type="primary" :disabled="locked" @click="emit('create')">为此计划记录订单</ElButton></div></template>
    <p class="link-help">写下计划不代表已经下单。以下进度来自实际关联订单，关闭计划不会取消订单或抹去成交。</p>
    <div class="link-counts"><ElTag>挂单 {{ counts.pending }}</ElTag><ElTag>持仓 {{ counts.open }}</ElTag><ElTag type="success">平仓 {{ counts.closed }}</ElTag><ElTag type="info">取消 / 失效 {{ counts.ended }}</ElTag></div>
    <ElAlert v-if="error" :title="error" type="error" :closable="false"/>
    <ElSkeleton v-if="loading" :rows="3" animated/>
    <ElTable v-else-if="orders.length" :data="orders" row-key="id"><ElTableColumn prop="ticket" label="订单号" min-width="150"/><ElTableColumn prop="symbol" label="品种"/><ElTableColumn label="阶段"><template #default="{ row }">{{ states[row.state] || row.state }}</template></ElTableColumn><ElTableColumn width="100"><template #default="{ row }"><ElButton link type="primary" :disabled="busy || disabled" @click="emit('open', row.id)">查看订单</ElButton></template></ElTableColumn></ElTable>
    <ElEmpty v-else description="此计划暂未关联订单"/>
    <div class="link-form"><ElSelect v-model="selected" :disabled="locked" filterable clearable placeholder="选择尚未关联计划的订单" aria-label="关联已有订单"><ElOption v-for="order in available" :key="order.id" :value="order.id" :label="`${order.ticket} · ${order.symbol} · ${states[order.state]}`"/></ElSelect><ElButton :disabled="locked || !selected" :loading="saving" @click="link">确认关联</ElButton><ElButton :disabled="busy || disabled" @click="load">刷新订单</ElButton></div>
    <p class="link-help">同一订单最多关联一个计划。已有归属的订单不会出现在待关联列表中；计划外订单可在“交易订单”独立记录。</p>
  </ElCard>
</template>
<style scoped>.link-help{color:var(--el-text-color-secondary);font-size:13px;line-height:1.8;margin:12px 0}.link-counts,.link-form{display:flex;gap:12px;flex-wrap:wrap;margin:18px 0}.link-form .el-select{flex:1;min-width:210px}.link-form .el-button{margin:0}</style>
