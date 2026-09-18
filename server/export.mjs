import JSZip from 'jszip';
import { simpleReview } from './plan-review.mjs';
import { adjustmentJournal } from './plan-adjustments.mjs';

const statusLabels = { draft: '草稿', ready: '待触发', executed: '旧人工执行标记（不代表成交证据）', abandoned: '取消', untriggered: '未触发', expired: '失效' };
const sideLabels = { buy: '做多', sell: '做空' };
const marketLabels = { uptrend: '上涨趋势', downtrend: '下跌趋势', range: '震荡', uncertain: '不确定' };
const imageExtensions = new Map([['image/png', 'png'], ['image/jpeg', 'jpg'], ['image/webp', 'webp']]);
const fields = [
  ['id', '唯一标识'], ['createdAt', '创建时间（UTC）'], ['updatedAt', '更新时间（UTC）'],
  ['status', '状态', statusLabels], ['statusChangedAt', '状态变更时间（UTC）'],
  ['abandonReason', '放弃原因'], ['symbol', '品种'], ['side', '方向', sideLabels],
  ['timeframe', '分析周期'], ['marketState', '市场状态', marketLabels],
  ['keyStructure', '关键结构'], ['reason', '入场理由'], ['invalidationCondition', '出场理由'],
  ['entryPrice', '计划入场价'], ['stopLoss', '止损价'], ['takeProfit', '止盈价'],
];
const orderStates = { pending: '挂单', open: '持仓', closed: '已平仓', cancelled: '已取消', expired: '失效', observation: '观察补充' };
const orderFields = order => ({
  订单编号: order.ticket, 阶段: orderStates[order.state] ?? order.state, 品种: order.symbol,
  方向: sideLabels[order.side] ?? order.side, 实际成交量: order.volume ?? '未知', 订单类型: order.orderType || '未知',
  挂单数量: order.pendingVolume ?? '未知', 挂单时间: order.pendingTime || '未知', 有效期: order.expiresAt || '未知',
  挂单目标价: order.pendingPrice ?? '未知', 实际开仓时间: order.openTime || '未知', 实际开仓价: order.openPrice ?? '未知',
  实际平仓时间: order.closeTime || '未知', 实际平仓价: order.closePrice ?? '未知', 平仓原因: order.closeReason || '未记录',
  截图止损: order.reportedSL ?? '未设置或未记录', 截图止盈: order.reportedTP ?? '未设置或未记录',
  截图盈利: order.reportedProfit ?? '未知', 来源: order.source === 'screenshot' ? '截图核对' : '手工录入',
});
function ordersMarkdown(orders, zip) {
  const lines = ['# 交易订单', '', `共 ${orders.length} 个唯一订单，其中 ${orders.filter(order => order.state === 'closed').length} 个已平仓。`, '',
    '成交时间保留报告时钟，不作时区转换；记录时间为 UTC。事件按确认录入顺序排列，截图盈利不代表包含费用的净额，不汇总不同订单金额。', ''];
  orders.forEach((order, index) => {
    lines.push(`## 订单 ${index + 1}`, '', textBlock({ 订单ID: order.id, 所属计划ID: order.planId ?? '未关联计划',
      ...orderFields(order), 盈亏比例: '未记录', R倍数: '未记录', 创建时间UTC: order.createdAt, 更新时间UTC: order.updatedAt }), '', '### 阶段与观察', '');
    order.events.forEach((event, eventIndex) => {
      lines.push(`#### 观察 ${eventIndex + 1}`, '', textBlock({ 事件ID: event.id,
        事件类型: orderStates[event.kind] ?? event.kind, 记录时间UTC: event.recordedAt,
        ...orderFields(event.snapshot) }), '');
    });
    lines.push('### 订单过程', '');
    if (!order.process.length) lines.push('尚未记录过程。', '');
    order.process.forEach((event, eventIndex) => {
      lines.push(`#### 过程 ${eventIndex + 1}`, '', textBlock({ 事件ID: event.id,
        类型: { price: '价位', emotion: '情绪', note: '判断' }[event.type], 记录时间UTC: event.recordedAt,
        参考入场价: event.entryPrice ?? '未填写', 止损: event.stopLoss ?? '未设置或未记录', 止盈: event.takeProfit ?? '未设置或未记录',
        情绪: event.emotion || '不适用', 判断或备注: event.note || '未填写' }), '');
      event.images.forEach((image, imageIndex) => {
        const extension = imageExtensions.get(image.mimeType);
        if (!extension || !image.content?.length) throw new Error('已保存过程图片的格式或内容无效。');
        const path = `images/orders/order-${String(index + 1).padStart(6, '0')}/event-${String(eventIndex + 1).padStart(6, '0')}/image-${String(imageIndex + 1).padStart(2, '0')}.${extension}`;
        zip.file(path, Buffer.from(image.content), { compression: 'STORE' });
        lines.push(`##### 过程图片 ${imageIndex + 1}`, '', '原始文件名：', '', textBlock(image.name), '', `![过程图片 ${imageIndex + 1}](${path})`, '');
      });
    });
    lines.push(...reviewMarkdown(order.review, true));
    if (order.legacy.groups.length || order.legacy.emotions.length) lines.push(...adjustmentMarkdown(order.legacy));
    lines.push('---', '');
  });
  return lines;
}
function adjustmentMarkdown(journal) {
  const lines = ['### 历史计划过程（只读来源）', '', '以下为原计划保存的记录；显式关联不回写旧条目，不代表订单已成交。', ''];
  if (!journal.groups.length) lines.push('尚未记录价位调整。', '');
  const sourceFields = source => source ? {
    持仓唯一标识: source.positionId, 持仓编号: source.ticket, 品种: source.symbol, 方向: sideLabels[source.side] ?? source.side,
    公司: source.source?.broker, 服务器: source.source?.server, 账户: source.source?.accountNumber, 币种: source.source?.currency,
    参考开仓价: source.entryPrice, 来源文件: source.sourceFile, 报告日期: source.reportDate,
  } : '手动独立记录';
  journal.groups.forEach((group, groupIndex) => {
    // User identifiers stay inside textBlock, never become Markdown headings.
    lines.push(`#### 调整记录组 ${groupIndex + 1}`, '', textBlock({
      分组ID: group.id, 建组方式: group.origin === 'manual' ? '手动独立组' : group.origin === 'order' ? '订单过程组' : '历史 MT5 来源组',
      订单ID: group.orderId || '未绑定订单', 订单绑定时间UTC: group.orderBoundAt ?? '无',
      原手动持仓编号: group.manualTicket || '不适用', 建组时间UTC: group.createdAt,
      历史绑定时间UTC: group.boundAt ?? '无', 历史来源快照: sourceFields(group.sourceSnapshot),
    }), '');
    (group.entries || []).forEach((entry, entryIndex) => {
      lines.push(`##### 调整 ${entryIndex + 1}`, '', textBlock({
        记录ID: entry.id, 记录时间UTC: entry.recordTime, 记录时订单ID: entry.orderId || '未绑定订单', 参考入场价: entry.entryPrice ?? '未填写',
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
      记录ID: entry.id, 记录时间UTC: entry.recordTime, 记录时订单ID: entry.orderId || '未关联订单', 情绪: entry.emotion, 备注: entry.note || '未填写',
      关联分组ID: entry.groupId || '未关联具体持仓',
      关联持仓编号: group ? group.sourceSnapshot?.ticket || group.manualTicket || '未记录' : '不适用',
    }), '');
  });
  return lines;
}

function reviewMarkdown(review, orderReview = false) {
  return [orderReview ? '### 订单交易复盘' : '### 历史计划总结（只读）', '', textBlock({
    复盘状态: review.status === 'completed' ? '已完成' : '草稿', 交易结果: review.result,
    是否按计划执行: review.adherence, 做得好的地方: review.good, 下次改进: review.improve,
    ...(orderReview ? { 入场持仓平仓判断: review.analysis, 是否情绪化操作: review.emotional } : {}),
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

export async function exportPlansArchive(plans, orders = []) {
  if (!plans.length && !orders.length) {
    throw Object.assign(new Error('还没有已保存的计划或订单，请先保存后再导出。'), { status: 409 });
  }
  const zip = new JSZip();
  zip.folder('images');
  const markdown = ['# 交易计划', '', `共 ${plans.length} 份已保存计划，包含全部状态。`, '',
    '按创建时间从新到旧排列；创建时间相同按唯一标识降序排列。未保存的编辑内容不在本次导出中。', '',
    '计划状态是意图，不代表挂单或成交；旧执行标记只是历史人工标记。状态变更时间缺失时显示“未记录”。', '',
    '解压整个 ZIP 后打开本文件，保留 images 文件夹的位置即可离线查看截图。', '',
    '订单（含未关联订单）仅在交易订单.md 中独立导出，本文件通过订单ID引用。旧计划过程和总结原样保留业务内容。ZIP 不是数据库完整备份，也不能用于恢复应用。', ''];

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
    if (plan.triggerCondition) markdown.push('#### 历史触发条件', '', textBlock(plan.triggerCondition), '');
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
    markdown.push('### 关联订单ID', '', textBlock((plan.orders ?? []).map(order => ({ 订单ID: order.id }))), '',
      ...adjustmentMarkdown(adjustmentJournal(plan)), ...reviewMarkdown(simpleReview(plan)), '---', '');
  });
  zip.file('交易计划.md', markdown.join('\n'), { compression: 'DEFLATE', compressionOptions: { level: 6 } });
  zip.file('交易订单.md', ordersMarkdown(orders, zip).join('\n'), { compression: 'DEFLATE', compressionOptions: { level: 6 } });
  return zip.generateAsync({ type: 'nodebuffer', mimeType: 'application/zip' });
}
