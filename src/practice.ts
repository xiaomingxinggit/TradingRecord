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
export type PracticeForm = Pick<PracticeContent, 'status' | 'symbol' | 'side' | 'timeframe' | 'marketState' | 'keyStructure' | 'reason' | 'stopLoss' | 'takeProfit'>
export function emptyPractice(): PracticeForm {
  return { status: 'draft', symbol: 'XAUUSD', side: '', timeframe: '', marketState: 'uncertain', keyStructure: '', reason: '', stopLoss: null, takeProfit: null }
}
export function contentOf(record: PracticeRecord): PracticeForm {
  return Object.fromEntries(Object.keys(emptyPractice()).map(key => [key, record[key as keyof PracticeForm]])) as unknown as PracticeForm
}
export const hasPracticeResult = (record: PracticeRecord) => record.status === 'closed' && typeof record.netProfit === 'number' && Number.isFinite(record.netProfit) && typeof record.currency === 'string' && !!record.currency.trim()
export function practiceStats(records: PracticeRecord[], currency: string) {
  const closed = records.filter(record => record.status === 'closed')
  const samples = closed.filter(record => hasPracticeResult(record) && record.currency === currency)
  const wins = samples.filter(record => record.netProfit! > 0).length
  const losses = samples.filter(record => record.netProfit! < 0).length
  return { closed: closed.length, samples: samples.length, wins, losses, even: samples.length - wins - losses,
    winRate: samples.length ? wins / samples.length * 100 : null,
    netProfit: samples.length ? Number(samples.reduce((sum, record) => sum + record.netProfit!, 0).toPrecision(15)) : null,
    pending: closed.filter(record => record.review.state !== 'completed').length }
}
