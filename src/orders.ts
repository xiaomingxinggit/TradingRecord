export type OrderState = 'pending' | 'open' | 'closed' | 'cancelled' | 'expired'
export interface OrderFields {
  ticket: string; state: OrderState; symbol: string; side: '' | 'buy' | 'sell'; volume: number | null
  orderType: string; pendingPrice: number | null; pendingVolume: number | null; pendingTime: string; expiresAt: string
  openTime: string; openPrice: number | null; closeTime: string; closePrice: number | null; closeReason: string
  reportedSL: number | null; reportedTP: number | null; reportedProfit: number | null
}
export interface OrderEvent { id: string; kind: string; source: string; recordedAt: string; snapshot: OrderFields }
export interface RecordedOrder extends OrderFields {
  id: string; planId: string | null; revision: number; createdAt: string; updatedAt: string; events: OrderEvent[]
}
export interface OrderPlan { id: string; symbol: string; side: string; status: string; createdAt: string; updatedAt: string; entryPrice: number | null; stopLoss: number | null; takeProfit: number | null }
export interface OrderOcrRow extends OrderFields { rowIndex: number; warnings: string[]; raw?: Record<string, string> }
export const orderStates: Record<OrderState, string> = { pending: '挂单', open: '持仓中', closed: '已平仓', cancelled: '已取消', expired: '已失效' }
export const pendingTypes = ['buy limit', 'sell limit', 'buy stop', 'sell stop', 'buy stop limit', 'sell stop limit']
export const emptyOrder = (state: OrderState = 'open'): OrderFields => ({ ticket: '', state, symbol: '', side: '', volume: null,
  orderType: '', pendingPrice: null, pendingVolume: null, pendingTime: '', expiresAt: '', openTime: '', openPrice: null, closeTime: '', closePrice: null, closeReason: '', reportedSL: null, reportedTP: null, reportedProfit: null })
export const orderFieldLabels: Record<keyof OrderFields, string> = {
  ticket: '订单号', state: '订单状态', symbol: '品种', side: '方向', volume: '实际成交手数',
  orderType: '订单类型', pendingPrice: '挂单目标价', pendingVolume: '挂单手数', pendingTime: '挂单时间（报告时钟）', expiresAt: '有效期（报告时钟）', openTime: '开仓时间（报告时钟）', openPrice: '实际开仓价',
  closeTime: '平仓时间（报告时钟）', closePrice: '实际平仓价', closeReason: '平仓原因', reportedSL: '截图止损', reportedTP: '截图止盈', reportedProfit: '截图盈利（非净额）',
}
export function orderDisplay(value: unknown, field?: string): string {
  if (value === null || value === undefined || value === '') return '未记录'
  if (field === 'state') return orderStates[value as OrderState] || String(value)
  if (field === 'side') return value === 'buy' ? '做多' : value === 'sell' ? '做空' : String(value)
  return typeof value === 'object' ? JSON.stringify(value) : String(value)
}
export function planLabel(plan: OrderPlan): string {
  const labels: Record<string, string> = { draft: '草稿', ready: '待触发', abandoned: '取消', untriggered: '未触发', expired: '失效', executed: '历史执行标记' }
  return `${plan.symbol} · ${new Date(plan.createdAt).toLocaleString('zh-CN')} · ${labels[plan.status] || plan.status} · ${plan.id}`
}
