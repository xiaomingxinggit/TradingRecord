import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createPlanStore } from './plans.mjs';
import { createReviewStore } from './review-store.mjs';
import { createPracticeStore } from './practice.mjs';

export function createStore(dataDir) {
  mkdirSync(dataDir, { recursive: true });
  // Reuse the existing file and leave unrelated historical tables untouched.
  const db = new DatabaseSync(join(dataDir, 'trading.sqlite'));
  try {
    db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
    let reviews, practice;
    const plans = createPlanStore(db, id => reviews.snapshot(id), () => practice.exportSnapshot());
    reviews = createReviewStore(db, plans);
    practice = createPracticeStore(db);
    return { plans, reviews, practice, close: () => db.close() };
  } catch (error) {
    db.close();
    throw error;
  }
}
