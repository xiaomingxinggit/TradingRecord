<script setup lang="ts">
import { onBeforeUnmount, ref, watch } from 'vue'
import { ElAlert, ElCard, ElEmpty, ElSkeleton, ElTag, ElTimeline, ElTimelineItem } from 'element-plus'
import { orderStatusLabels, type OrderStatus } from '../orders'

type EventType = 'order_created' | 'order_status_changed' | 'order_fields_changed'
type EventField = 'status' | 'volume' | 'reportedSL' | 'reportedTP'
interface EventChange { field: EventField; from: number | string | null; to: number | string | null }
interface PlanEvent { id: string; planId: string; orderId: string | null; type: EventType; detail: { ticket?: string; changes?: EventChange[] }; createdAt: string }
const props = defineProps<{ planId: string }>()
const events = ref<PlanEvent[]>([]), loading = ref(false), error = ref('')
let generation = 0, controller: AbortController | undefined
const typeLabels: Record<EventType, string> = {
  order_created: '创建并关联订单', order_status_changed: '订单状态变更', order_fields_changed: '订单字段更新',
}
const fieldLabels: Record<EventField, string> = { status: '订单状态', volume: '手数', reportedSL: '止损', reportedTP: '止盈' }

async function json<T>(response: Response): Promise<T> {
  const result = await response.json().catch(() => ({ error: '服务返回无效响应。' }))
  if (!response.ok) throw new Error(result.error || '读取计划事件失败。')
  return result as T
}
function timestamp(value: string) { return new Date(value).toLocaleString('zh-CN', { hour12: false }) }
function display(field: EventField, value: unknown) {
  if (value === null || value === undefined || value === '') return '未记录'
  if (field === 'status') return orderStatusLabels[value as OrderStatus] || String(value)
  return String(value)
}
function visibleChanges(event: PlanEvent) {
  return (event.detail.changes || []).filter(change => Object.hasOwn(fieldLabels, change.field))
}
async function load() {
  generation++; const version = generation
  controller?.abort(); controller = new AbortController(); loading.value = true; error.value = ''
  try {
    const result = await json<{ events: PlanEvent[] }>(await fetch(`/api/plans/${encodeURIComponent(props.planId)}/events`, { signal: controller.signal }))
    if (version === generation) events.value = result.events
  } catch (problem) {
    if (version === generation && (problem as Error).name !== 'AbortError') error.value = (problem as Error).message
  } finally { if (version === generation) { loading.value = false; controller = undefined } }
}

watch(() => props.planId, () => { events.value = []; void load() }, { immediate: true })
onBeforeUnmount(() => { generation++; controller?.abort() })
</script>

<template>
  <ElCard shadow="never" class="plan-events-card">
    <template #header><div class="plan-card-heading"><div><h2>计划事件</h2><span>仅记录关联订单的实际变化</span></div></div></template>
    <ElAlert v-if="error" :title="error" type="error" show-icon :closable="false" class="event-error"/>
    <ElSkeleton v-if="loading" :rows="4" animated/>
    <ElTimeline v-else-if="events.length" class="plan-event-timeline">
      <ElTimelineItem v-for="event in events" :key="event.id" :timestamp="timestamp(event.createdAt)" placement="top">
        <div class="event-heading"><strong>{{ typeLabels[event.type] || '订单事件' }}</strong><ElTag size="small" effect="plain">订单 {{ event.detail.ticket || '未记录' }}</ElTag></div>
        <div v-if="visibleChanges(event).length" class="event-changes">
          <div v-for="change in visibleChanges(event)" :key="change.field"><span>{{ fieldLabels[change.field] }}</span><b>{{ display(change.field, change.from) }}</b><i>→</i><b>{{ display(change.field, change.to) }}</b></div>
        </div>
        <p v-else class="event-created">订单已创建并关联到当前计划。</p>
      </ElTimelineItem>
    </ElTimeline>
    <ElEmpty v-else description="还没有计划事件"/>
  </ElCard>
</template>

<style scoped>
.event-error{margin-bottom:18px}.plan-event-timeline{padding:12px 8px 0}.event-heading{display:flex;align-items:center;gap:12px;flex-wrap:wrap}.event-heading strong{font-size:14px;color:var(--el-text-color-primary)}.event-changes{display:grid;gap:8px;margin-top:12px}.event-changes>div{display:grid;grid-template-columns:80px minmax(70px,1fr) 20px minmax(70px,1fr);gap:8px;align-items:center;font-size:12px;padding:9px 12px;background:var(--el-fill-color-light);border-radius:7px}.event-changes span{color:var(--el-text-color-secondary)}.event-changes b{font-weight:550;overflow-wrap:anywhere}.event-changes i{font-style:normal;color:var(--el-text-color-placeholder);text-align:center}.event-created{font-size:12px;color:var(--el-text-color-secondary);margin:10px 0 0}@media(max-width:560px){.event-changes>div{grid-template-columns:70px 1fr 16px 1fr;padding:8px}}
</style>
