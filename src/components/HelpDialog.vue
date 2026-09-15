<script setup lang="ts">
import { ref } from 'vue'
import { ElAlert, ElButton, ElCollapse, ElCollapseItem, ElDialog, ElText } from 'element-plus'

const visible = defineModel<boolean>({ default: false })
const sections = ref(['plans'])
</script>

<template>
  <ElDialog v-model="visible" title="使用说明" width="min(680px, calc(100vw - 32px))" align-center>
    <ElCollapse v-model="sections">
      <ElCollapseItem title="记录开仓计划" name="plans">
        <div class="page-stack">
          <ElText>新建计划，填写品种、方向和分析周期，记下市场状态、关键结构与入场理由。保存草稿可稍后补全；标记待执行需填写品种、方向、分析周期和入场理由。</ElText>
          <ElText>品种默认 XAUUSD，可按代码或中文名称筛选常用候选，也支持 XAUUSDm 等自定义代码。选择候选或按 Enter 确认后再保存，Esc 取消本次输入；编辑时保留原品种。候选仅供记录，经纪商代码可能不同。</ElText>
          <ElText>行情截图支持粘贴或上传 PNG、JPEG、WEBP，每张不超过 5 MB、每份计划最多 4 张。点击可放大，编辑时可移除；保存计划时一并保存。</ElText>
          <ElText>计划入场价、止损价和止盈价均为选填，填写时须为正数且符合所选方向。三项价格完整且关系正确时，显示按价格距离计算的收益 / 风险倍数，未计交易成本。</ElText>
          <ElText>列表默认最新优先，点击“创建时间”表头可切换最早优先或最新优先，箭头显示当前方向。切换时会对全部计划排序并返回第一页；编辑计划不会改变创建时间。</ElText>
          <ElText>点击计划查看详情并继续编辑。已有计划通过“保存修改”保存分析与截图，保留当前状态；状态请在列表或只读详情中更改。未保存时返回列表会先确认，选择“继续编辑”或关闭确认框均会保留当前内容。</ElText>
        </div>
      </ElCollapseItem>
      <ElCollapseItem title="更改计划状态" name="status">
        <div class="page-stack">
          <ElText>直接点击列表或详情中的状态标签，横向选择条按固定顺序展示：草稿（想法未整理完）、待执行（等待入场条件）、已执行（已实际开仓，不代表已平仓）和已放弃（决定不执行）。当前状态用浅色背景和小勾标记，选择其他状态即可修改，也可改回纠正误操作。</ElText>
          <ElText>用 Tab 聚焦标签、Enter / Space 打开，选择条支持方向键或 Enter / Space 选择；点击外部或按 Esc 关闭。失败或取消放弃不会改变选中状态。</ElText>
          <ElText>待执行与已执行至少需要品种、方向、分析周期和入场理由；内容不完整时，请先编辑补齐。草稿和已放弃允许内容不完整，填写的价格仍须符合原有校验。</ElText>
          <ElText>标记已放弃时可填写原因，最多 2000 字。取消不修改状态；改回其他状态后，原因作为“上次放弃原因”保留，再次放弃时可编辑或清空。</ElText>
          <ElText>只有实际切换状态才记录服务端的状态变更时间。新计划首次切换前、以及缺少此信息的历史计划显示“未记录”；普通内容保存或重复同状态不刷新此时间。</ElText>
        </div>
      </ElCollapseItem>
      <ElCollapseItem title="关联交易与复盘" name="reviews">
        <div class="page-stack">
          <ElText>进入“交易复盘”，手动导入 MT5 完整历史报告（HTML、HTM、XLSX，单份不超过 25 MB）。仅支持报告中注明 Hedge / 对冲模式、具备公司、服务器、账户编号、币种及报告日期的独立持仓。不会扫描根目录或自动导入。</ElText>
          <ElText>待关联交易支持品种、来源账户、开仓日期筛选。选择一个或多个持仓，手动选择原计划，并为每个持仓填写用途和备注；一个计划可以关联多个持仓，同一持仓只能关联一个计划。在详情中可修改用途、明确解除或更换关联。</ElText>
          <ElText>看板按全部账户统计待关联持仓、待复盘计划、已复盘计划；有持仓关联的计划才进入复盘队列。在复盘详情中核对原计划与实际执行，填写“做得好的地方”或“下次改进”后即可完成；也可先保存草稿。</ElText>
          <ElText>重复导入保留关联和总结。较新报告的实际结果更新、追加或解除关联后，已完成复盘标记“有更新待补充”，原文字保留。计划的草稿、待执行、已执行、已放弃状态不会随交易或复盘自动改变。</ElText>
          <ElAlert title="金额按账户及币种分别统计。未平仓、不完整记录不计入已实现净额，资金流水不算交易利润。报告止损 / 止盈不代表最初设置。分拆或重复持仓行、净额持仓及仅有订单 / 成交的报告不会猜测重建；独立未平仓分区暂不导入。" type="info" show-icon :closable="false"/>
        </div>
      </ElCollapseItem>
      <ElCollapseItem title="模拟练习：手工记录与统计" name="practice">
        <div class="page-stack">
          <ElText>在外部工具回放 K 线，本系统只记录你的模拟交易。进入“模拟练习”，可直接新建一条记录；内部“看板 / 交易记录 / 复盘”共用同一批记录，无需先建练习任务、账户或原计划。</ElText>
          <ElText>品种默认 XAUUSD，可搜索或自定义。草稿允许不完整；模拟持仓中和已平仓只需品种、方向、分析周期。暂不采集模拟开平仓时间 / 价格、仓位 / 手数、净盈亏及币种，不补造时间、零盈亏或价格。历史值在编辑、详情和导出中保留。</ElText>
          <ElText>市场状态、关键结构、开仓分析、计划止损 / 止盈和截图继续保留。截图支持粘贴 / 上传 / 放大 / 移除，共用一套附件并标记开仓前或复盘，每张 ≤ 5 MB、共最多 4 张。</ElText>
          <ElText>已平仓笔数和待复盘笔数按全部记录的手动状态统计，无币种记录也在列表和复盘中。历史盈亏区仅使用已平仓且有明确有效净盈亏及币种的记录，按币种分别显示样本数、胜率和净额；胜率分母只含有效样本，缺失结果不当持平或亏损。没有有效结果时显示“暂无盈亏数据”。</ElText>
          <ElText>复盘页只列已平仓的同一条模拟记录。可保存复盘草稿，完成前至少填写一项总结。完成后修改记录或截图会保留总结并标记待补充；退回未平仓状态后暂离开已平仓复盘队列。过期页面保存时会明确提示，输入保留；离开或刷新时沿用未保存保护。</ElText>
          <ElAlert title="模拟记录、截图和复盘保存在独立数据表中，与真实计划、MT5 持仓和真实交易复盘隔离。这里只做手工记录，不接入行情，不播放 K 线，不进行虚拟撮合。" type="info" show-icon :closable="false"/>
        </div>
      </ElCollapseItem>
      <ElCollapseItem title="导出 Markdown 与截图" name="export">
        <div class="page-stack">
          <ElText>点击“导出数据”，下载 ZIP 压缩包，其中包含 UTF-8 的“开仓计划.md”和 images 文件夹中的原始截图。导出全部四种状态的已保存计划及状态变更时间、放弃原因，不受列表分页与排序选择影响。</ElText>
          <ElText>每份计划会附带已关联持仓、来源账户和币种分组统计及已保存复盘。未关联持仓不包含在导出中。解压整个 ZIP 后，用 Markdown 阅读器打开文件；保留 images 文件夹结构即可离线查看截图。中文、多行及特殊字符会按原文保留。</ElText>
          <ElText>有模拟记录时，同一个 ZIP 追加独立的“模拟练习.md”与 practice-images 图片目录，包含全部已保存模拟记录、状态、模拟时间、创建时间、币种、净盈亏、分析、复盘和截图，不受页面筛选影响。即使没有真实计划，也可以导出模拟记录。</ElText>
          <ElAlert title="导出不会保存或丢弃正在编辑的内容；本次下载只包含已保存版本。真实计划与模拟记录均为空或导出失败时，页面会给出提示。" type="info" show-icon :closable="false"/>
        </div>
      </ElCollapseItem>
      <ElCollapseItem title="本地保存与备份" name="backup">
        <div class="page-stack">
          <ElText>计划、截图、导入持仓、关联、真实复盘和模拟记录保存在当前项目 data/trading.sqlite 数据库中。刷新页面或重启服务后仍会保留，编辑完成后需再次保存。原始上传报告不存入数据库，请自行保留原文件。</ElText>
          <ElText>完整备份时，先停止所有使用数据库的服务，再复制整个 data 文件夹。恢复前也应停止服务并备份当前 data，然后放回备份文件夹。</ElText>
          <ElAlert title="服务运行中可能存在 WAL / SHM 文件，请停服后复制整个 data 文件夹。Markdown ZIP 用于阅读和分享，应用目前不支持从 ZIP 恢复数据。" type="info" show-icon :closable="false"/>
        </div>
      </ElCollapseItem>
    </ElCollapse>
    <template #footer><ElButton type="primary" @click="visible = false">明白了</ElButton></template>
  </ElDialog>
</template>
