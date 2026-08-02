import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { loadEnv } from './lib/env.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
loadEnv(path.join(root, '.env'));

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL не задан. Скопируйте .env.example в .env и при необходимости поправьте.');
  process.exit(1);
}

const client = new pg.Client({ connectionString: url });
await client.connect();

if (process.argv.includes('--reset')) {
  await client.query('DROP TABLE IF EXISTS review_import, companies, cities, categories CASCADE');
  console.log('--reset: таблицы удалены');
}

const schema = await readFile(path.join(root, 'db', 'schema.sql'), 'utf8');
await client.query(schema);
console.log('schema.sql применён');
await client.end();
