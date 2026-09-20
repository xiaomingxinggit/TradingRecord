<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { ElAlert, ElButton, ElCard, ElEmpty, ElSkeleton, ElTag } from 'element-plus'
import { ArrowRight, BookOpenCheck, ClipboardPenLine, Files, RefreshCw, ShieldCheck } from 'lucide-vue-next'
import { planStatusOptions, planStatuses, type PlanStatus } from '../plan-status'
import { orderStatusLabels, type OrderStatus } from '../orders'

interface Overview {
  generatedAt: string
  totals: { plans: number; orders: number; closedOrders: number; lockedOrders: number; reviews: number; events: number }
  plansByStatus: { status: string; count: number }[]
  ordersByStatus: { status: string; count: number }[]
  topSymbols: { symbol: string; count: number }[]
  distinctSymbols: number
  plansWithoutSymbol: number
  recentPlans: { id: string; symbol: string; status: string; createdAt: string; activityAt: string }[]
}
defineProps<{ navigating: boolean }>()
const emit = defineEmits<{ plans: []; openPlan: [id: string] }>()
const data = ref<Overview | null>(null)
const loading = ref(false)
const error = ref('')
let controller: AbortController | undefined
const number = (value: number) => value.toLocaleString('zh-CN')
const share = (value: number, total: number) => total > 0 ? Math.min(100, Math.max(0, value / total * 100)) : 0
const percentage = (value: number, total: number) => total > 0 ? `${share(value, total).toFixed(1)}%` : '—'
function dateTime(value: string) {
  const date = new Date(value)
  return Number.isFinite(date.getTime()) ? date.toLocaleString('zh-CN', { hour12: false }) : '—'
}
const planInfo = (status: string) => planStatuses[status as PlanStatus] ?? { label: '未知状态', tagType: 'info' as const }
const planDistribution = computed(() => {
  const counts = data.value?.plansByStatus ?? []
  const rows = planStatusOptions.map(info => ({ label: info.label, color: `var(--el-color-${info.tagType})`, count: counts.find(row => row.status === info.value)?.count ?? 0 }))
  const unknown = counts.filter(row => !planStatusOptions.some(info => info.value === row.status)).reduce((sum, row) => sum + row.count, 0)
  return unknown ? [...rows, { label: '未知状态', color: 'var(--el-color-info)', count: unknown }] : rows
})
const orderDistribution = computed(() => (['pending', 'open', 'closed'] as OrderStatus[]).map((status, index) => ({
  label: orderStatusLabels[status], count: data.value?.ordersByStatus.find(row => row.status === status)?.count ?? 0,
  color: ['var(--el-color-warning)', 'var(--el-color-primary)', 'var(--el-color-success)'][index],
})))
const pendingReviews = computed(() => Math.max(0, (data.value?.totals.plans ?? 0) - (data.value?.totals.reviews ?? 0)))
const cards = computed(() => data.value ? [
  { label: '交易计划', value: data.value.totals.plans, icon: ClipboardPenLine, detail: '全部已保存计划', tone: 'primary' },
  { label: '关联订单', value: data.value.totals.orders, icon: Files, detail: '已关联到计划的独立订单', tone: 'primary' },
  { label: '已平仓订单', value: data.value.totals.closedOrders, icon: ShieldCheck, detail: `${number(data.value.totals.lockedOrders)} 笔已锁定`, tone: 'success' },
  { label: '已完成复盘', value: data.value.totals.reviews, icon: BookOpenCheck, detail: data.value.totals.plans ? `覆盖 ${percentage(data.value.totals.reviews, data.value.totals.plans)} 的计划` : '保存计划后计算复盘覆盖率', tone: 'primary' },
] : [])

async function loadOverview() {
  if (loading.value) return
  loading.value = true
  error.value = ''
  controller = new AbortController()
  try {
    const response = await fetch('/api/overview', { signal: controller.signal })
    const result = await response.json().catch(() => { throw new Error('服务返回了无效响应，请重启后端后重试。') })
    if (!response.ok) throw new Error(result.error || '暂时无法读取数据概览。')
    if (!result?.totals || !Array.isArray(result.recentPlans)) throw new Error('数据概览响应不完整，请重启后端后重试。')
    data.value = result as Overview
  } catch (cause) {
    if (!controller.signal.aborted) error.value = cause instanceof Error ? cause.message : '暂时无法读取数据概览。'
  } finally { loading.value = false }
}
onMounted(() => { void loadOverview() })
onBeforeUnmount(() => controller?.abort())
</script>

