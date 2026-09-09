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
          <ElText>行情截图支持粘贴或上传 PNG、JPEG、WEBP，每张不超过 5 MB、每份计划最多 4 张。点击可放大，编辑时可移除；保存计划时一并保存。</ElText>
          <ElText>计划入场价、止损价和止盈价可留空，填写时须为正数且符合所选方向。三项价格完整且关系正确时，显示按价格距离计算的收益 / 风险倍数，未计交易成本。</ElText>
          <ElText>点击计划查看详情并继续编辑。未保存时返回列表会先确认，选择“继续编辑”或关闭确认框均会保留当前内容。</ElText>
        </div>
      </ElCollapseItem>
      <ElCollapseItem title="导出 Markdown 与截图" name="export">
        <div class="page-stack">
          <ElText>点击“导出数据”，下载 ZIP 压缩包，其中包含 UTF-8 的“开仓计划.md”和 images 文件夹中的原始截图。导出全部已保存计划，包含草稿与待执行状态，不受列表分页影响。</ElText>
          <ElText>解压整个 ZIP 后，用 Markdown 阅读器打开文件；截图使用相对路径引用，保留文件夹结构即可离线查看。文字中的中文、多行内容及特殊字符会按原文保留。</ElText>
          <ElAlert title="导出不会保存或丢弃正在编辑的内容；本次下载只包含已保存版本。尚无已保存计划或导出失败时，页面会给出提示。" type="info" show-icon :closable="false"/>
        </div>
      </ElCollapseItem>
      <ElCollapseItem title="本地保存与备份" name="backup">
        <div class="page-stack">
          <ElText>计划和截图保存在项目 data/trading.sqlite 数据库中。刷新页面或重启服务后仍会保留，编辑完成后需再次保存。</ElText>
          <ElText>完整备份时，先停止所有使用数据库的服务，再复制整个 data 文件夹。恢复前也应停止服务并备份当前 data，然后放回备份文件夹。</ElText>
          <ElAlert title="服务运行中可能存在 WAL / SHM 文件，请停服后复制整个 data 文件夹。Markdown ZIP 用于阅读和分享，应用目前不支持从 ZIP 恢复数据。" type="info" show-icon :closable="false"/>
        </div>
      </ElCollapseItem>
    </ElCollapse>
    <template #footer><ElButton type="primary" @click="visible = false">明白了</ElButton></template>
  </ElDialog>
</template>
