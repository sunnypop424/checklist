'use client';

import type { PalSettings } from '@/lib/pal/db';
import type { PalPlan } from '@/lib/pal/types';
import { nf, pct } from './format';

type Props = {
  plan: PalPlan;
  settings: PalSettings;
  onUpdateSettings: (patch: Partial<PalSettings>) => void;
  onSync: () => void;
  syncedAt: string | null;
};

/**
 * 전체 상황판 + 오버레이 설정.
 *
 * 할 일 탭에서 분리한 이유: 방송 중에 계속 봐야 하는 건 "다음에 뭘 할지"이고
 * 전체 진행률은 가끔 확인하면 되는 값이다. 같이 두면 할 일이 아래로 밀린다.
 */
export default function ProgressTab({ plan, settings, onUpdateSettings, onSync, syncedAt }: Props) {
  const builtTotal = plan.build.reduce((s, b) => s + b.built, 0);
  const countTotal = plan.build.reduce((s, b) => s + b.structure.count, 0);
  const palFilled = plan.palNeeds.reduce((s, n) => s + n.filled, 0);
  const palSlots = plan.palNeeds.reduce((s, n) => s + n.need, 0);

  return (
    <div className="progress">
      <section className="card">
        <div className="card__head">
          <h2>전체 진행률</h2>
        </div>
        <div className="gauges">
          <Gauge label="최하위 재료" value={plan.overall} />
          <Gauge
            label="건축물"
            value={countTotal > 0 ? builtTotal / countTotal : 1}
            hint={`${builtTotal} / ${countTotal}대`}
          />
          <Gauge
            label="팰 배치"
            value={plan.palOverall}
            hint={`${palFilled} / ${palSlots}마리`}
          />
        </div>

        {plan.bottlenecks.length > 0 && (
          <>
            <h3 className="card__sub">병목 재료 상위 5</h3>
            <ul className="bottleneck">
              {plan.bottlenecks.map((b) => (
                <li key={b.id}>
                  <span className="bottleneck__name">{b.name}</span>
                  <span className="bar">
                    <span className="bar__fill" style={{ width: `${b.progress * 100}%` }} />
                  </span>
                  <span className="bottleneck__num">
                    {nf(b.have)} / {nf(b.need)}
                  </span>
                </li>
              ))}
            </ul>
          </>
        )}
      </section>

      <section className="card">
        <div className="card__head">
          <h2>오버레이</h2>
          <button className="btn btn--sm" onClick={onSync}>
            지금 갱신
          </button>
        </div>

        <p className="muted">
          OBS 브라우저 소스 URL 은 <code>/o/pal</code> 입니다. 체크리스트 오버레이와 같은
          방식이라 기존 소스를 복제해 URL 만 바꾸면 됩니다. 크기·글자 크기 옵션은{' '}
          <a href="/control">컨트롤 화면</a>에서 조정합니다.
          {syncedAt && <> 마지막 갱신 {syncedAt}.</>}
        </p>

        <div className="settings">
          <label className="check">
            <input
              type="checkbox"
              checked={settings.mode === 'focus'}
              onChange={(e) => onUpdateSettings({ mode: e.target.checked ? 'focus' : 'full' })}
            />
            <span>
              집중 모드
              <small>지금 할 것 위주로 몇 줄만 띄웁니다. 끄면 표시 항목 수만큼 꽉 채웁니다.</small>
            </span>
          </label>
          <label className="check">
            <input
              type="checkbox"
              checked={settings.showTotals}
              onChange={(e) => onUpdateSettings({ showTotals: e.target.checked })}
            />
            <span>
              총량 표시
              <small>끄면 &quot;발화 기관 32%&quot; 처럼 비율만 방송에 나갑니다</small>
            </span>
          </label>
          <label className="check">
            <input
              type="checkbox"
              checked={settings.autoSync}
              onChange={(e) => onUpdateSettings({ autoSync: e.target.checked })}
            />
            <span>
              자동 갱신
              <small>재고를 고칠 때마다 오버레이를 다시 밀어넣습니다</small>
            </span>
          </label>
          <label className="field">
            <span>표시 항목 수</span>
            <input
              type="number"
              min={1}
              max={30}
              value={settings.limit}
              onChange={(e) => onUpdateSettings({ limit: Number(e.target.value) })}
            />
          </label>
        </div>
      </section>
    </div>
  );
}

function Gauge({ label, value, hint }: { label: string; value: number; hint?: string }) {
  return (
    <div className="gauge">
      <div className="gauge__label">{label}</div>
      <div className="gauge__value">{pct(value)}</div>
      <span className="bar">
        <span className="bar__fill" style={{ width: `${value * 100}%` }} />
      </span>
      {hint && <div className="gauge__hint">{hint}</div>}
    </div>
  );
}
