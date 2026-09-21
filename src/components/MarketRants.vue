<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { ElAlert, ElButton, ElCard, ElEmpty, ElForm, ElFormItem, ElImage, ElImageViewer, ElInput, ElMessage, ElMessageBox, ElSkeleton } from 'element-plus'
import { ImagePlus, MessageSquareText, RefreshCw, Send, X } from 'lucide-vue-next'

interface RantImage { id: string; name: string; mimeType: string; size: number; url: string }
interface Rant { id: string; content: string; createdAt: string; images: RantImage[] }
interface DraftImage { id: number; file: File; url: string }

const props = defineProps<{ navigating: boolean }>()
const content = ref(''), draftImages = ref<DraftImage[]>([]), rants = ref<Rant[]>([])
const loading = ref(false), publishing = ref(false), loaded = ref(false), confirming = ref(false)
const loadError = ref(''), publishError = ref(''), imageError = ref('')
const fileInput = ref<HTMLInputElement>()
const previewUrls = ref<string[]>([]), previewIndex = ref(0), previewOpen = ref(false)
const dirty = computed(() => !!content.value.length || !!draftImages.value.length)
const disabled = computed(() => loading.value || publishing.value || confirming.value || props.navigating)
const canPublish = computed(() => !!content.value.trim() || !!draftImages.value.length)
const allowedTypes = new Set(['image/png', 'image/jpeg', 'image/webp'])
let imageId = 0
let loadController: AbortController | undefined
let mounted = true

async function readJson<T>(response: Response): Promise<T> {
  const result = await response.json().catch(() => { throw new Error('服务返回无效响应，请确认后端已更新并重新启动。') })
  if (!response.ok) throw new Error(result.error || '行情吐槽操作失败，请稍后重试。')
  return result as T
}
function dateTime(value: string) {
  return new Date(value).toLocaleString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })
}
async function load() {
  if (loading.value || publishing.value) return
  loading.value = true
  loadError.value = ''
  loadController = new AbortController()
  try {
    const result = await readJson<{ rants: Rant[] }>(await fetch('/api/market-rants', { signal: loadController.signal }))
    if (!Array.isArray(result.rants)) throw new Error('时间线响应无效，请确认后端已更新并重新启动。')
    if (mounted) { rants.value = result.rants; loaded.value = true }
  } catch (error) {
    if (mounted && (error as Error).name !== 'AbortError') loadError.value = (error as Error).message
  } finally {
    if (mounted) loading.value = false
    loadController = undefined
  }
}
function addImages(files: File[]) {
  if (disabled.value) return
  imageError.value = ''
  if (draftImages.value.length + files.length > 4) { imageError.value = '每条吐槽最多 4 张图片，请先移除多余图片。'; return }
  for (const file of files) {
    const problem = !allowedTypes.has(file.type) ? '仅支持 PNG、JPEG 和 WebP 图片。'
      : !file.size ? '不能添加空图片。' : file.size > 5 * 1024 * 1024 ? '每张图片不能超过 5 MB。' : ''
    if (problem) { imageError.value = `${file.name}：${problem}`; return }
  }
  draftImages.value.push(...files.map(file => ({ id: ++imageId, file, url: URL.createObjectURL(file) })))
}
function selectImages(event: Event) {
  const input = event.target as HTMLInputElement
  addImages(Array.from(input.files || []))
  input.value = ''
}
function removeImage(id: number) {
  if (disabled.value) return
  const image = draftImages.value.find(item => item.id === id)
  if (image) URL.revokeObjectURL(image.url)
  draftImages.value = draftImages.value.filter(item => item.id !== id)
  imageError.value = ''
}
function clearDraft() {
  previewOpen.value = false
  previewUrls.value = []
  draftImages.value.forEach(image => URL.revokeObjectURL(image.url))
  draftImages.value = []
  content.value = ''
  imageError.value = ''
  publishError.value = ''
}
function preview(urls: string[], index: number) {
  previewUrls.value = urls
  previewIndex.value = index
  previewOpen.value = true
}
function pasteImages(event: ClipboardEvent) {
  if (disabled.value || previewOpen.value || event.defaultPrevented) return
  if (event.target instanceof Element && event.target.closest('[role="dialog"]')) return
  const files = Array.from(event.clipboardData?.items || [])
    .filter(item => item.kind === 'file' && item.type.startsWith('image/'))
    .map(item => item.getAsFile()).filter((file): file is File => !!file)
  if (!files.length) return
  event.preventDefault()
  addImages(files)
}
async function publish() {
  if (disabled.value || !canPublish.value) return
  publishing.value = true
  publishError.value = ''
  const body = new FormData()
  body.append('content', content.value.trim())
  draftImages.value.forEach(image => body.append('images', image.file, image.file.name))
  try {
    const result = await readJson<{ rant: Rant }>(await fetch('/api/market-rants', { method: 'POST', body }))
    if (!result.rant?.id || !Array.isArray(result.rant.images)) throw new Error('发布响应无效，请刷新时间线确认是否已保存，再决定是否重新发布。')
    if (!mounted) return
    rants.value.unshift(result.rant)
    clearDraft()
    ElMessage.success('吐槽已保存在本机')
  } catch (error) {
    if (mounted) publishError.value = `${(error as Error).message} 输入已保留；若连接中断，可先刷新时间线确认是否已保存。`
  } finally { if (mounted) publishing.value = false }
}
async function confirmDiscard() {
  if (publishing.value) { ElMessage.warning('吐槽正在发布，请完成后再切换。'); return false }
  if (confirming.value) return false
  if (!dirty.value) return true
  confirming.value = true
  try {
    await ElMessageBox.confirm('这条行情吐槽尚未发布，离开将丢失文字和图片。', '离开行情吐槽', {
      confirmButtonText: '放弃草稿', cancelButtonText: '继续写', type: 'warning', closeOnClickModal: false,
    })
    clearDraft()
    return true
  } catch { return false }
  finally { confirming.value = false }
}
function beforeUnload(event: BeforeUnloadEvent) {
  if (dirty.value || publishing.value) { event.preventDefault(); event.returnValue = '' }
}
onMounted(() => {
  void load()
  window.addEventListener('paste', pasteImages)
  window.addEventListener('beforeunload', beforeUnload)
})
onBeforeUnmount(() => {
  mounted = false
  loadController?.abort()
  clearDraft()
  window.removeEventListener('paste', pasteImages)
  window.removeEventListener('beforeunload', beforeUnload)
})
defineExpose({ confirmDiscard })
</script>

