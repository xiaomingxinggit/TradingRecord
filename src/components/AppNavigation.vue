<script setup lang="ts">
import { ElButton, ElDivider, ElIcon, ElLink, ElMenu, ElMenuItem, ElScrollbar, ElText } from 'element-plus'
import { ArrowDownToLine, ChartNoAxesColumnIncreasing, CircleHelp, ClipboardPenLine } from 'lucide-vue-next'

defineProps<{ exporting: boolean }>()
const emit = defineEmits<{ plans: []; export: []; help: [] }>()
</script>

<template>
  <div class="navigation-frame">
    <div class="brand-area"><ElLink :underline="'never'" class="brand" @click="emit('plans')"><ElIcon class="brand-mark" :size="24"><ChartNoAxesColumnIncreasing/></ElIcon><span>TradeLog</span></ElLink><ElText type="info" size="small">个人开仓计划</ElText></div>
    <ElScrollbar class="navigation-scroll">
      <div class="navigation-content">
        <ElText tag="p" type="info" size="small" class="nav-label">工作空间</ElText>
        <ElMenu default-active="plans" class="workspace-menu" @select="emit('plans')"><ElMenuItem index="plans"><ElIcon><ClipboardPenLine/></ElIcon><span>开仓计划</span></ElMenuItem></ElMenu>
        <ElDivider/>
        <ElText tag="p" type="info" size="small" class="nav-label">数据管理</ElText>
        <ElButton text class="export-button" :loading="exporting" :disabled="exporting" @click="emit('export')"><ArrowDownToLine v-if="!exporting" :size="19"/><span>{{ exporting ? '正在导出…' : '导出数据' }}</span></ElButton>
        <ElText tag="p" type="info" size="small" class="export-hint">Markdown（含图片） · ZIP<br/>全部已保存计划</ElText>
        <ElButton text class="help-button" @click="emit('help')"><CircleHelp :size="17"/>使用说明</ElButton>
      </div>
    </ElScrollbar>
  </div>
</template>

<style scoped>
.navigation-frame{height:100%;display:flex;flex-direction:column}.brand-area{padding:28px 26px 22px;display:flex;flex-direction:column;gap:12px}.brand{font-family:'Manrope Variable',sans-serif;font-size:25px;font-weight:800;color:var(--el-text-color-primary);justify-content:flex-start}.brand :deep(.el-link__inner){gap:10px}.brand-mark{width:35px;height:38px;background:var(--el-color-primary);color:white;border-radius:10px}.navigation-scroll{flex:1;min-height:0}.navigation-content{padding:12px 14px 20px}.nav-label{padding-left:13px;margin:10px 0 12px}.workspace-menu{border-right:0}.workspace-menu .el-menu-item{height:46px;border-radius:8px;padding-inline:14px!important}.workspace-menu .el-menu-item.is-active{background:var(--el-color-primary-light-9)}.workspace-menu :deep(.el-icon){font-size:19px;margin-right:10px}.navigation-content>.el-divider{width:calc(100% - 26px);margin:25px 13px}.export-button,.help-button{width:100%;justify-content:flex-start;margin-left:0;padding-inline:14px}.export-button{height:44px}.export-hint{padding:3px 14px;line-height:1.9}.help-button{margin-top:42px}.el-button :deep(span){gap:9px}
</style>
