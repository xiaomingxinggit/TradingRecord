import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createPlanStore } from './plans.mjs';
import { createReviewStore } from './review-store.mjs';

export function createStore(dataDir) {
  mkdirSync(dataDir, { recursive: true });
  // Reuse the existing file and leave unrelated historical tables untouched.
  const db = new DatabaseSync(join(dataDir, 'trading.sqlite'));
  try {
    db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
    let reviews;
    const plans = createPlanStore(db, id => reviews.snapshot(id));
    reviews = createReviewStore(db, plans);
    return { plans, reviews, close: () => db.close() };
  } catch (error) {
    db.close();
    throw error;
  }
}
