<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { ElAlert, ElButton, ElCard, ElEmpty, ElForm, ElFormItem, ElInput, ElInputNumber, ElOption, ElSelect, ElTag } from 'element-plus'

interface Position { positionId: string; ticket: string; symbol: string; side: string; entryPrice: number | null; source?: { broker?: string; server?: string; accountNumber?: string } | null }
interface Entry { id: string; requestId: string; recordTime: string; entryPrice: number | null; stopLoss: number | null; takeProfit: number | null; reason: string }
interface Group { id: string; origin: 'mt5' | 'manual'; manualTicket: string; sourceSnapshot: Position | null; entries: Entry[] }
interface Journal { version: 1; groups: Group[] }

const props = defineProps<{ planId: string; disabled?: boolean }>()
const journal = ref<Journal>({ version: 1, groups: [] }); const positions = ref<Position[]>([]); const loading = ref(false); const saving = ref(false); const error = ref('')
const selectedGroup = ref(''); const positionId = ref(''); const manualTicket = ref(''); const entryPrice = ref<number>(); const stopLoss = ref<number>(); const takeProfit = ref<number>(); const reason = ref('')
const showForm = ref(false)
function reset() { selectedGroup.value = ''; positionId.value = ''; manualTicket.value = ''; entryPrice.value = undefined; stopLoss.value = undefined; takeProfit.value = undefined; reason.value = '' }
function time(value: string) { return new Date(value).toLocaleString('zh-CN', { hour12: false }) }
async function load() { loading.value = true; error.value = ''; try { const r = await fetch(`/api/plans/${encodeURIComponent(props.planId)}/adjustments`); const data = await r.json(); if (!r.ok) throw new Error(data.error); journal.value = data.journal; positions.value = data.positions } catch (e) { error.value = (e as Error).message } finally { loading.value = false } }
async function append() { saving.value = true; error.value = ''; try { const r = await fetch(`/api/plans/${encodeURIComponent(props.planId)}/adjustments`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ requestId: crypto.randomUUID(), groupId: selectedGroup.value || undefined, positionId: positionId.value || undefined, manualTicket: manualTicket.value || undefined, entryPrice: entryPrice.value ?? null, stopLoss: stopLoss.value ?? null, takeProfit: takeProfit.value ?? null, reason: reason.value }) }); const data = await r.json(); if (!r.ok) throw new Error(data.error); journal.value = data.journal; reset(); showForm.value = false } catch (e) { error.value = (e as Error).message } finally { saving.value = false } }
async function bindSelected() { if (!selectedGroup.value || !positionId.value) return; saving.value = true; error.value = ''; try { const r = await fetch(`/api/plans/${encodeURIComponent(props.planId)}/adjustments/bind`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ requestId: crypto.randomUUID(), groupId: selectedGroup.value, positionId: positionId.value }) }); const data = await r.json(); if (!r.ok) throw new Error(data.error); journal.value = data.journal; reset(); showForm.value = false } catch (e) { error.value = (e as Error).message } finally { saving.value = false } }
onMounted(load)
</script>

<template>
  <ElCard shadow="never" class="plan-adjustments">
    <template #header><div class="plan-card-heading"><h2>持仓调整记录</h2><ElButton size="small" type="primary" :disabled="disabled || loading" @click="showForm = !showForm; reset()">{{ showForm ? '取消' : '追加记录' }}</ElButton></div></template>
    <ElAlert v-if="error" :title="error" type="error" :closable="false" show-icon />
    <ElForm v-if="showForm" label-position="top" :disabled="saving" @submit.prevent="append">
      <ElFormItem label="记录来源"><ElSelect v-model="selectedGroup" placeholder="新建记录组或选择已有组" clearable><ElOption v-for="group in journal.groups" :key="group.id" :label="group.origin === 'mt5' ? `MT5 · ${group.sourceSnapshot?.ticket || ''}` : `手动 · ${group.manualTicket || '未填写编号'}`" :value="group.id"/></ElSelect></ElFormItem>
      <ElFormItem v-if="!selectedGroup" label="关联当前已导入持仓或手动编号"><ElSelect v-model="positionId" placeholder="已关联 MT5 持仓（无法识别编号时手填）" clearable><ElOption v-for="position in positions" :key="position.positionId" :label="`${position.ticket} · ${position.symbol} · ${position.source?.broker || '来源未知'}`" :value="position.positionId"/></ElSelect><ElInput v-model="manualTicket" placeholder="手动记录组编号（可选；不用于自动合并）" style="margin-top:8px"/></ElFormItem>
      <div class="plan-three-columns"><ElFormItem label="参考入场价"><ElInputNumber v-model="entryPrice" :controls="false"/></ElFormItem><ElFormItem label="本次止损"><ElInputNumber v-model="stopLoss" :controls="false"/></ElFormItem><ElFormItem label="本次止盈"><ElInputNumber v-model="takeProfit" :controls="false"/></ElFormItem></div>
      <ElFormItem label="调整原因"><ElInput v-model="reason" maxlength="2000" type="textarea" :rows="2" placeholder="可选，例如移动到保本或锁定利润"/></ElFormItem>
      <ElButton type="primary" native-type="submit" :loading="saving">保存调整</ElButton><ElButton v-if="selectedGroup && positionId" :loading="saving" @click="bindSelected">将手动组绑定到所选持仓</ElButton>
    </ElForm>
    <ElEmpty v-if="!loading && !journal.groups.length" description="还没有持仓调整记录" />
    <div v-for="group in journal.groups" :key="group.id" class="adjustment-group"><div><ElTag size="small">{{ group.origin === 'mt5' ? `MT5 持仓 ${group.sourceSnapshot?.ticket}` : `手动组 ${group.manualTicket || group.id.slice(0, 8)}` }}</ElTag><span class="adjustment-source">{{ group.sourceSnapshot?.symbol || '未绑定实盘持仓' }}</span></div><div v-for="entry in group.entries" :key="entry.id" class="adjustment-entry"><time>{{ time(entry.recordTime) }}</time><span>入场参考 {{ entry.entryPrice ?? '—' }}</span><span>止损 {{ entry.stopLoss ?? '—' }}</span><span>止盈 {{ entry.takeProfit ?? '—' }}</span><span v-if="entry.reason">{{ entry.reason }}</span></div></div>
  </ElCard>
</template>
