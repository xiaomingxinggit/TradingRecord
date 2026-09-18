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
}

export interface OcrOrderRow extends OrderFields {
  rowIndex: number
  warnings: string[]
  raw?: Record<string, string>
}

export const orderStatusLabels: Record<OrderStatus, string> = {
  pending: '挂单', open: '持仓中', closed: '已平仓',
}

export const emptyOrder = (status: OrderStatus = 'open'): OrderFields => ({
  ticket: '', status, symbol: '', side: '', volume: null,
  pendingTime: null, pendingPrice: null, openTime: null, openPrice: null,
  closeTime: null, closePrice: null, reportedSL: null, reportedTP: null, reportedProfit: null,
})
