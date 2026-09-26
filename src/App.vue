<script setup lang="ts">
import { nextTick, ref } from 'vue'
import { ElAside, ElBreadcrumb, ElBreadcrumbItem, ElButton, ElConfigProvider, ElContainer, ElDrawer, ElFooter, ElHeader, ElMain, ElSpace, ElTag, ElText, ElTooltip } from 'element-plus'
import zhCn from 'element-plus/es/locale/lang/zh-cn'
import { ChevronRight, CircleHelp, Menu, Moon, Sun } from 'lucide-vue-next'
import { darkMode, themeAction, toggleTheme } from './ui/theme'
import AppNavigation from './components/AppNavigation.vue'
import OpeningPlans from './components/OpeningPlans.vue'
import DataOverview from './components/DataOverview.vue'
import MarketRants from './components/MarketRants.vue'
import HelpDialog from './components/HelpDialog.vue'
import SystemAnnouncement from './components/SystemAnnouncement.vue'
import ExportDataDialog from './components/ExportDataDialog.vue'

const plansRef = ref<InstanceType<typeof OpeningPlans>>()
const rantsRef = ref<InstanceType<typeof MarketRants>>()
type WorkspaceView = 'overview' | 'rants' | 'plans'
const activeView = ref<WorkspaceView>('overview')
const viewNames: Record<WorkspaceView, string> = { overview: '数据概览', rants: '行情吐槽', plans: '交易计划' }
const navigating = ref(false)
const mobileMenu = ref(false), help = ref(false), exporting = ref(false), exportDialog = ref(false)
async function confirmLeaveCurrentView() {
  if (activeView.value === 'plans') return await plansRef.value?.showList() ?? false
  if (activeView.value === 'rants') return await rantsRef.value?.confirmDiscard() ?? false
  return true
}
async function showView(view: WorkspaceView) {
  if (navigating.value) return
  if (view === activeView.value && view !== 'plans') { mobileMenu.value = false; return }
  navigating.value = true
  try {
    if (!await confirmLeaveCurrentView()) return
    activeView.value = view
    mobileMenu.value = false
  } finally { navigating.value = false }
}
function showPlans() { return showView('plans') }
function showOverview() { return showView('overview') }
function showRants() { return showView('rants') }
async function openOverviewPlan(id: string) {
  if (navigating.value) return
  navigating.value = true
  try {
    if (!await confirmLeaveCurrentView()) return
    activeView.value = 'plans'
    await nextTick()
    await plansRef.value?.openPlan({ id })
  } finally { navigating.value = false }
}
function showHelp() { mobileMenu.value = false; help.value = true }
function exportData() {
  if (exporting.value) return
  mobileMenu.value = false; exportDialog.value = true
}
</script>

<template>
  <ElConfigProvider :locale="zhCn">
    <ElContainer class="app-layout">
      <ElAside width="232px" class="desktop-sidebar"><AppNavigation :active-view="activeView" :navigating="navigating" :exporting="exporting" @overview="showOverview" @rants="showRants" @plans="showPlans" @export="exportData" @help="showHelp"/></ElAside>
      <ElContainer direction="vertical" class="content-layout">
        <ElHeader height="68px" class="app-header">
          <ElSpace :size="12"><ElButton class="mobile-menu-toggle" text circle aria-label="打开导航" @click="mobileMenu = true"><Menu :size="20"/></ElButton><ElBreadcrumb :separator-icon="ChevronRight"><ElBreadcrumbItem>工作空间</ElBreadcrumbItem><ElBreadcrumbItem>{{ viewNames[activeView] }}</ElBreadcrumbItem></ElBreadcrumb></ElSpace>
          <ElSpace class="header-actions"><ElTag type="success" effect="plain" round class="local-status">数据保存在本机</ElTag><ElTooltip :content="themeAction" placement="bottom"><ElButton text circle :aria-label="themeAction" :title="themeAction" @click="toggleTheme"><Sun v-if="darkMode" :size="19" aria-hidden="true"/><Moon v-else :size="19" aria-hidden="true"/></ElButton></ElTooltip><ElButton text circle aria-label="使用说明" @click="showHelp"><CircleHelp :size="19"/></ElButton></ElSpace>
        </ElHeader>
        <SystemAnnouncement />
        <ElMain class="workspace-main">
          <DataOverview v-if="activeView === 'overview'" :navigating="navigating" @plans="showPlans" @open-plan="openOverviewPlan"/>
          <MarketRants v-else-if="activeView === 'rants'" ref="rantsRef" :navigating="navigating"/>
          <OpeningPlans v-else ref="plansRef"/>
        </ElMain>
        <ElFooter height="auto" class="app-footer"><ElText type="info" size="small">TradeLog · 记下每一次入场的想法。</ElText></ElFooter>
      </ElContainer>
    </ElContainer>
    <ElDrawer v-model="mobileMenu" title="工作空间" direction="ltr" size="264px" class="navigation-drawer"><AppNavigation :active-view="activeView" :navigating="navigating" :exporting="exporting" @overview="showOverview" @rants="showRants" @plans="showPlans" @export="exportData" @help="showHelp"/></ElDrawer>
    <HelpDialog v-model="help"/>
    <ExportDataDialog v-model="exportDialog" v-model:busy="exporting"/>
  </ElConfigProvider>
</template>
