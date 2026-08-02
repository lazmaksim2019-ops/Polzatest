-- ============================================================
-- Задача 1: 3 SQL-запроса к таблице companies
-- Запуск: psql "$DATABASE_URL" -f db/queries.sql
-- (или: docker compose exec db psql -U polza -d polza -f /dev/stdin < db/queries.sql)
-- ============================================================

-- 1. Топ-5 категорий по числу компаний
SELECT c.name        AS category,
       COUNT(*)::int AS companies
FROM companies co
JOIN categories c ON c.id = co.category_id
GROUP BY c.name
ORDER BY companies DESC
LIMIT 5;

-- 2. Средний рейтинг по городам среди компаний с 10+ отзывами
SELECT ci.name                              AS city,
       ROUND(AVG(co.rating)::numeric, 2)    AS avg_rating,
       COUNT(*)::int                        AS companies
FROM companies co
JOIN cities ci ON ci.id = co.city_id
WHERE co.reviews_count >= 10
  AND co.rating IS NOT NULL
GROUP BY ci.name
ORDER BY avg_rating DESC, companies DESC;

-- 3. Доля компаний с сайтом по категориям
SELECT c.name                                    AS category,
       COUNT(*)::int                             AS companies,
       COUNT(co.site)::int                       AS with_site,
       ROUND(100.0 * COUNT(co.site) / COUNT(*), 1) AS share_pct
FROM companies co
JOIN categories c ON c.id = co.category_id
GROUP BY c.name
ORDER BY share_pct DESC, companies DESC;
