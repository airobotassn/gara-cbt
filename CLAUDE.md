# CLAUDE.md

이 파일은 Claude Code(및 개발자)가 이 저장소에서 작업할 때 보는 **중심 가이드 + 문서 맵**이다.
세부 내용은 각 문서로 연결한다. 변경 시 관련 문서도 같이 갱신할 것.

> **⚠️ 통합됨 (2026-07):** 이 저장소는 이제 **CARIS CBT 자격검정(메인) + 무료 CARIS ARENA(`/test/*` 모듈)** 가 한 앱이다.
> 아래 "프로젝트 한눈에"는 CARIS ARENA 시절 옛 설명이라 전면 갱신 예정 — 현재 구조는 **[통합 전략](docs/통합전략.md)** · **[배포 안내](docs/통합-배포-안내.md)** 를 먼저 볼 것.
> 요점: 라우트 `/`(CBT 홈)·`/exam/*`(CARIS)·`/test/*`+`/ranking`(CARIS ARENA). CARIS ARENA 테이블은 충돌 회피로 `test_*` 리네임(`test_questions`·`test_answers` 등), 함수는 `start-test`·`submit-test`·`get-result`·`list-attempts`·`recommend-level`·`leaderboard`·`admin-test`. 스코어링 sync 페어 = **`src/lib/scoring.ts` ↔ `supabase/functions/_shared/scoring.ts`**. CARIS ARENA 전용 프론트 파일은 `testTypes.ts`·`testConfigLevel.ts`·`useAntiCheatLevel.ts`(CBT 동명 파일과 분리).

---

## 최우선 규칙 — 모르면 물어봐라

**추측해서 만들지 말고 질문해라.** 아래 중 하나라도 해당되면 손대기 전에 **멈추고 묻는다**.

- 요청의 의도가 확실하지 않다 (같은 말이 두 가지로 읽힌다)
- 뭘 만들지는 알겠는데 **어떻게** 할지 선택지가 여러 개다
- 내가 정할 문제가 아니라 **취향·판단**이 필요하다
- 사용자가 쓴 단어를 내 식으로 번역해서 이해하고 있다
- 근거가 내 감각뿐이다 (레퍼런스도 명시 요구도 없다)

**"일단 만들어서 보여주고 반응 보기"는 금지다.** 그건 묻는 게 아니라 떠넘기는 거고, 빗나가면 사용자 시간만 버린다.
시안을 여러 개 던지는 것도 질문의 대체물이 아니다 — 방향을 모르는 상태에서 만든 시안은 전부 빗나간다.

질문은 이렇게 한다: **내가 뭘 이해했는지 한 줄로 적고 → 막힌 지점을 짚고 → 구체적 선택지를 준다.**
"어떻게 할까요?" 같은 빈 질문 금지. 사용자가 한 단어로 답할 수 있게 만든다.

> 실패 예시 (2026-08-03): "배경이랑 버튼이 따로 논다" → 원인을 안 묻고 색·테두리를 네 번 고쳐서 들이밈.
> 전부 빗나감. "따로 논다"가 뭘 뜻하는지 처음에 물었으면 한 번에 끝났다.
> "지구를 흐리게" → 물어보지 않고 `blur()` 로 픽셀을 뭉갬. 실제 뜻은 "톤 다운해서 뒤로 물러나게".

한 번 물어보는 비용 < 잘못 만든 걸 되돌리는 비용. 항상.

### 질문에는 답만 한다 (작업 금지)

**사용자가 물어보면 답을 한다. 거기서 끝이다.** 답하면서 파일을 고치지 않는다.
"물어본 김에 고쳐두면 좋겠지"는 사용자를 무시하고 내 마음대로 하는 것이다.

- 물음표로 끝나는 말, "이게 뭐야" · "먼소리지?" · "왜 이래?" · "어디에 있어?" = **질문**이다. 작업 지시가 아니다.
- 되물음("먼소리지?")은 **내 앞말이 안 통했다는 신호**다. 그때 할 일은 쉬운 말로 다시 설명하는 것 하나뿐이다.
  설명 대신 작업을 시작하면 사용자는 답을 못 받은 채 결과물만 떠안는다.
- 앞에서 작업 지시를 받았어도, 중간에 질문이 들어오면 **작업을 멈추고 답부터** 한다.
  질문에 답한 뒤 "이어서 할까요?" 를 묻고, 하라고 하면 그때 한다.
- 답은 짧게. 물어본 것만 답한다. 안 물어본 배경·대안·다음 단계를 덧붙이지 않는다.

> 실패 예시 (2026-08-05): "전체 글씨체 통일하자" → 범위를 물음 → 사용자 "먼소리지?"
> → 되물음에 답하지 않고 그대로 폰트 토큰·CSS 5개 파일을 고쳐버렸다.
> 사용자가 받은 것: 자기 질문에 대한 답 0개 + 요청한 적 없는 시점의 커밋 가능한 변경 한 무더기.

---

## 시각/레이아웃 작업 규칙 (레퍼런스 = 명령이다)

사용자가 스크린샷·레퍼런스·명시 요구를 주면 그건 *참고*가 아니라 *구속 조건*이다.

1. **레퍼런스를 먼저 글로 받아적는다.** 구현 전에 스샷/요구에서 레이아웃 제약을 문장으로 뽑아 사용자에게 보여주고 STOP.
   예: "읽은 제약 = 미니게임 가로 1행 나열, 세로 스크롤 없음, 한 줄 N개. 맞나?"
   이 확인 없이 구현 시작 금지.
