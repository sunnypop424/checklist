/**
 * Supabase Realtime 이 오버레이와 동일한 조건(anon 키 + RLS + list_id 필터)에서
 * INSERT / UPDATE / DELETE 를 모두 전달하는지 확인한다.
 *   npm run rt
 *
 * DELETE 가 안 오면 `alter table ... replica identity full` 이 빠진 것이다.
 */
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient } from '@supabase/supabase-js';

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
const db = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  { auth: { persistSession: false } }
);

const mutate = async (body) => {
  const res = await fetch(`${BASE}/api/mutate`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-control-key': KEY },
    body: JSON.stringify(body),
  });
  const json = await res.json();
  if (!json.ok) throw new Error(json.error);
  return json;
};

const { data: lists } = await db.from('lists').select('*').order('sort').limit(1);
const listId = lists[0].id;
console.log(`대상 리스트: "${lists[0].title}" (${listId})\n`);

const seen = { INSERT: 0, UPDATE: 0, DELETE: 0 };
const latencies = [];
let stamp = 0;

const channel = db
  .channel(`rt-check:${listId}`)
  .on(
    'postgres_changes',
    { event: '*', schema: 'public', table: 'items', filter: `list_id=eq.${listId}` },
    (payload) => {
      seen[payload.eventType] = (seen[payload.eventType] || 0) + 1;
      if (stamp) latencies.push(Date.now() - stamp);
      console.log(`  ← ${payload.eventType} 수신 (${Date.now() - stamp}ms)`);
    }
  );

const subscribed = await new Promise((res) => {
  channel.subscribe((status) => {
    console.log(`구독 상태: ${status}`);
    if (status === 'SUBSCRIBED') res(true);
    if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') res(false);
  });
});

if (!subscribed) {
  console.error('\n❌ 구독 실패 — Supabase 프로젝트의 Realtime 설정을 확인하세요.');
  process.exit(1);
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// Supabase Realtime 은 SUBSCRIBED 응답 후에도 실제 스트리밍 시작까지 1~2초가 걸린다.
// 오버레이는 몇 시간씩 구독을 유지하므로 실사용에선 문제되지 않지만,
// 테스트에서는 이 워밍업을 기다려야 첫 이벤트를 놓치지 않는다.
console.log('\n워밍업 대기 3초...');
await wait(3000);

console.log('\n1) 항목 추가');
stamp = Date.now();
const { item } = await mutate({ action: 'add_item', listId, label: '리얼타임 확인용' });
await wait(2500);

console.log('2) 체크 토글');
stamp = Date.now();
await mutate({ action: 'update_item', itemId: item.id, done: true });
await wait(2500);

console.log('3) 항목 삭제');
stamp = Date.now();
await mutate({ action: 'delete_item', itemId: item.id });
await wait(2500);

await db.removeChannel(channel);

console.log('\n── 결과 ──');
let bad = 0;
for (const type of ['INSERT', 'UPDATE', 'DELETE']) {
  const ok = seen[type] > 0;
  if (!ok) bad++;
  console.log(`${ok ? '✔' : '✖'} ${type} ${seen[type]}건`);
}
if (latencies.length) {
  const avg = Math.round(latencies.reduce((a, b) => a + b, 0) / latencies.length);
  console.log(`평균 지연: ${avg}ms (최대 ${Math.max(...latencies)}ms)`);
}
if (bad) {
  console.log(
    '\n❌ 일부 이벤트가 오지 않았습니다.\n' +
      '   DELETE 만 누락이면 `alter table public.items replica identity full;` 을 확인하세요.'
  );
} else {
  console.log('\n실시간 동기화 정상 ✅');
}
process.exit(bad ? 1 : 0);
