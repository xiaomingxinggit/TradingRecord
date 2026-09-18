<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { ElAlert, ElButton, ElCard, ElDescriptions, ElDescriptionsItem, ElEmpty, ElInput, ElMessage, ElMessageBox, ElOption, ElSelect, ElSkeleton, ElTabPane, ElTable, ElTableColumn, ElTabs, ElTag } from 'element-plus'
import PlanOrders from './PlanOrders.vue'
import OrderProcess from './OrderProcess.vue'
import OrderReview from './OrderReview.vue'
import { orderDisplay, orderFieldLabels, orderStates, planLabel, type OrderFields, type OrderPlan, type RecordedOrder } from '../orders'
const props = withDefaults(defineProps<{ active?: boolean }>(), { active: true })
const emit = defineEmits<{ openPlan: [planId: string] }>()
const screen = ref<'list' | 'create' | 'detail'>('list'), tab = ref('facts')
const orders = ref<RecordedOrder[]>([]), plans = ref<OrderPlan[]>([]), order = ref<RecordedOrder | null>(null), plan = ref<OrderPlan | null>(null)
const initialPlanId = ref<string | null>(null), bindingPlanId = ref(''), query = ref(''), stateFilter = ref('')
interface Conflict { field: string; label?: string; existing: unknown; incoming: unknown }
const conflicts = ref<Conflict[]>([]), owner = ref('')
const loading = ref(false), saving = ref(false), confirming = ref(false), error = ref(''), factsVersion = ref(0)
const recorder = ref<InstanceType<typeof PlanOrders>>(), process = ref<InstanceType<typeof OrderProcess>>(), review = ref<InstanceType<typeof OrderReview>>()
let generation = 0
let startup: Promise<void> | undefined
const controllers = new Set<AbortController>()
const ownBusy = computed(() => loading.value || saving.value || confirming.value)
const busy = computed(() => ownBusy.value || !!recorder.value?.busy || !!process.value?.busy || !!review.value?.busy)
const dirty = computed(() => !!recorder.value?.dirty || !!process.value?.dirty || !!review.value?.dirty || !!bindingPlanId.value)
const needsBeforeUnload = computed(() => busy.value || dirty.value)
const shown = computed(() => orders.value.filter(item => (!stateFilter.value || item.state === stateFilter.value) && `${item.ticket} ${item.symbol} ${item.planId || '计划外'}`.toLowerCase().includes(query.value.toLowerCase())))
const fieldKeys = Object.keys(orderFieldLabels) as (keyof OrderFields)[]
const compare = computed(() => plan.value && order.value ? [
  { label: '品种', planned: plan.value.symbol, actual: order.value.symbol },
  { label: '方向', planned: orderDisplay(plan.value.side, 'side'), actual: orderDisplay(order.value.side, 'side') },
  { label: '入场价', planned: plan.value.entryPrice, actual: order.value.openPrice },
  { label: '止损', planned: plan.value.stopLoss, actual: order.value.reportedSL },
  { label: '止盈', planned: plan.value.takeProfit, actual: order.value.reportedTP },
] : [])
function utcTime(value: string) { return new Date(value).toLocaleString('zh-CN', { hour12: false }) }
async function request<T>(url: string, method = 'GET', body?: object): Promise<T> {
  const controller = new AbortController(); controllers.add(controller)
  const timeout = window.setTimeout(() => controller.abort(), 30000)
  try {
    const response = await fetch(url, { method, signal: controller.signal, ...(body ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {}) })
    const data = await response.json().catch(() => { throw new Error('服务响应无效，请重试；草稿保留。') })
    if (!response.ok) throw Object.assign(new Error(data.error || '订单操作失败。'), { details: data.details })
    return data as T
  } finally { window.clearTimeout(timeout); controllers.delete(controller) }
}
function clearError() { error.value = ''; conflicts.value = []; owner.value = '' }
function showError(e: unknown) {
  const failure = e as Error & { details?: { conflicts?: Conflict[]; ownerPlanId?: string } }
  error.value = failure.name === 'AbortError' ? '请求超时，结果尚未确认，请重试核对；输入已保留。' : failure.message
  conflicts.value = failure.details?.conflicts || []; owner.value = failure.details?.ownerPlanId || ''
}
async function canLeave() {
  if (busy.value) { ElMessage.warning('订单正在读取、保存或识别，请等待完成。'); return false }
  if (!dirty.value) return true
  confirming.value = true
  try { await ElMessageBox.confirm('有未保存的订单、过程、复盘或关联选择。离开将丢弃这些输入，是否继续？', '未保存内容', { type: 'warning', confirmButtonText: '丢弃并离开', cancelButtonText: '继续编辑', closeOnClickModal: false }); return true }
  catch { return false } finally { confirming.value = false }
}
async function refreshList() {
  if (busy.value) return
  const current = generation; loading.value = true; clearError()
  try {
    const [data, options] = await Promise.all([request<{ orders: RecordedOrder[] }>('/api/orders'), request<{ plans: OrderPlan[] }>('/api/plans')])
    if (current === generation) { orders.value = data.orders; plans.value = options.plans }
  } catch (e) { if (current === generation) showError(e) }
  finally { if (current === generation) loading.value = false }
}
async function showList() {
  if (startup) await startup
  if (screen.value === 'list') return true
  if (!await canLeave()) return false
  generation++; screen.value = 'list'; order.value = null; plan.value = null; bindingPlanId.value = ''; clearError()
  // Child refs are cleared by Vue on the next tick; refresh is explicit below.
  return true
}
async function createForPlan(planId: string | null = null) {
  if (startup) await startup
  if (!await canLeave()) return false
  generation++; initialPlanId.value = planId; order.value = null; plan.value = null; bindingPlanId.value = ''; clearError(); screen.value = 'create'
  return true
}
async function openOrderById(id: string) {
  if (startup) await startup
  if (!await canLeave()) return false
  const current = ++generation; loading.value = true; clearError()
  try {
    const data = await request<{ order: RecordedOrder; plan: OrderPlan | null }>(`/api/orders/${encodeURIComponent(id)}`)
    if (current !== generation) return false
    order.value = data.order; plan.value = data.plan; bindingPlanId.value = ''; tab.value = 'facts'; screen.value = 'detail'; return true
  } catch (e) { if (current === generation) showError(e); return false }
  finally { if (current === generation) loading.value = false }
}
function savedOrder(saved: RecordedOrder) {
  orders.value = [saved, ...orders.value.filter(item => item.id !== saved.id)]
  if (order.value?.id === saved.id) { order.value = saved; factsVersion.value++ }
}
async function bindPlan() {
  if (busy.value || !order.value || order.value.planId || !bindingPlanId.value) return
  confirming.value = true
  try { await ElMessageBox.confirm(`将订单 ${order.value.ticket} 关联到计划 ${bindingPlanId.value}？关联后不提供自动转移。`, '明确关联计划', { type: 'warning', confirmButtonText: '确认关联', cancelButtonText: '取消', closeOnClickModal: false }) }
  catch { return } finally { confirming.value = false }
  const current = generation, id = order.value.id, revision = order.value.revision, planId = bindingPlanId.value
  saving.value = true; clearError()
  try {
    await request(`/api/orders/${encodeURIComponent(id)}/plan`, 'PATCH', { planId, revision })
    const data = await request<{ order: RecordedOrder; plan: OrderPlan | null }>(`/api/orders/${encodeURIComponent(id)}`)
    if (current !== generation) return
    savedOrder(data.order); plan.value = data.plan; bindingPlanId.value = ''; ElMessage.success('计划已关联。')
  } catch (e) { if (current === generation) showError(e) }
  finally { if (current === generation) saving.value = false }
}
function openPlan() { if (!busy.value && order.value?.planId) emit('openPlan', order.value.planId) }
function beforeUnload(event: BeforeUnloadEvent) { if (props.active && needsBeforeUnload.value) { event.preventDefault(); event.returnValue = '' } }
window.addEventListener('beforeunload', beforeUnload)
onMounted(() => { startup = refreshList() })
onBeforeUnmount(() => { generation++; controllers.forEach(controller => controller.abort()); window.removeEventListener('beforeunload', beforeUnload) })
defineExpose({ canLeave, showList, openOrderById, createForPlan, busy, dirty, needsBeforeUnload })
</script>

