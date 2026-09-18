<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { ElPopover, ElSegmented, ElTag } from 'element-plus'
import type { PopoverInstance } from 'element-plus'
import { Check, ChevronDown, LoaderCircle } from 'lucide-vue-next'
import { planStatusOptions, statusInfo, type PlanStatus } from '../plan-status'

const props = defineProps<{ status: PlanStatus; disabled?: boolean; loading?: boolean }>()
const emit = defineEmits<{ change: [status: PlanStatus] }>()
const popoverRef = ref<PopoverInstance>(), triggerRef = ref<HTMLButtonElement>(), choicesRef = ref<HTMLElement>()
const menuOpen = ref(false), selectionCycle = ref(0)
const current = computed(() => statusInfo(props.status))
const blocked = computed(() => !!(props.disabled || props.loading))
const popoverStyle = { padding: '6px', minWidth: '0', maxWidth: 'calc(100vw - 16px)', borderRadius: '9px', boxShadow: 'var(--app-status-shadow)' }
const popperOptions = { modifiers: [
  { name: 'preventOverflow', options: { padding: 8, rootBoundary: 'viewport', tether: false } },
  { name: 'flip', options: { padding: 8 } },
] }

function openMenu() { menuOpen.value = true; selectionCycle.value += 1 }
function closeMenu() { menuOpen.value = false; popoverRef.value?.hide() }
function closeAndFocus() {
  closeMenu()
  if (!blocked.value) triggerRef.value?.focus({ preventScroll: true })
}
function focusSelection() {
  if (menuOpen.value && !blocked.value) choicesRef.value?.querySelector<HTMLInputElement>('input:checked')?.focus({ preventScroll: true })
}
function selectOnEnter(event: KeyboardEvent) {
  if (event.target instanceof HTMLInputElement && event.target.type === 'radio') event.target.click()
}
function selectStatus(value: string | number | boolean) {
  const option = planStatusOptions.find(item => item.value === value)
  if (!option || blocked.value || option.value === props.status) return
  closeMenu()
  emit('change', option.value)
}
// Close any open popup before refreshed data or an in-flight action replaces it.
watch([() => props.status, blocked], closeMenu)
</script>

<template>
  <span class="plan-status-picker" @click.stop>
    <ElPopover ref="popoverRef" trigger="click" placement="bottom" width="auto" role="dialog" aria-label="选择计划状态" :fallback-placements="['bottom-end', 'bottom-start', 'top']" :popper-options="popperOptions" :popper-style="popoverStyle" :disabled="blocked" :persistent="false" :show-after="0" :hide-after="0" @before-enter="openMenu" @before-leave="menuOpen = false" @after-enter="focusSelection">
      <template #reference>
        <button ref="triggerRef" type="button" class="plan-status-trigger" :disabled="blocked" :aria-label="`更改状态，当前${current.label}`" aria-haspopup="dialog" :aria-expanded="menuOpen" :aria-busy="!!loading" :title="loading ? '正在更新状态' : '点击更改状态'" @keydown.esc.stop.prevent="closeAndFocus">
          <ElTag :type="current.tagType" round><span class="plan-status-tag-content">{{ current.label }}<LoaderCircle v-if="loading" :size="12" class="plan-status-spinner" aria-hidden="true"/><ChevronDown v-else :size="12" aria-hidden="true"/></span></ElTag>
        </button>
      </template>
      <div ref="choicesRef" @click.stop @keydown.esc.stop.prevent="closeAndFocus" @keydown.enter.stop.prevent="selectOnEnter" @keydown.tab="closeMenu">
        <ElSegmented :key="selectionCycle" class="plan-status-strip" :model-value="status" :options="planStatusOptions" :disabled="blocked" :validate-event="false" aria-label="计划状态" @change="selectStatus">
          <template #default="{ item }"><span class="plan-status-option-label"><Check v-if="item.value === status" :size="12" :stroke-width="2.5" aria-hidden="true"/>{{ item.label }}</span></template>
        </ElSegmented>
      </div>
    </ElPopover>
  </span>
</template>

<style scoped>
.plan-status-picker { display: inline-flex; vertical-align: middle; }
.plan-status-trigger { display: inline-flex; padding: 0; border: 0; border-radius: 999px; background: transparent; font: inherit; cursor: pointer; }
.plan-status-trigger:hover:not(:disabled) :deep(.el-tag) { box-shadow: 0 0 0 2px var(--el-color-primary-light-8); }
.plan-status-trigger:focus-visible { outline: 2px solid var(--el-color-primary); outline-offset: 3px; }
.plan-status-trigger:disabled { cursor: wait; opacity: .65; }
.plan-status-tag-content { display: inline-flex; align-items: center; gap: 4px; }
.plan-status-strip { --el-segmented-bg-color: transparent; --el-segmented-padding: 0; --el-segmented-item-selected-color: var(--el-color-primary); --el-segmented-item-selected-bg-color: var(--el-color-primary-light-9); --el-segmented-item-hover-bg-color: var(--el-fill-color-light); --el-segmented-item-active-bg-color: var(--el-color-primary-light-9); font-size: 13px; }
.plan-status-strip :deep(.el-segmented__group) { gap: 2px; flex-wrap: wrap; }
.plan-status-strip :deep(.el-segmented__item) { flex: 0 0 auto; min-height: 34px; padding: 0 10px; }
.plan-status-strip :deep(.el-segmented__item-label) { overflow: visible; }
.plan-status-strip :deep(.el-segmented__item:has(input:focus-visible)) { outline: 2px solid var(--el-color-primary); outline-offset: -2px; }
.plan-status-option-label { display: inline-flex; align-items: center; gap: 4px; white-space: nowrap; }
.plan-status-spinner { animation: plan-status-spin 1s linear infinite; }
@keyframes plan-status-spin { to { transform: rotate(360deg); } }
</style>
