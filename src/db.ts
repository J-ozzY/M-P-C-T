import Database from 'better-sqlite3';
import path from 'path';

const DB_PATH = path.join(__dirname, '..', 'mpct.db');

let db: Database.Database;

export function getDb(): Database.Database {
  if (!db) {
    db = new Database(DB_PATH);
    db.pragma('journal_mode = WAL');
    initializeSchema();
  }
  return db;
}

function initializeSchema(): void {
  const database = db;

  database.exec(`
    CREATE TABLE IF NOT EXISTS cards (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS search_results (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      card_id INTEGER NOT NULL,
      shop TEXT NOT NULL,
      price_min REAL,
      price_max REAL,
      currency TEXT DEFAULT 'CZK',
      in_stock INTEGER DEFAULT 0,
      url TEXT,
      searched_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (card_id) REFERENCES cards(id)
    );

    CREATE INDEX IF NOT EXISTS idx_search_results_card_id
      ON search_results(card_id);

    CREATE INDEX IF NOT EXISTS idx_search_results_shop
      ON search_results(shop);

    CREATE TABLE IF NOT EXISTS card_images (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      card_name TEXT NOT NULL UNIQUE,
      image_url TEXT,
      fetched_at TEXT DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_card_images_card_name
      ON card_images(card_name);
  `);
}

export function getOrCreateCard(name: string): number {
  const database = getDb();

  const existing = database
    .prepare('SELECT id FROM cards WHERE name = ?')
    .get(name) as { id: number } | undefined;

  if (existing) {
    return existing.id;
  }

  const result = database
    .prepare('INSERT INTO cards (name) VALUES (?)')
    .run(name);

  return result.lastInsertRowid as number;
}

export interface SearchResultRow {
  id: number;
  card_id: number;
  card_name: string;
  shop: string;
  price_min: number | null;
  price_max: number | null;
  currency: string;
  in_stock: number;
  url: string | null;
  searched_at: string;
}

export function saveSearchResult(
  cardId: number,
  shop: string,
  priceMin: number | null,
  priceMax: number | null,
  inStock: number,
  url: string | null,
  currency: string = 'CZK'
): void {
  const database = getDb();

  // Delete old results for this card+shop combination
  database
    .prepare('DELETE FROM search_results WHERE card_id = ? AND shop = ?')
    .run(cardId, shop);

  database
    .prepare(
      `INSERT INTO search_results (card_id, shop, price_min, price_max, currency, in_stock, url)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
    .run(cardId, shop, priceMin, priceMax, currency, inStock, url);
}

export function getLatestResults(): SearchResultRow[] {
  const database = getDb();

  return database
    .prepare(
      `SELECT sr.id, sr.card_id, c.name as card_name, sr.shop,
              sr.price_min, sr.price_max, sr.currency, sr.in_stock,
              sr.url, sr.searched_at
       FROM search_results sr
       JOIN cards c ON c.id = sr.card_id
       ORDER BY c.name, sr.shop`
    )
    .all() as SearchResultRow[];
}

export function getResultsForCards(cardNames: string[]): SearchResultRow[] {
  const database = getDb();

  if (cardNames.length === 0) return [];

  const placeholders = cardNames.map(() => '?').join(',');
  return database
    .prepare(
      `SELECT sr.id, sr.card_id, c.name as card_name, sr.shop,
              sr.price_min, sr.price_max, sr.currency, sr.in_stock,
              sr.url, sr.searched_at
       FROM search_results sr
       JOIN cards c ON c.id = sr.card_id
       WHERE c.name IN (${placeholders})
       ORDER BY c.name, sr.shop`
    )
    .all(...cardNames) as SearchResultRow[];
}

export function clearAllResults(): void {
  const database = getDb();
  database.exec('DELETE FROM search_results');
  database.exec('DELETE FROM cards');
  database.exec('DELETE FROM card_images');
}

// ---- Card Images ----

export interface CardImageRow {
  id: number;
  card_name: string;
  image_url: string | null;
  fetched_at: string;
}

export function saveCardImage(
  cardName: string,
  imageUrl: string
): void {
  const database = getDb();

  database
    .prepare(
      `INSERT INTO card_images (card_name, image_url)
       VALUES (?, ?)
       ON CONFLICT(card_name) DO UPDATE SET
         image_url = excluded.image_url,
         fetched_at = datetime('now')`
    )
    .run(cardName, imageUrl);
}

export function getCardImage(cardName: string): CardImageRow | undefined {
  const database = getDb();

  return database
    .prepare('SELECT * FROM card_images WHERE card_name = ?')
    .get(cardName) as CardImageRow | undefined;
}

export function getCardImagesByNames(cardNames: string[]): CardImageRow[] {
  const database = getDb();

  if (cardNames.length === 0) return [];

  const placeholders = cardNames.map(() => '?').join(',');
  return database
    .prepare(
      `SELECT * FROM card_images WHERE card_name IN (${placeholders})`
    )
    .all(...cardNames) as CardImageRow[];
}