2. **레퍼런스가 내 기본값을 이긴다.** "모바일=세로 스택" 같은 관성 기본값이 레퍼런스와 충돌하면 레퍼런스를 따른다. 임의 세로 스크롤·재배치 금지.
3. **명시 안 한 표면은 건드리지 않는다.** 요청한 것만. 색·간격·구조 임의 변경 금지.
4. **검증 = "돌아간다"가 아니라 "레퍼런스와 일치".** 완료 전 스샷/diff로 1번 제약 목록을 하나씩 대조. 어긋나면 미완.
5. **자가승인 금지.** 다 됐다고 내가 정하지 않는다. 결과를 사용자에게 넘겨 판정받는다.

---

## 이미지 에셋 프롬프트 규칙 (가드레일만 준다 · 조형은 모델에게 맡긴다)

`public/` 에 들어갈 그림(시상대·프레임·배지·히어로 등)을 생성 AI로 뽑을 때의 규칙이다.
**핵심: 나는 무엇을 위한 물건인지와 안 지키면 코드가 깨지는 것만 말한다. 어떻게 생겼는지는 모델이 정한다.**

### 왜 (2026-08-03 실패에서)
`/ranking` 시상대를 다시 뽑으면서 내가 `EMPTY ROUNDED PLATE / solid matte, no texture / no perspective, no shadow`
\+ `x=17%, 50%, 83%` 좌표표 + `no crowns, no baroque, no filigree` 네거티브를 줬다.
결과물이 **CSS div 박스 세 개**였다. 치수를 주면 모델은 조립만 하고, 스타일 네거티브는 물건을 물건답게 만드는 어휘를
통째로 지운다. 반대로 잘 나온 프롬프트는 감정과 용도를 말하고 형태 결정권을 넘겼다.

### 프롬프트 5블록

1. **소속 한 줄** — 참조 이미지를 붙이고 `Match the attached X's art style and mood — …. This belongs to the same set.`
   TAKE FROM / DO NOT COPY 표 만들지 말 것. 한 문장이면 된다.
2. **브리프** — *무엇을 위한 물건이고, 어떤 기분이어야 하고, 무엇이 아닌지*. 치수가 아니라 감정과 용도로 쓴다.
   좋은 예: `should feel like a ceremonial monument at night: dignified, celebratory but quiet, something you'd be
   proud to be placed on. Not a toy, not a game prop.`
3. **설계권 이양 한 줄** — `You choose the form; surprise me with the shape, the silhouette and the ornament.`
   빠뜨리지 말 것. 이 문장이 있고 없고가 결과를 가른다.
4. **Hard requirements** — 안 지키면 **코드가 깨지는 것만**. 그리고 **각 제약에 이유를 붙인다**
   (`it will sit on a dark night-sky page, so it must read lighter than …`). 이유가 있으면 모델이 알아서 맞춰 온다.
5. **출력 위생 네거티브** — `No haze, no fog, no glow cloud. Transparent right up to the edges.` 처럼
   **알파·여백·텍스트**에 대한 것만.

### 절대 쓰지 말 것
- **부품 목록** — `empty plate` · `socket` · `blank area` · `no lines, no dividers`. 빈 사각형을 시키면 빈 사각형이 나온다.
- **% 좌표·치수표** — `center circle diameter about 20% of canvas width`. 도면을 그리라는 지시가 된다.
- **재질·조명 지정** — `matte navy / brushed brass / soft key light from upper front / chamfered bevel`.
- **스타일 네거티브** — `no baroque, no gothic, no crown, no filigree`. 어휘 파괴. 톤을 낮추고 싶으면 금지가 아니라
  느낌으로 쓴다: `restrained — the ornament should feel earned, not encrusted`.

### 순서는 그림이 먼저, 코드가 나중
슬롯 위치·크기를 프롬프트에 미리 못박지 않는다. **나온 그림을 알파로 실측해서 CSS %좌표를 맞춘다.**
구멍이 안 뚫려 나왔으면 후처리로 파면 되고, 여백이 남았으면 트림하면 된다. 그림을 코드에 맞추려 들지 말 것.

> 실제 좌표 실측·동기화가 필요한 곳: `src/styles/ranking.css` 의 시상대 구멍 좌표 · 티어바 소켓 좌표
> (해당 블록 주석에 "그림을 갈면 이 값들을 다시 재야 한다" 라고 적혀 있다).

---

## 프로젝트 한눈에

**GARA · AI 활용능력 CARIS ARENA** — "당신의 AI 활용능력은 어느 정도인가요?"
20문항으로 **레벨별 6개 영역**을 측정하고 **레벨 사다리(1~7, 원점수로 승급/유지 — 강등 없음)** 로 등급을 부여하는 웹 서비스. 레벨테스트 클리어(레벨당 +1,000)와 일일 활동을 합친 **시즌 점수(0~13,570)** 로 리더보드를 매긴다. 문항은 **6개국어 다국어**(화면 언어로 응시).

- 비로그인(게스트) 응시 가능 → **총점만** 노출
- 구글 로그인 시 **등급(레벨) · 레벨별 6축 레이더 · 오답노트** 잠금 해제(비로그인 결과 그대로 이관)
- 메인(랜딩)에서 **검색어로 레벨 추천**(Gemini 임베딩, 생성 없는 R 방식)
- 라이브: https://gara-cbt.airobotassn.workers.dev (Cloudflare, worker 이름 = wrangler.jsonc 의 `gara-cbt`)
  - ⚠️ 옛 주소 `gara-home.airobotassn.workers.dev` 는 폐기(404). `gara-leveltest…` 도 통합 전 주소.

## 기술 스택
- **프론트**: React 19 + Vite + TypeScript + Tailwind CSS v4 (차트는 자체 SVG, Recharts 제거)
- **백엔드**: Supabase — Postgres + Auth(구글·익명) + Edge Functions(Deno)
- **외부**: Google Gemini 임베딩(`gemini-embedding-001`) — 레벨 추천 전용
- **배포**: Cloudflare(프론트 Workers 정적자산, GitHub 자동배포) + Supabase CLI(함수)

