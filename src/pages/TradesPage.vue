<script setup lang="ts">
import { computed } from 'vue'
import { ElButton, ElCard, ElForm, ElFormItem, ElInput, ElOption, ElPagination, ElSelect } from 'element-plus'
import { RefreshCw, Search } from 'lucide-vue-next'
import TradeTable from '../components/TradeTable.vue'
import { useWorkspace } from '../composables/useWorkspace'

const { currency, filtered, tableTrades, currentPage, sortProfit, search, symbol, side, result, symbols, money, openTrade, resetFilters } = useWorkspace()
const filteredProfit = computed(() => filtered.value.reduce((sum, trade) => sum + (trade.closeTime ? trade.netProfit : 0), 0))
</script>

<template>
  <ElCard shadow="never" class="records-card">
    <ElForm inline class="trade-filters" @submit.prevent>
      <ElFormItem class="search-field"><ElInput v-model="search" clearable :prefix-icon="Search" placeholder="搜索品种、订单号、复盘…" aria-label="搜索交易" /></ElFormItem>
      <ElFormItem><ElSelect v-model="symbol" aria-label="筛选交易品种"><ElOption label="全部品种" value="all" /><ElOption v-for="item in symbols" :key="item" :label="item" :value="item" /></ElSelect></ElFormItem>
      <ElFormItem><ElSelect v-model="side" aria-label="筛选交易方向"><ElOption label="全部方向" value="all" /><ElOption label="做多" value="buy" /><ElOption label="做空" value="sell" /></ElSelect></ElFormItem>
      <ElFormItem><ElSelect v-model="result" aria-label="筛选盈亏"><ElOption label="全部结果" value="all" /><ElOption label="盈利" value="win" /><ElOption label="亏损" value="loss" /><ElOption label="持平" value="even" /></ElSelect></ElFormItem>
      <ElFormItem><ElButton :icon="RefreshCw" @click="resetFilters">重置筛选</ElButton></ElFormItem>
    </ElForm>
    <div class="records-summary">
      <span>共 <strong>{{ filtered.length }}</strong> 笔交易</span>
      <span>筛选净盈亏 <strong class="numeric" :class="filteredProfit >= 0 ? 'positive' : 'negative'">{{ money(filteredProfit, true) }} {{ currency }}</strong></span>
      <span class="muted">点击交易查看详情与复盘 · 仅已平仓计入盈亏</span>
    </div>
    <TradeTable :trades="tableTrades" :currency="currency" @select="openTrade" @sort="sortProfit = !sortProfit" />
    <div class="records-pagination">
      <span class="muted">显示 {{ filtered.length ? (currentPage - 1) * 10 + 1 : 0 }}–{{ Math.min(currentPage * 10, filtered.length) }} 条，共 {{ filtered.length }} 条</span>
      <ElPagination v-model:current-page="currentPage" :page-size="10" :total="filtered.length" :pager-count="5" layout="prev, pager, next" background aria-label="交易记录分页" />
    </div>
  </ElCard>
</template>

<style scoped>
.trade-filters { display: flex; flex-wrap: wrap; gap: 12px; }
.trade-filters :deep(.el-form-item) { margin: 0; }
.trade-filters :deep(.el-select) { width: 132px; }
.search-field { flex: 1; min-width: 235px; }
.records-summary { display: flex; flex-wrap: wrap; gap: 8px 24px; margin: 20px 0 12px; font-size: 13px; }
.records-pagination { display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 14px; margin-top: 20px; font-size: 13px; }
@media (max-width: 600px) { .search-field { flex-basis: 100%; min-width: 0; } .records-pagination { justify-content: center; } }
</style>
