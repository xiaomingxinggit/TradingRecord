import JSZip from 'jszip';

const statusLabels = { draft: '草稿', ready: '待触发', executed: '已执行', abandoned: '取消', untriggered: '未触发', expired: '失效' };
const sideLabels = { buy: '做多', sell: '做空' };
const marketLabels = { uptrend: '上涨趋势', downtrend: '下跌趋势', range: '震荡', uncertain: '不确定' };
const orderStatusLabels = { pending: '挂单', open: '持仓中', closed: '已平仓' };
const eventTypeLabels = { order_created: '创建并关联订单', order_status_changed: '订单状态变更', order_fields_changed: '订单字段更新' };
const eventFieldLabels = { status: '订单状态', volume: '手数', reportedSL: '止损', reportedTP: '止盈', lockedAt: '锁定状态' };
const emotionLabels = { calm: '平静', confident: '自信', hesitant: '犹豫', nervous: '紧张', fearful: '恐惧', greedy: '贪婪', impulsive: '冲动' };
const assessmentLabels = { valid: '成立', partial: '部分成立', invalid: '不成立', unverified: '尚未验证' };
const disciplineLabels = { followed: '按计划执行', deviated: '有所偏离', broken: '明显偏离', not_executed: '未执行' };
const imageExtensions = new Map([['image/png', 'png'], ['image/jpeg', 'jpg'], ['image/webp', 'webp']]);
const fields = [
  ['id', '唯一标识'], ['createdAt', '创建时间（UTC）'], ['updatedAt', '更新时间（UTC）'],
  ['status', '状态', statusLabels], ['statusChangedAt', '状态变更时间（UTC）'],
  ['symbol', '品种'], ['side', '方向', sideLabels], ['timeframe', '分析周期'], ['marketState', '市场状态', marketLabels],
  ['entryPrice', '计划入场价'], ['stopLoss', '止损价'], ['takeProfit', '止盈价'],
];
const orderFields = [
  ['id', '订单内部标识'], ['ticket', '订单号'], ['planId', '关联计划标识'], ['status', '状态', orderStatusLabels],
  ['symbol', '品种'], ['side', '方向', sideLabels], ['volume', '手数'],
  ['pendingTime', '挂单时间（报告时钟）'], ['pendingPrice', '挂单目标价'],
  ['openTime', '开仓时间（报告时钟）'], ['openPrice', '开仓价'],
  ['closeTime', '平仓时间（报告时钟）'], ['closePrice', '平仓价'],
  ['reportedSL', '截图止损'], ['reportedTP', '截图止盈'], ['reportedProfit', '截图盈利'],
  ['riskReward', '盈亏比（止盈距离 / 止损距离，不计交易成本）'], ['lockStatus', '锁定状态'], ['lockedAt', '锁定时间（UTC）'],
  ['createdAt', '创建时间（UTC）'], ['updatedAt', '更新时间（UTC）'],
];
const displayText = value => value === null || value === undefined || value === '' ? '未填写' : String(value);
const normalizeText = value => displayText(value).replace(/\r\n?/g, '\n');
const htmlEscape = value => displayText(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
const fenceFor = text => '`'.repeat((text.match(/`+/g) ?? []).reduce((length, run) => Math.max(length, run.length + 1), 3));

// Literal blocks and encoded table text prevent user Markdown/HTML/URLs becoming active resources.
function textBlock(value) {
  const text = normalizeText(value), fence = fenceFor(text);
  return `${fence}text\n${text}\n${fence}`;
}
function tableCell(value) {
  // Entities are decoded as text, not parsed again as Markdown. Encoding all
  // punctuation also handles existing backslashes before pipes and bare URLs.
  return normalizeText(value).replace(/\n/g, ' ').replace(/[^\p{L}\p{N} ]/gu, char => `&#${char.codePointAt(0)};`);
}
function labeledValue(value, labels) {
  return labels && Object.hasOwn(labels, value) ? `${labels[value]}（${value}）` : value;
}
function eventValue(field, value) {
  if (field === 'lockedAt') return value ? `订单已锁定（${value}）` : '未锁定';
  if (value === null || value === undefined || value === '') return '未记录';
  return field === 'status' ? orderStatusLabels[value] ?? value : String(value);
}
// Keep the price-distance semantics of src/orders.ts; never use realized profit.
function orderRiskReward({ openPrice: entry, reportedSL: stop, reportedTP: target }) {
  if (![entry, stop, target].every(value => typeof value === 'number' && Number.isFinite(value) && value > 0)) return '—';
  const risk = Math.abs(entry - stop), ratio = Math.abs(target - entry) / risk;
  return risk > 0 && Number.isFinite(ratio) ? `${ratio.toFixed(2)} : 1` : '—';
}
export function exportArchiveFilename(exportedAt) {
  return `交易计划_${exportedAt.replace(/[-:]/g, '').replace('T', '_').replace('.', '')}.zip`;
}
const offlineStyles = `
:root{color-scheme:light dark;--bg:#f4f6f8;--card:#fff;--text:#243042;--muted:#607086;--line:#dce2e9;--accent:#315ad4}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text);font:15px/1.7 system-ui,sans-serif}
main{max-width:1080px;margin:auto;padding:40px 24px}h1{font-size:32px;margin:0 0 8px}h2{font-size:24px}h3{font-size:19px;margin-top:28px}h4{font-size:16px}a{color:var(--accent);overflow-wrap:anywhere}.muted{color:var(--muted)}
.card{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:24px;margin:24px 0}.summary{display:grid;grid-template-columns:repeat(5,1fr);gap:12px}.metric{padding:14px;border:1px solid var(--line);border-radius:10px}.metric strong{display:block;font-size:26px}.metric span{color:var(--muted)}
table{width:100%;table-layout:fixed;border-collapse:collapse;font-size:14px}th,td{padding:9px 12px;border:1px solid var(--line);text-align:left;vertical-align:top;overflow-wrap:anywhere}th{width:30%;font-weight:600}pre{font:inherit;white-space:pre-wrap;overflow-wrap:anywhere;margin:10px 0 18px;padding:14px;border:1px solid var(--line);border-radius:8px}img{display:block;max-width:100%;height:auto;margin-top:12px}figure{margin:20px 0}figcaption{overflow-wrap:anywhere}ol{padding-left:24px}li{margin:6px 0}.record{border-top:1px solid var(--line);padding-top:12px;margin-top:18px}article{scroll-margin-top:20px}
@media(prefers-color-scheme:dark){:root{--bg:#151920;--card:#202631;--text:#e4e9f1;--muted:#a8b4c6;--line:#3b4656;--accent:#9bb5ff}}
@media(max-width:640px){main{padding:24px 14px}.card{padding:18px}.summary{grid-template-columns:repeat(2,1fr)}h1{font-size:26px}th{width:38%}th,td{padding:8px}h2{font-size:21px}}
@media print{:root{color-scheme:light;--bg:white;--card:white;--text:black;--muted:#444;--line:#bbb;--accent:black}main{max-width:none;padding:0}.card{border-radius:0;padding:12px;margin:16px 0}.metric,figure,.record{break-inside:avoid}h2,h3,h4{break-after:avoid}a{color:black;text-decoration:none}img{max-height:22cm;object-fit:contain;object-position:left}table{font-size:11px}pre{padding:8px}}
`;

export async function exportPlansArchive(plans, exportedAt = new Date().toISOString()) {
  if (!plans.length) throw Object.assign(new Error('还没有已保存的计划，请先保存后再导出。'), { status: 409 });
  const zip = new JSZip();
  zip.folder('images');
  const summary = [['交易计划', plans.length], ['关联订单', plans.reduce((sum, plan) => sum + (plan.orders?.length ?? 0), 0)],
    ['计划事件', plans.reduce((sum, plan) => sum + (plan.events?.length ?? 0), 0)], ['计划复盘', plans.filter(plan => plan.review).length],
    ['行情截图', plans.reduce((sum, plan) => sum + plan.images.length, 0)]];
  const notes = [
    '覆盖全部已保存交易计划及其当前内容，包含全部状态，不受列表筛选和分页影响。按计划创建时间从新到旧排列，同一时间按唯一标识降序。',
    '不包含行情吐槽及回复、未保存输入、OCR 或更新订单草稿、订单截图和识别元数据。',
    '完整解压 ZIP 后，用浏览器打开交易计划.html 即可离线阅读；也可用 Markdown 阅读器打开交易计划.md。请保留 images 文件夹的相对位置。',
    '应用时间以 ISO 格式标明 UTC；订单报告时间保留报告时钟原文，不转换时区。状态变更时间缺失显示“未记录”。',
    'ZIP 是阅读资料，不是数据库完整备份，也不能用于恢复应用。',
  ];
  const markdown = ['# 交易计划', '', `导出时间（UTC）：${tableCell(exportedAt)}`, '', '## 导出摘要', '', '| 内容 | 数量 |', '| --- | ---: |', ...summary.map(([label, count]) => `| ${label} | ${count} |`), '', ...notes.flatMap(note => [note, '']), '<a id="contents"></a>', '', '## 目录', ''];
  const html = ['<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">',
    '<meta http-equiv="Content-Security-Policy" content="default-src \'none\'; img-src \'self\' file:; style-src \'unsafe-inline\'; base-uri \'none\'; form-action \'none\'">',
    `<title>交易计划 · 离线阅读</title><style>${offlineStyles}</style></head><body><main id="top"><header><h1>交易计划</h1><p class="muted">导出时间（UTC）：${htmlEscape(exportedAt)}</p></header>`,
    '<section class="card"><h2>导出摘要</h2><div class="summary">', ...summary.map(([label, count]) => `<div class="metric"><strong>${count}</strong><span>${label}</span></div>`), '</div>',
    ...notes.map(note => `<p class="muted">${note}</p>`), '</section><nav class="card" aria-label="计划目录"><h2>目录</h2><ol>'];
  plans.forEach((plan, index) => {
    const description = `${displayText(plan.symbol)} · ${statusLabels[plan.status] ?? displayText(plan.status)} · ${displayText(plan.createdAt)}（UTC）`;
    markdown.push(`${index + 1}. [计划 ${index + 1}](#plan-${index + 1}) — ${tableCell(description)}`);
    html.push(`<li><a href="#plan-${index + 1}">计划 ${index + 1}</a> <span class="muted">${htmlEscape(description)}</span></li>`);
  });
  markdown.push(''); html.push('</ol></nav>');
  // Both formats share explicit fields and generated anchors/paths.
  function table(rows) {
    markdown.push('| 字段 | 内容 |', '| --- | --- |', ...rows.map(([label, value]) => `| ${label} | ${tableCell(value)} |`), '');
    html.push('<table><tbody>', ...rows.map(([label, value]) => `<tr><th scope="row">${htmlEscape(label)}</th><td>${htmlEscape(value)}</td></tr>`), '</tbody></table>');
  }
  function body(label, value) {
    markdown.push(`#### ${label}`, '', textBlock(value), ''); html.push(`<h4>${label}</h4><pre>${htmlEscape(value)}</pre>`);
  }
  function section(title) { markdown.push(`### ${title}`, ''); html.push(`<h3>${title}</h3>`); }
  function empty(message) { markdown.push(message, ''); html.push(`<p class="muted">${message}</p>`); }
  plans.forEach((plan, planIndex) => {
    const planNumber = String(planIndex + 1).padStart(6, '0');
    markdown.push(`<a id="plan-${planIndex + 1}"></a>`, '', `## 计划 ${planIndex + 1}`, '');
    html.push(`<article id="plan-${planIndex + 1}" class="card"><h2>计划 ${planIndex + 1}</h2>`);
    section('交易计划');
    table(fields.map(([key, label, labels]) => [label, key === 'statusChangedAt' && !plan[key] ? '未记录' : labeledValue(plan[key], labels)]));
    body('关键结构', plan.keyStructure); body('入场理由', plan.reason); body('出场理由', plan.invalidationCondition);
    if (plan.status === 'abandoned' || plan.abandonReason) body(plan.status === 'abandoned' ? '取消原因' : '上次取消原因', plan.abandonReason);
    section('行情截图');
    if (!plan.images.length) empty('未添加截图。');
    plan.images.forEach((image, imageIndex) => {
      const extension = imageExtensions.get(image.mimeType);
      if (!extension || !image.content?.length) throw new Error('已保存截图的格式或内容无效。');
      const path = `images/plan-${planNumber}/image-${String(imageIndex + 1).padStart(2, '0')}.${extension}`;
      zip.file(path, Buffer.from(image.content), { compression: 'STORE' });
      markdown.push(`#### 截图 ${imageIndex + 1}`, '', '原始文件名：', '', textBlock(image.name), '', `![截图 ${imageIndex + 1}](${path})`, '');
      html.push(`<figure><figcaption>截图 ${imageIndex + 1} · 原始文件名：${htmlEscape(image.name)}</figcaption><img src="${path}" alt="截图 ${imageIndex + 1}"></figure>`);
    });
    section('关联订单');
    if (!plan.orders?.length) empty('未关联订单。');
    for (const [orderIndex, order] of (plan.orders ?? []).entries()) {
      markdown.push(`#### 订单 ${orderIndex + 1}`, ''); html.push(`<section class="record"><h4>订单 ${orderIndex + 1}</h4>`);
      table(orderFields.map(([key, label, labels]) => {
        const value = key === 'riskReward' ? orderRiskReward(order) : key === 'lockStatus' ? (order.lockedAt ? '已锁定' : order.status === 'closed' ? '未锁定' : '待平仓')
          : key === 'lockedAt' ? order.lockedAt ?? '未记录' : order[key];
        return [label, labeledValue(value, labels)];
      })); html.push('</section>');
    }
    section('计划事件');
    if (!plan.events?.length) empty('无计划事件。');
    for (const [eventIndex, event] of (plan.events ?? []).entries()) {
      markdown.push(`#### 事件 ${eventIndex + 1}`, ''); html.push(`<section class="record"><h4>事件 ${eventIndex + 1}</h4>`);
      table([['发生时间（UTC）', event.createdAt], ['订单号', event.detail?.ticket], ['事件类型', eventTypeLabels[event.type] ?? event.type]]);
      for (const change of event.detail?.changes ?? []) {
        // Unknown field names also stay in literal cells.
        table([['变更字段', eventFieldLabels[change.field] ?? change.field], ['变化前', eventValue(change.field, change.from)], ['变化后', eventValue(change.field, change.to)]]);
      }
      if (event.detail?.reason) body('修改原因', event.detail.reason);
      if (event.detail?.emotion) table([['当时情绪', emotionLabels[event.detail.emotion] ?? event.detail.emotion]]);
      html.push('</section>');
    }
    section('计划复盘');
    if (!plan.review) empty('无计划复盘。');
    else {
      table([['计划结论', assessmentLabels[plan.review.assessment] ?? '未填写'], ['执行纪律', disciplineLabels[plan.review.discipline] ?? '未填写'], ['创建时间（UTC）', plan.review.createdAt], ['更新时间（UTC）', plan.review.updatedAt]]);
      body('复盘总结', plan.review.summary); body('下次行动', plan.review.nextAction);
    }
    markdown.push('[返回目录](#contents)', '', '---', ''); html.push('<p><a href="#top">返回顶部</a></p></article>');
  });
  html.push('</main></body></html>');
  for (const [name, content] of [['交易计划.md', markdown], ['交易计划.html', html]]) zip.file(name, content.join('\n'), { compression: 'DEFLATE', compressionOptions: { level: 6 } });
  return zip.generateAsync({ type: 'nodebuffer', mimeType: 'application/zip' });
}
