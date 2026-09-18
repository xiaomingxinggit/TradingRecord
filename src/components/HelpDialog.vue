<script setup lang="ts">
import { ref } from 'vue'
import { ElAlert, ElButton, ElCollapse, ElCollapseItem, ElDialog, ElText } from 'element-plus'
const visible = defineModel<boolean>({ default: false })
const sections = ref(['plans'])
</script>

<template>
  <ElDialog v-model="visible" title="使用说明" width="min(680px, calc(100vw - 32px))" align-center>
    <ElCollapse v-model="sections">
      <ElCollapseItem title="计划与订单分别记录" name="plans">
        <div class="page-stack">
          <ElText>交易计划记录分析、截图、价位、触发与失效条件。状态包括草稿、待触发、未触发、取消、失效；待触发需填写品种、方向、周期与理由。原计划价格完整时显示价格距离的收益 / 风险倍数，未计成本。</ElText>
          <ElText>一份计划可关联多笔订单，订单也可以独立存在。计划执行进度来自关联订单；取消计划不会取消订单。旧人工执行标记只作历史信息，不作为实际成交。</ElText>
          <ElText>品种支持搜索或自定义，输入后选择候选或按 Enter 确认。计划截图可粘贴或上传，每份最多 4 张 PNG、JPEG、WEBP，每张不超过 5 MB。创建时间可切换排序，编辑不会改变创建时间。</ElText>
        </div>
      </ElCollapseItem>
      <ElCollapseItem title="订单录入与截图核对" name="orders">
        <div class="page-stack">
          <ElText>订单号在当前单账户中唯一。挂单量、目标价、时间与实际成交量价时间分别保存。同号补录可补全未知事实，遇到已确认事实不同会显示差异，不自动转移计划或合并分批成交。</ElText>
          <ElText>截图识别需选择挂单、持仓或已平仓模式。适配固定浅色完整宽度表格及无表头数据行，裁剪或布局变化可能识别错误；逐行核对后才保存，也可以完全手动录入。识别图不会自动保存为附件。</ElText>
          <ElText>持仓需要实际开仓价和成交量，已平仓还需要平仓价，未知时间可留空。取消与失效只能手动结束已有挂单。截图盈利不代表净盈亏，未知值与零分别保留，不猜币种或实际 R。</ElText>
          <ElText>时间按报告原时钟填写 YYYY.MM.DD HH:mm:ss。当前版本不扫描根目录或导入 MT5 报告文件。</ElText>
        </div>
      </ElCollapseItem>
      <ElCollapseItem title="订单过程、复盘与草稿" name="process">
        <div class="page-stack">
          <ElText>每笔订单可分别追加价位、情绪和判断，每条支持最多 4 张、每张 5 MB 的图片。允许保本与锁盈；情绪无需价格，不清空价位。未关联计划的订单同样可记录。</ElText>
          <ElText>实际成交后可保存复盘草稿；已平仓并至少填写一项“做得好的地方”或“下次改进”才能完成。记录结果、执行情况、判断及是否情绪化，不自动改变订单或计划状态。</ElText>
          <ElText>各部分独立保存，切换页签保留草稿，离开前提示未保存内容。保存、读取、识别期间暂时不能切换。失败后相同内容可重试；复盘版本冲突时先复制文字，再明确重新读取整理。</ElText>
        </div>
      </ElCollapseItem>
      <ElCollapseItem title="旧记录与导出备份" name="export">
        <div class="page-stack">
          <ElText>旧计划过程、来源快照和总结在计划的“历史记录”只读保留。可明确绑定旧组与本计划订单以便追溯，不自动复制或改写旧条目。</ElText>
          <ElText>导出交易记录.zip 包含交易计划.md、交易订单.md 和 images，覆盖所有已保存记录及未关联订单，不含编辑中的草稿。完整解压后可离线阅读。</ElText>
          <ElAlert title="ZIP 是阅读资料，不能恢复数据库。升级或回退前，先停止所有使用数据库的服务，再完整备份 data 文件夹（含可能的 WAL / SHM）。旧版本不能完整读取新订单。" type="info" show-icon :closable="false"/>
        </div>
      </ElCollapseItem>
      <ElCollapseItem title="日间与暗黑模式" name="appearance"><ElText>右上角月亮 / 太阳按钮切换主题，偏好保存在当前浏览器，截图保持原图。</ElText></ElCollapseItem>
    </ElCollapse>
    <template #footer><ElButton type="primary" @click="visible = false">明白了</ElButton></template>
  </ElDialog>
</template>
