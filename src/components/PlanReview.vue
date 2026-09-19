<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import {
  ElAlert, ElButton, ElCard, ElForm, ElFormItem, ElInput, ElMessage,
  ElMessageBox, ElRadioButton, ElRadioGroup, ElSkeleton,
} from 'element-plus'
import { Save } from 'lucide-vue-next'

type Assessment = '' | 'valid' | 'partial' | 'invalid' | 'unverified'
type Discipline = '' | 'followed' | 'deviated' | 'broken' | 'not_executed'
interface ReviewForm { assessment: Assessment; discipline: Discipline; summary: string; nextAction: string }
interface PlanReview extends ReviewForm { planId: string; createdAt: string; updatedAt: string }

const props = defineProps<{ planId: string; disabled?: boolean }>()
const emit = defineEmits<{ stateChange: [state: { dirty: boolean; busy: boolean }] }>()
const emptyForm = (): ReviewForm => ({ assessment: '', discipline: '', summary: '', nextAction: '' })
const form = ref<ReviewForm>(emptyForm())
const savedForm = ref<ReviewForm>(emptyForm())
const review = ref<PlanReview | null>(null)
const loading = ref(false), saving = ref(false), ready = ref(false), error = ref('')
const baseline = ref(JSON.stringify(savedForm.value))
const busy = computed(() => loading.value || saving.value)
const dirty = computed(() => ready.value && JSON.stringify(form.value) !== baseline.value)
let generation = 0
let loadController: AbortController | undefined, saveController: AbortController | undefined

const assessmentOptions: { value: Assessment; label: string }[] = [
  { value: '', label: '未填写' }, { value: 'valid', label: '成立' }, { value: 'partial', label: '部分成立' },
  { value: 'invalid', label: '不成立' }, { value: 'unverified', label: '尚未验证' },
]
const disciplineOptions: { value: Discipline; label: string }[] = [
  { value: '', label: '未填写' }, { value: 'followed', label: '按计划执行' }, { value: 'deviated', label: '有所偏离' },
  { value: 'broken', label: '明显偏离' }, { value: 'not_executed', label: '未执行' },
]

async function readJson<T>(response: Response): Promise<T> {
  const result = await response.json().catch(() => ({ error: '服务返回无效响应，请确认后端已重启到最新版本。' }))
  if (!response.ok) throw new Error(result.error || '计划复盘操作失败，请稍后重试。')
  return result as T
}
function formFrom(reviewValue: PlanReview | null): ReviewForm {
  return reviewValue ? {
    assessment: reviewValue.assessment,
    discipline: reviewValue.discipline,
    summary: reviewValue.summary,
    nextAction: reviewValue.nextAction,
  } : emptyForm()
}
function acceptBaseline(reviewValue: PlanReview | null) {
  review.value = reviewValue
  const next = formFrom(reviewValue)
  savedForm.value = { ...next }
  form.value = { ...next }
  baseline.value = JSON.stringify(next)
}
function timestamp(value: string) { return new Date(value).toLocaleString('zh-CN', { hour12: false }) }

async function load() {
  generation += 1
  const version = generation
  loadController?.abort()
  saveController?.abort()
  loadController = new AbortController()
  loading.value = true
  ready.value = false
  error.value = ''
  acceptBaseline(null)
  try {
    const result = await readJson<{ review: PlanReview | null }>(await fetch(
      `/api/plans/${encodeURIComponent(props.planId)}/review`, { signal: loadController.signal },
    ))
    if (version === generation) { acceptBaseline(result.review); ready.value = true }
  } catch (problem) {
    if (version === generation && (problem as Error).name !== 'AbortError') error.value = (problem as Error).message
  } finally {
    if (version === generation) { loading.value = false; loadController = undefined }
  }
}

async function save() {
  if (!ready.value || busy.value || props.disabled) return
  const payload = {
    assessment: form.value.assessment,
    discipline: form.value.discipline,
    summary: form.value.summary.trim(),
    nextAction: form.value.nextAction.trim(),
  }
  if (!payload.assessment && !payload.discipline && !payload.summary && !payload.nextAction) {
    error.value = '请至少填写一项复盘内容后再保存。'
    return
  }
  const version = generation
  saveController?.abort()
  saveController = new AbortController()
  saving.value = true
  error.value = ''
  try {
    const result = await readJson<{ review: PlanReview }>(await fetch(
      `/api/plans/${encodeURIComponent(props.planId)}/review`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' }, signal: saveController.signal,
        body: JSON.stringify({ ...payload, expectedUpdatedAt: review.value?.updatedAt ?? null }),
      },
    ))
    if (version === generation) {
      acceptBaseline(result.review)
      ElMessage.success('计划复盘已保存')
    }
  } catch (problem) {
    if (version === generation && (problem as Error).name !== 'AbortError') error.value = (problem as Error).message
  } finally {
    if (version === generation) { saving.value = false; saveController = undefined }
  }
}

async function confirmDiscard() {
  if (busy.value) return false
  if (!dirty.value) return true
  try {
    await ElMessageBox.confirm('计划复盘尚未保存。离开后将恢复最近一次保存的内容。', '离开计划复盘', {
      confirmButtonText: '放弃修改', cancelButtonText: '继续编辑', type: 'warning', closeOnClickModal: false,
    })
    form.value = { ...savedForm.value }
    error.value = ''
    return true
  } catch { return false }
}

