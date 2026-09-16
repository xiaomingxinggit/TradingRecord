<script setup lang="ts">
import { onBeforeUnmount, ref } from 'vue'
import { ElAlert, ElButton, ElDialog, ElMessage, ElTable, ElTableColumn } from 'element-plus'
import { ScanLine } from 'lucide-vue-next'

interface PriceRow { side: 'buy' | 'sell'; orderType: string; entryPrice: number; stopLoss: number | null; takeProfit: number | null }
defineProps<{ disabled?: boolean }>()
const emit = defineEmits<{ apply: [row: PriceRow] }>()
const open = ref(false), busy = ref(false), error = ref(''), preview = ref('')
const rows = ref<PriceRow[]>([]), input = ref<HTMLInputElement>()
let controller: AbortController | undefined
let version = 0
function reset() {
  version++; controller?.abort(); controller = undefined; busy.value = false
  if (preview.value) URL.revokeObjectURL(preview.value)
  preview.value = ''; rows.value = []; error.value = ''
}
function apply(row: PriceRow) {
  emit('apply', row); open.value = false
  ElMessage.success('价位已填入，请核对后保存；图片中未设置的止损、止盈已留空。')
}
async function recognize(file?: File) {
  if (!file || busy.value) return
  reset()
  if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type) || !file.size || file.size > 5 * 1024 * 1024) {
    error.value = '请选择不超过 5 MB 的 PNG、JPEG 或 WEBP 图片。'; return
  }
  const requestVersion = version
  preview.value = URL.createObjectURL(file); busy.value = true
  controller = new AbortController()
  const timeout = window.setTimeout(() => controller?.abort(), 60000)
  try {
    const body = new FormData(); body.append('image', file)
    const response = await fetch('/api/price-ocr', { method: 'POST', body, signal: controller.signal })
    const result = await response.json().catch(() => { throw new Error('识别服务不可用，请重启后端后重试。') })
    if (requestVersion !== version) return
    if (!response.ok) throw new Error(result.error || '识别失败，请重试。')
    rows.value = result.rows
    if (rows.value.length === 1) apply(rows.value[0]!)
  } catch (e) {
    if (requestVersion === version) error.value = (e as Error).name === 'AbortError' ? '识别超时，请稍后重试。' : (e as Error).message
  } finally {
    window.clearTimeout(timeout)
    if (requestVersion === version) busy.value = false
  }
}
function paste(event: ClipboardEvent) {
  if (!open.value) return
  event.stopImmediatePropagation()
  const images = Array.from(event.clipboardData?.files || []).filter(file => file.type.startsWith('image/'))
  if (!images.length) return
  event.preventDefault()
  if (images.length !== 1) { error.value = '请每次粘贴一张截图。'; return }
  void recognize(images[0])
}
function pick(event: Event) {
  const element = event.target as HTMLInputElement
  void recognize(element.files?.[0]); element.value = ''
}
// Capture prevents the surrounding form from treating OCR input as an analysis screenshot.
window.addEventListener('paste', paste, true)
onBeforeUnmount(() => { reset(); window.removeEventListener('paste', paste, true) })
</script>

<template>
  <ElButton :disabled="disabled" size="small" @click="reset(); open = true"><ScanLine :size="14"/>图片识别</ElButton>
  <ElDialog v-model="open" title="识别持仓 / 挂单价位" width="min(760px, 94vw)" append-to-body @close="reset">
    <p class="price-ocr-help">粘贴（Ctrl / ⌘ + V）或选择持仓、挂单截图，无需表头。请保留示例的完整列宽；单行自动填入，多行选择一行，账户汇总行自动跳过。会替换当前三个价位，空白止损、止盈会清空对应输入框。</p>
    <input ref="input" type="file" accept="image/png,image/jpeg,image/webp" hidden @change="pick"/>
    <ElButton :loading="busy" @click="input?.click()">{{ busy ? '正在识别…' : '选择截图' }}</ElButton>
    <p class="price-ocr-help">图片仅在本机识别，不保存为计划截图。填入后仍可修改，保存前请核对。</p>
    <img v-if="preview" :src="preview" class="price-ocr-preview" alt="待识别的持仓截图"/>
    <ElAlert v-if="error" :title="error" type="warning" :closable="false" show-icon/>
    <ElTable v-if="rows.length > 1" :data="rows">
      <ElTableColumn type="index" label="行" width="50"/>
      <ElTableColumn prop="orderType" label="交易类型" min-width="110"/>
      <ElTableColumn prop="entryPrice" label="开仓价"/>
      <ElTableColumn label="止损"><template #default="{ row }">{{ row.stopLoss ?? '未设置' }}</template></ElTableColumn>
      <ElTableColumn label="止盈"><template #default="{ row }">{{ row.takeProfit ?? '未设置' }}</template></ElTableColumn>
      <ElTableColumn label="操作"><template #default="{ $index }"><ElButton link type="primary" @click="apply(rows[$index]!)">填入此行</ElButton></template></ElTableColumn>
    </ElTable>
  </ElDialog>
</template>

<style scoped>
.price-ocr-help { margin: 0 0 16px; line-height: 1.7; color: #85738f; }
button + .price-ocr-help { margin-top: 16px; }
.price-ocr-preview { display: block; width: 100%; margin: 16px 0; border: 1px solid #eee; }
</style>
