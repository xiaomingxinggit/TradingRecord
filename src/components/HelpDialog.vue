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
      <ElCollapseItem title="导出 Markdown 与截图" name="export">
        <div class="page-stack">
          <ElText>点击“导出数据”，下载 ZIP 压缩包，其中包含 UTF-8 的“开仓计划.md”和 images 文件夹中的原始截图。导出全部四种状态的已保存计划及状态变更时间、放弃原因，不受列表分页与排序选择影响。</ElText>
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