watch(() => props.planId, () => { void load() }, { immediate: true })
watch([dirty, busy], ([isDirty, isBusy]) => emit('stateChange', { dirty: isDirty, busy: isBusy }), { immediate: true })
onBeforeUnmount(() => {
  generation += 1
  loadController?.abort()
  saveController?.abort()
  emit('stateChange', { dirty: false, busy: false })
})
defineExpose({ confirmDiscard })
</script>

<template>
  <ElCard shadow="never" class="plan-review-card">
    <template #header>
      <div class="plan-card-heading"><div><h2>计划复盘</h2><span>记录这份计划整体是否成立，以及下一次怎样做</span></div></div>
    </template>
    <ElAlert v-if="error" :title="error" type="error" show-icon :closable="false" class="review-alert"/>
    <ElSkeleton v-if="loading" :rows="6" animated/>
    <ElForm v-else :model="form" label-position="top" :disabled="disabled || busy || !ready" @submit.prevent="save">
      <div class="review-choices">
        <section class="review-choice-card">
          <p>回看原先的判断是否经得住行情验证</p>
          <ElFormItem label="计划结论">
            <ElRadioGroup v-model="form.assessment" size="small">
              <ElRadioButton v-for="option in assessmentOptions" :key="option.value" :value="option.value">{{ option.label }}</ElRadioButton>
            </ElRadioGroup>
          </ElFormItem>
        </section>
        <section class="review-choice-card">
          <p>只评价是否执行自己的规则</p>
          <ElFormItem label="执行纪律">
            <ElRadioGroup v-model="form.discipline" size="small">
              <ElRadioButton v-for="option in disciplineOptions" :key="option.value" :value="option.value">{{ option.label }}</ElRadioButton>
            </ElRadioGroup>
          </ElFormItem>
        </section>
      </div>
      <section class="review-writing-block">
        <div class="review-writing-heading"><h3>复盘总结</h3><p>记录计划的前提、触发条件和判断中需要保留或修正的部分</p></div>
        <ElFormItem>
          <ElInput v-model="form.summary" type="textarea" :rows="6" maxlength="3000" show-word-limit
            placeholder="这份计划的前提、触发条件和判断哪里成立，哪里需要修正？"/>
        </ElFormItem>
      </section>
      <section class="review-writing-block">
        <div class="review-writing-heading"><h3>下次行动</h3><p>把复盘结论落成下一次可以直接执行的动作</p></div>
        <ElFormItem>
          <ElInput v-model="form.nextAction" type="textarea" :rows="4" maxlength="2000" show-word-limit
            placeholder="下一次遇到相似场景，准备继续、停止或调整什么？"/>
        </ElFormItem>
      </section>
      <div class="review-footer">
        <span class="review-save-status"><i :class="{ saved: !!review }"/>{{ review ? `上次保存：${timestamp(review.updatedAt)}` : '尚未保存复盘' }}</span>
        <ElButton native-type="submit" type="primary" :loading="saving" :disabled="disabled || busy || !ready">
          <Save :size="15"/>保存复盘
        </ElButton>
      </div>
    </ElForm>
  </ElCard>
</template>

<style scoped>
.review-alert{margin-bottom:18px}.review-choices{display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:18px}.review-choice-card{min-width:0;padding:17px 18px 4px;border:1px solid var(--el-border-color-lighter);border-radius:10px;background:color-mix(in srgb,var(--el-fill-color-extra-light) 64%,transparent)}.review-choice-card>p{margin-bottom:13px;font-size:11px;line-height:1.6;color:var(--el-text-color-secondary)}.review-choice-card :deep(.el-form-item__label){font-weight:600;color:var(--el-text-color-primary)}.review-choice-card :deep(.el-radio-group){display:flex;flex-wrap:wrap}.review-choice-card :deep(.el-radio-button__inner){padding-inline:11px}.review-writing-block{padding:18px 18px 2px;margin-top:14px;border:1px solid var(--el-border-color-lighter);border-radius:10px;background:var(--el-bg-color)}.review-writing-heading{margin-bottom:14px}.review-writing-heading h3{color:var(--el-text-color-primary);font-size:14px}.review-writing-heading p{margin-top:5px;font-size:11px;line-height:1.6;color:var(--el-text-color-secondary)}.review-writing-block :deep(.el-textarea__inner){line-height:1.75;background:var(--el-fill-color-blank)}.review-footer{display:flex;align-items:center;justify-content:space-between;gap:16px;margin-top:18px;padding:14px 16px;border:1px solid var(--el-border-color-lighter);border-radius:10px;background:var(--el-fill-color-extra-light)}.review-save-status{display:flex;align-items:center;gap:8px;font-size:12px;color:var(--el-text-color-secondary)}.review-save-status i{width:7px;height:7px;border-radius:50%;background:var(--el-text-color-placeholder)}.review-save-status i.saved{background:var(--el-color-success)}@media(max-width:900px){.review-choices{grid-template-columns:1fr}}@media(max-width:760px){.review-choice-card{padding:15px 14px 2px}.review-writing-block{padding:16px 14px 2px}.review-footer{align-items:stretch;flex-direction:column}.review-footer .el-button{width:100%}}
</style>