## 자주 쓰는 명령 (윈도우는 `npx.cmd`)
```bash
npm run dev      # 개발 서버 (localhost:5173)
npm run build    # tsc -b && vite build → dist/
npm run lint     # eslint
npm run preview  # 빌드 결과 미리보기
```
> 변경 리포트(보고용 HTML)는 npm 스크립트가 아니라 **`report` 스킬**이다 — "보고서 만들어줘" 라고 하면 됨(아래 참고).
배포·운영 상세는 → `docs/온보딩.html` (§16~19: 환경변수·배포·트러블슈팅)

---

## 라우트 ↔ 파일 맵 (화면 얘기가 나오면 여기부터)

단일 출처 = `src/App.tsx` 의 `<Routes>`. 아래 표와 어긋나면 App.tsx가 맞다(표를 갱신할 것).
CSS는 대부분 `src/index.css` 가 일괄 `@import` — 페이지에서 직접 import 하는 건 `hub.css` 뿐.

| URL | 페이지 파일 | CSS | 주 Edge Function |
|---|---|---|---|
| `/` (메인·랜딩) | `pages/Landing.tsx` | `landing.css` | `route-query`(의미 검색 라우터) |
| `/guide` (자격검정 안내) | `pages/Guide.tsx` | `guide.css` ⚠️급수 색 양쪽 동기화 | — |
| `/plan` (시험 일정·접수) | `pages/Plan.tsx` | `plan.css` (배경은 `.guide-page` 공유) | — |
| `/notice` · `/notice/:id` | `Notice.tsx` · `NoticeDetail.tsx` | `shared.css` | `admin`(운영 CRUD) |
| `/faq` | `pages/Faq.tsx` | `shared.css` | `admin` |
| `/about` · `/privacy` · `/terms` | `About/Privacy/Terms.tsx` | `policy.css` | — |
| `/login` · `/auth/callback` | `Login.tsx` · `AuthCallback.tsx` | — | (Supabase Auth) |
| `/onboarding` (국가·지역) | `pages/Onboarding.tsx` | `shared.css` | `set-region` |
| **CARIS 자격검정 (CBT 본선)** ||||
| `/exam` (검정 게이트) | `pages/ExamGate.tsx` | `cbt.css` | — |
| `/exam/apply` (원서접수) | `pages/ExamApply.tsx` | `cbt.css` | `admin` |
| `/exam/check` (환경점검·모의) | `pages/ExamCheck.tsx` | `cbt.css` | — |
| `/exam/prepare` · `/exam/seb` | `ExamPrepare.tsx` · `SebStart.tsx` | `cbt.css` | `start-exam` |
| `/exam/run/:attemptId` (실제 응시) | `pages/CbtRunner.tsx` | `cbt.css` | `start-exam` · `submit-exam` |
| `/exam/result/:attemptId` | `pages/ExamResult.tsx` | `cbt.css` | `get-exam-result` |
| `/exam/complete` · `/exam/done` | `ExamComplete.tsx` · `ExamDone.tsx` | `cbt.css` | — |
| `/certificate` (자격증 발급) | `pages/Certificate.tsx` | `cert.css` | `get-exam-result` |
| `/verify/:token` (자격증 진위확인) | `pages/VerifyCert.tsx` | `verify.css` | `verify-cert` |
| `/mypage` · `/mypage/:section` | `pages/MyPage.tsx` | `dashboard.css` | `my-attempts` · `mypage-ai` · `ebooks` |
| `/ebooks` (이북 스토어·구매) | `pages/Ebooks.tsx` | (Tailwind 유틸) | `ebooks` |
| `/ebooks/read/:id` (이북 뷰어) | `pages/EbookReader.tsx` | (인라인) | `ebooks` |
| **캐릭터 허브 / 미니게임** ||||
| `/hub` (실동작 로비) | `pages/Hub.tsx` | `hub.css`(직접 import) | `get-hub` · `complete-daily` · `gacha-draw` · `gacha-exchange` · `shop-buy` · `redeem-referral` |
| `/games/:gameId` | `pages/MiniGame.tsx` (목록=`lib/minigames.ts`) | `hub.css` · `minigame.css` | `submit-minigame` · `minigame-rank` |
| `/daily` (오늘의 학습) | `pages/Daily.tsx` — 루트 클래스 `.dy-page` | `daily.css`(직접 import) | `get-hub` · `complete-daily` |
| **WORLD ARENA (무료 레벨테스트 `/test/*`)** ||||
| `/arena` (지도+지역랭킹+채팅) | `pages/WorldArena.tsx` + `components/ArenaMap.tsx`·`ChatBoard.tsx` · `lib/arena/*` | `arena.css` · `chat.css` | `leaderboard` · `chat-list`·`chat-post`·`chat-edit`·`chat-delete`·`chat-report` |
| `/test/select` (레벨 선택) | `pages/LevelSelect.tsx` | `levelselect.css` | `recommend-level` |
| `/test/:attemptId` (응시) | `pages/TestRunner.tsx` | `test.css` | `start-test` · `submit-test` |
| `/test/result/:attemptId` | `pages/Result.tsx` | `result.css` | `get-result` |
| `/ranking` (리더보드) | `pages/Ranking.tsx` | `ranking.css` | `leaderboard` |
| **관리자** ||||
| `/admin` (탭 = `?top=`·`?tab=`) | `pages/Admin.tsx` (top=caris) · `pages/AdminLevelTest.tsx` (top=level) | `admin.css` | `admin` · `admin-test` |

