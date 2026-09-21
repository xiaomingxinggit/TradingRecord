<script setup lang="ts">
import { ElButton, ElCard, ElDivider, ElIcon, ElLink, ElMenu, ElMenuItem, ElScrollbar, ElText } from 'element-plus'
import { ArrowDownToLine, ArrowRight, ChartNoAxesColumnIncreasing, ClipboardPenLine, LayoutDashboard, MessageSquareText, ShieldCheck } from 'lucide-vue-next'

defineProps<{ exporting: boolean; activeView: 'overview' | 'rants' | 'plans'; navigating: boolean }>()
const emit = defineEmits<{ overview: []; rants: []; plans: []; export: []; help: [] }>()
</script>

<template>
  <div class="navigation-frame">
    <div class="brand-area"><ElLink :underline="'never'" class="brand" @click="emit('overview')"><ElIcon class="brand-mark" :size="24"><ChartNoAxesColumnIncreasing/></ElIcon><span>TradeLog</span></ElLink><ElText type="info" size="small">记录每一份交易计划</ElText></div>
    <ElScrollbar class="navigation-scroll">
      <div class="navigation-content">
        <ElText tag="p" type="info" size="small" class="nav-label">工作空间</ElText>
        <ElMenu :key="`${activeView}-${navigating}`" :default-active="activeView" class="workspace-menu" @select="value => value === 'overview' ? emit('overview') : value === 'rants' ? emit('rants') : emit('plans')">
          <ElMenuItem index="overview" :disabled="navigating"><ElIcon><LayoutDashboard/></ElIcon><span>数据概览</span></ElMenuItem>
          <ElMenuItem index="plans" :disabled="navigating"><ElIcon><ClipboardPenLine/></ElIcon><span>交易计划</span></ElMenuItem>
          <ElMenuItem index="rants" :disabled="navigating"><ElIcon><MessageSquareText/></ElIcon><span>行情吐槽</span></ElMenuItem>
        </ElMenu>
        <ElDivider/>
        <ElText tag="p" type="info" size="small" class="nav-label">数据管理</ElText>
        <ElButton text class="export-button" :loading="exporting" :disabled="exporting" @click="emit('export')"><ArrowDownToLine v-if="!exporting" :size="19"/><span>{{ exporting ? '正在导出…' : '导出数据' }}</span></ElButton>
        <div class="navigation-help">
          <ElCard shadow="never" class="guidance-card">
            <ElIcon :size="23" color="var(--el-color-primary)"><ShieldCheck/></ElIcon>
            <h3>记录计划，沉淀思考</h3>
            <ElText tag="p" type="info" size="small">写清入场依据与出场理由，保留计划价位和行情截图。</ElText>
            <ElButton type="primary" link @click="emit('help')">使用说明<ArrowRight :size="14"/></ElButton>
          </ElCard>
        </div>
      </div>
    </ElScrollbar>
  </div>
</template>

<style scoped>
.navigation-frame{height:100%;display:flex;flex-direction:column}.brand-area{padding:28px 26px 22px;display:flex;flex-direction:column;gap:12px}.brand{font-family:'Manrope Variable',sans-serif;font-size:25px;font-weight:800;color:var(--el-text-color-primary);justify-content:flex-start}.brand :deep(.el-link__inner){gap:10px}.brand-mark{width:35px;height:38px;background:var(--app-brand-bg,var(--el-color-primary));color:white;border-radius:10px}.navigation-scroll{flex:1;min-height:0}.navigation-content{padding:12px 14px 20px}.nav-label{padding-left:13px;margin:10px 0 12px}.workspace-menu{border-right:0}.workspace-menu .el-menu-item{height:46px;border-radius:8px;padding-inline:14px!important}.workspace-menu .el-menu-item.is-active{background:var(--el-color-primary-light-9)}.workspace-menu :deep(.el-icon){font-size:19px;margin-right:10px}.navigation-content>.el-divider{width:calc(100% - 26px);margin:25px 13px}.export-button{width:100%;justify-content:flex-start;margin-left:0;padding-inline:14px;height:44px}.el-button :deep(span){gap:9px}
.navigation-help{margin-top:50px}.guidance-card{--el-card-padding:18px;background:var(--el-color-primary-light-9);margin:0 5px 14px}.guidance-card h3{font-size:13px;font-weight:600;margin:12px 0 9px}.guidance-card p{line-height:1.9}.guidance-card .el-button{margin-top:13px;font-size:12px}.guidance-card .el-button :deep(span){gap:7px}
</style>
