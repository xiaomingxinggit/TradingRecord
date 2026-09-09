<script setup lang="ts">
import { ElButton, ElCard, ElDivider, ElIcon, ElLink, ElMenu, ElMenuItem, ElScrollbar, ElTag, ElText } from 'element-plus'
import { ArrowDownToLine, ArrowRight, BookOpen, CalendarDays, ChartNoAxesColumnIncreasing, CircleHelp, ClipboardPenLine, Database, LayoutDashboard, ShieldCheck } from 'lucide-vue-next'
import { DEFAULT_PAGE, PAGE_VISIBILITY, type Page } from '../config/pages'

defineProps<{ page: Page; tradeCount: number }>()
const emit = defineEmits<{ navigate: [page: Page]; help: [] }>()
const items = [
  { id: 'overview' as Page, label: '交易概览', icon: LayoutDashboard },
  { id: 'plans' as Page, label: '开仓计划', icon: ClipboardPenLine },
  { id: 'trades' as Page, label: '交易记录', icon: ChartNoAxesColumnIncreasing },
  { id: 'calendar' as Page, label: '盈亏日历', icon: CalendarDays },
  { id: 'journal' as Page, label: '交易复盘', icon: BookOpen },
].filter(item => PAGE_VISIBILITY[item.id])
function select(key: string) {
  if (key === 'export') { const link = document.createElement('a'); link.href = '/api/export'; link.download = 'trading-records.csv'; link.click() }
  else emit('navigate', key as Page)
}
</script>

<template>
  <div class="navigation-frame">
    <div class="brand-area"><ElLink :underline="'never'" class="brand" @click="emit('navigate', DEFAULT_PAGE)"><ElIcon class="brand-mark" :size="24"><ChartNoAxesColumnIncreasing/></ElIcon><span>TradeLog</span></ElLink><ElText type="info" size="small">个人交易工作台</ElText></div>
    <ElScrollbar class="navigation-scroll">
      <div class="navigation-content"><ElText tag="p" type="info" size="small" class="nav-label">工作空间</ElText>
        <ElMenu :default-active="page" class="workspace-menu" @select="select"><ElMenuItem v-for="item in items" :key="item.id" :index="item.id"><ElIcon><component :is="item.icon"/></ElIcon><span>{{ item.label }}</span><ElTag v-if="item.id === 'trades'" class="nav-count" size="small" type="info">{{ tradeCount }}</ElTag></ElMenuItem></ElMenu>
        <ElDivider/>
        <ElText tag="p" type="info" size="small" class="nav-label">数据管理</ElText>
        <ElMenu :default-active="page" class="workspace-menu" @select="select"><ElMenuItem v-if="PAGE_VISIBILITY.imports" index="imports"><ElIcon><Database/></ElIcon><span>导入与数据</span></ElMenuItem><ElMenuItem index="export"><ElIcon><ArrowDownToLine/></ElIcon><span>导出全部记录</span></ElMenuItem></ElMenu>
        <div class="navigation-help"><ElCard shadow="never" class="guidance-card"><ElIcon :size="23" color="var(--el-color-primary)"><ShieldCheck/></ElIcon><h3>专注交易，沉淀成长</h3><ElText tag="p" type="info" size="small">每一笔交易，都是下一次决策的参考。</ElText><ElButton type="primary" link @click="emit('help')">了解统计口径<ArrowRight :size="14"/></ElButton></ElCard><ElButton text class="help-button" @click="emit('help')"><CircleHelp :size="17"/>使用说明</ElButton></div>
      </div>
    </ElScrollbar>
  </div>
</template>

<style scoped>
.navigation-frame{height:100%;display:flex;flex-direction:column}.brand-area{padding:28px 26px 22px;display:flex;flex-direction:column;gap:12px}.brand{font-family:'Manrope Variable',sans-serif;font-size:25px;font-weight:800;color:var(--el-text-color-primary);justify-content:flex-start}.brand :deep(.el-link__inner){gap:10px}.brand-mark{width:35px;height:38px;background:var(--el-color-primary);color:white;border-radius:10px}.navigation-scroll{flex:1;min-height:0}.navigation-content{padding:12px 14px 20px}.nav-label{padding-left:13px;margin:10px 0 12px}.workspace-menu{border-right:0}.workspace-menu .el-menu-item{height:46px;border-radius:8px;margin-bottom:5px;padding-inline:14px!important}.workspace-menu .el-menu-item.is-active{background:var(--el-color-primary-light-9)}.workspace-menu :deep(.el-icon){font-size:19px;margin-right:10px}.nav-count{margin-left:auto}.navigation-content>.el-divider{width:calc(100% - 26px);margin:25px 13px}.navigation-help{margin-top:50px}.guidance-card{--el-card-padding:18px;background:var(--el-color-primary-light-9);margin:0 5px 14px}.guidance-card h3{font-size:13px;font-weight:600;margin:12px 0 9px}.guidance-card p{line-height:1.9}.guidance-card .el-button{margin-top:13px;font-size:12px}.help-button{width:100%;justify-content:flex-start}.el-button :deep(span){gap:7px}
</style>
