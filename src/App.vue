<script setup lang="ts">
import { computed, defineAsyncComponent, onMounted, ref } from 'vue'
import { ElAlert, ElAside, ElBreadcrumb, ElBreadcrumbItem, ElButton, ElConfigProvider, ElContainer, ElDrawer, ElFooter, ElHeader, ElMain, ElSkeleton, ElSpace, ElTag, ElText } from 'element-plus'
import zhCn from 'element-plus/es/locale/lang/zh-cn'
import { ChevronRight, CircleHelp, Menu, Plus } from 'lucide-vue-next'
import AppNavigation from './components/AppNavigation.vue'
import WorkspaceFilters from './components/WorkspaceFilters.vue'
import { useWorkspace, type Page } from './composables/useWorkspace'

const OverviewPage = defineAsyncComponent(() => import('./pages/OverviewPage.vue'))
const TradesPage = defineAsyncComponent(() => import('./pages/TradesPage.vue'))
const CalendarPage = defineAsyncComponent(() => import('./pages/CalendarPage.vue'))
const JournalPage = defineAsyncComponent(() => import('./pages/JournalPage.vue'))
const ImportsPage = defineAsyncComponent(() => import('./pages/ImportsPage.vue'))
const OpeningPlans = defineAsyncComponent(() => import('./components/OpeningPlans.vue'))
const TradeDrawer = defineAsyncComponent(() => import('./components/TradeDrawer.vue'))
const ImportDialog = defineAsyncComponent(() => import('./components/ImportDialog.vue'))
const HelpDialog = defineAsyncComponent(() => import('./components/HelpDialog.vue'))
const { page, loading, error, data, accountTrades, importWarnings, importModal, help, selected, go, load } = useWorkspace()
const mobileMenu = ref(false)
const headings: Record<Page, { title: string; description: string }> = {
  overview: { title: '交易概览', description: '看清每一笔交易，让成长有迹可循。' },
  plans: { title: '开仓计划', description: '贴一张行情图，记下这次入场的想法。' },
  trades: { title: '交易记录', description: '所有交易细节，井然有序。' },
  calendar: { title: '盈亏日历', description: '把交易表现，放回时间里。' },
  journal: { title: '交易复盘', description: '记录决策背后的思考，找到自己的交易节奏。' },
  imports: { title: '导入与数据', description: '连接你的 MT5 报告，积累完整的交易档案。' },
}
const currentHeading = computed(() => headings[page.value])
const warnings = computed(() => [...new Set([...(data.value.warnings || []), ...importWarnings.value])])
function navigate(next: Page) { mobileMenu.value = false; go(next) }
function showHelp() { mobileMenu.value = false; help.value = true }
onMounted(() => { void load() })
</script>

<template>
  <ElConfigProvider :locale="zhCn">
    <ElContainer class="app-layout">
      <ElAside width="232px" class="desktop-sidebar"><AppNavigation :page="page" :trade-count="accountTrades.length" @navigate="navigate" @help="showHelp"/></ElAside>
      <ElContainer direction="vertical" class="content-layout">
        <ElHeader height="68px" class="app-header">
          <ElSpace :size="12"><ElButton class="mobile-menu-toggle" text circle aria-label="打开导航" @click="mobileMenu = true"><Menu :size="20"/></ElButton><ElBreadcrumb :separator-icon="ChevronRight"><ElBreadcrumbItem>工作空间</ElBreadcrumbItem><ElBreadcrumbItem>{{ currentHeading.title }}</ElBreadcrumbItem></ElBreadcrumb></ElSpace>
          <ElSpace><ElTag type="success" effect="plain" round class="local-status">数据保存在本机</ElTag><ElButton text circle aria-label="使用说明" @click="showHelp"><CircleHelp :size="19"/></ElButton></ElSpace>
        </ElHeader>
        <ElMain class="workspace-main">
          <ElAlert v-if="error && !importModal && page !== 'plans'" type="error" show-icon :title="error" class="workspace-alert" @close="error = ''"><ElButton type="danger" link @click="load">重新加载数据</ElButton></ElAlert>
          <ElAlert v-if="warnings.length && page !== 'plans'" title="导入提示" type="warning" show-icon :closable="false" class="workspace-alert"><ul class="warning-list"><li v-for="warning in warnings" :key="warning">{{ warning }}</li></ul></ElAlert>
          <OpeningPlans v-if="page === 'plans'"/>
          <template v-else>
            <div class="page-heading"><div><ElText tag="h1">{{ currentHeading.title }}</ElText><ElText type="info">{{ currentHeading.description }}</ElText></div><ElButton type="primary" @click="importModal = true"><Plus :size="16"/>导入交易</ElButton></div>
            <ElSkeleton v-if="loading" :rows="10" animated/>
            <template v-else>
              <WorkspaceFilters/>
              <OverviewPage v-if="page === 'overview'"/>
              <TradesPage v-else-if="page === 'trades'"/>
              <CalendarPage v-else-if="page === 'calendar'"/>
              <JournalPage v-else-if="page === 'journal'"/>
              <ImportsPage v-else-if="page === 'imports'"/>
            </template>
          </template>
        </ElMain>
        <ElFooter height="auto" class="app-footer"><ElText type="info" size="small">TradeLog · 让每一次交易，都有收获。</ElText></ElFooter>
      </ElContainer>
    </ElContainer>
    <ElDrawer v-model="mobileMenu" title="工作空间" direction="ltr" size="264px" class="navigation-drawer"><AppNavigation :page="page" :trade-count="accountTrades.length" @navigate="navigate" @help="showHelp"/></ElDrawer>
    <TradeDrawer v-if="selected"/>
    <ImportDialog v-if="importModal"/>
    <HelpDialog v-if="help"/>
  </ElConfigProvider>
</template>
