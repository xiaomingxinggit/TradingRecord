import JSZip from 'jszip';

const statusLabels = { draft: '草稿', ready: '待触发', executed: '已执行', abandoned: '取消', untriggered: '未触发', expired: '失效' };
const sideLabels = { buy: '做多', sell: '做空' };
const marketLabels = { uptrend: '上涨趋势', downtrend: '下跌趋势', range: '震荡', uncertain: '不确定' };
const orderStatusLabels = { pending: '挂单', open: '持仓中', closed: '已平仓' };
const eventTypeLabels = { order_created: '创建并关联订单', order_status_changed: '订单状态变更', order_fields_changed: '订单字段更新' };
const eventFieldLabels = { status: '订单状态', volume: '手数', reportedSL: '止损', reportedTP: '止盈', lockedAt: '锁定状态' };
const assessmentLabels = { valid: '成立', partial: '部分成立', invalid: '不成立', unverified: '尚未验证' };
const disciplineLabels = { followed: '按计划执行', deviated: '有所偏离', broken: '明显偏离', not_executed: '未执行' };
const imageExtensions = new Map([['image/png', 'png'], ['image/jpeg', 'jpg'], ['image/webp', 'webp']]);
const fields = [
  ['id', '唯一标识'], ['createdAt', '创建时间（UTC）'], ['updatedAt', '更新时间（UTC）'],
  ['status', '状态', statusLabels], ['statusChangedAt', '状态变更时间（UTC）'],
  ['abandonReason', '放弃原因'], ['symbol', '品种'], ['side', '方向', sideLabels],
  ['timeframe', '分析周期'], ['marketState', '市场状态', marketLabels],
  ['keyStructure', '关键结构'], ['reason', '入场理由'], ['invalidationCondition', '出场理由'],
  ['entryPrice', '计划入场价'], ['stopLoss', '止损价'], ['takeProfit', '止盈价'],
];
const orderFields = [
  ['id', '订单内部标识'], ['ticket', '订单号'], ['planId', '关联计划标识'], ['status', '状态', orderStatusLabels],
  ['symbol', '品种'], ['side', '方向', sideLabels], ['volume', '手数'],
  ['pendingTime', '挂单时间（报告时钟）'], ['pendingPrice', '挂单目标价'],
  ['openTime', '开仓时间（报告时钟）'], ['openPrice', '开仓价'],
  ['closeTime', '平仓时间（报告时钟）'], ['closePrice', '平仓价'],
  ['reportedSL', '截图止损'], ['reportedTP', '截图止盈'], ['reportedProfit', '截图盈利'],
  ['riskReward', '盈亏比（当前计划收益 / 风险，不计交易成本）'], ['lockStatus', '锁定状态'], ['lockedAt', '锁定时间（UTC）'],
  ['createdAt', '创建时间（UTC）'], ['updatedAt', '更新时间（UTC）'],
];

