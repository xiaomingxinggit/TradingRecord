<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { ElAlert, ElButton, ElDialog, ElEmpty, ElForm, ElFormItem, ElInput, ElOption, ElSelect, ElTable, ElTableColumn } from 'element-plus'
import { jsonBody, request } from '../reviews/api'
import { planLabel, purposes, sideLabel, type Position, type Purpose, type QueuePlan } from '../reviews/types'
const visible = defineModel<boolean>({ default: false })
const props = defineProps<{ positions: Position[]; plans: QueuePlan[]; fromPlanId?: string }>()
const emit = defineEmits<{ saved: [planId: string]; busy: [busy: boolean] }>()
const planId = ref(''), busy = ref(false), error = ref('')
const links = ref<{ positionId: string; purpose: Purpose; note: string }[]>([])
const choices = computed(() => props.plans.filter(p => p.id !== props.fromPlanId))
const chosen = computed(() => choices.value.find(p => p.id === planId.value))
watch(visible, value => { if (value) { planId.value = ''; error.value = ''; links.value = props.positions.map(p => ({ positionId: p.id, purpose: p.link?.purpose || 'unclassified', note: p.link?.note || '' })) } })
function close(done?: () => void) { if (!busy.value) { if (done) done(); else visible.value = false } }
async function save() {
  if (!planId.value || busy.value) return
  busy.value = true; emit('busy', true); error.value = ''
  try {
    const result = props.fromPlanId
      ? await request<{ planId: string }>('/api/reviews/links/move', jsonBody('POST', { ...links.value[0], fromPlanId: props.fromPlanId, toPlanId: planId.value }))
      : await request<{ planId: string }>('/api/reviews/links', jsonBody('POST', { planId: planId.value, links: links.value }))
    visible.value = false; emit('saved', result.planId)
  } catch (e) { error.value = (e as Error).message }
  finally { busy.value = false; emit('busy', false) }
}
</script>
<template>
  <ElDialog v-model="visible" :title="fromPlanId ? '更换关联计划' : `关联 ${positions.length} 个持仓`" width="min(860px, calc(100vw - 32px))" :before-close="close" :close-on-click-modal="false" :close-on-press-escape="!busy" :show-close="!busy">
    <ElAlert v-if="error" :title="error" type="error" :closable="false" show-icon/>
    <ElAlert :title="fromPlanId ? '确认后将从原计划解除，关联到下方所选计划；两份计划的复盘状态会随关联变化更新。' : '请根据原计划手动确认关联。首次入场、加仓和重新入场不会自动推断。'" type="info" show-icon :closable="false"/>
    <ElEmpty v-if="!choices.length" description="没有可选计划，请先保存一份开仓计划。"/>
    <ElForm v-else label-position="top" class="review-link-form">
      <ElFormItem label="关联到哪份开仓计划" required><ElSelect v-model="planId" filterable placeholder="搜索创建时间、品种、方向或入场理由" :disabled="busy" class="full-width"><ElOption v-for="plan in choices" :key="plan.id" :value="plan.id" :label="planLabel(plan)"/></ElSelect></ElFormItem>
      <div v-if="chosen" class="chosen-plan"><strong>{{ chosen.symbol || '未填品种' }} · {{ sideLabel(chosen.side) }}</strong><small>{{ planLabel(chosen).split(' · ')[0] }}</small><p class="preserve-text">{{ chosen.reason || '未填写入场理由' }}</p></div>
      <ElTable :data="links" max-height="360"><ElTableColumn label="持仓" min-width="220"><template #default="{ $index }">{{ positions[$index]?.symbol }} · #{{ positions[$index]?.ticket }}<small>{{ sideLabel(positions[$index]?.side || '') }} · {{ positions[$index]?.volume }} 手 · {{ positions[$index]?.openTime }}</small><small>{{ positions[$index]?.source.accountNumber }} · {{ positions[$index]?.source.currency }} · {{ positions[$index]?.source.server }}</small></template></ElTableColumn><ElTableColumn label="用途" width="150"><template #default="{ row }"><ElSelect v-model="row.purpose" :disabled="busy"><ElOption v-for="p in purposes" :key="p.value" :value="p.value" :label="p.label"/></ElSelect></template></ElTableColumn><ElTableColumn label="备注（选填）" min-width="220"><template #default="{ row }"><ElInput v-model="row.note" :disabled="busy" maxlength="300" placeholder="如：突破后第二次入场"/></template></ElTableColumn></ElTable>
    </ElForm>
    <template #footer><ElButton :disabled="busy" @click="close()">取消</ElButton><ElButton type="primary" :loading="busy" :disabled="!planId || !positions.length" @click="save">{{ fromPlanId ? '确认更换' : '确认关联并复盘' }}</ElButton></template>
  </ElDialog>
</template>
