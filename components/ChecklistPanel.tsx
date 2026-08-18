import type { Item } from '@/lib/types';

type Props = {
  title: string;
  items: Item[];
  /** 완료 항목 숨기기 */
  hideDone?: boolean;
  /** 진행률 바 숨기기 */
  hideProgress?: boolean;
};

/**
 * 오버레이와 컨트롤 미리보기가 공유하는 순수 프레젠테이션 컴포넌트.
 * 데이터 페칭도 훅도 없다 — 편집 중 보는 화면이 OBS 화면과 완전히 동일해진다.
 */
export default function ChecklistPanel({ title, items, hideDone, hideProgress }: Props) {
  const total = items.length;
  const doneCount = items.filter((i) => i.done).length;
  const percent = total === 0 ? 0 : Math.round((doneCount / total) * 100);
  const allDone = total > 0 && doneCount === total;
  const visible = hideDone ? items.filter((i) => !i.done) : items;

  return (
    <div className="panel" data-complete={allDone ? 'true' : 'false'}>
      <div className="panel__head">
        <span className="panel__mark">MISSION</span>
        <h1 className="panel__title">{title}</h1>
        <span className="panel__count">
          <em>{doneCount}</em>
          <span className="panel__count-sep">/</span>
          {total}
        </span>
      </div>

      {!hideProgress && (
        <div className="panel__progress" role="progressbar" aria-valuenow={percent} aria-valuemin={0} aria-valuemax={100}>
          <div className="panel__bar" style={{ width: `${percent}%` }} />
        </div>
      )}

      {visible.length > 0 ? (
        <ul className="panel__list">
          {visible.map((item) => (
            <li key={item.id} className="row" data-done={item.done ? 'true' : 'false'}>
              <span className="row__box" aria-hidden="true">
                <svg viewBox="0 0 24 24" className="row__check" focusable="false">
                  <path d="M4.5 12.5l5 5 10-11" />
                </svg>
              </span>
              <span className="row__label">{item.label}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="panel__empty">{total === 0 ? '항목이 없습니다' : '전부 완료!'}</p>
      )}
    </div>
  );
}