// A fence longer than any user-supplied backtick run preserves Chinese,
// multiline text and Markdown/HTML characters as literal content.
function textBlock(value) {
  const text = value === null || value === undefined || value === '' ? '未填写' : String(value);
  const runs = text.match(/`+/g) ?? [];
  const fence = '`'.repeat(runs.reduce((length, run) => Math.max(length, run.length + 1), 3));
  return `${fence}text\n${text}\n${fence}`;
}

function eventValue(field, value) {
  if (field === 'lockedAt') return value ? `订单已锁定（${value}）` : '未锁定';
  if (value === null || value === undefined || value === '') return '未记录';
  if (field === 'status') return orderStatusLabels[value] ?? value;
  return String(value);
}

// Keep the same price-distance semantics as src/orders.ts; never use realized profit.
function orderRiskReward({ side, openPrice: entry, reportedSL: stop, reportedTP: target }) {
  if (![entry, stop, target].every(value => typeof value === 'number' && Number.isFinite(value) && value > 0)) return '—';
  const valid = side === 'buy' ? stop < entry && entry < target
    : side === 'sell' && target < entry && entry < stop;
  if (!valid) return '—';
  const risk = Math.abs(entry - stop), reward = Math.abs(target - entry);
  const ratio = reward / risk;
  return risk > 0 && Number.isFinite(ratio) && ratio > 0 ? `${ratio.toFixed(2)} : 1` : '—';
}

export async function exportPlansArchive(plans) {
  if (!plans.length) {
    throw Object.assign(new Error('还没有已保存的计划，请先保存后再导出。'), { status: 409 });
  }
  const zip = new JSZip();
  zip.folder('images');
  const markdown = ['# 交易计划', '', `共 ${plans.length} 份已保存计划，包含全部状态。`, '',
    '按创建时间从新到旧排列；创建时间相同按唯一标识降序排列。未保存的编辑内容不在本次导出中。', '',
    '状态变更时间缺失时显示“未记录”。', '',
    '解压整个 ZIP 后打开本文件，保留 images 文件夹的位置即可离线查看截图。', '',
    'ZIP 是计划阅读资料，不是数据库完整备份，也不能用于恢复应用。', ''];

  plans.forEach((plan, planIndex) => {
    const planNumber = String(planIndex + 1).padStart(6, '0');
    markdown.push(`## 计划 ${planIndex + 1}`, '');
    markdown.push('### 开仓计划', '');
    // Only the explicit current-plan field list is exported.
    for (const [key, label, labels] of fields) {
      const value = plan[key];
      if (key === 'abandonReason' && plan.status !== 'abandoned' && !value) continue;
      const display = key === 'statusChangedAt' && !value ? '未记录'
        : labels && Object.hasOwn(labels, value) ? `${labels[value]}（${value}）` : value;
      const fieldLabel = key === 'abandonReason' && plan.status !== 'abandoned' ? '上次放弃原因' : label;
      markdown.push(`#### ${fieldLabel}`, '', textBlock(display), '');
    }
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
    markdown.push('### 关联订单', '');
    if (!plan.orders?.length) markdown.push('未关联订单。', '');
    for (const [orderIndex, order] of (plan.orders ?? []).entries()) {
      markdown.push(`#### 订单 ${orderIndex + 1}`, '');
      for (const [key, label, labels] of orderFields) {
        const value = key === 'riskReward' ? orderRiskReward(order)
          : key === 'lockStatus' ? (order.lockedAt ? '已锁定' : order.status === 'closed' ? '未锁定' : '待平仓')
          : key === 'lockedAt' ? order.lockedAt ?? '未记录' : order[key];
        const display = labels && Object.hasOwn(labels, value) ? `${labels[value]}（${value}）` : value;
        markdown.push(`##### ${label}`, '', textBlock(display), '');
      }
    }
    markdown.push('### 计划事件', '');
    if (!plan.events?.length) markdown.push('无。', '');
    for (const [eventIndex, event] of (plan.events ?? []).entries()) {
      markdown.push(`#### 事件 ${eventIndex + 1}`, '', '##### 发生时间（UTC）', '', textBlock(event.createdAt), '',
        '##### 订单号', '', textBlock(event.detail?.ticket), '', '##### 事件类型', '',
        textBlock(eventTypeLabels[event.type] ?? event.type), '');
      for (const change of event.detail?.changes ?? []) {
        markdown.push(`##### ${eventFieldLabels[change.field] ?? change.field}`, '',
          textBlock(`${eventValue(change.field, change.from)} → ${eventValue(change.field, change.to)}`), '');
      }
    }
    markdown.push('### 计划复盘', '');
    if (!plan.review) markdown.push('无。', '');
    else {
      markdown.push('#### 计划结论', '', textBlock(assessmentLabels[plan.review.assessment] ?? '未填写'), '',
        '#### 执行纪律', '', textBlock(disciplineLabels[plan.review.discipline] ?? '未填写'), '',
        '#### 复盘总结', '', textBlock(plan.review.summary), '',
        '#### 下次行动', '', textBlock(plan.review.nextAction), '',
        '#### 更新时间（UTC）', '', textBlock(plan.review.updatedAt), '');
    }
    markdown.push('---', '');
  });
  zip.file('交易计划.md', markdown.join('\n'), { compression: 'DEFLATE', compressionOptions: { level: 6 } });
  return zip.generateAsync({ type: 'nodebuffer', mimeType: 'application/zip' });
}
