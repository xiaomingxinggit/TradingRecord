<script setup lang="ts">
import { ref } from 'vue'
import { ElAlert, ElButton, ElCollapse, ElCollapseItem, ElDialog, ElText } from 'element-plus'
const visible = defineModel<boolean>({ default: false })
const sections = ref(['overview'])
</script>

<template>
  <ElDialog v-model="visible" title="使用说明" width="min(680px, calc(100vw - 32px))" align-center>
    <ElCollapse v-model="sections">
      <ElCollapseItem title="数据概览" name="overview">
        <div class="page-stack">
          <ElText>工作空间依次为数据概览、行情吐槽和交易计划，默认打开数据概览。看板汇总本机全部已保存计划、关联订单、已平仓订单、计划事件和复盘，不受计划列表筛选影响；进入页面会读取最新数据，也可手动刷新。</ElText>
          <ElText>状态分布按当前状态统计；常用品种按计划数量展示前 5，占比以全部计划为分母，忽略品种首尾空格并按大写归类。至少保存一项复盘内容即计为已完成，复盘覆盖率的分母包括草稿和未执行计划。</ElText>
          <ElText>近期动态展示最近有活动的 6 份计划，包含计划、订单、事件或复盘的更新；点击“查看”进入对应计划。未保存输入和识别草稿不计入统计，看板不计算账户收益。</ElText>
        </div>
      </ElCollapseItem>
      <ElCollapseItem title="行情吐槽" name="rants">
        <div class="page-stack">
          <ElText>随手记录行情感想，按发布时间倒序回看。每条最多 2000 字、4 张 PNG、JPEG 或 WebP 图片，每张不超过 5 MB；文字或图片至少有一项，也可以只发图片。</ElText>
          <ElText>点击“添加图片”或 Ctrl + V 粘贴，待发布图片可预览、移除。发布后文字与原图一同保存在本机，点击图片可放大查看；当前不提供编辑、删除、评论或点赞。</ElText>
          <ElText>切换工作空间板块会提示未发布的草稿，刷新或关闭页面由浏览器提示；发布期间暂时不能切换，失败后保留输入。刷新时间线不会清空草稿。</ElText>
          <ElText>行情吐槽独立于交易计划，不纳入数据概览统计，也不包含在交易计划 ZIP 中。备份吐槽请停服后完整复制 data 文件夹。</ElText>
        </div>
      </ElCollapseItem>
      <ElCollapseItem title="填写交易计划" name="plans">
        <div class="page-stack">
          <ElText>记录品种、方向、分析周期、市场状态、关键结构、入场理由和出场理由。品种默认 XAUUSD，可搜索或自定义；输入后选择候选或按 Enter 确认。出场理由可以留空。</ElText>
          <ElText>行情截图支持上传和粘贴，每份最多 4 张 PNG、JPEG、WEBP，每张不超过 5 MB，随计划保存并可点击预览。</ElText>
          <ElText>计划入场价、止损、止盈手动填写，均可留空；填写时须为正数且符合方向。三项完整时显示按价格距离计算的收益 / 风险倍数，未计交易成本。</ElText>
        </div>
      </ElCollapseItem>
      <ElCollapseItem title="状态、排序与保存" name="status">
        <div class="page-stack">
          <ElText>状态包括草稿、待触发、已执行、未触发、取消、失效，在列表或详情中手动选择。待触发和已执行需填写品种、方向、周期和入场理由；编辑正文会保留当前状态。</ElText>
          <ElText>取消原因可留空，切回其他状态后保留上次原因。列表默认显示今天创建的计划，可按创建日期和计划状态组合筛选；点击创建时间可切换最新 / 最早优先，编辑不改变创建时间。</ElText>
          <ElText>新建计划时直接显示表单，不显示页签。保存后的查看和编辑页面包含交易计划、关联订单、计划事件、计划复盘四个页签。切换页签保留计划草稿，离开前提示未保存内容，保存期间暂时不能切换。刷新或关闭页面由浏览器提示。</ElText>
        </div>
      </ElCollapseItem>
      <ElCollapseItem title="关联订单" name="orders">
        <div class="page-stack">
          <ElText>在已保存计划内选择或粘贴一张不超过 5 MB 的 PNG、JPEG 或 WEBP 订单截图。支持浅色 MT5 表格及整行蓝色选中的单行截图，建议截取完整宽度的一行记录；浅色已平仓截图可带表头，表头和账户汇总会跳过。系统在本机自动比较挂单、持仓中和已平仓三套固定布局，不支持任意深色主题或任意表格；原图不会保存。</ElText>
          <ElText>识别结果只是草稿。请逐行核对订单号、状态、品种、方向、手数、时间、价格、止损止盈和截图盈利；状态判断不明确时可人工修改。未知字段留空，报告时间不转换时区。</ElText>
          <ElText>同一订单号不会重复创建，也不会从其他计划自动转移。列表显示开仓价、止损、止盈、盈亏比和锁定状态；未锁定订单的状态标签可切换挂单、持仓中和已平仓，切换只改变状态。</ElText>
          <ElText>盈亏比按当前止盈距离 / 止损距离计算，不计交易成本，也不代表实际盈利；止损移动到开仓价另一侧后仍按当前距离计算。三个价格必须为正数且有限，止损距离为零或缺少字段时显示“—”，导出采用相同口径。</ElText>
          <ElText>已平仓订单可点击“锁定订单”并再次确认；锁定后订单视为完结，无法再修改状态、手数、止损和止盈，不能解锁。锁定时间和变化会被记录，仍可查看和导出；未平仓订单显示“待平仓”。</ElText>
          <ElText>“更新订单”只比较当前计划同一订单号的手数、止损和止盈，已锁定订单不能更新。发现实际变化后，需填写修改原因并选择当时情绪，确认后变化和说明会一同记入计划事件。未知字段不清空旧值；对比期间的选择或粘贴图片不会进入新订单导入。未保存的导入或对比草稿离开前会提示。</ElText>
        </div>
      </ElCollapseItem>
      <ElCollapseItem title="计划事件" name="events">
        <div class="page-stack">
          <ElText>计划事件只读记录订单创建并关联、订单状态变化、订单锁定，以及通过截图对比确认的手数、止损、止盈变化。查看不会产生事件，已有订单不会补写虚构历史。</ElText>
          <ElText>事件显示发生时间、订单号和实际变化，不能编辑或删除；订单写入失败时不会单独留下事件。</ElText>
        </div>
      </ElCollapseItem>
      <ElCollapseItem title="计划复盘" name="review">
        <div class="page-stack">
          <ElText>计划复盘记录整份计划是否成立、是否按计划执行，以及复盘总结和下次行动。每项都可留空，但至少填写一项才能保存；保存后可继续修改。</ElText>
          <ElText>未保存修改在切换页签或离开计划前会提示。确认放弃会恢复最近一次读取或保存的内容；同一复盘在其他页面更新后，旧页面不会覆盖新内容。</ElText>
        </div>
      </ElCollapseItem>
      <ElCollapseItem title="导出与备份" name="export">
        <div class="page-stack">
          <ElText>导出交易计划.zip 包含交易计划.md 和 images，覆盖所有已保存计划、截图、关联订单、人类可读的计划事件及计划复盘，不包含行情吐槽、未保存草稿、复盘修改或 OCR 元数据。完整解压后可离线阅读。</ElText>
          <ElAlert title="ZIP 是阅读资料，不能恢复数据库。升级或回退前，先停止所有使用数据库的服务，再完整备份 data 文件夹（含可能存在的 WAL / SHM）。" type="info" show-icon :closable="false"/>
        </div>
      </ElCollapseItem>
      <ElCollapseItem title="日间与暗黑模式" name="appearance"><ElText>右上角月亮 / 太阳按钮切换主题，偏好保存在当前浏览器，截图保持原图。</ElText></ElCollapseItem>
    </ElCollapse>
    <template #footer><ElButton type="primary" @click="visible = false">明白了</ElButton></template>
  </ElDialog>
</template>
