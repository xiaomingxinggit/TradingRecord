<script setup lang="ts">
import { ref } from 'vue'
import { ElAlert, ElButton, ElCollapse, ElCollapseItem, ElDialog, ElText } from 'element-plus'

const visible = defineModel<boolean>({ default: false })
const sections = ref(['plans'])
</script>

<template>
  <ElDialog v-model="visible" title="使用说明" width="min(680px, calc(100vw - 32px))" align-center>
    <ElCollapse v-model="sections">
      <ElCollapseItem title="一份计划，三个阶段" name="plans">
        <div class="page-stack">
          <ElText>新建开仓计划，填写品种、方向、分析周期、市场状态、关键结构和入场理由。保存后，同一份计划中可以切换“开仓计划 / 持仓过程 / 交易复盘”。</ElText>
          <ElText>品种默认 XAUUSD，可搜索或输入自定义代码；选择候选或按 Enter 确认后再保存，Esc 取消输入。截图支持粘贴或上传 PNG、JPEG、WEBP，每张不超过 5 MB、每份计划最多 4 张，点击可放大。</ElText>
          <ElText>原计划三项价位选填，填写时须为正数且符合方向。三项完整时显示价格距离的收益 / 风险倍数，未计交易成本。价位 OCR 支持单行填入、多行选择；图片只用于识别，不保存为截图，识别结果请核对后保存。</ElText>
          <ElText>三个部分分别保存。切换页签保留草稿，并在页签标明未保存；返回列表会统一确认，刷新或关闭页面由浏览器提示。保存、读取和识别期间暂时不能切换。导出仅包含已保存内容。</ElText>
        </div>
      </ElCollapseItem>
      <ElCollapseItem title="状态与列表排序" name="status">
        <div class="page-stack">
          <ElText>草稿表示想法未整理完，待执行表示等待入场，已执行表示已经开仓，已放弃表示决定不执行。状态不代表平仓或复盘进度。待执行和已执行需要品种、方向、分析周期与入场理由。</ElText>
          <ElText>在列表或开仓详情中点击状态标签更改。放弃原因选填，改回其他状态后保留上次原因。编辑保存不会改变状态；仅实际切换状态才记录变更时间，历史缺失时间显示未记录。</ElText>
          <ElText>列表默认最新创建优先，点击“创建时间”可切换最早优先；排序对全部计划生效并回到第一页。编辑、记录过程或复盘不改变创建时间。</ElText>
        </div>
      </ElCollapseItem>
      <ElCollapseItem title="持仓过程：价位与情绪" name="process">
        <div class="page-stack">
          <ElText>选择已有持仓组追加调整，或填写持仓编号新建独立组。即使编号相同，新组也不会自动合并。历史来源快照仍可查看，已有来源组可以继续记录。</ElText>
          <ElText>先核对目标持仓，再手填或识别参考入场价、本次止损和止盈。空白止损 / 止盈表示本次未设置；允许保本和锁盈。每次追加保留历史，不改原计划价位。</ElText>
          <ElText>情绪可选平静、焦虑、恐惧、贪婪、急躁或其他，备注选填，也可关联当前计划已有持仓组。情绪无需价格，单独保存，不改变价位历史或清空价位草稿。</ElText>
          <ElText>保存失败或超时会保留输入；保持内容不变重试可确认同一次追加，避免重复记录。修改内容会作为新的追加。</ElText>
        </div>
      </ElCollapseItem>
      <ElCollapseItem title="简单交易复盘" name="review">
        <div class="page-stack">
          <ElText>记录交易结果、是否按计划执行、做得好的地方与下次改进。可随时保存草稿；完成复盘前至少填写一项文字总结，结果允许未记录。完成不会自动改变计划状态。</ElText>
          <ElText>其他页面已更新复盘时，保存会提示版本冲突并保留当前输入。先复制需要保留的文字，再重新读取已保存复盘并整理；重新读取替换未保存内容前会确认。</ElText>
        </div>
      </ElCollapseItem>
      <ElCollapseItem title="导出与备份" name="export">
        <div class="page-stack">
          <ElText>“导出数据”下载开仓计划.zip，包括所有已保存计划的三个部分和 images 原始截图目录，不受分页和排序选择影响。解压整个 ZIP 后打开 Markdown，保留图片目录结构。</ElText>
          <ElText>计划和截图保存在当前项目 data/trading.sqlite。完整备份时先停止所有使用该库的服务，再复制整个 data 文件夹；恢复前也应先停服并备份当前数据。</ElText>
          <ElAlert title="Markdown ZIP 用于阅读和分享，不是完整数据库备份；应用不支持从 ZIP 恢复。运行中可能存在 WAL / SHM 文件，应在停服后备份整个 data 文件夹。" type="info" show-icon :closable="false"/>
        </div>
      </ElCollapseItem>
      <ElCollapseItem title="日间与暗黑模式" name="appearance">
        <div class="page-stack"><ElText>右上角月亮 / 太阳按钮切换主题，选择保存在当前浏览器；禁止本地存储时仍可临时切换。所有记录页及弹窗使用同一主题，截图保持原图。</ElText></div>
      </ElCollapseItem>
    </ElCollapse>
    <template #footer><ElButton type="primary" @click="visible = false">明白了</ElButton></template>
  </ElDialog>
</template>
