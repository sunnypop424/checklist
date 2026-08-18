# 치지직 스타일 방송 체크리스트 오버레이

방송 중 목표/할 일을 웹에서 체크하면 **OBS 화면에 즉시** 반영되는 오버레이입니다.
치지직(CHZZK) 웹 클라이언트의 디자인 토큰을 실제 CSS에서 추출해 그대로 사용했습니다.

- **컨트롤 페이지** `/control` — 항목 추가·수정·삭제·순서변경, 체크, 리스트 전환
- **오버레이** `/o/<리스트ID>` — OBS 브라우저 소스에 넣는 주소 (투명 배경)
- 상태는 전부 Supabase DB에 저장됩니다. **브라우저를 닫든 OBS를 끄든 PC를 재부팅하든 그대로 유지됩니다.**

---

## 셋업

### 1. Supabase

프로젝트를 만들고 `.env.local`을 채웁니다 (`.env.local.example` 참고).

| 변수 | 위치 |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Project Settings → API → Project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | 같은 화면 → anon / public |
| `SUPABASE_SERVICE_ROLE_KEY` | 같은 화면 → service_role (⚠ 절대 `NEXT_PUBLIC_` 붙이지 말 것) |
| `SUPABASE_DB_URL` | 상단 **Connect** 버튼 → Session pooler URI |
| `CONTROL_KEY` | 아무 긴 랜덤 문자열 |

```bash
npm install
npm run db:setup   # 테이블 + RLS + Realtime 설정, 샘플 리스트 생성
```

`db:setup`은 특수문자가 들어간 DB 비밀번호도 그대로 처리합니다. Direct connection 호스트가
DNS에 안 잡히면 **Session pooler** 주소를 쓰세요.

### 2. 로컬 실행

```bash
npm run dev
```

`http://localhost:3000/control` 접속 → `CONTROL_KEY` 입력 (브라우저에 저장되어 다음부터 자동 진입).

### 3. Vercel 배포

GitHub에 푸시하고 Vercel에서 Import한 뒤, **Environment Variables**에 아래 4개를 넣습니다.
`SUPABASE_DB_URL`은 로컬 셋업 전용이라 넣지 않아도 됩니다.

```
NEXT_PUBLIC_SUPABASE_URL
NEXT_PUBLIC_SUPABASE_ANON_KEY
SUPABASE_SERVICE_ROLE_KEY
CONTROL_KEY
```

---

## OBS 설정

1. 소스 추가 → **브라우저**
2. URL: 컨트롤 페이지의 **OBS URL 복사** 버튼으로 복사한 주소
3. 너비 **420**, 높이 **720**
4. **소스가 보이지 않을 때 종료** — 체크 해제
5. **장면이 활성화될 때 브라우저 새로고침** — 체크 해제
6. **사용자 지정 프레임 속도** — 체크 후 **30** fps
7. 사용자 지정 CSS — 기본값 그대로

### URL 파라미터

| 파라미터 | 설명 |
|---|---|
| `?scale=1.25` | 전체 크기 배율. OBS 변형 핸들로 늘리면 글자가 뭉개지므로 이걸 쓰고 소스 속성의 너비·높이를 키우세요 |
| `?debug=1` | 동기화 상태 점 표시 (초록=realtime, 주황=폴링, 빨강=정지). 방송엔 쓰지 마세요 |
| `?hideDone=1` | 완료한 항목 아예 숨기기 |
| `?hideProgress=1` | 진행률 바 숨기기 |
| `?sortDone=0` | 완료 항목을 아래로 내리지 않고 원래 순서 유지 |
| `?hideEmpty=1` | 항목이 하나도 없으면 패널을 아예 표시하지 않음 (화면이 완전히 비워짐) |

### 항목이 많아지면

패널 높이는 **OBS 소스 높이에 자동으로 맞춰집니다**. 항목이 넘치면

- 목록 아래쪽이 부드럽게 페이드되고
- **`+N개 더`** 라고 표시됩니다

체크한 항목은 자동으로 아래로 내려가므로, 잘리는 건 이미 끝낸 일이고 **남은 할 일은 항상 위에
보입니다.** 소스 높이를 키우면 더 많이 보이고, 줄이면 덜 보입니다 — 별도 설정이 없습니다.

