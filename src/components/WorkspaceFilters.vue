<script setup lang="ts">
import { ElDatePicker, ElForm, ElFormItem, ElOption, ElSelect, ElSpace, ElTag, ElText } from 'element-plus'
import { useWorkspace } from '../composables/useWorkspace'

const { page, data, accountId, account, currency, period, startDate, endDate, dateLabel } = useWorkspace()
function dateOnly(value: Date) { return `${value.getFullYear()}-${String(value.getMonth()+1).padStart(2,'0')}-${String(value.getDate()).padStart(2,'0')}` }
const startDisabled = (value: Date) => !!endDate.value && dateOnly(value) > endDate.value
const endDisabled = (value: Date) => !!startDate.value && dateOnly(value) < startDate.value
</script>

<template>
  <ElForm inline class="workspace-filters" label-position="left">
    <ElFormItem label="交易账户">
      <ElSpace><ElSelect v-model="accountId" aria-label="选择交易账户" class="account-select" :disabled="!data.accounts.length" placeholder="尚未导入账户"><ElOption v-for="item in data.accounts" :key="item.id" :value="item.id" :label="`${item.name} · ${item.id}`"/></ElSelect><ElTag type="info" size="small">{{ currency }}</ElTag></ElSpace>
    </ElFormItem>
    <template v-if="page !== 'calendar' && page !== 'imports'">
      <ElFormItem label="日期范围"><ElSelect v-model="period" aria-label="统计日期范围" class="period-select"><ElOption label="全部时间" value="all"/><ElOption label="最近 7 天（截至最新交易）" value="7"/><ElOption label="最近 30 天（截至最新交易）" value="30"/><ElOption label="自定义日期" value="custom"/></ElSelect></ElFormItem>
      <ElFormItem v-if="period === 'custom'" class="custom-dates"><ElDatePicker v-model="startDate" type="date" value-format="YYYY-MM-DD" placeholder="开始日期" aria-label="开始日期" :editable="false" :disabled-date="startDisabled"/><ElText type="info">至</ElText><ElDatePicker v-model="endDate" type="date" value-format="YYYY-MM-DD" placeholder="结束日期" aria-label="结束日期" :editable="false" :disabled-date="endDisabled"/></ElFormItem>
      <ElText v-else type="info" size="small">{{ dateLabel }}</ElText>
    </template>
    <ElText v-else type="info" size="small">{{ account?.broker || '支持 MT5 历史报告' }}</ElText>
  </ElForm>
</template>

<style scoped>
.workspace-filters{display:flex;align-items:center;gap:12px 20px;flex-wrap:wrap;margin-bottom:24px}
.workspace-filters .el-form-item{margin:0;max-width:100%}
.account-select{width:220px}.period-select{width:230px}
.custom-dates :deep(.el-form-item__content){gap:8px;flex-wrap:wrap}.custom-dates :deep(.el-date-editor){width:150px}
@media(max-width:600px){.workspace-filters{align-items:flex-start;gap:12px}.workspace-filters .el-form-item{width:100%}.account-select{width:205px}.workspace-filters :deep(.el-range-editor){width:100%;max-width:100%}.workspace-filters :deep(.el-form-item__content){min-width:0}}
</style>
