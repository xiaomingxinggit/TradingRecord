<script setup lang="ts">
import { ArrowDownLeft, ArrowUpRight, ArrowUpDown, FilePenLine } from 'lucide-vue-next'
import type { Trade } from '../types'
defineProps<{trades:Trade[];currency:string;compact?:boolean}>()
defineEmits<{select:[trade:Trade];sort:[]}>()
const value=(n:number)=>`${n>0?'+':''}${n.toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2})}`
function duration(t:Trade){if(!t.closeTime)return '持仓中';const m=Math.max(0,Math.round((new Date(t.closeTime.replace(' ','T')).getTime()-new Date(t.openTime.replace(' ','T')).getTime())/60000));return m<60?`${m} 分钟`:m<1440?`${Math.floor(m/60)} 小时 ${m%60} 分`:`${Math.floor(m/1440)} 天 ${Math.floor(m%1440/60)} 小时`}
</script>
<template>
 <div class="table-scroll"><table class="trade-table"><thead><tr><th>交易品种</th><th>方向</th><th>开仓时间</th><th>交易量</th><th v-if="!compact">开仓 / 平仓价</th><th>持仓时长</th><th class="align-right"><button class="table-sort" @click="$emit('sort')">净盈亏 <ArrowUpDown :size="12"/></button></th><th class="align-center">复盘</th></tr></thead>
 <tbody><tr v-for="trade in trades" :key="trade.id" tabindex="0" @click="$emit('select',trade)" @keydown.enter="$emit('select',trade)"><td><div class="symbol-cell"><div class="asset-icon" :class="trade.symbol.startsWith('XAU')?'gold':''">{{ trade.symbol.startsWith('XAU')?'Au':trade.symbol.slice(0,2) }}</div><div><strong>{{ trade.symbol }}</strong><small>#{{ trade.ticket }}</small></div></div></td><td><span class="direction" :class="trade.side"><ArrowUpRight v-if="trade.side==='buy'" :size="13"/><ArrowDownLeft v-else :size="13"/>{{ trade.side==='buy'?'做多':'做空' }}</span></td><td><div class="date-cell">{{ trade.openTime.slice(0,10) }}<small>{{ trade.openTime.slice(11) }}</small></div></td><td class="numeric">{{ trade.volume.toFixed(2) }} <small>手</small></td><td v-if="!compact" class="price-cell numeric">{{ trade.openPrice }}<small>{{ trade.closePrice ?? '—' }}</small></td><td class="muted">{{ duration(trade) }}</td><td class="align-right"><strong class="pnl numeric" :class="trade.netProfit>=0?'positive':'negative'">{{ value(trade.netProfit) }}</strong><small class="currency-label">{{ currency }}</small></td><td class="align-center"><button class="note-icon" :class="{written:trade.note?.content}" :aria-label="`复盘交易 ${trade.ticket}`" @click.stop="$emit('select',trade)"><FilePenLine :size="16"/><span v-if="trade.note?.content" class="note-dot"/></button></td></tr></tbody></table>
 <div v-if="!trades.length" class="empty-state"><FilePenLine :size="28"/><strong>没有符合条件的交易</strong><p>调整筛选条件，或导入一份 MT5 历史报告。</p></div></div>
</template>
