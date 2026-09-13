<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { ElAlert, ElButton, ElCard, ElTag } from 'element-plus'
import { ArrowRight } from 'lucide-vue-next'
import { request } from '../reviews/api'
import { reviewLabel, type ReviewDetailData } from '../reviews/types'
const props = defineProps<{ planId: string; disabled?: boolean }>()
const emit = defineEmits<{ open: [planId: string] }>()
const data = ref<ReviewDetailData | null>(null), loading = ref(true), error = ref('')
async function load() { loading.value = true; error.value = ''; try { data.value = await request<ReviewDetailData>(`/api/reviews/plans/${encodeURIComponent(props.planId)}`) } catch (e) { error.value = (e as Error).message } finally { loading.value = false } }
onMounted(load)
</script>
<template>
  <ElCard shadow="never" class="plan-review-entry"><template #header><div class="plan-section-title"><h2>实际交易与复盘</h2><ElTag v-if="data?.positions.length" :type="data.review.state === 'completed' ? 'success' : 'warning'">{{ reviewLabel(data.review.state) }}</ElTag></div></template><ElAlert v-if="error" :title="error" type="error" :closable="false"/><p>{{ loading ? '正在读取关联资料…' : data?.positions.length ? `已关联 ${data.positions.length} 个独立持仓，可核对执行情况并编辑复盘。` : '尚未关联持仓。导入 MT5 报告后，在交易复盘中手动关联本计划。' }}</p><ElButton v-if="error" :disabled="disabled || loading" @click="load">重新读取</ElButton><ElButton type="primary" plain :disabled="disabled || loading" @click="emit('open', planId)">查看交易复盘<ArrowRight :size="15"/></ElButton></ElCard>
</template>