<template>
  <section class="rants-page">
    <header class="rants-header">
      <div><p class="rants-eyebrow">记录此刻的行情与心情</p><h1>行情吐槽</h1><p class="rants-subtitle">随手写几句，贴一张图。每条记录都保存在本机。</p></div>
      <span class="rants-badge"><MessageSquareText :size="17"/>我的行情时间线</span>
    </header>
    <ElCard shadow="never" class="rant-composer">
      <div class="composer-heading"><h2>现在的行情，想说点什么？</h2><span>文字、图片，或一起发</span></div>
      <ElForm :disabled="disabled" label-position="top" @submit.prevent="publish">
        <ElFormItem label="写下吐槽">
          <ElInput v-model="content" type="textarea" :rows="4" maxlength="2000" show-word-limit placeholder="行情怎么走，心里怎么想，都记在这里……"/>
        </ElFormItem>
        <div v-if="draftImages.length" class="rant-images draft-images">
          <div v-for="(image, index) in draftImages" :key="image.id" class="draft-image">
            <button type="button" class="image-preview-button" :aria-label="`预览待发布图片 ${index + 1}`" @click="preview(draftImages.map(item => item.url), index)"><ElImage :src="image.url" :alt="image.file.name" fit="cover"/></button>
            <ElButton class="remove-image" circle size="small" :disabled="disabled" :aria-label="`移除图片 ${index + 1}`" @click="removeImage(image.id)"><X :size="14"/></ElButton>
          </div>
        </div>
        <ElAlert v-if="imageError" :title="imageError" type="error" show-icon :closable="false" class="composer-alert"/>
        <ElAlert v-if="publishError" :title="publishError" type="error" show-icon :closable="false" class="composer-alert"/>
        <div class="composer-footer">
          <div class="image-actions"><input ref="fileInput" type="file" multiple accept="image/png,image/jpeg,image/webp" hidden :disabled="disabled" @change="selectImages"/><ElButton :disabled="disabled || draftImages.length >= 4" @click="fileInput?.click()"><ImagePlus :size="17"/>添加图片 {{ draftImages.length }}/4</ElButton><span>也可 Ctrl + V 粘贴图片 · 每张 ≤ 5 MB</span></div>
          <ElButton native-type="submit" type="primary" :loading="publishing" :disabled="disabled || !canPublish"><Send v-if="!publishing" :size="16"/>{{ publishing ? '正在发布' : '发布吐槽' }}</ElButton>
        </div>
      </ElForm>
    </ElCard>
    <section class="rant-feed" aria-label="行情吐槽时间线" :aria-busy="loading">
      <div class="feed-heading"><div><h2>行情时间线</h2><span>{{ loaded ? `共 ${rants.length} 条记录 · 最新在前` : '按发布时间倒序' }}</span></div><ElButton :loading="loading" :disabled="disabled" @click="load"><RefreshCw v-if="!loading" :size="15"/>刷新时间线</ElButton></div>
      <ElAlert v-if="loadError" :title="loadError" :description="loaded ? '保留上次读取的记录，可点击刷新时间线重试。' : '暂时无法读取历史记录，可点击刷新时间线重试。'" type="error" show-icon :closable="false"/>
      <ElSkeleton v-if="loading && !loaded" :rows="5" animated class="feed-loading"/>
      <ElCard v-else-if="loaded && !rants.length" shadow="never" class="feed-empty"><ElEmpty description="还没有吐槽，记下第一句行情感想吧" :image-size="88"/></ElCard>
      <ol v-if="rants.length" class="rant-timeline">
        <li v-for="rant in rants" :key="rant.id" class="rant-item">
          <span class="timeline-dot" aria-hidden="true"/>
          <article class="rant-entry">
            <header class="entry-heading"><span>行情随记</span><time :datetime="rant.createdAt">{{ dateTime(rant.createdAt) }}</time></header>
            <p v-if="rant.content" class="rant-content">{{ rant.content }}</p>
            <div v-if="rant.images.length" class="rant-images" :class="{ 'single-image': rant.images.length === 1 }">
              <button v-for="(image, index) in rant.images" :key="image.id" type="button" class="image-preview-button" :aria-label="`查看 ${dateTime(rant.createdAt)} 的图片 ${index + 1}`" @click="preview(rant.images.map(item => item.url), index)"><ElImage :src="image.url" :alt="image.name" fit="cover" loading="lazy"><template #error><span class="image-failed">图片加载失败，点击重试预览</span></template></ElImage></button>
            </div>
          </article>
        </li>
      </ol>
    </section>
    <ElImageViewer v-if="previewOpen" :url-list="previewUrls" :initial-index="previewIndex" teleported @close="previewOpen = false"/>
  </section>