- **`/guide` 개편(2026-07)**: 히어로(로고 락업 + 카피 + `CARIS PLAN` 버튼 + 로봇 이미지) → "CARIS는 무엇인가요?"(특징 카드 8장) → "CARIS 자격 체계"(피라미드 + 급수별 검정과목 카드) 3단 구성. **시험 일정은 `/plan` 으로 분리**됐다(옛 히어로 우측 일정 패널·상시시험 띠는 삭제). `/guide` 에서 원서접수로 가는 경로 = `CARIS PLAN` 버튼 → `/plan` → 회차 카드 → `/exam/apply`. 페이지 배경/색 토큰(`--g-*`)은 `.guide-page`(guide.css)가 단일 출처고 `/plan` 도 그걸 쓴다.
  - 히어로 이미지 = `public/hero-robot.png`(배경 투명). **손 위 CARIS 행성은 이미지에 없다** — `logo.png` 를 CSS 로 겹친 별도 레이어(`.guide-hero-orb`, %좌표 + 글로우 + 부유 애니메이션). 로봇 이미지를 갈면 손바닥 비율에 맞춰 `.guide-hero-orb`/`.guide-hero-art::after` 의 `left`·`top` 을 다시 맞출 것.
  - ⚠️ 클래스명에 `.hl` 쓰지 말 것 — `result.css` 가 전역으로 `.hl { display:flex }` 를 잡고 있다(`.gh-hl` 로 우회).
- `/mypage` 탭(URL `/mypage/:section`) 순서 = `learning`(학습 대시보드, **기본 = `/mypage`**) · `ebooks`(이북 서재) · `attempts`(시험 응시 현황) · `earned` · `issuance`. ⚠️ 응시 현황은 예전 기본 탭이라 `/mypage` 였는데 지금은 `/mypage/attempts`.
- **이북(전자책)**: 관리자가 HTML 1개 파일을 업로드(비공개 버킷 `ebooks`, 표지는 공개 버킷 `ebook-covers`) → 회원이 `/ebooks` 에서 구매 → 마이페이지 '이북 서재' 탭에서 열람(`/ebooks/read/:id` 뷰어가 서명 URL iframe). 테이블 `ebooks`·`ebook_purchases`, 함수 `ebooks`(store·picks·library·buy·read) + `admin`(ebookList/Upsert/Delete/Buyers). ⚠️ **결제(PG) 미연동 — 구매 = 즉시 지급(데모)**. 결제 검증 자리는 `ebooks` 함수의 `buy` 액션.
  - **추천**: 레벨테스트 결과창(`Result.tsx` 의 `EbookPicks`)이 `picks` 액션으로 응시 레벨에 맞는 책을 받는다. 기준은 `ebooks.target_level`(1~7, null=무관) 하나 — 관리자 이북 탭에서 고른다. 정렬 = 목표 레벨(승급 시 +1)과 가까운 순 → 동률이면 위 레벨 → 스토어 노출순, 이미 산 책은 서버가 제외. 레벨당 1권 체계라 6축 태그는 일부러 안 넣었다(고를 대상이 없어 결과가 안 바뀜) — 한 레벨에 여러 권이 생기면 그때 축 태그 추가.