---

## 조작

- 항목 **클릭** → 이름 수정 (Enter 저장 / Esc 취소)
- 체크하면 오버레이에서 자동으로 목록 아래로 내려갑니다 (컨트롤 페이지의 편집 순서는 그대로 유지)
- **숫자키 1~9** → N번째 항목 체크 토글
- 입력창에 **여러 줄 붙여넣기** → 한 번에 여러 항목 등록
- **전체 해제** → 새 방송 시작할 때 체크만 초기화
- 컨트롤 페이지는 모바일 대응 — 폰으로도 체크할 수 있습니다

---

## 구조

```
app/o/[id]/page.tsx        오버레이 SSR (OBS가 JS 로드 전에 이미 그림)
app/o/[id]/Overlay.tsx     Realtime 구독 + 15초 폴링 + 재연결 워치독
app/control/ControlApp.tsx 컨트롤 UX 전체 (낙관적 업데이트 + 롤백)
components/ChecklistPanel  오버레이와 미리보기가 공유하는 순수 패널
app/api/mutate/route.ts    모든 쓰기가 지나는 단일 엔드포인트 (service_role)
supabase/schema.sql        테이블 / RLS / Realtime
```

### 보안 모델

- **읽기**: anon 키로 공개. 리스트 ID는 12자리 hex(2⁴⁸)이고, 어차피 방송에 나갈 내용입니다.
- **쓰기**: anon 키로는 RLS와 권한 회수로 **완전히 차단**됩니다. 모든 변경은 `/api/mutate`가
  `CONTROL_KEY`를 상수 시간 비교로 검증한 뒤 `service_role`로 수행합니다.
- 컨트롤 페이지는 진입 후 주소창에서 키를 지웁니다 (방송 중 브라우저가 화면에 잡혀도 노출 안 됨).

### 오버레이가 멈추지 않게 하는 장치

방송 중 오버레이가 얼어붙는 게 가장 치명적이라 여러 겹으로 방어합니다.

1. Realtime `postgres_changes` 구독 (평균 지연 0.2~0.7초)
2. 구독이 끊기면 지수 백오프로 채널 재생성
3. `SUBSCRIBED` 될 때마다 전체 재조회 — 끊긴 동안의 변경을 복구
4. **소켓 상태와 무관하게 15초마다 폴링** — Realtime이 완전히 죽어도 최대 15초 지연
5. 30초 이상 연결이 없으면 폴링을 5초로 단축
6. 네트워크 복구(`online`)·탭 복귀 시 즉시 재조회

이벤트 payload를 패치하지 않고 항상 전체를 다시 읽기 때문에 어떤 경우에도 스스로 복구됩니다.

---

## 검증 스크립트

```bash
npm run smoke   # 인증 / RLS / CRUD / 한글 / SSR / OBS 투명배경 검사
npm run rt      # Realtime INSERT·UPDATE·DELETE 실제 수신 확인
```

`npm run rt`에서 **DELETE만 안 오면** `alter table public.items replica identity full;`이
빠진 것입니다 (`db:setup`이 적용합니다).

---

## 디자인 출처

색상·간격·라운드·그림자는 치지직 웹 클라이언트의 `vendor-DVDNLy6N.css`(디자인 시스템 토큰
1,677개)와 `index-B0NFrBmv.css`의 오버레이 컴포넌트에서 추출한 실측값입니다.

- 브랜드 그린 `#00ffa3` (다크 테마 램프: `#009962 → #00cc82 → #00e693 → #00ffa3`)
- 다크 표면 계단 `#0e0f10 → #1c1d1f → #202224 → #2a2c2f → #2e3033`
- 텍스트는 cool-gray 계열 `#c9cedc / #9da5b6 / #697183`
- 호버·프레스는 배경색 교체가 아니라 투명 오버레이를 덧씌우는 방식 (치지직 실제 구현)
- 폰트 Pretendard (치지직과 동일한 jsDelivr dynamic-subset, CDN 실패 시 로컬 폴백)
