<script setup lang="ts">
import { ElButton, ElCard, ElCol, ElEmpty, ElInput, ElRadioButton, ElRadioGroup, ElRate, ElRow, ElTag } from 'element-plus'
import { ArrowRight, Search } from 'lucide-vue-next'
import { useWorkspace } from '../composables/useWorkspace'

const { currency, reviewed, accountTrades, reviewMode, journalTrades, search, money, openTrade } = useWorkspace()
</script>

<template>
  <div class="page-stack">
    <ElCard shadow="never" class="journal-intro">
      <div class="section-heading">
        <div><h2>记录思考，改进下一次交易</h2><p class="muted">为每笔交易补充策略、执行评分与复盘笔记。</p></div>
        <ElTag size="large" effect="light">已完成复盘 {{ reviewed }} / {{ accountTrades.length }}</ElTag>
      </div>
    </ElCard>
    <div class="journal-toolbar">
      <ElRadioGroup v-model="reviewMode" aria-label="筛选复盘状态"><ElRadioButton value="all">全部交易</ElRadioButton><ElRadioButton value="pending">待复盘</ElRadioButton><ElRadioButton value="done">已复盘</ElRadioButton></ElRadioGroup>
      <ElInput v-model="search" clearable :prefix-icon="Search" placeholder="搜索策略、标签或笔记" aria-label="搜索复盘" />
    </div>
    <ElRow v-if="journalTrades.length" :gutter="16">
      <ElCol v-for="trade in journalTrades" :key="trade.id" :xs="24" :md="12" :xl="8" class="journal-column">
        <ElCard shadow="hover" class="journal-card">
          <template #header>
            <div class="journal-heading">
              <div><ElButton link type="primary" :aria-label="`查看 ${trade.symbol} 交易 ${trade.ticket}`" @click="openTrade(trade)">{{ trade.symbol }}</ElButton><span class="muted journal-date">{{ trade.openTime.slice(0, 10) }}</span></div>
              <ElTag :type="trade.side === 'buy' ? 'success' : 'danger'" size="small">{{ trade.side === 'buy' ? '做多' : '做空' }}</ElTag>
            </div>
          </template>
          <div class="journal-result"><strong v-if="trade.closeTime" class="numeric" :class="trade.netProfit >= 0 ? 'positive' : 'negative'">{{ money(trade.netProfit, true) }} <small>{{ currency }}</small></strong><ElTag v-else type="info" size="small">未平仓</ElTag><span class="muted">#{{ trade.ticket }}</span></div>
          <ElTag v-if="trade.note?.strategy" class="strategy-tag" :title="trade.note.strategy">{{ trade.note.strategy }}</ElTag>
          <p class="journal-text" :class="{ muted: !trade.note?.content?.trim() }">{{ trade.note?.content?.trim() || '记录入场逻辑、执行情况，以及下次可以改进的地方…' }}</p>
          <div v-if="trade.note?.tags?.length" class="journal-tags"><ElTag v-for="tag in trade.note.tags" :key="tag" type="info" size="small">{{ tag }}</ElTag></div>
          <div class="journal-footer"><ElRate :model-value="trade.note?.rating || 0" disabled :aria-label="`执行评分 ${trade.note?.rating || 0} 分`" /><ElButton link :type="trade.note?.content?.trim() ? 'success' : 'primary'" @click="openTrade(trade)">{{ trade.note?.content?.trim() ? '查看复盘' : '开始复盘' }}<ArrowRight :size="14" /></ElButton></div>
        </ElCard>
      </ElCol>
    </ElRow>
    <ElCard v-else shadow="never"><ElEmpty description="暂无符合条件的交易，试试其他复盘状态或搜索条件。" /></ElCard>
  </div>
</template>

<style scoped>
.journal-intro { background: var(--el-color-primary-light-9); }
.journal-intro h2 { margin: 0; font-size: 18px; }
.journal-intro p { margin-bottom: 0; }
.journal-toolbar { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 14px; }
.journal-toolbar > .el-input { width: 310px; max-width: 100%; }
.journal-column { display: flex; margin-bottom: 16px; }
.journal-card { width: 100%; }
.journal-heading, .journal-result, .journal-footer { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; justify-content: space-between; }
.journal-date { margin-left: 10px; font-size: 12px; }
.journal-result { margin-bottom: 14px; font-size: 13px; }
.journal-result strong { font-size: 19px; }
.journal-result small { font-size: 12px; font-weight: 500; }
.strategy-tag { max-width: 100%; }
.strategy-tag :deep(.el-tag__content) { overflow: hidden; text-overflow: ellipsis; }
.journal-text { min-height: 72px; line-height: 1.75; overflow: hidden; display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 3; white-space: pre-wrap; overflow-wrap: anywhere; }
.journal-tags { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 12px; }
.journal-tags .el-tag { height: auto; min-height: 20px; max-width: 100%; white-space: normal; overflow-wrap: anywhere; }
.journal-footer { border-top: 1px solid var(--el-border-color-lighter); padding-top: 12px; }
.journal-footer :deep(.el-button > span) { gap: 6px; }
</style>