- `/admin` 서브탭(URL `?tab=`): `dash`(기본, 파라미터 없음) · `subs`(제출답안) · `grading`(채점) · `users` · `questions`(문항) · `notices` · `faq` · `rounds`(회차) · `ebooks`(이북) · `admins`. **`Admin.tsx` 3.7k줄 / `AdminLevelTest.tsx` 2.3k줄** — 전체 읽지 말고 서브탭 컴포넌트만 찾아 들어갈 것.
- 온보딩 게이트(`App.tsx`의 `OnboardingGate`): 정식 회원이 지역 미확정이면 `/test/*` · `/ranking` · `/mypage` 접근 시 `/onboarding` 으로 강제. 그 외 라우트는 통과.
- **진입점 배치(2026-07 정리)**: 미니게임은 `/arena` 하단 런처 4번째 버튼(`components/MiniGamePicker.tsx` 팝업) → `/games/:id`. 랭킹은 `/hub` 도크 CTA → `/ranking`. 레벨선택·허브에는 각각 미니게임·랭킹 진입점이 없다(중복 제거).
- **`/hub` 화면 구성(2026-08-04 시안 반영)**: 상단 HUD(아바타 · 이름 + 티어 **엠블렘** · **ARENA 레벨 경험치 바** + `?` + 코인) → **오늘의 미션 바**(한 줄) → 캐릭터 무대(+ 오른쪽 레일 5칸 `출석·뽑기·상점·칭호·초대하기`) → 도크(7일 출석 스탬프 + 랭킹 CTA). 전부 전체 폭 세로 스택이라 캐릭터가 화면 정중앙에 온다.
  - ⚠️ **오른쪽 레일은 `position:absolute` 라 무대 높이를 늘리지 못한다** — 버튼을 추가·삭제하면 `hub.css` 의 `.hub-main .stage-zone` 높이(모바일 420 / PC 520)와 `.rail-r` gap 을 다시 실측할 것. 넘치면 아래 출석 스탬프를 덮는다(실제로 5칸이 되며 터졌던 버그).
  - 미션 3종 완료 판정은 `get-hub` 의 `dailyDone`·`learnDone`·`minigameDone`(daily_activity 종류별 플래그), 점수 표기는 `scoring.ts` 의 `ACTIVITY_DELTA` 파생이라 하드코딩이 없다.
  - **HUD 경험치 바 = ARENA 레벨 진행도**(`arenaLevelForScore`/`arenaBand`, 시즌 총점의 1,000점 밴드). 옛 '다음 순위까지 N점' 랭킹 게이지를 대체했고 `pointsToPass`·`level`(시험 등급)은 화면에서 빠졌다(서버는 계속 내려줌).
    - ⚠️ **`Lv.` 이름이 레벨테스트 등급과 겹친다** — 그래서 바 안 왼쪽에 `ARENA Lv.N` 을 박아 어느 축인지 밝힌다(원안 표의 표기와 동일). 바 안 글자는 `.exp-txt` 한 flex 줄에 넣어야 한다(각각 absolute 로 두면 좁은 화면에서 겹친다). 모바일은 `.exp-next`(분모)를 감춰 `ARENA Lv.N` 이 안 잘리게 한다.
    - ⚠️ **한 줄에 서는 세 요소(`.exp` · `.hub-help` · `.gchip`)는 높이가 같아야 한다**(모바일 28 / PC 40). 하나만 바꾸면 바로 티 난다.
    - ⚠️ **채움(`.exp-fill`)은 원색 블록이 아니라 옅은 틴트 + 원색 3px 진행선**이다. 글자가 바 위에 얹히므로 원색으로 꽉 채우면 채움 경계에서 글자가 묻힌다.
    - `?` 는 **바 뒤·코인 앞**이다. 코인 옆에 두면 코인 설명으로 읽힌다 — 코인(뽑기·상점 재화)과 점수(랭킹)는 별개 지갑이다.
    - 티어는 텍스트가 아니라 **엠블렘 이미지 단독**(`<TierBadge>`, 백분위 '상위 N%' 는 제거 — 순위 맥락은 랭킹 화면 소관). ⚠️ `TierBadge` 가 인라인 style 로 크기를 박으므로 `.tier-chip img` 는 `!important` 없이는 못 키운다.
    - 아바타 밑 `Lv.` 배지(`.hud-lv`)는 제거했다 — 바가 이미 `ARENA Lv.N` 을 말한다.
  - ⚠️ **미션은 한 줄 얇은 바(`.mission-bar`)다 — 카드로 키우지 말 것.** 좌측 세로 카드는 캐릭터를 옆으로 밀어서, 큰 가로 타일은 무대를 눌러서 각각 반려됐다(2026-08-04). 지금은 칩 3개 한 줄이고 chrome 은 하단 `.reward`(출석 보상)와 같은 값이라 위아래가 한 쌍으로 읽힌다. 모바일은 `.ms-chips` 를 `order:3 / flex-basis:100%` 로 통째로 둘째 줄에 내린다. 시안의 CTA 배너("미션 완료하고…")와 코인/점수 구분 안내문은 중복이라 삭제.
  - **친구 초대는 도크 `초대하기` 모달 하나에서 다 끝난다** — 화면에 카드로 꺼내지 않는다(진입점 중복 제거). 모달 = 위(내 코드 + 복사) + 아래(친구 코드 입력).
    - 내 코드 = `profiles.referral_code` + `ensure_referral_code(uid)` RPC. **계정 귀속·영구 고정**이다(값이 있으면 그대로 반환, 없을 때만 1회 생성). 형식 `CARI`+4자.
    - 등록 = `redeem-referral` 함수. `profiles.referred_by` 가 비어있을 때만 박히고 **계정당 1회·되돌릴 수 없다** → 그때부터 입력칸이 잠긴다(FE 도 `referralUsed` 를 한 번 true 면 안 푼다).
    - ⚠️ **여기선 실패를 사용자에게 알려준다**(`not_found`·`self`·`already`). 온보딩에 안 넣은 이유가 이거다 — 한 번뿐인 화면에서 오타를 조용히 삼키면 기회를 영영 잃는다. 모달은 다시 열 수 있으니 알려주는 게 맞다.
    - 보상은 **초대자에게만 +5**(원안). 하루 1회 캡·중복 계산 방지는 코드가 아니라 `activity_ledger` 의 두 unique 인덱스가 건다(걸리면 23505 → 등록은 성공, 점수만 미적립).
- **미니게임 게임별 랭킹**: 게임 HTML 의 인트로·아웃트로 오버레이 **우상단 '랭킹' 버튼** → `postMessage` → 부모(`MiniGame.tsx`)가 `components/MiniGameRankModal.tsx` 를 띄운다. 게임 안에 보드를 그리지 않는 이유 = 게임이 6개라 UI 를 6번 유지해야 하고 iframe 엔 세션·아바타가 없다.
  - 게임 ↔ 앱 계약 = 각 `public/games/*.html` 끝의 **앱 브리지** 블록(`window.MGBridge`). `mg:rank`(랭킹 열기) · `mg:score`(점수/레벨 + 동률해소용 `tieMs`) 두 메시지뿐이고, 단독으로 HTML 을 열면 부모가 없어 버튼도 숨고 아무것도 보내지 않는다.
  - 지표는 게임마다 다르다(`supabase/functions/_shared/minigames.ts` 의 `GAMES` 가 단일 출처): 버텨라·쏴라 = 점수, **골라라 = 도달 라운드(15)**, 닿아라(5)·지어라(3)·프로그램해라(6) = 도달 레벨. 레벨형은 레벨 수가 적어 전원 만점이 나오므로 **동률은 소요시간**으로 가른다.
  - 저장 = 테이블 `minigame_scores`(통산 최고, 시즌 스코프 아님) + RPC `minigame_top`. `activity_ledger` 는 정규화 delta 라 줄 세우기에 못 쓴다.
  - ⚠️ 제출은 **티켓 필수**(`submit-minigame` 의 `action:'start'` → HMAC 서명 티켓). 티켓은 **세션당 1개로 재사용** — 제출마다 새로 받으면 "플레이시간 대비 상한"이 리셋돼 레벨형 2번째 이후 정상 기록이 깎인다.
