/** 배포 시 환경변수 누락을 500 에러 대신 안내 화면으로 보여주기 위한 헬퍼 */

export const OVERLAY_ENV = ['NEXT_PUBLIC_SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_ANON_KEY'] as const;

export const CONTROL_ENV = [
  'NEXT_PUBLIC_SUPABASE_URL',
  'NEXT_PUBLIC_SUPABASE_ANON_KEY',
  'SUPABASE_SERVICE_ROLE_KEY',
  'CONTROL_KEY',
] as const;

/**
 * NEXT_PUBLIC_* 은 빌드 시점에 인라인되므로 process.env[name] 동적 접근이 통하지 않는다.
 * 정적으로 하나씩 참조해야 값이 들어간다.
 */
function read(name: string): string | undefined {
  switch (name) {
    case 'NEXT_PUBLIC_SUPABASE_URL':
      return process.env.NEXT_PUBLIC_SUPABASE_URL;
    case 'NEXT_PUBLIC_SUPABASE_ANON_KEY':
      return process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    case 'SUPABASE_SERVICE_ROLE_KEY':
      return process.env.SUPABASE_SERVICE_ROLE_KEY;
    case 'CONTROL_KEY':
      return process.env.CONTROL_KEY;
    default:
      return process.env[name];
  }
}

export function missingEnv(names: readonly string[]): string[] {
  return names.filter((n) => !read(n)?.trim());
}
