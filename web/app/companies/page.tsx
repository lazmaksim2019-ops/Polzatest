import Link from 'next/link';
import { pool } from '@/lib/db';

export const dynamic = 'force-dynamic';

const PER_PAGE = 25;

type SearchParams = Promise<{ q?: string; city?: string; page?: string }>;

interface Row {
  id: string;
  name: string;
  category: string;
  city: string;
  address: string | null;
  rating: string | null;
  reviews_count: number | null;
  site: string | null;
  phone: string | null;
}

function ratingClass(r: string | null): string {
  if (!r) return '';
  const n = parseFloat(r);
  if (n >= 4.0) return 'rating-high';
  if (n >= 3.0) return 'rating-mid';
  return 'rating-low';
}

function stars(r: string | null): string {
  if (!r) return '';
  const n = Math.round(parseFloat(r));
  return '★'.repeat(n) + '☆'.repeat(5 - n);
}

export default async function CompaniesPage({ searchParams }: { searchParams: SearchParams }) {
  const sp = await searchParams;
  const q = (sp.q ?? '').trim();
  const city = (sp.city ?? '').trim();
  const page = Math.max(1, Number.parseInt(sp.page ?? '1', 10) || 1);

  const like = `%${q.replace(/[\\%_]/g, (m) => '\\' + m)}%`;

  const params: string[] = [];
  const where: string[] = [];
  if (q) {
    params.push(like);
    where.push(`co.name ILIKE $${params.length} ESCAPE '\\'`);
  }
  if (city) {
    params.push(city);
    where.push(`ci.name = $${params.length}`);
  }
  const whereSql = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';

  const [rowsRes, totalRes, citiesRes] = await Promise.all([
    pool.query<Row>(
      `SELECT co.id, co.name, c.name AS category, ci.name AS city,
              co.address, co.rating, co.reviews_count, co.site, co.phone
       FROM companies co
       JOIN categories c ON c.id = co.category_id
       JOIN cities ci ON ci.id = co.city_id
       ${whereSql}
       ORDER BY co.name
       LIMIT ${PER_PAGE} OFFSET ${(page - 1) * PER_PAGE}`,
      params,
    ),
    pool.query<{ n: number }>(
      `SELECT count(*)::int AS n
       FROM companies co
       JOIN cities ci ON ci.id = co.city_id
       ${whereSql}`,
      params,
    ),
    pool.query<{ name: string }>(`SELECT name FROM cities ORDER BY name`),
  ]);

  const rows = rowsRes.rows;
  const total = totalRes.rows[0].n;
  const cities = citiesRes.rows.map((r) => r.name);
  const pages = Math.max(1, Math.ceil(total / PER_PAGE));

  const pageLink = (p: number) => {
    const sp2 = new URLSearchParams();
    if (q) sp2.set('q', q);
    if (city) sp2.set('city', city);
    if (p > 1) sp2.set('page', String(p));
    const qs = sp2.toString();
    return `/companies${qs ? `?${qs}` : ''}`;
  };

  return (
    <main className="container">
      <div className="page-header">
        <h1>Компании</h1>
        <p className="subtitle">
          <strong>{total.toLocaleString('ru-RU')}</strong> компаний в базе
          {' · '}страница {page} из {pages}
        </p>
      </div>

      <form method="get" action="/companies" className="filters">
        <input
          type="text"
          name="q"
          defaultValue={q}
          placeholder="Поиск по названию…"
          aria-label="Поиск по названию"
        />
        <select name="city" defaultValue={city} aria-label="Фильтр по городу">
          <option value="">Все города</option>
          {cities.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
        <button type="submit">Найти</button>
        {(q || city) && (
          <Link href="/companies" className="reset-link">
            Сбросить
          </Link>
        )}
      </form>

      {rows.length === 0 ? (
        <div className="empty">
          <div className="empty-icon">🔍</div>
          <div>Ничего не найдено. Попробуйте изменить запрос.</div>
        </div>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th scope="col">Название</th>
                <th scope="col">Категория</th>
                <th scope="col">Город</th>
                <th scope="col">Рейтинг</th>
                <th scope="col">Отзывы</th>
                <th scope="col">Сайт</th>
                <th scope="col">Телефон</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td>
                    <div className="company-name">{r.name}</div>
                    {r.address && (
                      <div className="company-address">{r.address}</div>
                    )}
                  </td>
                  <td>
                    <span className="badge">{r.category}</span>
                  </td>
                  <td>{r.city}</td>
                  <td>
                    <span className={`rating ${ratingClass(r.rating)}`}>
                      {r.rating ?? '—'}
                    </span>
                    {r.rating && (
                      <span className="stars" aria-hidden="true">{stars(r.rating)}</span>
                    )}
                  </td>
                  <td>
                    <span className="reviews">
                      {r.reviews_count != null ? r.reviews_count.toLocaleString('ru-RU') : '—'}
                    </span>
                  </td>
                  <td>
                    {r.site ? (
                      <a className="site" href={r.site} target="_blank" rel="noreferrer">
                        {r.site.replace(/^https?:\/\//, '')}
                      </a>
                    ) : (
                      <span className="muted">—</span>
                    )}
                  </td>
                  <td>
                    <span className="phone">{r.phone ?? '—'}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="meta">
        <span>
          Показано {rows.length} из {total.toLocaleString('ru-RU')}
        </span>
        <nav className="pagination" aria-label="Пагинация">
          {page > 1 && (
            <Link href={pageLink(page - 1)} aria-label="Предыдущая страница">
              ←
            </Link>
          )}
          {Array.from({ length: pages }, (_, i) => i + 1)
            .filter((p) => p === 1 || p === pages || Math.abs(p - page) <= 2)
            .reduce<(number | 'ellipsis')[]>((acc, p, i, arr) => {
              if (i > 0 && p - (arr[i - 1] as number) > 1) acc.push('ellipsis');
              acc.push(p);
              return acc;
            }, [])
            .map((item, i) =>
              item === 'ellipsis' ? (
                <span key={`e${i}`} className="muted" style={{ padding: '0 4px' }}>
                  …
                </span>
              ) : item === page ? (
                <span key={item} className="current" aria-current="page">
                  {item}
                </span>
              ) : (
                <Link key={item} href={pageLink(item)}>
                  {item}
                </Link>
              ),
            )}
          {page < pages && (
            <Link href={pageLink(page + 1)} aria-label="Следующая страница">
              →
            </Link>
          )}
        </nav>
      </div>
    </main>
  );
}