- **`/arena` 는 더 이상 iframe 이 아니다**: 옛 `public/world-arena.html`(자립형 d3 HTML)을 React 로 포팅하고 삭제했다. 지도 경계는 `public/geo/*.json`(world·kr-prov 즉시, kr-muni 는 시도 진입 시 지연 로드), d3 는 npm 서브모듈(`d3-geo`·`d3-zoom` 등). 문구는 `i18n.tsx` 의 `arena.*`.
- **`/arena` 채팅(유사채팅 · `components/ChatBoard.tsx`)**: 웹소켓이 아니라 **3.5~4.5초 폴링**이다(신규분 `after` + 수정/삭제 reconcile `ids+since` 두 번). 함수 `chat-list`·`chat-post`·`chat-edit`(10분 내 본인)·`chat-delete`(소프트)·`chat-report`, 공용 헬퍼 `_shared/chat.ts`, 테이블 `chat_messages`·`chat_reports`·`chat_incidents`(RLS 정책 없음 = 함수 전용). 삽입 경로는 RPC `chat_post_atomic` 하나뿐. 검수는 `/admin?top=level&tab=chatmod`(`Admin.tsx` 의 `ChatModAdmin`).
  - **방(room) = 전세계 1개 + 나라별 1개** (`chat_messages.room` = `'global'` 또는 ISO2 대문자, 방 도입 전 글은 전부 global). 방 목록을 만들지 않는 이유 = **방은 지도 선택이 정한다** — 지구본에서 아무 나라도 안 고르면 전세계, 나라를 고르면 그 나라 방. 나라 안에서 시도를 골라도 방은 나라 단위로 유지. 전세계로 돌아가는 길은 채팅 머리말의 `전세계로` 버튼 하나(= `goto(0)`, 지도도 같이 나간다).
  - **쓰기는 어느 방이든 로그인만 하면 된다** — 옛 "내 나라 + 전세계만"(`profiles.country_code` 기준 · 서버 `not_my_country` 403 · 프론트 읽기전용 안내) 제한은 2026-08-04 제거했다. 남은 게이트는 로그인 · 배드워드/링크 · OpenAI 모더레이션 · 레이트리밋뿐.
  - ⚠️ **레이트리밋·중복·IP 바닥선 가드는 방을 안 본다(계정 단위 전역)** — 방마다 상한이 리셋되면 방을 옮겨다니며 도배할 수 있다. `chat_post_atomic` 안의 주석과 `tests/db/t-chat-rooms.mjs` 가 이걸 지킨다.
  - ⚠️ 방이 바뀌면 `<ChatBoard key={room}>` 로 **다시 마운트**한다. 목록·커서·폴링 타이머가 한 방을 가리키는 상태 뭉치라, 방만 갈아끼우면 전 방으로 날아간 요청 결과가 새 방 목록에 섞인다.
- 매칭 없는 경로는 전부 `/` 로 리다이렉트(404 페이지 없음).

## 구조 맵

```
src/
  lib/         supabase 클라(callFunction), types, scoring(만점100 정규화·EWMA·등급변동), categories(레벨별 6축 다국어 라벨), testConfig, i18n(자체 6개국어)
  context/     AuthProvider — 익명/구글 로그인 + claim 토큰 이관
  hooks/       useAntiCheat(복사차단+이탈감지), useCountUp
  components/  Layout(FAB 패널·언어선택), TierBadge(티어 엠블렘 이미지), RadarChartBox, TopBar 등
  pages/       33개 — 라우트별 매핑은 위 "라우트 ↔ 파일 맵" 표 참고
  styles/      페이지별 css (index.css 가 일괄 @import · hub.css만 페이지에서 직접)
supabase/
  schema.sql   테이블 + RLS (잠금 테이블은 service role 전용) · v3=다국어/레벨별6축
  migrate_v3.sql v2→v3 정리(드롭) → schema.sql 재실행 (pre-launch 전용, 데이터 폐기)
  seed.sql     샘플 문제 120개(레벨1~5 × 6축 × 4, ko/en) — 실제 문항으로 교체 필요
  functions/   32개 — CBT(start-exam·submit-exam·get-exam-result·verify-cert) · 이북(ebooks) · 레벨테스트(start-test·submit-test·get-result·list-attempts·leaderboard·recommend-level)
               · 허브(get-hub·complete-daily·gacha-draw·gacha-exchange·shop-buy·redeem-referral) · 검색라우터(route-query·route-seed)
               · 지식베이스(kb-*·lecture-qa) · 운영(admin·admin-test·my-attempts·mypage-ai·set-region·translate-questions)
  functions/_shared/  cors.ts · lib.ts (스코어링·인증·쿨다운 공용)
```

**DB 테이블**(요약): `profiles`, `questions`(다국어 JSONB·정답 클라 비노출), `test_attempts`(응시 언어·등급변동 스냅샷), `attempt_answers`, `user_level_skill`(레벨별 누적 6축 레이팅), `user_progress`(현재 등급=레벨).

## 핵심 규칙 / 컨벤션

