'use client';

import { useEffect, useState } from 'react';

/**
 * URL 에 ?key= 가 없거나(=처음 방문) 키가 틀렸을 때 표시.
 * 저장된 키가 있으면 자동으로 재진입한다.
 *
 * invalid 일 때는 저장된 키를 반드시 지운다. 안 그러면 틀린 키가 계속 자동
 * 재진입을 일으켜 입력 폼에 영영 도달하지 못한다.
 *
 * 저장소 키 이름('control_key')은 /control 과 /pal 이 공유한다 —
 * 한쪽에 들어간 브라우저는 다른 쪽도 키 입력 없이 열린다.
 */
export const KEY_STORAGE = 'control_key';

type Props = {
  title: string;
  /** 인증 성공 시 돌아갈 경로 ('/control', '/pal') */
  redirectTo: string;
  invalid?: boolean;
};

export default function Gate({ title, redirectTo, invalid }: Props) {
  const [value, setValue] = useState('');
  const [checked, setChecked] = useState(false);

  useEffect(() => {
    if (invalid) {
      localStorage.removeItem(KEY_STORAGE);
      sessionStorage.removeItem(KEY_STORAGE);
      setChecked(true);
      return;
    }
    const saved = sessionStorage.getItem(KEY_STORAGE) || localStorage.getItem(KEY_STORAGE);
    if (saved) {
      window.location.replace(`${redirectTo}?key=${encodeURIComponent(saved)}`);
      return;
    }
    setChecked(true);
  }, [invalid, redirectTo]);

  if (!checked) return null;

  return (
    <main className="control control--gate">
      <form
        className="gate"
        onSubmit={(e) => {
          e.preventDefault();
          const key = value.trim();
          if (!key) return;
          localStorage.setItem(KEY_STORAGE, key);
          window.location.replace(`${redirectTo}?key=${encodeURIComponent(key)}`);
        }}
      >
        <h1>{title}</h1>
        {invalid ? (
          <p className="gate__error">비밀 키가 올바르지 않습니다. 다시 입력해 주세요.</p>
        ) : (
          <p>비밀 키를 입력하세요. 이 브라우저에 저장되어 다음부터는 바로 열립니다.</p>
        )}
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
