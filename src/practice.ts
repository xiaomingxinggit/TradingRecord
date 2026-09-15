import type { UploadUserFile } from 'element-plus'
export type PracticeStatus = 'draft' | 'open' | 'closed'
export type ImagePurpose = 'before' | 'review'
export interface PracticeContent {
  status: PracticeStatus; symbol: string; side: '' | 'buy' | 'sell'; timeframe: string;
  openTime: string | null; openPrice: number | null; volume: number | null;
  closeTime: string | null; closePrice: number | null; netProfit: number | null; currency: string;
  marketState: string; keyStructure: string; reason: string; stopLoss: number | null; takeProfit: number | null;
}
export interface PracticeReview { adherence: 'unrated' | 'yes' | 'partial' | 'no'; good: string; improve: string; state: 'draft' | 'completed' | 'needs_update'; completedAt: string | null; updatedAt: string | null }
export interface PracticeRecord extends PracticeContent {
  id: string; createdAt: string; updatedAt: string; recordRevision: number; reviewRevision: number; review: PracticeReview;
  images: { id: string; name: string; mimeType: string; size: number; purpose: ImagePurpose; url: string }[];
}
export interface PracticeAttachment extends UploadUserFile { existingId?: string; purpose: ImagePurpose }
export const practiceStatuses: { value: PracticeStatus; label: string }[] = [{ value: 'draft', label: '草稿' }, { value: 'open', label: '模拟持仓中' }, { value: 'closed', label: '已平仓' }]
export const practiceStatus = (value: PracticeStatus) => practiceStatuses.find(item => item.value === value)?.label || '草稿'
export const practiceReviewLabel = (value: PracticeReview['state']) => ({ draft: '待复盘', completed: '已复盘', needs_update: '待补充' })[value]
export const practiceSide = (value: string) => value === 'buy' ? '做多' : value === 'sell' ? '做空' : '未填写'
export const practiceMoney = (value: number | null) => value === null || !Number.isFinite(value) ? '—' : value.toLocaleString('zh-CN', { maximumSignificantDigits: 15 })
export const practiceTime = (value: string | null) => value ? new Date(value).toLocaleString('zh-CN', { hour12: false }) : '未记录'
export function emptyPractice(): PracticeContent {
  return { status: 'draft', symbol: 'XAUUSD', side: '', timeframe: '', openTime: null, openPrice: null, volume: null, closeTime: null, closePrice: null,
    netProfit: null, currency: 'USD', marketState: 'uncertain', keyStructure: '', reason: '', stopLoss: null, takeProfit: null }
}
export function contentOf(record: PracticeRecord): PracticeContent {
  return Object.fromEntries(Object.keys(emptyPractice()).map(key => [key, record[key as keyof PracticeContent]])) as unknown as PracticeContent
}
export function practiceStats(records: PracticeRecord[]) {
  const closed = records.filter(record => record.status === 'closed' && record.netProfit !== null && Number.isFinite(record.netProfit))
  const wins = closed.filter(record => record.netProfit! > 0).length
  const losses = closed.filter(record => record.netProfit! < 0).length
  return { closed: closed.length, wins, losses, even: closed.length - wins - losses,
    winRate: closed.length ? wins / closed.length * 100 : null,
    netProfit: Number(closed.reduce((sum, record) => sum + record.netProfit!, 0).toPrecision(15)),
    pending: closed.filter(record => record.review.state !== 'completed').length }
}
