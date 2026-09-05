import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

export const emptyNote = () => ({ strategy: '', tags: [], rating: 0, content: '', updatedAt: null });

const openFields = ['accountId', 'ticket', 'symbol', 'side', 'volume', 'openTime', 'openPrice'];
const coreFields = [...openFields, 'closeTime', 'closePrice', 'stopLoss', 'takeProfit',
  'commission', 'swap', 'fees', 'profit', 'netProfit'];
const fieldNames = { accountId: '账户', ticket: '持仓编号', symbol: '品种', side: '方向', volume: '手数',
  openTime: '开仓时间', openPrice: '开仓价格', closeTime: '平仓时间', closePrice: '平仓价格',
  stopLoss: '止损', takeProfit: '止盈', commission: '佣金', swap: '隔夜利息', fees: '费用',
  profit: '交易盈亏', netProfit: '净盈亏' };
const differentFields = (a, b, fields) => fields.filter((field) => (a[field] ?? null) !== (b[field] ?? null));
const identityValue = (value) => String(value ?? '').trim();

export function createStore(dataDir) {
  mkdirSync(dataDir, { recursive: true });
  const db = new DatabaseSync(join(dataDir, 'trading.sqlite'));
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;
    CREATE TABLE IF NOT EXISTS accounts (
      id TEXT PRIMARY KEY,
      payload TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS trades (
      id TEXT PRIMARY KEY,
      account_id TEXT NOT NULL REFERENCES accounts(id),
      payload TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS trades_account ON trades(account_id);
    CREATE TABLE IF NOT EXISTS cash_flows (
      id TEXT PRIMARY KEY,
      account_id TEXT NOT NULL REFERENCES accounts(id),
      payload TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS notes (
      trade_id TEXT PRIMARY KEY REFERENCES trades(id),
      payload TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS imports (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      filename TEXT NOT NULL,
      fingerprint TEXT NOT NULL,
      imported_at TEXT NOT NULL,
      trade_count INTEGER NOT NULL,
      added_count INTEGER NOT NULL,
      updated_count INTEGER NOT NULL DEFAULT 0,
      duplicate_count INTEGER NOT NULL,
      warnings TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS imports_fingerprint ON imports(filename, fingerprint);
  `);
  // Upgrade databases created before report lifecycle updates were supported.
  if (!db.prepare('PRAGMA table_info(imports)').all().some((column) => column.name === 'updated_count')) {
    db.exec('ALTER TABLE imports ADD COLUMN updated_count INTEGER NOT NULL DEFAULT 0');
  }

  const getAccount = db.prepare('SELECT payload FROM accounts WHERE id = ?');
  const insertAccount = db.prepare(`INSERT INTO accounts (id, payload) VALUES (?, ?)
    ON CONFLICT(id) DO UPDATE SET payload = excluded.payload`);
  const insertTrade = db.prepare('INSERT OR IGNORE INTO trades (id, account_id, payload) VALUES (?, ?, ?)');
  const updateTrade = db.prepare('UPDATE trades SET payload = ? WHERE id = ?');
  const insertCash = db.prepare('INSERT OR IGNORE INTO cash_flows (id, account_id, payload) VALUES (?, ?, ?)');
  const findTrade = db.prepare('SELECT payload FROM trades WHERE id = ?');
  const findNote = db.prepare('SELECT payload FROM notes WHERE trade_id = ?');
  const saveNote = db.prepare(`INSERT INTO notes (trade_id, payload) VALUES (?, ?)
    ON CONFLICT(trade_id) DO UPDATE SET payload = excluded.payload`);
  const insertImport = db.prepare(`INSERT INTO imports
    (filename, fingerprint, imported_at, trade_count, added_count, updated_count, duplicate_count, warnings)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`);
  const alreadyImported = db.prepare('SELECT 1 FROM imports WHERE filename = ? AND fingerprint = ? LIMIT 1');

  return {
    hasImported(filename, fingerprint) {
      return Boolean(alreadyImported.get(filename, fingerprint));
    },

    importReport(report, filename, fingerprint) {
      const accountId = String(report.account?.id ?? '').trim();
      if (!accountId || !Array.isArray(report.trades) || !Array.isArray(report.cashFlows)) {
        throw new Error('报告缺少账户信息或交易数据。');
      }
      if (report.trades.some((trade) => !trade.id) || report.cashFlows.some((entry) => !entry.id)) {
        throw new Error('报告中的交易或资金流水缺少唯一标识。');
      }
      const warnings = (report.warnings ?? []).map(String);
      const importedAt = new Date().toISOString();
      let addedCount = 0;
      let updatedCount = 0;
      db.exec('BEGIN IMMEDIATE');
      try {
        const oldAccount = getAccount.get(accountId);
        const account = oldAccount ? JSON.parse(oldAccount.payload) : {};
        for (const [field, label] of [['server', '服务器'], ['currency', '币种']]) {
          const existing = identityValue(account[field]);
          const incoming = identityValue(report.account[field]);
          if (existing && incoming && existing.toLowerCase() !== incoming.toLowerCase()) {
            throw new Error(`账户 ${accountId} 的${label}冲突（已保存：${existing}，报告：${incoming}）。已拒绝整份报告，请核对是否来自不同账户。`);
          }
        }
        const olderReport = account.reportDate && report.account.reportDate
          && report.account.reportDate < account.reportDate;
        for (const [key, value] of Object.entries(report.account)) {
          if (value !== undefined && value !== null && identityValue(value) !== ''
            && (!olderReport || account[key] == null || account[key] === '')) account[key] = value;
        }
        account.id = accountId;
        insertAccount.run(accountId, JSON.stringify(account));
        for (const trade of report.trades) {
          const normalized = { ...trade, id: String(trade.id), accountId, sourceFile: filename };
          const row = findTrade.get(normalized.id);
          if (!row) {
            addedCount += Number(insertTrade.run(normalized.id, accountId, JSON.stringify(normalized)).changes);
            continue;
          }
          const previous = JSON.parse(row.payload);
          const changed = differentFields(previous, normalized, coreFields);
          if (!changed.length) continue;
          const changedOpenFields = differentFields(previous, normalized, openFields);
          if (!previous.closeTime && normalized.closeTime && !changedOpenFields.length) {
            updateTrade.run(JSON.stringify(normalized), normalized.id);
            updatedCount++;
          } else if (previous.closeTime && !normalized.closeTime) {
            warnings.push(`持仓 ${normalized.ticket} 已有平仓记录，忽略本次未平仓记录，保留已有交易与复盘。`);
          } else {
            warnings.push(`持仓 ${normalized.ticket} 的${changed.map((field) => fieldNames[field]).join('、')}与已有记录冲突，已忽略本次记录并保留已有交易与复盘。`);
          }
        }
        for (const cashFlow of report.cashFlows) {
          const normalized = { ...cashFlow, id: String(cashFlow.id), accountId };
          insertCash.run(normalized.id, accountId, JSON.stringify(normalized));
        }
        const duplicateCount = report.trades.length - addedCount - updatedCount;
        const result = insertImport.run(filename, fingerprint, importedAt, report.trades.length,
          addedCount, updatedCount, duplicateCount, JSON.stringify(warnings));
        db.exec('COMMIT');
        return { id: Number(result.lastInsertRowid), filename, importedAt,
          tradeCount: report.trades.length, addedCount, updatedCount, duplicateCount, warnings };
      } catch (error) {
        db.exec('ROLLBACK');
        throw error;
      }
    },

    getData() {
      const accounts = db.prepare('SELECT payload FROM accounts ORDER BY id').all().map((row) => JSON.parse(row.payload));
      const trades = db.prepare(`SELECT trades.payload, notes.payload AS note_payload FROM trades
        LEFT JOIN notes ON notes.trade_id = trades.id`).all().map((row) => ({
        ...JSON.parse(row.payload), note: row.note_payload ? JSON.parse(row.note_payload) : emptyNote(),
      })).sort((a, b) => String(b.closeTime ?? b.openTime ?? '').localeCompare(String(a.closeTime ?? a.openTime ?? '')));
      const cashFlows = db.prepare('SELECT payload FROM cash_flows').all().map((row) => JSON.parse(row.payload))
        .sort((a, b) => String(b.time ?? '').localeCompare(String(a.time ?? '')));
      const imports = db.prepare(`SELECT id, filename, imported_at AS importedAt, trade_count AS tradeCount,
        added_count AS addedCount, updated_count AS updatedCount, duplicate_count AS duplicateCount, warnings FROM imports
        ORDER BY id DESC LIMIT 100`).all().map((row) => ({ ...row, warnings: JSON.parse(row.warnings) }));
      return { accounts, trades, cashFlows, imports };
    },

    getTrade(id) {
      const row = findTrade.get(id);
      if (!row) return null;
      const note = findNote.get(id);
      return { ...JSON.parse(row.payload), note: note ? JSON.parse(note.payload) : emptyNote() };
    },

    updateNote(id, note) {
      if (!findTrade.get(id)) return null;
      const updated = { ...note, updatedAt: new Date().toISOString() };
      saveNote.run(id, JSON.stringify(updated));
      return updated;
    },

    close() {
      db.close();
    },
  };
}
