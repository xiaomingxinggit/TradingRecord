<script setup lang="ts">
import { ref } from 'vue'
import { ElAlert, ElButton, ElDialog, ElMessage } from 'element-plus'
import { Download, FileText, Images } from 'lucide-vue-next'

const visible = defineModel<boolean>({ default: false })
const busy = defineModel<boolean>('busy', { default: false })
const error = ref('')

function close(done: () => void) { if (!busy.value) done() }
function downloadName(response: Response) {
  const encoded = response.headers.get('content-disposition')?.match(/filename\*=UTF-8''([^;]+)/i)?.[1]
  if (encoded) {
    try {
      const name = decodeURIComponent(encoded)
      if (/^交易计划_\d{8}_\d{9}Z\.zip$/.test(name)) return name
    } catch { /* Use a safe local name if the response header is malformed. */ }
  }
  return `交易计划_${new Date().toISOString().replace(/[-:]/g, '').replace('T', '_').replace('.', '')}.zip`
}
async function download() {
  if (busy.value) return
  busy.value = true; error.value = ''
  try {
    const response = await fetch('/api/plans/export', { cache: 'no-store' })
    if (!response.ok) {
      const result = await response.json().catch(() => null)
      throw new Error(result?.error || '导出失败，请稍后重试。')
    }
    if (!response.headers.get('content-type')?.includes('application/zip')) throw new Error('导出响应不是有效的压缩包，请重启服务后重试。')
    const file = await response.blob()
    if (!file.size) throw new Error('导出内容为空，请稍后重试。')
    const url = URL.createObjectURL(file)
    try {
      const link = document.createElement('a')
      link.href = url; link.download = downloadName(response)
      document.body.appendChild(link)
      try { link.click() } finally { link.remove() }
    } finally { window.setTimeout(() => URL.revokeObjectURL(url), 60000) }
    ElMessage.success('已开始下载。完整解压后，打开交易计划.html 阅读。')
    visible.value = false
  } catch (failure) {
    error.value = failure instanceof Error ? failure.message : '导出失败，请稍后重试。'
  } finally { busy.value = false }
}
</script>

<template>
  <ElDialog v-model="visible" title="导出数据" class="export-data-dialog" width="min(580px, calc(100vw - 32px))" align-center
    :show-close="!busy" :close-on-click-modal="!busy" :close-on-press-escape="!busy" :before-close="close" @open="error = ''">
    <div class="export-content">
      <p class="export-lead">把交易记录带走，随时离线回看。</p>
      <div class="export-format"><FileText :size="22" aria-hidden="true"/><div><strong>HTML + Markdown</strong><p>包含目录、数量摘要、交易计划、关联订单、计划事件和最新复盘。</p></div></div>
      <div class="export-format"><Images :size="22" aria-hidden="true"/><div><strong>原始行情截图</strong><p>随 ZIP 一起保存，完整解压后可离线查看。</p></div></div>
      <div class="export-scope"><strong>导出范围：全部已保存交易计划</strong><p>包含全部状态，不受列表日期、状态筛选或分页影响。未保存输入、行情吐槽和回复、订单识别截图及草稿不包含在内。</p></div>
      <ElAlert title="完整解压 ZIP，用浏览器打开“交易计划.html”；保留 images 文件夹的位置。ZIP 是阅读资料，不能恢复数据库。" type="info" show-icon :closable="false"/>
      <ElAlert v-if="error" :title="error" type="error" show-icon :closable="false"/>
      <p v-if="busy" class="export-busy" role="status">正在整理已保存内容并生成压缩包，请稍候…</p>
    </div>
    <template #footer><ElButton :disabled="busy" @click="visible = false">取消</ElButton><ElButton type="primary" :loading="busy" @click="download"><Download v-if="!busy" :size="16" class="download-icon" aria-hidden="true"/>{{ busy ? '正在导出' : error ? '重试下载 ZIP' : '下载 ZIP' }}</ElButton></template>
  </ElDialog>
</template>

<style scoped>
.export-content{display:grid;gap:16px}.export-content p{margin:0;line-height:1.7}.export-lead{font-size:15px;color:var(--el-text-color-primary)}.export-format{display:flex;align-items:flex-start;gap:12px;padding:14px;border:1px solid var(--el-border-color-lighter);border-radius:10px;background:var(--el-fill-color-light)}.export-format svg{flex:none;color:var(--el-color-primary);margin-top:2px}.export-format strong,.export-scope strong{display:block;color:var(--el-text-color-primary);margin-bottom:4px}.export-format p,.export-scope p,.export-busy{font-size:13px;color:var(--el-text-color-secondary)}.download-icon{margin-right:6px}
</style>
