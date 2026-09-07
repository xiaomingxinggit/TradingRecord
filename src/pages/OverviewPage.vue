<script setup lang="ts">
import { computed } from 'vue'
import {
  ElButton, ElCard, ElCol, ElDescriptions, ElDescriptionsItem, ElEmpty,
  ElProgress, ElRow, ElStatistic, ElTag,
} from 'element-plus'
import EquityChart from '../components/EquityChart.vue'
import TradeTable from '../components/TradeTable.vue'
import { useWorkspace } from '../composables/useWorkspace'

const {
  stats, currency, accountTrades, reviewed, scopedTrades, recent, dateLabel,
  sortProfit, money, openTrade, go,
} = useWorkspace()
const evenCount = computed(() => stats.value.closed.length - stats.value.wins.length - stats.value.losses.length)
const reviewProgress = computed(() => accountTrades.value.length ? reviewed.value / accountTrades.value.length * 100 : 0)
const holdLabel = computed(() => stats.value.averageHold < 60
  ? `${Math.round(stats.value.averageHold)} 分钟`
  : `${(stats.value.averageHold / 60).toFixed(1)} 小时`)
const profitColor = (value: number) => ({ color: value >= 0 ? 'var(--el-color-success)' : 'var(--el-color-danger)' })
const signedMoney = (value: number) => money(value, true)
</script>

