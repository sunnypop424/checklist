'use client';

import { useEffect, useState } from 'react';

/**
 * URL 에 ?key= 가 없을 때 표시.
 * 이전에 접속한 적이 있으면 sessionStorage 의 키로 자동 재진입한다.
 */
export default function Gate() {
  const [value, setValue] = useState('');
  const [checked, setChecked] = useState(false);

  useEffect(() => {
    const saved = sessionStorage.getItem('control_key') || localStorage.getItem('control_key');
    if (saved) {
      window.location.replace(`/control?key=${encodeURIComponent(saved)}`);
      return;
    }
    setChecked(true);
  }, []);

  if (!checked) return null;

  return (
    <main className="control control--gate">
      <form
        className="gate"
        onSubmit={(e) => {
          e.preventDefault();
          const key = value.trim();
          if (!key) return;
          localStorage.setItem('control_key', key);
          window.location.replace(`/control?key=${encodeURIComponent(key)}`);
        }}
      >
        <h1>체크리스트 컨트롤</h1>
        <p>비밀 키를 입력하세요. 이 브라우저에 저장되어 다음부터는 바로 열립니다.</p>
        <input
          type="password"
          className="gate__input"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="CONTROL_KEY"
          autoFocus
        />
        <button type="submit" className="btn btn--brand">
          입장
        </button>
      </form>
    </main>
  );
}
