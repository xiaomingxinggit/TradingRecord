<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { ElAlert, ElButton, ElCard, ElForm, ElFormItem, ElInput, ElMessage, ElMessageBox, ElOption, ElSelect, ElSkeleton, ElTag } from 'element-plus'

type ReviewStatus = 'draft' | 'completed'
interface Review {
  version: 1; revision: number; result: string; adherence: string;
  good: string; improve: string; status: ReviewStatus; updatedAt: string | null;
}
const props = defineProps<{ planId: string; disabled?: boolean }>()
const emit = defineEmits<{ saved: [plan: { id: string; updatedAt: string }] }>()
const results = ['未记录', '未结束', '盈利', '亏损', '持平']
const adherenceOptions = ['未评定', '是', '部分', '否']
const empty = (): Review => ({ version: 1, revision: 0, result: '未记录', adherence: '未评定', good: '', improve: '', status: 'draft', updatedAt: null })
const draft = ref<Review>(empty()), baseline = ref(''), savedStatus = ref<ReviewStatus>('draft')
const ready = ref(false), loading = ref(false), saving = ref(false), confirming = ref(false)
const uncertain = ref(false), conflict = ref(false), error = ref('')
let generation = 0, controller: AbortController | undefined
const content = computed(() => JSON.stringify({ result: draft.value.result, adherence: draft.value.adherence, good: draft.value.good, improve: draft.value.improve }))
const dirty = computed(() => ready.value && (content.value !== baseline.value || uncertain.value))
const busy = computed(() => loading.value || saving.value || confirming.value)
const locked = computed(() => !!props.disabled || busy.value || !ready.value)
const needsBeforeUnload = computed(() => dirty.value || busy.value)
function accept(review: Review) {
  draft.value = { ...review }; savedStatus.value = review.status; baseline.value = content.value
  ready.value = true; uncertain.value = false; conflict.value = false
}
async function request<T>(method: string, body?: object): Promise<T> {
  const current = new AbortController(); controller = current
  const timeout = window.setTimeout(() => current.abort(), 30000)
  try {
    const response = await fetch(`/api/plans/${encodeURIComponent(props.planId)}/review`, {
      method, signal: current.signal, ...(body ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {}),
    })
    const data = await response.json().catch(() => { throw new Error('服务返回无效响应，当前输入已保留。') })
    if (!response.ok) throw Object.assign(new Error(data.error || '复盘操作失败。'), { status: response.status })
    return data as T
  } finally { window.clearTimeout(timeout); if (controller === current) controller = undefined }
}
async function load() {
  if (busy.value || props.disabled) return
  if (dirty.value) {
    confirming.value = true
    try {
      await ElMessageBox.confirm('重新读取会用已保存的复盘替换当前输入。请先复制需要保留的文字；取消可继续编辑。', '重新读取复盘', {
        confirmButtonText: '读取并替换', cancelButtonText: '保留当前输入', type: 'warning', closeOnClickModal: false,
      })
    } catch { return } finally { confirming.value = false }
  }
  const current = generation
  loading.value = true; error.value = ''
  try {
    const data = await request<{ review: Review }>('GET')
    if (current === generation) accept(data.review)
  } catch (e) {
    if (current === generation) error.value = (e as Error).name === 'AbortError' ? '读取超时，请重试。' : (e as Error).message
  } finally { if (current === generation) loading.value = false }
}
async function save(status: ReviewStatus) {
  if (locked.value || conflict.value) return
  if (status === 'completed' && !draft.value.good.trim() && !draft.value.improve.trim()) {
    error.value = '完成复盘前，请至少填写“做得好的地方”或“下次改进”中的一项。'; return
  }
  const current = generation
  saving.value = true; error.value = ''; uncertain.value = true
  try {
    const { revision, result, adherence, good, improve } = draft.value
    const data = await request<{ review: Review; plan: { id: string; updatedAt: string } }>('PUT', { revision, result, adherence, good, improve, status })
    if (current !== generation) return
    accept(data.review); emit('saved', data.plan)
    ElMessage.success(status === 'completed' ? '复盘已完成，计划状态保持不变。' : '复盘草稿已保存。')
  } catch (e) {
    if (current !== generation) return
    conflict.value = (e as Error & { status?: number }).status === 409
    error.value = conflict.value ? '复盘已在其他页面更新，当前输入已保留。请先复制需要保留的内容，再重新读取最新复盘后编辑。'
      : (e as Error).name === 'AbortError' ? '保存超时，结果尚未确认；输入已保留，可重新读取核对或重试。' : (e as Error).message
  } finally { if (current === generation) saving.value = false }
}
watch(() => props.planId, () => {
  generation++; controller?.abort(); loading.value = false; saving.value = false; confirming.value = false
  ready.value = false; uncertain.value = false; conflict.value = false; draft.value = empty(); baseline.value = ''; error.value = ''
  void load()
}, { immediate: true })
// A newly saved plan can mount this component while its parent's save is finishing.
watch(() => props.disabled, value => { if (!value && !ready.value && !busy.value && !error.value) void load() })
onBeforeUnmount(() => { generation++; controller?.abort() })
defineExpose({ dirty, busy, needsBeforeUnload })
</script>

