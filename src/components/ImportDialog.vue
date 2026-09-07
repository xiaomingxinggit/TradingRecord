<script setup lang="ts">
import { ElAlert, ElButton, ElDialog, ElDivider, ElText } from 'element-plus'
import { FolderOpen } from 'lucide-vue-next'
import { useWorkspace } from '../composables/useWorkspace'
import ReportUpload from './ReportUpload.vue'

const { importModal, busy, error, data, importFiles } = useWorkspace()
function beforeClose(done: () => void) { if (!busy.value) done() }
</script>

<template>
  <ElDialog v-model="importModal" title="导入交易报告" width="min(620px, calc(100vw - 32px))"
    :before-close="beforeClose" :close-on-click-modal="!busy" :close-on-press-escape="!busy"
    :show-close="!busy" destroy-on-close>
    <div class="page-stack">
      <ElAlert v-if="error" :title="error" type="error" show-icon :closable="false" />
      <ReportUpload />
      <ElDivider>或使用当前目录</ElDivider>
      <ElButton :icon="FolderOpen" :loading="busy" :disabled="busy" @click="importFiles()">
        扫描根目录报告（{{ data.rootFiles.length }}）
      </ElButton>
      <ElText type="info" size="small">按账户与持仓标识自动去重，重复导入会保留已有复盘笔记。</ElText>
    </div>
    <template #footer><ElButton :disabled="busy" @click="importModal = false">关闭</ElButton></template>
  </ElDialog>
</template>
