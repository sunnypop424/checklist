/**
 * supabase/schema.sql 을 Supabase Postgres 에 직접 실행한다.
 *   npm run db:setup
 * .env.local 의 SUPABASE_DB_URL 이 필요하다.
 */
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

// .env.local 로드 (의존성 없이 직접 파싱)
const envPath = resolve(root, '.env.local');
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (!m) continue;
    let v = m[2].trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    if (!process.env[m[1]]) process.env[m[1]] = v;
  }
}

const dbUrl = process.env.SUPABASE_DB_URL;
if (!dbUrl) {
  console.error(`
❌ SUPABASE_DB_URL 이 없습니다.

Supabase 대시보드 > Project Settings > Database > Connection string > URI 를 복사해서
.env.local 에 아래처럼 넣어주세요 (비밀번호 부분을 실제 DB 비밀번호로 교체):

SUPABASE_DB_URL=postgresql://postgres.xxxxxxxx:비밀번호@aws-0-ap-northeast-2.pooler.supabase.com:5432/postgres
`);
  process.exit(1);
}

// schema.sql 먼저, 그다음 팰월드 트래커. 순서가 중요하다 —
// schema-pal.sql 이 참조하는 것은 없지만, 접합부(lists.source/items.ref)가
// 먼저 있어야 db:setup 한 번으로 전체가 일관되게 선다.
const SCHEMA_FILES = ['supabase/schema.sql', 'supabase/schema-pal.sql'];

/**
 * 비밀번호에 @ # $ % 같은 특수문자가 그대로 들어있어도 파싱되도록
 * 표준 URL 파서를 쓰지 않고 직접 쪼갠다 (호스트 앞의 마지막 @ 가 구분자).
 */
function parseConnectionString(raw) {
  const s = raw.trim().replace(/^["']|["']$/g, '');
  const m = s.match(/^postgres(?:ql)?:\/\/(.*)$/i);
  if (!m) throw new Error('postgresql:// 로 시작해야 합니다.');

  const rest = m[1];
  const at = rest.lastIndexOf('@');
  if (at === -1) throw new Error('사용자·비밀번호 구분자(@)를 찾을 수 없습니다.');

  const userinfo = rest.slice(0, at);
  const hostPart = rest.slice(at + 1);

  const colon = userinfo.indexOf(':');
  const user = colon === -1 ? userinfo : userinfo.slice(0, colon);
  const password = colon === -1 ? '' : userinfo.slice(colon + 1);

  const [hostPort, dbAndQuery = 'postgres'] = hostPart.split('/');
  const database = dbAndQuery.split('?')[0] || 'postgres';
  const lastColon = hostPort.lastIndexOf(':');
  const host = lastColon === -1 ? hostPort : hostPort.slice(0, lastColon);
  const port = lastColon === -1 ? 5432 : Number(hostPort.slice(lastColon + 1));

  return {
    user: decodeURIComponent(user),
    password: /%[0-9A-Fa-f]{2}/.test(password) ? decodeURIComponent(password) : password,
    host,
    port,
    database,
  };
}

const cfg = parseConnectionString(dbUrl);
console.log(`→ ${cfg.host}:${cfg.port} / ${cfg.database} (user: ${cfg.user})`);

const client = new pg.Client({ ...cfg, ssl: { rejectUnauthorized: false } });

try {
  await client.connect();
  console.log('✔ Supabase 연결됨');

  for (const file of SCHEMA_FILES) {
    const path = resolve(root, file);
    if (!existsSync(path)) {
      console.log(`· ${file} 없음 — 건너뜀`);
      continue;
    }
    await client.query(readFileSync(path, 'utf8'));
    console.log(`✔ ${file} 적용 완료`);
  }

  const { rows: pub } = await client.query(
    `select tablename from pg_publication_tables
      where pubname='supabase_realtime' and schemaname='public' order by tablename`
  );
  console.log('✔ Realtime publication:', pub.map((r) => r.tablename).join(', ') || '(없음)');

  const { rows: ident } = await client.query(
    `select relname, relreplident from pg_class
      where relname in ('lists','items') and relnamespace='public'::regnamespace`
  );
  for (const r of ident) {
    console.log(`  - ${r.relname} replica identity: ${r.relreplident === 'f' ? 'full ✔' : r.relreplident + ' ✖ (full 이어야 함)'}`);
  }

  // 리스트가 하나도 없으면 샘플 하나 만들어 준다
  const { rows: count } = await client.query('select count(*)::int as n from public.lists');
  if (count[0].n === 0) {
    const { rows } = await client.query(
      `insert into public.lists (title) values ('오늘의 목표') returning id`
    );
    const id = rows[0].id;
    await client.query(
      `insert into public.items (list_id, label, position) values
        ($1,'첫 번째 항목',0), ($1,'두 번째 항목',1), ($1,'세 번째 항목',2)`,
      [id]
    );
    console.log(`✔ 샘플 체크리스트 생성됨 — 오버레이 URL 경로: /o/${id}`);
  } else {
    const { rows } = await client.query('select id, title from public.lists order by sort, created_at');
    console.log('✔ 기존 체크리스트:');
    for (const r of rows) console.log(`  - ${r.title}  →  /o/${r.id}`);
  }
} catch (e) {
  console.error('❌ 실패:', e.message);
  process.exit(1);
} finally {
  await client.end();
}
