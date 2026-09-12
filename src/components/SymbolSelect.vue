<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import { ElOption, ElSelect } from 'element-plus'
import { commonSymbols } from '../symbols'

const props = defineProps<{ modelValue: string; disabled?: boolean }>()
const emit = defineEmits<{ 'update:modelValue': [value: string]; 'pending-change': [query: string | null] }>()
const rootRef = ref<HTMLElement>(), query = ref(''), pending = ref<string | null>(null), expanded = ref(false)
let confirmingWithKeyboard = false
const search = computed(() => query.value.trim().toLowerCase())
const options = computed(() => commonSymbols.filter(item => `${item.code} · ${item.name}`.toLowerCase().includes(search.value)))
// A recognized code/name chooses the real option, rather than creating its label.
const allowCreate = computed(() => !!search.value && !options.value.some(item =>
  item.code.toLowerCase() === search.value || item.name.includes(search.value)
  || `${item.code} · ${item.name}`.toLowerCase() === search.value))

function setPending(value: string | null) { pending.value = value; emit('pending-change', value) }
function clearPending() { setPending(null) }
function selectValue(value: unknown) {
  clearPending()
  emit('update:modelValue', typeof value === 'string' ? value : '')
}
function inputChanged(event: Event) {
  if (props.disabled || !(event.target instanceof HTMLInputElement)) return
  confirmingWithKeyboard = false
  setPending(event.target.value.trim() ? event.target.value : null)
}
function keyPressed(event: KeyboardEvent) {
  if (props.disabled || event.isComposing || event.keyCode === 229) return
  if (event.key === 'Escape') { confirmingWithKeyboard = false; clearPending(); query.value = '' }
  // ElSelect handles the highlighted option, including same-value selections,
  // which do not emit update:modelValue. Only its completed selection closes it.
  if (event.key === 'Enter' && expanded.value) confirmingWithKeyboard = true
}
function visibilityChanged(visible: boolean) {
  expanded.value = visible
  if (!visible && (confirmingWithKeyboard || pending.value?.trim() === props.modelValue)) {
    clearPending(); confirmingWithKeyboard = false
  }
  // ElSelect clears search text on close. Restore an unconfirmed draft when
  // reopened, using the native input path so filtering/creation stay in sync.
  if (visible && pending.value !== null) void nextTick(() => {
    if (!expanded.value || pending.value === null || props.disabled) return
    const input = rootRef.value?.querySelector('input')
    if (input && input.value !== pending.value) {
      input.value = pending.value
      input.dispatchEvent(new Event('input', { bubbles: true }))
    }
  })
}
watch(() => props.modelValue, clearPending)
onMounted(() => {
  // ElSelect has no maxlength prop; constrain its native search input too.
  const input = rootRef.value?.querySelector('input')
  if (input) input.maxLength = 40
})
</script>

<template>
  <div ref="rootRef" class="symbol-select" @input.capture="inputChanged" @keydown.capture="keyPressed" @keydown.enter.stop.prevent @keyup.enter="confirmingWithKeyboard = false">
    <ElSelect id="plan-symbol" :model-value="modelValue" filterable :allow-create="allowCreate" default-first-option clearable :value-on-clear="''" :disabled="disabled" :filter-method="value => query = value" placeholder="输入代码或中文名称" aria-label="交易品种" @update:model-value="selectValue" @clear="clearPending" @visible-change="visibilityChanged">
      <ElOption v-for="item in options" :key="item.code" :value="item.code" :label="item.code" @click="clearPending"><span class="symbol-option-code">{{ item.code }}</span><span class="symbol-option-name"> · {{ item.name }}</span></ElOption>
      <template #footer><span class="symbol-select-help">选择候选或按 Enter 确认代码；Esc 取消输入。候选仅供记录，经纪商代码可能不同。</span></template>
    </ElSelect>
    <p v-if="pending !== null" class="symbol-select-pending">待确认：{{ pending }}。请选择候选或按 Enter 确认。</p>
  </div>
</template>

<style scoped>
.symbol-select { width: 100%; min-width: 0; }
.symbol-option-code { font-weight: 500; }
.symbol-option-name,.symbol-select-help { color: var(--el-text-color-secondary); font-size: 12px; }
.symbol-select-help { display: block; max-width: 290px; line-height: 1.7; white-space: normal; }
.symbol-select-pending { margin: 6px 0 0; color: var(--el-color-warning-dark-2); font-size: 11px; line-height: 1.6; overflow-wrap: anywhere; }
</style>
