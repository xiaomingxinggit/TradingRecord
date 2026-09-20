export type OrderStatus = 'pending' | 'open' | 'closed'
export type OrderSide = 'buy' | 'sell'

export interface OrderFields {
  ticket: string
  status: OrderStatus
  symbol: string
  side: '' | OrderSide
  volume: number | null
  pendingTime: string | null
  pendingPrice: number | null
  openTime: string | null
  openPrice: number | null
  closeTime: string | null
  closePrice: number | null
  reportedSL: number | null
  reportedTP: number | null
  reportedProfit: number | null
}

export interface RecordedOrder extends Omit<OrderFields, 'side'> {
  id: string
  planId: string | null
  side: OrderSide
  createdAt: string
  updatedAt: string
  lockedAt: string | null
}

export interface OcrOrderRow extends OrderFields {
  rowIndex: number
  warnings: string[]
  raw?: Record<string, string>
}

export const orderStatusLabels: Record<OrderStatus, string> = {
  pending: '挂单', open: '持仓中', closed: '已平仓',
}

// Current reward / risk by price distance; excludes costs and realized profit.
export function orderRiskReward(order: Pick<OrderFields, 'side' | 'openPrice' | 'reportedSL' | 'reportedTP'>): string {
  const { openPrice: entry, reportedSL: stop, reportedTP: target } = order
  if (entry === null || stop === null || target === null
    || ![entry, stop, target].every(value => Number.isFinite(value) && value > 0)) return '—'
  const risk = Math.abs(entry - stop), reward = Math.abs(target - entry)
  const ratio = reward / risk
  return risk > 0 && Number.isFinite(ratio) ? `${ratio.toFixed(2)} : 1` : '—'
}

export const emptyOrder = (status: OrderStatus = 'open'): OrderFields => ({
  ticket: '', status, symbol: '', side: '', volume: null,
  pendingTime: null, pendingPrice: null, openTime: null, openPrice: null,
  closeTime: null, closePrice: null, reportedSL: null, reportedTP: null, reportedProfit: null,
})
