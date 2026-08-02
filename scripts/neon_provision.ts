// ============================================================
// Провижининг бесплатной Neon-базы (Vercel-совместимый Postgres).
// Запуск: NEON_API_KEY=napi_xxx npm run db:neon-provision
// Что делает:
//   - находит или создаёт проект Neon "polza" (регион aws-eu-central-1);
//   - печатает pooled connection string (для Vercel, sslmode=require).
// Никаких секретов в репозиторий не пишется — строка только в stdout.
// ============================================================

const API = 'https://console.neon.tech/api/v2'; // Neon перенёс API с api.neon.tech на console.neon.tech
const key = process.env.NEON_API_KEY;
if (!key) {
  console.error('NEON_API_KEY не задан. Создайте API key: neon.tech → Developer Settings → API Keys.');
  process.exit(1);
}

const headers = {
  Authorization: `Bearer ${key}`,
  'Content-Type': 'application/json',
};

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API}${path}`, { ...init, headers });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Neon API ${res.status} на ${path}: ${body.slice(0, 300)}`);
  }
  return res.json() as Promise<T>;
}

// --- найти или создать проект ---
const { projects } = await api<{ projects: { id: string; name: string }[] }>('/projects');
let project = projects.find((p) => p.name === 'polza');

if (!project) {
  console.log('Создаю проект Neon "polza" (aws-eu-central-1)...');
  const created = await api<{ project: { id: string; name: string } }>('/projects', {
    method: 'POST',
    body: JSON.stringify({ project: { name: 'polza', region_id: 'aws-eu-central-1' } }),
  });
  project = created.project;
  // эндпоинты появляются с задержкой — даём Neon пару секунд
  await new Promise((r) => setTimeout(r, 4000));
}
console.log(`Проект: ${project.name} (${project.id})`);

// --- строка подключения (default роль/бд) ---
const uris = await api<{ connection_uris: { connection_uri: string }[] }>(
  `/projects/${project.id}/connection_uris?role_name=neondb&database_name=neondb`,
);
const direct = uris.connection_uris[0]?.connection_uri;
if (!direct) {
  console.error('Не удалось получить connection uri');
  process.exit(1);
}

// pooled-хост: ep-xxx.<region>.aws.neon.tech -> ep-xxx-pooler.<region>.aws.neon.tech
const [head, ...rest] = direct.split('@');
const host = rest.join('@').split('/')[0];
const dbName = direct.split('/').pop() ?? 'neondb';
const pooledHost = host.replace(/(\.)([a-z]+-[a-z]+-[0-9]+\.aws\.neon\.tech)$/, '-pooler$1$2');

console.log('\n=== ПОДКЛЮЧЕНИЕ (скопируйте при необходимости) ===');
console.log(`postgres://${head}@${pooledHost}:5432/${dbName}?sslmode=require`);
console.log('=== /ПОДКЛЮЧЕНИЕ ===\n');
console.log('Direct (не pooled):', direct + '?sslmode=require');