<template>
  <section class="overview-page" :aria-busy="loading" aria-labelledby="overview-title">
    <header class="overview-header">
      <div><p class="overview-eyebrow">WORKSPACE OVERVIEW</p><h1 id="overview-title">数据概览</h1><p class="overview-subtitle">汇总本机已保存记录，回看从交易计划到复盘的每一步。</p></div>
      <ElButton :loading="loading" :disabled="loading" @click="loadOverview"><RefreshCw v-if="!loading" :size="16"/>刷新数据</ElButton>
    </header>

    <ElAlert v-if="error" :title="error" :description="data ? '以下保留上次读取的数据，可点击刷新重试。' : undefined" type="error" show-icon :closable="false"/>
    <ElSkeleton v-if="loading && !data" :rows="12" animated class="overview-loading"/>
    <ElEmpty v-else-if="!data" description="数据概览暂时不可用"><ElButton type="primary" :loading="loading" @click="loadOverview">重新加载</ElButton></ElEmpty>
    <template v-if="data">
      <div class="overview-scope"><ElTag effect="plain" round>全部已保存记录</ElTag><span>更新于 {{ dateTime(data.generatedAt) }}</span></div>
      <div class="overview-metrics">
        <ElCard v-for="card in cards" :key="card.label" shadow="never" class="metric-card">
          <div class="metric-top"><span>{{ card.label }}</span><span class="metric-icon" :style="{ color: `var(--el-color-${card.tone})`, background: `var(--el-color-${card.tone}-light-9)` }"><component :is="card.icon" :size="21"/></span></div>
          <strong class="metric-value">{{ number(card.value) }}</strong><p>{{ card.detail }}</p>
        </ElCard>
      </div>
      <ElCard v-if="!data.totals.plans" shadow="never" class="overview-empty"><ElEmpty description="还没有保存的交易计划。从第一份计划开始积累记录。"><ElButton type="primary" :disabled="navigating" @click="emit('plans')">前往交易计划<ArrowRight :size="16"/></ElButton></ElEmpty></ElCard>
      <template v-else>
        <div class="overview-grid">
          <ElCard shadow="never" class="overview-panel">
            <div class="panel-heading"><div><h2>计划状态分布</h2><p>按交易计划当前状态统计</p></div><span class="panel-total">{{ number(data.totals.plans) }} 份</span></div>
            <div class="distribution-list">
              <div v-for="row in planDistribution" :key="row.label" class="distribution-row">
                <div class="distribution-label"><span>{{ row.label }}</span><span><strong>{{ number(row.count) }}</strong><small>{{ percentage(row.count, data.totals.plans) }}</small></span></div>
                <div class="distribution-track" aria-hidden="true"><div :style="{ width: `${share(row.count, data.totals.plans)}%`, background: row.color }"/></div>
              </div>
            </div>
          </ElCard>
          <ElCard shadow="never" class="overview-panel">
            <div class="panel-heading"><div><h2>订单状态分布</h2><p>按关联订单当前状态统计</p></div><span class="panel-total">{{ number(data.totals.orders) }} 笔</span></div>
            <ElEmpty v-if="!data.totals.orders" description="计划中还没有关联订单" :image-size="76"/>
            <template v-else>
              <div class="distribution-list order-distribution">
                <div v-for="row in orderDistribution" :key="row.label" class="distribution-row">
                  <div class="distribution-label"><span>{{ row.label }}</span><span><strong>{{ number(row.count) }}</strong><small>{{ percentage(row.count, data.totals.orders) }}</small></span></div>
                  <div class="distribution-track" aria-hidden="true"><div :style="{ width: `${share(row.count, data.totals.orders)}%`, background: row.color }"/></div>
                </div>
              </div>
              <div class="panel-note"><ShieldCheck :size="18"/><span>已锁定 {{ number(data.totals.lockedOrders) }} 笔。<template v-if="data.totals.closedOrders">占已平仓订单 {{ percentage(data.totals.lockedOrders, data.totals.closedOrders) }}。</template><template v-else>当前还没有已平仓订单。</template></span></div>
            </template>
          </ElCard>
          <ElCard shadow="never" class="overview-panel">
            <div class="panel-heading"><div><h2>常用品种</h2><p>按计划数量排列，展示前 5 个品种</p></div><span class="panel-total">{{ number(data.distinctSymbols) }} 种</span></div>
            <ElEmpty v-if="!data.topSymbols.length" description="已保存计划尚未填写品种" :image-size="64"/>
            <div v-else class="distribution-list">
              <div v-for="row in data.topSymbols" :key="row.symbol" class="distribution-row">
                <div class="distribution-label"><strong class="symbol-name">{{ row.symbol }}</strong><span><strong>{{ number(row.count) }} 份</strong><small>{{ percentage(row.count, data.totals.plans) }}</small></span></div>
                <div class="distribution-track" aria-hidden="true"><div :style="{ width: `${share(row.count, data.totals.plans)}%` }"/></div>
              </div>
            </div>
            <p class="definition">占比以全部计划为分母；忽略品种首尾空格并合并大小写。<template v-if="data.plansWithoutSymbol">另有 {{ number(data.plansWithoutSymbol) }} 份计划未填写品种。</template></p>
          </ElCard>
          <ElCard shadow="never" class="overview-panel review-panel">
            <div class="panel-heading"><div><h2>复盘完成情况</h2><p>让每一份记录都有下一次行动</p></div><BookOpenCheck :size="22" class="accent-icon"/></div>
            <div class="review-summary"><strong>{{ percentage(data.totals.reviews, data.totals.plans) }}</strong><span>计划复盘覆盖率</span></div>
            <div class="distribution-track review-track" aria-hidden="true"><div :style="{ width: `${share(data.totals.reviews, data.totals.plans)}%` }"/></div>
            <div class="review-counts"><span>已完成 <strong>{{ number(data.totals.reviews) }}</strong> 份</span><span>尚未复盘 <strong>{{ number(pendingReviews) }}</strong> 份</span></div>
            <p class="definition">至少保存一项复盘内容即计为已完成。覆盖率 = 已完成复盘的计划数 / 全部已保存计划数，包含草稿及未执行计划。</p>
            <div class="panel-note"><span>计划事件累计 <strong>{{ number(data.totals.events) }}</strong> 条，保留订单创建、状态与字段变化的过程。</span></div>
          </ElCard>
        </div>
        <ElCard shadow="never" class="overview-panel recent-panel">
          <div class="panel-heading"><div><h2>近期记录动态</h2><p>最近有活动的 6 份计划，包含计划、关联订单、事件与复盘更新</p></div><ElButton type="primary" link :disabled="navigating" @click="emit('plans')">查看交易计划<ArrowRight :size="15"/></ElButton></div>
          <ul class="recent-plans">
            <li v-for="plan in data.recentPlans" :key="plan.id">
              <div class="recent-plan-name"><ClipboardPenLine :size="20"/><div><strong>{{ plan.symbol || '未填写品种' }}</strong><span>创建于 {{ dateTime(plan.createdAt) }}</span></div></div>
              <ElTag :type="planInfo(plan.status).tagType" effect="light" round>{{ planInfo(plan.status).label }}</ElTag>
              <div class="recent-time"><span>最近活动</span><time :datetime="plan.activityAt">{{ dateTime(plan.activityAt) }}</time></div>
              <ElButton type="primary" link :disabled="navigating" :aria-label="`查看 ${plan.symbol || '未填写品种'} 的交易计划`" @click="emit('openPlan', plan.id)">查看<ArrowRight :size="15"/></ElButton>
            </li>
          </ul>
        </ElCard>
      </template>
      <p class="overview-footnote">统计范围为本机全部已保存计划及其关联记录，不受交易计划列表筛选影响。未保存输入与识别草稿不计入；这里不计算账户收益。</p>
    </template>
  </section>
