import './overlay.css';

/** 오버레이 전용 레이아웃 — 배경색을 넣지 않는다 (OBS 투명 배경) */
export default function OverlayLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
