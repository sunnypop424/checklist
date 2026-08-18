import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

function assertEnv(value: string | undefined, name: string): string {
  if (!value) {
    throw new Error(
      `환경변수 ${name} 가 설정되지 않았습니다. .env.local (로컬) 또는 Vercel 프로젝트 설정을 확인하세요.`
    );
  }
  return value;
}

let browserClient: SupabaseClient | null = null;

/**
 * anon 키 클라이언트. 읽기 전용(RLS 로 쓰기 차단).
 * 브라우저와 서버 렌더 양쪽에서 쓴다.
 */
export function publicClient(): SupabaseClient {
  if (typeof window !== 'undefined') {
    if (!browserClient) {
      browserClient = createClient(
        assertEnv(url, 'NEXT_PUBLIC_SUPABASE_URL'),
        assertEnv(anonKey, 'NEXT_PUBLIC_SUPABASE_ANON_KEY'),
        {
          auth: { persistSession: false },
          realtime: { params: { eventsPerSecond: 20 } },
        }
      );
    }
    return browserClient;
  }

  // 서버에서는 매번 새로 만든다 (요청 간 상태 공유 방지)
  return createClient(
    assertEnv(url, 'NEXT_PUBLIC_SUPABASE_URL'),
    assertEnv(anonKey, 'NEXT_PUBLIC_SUPABASE_ANON_KEY'),
    { auth: { persistSession: false } }
  );
}

/**
 * service_role 클라이언트. RLS 를 우회한다.
 * app/api/ 아래 서버 코드에서만 import 할 것.
 */
export function adminClient(): SupabaseClient {
  if (typeof window !== 'undefined') {
    throw new Error('adminClient() 는 서버에서만 호출할 수 있습니다.');
  }
  return createClient(
    assertEnv(url, 'NEXT_PUBLIC_SUPABASE_URL'),
    assertEnv(process.env.SUPABASE_SERVICE_ROLE_KEY, 'SUPABASE_SERVICE_ROLE_KEY'),
    { auth: { persistSession: false } }
  );
}
