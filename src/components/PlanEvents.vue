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
      <ElTimelineItem v-for="event in events" :key="event.id" :timestamp="timestamp(event.createdAt)" placement="top"
        :type="event.type === 'order_created' ? 'success' : event.type === 'order_status_changed' ? 'warning' : 'primary'" hollow>
        <div class="event-card">
          <div class="event-heading"><ElTag size="small" effect="light" :type="event.type === 'order_created' ? 'success' : event.type === 'order_status_changed' ? 'warning' : 'primary'">{{ typeLabels[event.type] || '订单事件' }}</ElTag><span class="event-ticket">订单 {{ event.detail.ticket || '未记录' }}</span></div>
          <div v-if="visibleChanges(event).length" class="event-changes">
            <div v-for="change in visibleChanges(event)" :key="change.field"><span class="event-field">{{ fieldLabels[change.field] }}</span><div class="event-value-flow"><b>{{ display(change.field, change.from) }}</b><i>→</i><b>{{ display(change.field, change.to) }}</b></div></div>
          </div>
          <p v-else class="event-created">订单已创建并关联到当前计划。</p>
        </div>
      </ElTimelineItem>
    </ElTimeline>
    <ElEmpty v-else description="还没有计划事件"/>
  </ElCard>
</template>

<style scoped>
.event-error{margin-bottom:18px}.plan-events-card :deep(.el-empty){padding-block:28px}.plan-events-card :deep(.el-skeleton){padding:4px 2px}.plan-event-timeline{padding:10px 4px 0 8px}.plan-event-timeline :deep(.el-timeline-item){padding-bottom:18px}.plan-event-timeline :deep(.el-timeline-item__timestamp){margin-bottom:7px;color:var(--el-text-color-secondary);font:500 11px/1.5 'Manrope Variable',sans-serif}.event-card{padding:14px 16px;border:1px solid var(--el-border-color-lighter);border-radius:10px;background:color-mix(in srgb,var(--el-fill-color-extra-light) 55%,transparent)}.event-heading{display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap}.event-ticket{font:600 12px/1.4 'Manrope Variable',sans-serif;color:var(--el-text-color-regular)}.event-changes{display:grid;gap:8px;margin-top:12px}.event-changes>div{display:grid;grid-template-columns:88px minmax(0,1fr);gap:10px;align-items:center;font-size:12px;padding:10px 12px;background:var(--el-bg-color);border:1px solid var(--el-border-color-extra-light);border-radius:8px}.event-field{color:var(--el-text-color-secondary)}.event-value-flow{display:grid;grid-template-columns:minmax(70px,1fr) 22px minmax(70px,1fr);gap:8px;align-items:center}.event-value-flow b{padding:5px 8px;font-weight:600;overflow-wrap:anywhere;border-radius:6px;background:var(--el-fill-color-extra-light)}.event-value-flow b:last-child{color:var(--el-color-primary);background:var(--el-color-primary-light-9)}.event-value-flow i{font-style:normal;color:var(--el-text-color-placeholder);text-align:center}.event-created{font-size:12px;color:var(--el-text-color-secondary);margin:12px 0 0;line-height:1.7}@media(max-width:560px){.plan-event-timeline{padding-left:2px}.event-card{padding:12px}.event-changes>div{grid-template-columns:1fr;gap:7px;padding:10px}.event-value-flow{grid-template-columns:minmax(0,1fr) 18px minmax(0,1fr)}}
</style>
