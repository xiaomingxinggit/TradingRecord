export interface Note { strategy: string; tags: string[]; rating: number; content: string; updatedAt?: string }
export interface Trade {
  id: string; accountId: string; ticket: string; symbol: string; side: 'buy' | 'sell'; volume: number;
  openTime: string; closeTime: string | null; openPrice: number; closePrice: number | null;
  stopLoss: number | null; takeProfit: number | null; commission: number; swap: number; fees: number;
  profit: number; netProfit: number; comment: string; sourceFile: string; note?: Note;
}
export interface Account { id: string; name: string; currency: string; broker: string; server: string; reportDate: string }
export interface ImportRecord { id: string; filename: string; importedAt: string; tradeCount: number; addedCount: number; updatedCount: number; duplicateCount: number; warnings: string[] }
export interface AppData { accounts: Account[]; trades: Trade[]; cashFlows: {id:string;accountId:string;time:string;type:string;amount:number;comment:string}[]; imports: ImportRecord[]; rootFiles: {name:string;size:number}[]; warnings?:string[] }