</template>

<style scoped>
.overview-page{max-width:1500px;margin:0 auto;display:flex;flex-direction:column;gap:24px}.overview-header{display:flex;align-items:center;justify-content:space-between;gap:20px}.overview-eyebrow{font-size:11px;letter-spacing:2px;color:var(--el-color-primary);margin:0 0 12px}.overview-header h1{font-size:30px;line-height:1.3;margin:0;color:var(--el-text-color-primary)}.overview-subtitle{color:var(--el-text-color-secondary);margin:12px 0 0;line-height:1.7}.overview-page .el-button :deep(span){gap:8px}.overview-scope{display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap;color:var(--el-text-color-secondary);font-size:12px}.overview-metrics{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:18px}.metric-card,.overview-panel,.overview-empty{border-radius:12px}.metric-card{--el-card-padding:22px}.metric-top{display:flex;align-items:center;justify-content:space-between;gap:8px;color:var(--el-text-color-regular);font-size:14px}.metric-icon{width:40px;height:40px;border-radius:11px;display:grid;place-items:center;flex-shrink:0}.metric-value{display:block;font-size:36px;line-height:1.3;margin-top:15px;font-variant-numeric:tabular-nums;overflow-wrap:anywhere}.metric-card p{font-size:12px;color:var(--el-text-color-secondary);margin:10px 0 0;line-height:1.6}.overview-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:22px}.overview-panel{--el-card-padding:26px;min-width:0}.panel-heading{display:flex;align-items:flex-start;justify-content:space-between;gap:14px;margin-bottom:24px}.panel-heading h2{font-size:17px;line-height:1.5;margin:0}.panel-heading p{font-size:12px;line-height:1.7;color:var(--el-text-color-secondary);margin:6px 0 0}.panel-total{white-space:nowrap;font-size:13px;color:var(--el-text-color-secondary);padding-top:5px}.distribution-list{display:flex;flex-direction:column;gap:19px}.distribution-label{display:flex;justify-content:space-between;align-items:baseline;gap:12px;font-size:13px;margin-bottom:9px}.distribution-label>span:last-child{display:flex;align-items:baseline;gap:12px;flex-shrink:0;font-variant-numeric:tabular-nums}.distribution-label strong{font-weight:600}.distribution-label small{color:var(--el-text-color-secondary);font-size:12px;min-width:45px;text-align:right}.distribution-track{height:7px;border-radius:5px;background:var(--el-fill-color-light);overflow:hidden}.distribution-track>div{height:100%;border-radius:inherit;background:var(--el-color-primary);transition:width .2s ease}.order-distribution{gap:27px;padding-top:8px}.panel-note{display:flex;align-items:flex-start;gap:9px;background:var(--el-color-primary-light-9);border-radius:9px;padding:15px;color:var(--el-text-color-regular);font-size:12px;line-height:1.8;margin-top:27px}.panel-note>svg{flex-shrink:0;margin-top:2px;color:var(--el-color-primary)}.symbol-name{overflow-wrap:anywhere;min-width:0}.definition{font-size:12px;color:var(--el-text-color-secondary);line-height:1.9;margin:22px 0 0}.accent-icon{color:var(--el-color-primary);flex-shrink:0}.review-summary{display:flex;flex-direction:column;gap:9px;margin-top:6px}.review-summary>strong{font-size:40px;line-height:1.2;color:var(--el-color-primary);font-variant-numeric:tabular-nums}.review-summary>span{font-size:12px;color:var(--el-text-color-secondary)}.review-track{margin-top:22px;height:9px}.review-counts{display:flex;justify-content:space-between;gap:12px;font-size:13px;margin-top:14px;flex-wrap:wrap}.review-counts strong{font-variant-numeric:tabular-nums}.recent-plans{list-style:none;margin:0;padding:0}.recent-plans li{display:grid;grid-template-columns:minmax(0,1fr) 95px minmax(150px,220px) 55px;gap:22px;align-items:center;padding:19px 0;border-top:1px solid var(--el-border-color-lighter)}.recent-plan-name{display:flex;align-items:center;gap:13px;min-width:0}.recent-plan-name>svg{color:var(--el-color-primary);flex-shrink:0}.recent-plan-name>div{display:flex;flex-direction:column;gap:8px;min-width:0}.recent-plan-name strong{font-size:14px;overflow-wrap:anywhere}.recent-plan-name span,.recent-time>span{font-size:11px;color:var(--el-text-color-secondary)}.recent-time{display:flex;flex-direction:column;gap:7px;font-size:12px;font-variant-numeric:tabular-nums}.recent-plans .el-tag{justify-self:start}.overview-footnote{font-size:12px;line-height:1.9;color:var(--el-text-color-secondary);margin:0}.overview-loading{padding:24px 0}
@media(max-width:1100px){.overview-metrics{grid-template-columns:repeat(2,minmax(0,1fr))}.recent-plans li{grid-template-columns:minmax(0,1fr) 85px 170px 48px;gap:12px}}
@media(max-width:720px){.overview-page{gap:18px}.overview-header{align-items:flex-start;flex-wrap:wrap}.overview-header h1{font-size:26px}.overview-subtitle{font-size:13px}.overview-metrics{gap:12px}.metric-card{--el-card-padding:16px}.metric-top{font-size:12px}.metric-icon{width:30px;height:30px}.metric-value{font-size:30px}.overview-grid{grid-template-columns:1fr;gap:18px}.overview-panel{--el-card-padding:20px}.recent-panel .panel-heading{flex-wrap:wrap}.recent-plans li{grid-template-columns:minmax(0,1fr) auto;gap:14px}.recent-plans .el-tag{justify-self:end}.recent-time{grid-column:1}.recent-plans .el-button{justify-self:end}.recent-plan-name>svg{display:none}.recent-plan-name span{line-height:1.6}.panel-heading{gap:10px}.panel-heading h2{font-size:16px}}
@media(prefers-reduced-motion:reduce){.distribution-track>div{transition:none}}
</style>
