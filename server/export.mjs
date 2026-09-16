import JSZip from 'jszip';
import { appendPracticeArchive } from './practice-export.mjs';

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
const knownFields = new Set([...fields.map(([key]) => key), 'images', 'executionReview', 'adjustmentJournal']);
const purposeLabels = { unclassified: '未分类', initial: '首次入场', add: '加仓', reentry: '重新入场' };
const reviewLabels = { draft: '待复盘 / 草稿', completed: '已复盘', needs_update: '有更新待补充' };
const adherenceLabels = { unrated: '未评定', yes: '是', partial: '部分遵守', no: '否' };
function reviewMarkdown(execution) {
  if (!execution) return [];
  const lines = ['### 实际交易与复盘', '', '金额按来源账户及币种分别统计；仅完整平仓计入已实现净额。交易时间为报告中的经纪商服务器时间，未转换时区。', ''];
  if (!execution.positions.length) lines.push('尚未关联持仓。', '');
  for (const group of execution.totals) {
    lines.push('#### 来源与已实现净额', '', textBlock({ 公司: group.source.broker, 服务器: group.source.server, 账户: group.source.accountNumber, 币种: group.source.currency,
      完整平仓数: group.closed, 未平仓数: group.open, 不完整数: group.incomplete, 已实现净额: group.netProfit }), '');
  }
  execution.positions.forEach((p, index) => {
    lines.push(`#### 关联持仓 ${index + 1}`, '', textBlock({ 来源公司: p.source.broker, 服务器: p.source.server, 账户: p.source.accountNumber, 币种: p.source.currency,
      持仓编号: p.ticket, 品种: p.symbol, 方向: sideLabels[p.side], 交易量: p.volume, 开仓时间: p.openTime, 平仓时间: p.closeTime,
      开仓价: p.openPrice, 平仓价: p.closePrice, 报告止损: p.reportedStopLoss, 报告止盈: p.reportedTakeProfit,
      状态: { closed: '完整平仓', open: '未平仓', incomplete: '信息不完整' }[p.resultState], 盈利: p.profit, 手续费: p.commission, 库存费: p.swap, 其他费用: p.fees,
      已实现净额: p.netProfit, 持仓用途: purposeLabels[p.link.purpose], 关联备注: p.link.note, 报告注释: p.comment,
      来源文件: p.sourceFile, 报告日期: p.reportDate, 待核对: p.issues }), '');
  });
  lines.push('报告止损 / 止盈只是导出时的记录，不代表最初设置，不能据此推断原始风险。', '', '#### 复盘总结', '',
    textBlock({ 状态: reviewLabels[execution.review.state], 遵守原计划: adherenceLabels[execution.review.adherence], 做得好的地方: execution.review.good,
      下次改进: execution.review.improve, 上次完成时间UTC: execution.review.completedAt, 更新时间UTC: execution.review.updatedAt }), '');
  return lines;
}
function adjustmentMarkdown(journal) {
  if (!journal?.groups?.length) return [];
  const lines = ['### 持仓调整记录', '', '调整时间由服务端记录为 UTC；原计划价位保持不变。', ''];
  const sourceFields = source => source ? {
    持仓唯一标识: source.positionId, 持仓编号: source.ticket, 品种: source.symbol, 方向: sideLabels[source.side] ?? source.side,
    公司: source.source?.broker, 服务器: source.source?.server, 账户: source.source?.accountNumber, 币种: source.source?.currency,
    参考开仓价: source.entryPrice, 来源文件: source.sourceFile, 报告日期: source.reportDate,
  } : '手动记录，尚未绑定 MT5 来源';
  journal.groups.forEach((group, groupIndex) => {
    // User identifiers stay inside textBlock, never become Markdown headings.
    lines.push(`#### 调整记录组 ${groupIndex + 1}`, '', textBlock({
      分组ID: group.id, 建组方式: group.origin === 'manual' ? '手动独立组' : '已关联 MT5 持仓',
      原手动持仓编号: group.manualTicket || '不适用', 建组时间UTC: group.createdAt,
      显式绑定时间UTC: group.boundAt ?? '未进行手动绑定', 当前绑定来源快照: sourceFields(group.sourceSnapshot),
    }), '');
    (group.entries || []).forEach((entry, entryIndex) => {
      lines.push(`##### 调整 ${entryIndex + 1}`, '', textBlock({
        记录ID: entry.id, 记录时间UTC: entry.recordTime, 参考入场价: entry.entryPrice ?? '未填写',
        止损: entry.stopLoss ?? '本次未设置', 止盈: entry.takeProfit ?? '本次未设置', 原因: entry.reason || '未填写',
        记录时来源快照: sourceFields(entry.sourceSnapshot),
      }), '');
    });
  });
  return lines;
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

export async function exportPlansArchive(plans, practice = []) {
  if (!plans.length && !practice.length) {
    throw Object.assign(new Error('还没有已保存的开仓计划或模拟记录，请先保存后再导出。'), { status: 409 });
  }
  const zip = new JSZip();
  zip.folder('images');
  const markdown = ['# 开仓计划', '', `共 ${plans.length} 份已保存计划，包含全部状态。`, '',
    '按创建时间从新到旧排列；创建时间相同按唯一标识降序排列。未保存的编辑内容不在本次导出中。', '',
    '“已执行”表示已实际开仓，不代表已平仓。状态变更时间缺失时显示“未记录”。', '',
    '解压整个 ZIP 后打开本文件，保留 images 文件夹的位置即可离线查看截图。', '',
    '包含已关联的实际持仓及复盘；未关联持仓不在本导出中。ZIP 不是数据库完整备份，也不能用于恢复应用。', ''];

  plans.forEach((plan, planIndex) => {
    const planNumber = String(planIndex + 1).padStart(6, '0');
    markdown.push(`## 计划 ${planIndex + 1}`, '');
    for (const [key, label, labels] of fields) {
      const value = plan[key];
      if (key === 'abandonReason' && plan.status !== 'abandoned' && !value) continue;
      const display = key === 'statusChangedAt' && !value ? '未记录'
        : labels && Object.hasOwn(labels, value) ? `${labels[value]}（${value}）` : value;
      const fieldLabel = key === 'abandonReason' && plan.status !== 'abandoned' ? '上次放弃原因' : label;
      markdown.push(`### ${fieldLabel}`, '', textBlock(display), '');
    }
    const extra = Object.fromEntries(Object.entries(plan).filter(([key]) => !knownFields.has(key)));
    if (Object.keys(extra).length) markdown.push('### 其他已保存内容', '', textBlock(extra), '');
    markdown.push('### 行情截图', '');
    if (!plan.images.length) markdown.push('未添加截图。', '');
    plan.images.forEach((image, imageIndex) => {
      const extension = imageExtensions.get(image.mimeType);
      if (!extension || !image.content?.length) throw new Error('已保存截图的格式或内容无效。');
      // Never use original names or stored IDs as ZIP paths.
      const path = `images/plan-${planNumber}/image-${String(imageIndex + 1).padStart(2, '0')}.${extension}`;
      zip.file(path, Buffer.from(image.content), { compression: 'STORE' });
      markdown.push(`#### 截图 ${imageIndex + 1}`, '', '原始文件名：', '', textBlock(image.name), '',
        `![截图 ${imageIndex + 1}](${path})`, '');
    });
    markdown.push(...adjustmentMarkdown(plan.adjustmentJournal), ...reviewMarkdown(plan.executionReview), '---', '');
  });
  zip.file('开仓计划.md', markdown.join('\n'), { compression: 'DEFLATE', compressionOptions: { level: 6 } });
  appendPracticeArchive(zip, practice, textBlock);
  return zip.generateAsync({ type: 'nodebuffer', mimeType: 'application/zip' });
}