<template>
  <ElCard shadow="never" class="simple-review">
    <template #header><div class="plan-card-heading"><h2>交易复盘 <ElTag :type="savedStatus === 'completed' ? 'success' : 'info'" size="small">{{ savedStatus === 'completed' ? '已完成' : '草稿' }}</ElTag></h2><span>{{ dirty ? '有未保存的内容' : draft.updatedAt ? `保存于 ${new Date(draft.updatedAt).toLocaleString('zh-CN', { hour12: false })}` : '还未记录复盘' }}</span></div></template>
    <p class="review-help">回看这笔交易，留下下次可用的经验。复盘独立保存，完成后不改变开仓计划状态。</p>
    <ElAlert v-if="error" :title="error" type="error" :closable="false" show-icon class="plan-alert"/>
    <ElSkeleton v-if="loading" :rows="4" animated/>
    <ElForm v-if="ready" label-position="top" :disabled="locked" @submit.prevent.stop="save('draft')">
      <div class="review-selects">
        <ElFormItem label="交易结果"><ElSelect v-model="draft.result"><ElOption v-for="value in results" :key="value" :value="value" :label="value"/></ElSelect></ElFormItem>
        <ElFormItem label="是否按计划执行"><ElSelect v-model="draft.adherence"><ElOption v-for="value in adherenceOptions" :key="value" :value="value" :label="value"/></ElSelect></ElFormItem>
      </div>
      <ElFormItem label="做得好的地方"><ElInput v-model="draft.good" type="textarea" :rows="4" maxlength="5000" show-word-limit placeholder="哪些判断和行动值得继续保持？"/></ElFormItem>
      <ElFormItem label="下次改进"><ElInput v-model="draft.improve" type="textarea" :rows="4" maxlength="5000" show-word-limit placeholder="下一次遇到类似情况，准备怎样做？"/></ElFormItem>
      <div class="review-actions"><ElButton native-type="submit" :disabled="locked || conflict" :loading="saving">保存复盘草稿</ElButton><ElButton native-type="button" type="primary" :disabled="locked || conflict" @click="save('completed')">完成复盘</ElButton></div>
    </ElForm>
    <ElButton native-type="button" text :disabled="busy || disabled" class="review-reload" @click="load">重新读取已保存复盘</ElButton>
  </ElCard>
</template>

<style scoped>
.review-help{color:var(--el-text-color-secondary);font-size:13px;line-height:1.8;margin:0 0 20px}.review-selects{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:20px}.review-actions{display:flex;flex-wrap:wrap;gap:10px}.review-actions .el-button{margin:0}.review-reload{margin-top:14px}@media(max-width:600px){.review-selects{grid-template-columns:1fr;gap:0}}
</style>
