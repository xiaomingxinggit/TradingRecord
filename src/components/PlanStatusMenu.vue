<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { ElDropdown, ElDropdownItem, ElDropdownMenu, ElTag } from 'element-plus'
import type { DropdownInstance } from 'element-plus'
import { ChevronDown, LoaderCircle } from 'lucide-vue-next'
import { planStatusOptions, statusInfo, type PlanStatus } from '../plan-status'

const props = defineProps<{ status: PlanStatus; disabled?: boolean; loading?: boolean }>()
const emit = defineEmits<{ change: [status: PlanStatus] }>()
const dropdownRef = ref<DropdownInstance>(), triggerRef = ref<HTMLButtonElement>(), menuOpen = ref(false)
const current = computed(() => statusInfo(props.status))
const options = computed(() => planStatusOptions.filter(item => item.value !== props.status))
const blocked = computed(() => props.disabled || props.loading)

function closeMenu() { dropdownRef.value?.handleClose() }
function closeAndFocus() {
  closeMenu()
  if (!blocked.value) triggerRef.value?.focus({ preventScroll: true })
}
function selectStatus(status: PlanStatus) {
  closeMenu()
  if (!blocked.value && status !== props.status) emit('change', status)
}
// Close any open popup before refreshed data or an in-flight action replaces it.
watch([() => props.status, blocked], closeMenu)
</script>

<template>
  <span class="plan-status-picker" @click.stop>
    <ElDropdown ref="dropdownRef" trigger="click" placement="bottom" :disabled="blocked" :persistent="false" @command="selectStatus" @visible-change="menuOpen = $event">
      <button ref="triggerRef" type="button" class="plan-status-trigger" :disabled="blocked" :aria-label="`更改状态，当前${current.label}`" aria-haspopup="menu" :aria-expanded="menuOpen" :aria-busy="!!loading" :title="loading ? '正在更新状态' : '点击更改状态'" @keydown.esc.stop.prevent="closeAndFocus">
        <ElTag :type="current.tagType" round><span class="plan-status-tag-content">{{ current.label }}<LoaderCircle v-if="loading" :size="12" class="plan-status-spinner" aria-hidden="true"/><ChevronDown v-else :size="12" aria-hidden="true"/></span></ElTag>
      </button>
      <template #dropdown>
        <ElDropdownMenu @click.stop @keydown.esc.stop.prevent="closeAndFocus">
          <ElDropdownItem v-for="item in options" :key="item.value" :command="item.value" :text-value="item.label" :aria-label="`设为${item.label}`" :disabled="blocked" class="plan-status-option"><ElTag :type="item.tagType" round>{{ item.label }}</ElTag></ElDropdownItem>
        </ElDropdownMenu>
      </template>
    </ElDropdown>
  </span>
</template>

<style scoped>
.plan-status-picker { display: inline-flex; vertical-align: middle; }
.plan-status-trigger { display: inline-flex; padding: 0; border: 0; border-radius: 999px; background: transparent; font: inherit; cursor: pointer; }
.plan-status-trigger:hover:not(:disabled) :deep(.el-tag) { box-shadow: 0 0 0 2px var(--el-color-primary-light-8); }
.plan-status-trigger:focus-visible { outline: 2px solid var(--el-color-primary); outline-offset: 3px; }
.plan-status-trigger:disabled { cursor: wait; opacity: .65; }
.plan-status-tag-content { display: inline-flex; align-items: center; gap: 4px; }
.plan-status-option { justify-content: center; padding: 7px 14px; }
.plan-status-spinner { animation: plan-status-spin 1s linear infinite; }
@keyframes plan-status-spin { to { transform: rotate(360deg); } }
</style>
