<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { ElButton, ElButtonGroup, ElCalendar, ElCard, ElCol, ElRow, ElStatistic } from 'element-plus'
import { useWorkspace } from '../composables/useWorkspace'

const { calendarMonth, calendarYear, calendarMonthNumber, monthStats, overall, latestDate, currency, money, changeMonth, selectDay } = useWorkspace()
const selectedDate = ref(new Date(`${calendarMonth.value || latestDate.value.slice(0, 7)}-01T12:00:00`))
const summaries = computed(() => new Map(overall.value.days.map(day => [day.date, day])))
const monthOf = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
const profitColor = (value: number) => ({ color: value >= 0 ? 'var(--el-color-success)' : 'var(--el-color-danger)' })
const signedMoney = (value: number) => money(value, true)

watch(calendarMonth, month => {
  if (month && month !== monthOf(selectedDate.value)) selectedDate.value = new Date(`${month}-01T12:00:00`)
}, { immediate: true })
watch(selectedDate, date => {
  const month = monthOf(date)
  if (month !== calendarMonth.value) calendarMonth.value = month
})
</script>

<template>
  <div class="page-stack">
    <ElRow :gutter="20" class="calendar-summary">
      <ElCol :xs="24" :sm="12" :lg="6"><ElCard shadow="never"><ElStatistic title="本月净盈亏" :value="monthStats.net" :formatter="signedMoney" :value-style="profitColor(monthStats.net)"><template #suffix><span class="metric-unit">{{ currency }}</span></template></ElStatistic></ElCard></ElCol>
      <ElCol :xs="24" :sm="12" :lg="6"><ElCard shadow="never"><ElStatistic title="交易天数" :value="monthStats.days.length" suffix="天" /></ElCard></ElCol>
      <ElCol :xs="24" :sm="12" :lg="6"><ElCard shadow="never"><ElStatistic title="交易笔数" :value="monthStats.closed.length" suffix="笔" /></ElCard></ElCol>
      <ElCol :xs="24" :sm="12" :lg="6"><ElCard shadow="never"><ElStatistic title="盈利天数" :value="monthStats.days.filter(day => day.profit > 0).length" suffix="天" /></ElCard></ElCol>
    </ElRow>

    <ElCard shadow="never">
      <template #header>
        <div class="section-heading calendar-heading">
          <h2>{{ calendarYear }} 年 {{ calendarMonthNumber }} 月</h2>
          <div class="calendar-actions">
            <ElButtonGroup><ElButton aria-label="上个月" @click="changeMonth(-1)">上个月</ElButton><ElButton aria-label="下个月" @click="changeMonth(1)">下个月</ElButton></ElButtonGroup>
            <ElButton type="primary" plain @click="calendarMonth = latestDate.slice(0, 7)">最新交易月</ElButton>
          </div>
        </div>
      </template>
      <p class="muted calendar-tip">按平仓日汇总 · 点击有交易的日期查看记录 · {{ currency }}</p>
      <div class="calendar-scroll">
        <ElCalendar v-model="selectedDate" class="profit-calendar">
          <template #header><span class="muted">月度交易表现</span></template>
          <template #date-cell="{ data: day }">
            <ElButton
              class="profit-day"
              :type="summaries.get(day.day) ? (summaries.get(day.day)!.profit > 0 ? 'success' : summaries.get(day.day)!.profit < 0 ? 'danger' : 'info') : 'default'"
              :plain="!!summaries.get(day.day)"
              :text="!summaries.get(day.day)"
              :disabled="day.type !== 'current-month' || !summaries.has(day.day)"
              :aria-label="`${day.day}${summaries.has(day.day) ? `，净盈亏 ${money(summaries.get(day.day)!.profit, true)} ${currency}，查看交易` : '，无交易'}`"
              @click.stop="selectDay(day.day)"
            >
              <span class="day-content">
                <span class="day-number">{{ Number(day.day.slice(-2)) }}</span>
                <template v-if="day.type === 'current-month' && summaries.has(day.day)">
                  <strong class="numeric">{{ money(summaries.get(day.day)!.profit, true) }}</strong>
                  <span>{{ summaries.get(day.day)!.count }} 笔交易</span>
                  <span>胜率 {{ (summaries.get(day.day)!.wins / summaries.get(day.day)!.count * 100).toFixed(0) }}%</span>
                </template>
              </span>
            </ElButton>
          </template>
        </ElCalendar>
      </div>
    </ElCard>
  </div>
</template>

<style scoped>
.calendar-summary { row-gap: 20px; }
.calendar-summary :deep(.el-card) { height: 100%; }
.metric-unit { font-size: 13px; color: var(--el-text-color-secondary); }
.calendar-heading, .calendar-actions { flex-wrap: wrap; gap: 12px; }
.calendar-actions { display: flex; align-items: center; }
.calendar-tip { margin: 0 0 12px; font-size: 13px; }
.calendar-scroll { overflow-x: auto; }
.profit-calendar { min-width: 730px; --el-calendar-cell-width: 136px; }
.profit-calendar :deep(.el-calendar__body) { padding: 0; }
.profit-calendar :deep(.el-calendar__header) { padding: 0 0 16px; }
.profit-calendar :deep(.el-calendar-day) { padding: 5px; }
.profit-day { width: 100%; height: 100%; padding: 10px; }
.profit-day :deep(> span) { width: 100%; height: 100%; }
.day-content { display: flex; flex-direction: column; align-items: flex-start; gap: 8px; font-size: 12px; }
.day-number { font-size: 14px; }
.day-content strong { font-size: 16px; }
</style>
