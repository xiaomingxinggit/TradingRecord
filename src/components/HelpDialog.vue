<script setup lang="ts">
import { ref } from 'vue'
import { ElAlert, ElButton, ElCollapse, ElCollapseItem, ElDescriptions, ElDescriptionsItem, ElDialog, ElText } from 'element-plus'
import { useWorkspace } from '../composables/useWorkspace'

const { help } = useWorkspace()
const sections = ref(['import', 'numbers'])
</script>

<template>
  <ElDialog v-model="help" title="使用说明与统计口径" width="min(780px, calc(100vw - 32px))" top="6vh">
    <ElCollapse v-model="sections">
      <ElCollapseItem title="从 MT5 导入报告" name="import">
        <div class="page-stack">
          <ElText>在 MT5 的历史中选择所需时间范围，导出包含“持仓 / Positions”明细与账户信息的完整 HTML 或 Excel 报告。将报告放入项目根目录后扫描导入，或通过“导入交易”选择 / 拖放文件，再点击“开始导入”。</ElText>
          <ElDescriptions :column="1" border>
            <ElDescriptionsItem label="支持格式">HTML、HTM、XLSX；常见中英文表头、UTF-8 / UTF-16 编码。</ElDescriptionsItem>
            <ElDescriptionsItem label="上传限制">每个文件最大 20 MB，单次最多 10 个文件。</ElDescriptionsItem>
            <ElDescriptionsItem label="根目录扫描">只读取项目根目录当前一层，忽略 index.html 和其他不支持的文件。</ElDescriptionsItem>
          </ElDescriptions>
          <ElAlert title="请保留原始报告。上传文件在解析后不会另存原始副本；仅含成交 / 订单的报告、XLS、CSV、截图和自定义表格不作为持仓报告导入。" type="info" show-icon :closable="false" />
        </div>
      </ElCollapseItem>
      <ElCollapseItem title="每笔持仓只记录一次" name="duplicates">
        <div class="page-stack">
          <ElText>按账户与持仓标识去重。订单、成交与持仓不会重复计数。HTML 和 XLSX 包含相同交易时仅保留一份，重复导入始终保留已有复盘笔记。</ElText>
          <ElText>同一笔未平仓记录可在开仓身份字段一致时补全平仓信息；已平仓记录不会被旧的未平仓报告覆盖。其他核心字段冲突保留现有数据并提示核对。“已存在”笔数包含完全重复与因冲突保留的记录，可在导入历史中展开查看。</ElText>
          <ElText>同一账户编号若具有不同的非空服务器或币种，整份报告会被拒绝。报告汇总与明细不一致、额外费用无法分配到持仓等情况会提示核对，系统不会自行制造交易或分摊费用。</ElText>
        </div>
      </ElCollapseItem>
      <ElCollapseItem title="理解数字与统计范围" name="numbers">
        <ElDescriptions :column="1" border>
          <ElDescriptionsItem label="统计范围">仅已平仓交易参与盈亏统计；各账户分别计算，金额使用该账户币种。</ElDescriptionsItem>
          <ElDescriptionsItem label="净盈亏">盈利 + 手续费 + 库存费 + 其他费用，费用保留报表原有正负号。</ElDescriptionsItem>
          <ElDescriptionsItem label="胜率">净盈利笔数 ÷ 已平仓笔数；净盈亏为 0 的交易计入分母。</ElDescriptionsItem>
          <ElDescriptionsItem label="盈利因子">净盈利总额 ÷ 净亏损总额的绝对值。</ElDescriptionsItem>
          <ElDescriptionsItem label="最大回撤">所选交易按平仓时间排列，累计净盈亏曲线从高点到后续低点的最大金额差。不包含入金、出金，也不代表持仓期间的浮动回撤。</ElDescriptionsItem>
          <ElDescriptionsItem label="资金流水">入金与出金单独展示，不计入交易笔数、胜率或交易盈亏。</ElDescriptionsItem>
        </ElDescriptions>
      </ElCollapseItem>
      <ElCollapseItem title="时间筛选与盈亏日历" name="time">
        <div class="page-stack">
          <ElText>已平仓交易的日期筛选与日历均按平仓日期；列表中的未平仓记录使用开仓日期筛选。时间保留 MT5 经纪商报表原值，不推断或转换时区。</ElText>
          <ElText>“近 7 天 / 近 30 天”以当前账户最后一笔交易日期为终点，便于查看历史报告。日历按当前账户与所选月份汇总已平仓交易，点击有交易的日期可查看当天记录。</ElText>
        </div>
      </ElCollapseItem>
      <ElCollapseItem title="交易复盘与开仓计划" name="notes">
        <div class="page-stack">
          <ElText>点击交易记录打开详情，填写交易策略、标签、执行评分和复盘笔记，再点击保存。执行评分 0—5，0 表示未评分；标签用英文或中文逗号分隔，最多 20 个，每个不超过 40 字；笔记最多 10000 字。</ElText>
          <ElText>“开仓计划”用于真实开仓前记录截图与简短分析，无导入账户也能新建。草稿允许不完整；待执行至少需要品种、方向、分析周期与入场理由。行情截图支持粘贴或上传 PNG、JPEG、WEBP，每张不超过 5 MB、每个计划最多 4 张，点击图片可放大。</ElText>
          <ElText>计划价位可留空，填写时须为正数并符合做多 / 做空的价位关系。三项价格完整且关系正确时展示按价格距离计算的计划收益 / 风险倍数，未计交易成本。</ElText>
          <ElAlert title="计划使用自身创建与更新时间，独立保存，不计入真实成交笔数、盈亏或日历统计，也不会连接行情或执行下单。" type="info" show-icon :closable="false" />
        </div>
      </ElCollapseItem>
      <ElCollapseItem title="本地保存、导出与完整备份" name="backup">
        <div class="page-stack">
          <ElDescriptions :column="1" border>
            <ElDescriptionsItem label="本地数据库">项目目录下的 data/trading.sqlite 保存账户、交易、资金流水、导入历史、复盘笔记及开仓计划。计划截图以 BLOB 保存在同一数据库中。</ElDescriptionsItem>
            <ElDescriptionsItem label="CSV 导出">“导出全部记录”下载包含复盘的全部账户、全部交易，不受页面筛选影响。CSV 不包含开仓计划与截图，也不能用于完整恢复数据库。</ElDescriptionsItem>
            <ElDescriptionsItem label="备份方法">先停止所有使用数据库的服务，再将整个 data 文件夹复制到独立位置，同时按需保留原始 MT5 报告。恢复前同样先停止服务并备份当前 data，再放回备份文件夹。</ElDescriptionsItem>
          </ElDescriptions>
          <ElAlert title="SQLite 运行时可能产生 WAL / SHM 文件。服务运行中只复制主数据库可能漏掉尚未合并的写入，请停服后复制整个 data 文件夹。" type="info" show-icon :closable="false" />
          <ElText>数据不依赖浏览器缓存，刷新页面或重新启动服务后仍会保留。复盘与计划编辑后需点击保存。</ElText>
        </div>
      </ElCollapseItem>
    </ElCollapse>
    <template #footer><ElButton type="primary" @click="help = false">明白了</ElButton></template>
  </ElDialog>
</template>
