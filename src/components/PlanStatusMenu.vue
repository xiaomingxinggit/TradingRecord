<script setup lang="ts">
import { ElButton, ElDropdown, ElDropdownItem, ElDropdownMenu } from 'element-plus'
import { ChevronDown } from 'lucide-vue-next'
import { planStatusOptions, type PlanStatus } from '../plan-status'

defineProps<{ status: PlanStatus; disabled?: boolean; loading?: boolean }>()
const emit = defineEmits<{ change: [status: PlanStatus] }>()
</script>

<template>
  <span @click.stop @keydown.stop>
    <ElDropdown trigger="click" :disabled="disabled" @command="(status: PlanStatus) => emit('change', status)">
      <ElButton type="primary" link :disabled="disabled" :loading="loading" @click.stop>更改状态<ChevronDown :size="13"/></ElButton>
      <template #dropdown>
        <ElDropdownMenu><ElDropdownItem v-for="item in planStatusOptions" :key="item.value" :command="item.value" :disabled="disabled || item.value === status">{{ item.label }}</ElDropdownItem></ElDropdownMenu>
      </template>
    </ElDropdown>
  </span>
</template>