</template>

<style scoped>
.rants-page{max-width:1100px;margin:0 auto;display:flex;flex-direction:column;gap:26px}.rants-header{display:flex;align-items:center;justify-content:space-between;gap:22px}.rants-eyebrow{font-size:11px;letter-spacing:2px;color:var(--el-color-primary);margin:0 0 12px}.rants-header h1{font-size:30px;line-height:1.3;margin:0;color:var(--el-text-color-primary)}.rants-subtitle{color:var(--el-text-color-secondary);margin:12px 0 0;line-height:1.7}.rants-badge{display:flex;align-items:center;gap:8px;flex-shrink:0;padding:10px 14px;border-radius:20px;background:var(--el-color-primary-light-9);color:var(--el-color-primary);font-size:12px}.rant-composer{border-radius:14px;--el-card-padding:26px}.composer-heading{display:flex;align-items:center;justify-content:space-between;gap:14px;margin-bottom:22px}.composer-heading h2,.feed-heading h2{font-size:17px;margin:0;line-height:1.5}.composer-heading>span,.image-actions>span,.feed-heading span{font-size:12px;color:var(--el-text-color-secondary);line-height:1.7}.rant-composer :deep(.el-textarea__inner){line-height:1.8}.rants-page .el-button :deep(span){gap:7px}.composer-footer{display:flex;align-items:center;justify-content:space-between;gap:20px;margin-top:20px}.image-actions{display:flex;align-items:center;gap:14px;flex-wrap:wrap}.composer-alert{margin-top:14px}.rant-images{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px;max-width:720px}.image-preview-button{padding:0;display:block;min-width:0;aspect-ratio:4/3;border:1px solid var(--el-border-color-lighter);border-radius:9px;overflow:hidden;background:var(--el-fill-color-light);cursor:zoom-in;color:var(--el-text-color-secondary)}.image-preview-button:focus-visible{outline:2px solid var(--el-color-primary);outline-offset:3px}.image-preview-button>.el-image{display:block;width:100%;height:100%}.image-failed{display:grid;place-content:center;height:100%;padding:10px;font-size:12px;line-height:1.6}.draft-image{position:relative;min-width:0}.draft-image .image-preview-button{width:100%}.remove-image{position:absolute;right:6px;top:6px;background:var(--el-bg-color);box-shadow:var(--el-box-shadow-light)}.single-image{grid-template-columns:minmax(0,360px)}.feed-heading{display:flex;align-items:center;justify-content:space-between;gap:16px;margin-bottom:20px}.feed-heading>div{display:flex;align-items:baseline;gap:14px}.feed-empty{border-radius:12px}.feed-loading{padding:20px 0}.rant-timeline{list-style:none;margin:0;padding:0 0 0 14px}.rant-item{position:relative;border-left:2px solid var(--el-border-color-light);padding:0 0 20px 26px}.rant-item:last-child{padding-bottom:0}.timeline-dot{position:absolute;left:-7px;top:25px;width:12px;height:12px;border-radius:50%;background:var(--el-color-primary);border:3px solid var(--el-color-primary-light-8);box-sizing:border-box}.rant-entry{border:1px solid var(--el-border-color-lighter);border-radius:12px;background:var(--el-bg-color);padding:22px 24px}.entry-heading{display:flex;align-items:center;justify-content:space-between;gap:16px;margin-bottom:16px;font-size:12px}.entry-heading>span{color:var(--el-color-primary);font-weight:600}.entry-heading time{color:var(--el-text-color-secondary);font-variant-numeric:tabular-nums}.rant-content{white-space:pre-wrap;overflow-wrap:anywhere;line-height:1.85;font-size:14px;margin:0;color:var(--el-text-color-primary)}.rant-content+.rant-images{margin-top:18px}.rant-feed>.el-alert{margin-bottom:20px}
@media(max-width:760px){.rants-page{gap:20px}.rants-header{align-items:flex-start;flex-direction:column;gap:12px}.rants-header h1{font-size:26px}.rants-subtitle{font-size:13px}.rant-composer{--el-card-padding:18px}.composer-heading{align-items:flex-start;flex-direction:column;gap:6px;margin-bottom:18px}.composer-footer{align-items:stretch;flex-direction:column;gap:16px}.image-actions{gap:10px}.image-actions>span{font-size:11px}.composer-footer>.el-button{width:100%}.rant-images{grid-template-columns:repeat(2,minmax(0,1fr));gap:8px}.single-image{grid-template-columns:minmax(0,1fr)}.feed-heading>div{align-items:flex-start;flex-direction:column;gap:5px}.feed-heading h2{font-size:16px}.rant-timeline{padding-left:6px}.rant-item{padding-left:17px}.rant-entry{padding:17px 15px}.entry-heading{align-items:flex-start;flex-direction:column;gap:7px}.rant-content{font-size:13px}}
</style>
