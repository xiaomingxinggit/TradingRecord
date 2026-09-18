<script setup lang="ts">
import { ref } from 'vue'
import { ElAlert, ElButton, ElCollapse, ElCollapseItem, ElDialog, ElText } from 'element-plus'
const visible = defineModel<boolean>({ default: false })
const sections = ref(['plans'])
</script>

<template>
  <ElDialog v-model="visible" title="使用说明" width="min(680px, calc(100vw - 32px))" align-center>
    <ElCollapse v-model="sections">
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
          <ElText>取消原因可留空，切回其他状态后保留上次原因。列表可点击创建时间切换最新 / 最早优先，编辑不改变创建时间。</ElText>
          <ElText>交易日志和计划复盘页签目前为空白。切换页签保留计划草稿，离开前提示未保存内容，保存期间暂时不能切换。刷新或关闭页面由浏览器提示。</ElText>
        </div>
      </ElCollapseItem>
      <ElCollapseItem title="导出与备份" name="export">
        <div class="page-stack">
          <ElText>导出交易计划.zip 包含交易计划.md 和 images，覆盖所有已保存计划的字段、状态和截图，不包含未保存输入。完整解压后可离线阅读。</ElText>
          <ElAlert title="ZIP 是阅读资料，不能恢复数据库。升级或回退前，先停止所有使用数据库的服务，再完整备份 data 文件夹（含可能存在的 WAL / SHM）。" type="info" show-icon :closable="false"/>
        </div>
      </ElCollapseItem>
      <ElCollapseItem title="日间与暗黑模式" name="appearance"><ElText>右上角月亮 / 太阳按钮切换主题，偏好保存在当前浏览器，截图保持原图。</ElText></ElCollapseItem>
    </ElCollapse>
    <template #footer><ElButton type="primary" @click="visible = false">明白了</ElButton></template>
  </ElDialog>
</template>
