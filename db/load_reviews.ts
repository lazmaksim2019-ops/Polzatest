// ============================================================
// Задача 3: загрузка review.csv в review_import (сырое + нормализованное + флаги)
// Запуск: npm run db:load-reviews
// review.csv позиционируется как «свежая выгрузка для той же базы»,
// но по факту это другая выборка (другие id, другой состав). Ничего не мержим
// в companies — только импорт в отдельную таблицу + отчёт по аномалиям.
// ============================================================

import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { loadEnv } from './lib/env.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
loadEnv(path.join(root, '.env'));

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL не задан.');
  process.exit(1);
}

// ---------- простой CSV-парсер с поддержкой кавычек ----------
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else inQuotes = false;
      } else field += ch;
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      row.push(field);
      field = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(field);
      field = '';
      rows.push(row);
      row = [];
    } else field += ch;
  }
  if (field !== '' || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

// ---------- нормализация + флаги ----------
const SITE_RE = /^https?:\/\/\S+\.\S+/i;
const PHONE_RE = /^\+7 \(\d{3}\) \d{3}-\d{2}-\d{2}$/;
// Сигнатура CP1251-мусора: редкие кириллические буквы (серб./укр.), которых нет в русском тексте.
// «РћРћРћ» (ООО в UTF-8, прочитанное как CP1251) = Р + ћ (U+045B).
const MOJIBAKE_RE = /[\u0402\u0403\u0404\u0405\u0406\u0407\u0408\u0409\u040A\u040B\u040C\u040E\u0452\u0453\u0454\u0455\u0456\u0457\u0458\u0459\u045A\u045B\u045C\u045E]/;

interface Norm {
  rating: number | null;
  reviews: number | null;
  site: string | null;
  phone: string | null;
  issues: string[];
}

function normRow(raw: string[]): Norm {
  const issues: string[] = [];
  const [id, name, category, city, address, ratingRaw, reviewsRaw, siteRaw, phoneRaw] = raw;
  const norm: Norm = { rating: null, reviews: null, site: null, phone: null, issues };

  for (const [label, v] of [['id', id], ['name', name], ['category', category], ['city', city]] as const) {
    if (!v || !v.trim()) issues.push(`${label}_empty`);
    if (MOJIBAKE_RE.test(v ?? '')) issues.push(`mojibake_${label}`);
  }

  // рейтинг
  const rs = (ratingRaw ?? '').trim().replace(',', '.');
  if (rs && !/^n\/?a$/i.test(rs)) {
    const n = Number(rs);
    if (!Number.isFinite(n)) issues.push('rating_not_numeric');
    else if (n < 1 || n > 5) issues.push('rating_out_of_range');
    else if ((ratingRaw ?? '').includes(',')) {
      issues.push('rating_comma_decimal');
      norm.rating = n;
    } else norm.rating = n;
  }

  // число отзывов
  const cvs = (reviewsRaw ?? '').trim();
  if (cvs) {
    const n = Number(cvs);
    if (!Number.isFinite(n) || !Number.isInteger(n)) issues.push('reviews_not_integer');
    else if (n < 0) issues.push('reviews_negative');
    else norm.reviews = n;
  }

  // сайт
  const st = (siteRaw ?? '').trim();
  if (st) {
    if (/^https?:\/\/\S+\.\S+$/i.test(st)) norm.site = st;
    else if (/^htp:\/\//i.test(st)) issues.push('site_missing_scheme');
    else if (/^https?:\/\/\s*$/.test(st)) issues.push('site_empty_domain');
    else issues.push('site_not_url');
  }

  // телефон
  const pt = (phoneRaw ?? '').trim();
  if (pt) {
    if (PHONE_RE.test(pt)) norm.phone = pt;
    else if (/[a-zA-Zа-яА-Я]/.test(pt)) issues.push('phone_has_letters');
    else if (pt === '+7' || pt.length < 10) issues.push('phone_truncated');
    else issues.push('phone_bad_format');
  }

  return norm;
}

// ---------- чтение ----------
const text = await readFile(path.join(root, 'data', 'review.csv'), 'utf8');
const rows = parseCsv(text);
if (rows.length === 0) {
  console.error('review.csv пуст');
  process.exit(1);
}
const header = rows[0];
console.log('Заголовок CSV:', header.join(', '));

const client = new pg.Client({ connectionString: url });
await client.connect();

await client.query('DELETE FROM review_import'); // идемпотентность

const INSERT_SQL = `
  INSERT INTO review_import
     (row_num, id, name, category, city, address, rating_raw, rating,
      reviews_raw, reviews_count, site_raw, site, phone_raw, phone, issues)
   VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`;

let n = 0;
let nEmpty = 0;
const seenIds = new Map<string, number>(); // id -> сколько раз
const dupIds: string[] = [];
const issueHisto = new Map<string, number>();

for (let i = 1; i < rows.length; i++) {
  const raw = rows[i];
  if (raw.length < 9) raw.length = 9;
  if (!raw.some((c) => c && c.trim())) {
    nEmpty += 1; // пустая строка-хвост
    continue;
  }
  const rowNum = i + 1; // 1-based номер строки файла (строка 1 = заголовок)
  const id = (raw[0] ?? '').trim();
  if (seenIds.has(id)) dupIds.push(id);
  seenIds.set(id, (seenIds.get(id) ?? 0) + 1);

  const norm = normRow(raw);
  for (const iss of norm.issues) issueHisto.set(iss, (issueHisto.get(iss) ?? 0) + 1);

  await client.query(INSERT_SQL, [
    rowNum, id, raw[1] ?? null, raw[2] ?? null, raw[3] ?? null, raw[4] ?? null,
    raw[5] ?? null, norm.rating, raw[6] ?? null, norm.reviews,
    raw[7] ?? null, norm.site, raw[8] ?? null, norm.phone, norm.issues,
  ]);
  n += 1;
}

// ---------- отчёт ----------
const overlap = await client.query(
  `SELECT count(*)::int AS cnt FROM review_import r JOIN companies c ON c.id = r.id`,
);
const sharedSites = await client.query(
  `SELECT site, count(*)::int AS cnt FROM review_import WHERE site IS NOT NULL
   GROUP BY site HAVING count(*) > 1 ORDER BY cnt DESC`,
);

console.log('\n=== Отчёт review.csv (Задача 3) ===');
console.log(`Строк в CSV (включая заголовок): ${rows.length}`);
console.log(`Загружено непустых строк:        ${n}`);
console.log(`Пустых строк-хвостов:            ${nEmpty}`);
console.log(`Уникальных id:                   ${seenIds.size}`);
console.log(`Дублей id:                       ${dupIds.length} -> ${[...new Set(dupIds)].join(', ')}`);
console.log(`id, совпадающих с companies:     ${overlap.rows[0].cnt}`);
console.log('\nПроблемы (флаг -> сколько строк):');
for (const [k, v] of [...issueHisto.entries()].sort((a, b) => b[1] - a[1])) {
  console.log(`  ${k}: ${v}`);
}
console.log('\nСайты, встречающиеся у >1 компании:');
for (const r of sharedSites.rows) console.log(`  ${r.site} (${r.cnt})`);

await client.end();