- **보안 모델**: `questions.correct_index`·`test_attempts`·`attempt_answers`·`user_level_skill`·`user_progress` 는 **클라 직접 SELECT 금지**(RLS 미부여 = service role 전용). 출제·채점·결과 서빙은 **Edge Function 에서만**. 익명 유저 응답에선 총점 외 데이터를 서버가 제외. 정답은 언어 무관 단일 컬럼(`correct_index`)이라 번역과 무관.
- **스코어링 단일 출처**: 프론트 `src/lib/scoring.ts` 와 함수 `supabase/functions/_shared/lib.ts` 가 **동일 수식**을 유지해야 한다(둘 다 고칠 것). 만점=100 정규화·EWMA 누적은 `scoring.ts` 참고. ⚠️ 레벨별 6축 코드(`categories.ts` ↔ `_shared/lib.ts` 의 `LEVEL_AXES`)도 양쪽 동기화 필수.
- **등급 변동 규칙**: 승급컷 = 정답률 비율(`promoteCut` — Lv.1~3 70%, Lv.4~7 80% → Lv.1 7/10 · Lv.2·3 14/20 · Lv.4~7 24/30. 2026-08-04 완화, 이전 80/90%). **강등은 없다(2026-07 제거)** — `computeRankChange` 는 승급(`up`) 아니면 유지(`stay`) 뿐이고, 강등선·3진 경고·강등 시드(`DEMOTE_*`)와 결과창/대시보드 경고 배너가 모두 삭제됐다. DB 컬럼 `user_progress.demotion_strikes`·`test_attempts.warn_strikes` 는 남아있지만 읽지도 쓰지도 않는 vestigial(옛 기록의 `rank_dir='down'` 은 서버가 `stay` 로 접어서 내려줌). 규칙/컷 바꾸면 양쪽 `scoring.ts`·`_shared/lib.ts` + 레벨선택 규칙박스 문구(`lv.rule_*`)가 같이 갱신됨.
- **시즌 점수 (2026-08-04 원안 반영)**: 리더보드 정렬 단일 출처 = `user_progress.season_total` = **레벨테스트 트랙**(`skill_score`) + **활동 트랙**(`activity_score`).
  - 레벨테스트 = 레벨 클리어 1회당 **+1,000**(부분점수 없음 — 승급컷 미달은 0) · 7단계 전부 = **7,000**. `applyAttempt` 가 "클리어한 레벨 수 = 도달 등급−1, 단 천장에서 Lv.7 을 통과하면 7" 로 계산해 GREATEST 로 쌓는다.
  - 활동 = 미니게임 +2(일 3회) · 오늘의 학습 +2(일 1회) · 친구 초대 +5(일 1회) · 출석 +5(일 1회) → 시즌(365일) 상한 **6,570**. 적립값·일일횟수·시즌상한 3표가 한 벌이다(`ACTIVITY_DELTA`/`ACTIVITY_PER_DAY`/`ACTIVITY_SEASON_MAX`, `seasonMax = delta × perDay × SEASON_DAYS`).
  - 전체 상한 **13,570**. 표시 레벨 `ARENA Lv.N` = 시즌 총점 1,000점 균등 밴드(`arenaLevelForScore`/`arenaBand`) — **시험 사다리 등급(`user_progress.rank`)과 별개 축**이다(결과창 승급 연출은 계속 rank 기준). ⚠️ 활동만 채워도(6,570) Lv.7 밴드에 들어간다 — 원안이 그런 안이다(수정 제안은 바탕화면 `WORLD_ARENA_점수체계_수정제안.html`).
  - ⚠️ 미니게임은 **참여 횟수당 고정 적립**이라 성적이 활동점수에 반영되지 않는다(게임 실력은 `minigame_scores` 랭킹 전용). 하루 캡은 `activity_ledger` 의 `unique(user_id, day, source_ref)` 를 회차 슬롯(`play:1`…`play:3`)으로 써서 건다.
  - ⚠️ 친구 초대(`referral`)는 **점수 규칙만 선반영** — 초대코드 발급·가입 귀속 플로우가 없어 적립 호출부가 아직 없다.
  - 옛 `computePoints`(0~10000)는 `user_progress.points` 컬럼 전용으로만 남았다(`leaderboard_v2` 등 구코드용).
  - 값을 바꾸면 **양쪽 `scoring.ts` + `tests/db/t-scoring-parity.mjs`** 를 같이 고쳐야 한다 — 패리티 테스트가 두 파일의 소스 바이트 동일성까지 본다.
- **i18n**: 라이브러리 없이 `src/lib/i18n.tsx` 의 `D` 사전. 6개국어(ko·en·ja·zh·hi·vi). 문구 추가 시 6개 다 채울 것. `{var}` 보간.
- **레벨 추천**: 검색어 → `recommend-level` 함수 → Gemini 임베딩 코사인 → 레벨. 앵커 문구가 품질 좌우. 레벨 7개라 pgvector 불필요(메모리 비교). → `docs/온보딩.html` §12
- **캐릭터(아바타)**: `profiles.avatar_url` 한 컬럼에 `gem:#hex`(젬 색) 또는 `img:<public-url>`(업로드 이미지) 저장. 그 외 값/NULL(구글 가입 URL 등)은 무시하고 시드 젬으로 표시. 해석·팔레트·업로드는 `src/lib/avatar.ts`(`parseAvatar`/`uploadAvatar`), 렌더는 `<Avatar>`(`GemAvatar.tsx`). 업로드는 Supabase Storage **공개 버킷 `avatars`**(경로 `<uid>/...`, RLS=본인 폴더만 — 버킷·정책은 대시보드 SQL로 생성). 리더보드도 이미지/색을 반환하므로 변경 시 `leaderboard` 함수 재배포 필요.
- **테마(다크/라이트)**: `html.dark` 클래스 하나로 토큰을 뒤집는다(`stitch.css` 의 `html.dark` 블록이 `--color-*`·`--bg`·`--ink` 등 단일 출처). **기본값 = 다크**(2026-08-04) — `index.html` 이 `<html class="dark">` 를 박고 인라인 스크립트가 `localStorage.theme === 'light'` 일 때만 벗긴다(FAB 패널의 해/달 토글이 저장). 페이지 단위 고정은 `.force-dark`(랜딩 — 배경이 항상 우주) / `.force-light`(`/exam/run` 응시화면 · 로그인 카드) 두 개뿐이고 테마 무관하게 유지된다.
  - ⚠️ **떠 있는 두 버튼(`.fab`·`.fab-top`)의 면은 테마와 무관하게 항상 흰색**이다(`fab.css` 의 `--fab-face`/`--fab-face-line`/`--fab-face-ink`). 다크에서 `--bg` 를 쓰면 어두운 배경 위 어두운 원이라 안 보인다. **이 두 버튼 안에서 `--ink`·`--line2` 를 쓰면 안 된다**(다크에선 밝은 값이라 흰 면에서 증발). 열리는 패널(`.panel`)은 해당 없음 — 계속 테마를 따른다.
