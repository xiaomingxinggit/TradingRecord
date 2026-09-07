<script setup lang="ts">
import { ElButton, ElEmpty, ElTable, ElTableColumn, ElTag } from 'element-plus'
import { ArrowUpDown, FilePenLine } from 'lucide-vue-next'
import type { Trade } from '../types'

defineProps<{ trades: Trade[]; currency: string; compact?: boolean }>()
const emit = defineEmits<{ select: [trade: Trade]; sort: [] }>()

const value = (n: number) => `${n > 0 ? '+' : ''}${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
function duration(trade: Trade) {
  if (!trade.closeTime) return '持仓中'
  const minutes = Math.max(0, Math.round((new Date(trade.closeTime.replace(' ', 'T')).getTime() - new Date(trade.openTime.replace(' ', 'T')).getTime()) / 60000))
  if (!Number.isFinite(minutes)) return '—'
  return minutes < 60 ? `${minutes} 分钟` : minutes < 1440 ? `${Math.floor(minutes / 60)} 小时 ${minutes % 60} 分` : `${Math.floor(minutes / 1440)} 天 ${Math.floor(minutes % 1440 / 60)} 小时`
}
</script>

<template>
  <ElTable :data="trades" row-key="id" class="trade-table" @row-click="emit('select', $event)">
    <ElTableColumn label="交易品种" min-width="140">
      <template #default="{ row }">
        <ElButton link type="primary" :aria-label="`查看 ${row.symbol} 交易 ${row.ticket}`" @click.stop="emit('select', row as Trade)">{{ row.symbol }}</ElButton>
        <div class="cell-secondary">#{{ row.ticket }}</div>
      </template>
    </ElTableColumn>
    <ElTableColumn label="方向" width="86">
      <template #default="{ row }"><ElTag :type="row.side === 'buy' ? 'success' : 'danger'" effect="light">{{ row.side === 'buy' ? '做多' : '做空' }}</ElTag></template>
    </ElTableColumn>
    <ElTableColumn label="开仓时间" min-width="138">
      <template #default="{ row }"><span>{{ row.openTime.slice(0, 10) }}</span><div class="cell-secondary">{{ row.openTime.slice(11) }}</div></template>
    </ElTableColumn>
    <ElTableColumn label="交易量" min-width="95" align="right">
      <template #default="{ row }"><span class="numeric">{{ row.volume.toFixed(2) }}</span> <span class="muted">手</span></template>
    </ElTableColumn>
    <ElTableColumn v-if="!compact" label="开仓 / 平仓价" min-width="140" align="right">
      <template #default="{ row }"><span class="numeric">{{ row.openPrice }}</span><div class="cell-secondary numeric">{{ row.closePrice ?? '—' }}</div></template>
    </ElTableColumn>
    <ElTableColumn label="持仓时长" min-width="130">
      <template #default="{ row }"><span class="muted">{{ duration(row as Trade) }}</span></template>
    </ElTableColumn>
    <ElTableColumn min-width="142" align="right">
      <template #header><ElButton link aria-label="切换净盈亏排序" @click="emit('sort')">净盈亏 <ArrowUpDown :size="13" /></ElButton></template>
      <template #default="{ row }">
        <template v-if="row.closeTime"><strong class="numeric" :class="row.netProfit >= 0 ? 'positive' : 'negative'">{{ value(row.netProfit) }}</strong><div class="cell-secondary">{{ currency }}</div></template>
        <template v-else><span class="muted">—</span><div class="cell-secondary">未平仓</div></template>
      </template>
    </ElTableColumn>
    <ElTableColumn label="复盘" width="102" align="center">
      <template #default="{ row }"><ElButton link :type="row.note?.content?.trim() ? 'success' : 'primary'" :aria-label="`复盘交易 ${row.ticket}`" @click.stop="emit('select', row as Trade)"><FilePenLine :size="15" /><span>{{ row.note?.content?.trim() ? '已复盘' : '记录' }}</span></ElButton></template>
    </ElTableColumn>
    <template #empty><ElEmpty description="没有符合条件的交易，请调整筛选或导入 MT5 报告。" :image-size="76" /></template>
  </ElTable>
</template>

<style scoped>
.trade-table :deep(.el-table__row) { cursor: pointer; }
.trade-table :deep(.el-button > span) { gap: 5px; }
.cell-secondary { color: var(--el-text-color-secondary); font-size: 12px; line-height: 1.6; }
</style>
