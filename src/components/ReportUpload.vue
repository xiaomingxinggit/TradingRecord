<script setup lang="ts">
import { ref } from 'vue'
import { ElAlert, ElButton, ElIcon, ElSpace, ElText, ElUpload } from 'element-plus'
import type { UploadFile, UploadRawFile, UploadUserFile } from 'element-plus'
import { Upload } from 'lucide-vue-next'
import { useWorkspace } from '../composables/useWorkspace'

const { busy, importFiles } = useWorkspace()
const files = ref<UploadUserFile[]>([])
const validationMessages = ref<string[]>([])
const maxSize = 20 * 1024 * 1024

function changed(file: UploadFile) {
  let message = ''
  if (!/\.(html?|xlsx)$/i.test(file.name)) message = `${file.name}：仅支持 HTML、HTM 和 XLSX 报告。`
  else if (!file.raw || file.raw.size === 0) message = `${file.name}：文件为空，请重新导出报告。`
  else if (file.raw.size > maxSize) message = `${file.name}：超过单个文件 20 MB 的限制。`
  if (message) {
    files.value = files.value.filter(item => item.uid !== file.uid)
    validationMessages.value = [...new Set([...validationMessages.value, message])]
  }
}

async function startImport() {
  const selected = files.value.map(file => file.raw).filter((file): file is UploadRawFile => !!file)
  if (await importFiles(selected)) {
    files.value = []
    validationMessages.value = []
  }
}
</script>

<template>
  <div class="page-stack report-upload">
    <ElUpload v-model:file-list="files" drag multiple accept=".html,.htm,.xlsx" :limit="10"
      :auto-upload="false" :disabled="busy" :on-change="changed" :before-remove="() => !busy"
      :on-exceed="() => validationMessages = ['单次最多上传 10 个文件，请分批导入。']">
      <ElIcon :size="34" color="var(--el-color-primary)"><Upload /></ElIcon>
      <div class="upload-label">拖放 MT5 报告到这里，或 <ElText type="primary">点击选择文件</ElText></div>
      <template #tip>
        <ElText type="info" size="small">HTML / HTM / XLSX · 每个文件不超过 20 MB · 一次最多 10 个文件</ElText>
      </template>
    </ElUpload>
    <ElAlert v-if="validationMessages.length" title="部分文件未添加" type="warning" show-icon
      @close="validationMessages = []">
      <p v-for="message in validationMessages" :key="message">{{ message }}</p>
    </ElAlert>
    <ElSpace wrap>
      <ElButton type="primary" :loading="busy" :disabled="!files.length || busy" @click="startImport">
        {{ busy ? '正在解析报告…' : files.length ? `开始导入（${files.length} 个文件）` : '开始导入' }}
      </ElButton>
      <ElButton v-if="files.length" :disabled="busy" @click="files = []; validationMessages = []">清空列表</ElButton>
      <ElText type="info" size="small">仅在本机解析与存储</ElText>
    </ElSpace>
  </div>
</template>

<style scoped>
.upload-label { margin-top: 12px; line-height: 1.7; }
.report-upload :deep(.el-upload-list__item-name) { min-width: 0; }
</style>
