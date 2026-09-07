<script setup lang="ts">
import { nextTick, reactive, ref, watch } from 'vue'
import { ElAlert, ElButton, ElDescriptions, ElDescriptionsItem, ElDivider, ElDrawer, ElForm, ElFormItem, ElInput, ElMessage, ElRate, ElTag } from 'element-plus'
import type { FormInstance, FormRules } from 'element-plus'
import { useWorkspace } from '../composables/useWorkspace'

const { selected, currency, money, saveTradeNote } = useWorkspace()
const saving = ref(false)
const saveError = ref('')
const formRef = ref<FormInstance>()
const form = reactive({ strategy: '', rating: 0, tagsText: '', content: '' })
const parseTags = (value: string) => value.split(/[,，]/).map(tag => tag.trim()).filter(Boolean)
const rules: FormRules<typeof form> = {
  strategy: [{ max: 120, message: '策略名称不能超过 120 字。', trigger: 'blur' }],
  rating: [{ type: 'integer', min: 0, max: 5, message: '评分必须是 0 到 5 的整数。', trigger: 'change' }],
  tagsText: [{ validator: (_rule, value: string, callback) => {
    const tags = parseTags(value)
    if (tags.length > 20) callback(new Error('最多添加 20 个标签，请使用中英文逗号分隔。'))
    else if (tags.some(tag => tag.length > 40)) callback(new Error('每个标签不能超过 40 字。'))
    else callback()
  }, trigger: 'blur' }],
  content: [{ max: 10000, message: '复盘内容不能超过 10000 字。', trigger: 'blur' }],
}

watch(selected, async trade => {
  if (!trade) return
  form.strategy = trade.note?.strategy || ''
  form.rating = trade.note?.rating || 0
  form.tagsText = trade.note?.tags?.join('，') || ''
  form.content = trade.note?.content || ''
  saveError.value = ''
  await nextTick()
  formRef.value?.clearValidate()
}, { immediate: true })

