/**
 * 로컬 개발 서버(http://localhost:3000)를 대상으로 하는 종단 스모크 테스트.
 *   npm run smoke
 */
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const envPath = resolve(root, '.env.local');
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
  }
}

const BASE = process.env.SMOKE_BASE_URL || 'http://localhost:3000';
const KEY = process.env.CONTROL_KEY;
const SB = process.env.NEXT_PUBLIC_SUPABASE_URL;
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

let failures = 0;
const check = (label, ok, detail = '') => {
  console.log(`${ok ? '✔' : '✖'} ${label}${detail ? '  — ' + detail : ''}`);
  if (!ok) failures++;
};

const rest = async (path) => {
  const res = await fetch(`${SB}/rest/v1/${path}`, {
    headers: { apikey: ANON, Authorization: `Bearer ${ANON}` },
  });
  return res.json();
};

const mutate = async (body, key = KEY) => {
  const headers = { 'content-type': 'application/json' };
  if (key) headers['x-control-key'] = key;
  const res = await fetch(`${BASE}/api/mutate`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
  return { status: res.status, json: await res.json().catch(() => null) };
};

const lists = await rest('lists?select=*&order=sort');
if (!lists.length) {
  console.error('체크리스트가 없습니다. npm run db:setup 을 먼저 실행하세요.');
  process.exit(1);
}
const listId = lists[0].id;
console.log(`대상 리스트: "${lists[0].title}" (${listId})\n`);

// 1) 인증
check('키 없이 쓰기 → 401', (await mutate({ action: 'reset_list', listId }, null)).status === 401);
check('틀린 키로 쓰기 → 401', (await mutate({ action: 'reset_list', listId }, 'nope')).status === 401);

// 2) anon 키로 직접 쓰기가 RLS 에 막히는지
const anonWrite = await fetch(`${SB}/rest/v1/items?list_id=eq.${listId}`, {
  method: 'PATCH',
  headers: {
    apikey: ANON,
    Authorization: `Bearer ${ANON}`,
    'content-type': 'application/json',
    Prefer: 'return=representation',
  },
  body: JSON.stringify({ done: true }),
});
const anonBody = await anonWrite.json().catch(() => []);
check(
  'anon 키 직접 UPDATE 차단',
  anonWrite.status >= 400 || (Array.isArray(anonBody) && anonBody.length === 0),
  `HTTP ${anonWrite.status}`
);

// 3) 한글 라운드트립 + CRUD
const label = '한글 라벨 테스트 ✓';
const added = await mutate({ action: 'add_item', listId, label });
check('항목 추가 → 200', added.status === 200);
const itemId = added.json?.item?.id;
check('한글 저장 정상', added.json?.item?.label === label, JSON.stringify(added.json?.item?.label));

check('체크 토글', (await mutate({ action: 'update_item', itemId, done: true })).status === 200);
const afterToggle = await rest(`items?id=eq.${itemId}&select=done`);
check('DB 에 반영됨', afterToggle[0]?.done === true);

check('전체 해제', (await mutate({ action: 'reset_list', listId })).status === 200);
const afterReset = await rest(`items?list_id=eq.${listId}&select=done`);
check('전부 해제됨', afterReset.every((i) => i.done === false));

// 4) 순서 변경
const before = await rest(`items?list_id=eq.${listId}&select=id,position&order=position`);
if (before.length >= 2) {
  const ids = before.map((i) => i.id);
  const swapped = [ids[1], ids[0], ...ids.slice(2)];
  check('순서 변경', (await mutate({ action: 'reorder_items', listId, ids: swapped })).status === 200);
  const after = await rest(`items?list_id=eq.${listId}&select=id&order=position`);
  check('순서 반영됨', after[0]?.id === swapped[0] && after[1]?.id === swapped[1]);
  await mutate({ action: 'reorder_items', listId, ids }); // 원복
}

// 5) 삭제
check('항목 삭제 → 200', (await mutate({ action: 'delete_item', itemId })).status === 200);
const gone = await rest(`items?id=eq.${itemId}&select=id`);
check('DB 에서 사라짐', gone.length === 0);

// 6) 오버레이 SSR
const html = await (await fetch(`${BASE}/o/${listId}`)).text();
check('오버레이 200 + 제목 SSR', html.includes(lists[0].title));
// 오버레이가 실제로 불러오는 CSS 를 모두 받아 body/html 에 불투명 배경이 없는지 검사
const cssHrefs = [...html.matchAll(/<link[^>]+rel="stylesheet"[^>]+href="([^"]+)"/g)].map((m) => m[1]);
let opaque = [];
for (const href of cssHrefs) {
  const css = await (await fetch(new URL(href, BASE))).text();
  for (const m of css.matchAll(/(?:^|\})\s*((?:html|body)[^{]*)\{([^}]*)\}/g)) {
    const decl = m[2];
    const bg = decl.match(/background(?:-color)?\s*:\s*([^;]+)/);
    if (bg && !/transparent|rgba\([^)]*,\s*0\s*\)|none/i.test(bg[1])) {
      opaque.push(`${href}: ${m[1].trim()}{${bg[0]}}`);
    }
  }
}
check('오버레이 CSS 에 불투명 body 배경 없음', opaque.length === 0, opaque.join(' | '));
check('스타일시트가 로드됨', cssHrefs.length > 0, `${cssHrefs.length}개`);
const inlineStyles = (html.match(/<style[^>]*>/g) || []).length;
check('인라인 style 태그 없음', inlineStyles === 0, `${inlineStyles}개`);
const rows = (html.match(/row__label/g) || []).length;
check('항목이 서버 렌더됨', rows > 0, `${rows}개`);

// 7) 없는 리스트 → 404
check('없는 리스트 → 404', (await fetch(`${BASE}/o/deadbeef0000`)).status === 404);

console.log(`\n${failures === 0 ? '전부 통과 ✅' : `${failures}개 실패 ❌`}`);
process.exit(failures === 0 ? 0 : 1);
