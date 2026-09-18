<script setup lang="ts">
import { nextTick, ref } from 'vue'
import { ElAlert, ElAside, ElBreadcrumb, ElBreadcrumbItem, ElButton, ElConfigProvider, ElContainer, ElDrawer, ElFooter, ElHeader, ElMain, ElMessage, ElSpace, ElTag, ElText, ElTooltip } from 'element-plus'
import zhCn from 'element-plus/es/locale/lang/zh-cn'
import { ChevronRight, CircleHelp, Menu, Moon, Sun } from 'lucide-vue-next'
import { darkMode, themeAction, toggleTheme } from './ui/theme'
import AppNavigation from './components/AppNavigation.vue'
import OpeningPlans from './components/OpeningPlans.vue'
import OrdersWorkspace from './components/OrdersWorkspace.vue'
import HelpDialog from './components/HelpDialog.vue'

const plansRef = ref<InstanceType<typeof OpeningPlans>>()
const ordersRef = ref<InstanceType<typeof OrdersWorkspace>>()
const page = ref<'plans' | 'orders'>('plans')
const navigating = ref(false)
const mobileMenu = ref(false), help = ref(false), exporting = ref(false), exportError = ref('')
async function navigate(target: 'plans' | 'orders', id?: string, createForPlan = false) {
  if (navigating.value) return
  navigating.value = true
  try {
    if (target !== page.value) {
      const allowed = page.value === 'plans' ? await plansRef.value?.canLeave() : await ordersRef.value?.canLeave()
      if (!allowed) return
      page.value = target; await nextTick()
    }
    if (target === 'plans') { if (id) await plansRef.value?.openPlanById(id); else await plansRef.value?.showList() }
    else if (createForPlan && id) await ordersRef.value?.createForPlan(id)
    else if (id) await ordersRef.value?.openOrderById(id)
    else await ordersRef.value?.showList()
    mobileMenu.value = false
  } finally { navigating.value = false }
}
function showPlans() { void navigate('plans') }
function showOrders() { void navigate('orders') }
function showHelp() { mobileMenu.value = false; help.value = true }
async function exportData() {
  if (exporting.value) return
  mobileMenu.value = false; exporting.value = true; exportError.value = ''
  try {
    const response = await fetch('/api/plans/export')
    if (!response.ok) {
      const result = await response.json().catch(() => null)
      throw new Error(result?.error || '导出失败，请稍后重试。')
    }
    if (!response.headers.get('content-type')?.includes('application/zip')) throw new Error('导出响应不是有效的压缩包，请重启服务后重试。')
    const file = await response.blob()
    if (!file.size) throw new Error('导出内容为空，请稍后重试。')
    const url = URL.createObjectURL(file)
    const link = document.createElement('a')
    link.href = url; link.download = '交易记录.zip'
    document.body.appendChild(link); link.click(); link.remove()
    window.setTimeout(() => URL.revokeObjectURL(url), 60000)
    ElMessage.success('已开始下载 Markdown 与截图压缩包。')
  } catch (error) {
    exportError.value = error instanceof Error ? error.message : '导出失败，请稍后重试。'
  } finally { exporting.value = false }
}
</script>

<template>
  <ElConfigProvider :locale="zhCn">
    <ElContainer class="app-layout">
      <ElAside width="232px" class="desktop-sidebar"><AppNavigation :active="page" :exporting="exporting" @plans="showPlans" @orders="showOrders" @export="exportData" @help="showHelp"/></ElAside>
      <ElContainer direction="vertical" class="content-layout">
        <ElHeader height="68px" class="app-header">
          <ElSpace :size="12"><ElButton class="mobile-menu-toggle" text circle aria-label="打开导航" @click="mobileMenu = true"><Menu :size="20"/></ElButton><ElBreadcrumb :separator-icon="ChevronRight"><ElBreadcrumbItem>工作空间</ElBreadcrumbItem><ElBreadcrumbItem>{{ page === 'plans' ? '交易计划' : '交易订单' }}</ElBreadcrumbItem></ElBreadcrumb></ElSpace>
          <ElSpace class="header-actions"><ElTag type="success" effect="plain" round class="local-status">数据保存在本机</ElTag><ElTooltip :content="themeAction" placement="bottom"><ElButton text circle :aria-label="themeAction" :title="themeAction" @click="toggleTheme"><Sun v-if="darkMode" :size="19" aria-hidden="true"/><Moon v-else :size="19" aria-hidden="true"/></ElButton></ElTooltip><ElButton text circle aria-label="使用说明" @click="showHelp"><CircleHelp :size="19"/></ElButton></ElSpace>
        </ElHeader>
        <ElMain class="workspace-main">
          <ElAlert v-if="exportError" :title="exportError" type="error" show-icon class="export-alert" @close="exportError = ''"/>
          <OpeningPlans v-if="page === 'plans'" ref="plansRef" @open-order="id => navigate('orders', id)" @create-order="id => navigate('orders', id, true)"/>
          <OrdersWorkspace v-else ref="ordersRef" @open-plan="id => navigate('plans', id)"/>
        </ElMain>
        <ElFooter height="auto" class="app-footer"><ElText type="info" size="small">TradeLog · 记下每一次入场的想法。</ElText></ElFooter>
      </ElContainer>
    </ElContainer>
    <ElDrawer v-model="mobileMenu" title="工作空间" direction="ltr" size="264px" class="navigation-drawer"><AppNavigation :active="page" :exporting="exporting" @plans="showPlans" @orders="showOrders" @export="exportData" @help="showHelp"/></ElDrawer>
    <HelpDialog v-model="help"/>
  </ElConfigProvider>
</template>