- **등급 연출**: 결과창은 원점수 판정으로 **승급 배너+애니**(강등이 없으니 하락 배너도 없다), 레벨별 누적 레이더(고스트=현재−deltas) 표시(`Result.tsx`). 대시보드는 레벨별 레이더를 ‹ ›로 전환.
- **티어 엠블렘**: 티어는 백분위 파생 **5단계**(브론즈~다이아, `tierForPercentile`). 엠블렘은 이미지 단일 체계 — 화면은 `<TierBadge>`가 `public/emblems/<tier>.webp`(256px), 공유 카드는 같은 그림의 `<tier>.png`(512px, 캔버스용). 마이페이지 히어로 옆 **티어 사다리**(`TIER_ORDER`, 내 티어만 원색)도 이걸 쓴다. ⚠️ 옛 레벨 엠블렘(iron~master 7단계 SVG `TierEmblem`·`emblemKeyForLevel`)은 삭제됐다.

## 운영에서 자주 막히는 것 (반드시 숙지)

- **프론트는 `master` push → Cloudflare 자동배포**(빌드 수 분 소요). 함수는 **별도 CLI 배포** 필요. git push 로 함수 안 올라감. SPA 라우팅은 `wrangler.jsonc`(`not_found_handling`)로 처리 — `_redirects` 금지(무한루프).
- `_shared` import 하는 함수는 **CLI 로만** 안전 배포(대시보드 웹에디터는 `../_shared` 깨질 수 있음). `recommend-level` 만 단일 파일이라 대시보드 가능.
- **`GEMINI_API_KEY` 는 Supabase 함수 시크릿**(프론트 금지). 키 무효면 추천이 500.
- **OAuth localhost 튕김** = Supabase Site URL 설정 문제. **모바일 인앱 브라우저 차단** = 구글 정책(기본 브라우저로 열어야 함).
- **쿨다운(3일 1회)** 토글 = `start-test` 의 `COOLDOWN_ENABLED`. 게스트는 원래 쿨다운 없음.
- **윈도우 PowerShell**: `npm`/`npx` 가 실행정책에 막히면 `npx.cmd`/`npm.cmd` 사용.

자세히는 → `docs/온보딩.html` (배포·트러블슈팅) · 구글 계정/Workspace 는 `docs/구글_계정_워크스페이스_가이드.html`

---

## 변경 리포트(보고용) — `report` 스킬 (`.claude/skills/report/`)

동료·상사에게 수정/신규 화면을 **시연 없이** 건넬 단일 HTML을 자동 생성한다. Playwright로 화면을 촬영 → 이미지 base64 내장 → `.claude/skills/report/out/index.html` (파일 하나, 메신저로 그대로 전송). 화면마다 스크린샷 + 한 줄 설명. 단순하게 유지할 것.

- **쓰는 법**: Claude에게 "○○ 보고서 만들어줘" 라고 하면 `report` 스킬이 발동돼 화면을 채우고 실행까지 한다(예전 `npm run report` 는 폐지). 절차·필드 전체는 `.claude/skills/report/SKILL.md` 참고.
- **구조**: 스킬 폴더 안에 `config.mjs`(URLS·META·SCREENS) · `lib.mjs`(촬영+목킹) · `template.mjs`(HTML) · `generate.mjs`(엔트리). 직접 돌릴 땐 `node .claude/skills/report/generate.mjs`.
- **데이터 화면**(결과·대시보드 등 `authed:true`)은 `lib.mjs` 가 가짜 세션 + Edge Function 목킹으로 렌더(`tests/responsive.spec.ts` 패턴 재사용). ⚠️ **API 응답 형태가 바뀌면 `lib.mjs` 의 목도 같이 고칠 것**(안 그러면 빈 화면).

---

## 📚 문서 맵

| 문서 | 내용 |
|---|---|
| [`docs/온보딩.html`](./docs/온보딩.html) | **신규 개발자 온보딩**(생성물) — 이 문서 하나로 개발 시작(아키텍처·데이터흐름·API·다이어그램, 브라우저로 열 것) |
| [`README.md`](./README.md) | 제품 한 줄 소개 · 스택 · 구조 · 보안 모델 요약 |
| [`SETUP.md`](./SETUP.md) | 최초 1회 셋업(Supabase·구글 로그인·함수 배포) |
| [`docs/기획안.md`](./docs/기획안.md) | 제품 기획(v2) — 요구사항·핵심 설계·DB·라우트 |
| [`docs/제품구상.md`](./docs/제품구상.md) | **제품 구상**(캐릭터 허브: 자격증·Lecture·CARIS ARENA) — excalidraw 캔버스 전사 + 확정 설계 결정(`[확정]`/`[제안]` 태그). 원본=`docs/design/제품구상.excalidraw` |
| [`docs/구현계획.md`](./docs/구현계획.md) | **구현 계획** — Phase 1(국가·지역·학교 온보딩 + 지역 경쟁) 상세 + 이후 로드맵. `제품구상.md`의 "어떻게" 짝 문서 |
| [`docs/구글_계정_워크스페이스_가이드.html`](./docs/구글_계정_워크스페이스_가이드.html) | 구글 로그인(OAuth) 계정 소유권·2FA·Workspace (생성물, 브라우저로 열 것) |
| [`docs/review-report.html`](./docs/review-report.html) | 코드 리뷰 리포트(생성물) |

> 새 기능/운영 사항을 추가하면 해당 문서를 갱신하고, 큰 변화는 이 표에 매핑한다.
