import './control/control.css';

/** 환경변수가 빠졌을 때 크래시 대신 무엇을 넣어야 하는지 알려준다 */
export default function SetupNotice({ missing }: { missing: string[] }) {
  return (
    <main className="control control--gate">
      <div className="gate gate--wide">
        <h1>환경변수가 설정되지 않았습니다</h1>
        <p>
          Vercel 프로젝트 설정 → Environment Variables 에 아래 값을 넣고 다시 배포하세요.
          로컬이라면 <code>.env.local</code> 을 확인하세요.
        </p>
        <ul className="gate__missing">
          {missing.map((m) => (
            <li key={m}>
              <code>{m}</code>
            </li>
          ))}
        </ul>
        <p className="gate__foot">
          <code>SUPABASE_SERVICE_ROLE_KEY</code> 와 <code>CONTROL_KEY</code> 는 Sensitive 로,
          <code>NEXT_PUBLIC_</code> 으로 시작하는 값은 일반 변수로 넣으면 됩니다.
        </p>
      </div>
    </main>
  );
}
