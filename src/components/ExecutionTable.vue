<script setup lang="ts">
import { computed, ref } from 'vue'
import { ElButton, ElTable, ElTableColumn, ElTag } from 'element-plus'
import type { TableInstance } from 'element-plus'
import { amount, planLabel, purposeLabel, sideLabel, timeLabel, type Position, type QueuePlan } from '../reviews/types'
const props = defineProps<{ positions: Position[]; selectable?: boolean; editable?: boolean; busy?: boolean; plans?: QueuePlan[] }>()
const owners = computed(() => new Map(props.plans?.map(plan => [plan.id, plan]) || []))
function ownerLabel(id: string) {
  const plan = owners.value.get(id)
  return plan ? `${plan.symbol || '未填品种'} · ${timeLabel(plan.createdAt)}` : '查看已关联计划'
}
function ownerTitle(id: string) { const plan = owners.value.get(id); return plan ? planLabel(plan) : id }
const emit = defineEmits<{ selection: [positions: Position[]]; open: [planId: string]; edit: [position: Position]; unlink: [position: Position]; move: [position: Position] }>()
const table = ref<TableInstance>()
defineExpose({ clearSelection: () => table.value?.clearSelection() })
</script>
<template>
  <ElTable ref="table" :data="positions" row-key="id" class="execution-table" empty-text="没有符合条件的持仓" @selection-change="(rows: Position[]) => emit('selection', rows)">
    <ElTableColumn v-if="selectable" type="selection" width="45" :selectable="(row: Position) => !row.link && !busy" :reserve-selection="true"/>
    <ElTableColumn label="持仓 / 方向" min-width="150" fixed="left"><template #default="{ row }"><strong>{{ row.symbol }}</strong><ElTag size="small" :type="row.side === 'buy' ? 'success' : 'danger'" effect="plain">{{ sideLabel(row.side) }}</ElTag><small>#{{ row.ticket }} · {{ row.volume }} 手</small></template></ElTableColumn>
    <ElTableColumn label="来源账户 / 币种" min-width="205"><template #default="{ row }"><span>{{ row.source.accountNumber }} · {{ row.source.currency }}</span><small>{{ row.source.broker }}</small><small>{{ row.source.server }}</small></template></ElTableColumn>
    <ElTableColumn label="开仓 / 平仓（服务器时间）" min-width="200"><template #default="{ row }"><span>{{ row.openTime }}</span><small>{{ row.closeTime || '尚未记录平仓' }}</small></template></ElTableColumn>
    <ElTableColumn label="成交价 / 报告止损止盈" min-width="190"><template #default="{ row }"><span>{{ amount(row.openPrice) }} → {{ amount(row.closePrice) }}</span><small>SL {{ amount(row.reportedStopLoss) }} / TP {{ amount(row.reportedTakeProfit) }}</small></template></ElTableColumn>
    <ElTableColumn label="已实现净额" min-width="185"><template #default="{ row }"><strong :class="row.netProfit === null ? '' : row.netProfit >= 0 ? 'profit-positive' : 'profit-negative'">{{ amount(row.netProfit) }} {{ row.source.currency }}</strong><small>{{ { closed: '完整平仓', open: '未平仓 · 不计入净额', incomplete: '信息不完整 · 不计入净额' }[row.resultState as Position['resultState']] }}</small><small v-if="row.issues.length" class="review-warning">{{ row.issues.join('；') }}</small></template></ElTableColumn>
    <ElTableColumn label="盈利 / 成本" min-width="185"><template #default="{ row }"><span>盈利 {{ amount(row.profit) }}</span><small>佣金 {{ amount(row.commission) }} / 库存费 {{ amount(row.swap) }}</small><small>其他费用 {{ amount(row.fees) }}</small></template></ElTableColumn>
    <ElTableColumn label="用途 / 关联备注" min-width="200"><template #default="{ row }"><template v-if="row.link"><ElTag size="small" type="info">{{ purposeLabel(row.link.purpose) }}</ElTag><small class="preserve-text">{{ row.link.note || '未填写备注' }}</small><ElButton v-if="selectable" link type="primary" :disabled="busy" :title="ownerTitle(row.link.planId)" class="owner-plan-link" @click="emit('open', row.link.planId)">{{ ownerLabel(row.link.planId) }}</ElButton></template><ElTag v-else type="warning" size="small">待关联</ElTag></template></ElTableColumn>
    <ElTableColumn label="导入来源" min-width="200"><template #default="{ row }"><small>{{ row.sourceFile }}</small><small>报告 {{ row.reportDate }}</small><small v-if="row.comment" class="preserve-text">{{ row.comment }}</small></template></ElTableColumn>
    <ElTableColumn v-if="editable" label="关联操作" width="115" fixed="right"><template #default="{ row }"><div class="row-actions"><ElButton link type="primary" :disabled="busy" @click="emit('edit', row as Position)">用途 / 备注</ElButton><ElButton link type="primary" :disabled="busy" @click="emit('move', row as Position)">更换计划</ElButton><ElButton link type="danger" :disabled="busy" @click="emit('unlink', row as Position)">解除关联</ElButton></div></template></ElTableColumn>
  </ElTable>
</template>
<style scoped>
.owner-plan-link{height:auto;white-space:normal;text-align:left;font-size:11px;line-height:1.8;margin-top:5px}
</style>
