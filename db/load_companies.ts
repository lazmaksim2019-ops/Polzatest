// ============================================================
// Задача 1: загрузка page_*.json (внутренний API выгрузка) в Postgres
// Запуск: npm run db:load
// Что делает:
//   - читает все data/page_*.json;
//   - нормализует поля (trim, rating, site, числа);
//   - дедуплицирует по id (в выгрузке 6 дублей) через ON CONFLICT;
//   - заполняет справочники categories/cities;
//   - печатает отчёт: строк / уникальных / вставлено / пропуски.
// ============================================================

import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { loadEnv } from './lib/env.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
loadEnv(path.join(root, '.env'));

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL не задан. Скопируйте .env.example в .env.');
  process.exit(1);
}

// ---------- нормализация ----------
const SITE_RE = /^https?:\/\/\S+\.\S+/i;

function normSite(s: unknown): string | null {
  if (s === null || s === undefined) return null;
  const t = String(s).trim();
  return t && SITE_RE.test(t) ? t : null;
}

function normRating(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  const s = String(v).trim().replace(',', '.');
  if (!s || /^n\/?a$/i.test(s)) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

function normCount(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  const n = Number(String(v).trim());
  return Number.isInteger(n) ? n : null;
}

// ---------- чтение данных ----------
const files = (await readdir(path.join(root, 'data')))
  .filter((f) => /^page_\d{3}\.json$/.test(f))
  .sort();

const rawItems: { id: string; page: string }[] = [];
const stats = {
  totalRows: 0,
  uniqueIds: 0,
  dupIds: 0,
  missingSite: 0,
  missingPhone: 0,
  missingRating: 0,
  missingCity: 0,
};

for (const f of files) {
  const data = JSON.parse(await readFile(path.join(root, 'data', f), 'utf8')) as {
    items: Record<string, unknown>[];
  };
  for (const it of data.items) {
    stats.totalRows += 1;
    rawItems.push({ id: String(it.id), page: f });
  }
}

// дедупликация по id (в выгрузке 6 id повторяются на разных страницах)
const seen = new Set<string>();
const unique = new Set<string>();
for (const r of rawItems) {
  if (seen.has(r.id)) stats.dupIds += 1;
  else {
    seen.add(r.id);
    unique.add(r.id);
  }
}
stats.uniqueIds = unique.size;

// ---------- загрузка ----------
const client = new pg.Client({ connectionString: url });
await client.connect();

const UPSERT_CATEGORY = `
  INSERT INTO categories (name) VALUES ($1)
  ON CONFLICT (name) DO UPDATE SET name = EXCLUDED.name
  RETURNING id`;
const UPSERT_CITY = `
  INSERT INTO cities (name) VALUES ($1)
  ON CONFLICT (name) DO UPDATE SET name = EXCLUDED.name
  RETURNING id`;
const INSERT_COMPANY = `
  INSERT INTO companies (id, name, category_id, city_id, address, rating, reviews_count, site, phone, source)
  VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'json')
  ON CONFLICT (id) DO NOTHING`;

const catId = new Map<string, number>();
const cityId = new Map<string, number>();

async function idFor(map: Map<string, number>, sql: string, name: string): Promise<number> {
  let v = map.get(name);
  if (v === undefined) {
    const res = await client.query(sql, [name]);
    v = res.rows[0].id as number;
    map.set(name, v);
  }
  return v;
}

let inserted = 0;
let skippedDup = 0;

await client.query('BEGIN');
try {
  for (const f of files) {
    const data = JSON.parse(await readFile(path.join(root, 'data', f), 'utf8')) as {
      items: Record<string, unknown>[];
    };
    for (const it of data.items) {
      if (!unique.has(String(it.id))) {
        skippedDup += 1; // дубль id, уже был
        continue;
      }
      const name = String(it.name ?? '').trim();
      const city = String(it.city ?? '').trim();
      if (!name || !city) {
        if (!city) stats.missingCity += 1;
        continue;
      }
      const site = normSite(it.site);
      const rating = normRating(it.rating);
      const reviews = normCount(it.reviews_count);
      const phone = it.phone == null ? null : String(it.phone).trim() || null;
      if (!site) stats.missingSite += 1;
      if (!phone) stats.missingPhone += 1;
      if (rating === null) stats.missingRating += 1;

      const cid = await idFor(catId, UPSERT_CATEGORY, String(it.category ?? '').trim() || 'Без категории');
      const cityI = await idFor(cityId, UPSERT_CITY, city);
      const res = await client.query(INSERT_COMPANY, [String(it.id), name, cid, cityI, it.address ?? null, rating, reviews, site, phone]);
      if (res.rowCount === 1) inserted += 1;
      else skippedDup += 1;
      unique.delete(String(it.id)); // не обрабатывать повторно
    }
  }
  await client.query('COMMIT');
} catch (e) {
  await client.query('ROLLBACK');
  throw e;
}

await client.end();

// ---------- отчёт ----------
console.log('=== Отчёт загрузки (Задача 1) ===');
console.log(`Файлов прочитано:            ${files.length}`);
console.log(`Строк в выгрузке:            ${stats.totalRows}`);
console.log(`Уникальных id:               ${stats.uniqueIds}`);
console.log(`Дублей id в JSON:            ${stats.dupIds}`);
console.log(`Вставлено в companies:       ${inserted}`);
console.log(`Пропущено/повторно:          ${skippedDup}`);
console.log(`Компаний без сайта:          ${stats.missingSite}`);
console.log(`Компаний без телефона:       ${stats.missingPhone}`);
console.log(`Компаний без рейтинга:       ${stats.missingRating}`);