function closeDrawer() { if (!saving.value) selected.value = null }
function beforeClose(done: () => void) { if (!saving.value) done() }
async function save() {
  if (!selected.value || saving.value) return
  saving.value = true
  saveError.value = ''
  try {
    if (!await formRef.value?.validate().catch(() => false)) return
    await saveTradeNote(selected.value.id, { strategy: form.strategy, rating: form.rating, tags: parseTags(form.tagsText), content: form.content })
    ElMessage.success('复盘已保存')
    selected.value = null
  } catch (error) {
    saveError.value = error instanceof Error ? error.message : '保存失败，请稍后重试。'
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <ElDrawer :model-value="!!selected" title="交易详情与复盘" size="min(620px, 100%)" :before-close="beforeClose" :close-on-click-modal="!saving" :close-on-press-escape="!saving" :show-close="!saving" destroy-on-close @update:model-value="!$event && closeDrawer()">
    <template v-if="selected">
      <div class="trade-heading">
        <div><h2>{{ selected.symbol }} <ElTag :type="selected.side === 'buy' ? 'success' : 'danger'">{{ selected.side === 'buy' ? '做多' : '做空' }}</ElTag></h2><span class="muted">#{{ selected.ticket }}</span></div>
        <div class="trade-profit"><template v-if="selected.closeTime"><strong class="numeric" :class="selected.netProfit >= 0 ? 'positive' : 'negative'">{{ money(selected.netProfit, true) }}</strong><span class="muted">已实现净盈亏 · {{ currency }}</span></template><ElTag v-else type="info">未平仓</ElTag></div>
      </div>
      <ElDescriptions :column="1" border class="trade-description">
        <ElDescriptionsItem label="开仓时间">{{ selected.openTime }}</ElDescriptionsItem>
        <ElDescriptionsItem label="平仓时间">{{ selected.closeTime || '未平仓' }}</ElDescriptionsItem>
        <ElDescriptionsItem label="开仓 / 平仓价"><span class="numeric">{{ selected.openPrice }} / {{ selected.closePrice ?? '—' }}</span></ElDescriptionsItem>
        <ElDescriptionsItem label="交易量">{{ selected.volume }} 手</ElDescriptionsItem>
        <ElDescriptionsItem label="报表交易盈亏">{{ money(selected.profit) }} {{ currency }}</ElDescriptionsItem>
        <ElDescriptionsItem label="止损 / 止盈"><span class="numeric">{{ selected.stopLoss ?? '—' }} / {{ selected.takeProfit ?? '—' }}</span></ElDescriptionsItem>
        <ElDescriptionsItem label="手续费 / 库存费 / 费用"><span class="numeric">{{ money(selected.commission) }} / {{ money(selected.swap) }} / {{ money(selected.fees) }}</span></ElDescriptionsItem>
      </ElDescriptions>
      <ElAlert v-if="selected.comment" :title="`报表注释：${selected.comment}`" type="info" :closable="false" class="broker-comment" />
      <ElDivider content-position="left">我的复盘</ElDivider>
      <ElForm id="trade-note-form" ref="formRef" :model="form" :rules="rules" label-position="top" :disabled="saving" @submit.prevent="save">
        <ElFormItem label="交易策略" prop="strategy"><ElInput v-model="form.strategy" maxlength="120" show-word-limit placeholder="例如：趋势回调、突破交易" /></ElFormItem>
        <ElFormItem label="执行评分" prop="rating"><ElRate v-model="form.rating" clearable aria-label="执行评分" /><span class="muted rating-hint">{{ form.rating ? `${form.rating} / 5` : '暂未评分' }} · 评价执行质量，而非盈亏结果</span></ElFormItem>
        <ElFormItem label="交易标签" prop="tagsText"><ElInput v-model="form.tagsText" placeholder="例如：顺势、提前离场（逗号分隔）" /><span class="muted field-hint">最多 20 个标签，每个不超过 40 字。</span></ElFormItem>
        <ElFormItem label="复盘笔记" prop="content"><ElInput v-model="form.content" type="textarea" :autosize="{ minRows: 7, maxRows: 16 }" maxlength="10000" show-word-limit placeholder="入场的依据是什么？&#10;是否遵守交易计划？&#10;哪些地方做得好，下次如何改进？" /></ElFormItem>
      </ElForm>
      <ElAlert v-if="saveError" :title="saveError" type="error" show-icon :closable="false" />
      <p v-if="selected.note?.updatedAt" class="muted note-meta">上次保存 {{ new Date(selected.note.updatedAt).toLocaleString('zh-CN', { hour12: false }) }}</p>
      <p class="muted note-meta">来源：{{ selected.sourceFile }}</p>
    </template>
    <template #footer><ElButton :disabled="saving" @click="closeDrawer">关闭</ElButton><ElButton type="primary" :loading="saving" @click="save">保存复盘</ElButton></template>
  </ElDrawer>
</template>

<style scoped>
.trade-heading { display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 16px; margin-bottom: 22px; }
.trade-heading h2 { display: flex; align-items: center; gap: 10px; margin: 0 0 6px; font-size: 24px; }
.trade-profit { display: flex; flex-direction: column; gap: 5px; }
.trade-profit strong { font-size: 26px; }
.trade-profit span, .rating-hint, .field-hint, .note-meta { font-size: 12px; }
.trade-description { overflow-wrap: anywhere; }
.trade-description :deep(.el-descriptions__label) { width: 145px; }
.broker-comment { margin-top: 16px; }
.field-hint { display: block; width: 100%; }
.rating-hint { margin-left: 12px; }
.note-meta { overflow-wrap: anywhere; }
@media (max-width: 480px) { .trade-description :deep(.el-descriptions__label) { width: 112px; } .rating-hint { margin-left: 0; width: 100%; } }
</style>