<template>
  <section class="orders-workspace">
    <div class="heading"><div><h1>交易订单</h1><p>一个订单号，一份生命周期记录。订单可独立于计划存在。</p></div><ElButton v-if="screen !== 'list'" :disabled="busy" @click="showList">返回订单列表</ElButton></div>
    <ElAlert v-if="error" :title="error" type="error" :closable="false" show-icon/>
    <p v-if="owner" class="help">订单实际归属计划：{{ owner }}，本次未转移。</p>
    <ElTable v-if="conflicts.length" :data="conflicts"><ElTableColumn label="冲突字段"><template #default="{ row }">{{ row.label || row.field }}</template></ElTableColumn><ElTableColumn label="已保存"><template #default="{ row }">{{ orderDisplay(row.existing) }}</template></ElTableColumn><ElTableColumn label="本次输入"><template #default="{ row }">{{ orderDisplay(row.incoming) }}</template></ElTableColumn></ElTable>
    <ElSkeleton v-if="loading" :rows="3" animated/>
    <template v-if="screen === 'list'">
      <div class="actions"><ElInput v-model="query" clearable placeholder="搜索订单号、品种或计划" style="width:260px"/><ElSelect v-model="stateFilter" clearable placeholder="全部阶段" style="width:140px"><ElOption v-for="(label, value) in orderStates" :key="value" :label="label" :value="value"/></ElSelect><ElButton type="primary" :disabled="busy" @click="createForPlan(null)">录入订单</ElButton><ElButton :disabled="busy" @click="refreshList">刷新</ElButton></div>
      <p class="help">唯一订单 {{ orders.length }} 笔 · 已平仓 {{ orders.filter(item => item.state === 'closed').length }} 笔。截图盈利不代表净盈亏，不汇总金额。</p>
      <ElTable :data="shown" row-key="id"><ElTableColumn prop="ticket" label="订单号" min-width="145"/><ElTableColumn prop="symbol" label="品种" min-width="95"/><ElTableColumn label="阶段" min-width="100"><template #default="{ row }">{{ orderStates[row.state as keyof typeof orderStates] }}</template></ElTableColumn><ElTableColumn label="方向 / 手数" min-width="150"><template #default="{ row }">{{ orderDisplay(row.side, 'side') }} / {{ orderDisplay(row.state === 'pending' ? row.pendingVolume : row.volume) }}{{ row.state === 'pending' ? '（挂单）' : '' }}</template></ElTableColumn><ElTableColumn label="关联计划" min-width="180"><template #default="{ row }">{{ row.planId || '计划外' }}</template></ElTableColumn><ElTableColumn label="操作" width="90"><template #default="{ row }"><ElButton link type="primary" :disabled="busy" @click="openOrderById(row.id)">查看</ElButton></template></ElTableColumn></ElTable>
      <ElEmpty v-if="!loading && !shown.length" description="暂无符合条件的订单"/>
    </template>
    <PlanOrders v-if="screen === 'create'" :key="`new:${initialPlanId || ''}`" ref="recorder" :plan-id="initialPlanId" :disabled="ownBusy" :active="active" @saved="savedOrder"/>
    <template v-if="screen === 'detail' && order">
      <div class="heading"><h2>{{ order.symbol }} · {{ order.ticket }} <ElTag>{{ orderStates[order.state] }}</ElTag></h2><span class="help">{{ dirty ? '有未保存内容' : '各部分独立保存' }}</span></div>
      <p class="help">{{ order.planId ? `关联计划：${order.planId}` : '计划外订单' }} <ElButton v-if="order.planId" link type="primary" :disabled="busy" @click="openPlan">查看计划</ElButton></p>
      <ElTabs v-model="tab" :before-leave="() => !busy">
        <ElTabPane name="facts" label="订单事实与观察">
          <ElCard shadow="never"><ElDescriptions :column="2" border><ElDescriptionsItem v-for="key in fieldKeys" :key="key" :label="orderFieldLabels[key]">{{ orderDisplay(order[key], key) }}</ElDescriptionsItem><ElDescriptionsItem label="收益比例 / 实际 R">未记录</ElDescriptionsItem></ElDescriptions><p class="help">报告时钟原样记录；截图盈利为报告值，非净盈亏。应用录入于 {{ utcTime(order.createdAt) }}。</p>
            <details><summary>观察历史（{{ order.events?.length || 0 }}）</summary><article v-for="event in order.events" :key="event.id" class="observation"><h4>{{ utcTime(event.recordedAt) }} · {{ event.source === 'screenshot' ? '截图核对' : '手动记录' }}</h4><ElDescriptions :column="2" border><ElDescriptionsItem v-for="key in fieldKeys" :key="key" :label="orderFieldLabels[key]">{{ orderDisplay(event.snapshot?.[key], key) }}</ElDescriptionsItem></ElDescriptions></article></details>
          </ElCard>
          <PlanOrders :key="order.id" ref="recorder" :order="order" :disabled="ownBusy || !!process?.busy || !!review?.busy" :active="active && tab === 'facts'" @saved="savedOrder"/>
        </ElTabPane>
        <ElTabPane name="plan" label="关联计划对比">
          <ElCard shadow="never"><template v-if="plan"><h3>当前计划参数与订单事实</h3><p class="help">计划可能曾修改，此处显示当前参数；价位差异不推算实际 R。</p><ElTable :data="compare"><ElTableColumn prop="label" label="项目"/><ElTableColumn label="计划"><template #default="{ row }">{{ orderDisplay(row.planned) }}</template></ElTableColumn><ElTableColumn label="订单"><template #default="{ row }">{{ orderDisplay(row.actual) }}</template></ElTableColumn></ElTable></template>
            <template v-else-if="!order.planId"><p>此订单尚未关联计划，可独立记录过程和复盘。</p><div class="actions"><ElSelect v-model="bindingPlanId" filterable clearable :disabled="busy" placeholder="明确选择已有计划" style="min-width:300px"><ElOption v-for="item in plans" :key="item.id" :value="item.id" :label="planLabel(item)"/></ElSelect><ElButton :disabled="busy || !bindingPlanId" @click="bindPlan">确认关联</ElButton></div></template><p v-else>关联计划暂不可读取。</p>
          </ElCard>
        </ElTabPane>
        <ElTabPane name="process" label="订单过程"><OrderProcess :key="order.id" ref="process" :order-id="order.id" :disabled="ownBusy || !!recorder?.busy || !!review?.busy" :active="active && tab === 'process'"/></ElTabPane>
        <ElTabPane name="review" label="订单复盘"><OrderReview :key="order.id" ref="review" :order-id="order.id" :facts-version="factsVersion" :disabled="ownBusy || !!recorder?.busy || !!process?.busy" :active="active && tab === 'review'"/></ElTabPane>
      </ElTabs>
    </template>
  </section>
</template>
<style scoped>
.orders-workspace{max-width:1280px;margin:0 auto;padding:24px}.heading,.actions{display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap}.actions{justify-content:flex-start;margin:18px 0}.actions .el-button{margin:0}.heading h1,.heading h2{margin:0}.heading p,.help{color:var(--el-text-color-secondary);line-height:1.8;font-size:13px;overflow-wrap:anywhere}.el-card{margin:16px 0}.observation{margin:18px 0}summary{cursor:pointer;padding:12px 0}@media(max-width:600px){.orders-workspace{padding:12px}.heading{align-items:flex-start}}
</style>
