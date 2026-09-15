<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { ElAlert, ElImageViewer, ElOption, ElSelect, ElUpload, genFileId } from 'element-plus'
import type { UploadFile, UploadInstance, UploadRawFile } from 'element-plus'
import { ImagePlus } from 'lucide-vue-next'
import type { ImagePurpose, PracticeAttachment } from '../practice'
const files = defineModel<PracticeAttachment[]>({ required: true })
const props = defineProps<{ disabled: boolean; defaultPurpose: ImagePurpose }>()
const upload = ref<UploadInstance>(), error = ref(''), preview = ref(false), index = ref(0)
const urls = computed(() => files.value.flatMap(file => file.url ? [file.url] : [])), temporary = new Set<string>()
function changed(file: UploadFile) {
  if (!file.raw) return
  if (file.url?.startsWith('blob:')) temporary.add(file.url)
  const problem = !['image/png', 'image/jpeg', 'image/webp'].includes(file.raw.type) ? '只支持 PNG、JPEG、WebP' : !file.raw.size || file.raw.size > 5 * 1024 * 1024 ? '每张需为非空图片且不超过 5 MB' : ''
  if (problem) { error.value = `${file.name}：${problem}`; files.value = files.value.filter(item => item.uid !== file.uid); removed(file) }
  else { (file as PracticeAttachment).purpose = props.defaultPurpose; error.value = '' }
}
function removed(file: UploadFile) { if (file.url?.startsWith('blob:')) { URL.revokeObjectURL(file.url); temporary.delete(file.url) } }
function show(file: UploadFile) { index.value = Math.max(0, urls.value.indexOf(file.url || '')); preview.value = true }
function paste(event: ClipboardEvent) {
  if (props.disabled || preview.value) return
  const items = [...(event.clipboardData?.items || [])].filter(item => item.kind === 'file' && item.type.startsWith('image/')).map(item => item.getAsFile()).filter((file): file is File => !!file)
  if (!items.length) return
  event.preventDefault()
  if (items.length + files.value.length > 4) { error.value = '每条记录最多 4 张截图，请先移除多余图片。'; return }
  items.forEach(file => { const raw = new File([file], `模拟截图-${genFileId()}.${file.type === 'image/jpeg' ? 'jpg' : file.type === 'image/webp' ? 'webp' : 'png'}`, { type: file.type }) as UploadRawFile; raw.uid = genFileId(); upload.value?.handleStart(raw) })
}
onMounted(() => window.addEventListener('paste', paste))
onBeforeUnmount(() => { window.removeEventListener('paste', paste); temporary.forEach(url => URL.revokeObjectURL(url)) })
</script>
<template>
  <div class="practice-images-editor">
    <ElUpload ref="upload" v-model:file-list="files" :auto-upload="false" :disabled="disabled" :limit="4" multiple accept="image/png,image/jpeg,image/webp" list-type="picture-card" :on-change="changed" :on-remove="removed" :on-preview="show" :on-exceed="() => error = '每条记录最多 4 张截图。'"><div class="practice-image-trigger"><ImagePlus :size="25"/><span>上传 / 粘贴截图</span></div><template #tip><p class="practice-hint">支持 Ctrl / ⌘ + V 粘贴。PNG、JPEG、WebP，每张 ≤ 5 MB，共最多 4 张；保存记录时一起保存。</p></template></ElUpload>
    <ElAlert v-if="error" :title="error" type="warning" :closable="false" show-icon/>
    <div v-for="file in files" :key="file.uid" class="practice-image-purpose"><span :title="file.name">{{ file.name }}</span><ElSelect v-model="file.purpose" :disabled="disabled" aria-label="截图用途"><ElOption label="开仓前" value="before"/><ElOption label="复盘" value="review"/></ElSelect></div>
    <ElImageViewer v-if="preview && urls.length" :url-list="urls" :initial-index="index" teleported hide-on-click-modal @close="preview = false"/>
  </div>
</template>
