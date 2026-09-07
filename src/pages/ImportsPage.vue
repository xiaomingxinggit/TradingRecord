<script setup lang="ts">
import { ElAlert, ElButton, ElCard, ElCol, ElDescriptions, ElDescriptionsItem, ElEmpty, ElRow, ElTable, ElTableColumn, ElTag, ElText } from 'element-plus'
import { RefreshCw } from 'lucide-vue-next'
import ReportUpload from '../components/ReportUpload.vue'
import { useWorkspace } from '../composables/useWorkspace'

const { data, account, currency, cashflows, deposits, withdrawals, topSymbols, busy, money, importFiles } = useWorkspace()
function time(value: string) { return new Date(value).toLocaleString('zh-CN', { hour12: false }) }
</script>

<template>
  <div class="page-stack">
    <ElRow :gutter="20" class="import-columns">
      <ElCol :xs="24" :lg="12">
        <ElCard shadow="never">
          <template #header>
            <div class="section-heading"><h2>导入 MT5 历史报告</h2></div>
            <ElText type="info">选择报告后，点击开始导入</ElText>
          </template>
          <ReportUpload />
        </ElCard>
      </ElCol>
      <ElCol :xs="24" :lg="12">
        <ElCard shadow="never">
          <template #header>
            <div class="section-heading"><h2>项目根目录</h2></div>
            <ElText type="info">直接读取当前目录中的 MT5 报告</ElText>
          </template>
          <div class="page-stack">
            <ElTable :data="data.rootFiles" row-key="name" aria-label="根目录报告文件">
              <ElTableColumn prop="name" label="文件名" min-width="180" show-overflow-tooltip />
              <ElTableColumn label="大小" width="100" align="right">
                <template #default="{ row }"><span class="numeric">{{ (row.size / 1024).toFixed(1) }} KB</span></template>
              </ElTableColumn>
              <template #empty><ElEmpty description="将报告放入项目根目录，即可一键导入" :image-size="60" /></template>
            </ElTable>
            <ElButton :icon="RefreshCw" :loading="busy" :disabled="busy" @click="importFiles()">重新扫描并导入</ElButton>
            <ElAlert title="重复导入会保留已有复盘笔记；未平仓记录可补全平仓信息。" type="info" show-icon :closable="false" />
          </div>
        </ElCard>
      </ElCol>
    </ElRow>

    <ElCard shadow="never">
      <template #header>
        <div class="section-heading"><h2>导入历史 <ElTag type="info" round>{{ data.imports.length }}</ElTag></h2><ElText type="info">本地 SQLite 存储</ElText></div>
        <ElText type="info">展开一条记录查看该文件的解析与核对提示</ElText>
      </template>
      <ElTable :data="data.imports" row-key="id" aria-label="报告导入历史">
        <ElTableColumn type="expand" width="42">
          <template #default="{ row }">
            <div class="page-stack history-details">
              <ElAlert v-for="(warning, index) in row.warnings" :key="index" :title="warning" type="warning" show-icon :closable="false" />
              <ElText v-if="!row.warnings?.length" type="info">该文件没有额外核对提示。</ElText>
            </div>
          </template>
        </ElTableColumn>
        <ElTableColumn prop="filename" label="文件名" min-width="230" show-overflow-tooltip />
        <ElTableColumn label="导入时间" min-width="175"><template #default="{ row }">{{ time(row.importedAt) }}</template></ElTableColumn>
        <ElTableColumn prop="tradeCount" label="报告交易" width="95" align="right" />
        <ElTableColumn label="新增" width="75" align="right"><template #default="{ row }"><span class="positive numeric">+{{ row.addedCount }}</span></template></ElTableColumn>
        <ElTableColumn label="更新" width="75" align="right"><template #default="{ row }">{{ row.updatedCount ?? 0 }}</template></ElTableColumn>
        <ElTableColumn prop="duplicateCount" label="已存在" width="85" align="right" />
        <ElTableColumn label="状态" width="115"><template #default="{ row }"><ElTag :type="row.warnings?.length ? 'warning' : 'success'">{{ row.warnings?.length ? `需留意 · ${row.warnings.length}` : '已完成' }}</ElTag></template></ElTableColumn>
        <template #empty><ElEmpty description="导入第一份报告，开始记录交易" :image-size="70" /></template>
      </ElTable>
    </ElCard>

    <ElRow :gutter="20" class="import-columns">
      <ElCol :xs="24" :lg="12">
        <ElCard shadow="never">
          <template #header><div class="section-heading"><h2>账户信息</h2></div></template>
          <ElDescriptions :column="1" border>
            <ElDescriptionsItem label="交易账户">{{ account?.id || '—' }}</ElDescriptionsItem>
            <ElDescriptionsItem label="经纪商">{{ account?.broker || '—' }}</ElDescriptionsItem>
            <ElDescriptionsItem label="服务器">{{ account?.server || '—' }}</ElDescriptionsItem>
            <ElDescriptionsItem label="报告时间">{{ account?.reportDate || '—' }}</ElDescriptionsItem>
          </ElDescriptions>
        </ElCard>
      </ElCol>
      <ElCol :xs="24" :lg="12">
        <ElCard shadow="never">
          <template #header><div class="section-heading"><h2>资金流水</h2><ElTag type="info">不计入交易盈亏</ElTag></div></template>
          <ElDescriptions :column="1" border>
            <ElDescriptionsItem label="累计入金"><span class="positive numeric">{{ money(deposits) }} {{ currency }}</span></ElDescriptionsItem>
            <ElDescriptionsItem label="累计出金"><span class="numeric">{{ money(withdrawals) }} {{ currency }}</span></ElDescriptionsItem>
            <ElDescriptionsItem label="流水条数">{{ cashflows.length }} 条</ElDescriptionsItem>
            <ElDescriptionsItem label="交易品种">{{ topSymbols.map(item => item.symbol).join('、') || '—' }}</ElDescriptionsItem>
          </ElDescriptions>
        </ElCard>
      </ElCol>
    </ElRow>
  </div>
</template>

<style scoped>
.import-columns { row-gap: 20px; }
.import-columns .el-card { height: 100%; }
.history-details { padding: 16px 24px; }
</style>