<template>
  <div class="page-stack">
    <ElRow :gutter="20" class="overview-row">
      <ElCol :xs="24" :sm="12" :lg="6">
        <ElCard class="metric-card" shadow="never">
          <ElStatistic title="净盈亏" :value="stats.net" :formatter="signedMoney" :value-style="profitColor(stats.net)">
            <template #suffix><span class="metric-unit">{{ currency }}</span></template>
          </ElStatistic>
          <template #footer><span class="muted">已实现盈亏 · 已扣除交易费用</span></template>
        </ElCard>
      </ElCol>
      <ElCol :xs="24" :sm="12" :lg="6">
        <ElCard class="metric-card" shadow="never">
          <ElStatistic title="交易胜率" :value="stats.winRate" :precision="2" suffix="%" />
          <template #footer><span class="muted">{{ stats.wins.length }} 笔盈利 / {{ stats.closed.length }} 笔已平仓</span></template>
        </ElCard>
      </ElCol>
      <ElCol :xs="24" :sm="12" :lg="6">
        <ElCard class="metric-card" shadow="never">
          <ElStatistic title="盈利因子" :value="stats.profitFactor" :formatter="() => stats.profitFactor === Infinity ? '∞' : stats.profitFactor.toFixed(2)" />
          <template #footer><span class="muted">盈利总额 / 亏损总额绝对值</span></template>
        </ElCard>
      </ElCol>
      <ElCol :xs="24" :sm="12" :lg="6">
        <ElCard class="metric-card" shadow="never">
          <ElStatistic title="交易笔数" :value="stats.closed.length" suffix="笔" />
          <template #footer><span class="muted">活跃交易日 {{ stats.days.length }} 天</span></template>
        </ElCard>
      </ElCol>
    </ElRow>

    <ElRow :gutter="20" class="overview-row">
      <ElCol :xs="24" :lg="16">
        <ElCard class="chart-card" shadow="never">
          <template #header>
            <div class="section-heading"><h2>累计净盈亏</h2><ElTag type="primary" effect="plain">{{ currency }}</ElTag></div>
          </template>
          <div class="chart-summary">
            <ElStatistic :value="stats.net" :formatter="signedMoney" :value-style="profitColor(stats.net)" />
            <span class="muted">{{ dateLabel }}</span>
          </div>
          <EquityChart v-if="stats.closed.length" :points="stats.curve" :currency="currency" />
          <ElEmpty v-else description="导入交易后查看收益曲线" :image-size="100" />
          <template #footer>
            <div class="chart-footnote">
              <span class="muted">按平仓顺序累计 · 不含出入金</span>
              <span>最大回撤 <strong class="negative numeric">{{ money(stats.drawdown) }}</strong> {{ currency }}</span>
            </div>
          </template>
        </ElCard>
      </ElCol>
      <ElCol :xs="24" :lg="8">
        <ElCard class="chart-card" shadow="never">
          <template #header><div class="section-heading"><h2>盈亏分布</h2><ElTag type="info" effect="plain">{{ stats.closed.length }} 笔已平仓</ElTag></div></template>
          <div class="win-rate">
            <ElProgress type="circle" :percentage="stats.winRate" :width="150" :stroke-width="12" color="var(--el-color-success)">
              <span class="muted">胜率</span>
              <strong class="numeric">{{ stats.winRate.toFixed(1) }}%</strong>
            </ElProgress>
          </div>
          <ElDescriptions :column="1" border>
            <ElDescriptionsItem label="盈利交易"><div class="distribution-value"><span>{{ stats.wins.length }} 笔</span><strong class="positive numeric">{{ money(stats.grossWin, true) }}</strong></div></ElDescriptionsItem>
            <ElDescriptionsItem label="亏损交易"><div class="distribution-value"><span>{{ stats.losses.length }} 笔</span><strong class="negative numeric">{{ money(-stats.grossLoss) }}</strong></div></ElDescriptionsItem>
            <ElDescriptionsItem label="持平交易"><div class="distribution-value"><span>{{ evenCount }} 笔</span><strong class="numeric">0.00</strong></div></ElDescriptionsItem>
          </ElDescriptions>
        </ElCard>
      </ElCol>
    </ElRow>

    <ElCard shadow="never">
      <template #header><div class="section-heading"><h2>交易表现与复盘</h2><ElButton type="primary" link @click="go('journal')">去交易复盘</ElButton></div></template>
      <ElDescriptions :column="2" direction="vertical" border>
        <ElDescriptionsItem label="平均每笔盈亏"><strong class="numeric" :class="stats.average >= 0 ? 'positive' : 'negative'">{{ money(stats.average, true) }} {{ currency }}</strong></ElDescriptionsItem>
        <ElDescriptionsItem label="最佳单笔"><strong class="numeric" :class="stats.best >= 0 ? 'positive' : 'negative'">{{ money(stats.best, true) }} {{ currency }}</strong></ElDescriptionsItem>
        <ElDescriptionsItem label="平均持仓时长"><strong>{{ holdLabel }}</strong></ElDescriptionsItem>
        <ElDescriptionsItem label="账户复盘进度">
          <div class="review-progress"><span>{{ reviewed }} / {{ accountTrades.length }} 笔</span><ElProgress :percentage="reviewProgress" :show-text="false" /></div>
        </ElDescriptionsItem>
      </ElDescriptions>
    </ElCard>

    <ElCard shadow="never">
      <template #header>
        <div class="section-heading"><h2>最近交易 <ElTag type="info" effect="plain">{{ scopedTrades.length }} 笔</ElTag></h2><ElButton type="primary" link @click="go('trades')">查看全部</ElButton></div>
      </template>
      <TradeTable :trades="recent" :currency="currency" compact @select="openTrade" @sort="sortProfit = !sortProfit" />
    </ElCard>
    <div class="source-note muted"><span>数据源自 MT5 导出报告</span><span>时间按经纪商报表原值显示</span></div>
  </div>
</template>

<style scoped>
.overview-row { row-gap: 20px; }
.metric-card, .chart-card { height: 100%; }
.metric-card { --el-statistic-content-font-size: 28px; }
.metric-unit { font-size: 13px; color: var(--el-text-color-secondary); }
.chart-summary, .chart-footnote, .source-note { display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 12px; }
.chart-footnote, .source-note { font-size: 13px; }
.win-rate { display: flex; justify-content: center; margin: 4px 0 22px; }
.win-rate strong { display: block; margin-top: 10px; font-size: 24px; color: var(--el-text-color-primary); }
.win-rate .muted { font-size: 13px; }
.distribution-value { display: flex; justify-content: space-between; flex-wrap: wrap; gap: 8px; }
.review-progress { display: grid; gap: 8px; min-width: 90px; }
</style>
