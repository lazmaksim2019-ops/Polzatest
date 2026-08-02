-- ============================================================
-- Polza Agency — тестовое задание
-- schema.sql: PostgreSQL схема базы компаний (Задача 1)
-- Применяется: npm run db:migrate  (см. README)
-- ============================================================

CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Справочник категорий (нормализация: одна строка на категорию)
CREATE TABLE IF NOT EXISTS categories (
    id   serial PRIMARY KEY,
    name text NOT NULL UNIQUE
);

-- Справочник городов (нормализация: одна строка на город)
CREATE TABLE IF NOT EXISTS cities (
    id   serial PRIMARY KEY,
    name text NOT NULL UNIQUE
);

-- Компании. Чистые данные из page_*.json (Задача 1).
-- Дедупликация обеспечивается PRIMARY KEY по id + ON CONFLICT в загрузчике.
CREATE TABLE IF NOT EXISTS companies (
    id            text PRIMARY KEY,          -- c_000001
    name          text NOT NULL,
    category_id   integer NOT NULL REFERENCES categories(id),
    city_id       integer NOT NULL REFERENCES cities(id),
    address       text,
    rating        numeric(2,1) CHECK (rating IS NULL OR (rating >= 1 AND rating <= 5)),
    reviews_count integer CHECK (reviews_count IS NULL OR reviews_count >= 0),
    site          text CHECK (site IS NULL OR site ~ '^https?://'),
    phone         text,
    email         text CHECK (email IS NULL OR email ~ '@'),  -- в выгрузке нет email, колонка на будущее
    source        text NOT NULL DEFAULT 'json' CHECK (source IN ('json', 'review_csv')),
    created_at    timestamptz NOT NULL DEFAULT now()
);

-- Индексы: поиск по названию (Задача 2), фильтры по городу/категории
CREATE INDEX IF NOT EXISTS idx_companies_name_lower ON companies (lower(name));
CREATE INDEX IF NOT EXISTS idx_companies_city       ON companies (city_id);
CREATE INDEX IF NOT EXISTS idx_companies_category   ON companies (category_id);
CREATE INDEX IF NOT EXISTS idx_companies_site       ON companies (site) WHERE site IS NOT NULL;

-- review.csv (Задача 3): сырые данные + нормализованные + флаги проблем.
-- Держим отдельно от чистой таблицы companies, чтобы не смешивать грязный импорт.
CREATE TABLE IF NOT EXISTS review_import (
    row_num       integer PRIMARY KEY,        -- номер строки CSV (1-based)
    id            text,
    name          text,
    category      text,
    city          text,
    address       text,
    rating_raw    text,
    rating        numeric(2,1),
    reviews_raw   text,
    reviews_count integer,
    site_raw      text,
    site          text,
    phone_raw     text,
    phone         text,
    issues        text[] NOT NULL DEFAULT '{}'
);

CREATE INDEX IF NOT EXISTS idx_review_import_id ON review_import (id);
