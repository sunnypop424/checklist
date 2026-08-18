import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: '체크리스트 오버레이',
  description: '치지직 스타일 방송 체크리스트',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko">
      {/* ⚠ body 에 배경색을 절대 넣지 말 것 — OBS 투명 배경이 깨진다 */}
      <body>{children}</body>
    </html>
  );
}
