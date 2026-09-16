import JSZip from 'jszip';
import { simpleReview } from './plan-review.mjs';
import { adjustmentJournal } from './plan-adjustments.mjs';

const statusLabels = { draft: '草稿', ready: '待执行', executed: '已执行', abandoned: '已放弃' };
const sideLabels = { buy: '做多', sell: '做空' };
const marketLabels = { uptrend: '上涨趋势', downtrend: '下跌趋势', range: '震荡', uncertain: '不确定' };
const imageExtensions = new Map([['image/png', 'png'], ['image/jpeg', 'jpg'], ['image/webp', 'webp']]);
const fields = [
  ['id', '唯一标识'], ['createdAt', '创建时间（UTC）'], ['updatedAt', '更新时间（UTC）'],
  ['status', '状态', statusLabels], ['statusChangedAt', '状态变更时间（UTC）'],
  ['abandonReason', '放弃原因'], ['symbol', '品种'], ['side', '方向', sideLabels],
  ['timeframe', '分析周期'], ['marketState', '市场状态', marketLabels],
  ['keyStructure', '关键结构'], ['reason', '入场理由'],
  ['entryPrice', '计划入场价'], ['stopLoss', '止损价'], ['takeProfit', '止盈价'],
];
function adjustmentMarkdown(journal) {
  const lines = ['### 持仓过程', '', '记录时间由服务端记录为 UTC；价位调整与情绪分别保存，原计划价位保持不变。', ''];
  if (!journal.groups.length) lines.push('尚未记录价位调整。', '');
  const sourceFields = source => source ? {
    持仓唯一标识: source.positionId, 持仓编号: source.ticket, 品种: source.symbol, 方向: sideLabels[source.side] ?? source.side,
    公司: source.source?.broker, 服务器: source.source?.server, 账户: source.source?.accountNumber, 币种: source.source?.currency,
    参考开仓价: source.entryPrice, 来源文件: source.sourceFile, 报告日期: source.reportDate,
  } : '手动独立记录';
  journal.groups.forEach((group, groupIndex) => {
    // User identifiers stay inside textBlock, never become Markdown headings.
    lines.push(`#### 调整记录组 ${groupIndex + 1}`, '', textBlock({
      分组ID: group.id, 建组方式: group.origin === 'manual' ? '手动独立组' : '历史 MT5 来源组',
      原手动持仓编号: group.manualTicket || '不适用', 建组时间UTC: group.createdAt,
      历史绑定时间UTC: group.boundAt ?? '无', 历史来源快照: sourceFields(group.sourceSnapshot),
    }), '');
    (group.entries || []).forEach((entry, entryIndex) => {
      lines.push(`##### 调整 ${entryIndex + 1}`, '', textBlock({
        记录ID: entry.id, 记录时间UTC: entry.recordTime, 参考入场价: entry.entryPrice ?? '未填写',
        止损: entry.stopLoss ?? '本次未设置', 止盈: entry.takeProfit ?? '本次未设置', 原因: entry.reason || '未填写',
        记录时来源快照: sourceFields(entry.sourceSnapshot),
      }), '');
    });
  });
  lines.push('#### 情绪记录', '');
  if (!journal.emotions.length) lines.push('尚未记录情绪。', '');
  journal.emotions.forEach((entry, index) => {
    const group = journal.groups.find(item => item.id === entry.groupId);
    lines.push(`##### 情绪 ${index + 1}`, '', textBlock({
      记录ID: entry.id, 记录时间UTC: entry.recordTime, 情绪: entry.emotion, 备注: entry.note || '未填写',
      关联分组ID: entry.groupId || '未关联具体持仓',
      关联持仓编号: group ? group.sourceSnapshot?.ticket || group.manualTicket || '未记录' : '不适用',
    }), '');
  });
  return lines;
}

function reviewMarkdown(review) {
  return ['### 交易复盘', '', textBlock({
    复盘状态: review.status === 'completed' ? '已完成' : '草稿', 交易结果: review.result,
    是否按计划执行: review.adherence, 做得好的地方: review.good, 下次改进: review.improve,
    更新时间UTC: review.updatedAt ?? '未保存',
  }), ''];
}

// A fence longer than any user-supplied backtick run preserves Chinese,
// multiline text and Markdown/HTML characters as literal content.
function textBlock(value) {
  const text = value === null || value === undefined || value === '' ? '未填写'
    : typeof value === 'object' ? JSON.stringify(value, null, 2) : String(value);
  const runs = text.match(/`+/g) ?? [];
  const fence = '`'.repeat(runs.reduce((length, run) => Math.max(length, run.length + 1), 3));
  return `${fence}text\n${text}\n${fence}`;
}

export async function exportPlansArchive(plans) {
  if (!plans.length) {
    throw Object.assign(new Error('还没有已保存的开仓计划，请先保存后再导出。'), { status: 409 });
  }
  const zip = new JSZip();
  zip.folder('images');
  const markdown = ['# 开仓计划', '', `共 ${plans.length} 份已保存计划，包含全部状态。`, '',
    '按创建时间从新到旧排列；创建时间相同按唯一标识降序排列。未保存的编辑内容不在本次导出中。', '',
    '“已执行”表示已实际开仓，不代表已平仓。状态变更时间缺失时显示“未记录”。', '',
    '解压整个 ZIP 后打开本文件，保留 images 文件夹的位置即可离线查看截图。', '',
    '每份计划包含开仓计划、持仓过程、交易复盘和截图。ZIP 不是数据库完整备份，也不能用于恢复应用。', ''];

  plans.forEach((plan, planIndex) => {
    const planNumber = String(planIndex + 1).padStart(6, '0');
    markdown.push(`## 计划 ${planIndex + 1}`, '');
    markdown.push('### 开仓计划', '');
    for (const [key, label, labels] of fields) {
      const value = plan[key];
      if (key === 'abandonReason' && plan.status !== 'abandoned' && !value) continue;
      const display = key === 'statusChangedAt' && !value ? '未记录'
        : labels && Object.hasOwn(labels, value) ? `${labels[value]}（${value}）` : value;
      const fieldLabel = key === 'abandonReason' && plan.status !== 'abandoned' ? '上次放弃原因' : label;
      markdown.push(`#### ${fieldLabel}`, '', textBlock(display), '');
    }
    // Export business fields explicitly; legacy payloads and request metadata stay private.
    markdown.push('#### 行情截图', '');
    if (!plan.images.length) markdown.push('未添加截图。', '');
    plan.images.forEach((image, imageIndex) => {
      const extension = imageExtensions.get(image.mimeType);
      if (!extension || !image.content?.length) throw new Error('已保存截图的格式或内容无效。');
      // Never use original names or stored IDs as ZIP paths.
      const path = `images/plan-${planNumber}/image-${String(imageIndex + 1).padStart(2, '0')}.${extension}`;
      zip.file(path, Buffer.from(image.content), { compression: 'STORE' });
      markdown.push(`##### 截图 ${imageIndex + 1}`, '', '原始文件名：', '', textBlock(image.name), '',
        `![截图 ${imageIndex + 1}](${path})`, '');
    });
    markdown.push(...adjustmentMarkdown(adjustmentJournal(plan)), ...reviewMarkdown(simpleReview(plan)), '---', '');
  });
  zip.file('开仓计划.md', markdown.join('\n'), { compression: 'DEFLATE', compressionOptions: { level: 6 } });
  return zip.generateAsync({ type: 'nodebuffer', mimeType: 'application/zip' });
}
