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
| `/` (메인·랜딩) | `pages/Landing.tsx` + `components/RankGlobe.tsx` | `landing.css` · `rankglobe.css` | `route-query`(의미 검색 라우터) · `leaderboard` |
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
| `/mypage` · `/mypage/:section` | `pages/MyPage.tsx` | (Tailwind 유틸) | `my-attempts` · `mypage-ai` · `ebooks` |
| `/ebooks` (러닝 라이브러리 = 교재+강의) | `pages/Ebooks.tsx` | (Tailwind 유틸) | `ebooks` |
| `/ebooks/read/:id` (이북 뷰어) | `pages/EbookReader.tsx` | (인라인) | `ebooks` |
| `/checkout?type=&ref=` (결제) | `pages/Checkout.tsx` | (Tailwind 유틸) | `payments` |
| `/pay/success` · `/pay/fail` (결제 결과) | `pages/PayResult.tsx` | (Tailwind 유틸) | `payments` |
| **캐릭터 허브 / 미니게임** ||||
| `/hub` (실동작 로비) | `pages/Hub.tsx` | `hub.css`(직접 import) | `get-hub` · `complete-daily` · `shop-buy` · `character` · `redeem-referral` · `coin-gift` |
| `/games/:gameId` | `pages/MiniGame.tsx` (목록=`lib/minigames.ts`) | `hub.css` · `minigame.css` | `submit-minigame` · `minigame-rank` |
| `/daily` (DAILY QUIZ — 옛 이름 '오늘의 학습') | `pages/Daily.tsx` — 루트 클래스 `.dy-page` | `daily.css`(직접 import) | `get-hub` · `complete-daily` |
| **WORLD ARENA (무료 레벨테스트 `/test/*`)** ||||
| `/arena` (지도+지역랭킹+채팅) | `pages/WorldArena.tsx` + `components/ArenaMap.tsx`·`ChatBoard.tsx` · `lib/arena/*` | `arena.css` · `chat.css` | `leaderboard` · `chat-list`·`chat-post`·`chat-report`·`chat-translate` |
| `/test/select` (레벨 선택) | `pages/LevelSelect.tsx` | `levelselect.css` | `recommend-level` |
| `/test/record` (내 기록) | `pages/LevelRecord.tsx` | `levelrecord.css` + 공용 카드(`dashboard.css`) | `list-attempts` |
| `/test/:attemptId` (응시) | `pages/TestRunner.tsx` | `test.css` | `start-test` · `submit-test` |
| `/test/result/:attemptId` | `pages/Result.tsx` | `result.css` | `get-result` |
| `/ranking` (리더보드) | `pages/Ranking.tsx` | `ranking.css` | `leaderboard` |
| **관리자** ||||
| `/admin` (탭 = `?top=`·`?tab=`) | `pages/Admin.tsx` (top=caris) · `pages/AdminLevelTest.tsx` (top=level) | `admin.css` | `admin` · `admin-test` |
> **화면별 상세는 `docs/notes/` 에 있다.** 표에서 대상 파일을 찾았으면 **그 노트를 읽고 손댈 것** — 거기 ⚠️·⛔ 는 전부 실제로 겪은 사고의 기록이라, 안 읽고 고치면 같은 사고가 그대로 재발한다.
>
> | 노트 | 다루는 것 |
> |---|---|
> | [허브·아레나](./docs/notes/허브-아레나.md) | `/hub` 화면 구성 · 첫 진입/캐릭터/스킨 · 미니게임 · `/arena` 채팅·번역 |
> | [랭킹·순위](./docs/notes/랭킹-순위.md) | 랜딩 지구본 · 순위 추이 · 아레나 집계 버킷 · 랭킹 더미 |
> | [이북·강의](./docs/notes/이북-강의.md) | `/ebooks` 3열 · 이북 업로드/번역/열람 · 강의 판매 |
> | [계정·운영](./docs/notes/계정-운영.md) | 로그인 수단 · 국가/지역 온보딩 · 회원탈퇴 · 게시판 분류 · `/guide` |
> | [결제·응시권](./docs/notes/결제-응시권.md) | 엑심베이 · 묶음/곁다리 결제 · 응시권 · SEB 인계 · 응시 중단 |

- 매칭 없는 경로는 전부 `/` 로 리다이렉트(404 페이지 없음).

## 구조 맵

```
src/
  lib/         supabase 클라(callFunction), types, scoring(만점100 정규화·EWMA·등급변동), categories(레벨별 6축 다국어 라벨), testConfig, i18n(자체 6개국어)
  lib/dict/    언어별 사전 6벌(ko 는 정적, 나머지는 그 언어를 고른 사람만 받는다)
  context/     AuthProvider — 익명/구글 로그인 + claim 토큰 이관
  hooks/       useAntiCheat(복사차단+이탈감지), useCountUp
  components/  Layout(FAB 패널·언어선택), TierBadge(티어 엠블렘 이미지), RadarChartBox, TopBar 등
  pages/       47개 — 라우트별 매핑은 위 "라우트 ↔ 파일 맵" 표 참고
  styles/      페이지별 css (index.css 가 일괄 @import · hub.css만 페이지에서 직접)
supabase/
  schema.sql   테이블 + RLS (잠금 테이블은 service role 전용) · v3=다국어/레벨별6축
  migrate_v3.sql v2→v3 정리(드롭) → schema.sql 재실행 (pre-launch 전용, 데이터 폐기)
  seed.sql     샘플 문제 120개(레벨1~5 × 6축 × 4, ko/en) — 실제 문항으로 교체 필요
  functions/   50개 — CBT(start-exam·submit-exam·get-exam-result·verify-cert·seb-handoff) · 이북(ebooks) · 결제(payments·payments-webhook) · 레벨테스트(start-test·submit-test·get-result·list-attempts·leaderboard·recommend-level)
               · 허브(get-hub·complete-daily·shop-buy·character·room·redeem-referral·coin-gift) · 검색라우터(route-query·route-seed)
               · 채팅(chat-list·chat-post·chat-report·chat-translate) · 지식베이스(kb-*·lecture-qa) · 운영(admin·admin-test·my-attempts·mypage-ai·set-region·translate-questions·track-visit)
  functions/_shared/  cors.ts · lib.ts (스코어링·인증·쿨다운 공용) · payments.ts(주문·금액검증·지급·대사)
                      · chat.ts(모더레이션·방) · translate.ts(번역 판정) · country-lang.ts(국가→번역 대상 언어)
tools/translate-worker/  엣지 번역 워커(Playwright + Edge). 우리 기계에서 돌며 번역 창고를 채운다 — **번역하는 건 이것뿐이라 꺼지면 번역이 안 된다.**
```

**DB 테이블**(요약): `profiles`, `questions`(다국어 JSONB·정답 클라 비노출), `test_attempts`(응시 언어·등급변동 스냅샷), `attempt_answers`, `user_level_skill`(레벨별 누적 6축 레이팅), `user_progress`(현재 등급=레벨).

## 핵심 규칙 / 컨벤션

- **첫 진입에 필요한 것만 받는다 (2026-08-14 정리)** — "화면마다 한 박자 멈췄다 열린다" 를 잡느라 손본 것들이고, 되돌리면 그대로 재발한다.
  - **화면은 `lazy()` 로 받는다**(`App.tsx`). 랜딩만 정적이다(대부분이 처음 닿는 화면이라 청크를 한 번 더 왕복시키면 손해). **새 라우트를 정적 import 로 넣지 말 것** — 그 화면이 쓰는 라이브러리까지 첫 진입 번들로 딸려 온다(xlsx·react-quill = 관리자, d3 = 아레나). 첫 진입 JS 1.33MB → 621KB(gzip 423 → 194KB).
  - **사전은 언어별로 받는다** — 위 i18n 절 참고. 490KB 중 한국어 112KB 만 정적.
  - **게임 이미지는 WebP 다**(`public/games/*.webp`, 229MB → 20MB). 새 에셋도 PNG 로 넣지 말 것. 변환은 `ffmpeg -c:v libwebp`(작은 건 `-lossless 1`, 큰 건 `-quality 90`) — 알파는 그대로 보존된다.
  - **국기는 파일이다 — 이모지로 쓰지 말 것**(`public/flags/<iso>.svg`, flag-icons 4x3 · MIT · 249개국 · 총 2.0MB · 2026-08-18). **윈도우에 국기 글리프가 없어서** 크롬·엣지가 🇰🇷 대신 `KR` 두 글자를 그린다(파이어폭스만 Twemoji 내장). 경로는 `regions.ts` 의 `flagUrl()` 하나가 만들고, 목록에 없는 코드는 빈 문자열을 돌려줘 호출부가 렌더를 생략한다.
    - ⚠️ **래스터(PNG·WebP)로 되돌리지 말 것.** 처음엔 flagcdn w160 WebP 였는데 20~30px 로 그려도 흐렸다. 원인은 크기가 아니라 **파일이 원본부터 뭉개져 있던 것**이라(120px 로 확대하면 성조기 별·인도 차크라가 계단으로 깨진다) w320·w640 으로 올려도 개선이 없었다 — 벡터만이 답이었다. 덤으로 4x3 이라 `aspect-ratio:4/3` 박스에서 안 잘린다(flagcdn 은 국기마다 실제 비율이라 좌우가 잘렸다).
    - ⚠️ **번들에 넣지 말 것.** 파일당 하나라 화면에 뜬 나라만 받는다 — 시상대면 3장이고 249개 중 70%가 2KB 미만이다. 통으로 싣는 순간 첫 진입 비용이 된다. 문장이 복잡한 몇 개(세르비아 177KB·볼리비아 100KB)는 SVGO 로도 1.4%밖에 안 준다 — 이미 최적화된 파일이다.
    - ⚠️ **크기 하한이 있다.** 폭 20px 아래로 내리면 태극기 4괘·성조기 별을 담을 자리 자체가 없다(`.hof-pn-flag` 1em · `.bar-flag` 1.15em · `.chat-flag` 1.35em — 전부 글자 높이 기준이라 화면이 좁아지면 같이 준다).
    - ⚠️ 옛 `flagEmoji()` 도 남아 있다(`/arena` 채팅·방 이름). **그 두 자리는 아직 이모지라 윈도우에서 안 보인다** — 옮길 때 `flagUrl()` 로 바꿀 것.
  - ⛔ **이미지를 HTML 안에 base64 로 박지 말 것.** `shoot-cari.html` 이 그래서 4.8MB 였다(그중 4.75MB 가 그림 3장). 박아 두면 ① HTML 을 다 받기 전엔 파싱이 안 끝나고 ② 브라우저가 캐시를 못 해 들어올 때마다 다시 받는다. 파일로 빼면 58KB.
  - 아직 안 한 것: 페이지별 CSS 분리(전역 `index.css` 273KB). 파일끼리 클래스가 얽혀 있어 옮기면 조용히 깨지는 화면이 나온다 — 손대려면 화면을 눈으로 대조하면서 한 파일씩 할 것. `public/` 에 남은 1~2MB 짜리 PNG(자격증 템플릿·로고·마스코트·룸)도 그대로다.
- **보안 모델**: `questions.correct_index`·`test_attempts`·`attempt_answers`·`user_level_skill`·`user_progress` 는 **클라 직접 SELECT 금지**(RLS 미부여 = service role 전용). 출제·채점·결과 서빙은 **Edge Function 에서만**. 익명 유저 응답에선 총점 외 데이터를 서버가 제외. 정답은 언어 무관 단일 컬럼(`correct_index`)이라 번역과 무관.
- **스코어링 단일 출처**: 프론트 `src/lib/scoring.ts` 와 함수 `supabase/functions/_shared/lib.ts` 가 **동일 수식**을 유지해야 한다(둘 다 고칠 것). 만점=100 정규화·EWMA 누적은 `scoring.ts` 참고. ⚠️ 레벨별 6축 코드(`categories.ts` ↔ `_shared/lib.ts` 의 `LEVEL_AXES`)도 양쪽 동기화 필수.
- **레벨 사다리 두 번째 밀기 (2026-08-27 · `20260827120000`)** — **옛 Lv.2~5 → Lv.3~6.** Lv.1 은 제자리, Lv.7 도 제자리(축 용어만 다듬고 6개국어를 채웠다). 옛 Lv.6 은 살아있는 문항이 0개(63건 전부 삭제 상태)라 그 자리를 옛 Lv.5 가 이어받았고, 결과로 **Lv.2 가 빈 레벨**이 됐다. 축 코드도 같이 밀렸다(옛 `l2_principle` = 지금 `l3_principle`).
  - ⛔ **시험 규격 경계도 같이 밀어야 한다 — 이게 이 작업의 핵심 함정이다.** 보기 개수는 문항이 아니라 **레벨**이 정하는데(`OPTIONS_BY_LEVEL`) 옛 L3 문항은 DB 에 보기가 **4개뿐**이다(2026-08-04 에 5번째를 지웠다). 경계를 안 밀면 새 L4 시험이 5지선다 규칙에 걸려 **보기가 하나 빈 채로 출제된다.** 그래서 4지선다 = Lv.1~4 · 문항수 20 = Lv.2~4 · 승급컷 70% = Lv.1~4 로 셋 다 한 칸씩 옮겼다(`questionsForLevel`·`promoteCut`·`OPTIONS_BY_LEVEL`, 양쪽 `scoring.ts`).
  - **Lv.2 는 같은 날 다시 채워졌다** — 6축(`l2_biz_prompt`·`l2_life_prompt`·`l2_technique`·`l2_tools`·`l2_productivity`·`l2_solve_ethics`) + 문항 30개(L2-001~030 · 영역당 5개 · 4지선다 · 6개국어) → `COMING_SOON_LEVELS` 잠금 해제. 사다리는 다시 Lv.1~7 이 끊김 없이 이어진다.
    - ⛔ **축 코드를 옛 `l2_*`(l2_principle·l2_security·l2_ethics·l2_responsibility·l2_llm_eco·l2_prompt — 지금은 `l3_*`)와 겹치게 만들지 말 것.** 그 코드들은 **옛 응시 기록에 밀기 전 값 그대로 남아 있다**(`test_answers` 실측 6종 전부 생존 — 사용자 쪽 표를 안 밀었기 때문). 재사용하면 옛 답안이 새 영역 이름으로 뜬다.
    - ⛔ **잠금은 문항이 실제로 들어온 뒤에 푼다.** 순서를 뒤집으면 `start-test` 가 '해당 레벨의 문제가 없습니다.' 로 400 을 내고, 사용자는 이유를 모르는 오류만 본다. 잠겨 있는 동안에는 Lv.1 클리어자(등급 2)의 **승급이 멈춘다** — 그래서 오래 잠가둘 자리가 아니다.
  - ⛔ **사용자 쪽 표는 한 줄도 안 건드렸다**(2026-08-27 지시 — 전부 테스트 계정): `test_attempts`·`test_answers`·`user_level_skill`·`user_progress`. 그래서 옛 응시 기록의 레벨·축이 새 편성과 어긋나 `/test/record` 레이더가 빈다. 나중에 밀 때 ⚠️ `user_level_skill` PK 가 `(user_id, level)` 라 **옛 Lv.6 행이 있는 한 5→6 을 못 민다**(먼저 지워야 한다).
  - ⛔ **옛 Lv.6 흔적도 남겨뒀다**: 삭제문항 63건(`L6-001~063` · 축 `l6_reasoning` 등)과 KB 274개가 새 Lv.6 과 한 레벨에 공존한다. 그래서 새 문항 번호는 **`L6-064` 부터** 매겼다(마이그레이션이 옛 최대 번호만큼 밀어준다). 옛 `l6_ros2` 는 새 `l6_ros2`(옛 `l5_ros2`)와 코드가 겹쳐 화면에 새 라벨로 뜨고, 나머지 옛 축 5개는 정의가 없어 코드가 그대로 뜬다.
  - ⚠️ **`kb_chunks.axis` 는 2026-07 밀기 때부터 한 칸씩 어긋나 있었다**(level 2 의 축이 `l1_*`). 그때 `level` 만 밀고 `axis` 를 안 밀었다 — 문항 생성 탭이 꺼져 있어 아무도 못 봤다. 이번 마이그레이션은 축을 '지금 접두사 +1' 이 아니라 **목표 레벨로 다시 붙여서**(`'l' || (lv+1)`) 움직이는 2~5 를 정상화했다. ⛔ **안 움직인 Lv.7 은 아직 `l6_*` 로 어긋나 있다**(Lv.6 의 옛 274개도 마찬가지) — 문항 생성을 열기 전에 고칠 것.
  - ⚠️ `question_events.code` 도 2026-07 밀기 이후 실제 문항 번호와 달랐다(level 2 이력 66건이 `L1-*`). 관리자가 번호로 검색하는 화면이라 이번에 전부 지금 번호로 맞췄다.
  - 선례: 첫 밀기 `20260722090000_level_ladder_shift.sql`(옛 1~6 → 2~7). 되돌리기는 `_bak_20260827_*` 스냅샷.
- **시험 규모**: 문항 수 = 제한시간(분), 레벨 구간별 — **Lv.1 = 10 · Lv.2 = 15 · Lv.3~4 = 20 · Lv.5~7 = 30**(2026-08-27 지시로 Lv.2 가 15로 따로 떨어졌다). 단일 출처는 양쪽 `scoring.ts` 의 `questionsForLevel`(`durationMinutesForLevel` 이 그대로 재사용). ⚠️ **문항 수 구간과 승급컷·보기 개수 경계는 다른 축이다** — 승급컷 70/80% 와 4/5지선다는 둘 다 Lv.4/Lv.5 에서 갈리고, 문항 수만 Lv.2 에서 한 번 더 나뉜다. 셋을 한 덩어리로 보고 같이 옮기면 어긋난다. ⚠️ 화면 문구는 전부 이 함수에서 계산된다(`lv.fact_q`·`lv.fact_min`·`lv.fact_cut`) — 문구에 숫자를 박지 말 것.
- **등급 변동 규칙**: 승급컷 = 정답률 비율(`promoteCut` — Lv.1~4 70%, Lv.5~7 80% → Lv.1 7/10 · Lv.2 11/15 · Lv.3·4 14/20 · Lv.5~7 24/30. 2026-08-04 완화, 이전 80/90% · 2026-08-27 경계 한 칸 밀기). **강등은 없다(2026-07 제거)** — `computeRankChange` 는 승급(`up`) 아니면 유지(`stay`) 뿐이고, 강등선·3진 경고·강등 시드(`DEMOTE_*`)와 결과창/대시보드 경고 배너가 모두 삭제됐다. DB 컬럼 `user_progress.demotion_strikes`·`test_attempts.warn_strikes` 는 남아있지만 읽지도 쓰지도 않는 vestigial(옛 기록의 `rank_dir='down'` 은 서버가 `stay` 로 접어서 내려줌). 규칙/컷 바꾸면 양쪽 `scoring.ts`·`_shared/lib.ts` + 레벨선택 규칙박스 문구(`lv.rule_*`)가 같이 갱신됨.
- **시즌 점수 (2026-08-04 원안 반영)**: 리더보드 정렬 단일 출처 = `user_progress.season_total` = **레벨테스트 트랙**(`skill_score`) + **활동 트랙**(`activity_score`).
  - 레벨테스트 = 레벨 클리어 1회당 **+1,000**(부분점수 없음 — 승급컷 미달은 0) · 7단계 전부 = **7,000**. `applyAttempt` 가 "클리어한 레벨 수 = 도달 등급−1, 단 천장에서 Lv.7 을 통과하면 7" 로 계산해 GREATEST 로 쌓는다.
  - 활동 = 미니게임 +2(일 3회) · DAILY QUIZ +2(일 1회) · 출석 +5(일 1회) → 시즌(365일) 상한 **4,745**. 적립값·일일횟수·시즌상한 3표가 한 벌이다(`ACTIVITY_DELTA`/`ACTIVITY_PER_DAY`/`ACTIVITY_SEASON_MAX`, `seasonMax = delta × perDay × SEASON_DAYS`).
  - 전체 상한 **11,745**. 표시 레벨 `ARENA Lv.N` = 시즌 총점 1,000점 균등 밴드(`arenaLevelForScore`/`arenaBand`) — **시험 사다리 등급(`user_progress.rank`)과 별개 축**이다(결과창 승급 연출은 계속 rank 기준).
  - ⚠️ 미니게임은 **참여 횟수당 고정 적립**이라 성적이 활동점수에 반영되지 않는다(게임 실력은 `minigame_scores` 랭킹 전용). 하루 캡은 `activity_ledger` 의 `unique(user_id, day, source_ref)` 를 회차 슬롯(`play:1`…`play:3`)으로 써서 건다.
  - ⛔ **친구 초대는 이제 점수를 주지 않는다(2026-08-24)** — 보상이 **코인 500(양쪽 다 · 도입 때는 50)** 으로 옮겨갔다(아래 '친구 초대' 절). 그래서 활동 상한이 6,570 → **4,745**, 전체 상한이 13,570 → **11,745** 로 내려갔다.
    - ⚠️ **부수효과 하나가 원안의 성질을 깼다** — 예전엔 활동만 채워도(6,570) Lv.7 밴드에 들어갔는데 지금은 **Lv.5 까지**다. 되돌리려면 남은 3종의 적립값을 올릴 것(초대를 점수 표로 되돌리는 건 답이 아니다 — 화면이 주지도 않는 점수를 약속하게 된다). 보류중인 수정안(바탕화면 `WORLD_ARENA_점수체계_수정제안.html`)이 노리던 방향과 우연히 같다.
    - `activity_ledger` 의 kind CHECK 에는 `referral` 이 남아 있고 **이미 적립된 옛 행도 그대로 둔다**(받은 점수를 빼앗지 않는다). 새로 쌓는 곳만 없어졌다.
  - 옛 `computePoints`(0~10000)는 `user_progress.points` 컬럼 전용으로만 남았다(`leaderboard_v2` 등 구코드용).
  - 값을 바꾸면 **양쪽 `scoring.ts` + `tests/db/t-scoring-parity.mjs`** 를 같이 고쳐야 한다 — 패리티 테스트가 두 파일의 소스 바이트 동일성까지 본다.
- **CARIS 자격검정 문항 다국어(2026-08-25)** — 응시자가 자기 언어로 시험을 본다. 여태 `questions.prompt`(text)·`choices`(jsonb) 단일 컬럼이라 번역을 담을 자리가 없어서, 무료 레벨테스트는 6개국어인데 **돈 받는 CARIS 만 한국어**였다.
  - ⛔ **한국어의 단일 출처는 여전히 `prompt`·`choices` 다 — `*_i18n` 에 ko 를 넣지 않는다.** 레벨테스트(`test_questions.prompt_i18n`)는 ko 까지 담지만 CARIS 는 관리자 화면(문항목록·채점·분석·미리보기·엑셀)이 원본 컬럼을 **열 곳 넘게** 읽는다. ko 를 i18n 안으로 옮기면 한 자리만 놓쳐도 **조용히 빈 문자열**이 되고, 옮겨도 ko 가 두 군데 생겨 동기화 페어가 늘어난다. 번역본만 담으면 중복이 0이고 관리자 화면은 손댈 게 없다.
  - 투영은 `_shared/lib.ts` 의 `projKoText`/`projKoOptions` 하나뿐이다 — ko 요청이면 원본, 번역이 있으면 번역본, **없으면 원본(한국어)**. 미번역 문항은 그 문항만 한국어로 뜬다(빈 화면이 아니다).
  - ⚠️ **보기 개수가 어긋난 번역은 버린다.** 보기 순서가 곧 정답 번호(`correct_index`)라 개수가 다르면 정답이 다른 보기를 가리켜 **아무도 못 맞히는 문항**이 된다. 검사는 저장(`sanitizeQuestionTrans`)과 서빙(`projKoOptions`) 양쪽에 있다.
  - **응시 언어는 시작할 때 못 박는다**(`exam_attempts.lang`, `start-exam` 이 기록). 재개는 요청 언어가 아니라 **처음 응시한 언어**로 돌아가고(`effLang`), 결과창 오답노트도 이 값으로 투영한다. ⚠️ 화면 언어로 투영하면 응시 후 언어를 바꾼 사람에게 **시험 때 본 적 없는 지문**이 오답노트로 뜬다.
  - ⛔ **원문(한국어)을 고치면 옛 번역을 그 자리에서 비운다**(`questionUpsert` 의 `koChanged`). 안 비우면 지문만 고쳐도 번역본은 옛 문장 그대로라 **외국어 응시자만 다른 문제를 푼다** — 화면에는 아무 표시도 안 남는 종류의 사고다(이북 번역이 본문 교체 때 옛 번역을 비우는 것과 같은 이유).
  - **번역이 도는 자리는 셋**(전부 같은 파이프라인 = `lib/adminTranslate.ts` → `translate-questions`): **엑셀 업로드 직후 자동**(2026-08-26) · 문항 목록의 `🌐 미번역 번역`(선택분 또는 미번역 전부) · 문항 편집 모달의 `🌐 자동 번역`.
    - ⛔ **셋 다 `translateQuestionsAndSave`(Admin.tsx) 한 함수를 쓴다.** 두 벌이 되면 "빈 답 번역은 담지 않는다" 같은 규칙이 한쪽에만 남아, **어느 경로로 올렸느냐에 따라 같은 문항이 다르게 저장된다**(그 차이는 화면에 안 드러난다).
    - ⛔ **번역이 끝나는 대로 배치마다 저장한다 — 전부 끝난 뒤 한 번에 저장하지 말 것.** 모아서 저장하면 300문항 중 280개를 번역한 뒤 창을 닫거나 네트워크가 끊길 때 **280개분 Gemini 호출이 통째로 버려진다**(그렇게 만들었다가 고쳤다). 지금은 그때까지 번역된 것이 DB 에 남아 다시 눌렀을 때 진짜 남은 것만 돈다. ⚠️ `onBatch` 는 동기 콜백이라 저장을 Promise 한 줄로 이어붙이고 마지막에 기다린다. ⚠️ '저장했다' 표시는 **저장 성공 뒤에** 찍는다 — 먼저 찍으면 저장이 실패한 문항이 영영 다시 안 올라간다.
    - ⛔ **업로드는 문항을 먼저 저장하고 번역을 이어서 돌린다.** 레벨테스트('문항 추가 & 번역' 탭)는 반대로 **번역이 끝나야 저장**하고, 그래서 도중에 창을 닫으면 잃는 것을 localStorage 자동저장으로 막는다. CARIS 는 저장 순서로 같은 문제를 푼다 — 번역 중 창을 닫아도 문항은 DB 에 있고 남은 번역은 「미번역 번역」이 그대로 이어받는다. (2026-08-25 에 "업로드 직후 자동 번역은 안 한다"고 적었던 이유가 바로 이 '창을 못 닫는다' 였는데, 순서를 뒤집으면 그 이유 자체가 없어진다.)
    - ⚠️ **`questionsImport` 가 방금 넣은 행의 id·번호를 돌려준다**(`inserted`). 화면은 그걸로 번역을 붙인다 — 안 오면(옛 배포본) **번역을 건너뛰고 안내만 한다.** 어느 문항인지 모르는 채 순서로 추측하면 남의 문항에 번역이 박히고 화면엔 아무 표시도 안 남는다.
    - ⚠️ **번역에서 터져도 "업로드 실패"로 띄우지 말 것** — 관리자가 문항까지 안 들어간 줄 알고 같은 파일을 다시 올려 **중복 문항**을 만든다(업로드는 언제나 뒤에 새로 추가된다).
  - ⛔ **지갑이 둘이다** — `translate-questions` 가 요청의 `use` 로 키를 가른다: `leveltest`(기본) → `GEMINI_API_KEY_TRANSLATE` · `caris` → `GEMINI_API_KEY_TEST_GENERATE`(문항생성용, 지금 노는 것). 구글 무료 한도는 **프로젝트 단위**라 같은 지갑에 두면 CARIS 588문항 번역이 그날 레벨테스트 번역까지 막는다. ⚠️ 키 이름을 클라가 보내지 않는다 — 용도 문자열만 받고 매핑은 서버 고정이다.
  - **미번역은 막지 않고 알린다**(2026-08-25 결정). 세트 뽑기(`examDraw`)는 미번역 문항을 후보에서 **빼지 않고** 몇 개인지 돌려주기만 한다 — 빼면 번역이 덜 된 동안 `보유 0/필요 N` 으로 회차를 못 연다. 관리자는 **문항 풀 현황표 바로 밑의 '언어별 번역 완료율'** 과 목록의 `미번역만 보기`로 남은 것을 모아 본다.
  - ⚠️ 완료율 분모는 **활성 문항**이다. 비활성은 세트에 안 뽑혀 번역할 이유가 없는데 분모에 넣으면 영영 100%가 안 돼서 "다 됐다"를 아무도 판단 못 한다. '미번역만 보기' 필터도 같은 규칙이라 둘이 어긋나지 않는다.
  - ⚠️ 미번역 판정의 단일 출처는 **서버**(`questionList` 가 문항마다 `missing` 을 계산해 내려준다). 화면에서 다시 세면 목록 배지와 완료율이 서로 다른 말을 한다. 언어 목록도 한 쌍이다 — 서버 `TRANSLATABLE_LANGS` ↔ 화면 `TRANS_LANGS`(둘 다 ko 제외 5개).
  - ⚠️ **과목명은 번역 대상이 아니다** — 문항의 `subject` 는 매칭 키(정규명 완전일치)라 한국어 그대로 두고, 화면 표시만 사전(`caris.t1.*.subj.*`)이 번역한다. 여기에 `subject_i18n` 을 만들면 출제·집계 매칭이 통째로 깨진다.
  - ⚠️ **해설(`explanation`)은 번역하지 않는다** — 관리자 전용이라 응시자에게 안 나간다(번역기에 **문맥으로 보내기만** 하고 받은 번역은 버린다). **모범답안은 반대다 — 번역해서 저장한다**(바로 아래).
  - 기존 588문항(Beginner 135·Pro 220·Elite 233)은 백필 완료. 다시 돌릴 일이 있으면 대상 판정이 `not (prompt_i18n ?& array[...])` 라 **남은 것만** 잡힌다.
- **주관식 모범답안 다국어 · 자동채점(2026-08-26 · `20260826160000`)** — 주관식 허용답안을 5개국어로 번역해 `questions.answer_key_i18n` 에 담고, 채점은 **원문+번역 합집합**과의 정규화 정확일치로 한다. 이걸로 외국어 응시자의 주관식도 자동채점된다(여태 전부 사람 손 채점으로 넘어갔다).
  - ⛔ **이 자리에 LLM 채점을 넣지 말 것.** 주관식 답은 서술형이 아니라 **용어 단답**이다(74문항 전부 · 평균 27자 · `엣지 컴퓨팅 / Edge Computing`, `칼만 필터 / Kalman Filter`, `NPU`) — 정확일치로 채점되도록 만들어진 물건이고, 원문 허용답안에 **영어 표기가 이미 섞여 있다**. 번역은 문항 등록 때 **74문항 × 1회**면 끝이라 응시자 수와 무관하다. 응시 때마다 LLM 을 부르면 상시 비용이 되고 지갑(구글 프로젝트)을 하나 더 파야 한다.
    - 옛 코드 주석(`submit-exam`)과 이 문서에는 *"모범답안을 번역해도 안 풀린다 — 서술형은 표현이 제각각이라"* 가 적혀 있었다. **데이터를 안 보고 쓴 문장이다**(실제 `answer_key` 를 한 줄도 안 열어봤다). 되살리지 말 것.
  - ⛔ **대조는 전 언어 합집합이다**(`acceptedAnswerPool` — `normalize.ts` 의 sync pair). 응시 언어의 목록만 보면 안 된다 — 일본어로 응시해도 기술 용어는 **영어로 쓰는 일이 흔하고**(`Edge Computing`) 한국어 표기를 그대로 치는 사람도 있다. 어느 쪽이든 맞는 답이다.
  - ⛔ **그 언어 번역이 없으면 자동채점하지 않는다**(`answerLangReady` → `pending`). 이 게이트가 빠지면 일본어 응시자가 일본어로 쓴 **정답이 한국어 목록과 안 맞아 오답으로 확정**된다 — 자동채점은 되돌릴 기회 없이 굳는다(옛 `koAttempt` 가 통째로 막아뒀던 그 사고다).
  - ⚠️ **보기(`choices`)와 규칙이 정반대다 — 개수를 맞추지 않는다.** 표기 변형 가짓수가 언어마다 다르고, 순서가 정답 번호를 가리키지도 않는다(채점은 합집합 포함 여부만 본다). 보기 쪽 개수 검사를 여기 복사하면 멀쩡한 번역이 전부 버려진다.
  - ⚠️ **답 번역이 빈 언어는 담지 않고 넘어간다 — 그 언어를 탈락시키지 않는다.** 탈락시키면 멀쩡히 번역된 지문까지 같이 버려진다. 안 담으면 `questionTranslated` 가 '미번역'으로 남겨 다음 번역 때 그 문항만 다시 잡힌다.
  - ⛔ **모범답안이 바뀌면 그 번역을 그 자리에서 비운다**(`questionUpsert` · 모달의 `koKey`). 안 비우면 채점 목록에 **다른 답이 섞여 틀린 답이 정답으로 통과**한다. ⚠️ 지문·보기 변경과 **따로** 본다 — 답만 고쳤는데 지문 번역 5개국어를 같이 버리면 다시 번역해야 한다.
  - **백필 스위치는 `questionTranslated` 한 줄이다** — 주관식은 모범답안 번역까지 있어야 완료로 치므로, 지문이 이미 번역된 옛 74문항이 자동으로 '미번역'으로 떠서 관리자가 기존 「🌐 미번역 번역」 버튼 한 번으로 답까지 채운다. ⚠️ 이 판정을 부르는 곳은 `answer_key`·`answer_key_i18n` 을 **같이 select** 해야 한다(안 하면 전부 미번역으로 세어 경고가 거짓말을 한다).
  - 검증: `tests/short-normalize.mjs`(⭐합집합 대조·⭐언어 게이트·front/edge parity — 2026-08-26 부터 `test:db` 에 포함).
  - 배포: 마이그레이션 적용 + `npx.cmd supabase functions deploy translate-questions admin submit-exam`(전부 플래그 없이). **배포 뒤 관리자 › 문항 목록에서 「🌐 미번역 번역」을 눌러야** 실제로 채워진다.
- **i18n**: 라이브러리 없이 자체 사전. 6개국어(ko·en·ja·zh·hi·vi). 문구 추가 시 6개 다 채울 것. `{var}` 보간.
  - **사전은 언어별 파일이다 — `src/lib/dict/<lang>.ts`(2026-08-14).** 옛 `i18n.tsx` 의 `D`(키 1,568개 × 6개국어 한 덩어리, 490KB)를 쪼갠 것이다. i18n 은 최상위 프로바이더라 **모든 화면이 무조건** 이걸 받는데, 그중 5/6 은 아무도 안 읽는 언어였다. 지금은 한국어만 정적으로 싣고(기본 언어 겸 폴백) 나머지는 그 언어를 고른 사람만 받는다.
    - ⚠️ **`tr()` 은 동기 함수로 유지할 것** — `shareCard.ts`·`caris.ts` 처럼 훅을 못 쓰는 계층이 그대로 부른다. 그래서 사전은 프로바이더가 미리 받아 두고 조회는 메모리에서만 한다.
    - ⚠️ **언어 전환은 사전을 받은 뒤에 `lang` 을 바꾼다**(`setLang`). 먼저 바꾸면 사전이 오기 전 한 프레임이 한국어로 그려져 번쩍인다. 반대로 프로바이더를 언마운트시켜 기다리면 열려 있던 화면 상태가 통째로 날아간다.
    - ⚠️ 키 존재 여부는 `hasKey()` 로 묻는다(`regionCatalog` 가 "지도 이름 대신 사전 이름을 쓸지" 고를 때). `D` 를 직접 import 하던 경로는 없어졌다.
  - `/hub` 는 오래 한국어 하드코딩이었는데 2026-08-07 에 `hub.*` 132개로 일괄 이관했다. 그때 나온 함정 셋:
    - ⚠️ **문구를 정규식으로 검사해 분기하지 말 것.** 허브 토스트가 아이콘을 `/부족|필요|오류/.test(문구)` 로 골랐는데, 번역하는 순간 전부 한쪽으로 쏠린다. 지금은 `toast.bad` 플래그를 들고 다닌다.
    - ⚠️ **`t` 를 이펙트 의존성에 넣지 말 것.** 프로바이더가 `t` 를 렌더마다 새로 만들어서 deps 에 넣으면 이펙트가 매 렌더 돈다(선물 코드 자동조회가 그랬다). 실패 메시지를 **문구가 아니라 사전 키**로 state 에 담으면 이펙트가 `t` 를 안 쓰게 되고, 덤으로 언어를 바꿔도 메시지가 따라 바뀐다.
    - ⚠️ **문장을 쪼개서 인라인 `<b>` 를 끼우지 말 것** — 어순이 언어마다 달라 번역이 불가능해진다(선물 확인 문구에서 뺐다).
  - 파츠 이름은 `hub.part.<partKey>`, 활동 라벨은 `hub.earn.row.<kind>` 로 **키를 조립**한다. 상수 배열에 라벨을 같이 두면 표를 두 벌 관리하게 된다.
- **메인 검색 라우터 — 지도가 낡는 게 이 기능의 고질병이다(2026-08-25 점검)**: 검색어 → `route-query`(임베딩 앵커 → LLM 분류 → 키워드 폴백) → 페이지 이동. 규칙이 **네 곳**에 흩어져 있다: `route-query` 의 `DEST`·SYSTEM 프롬프트·responseSchema enum, `route-seed` 의 시드 문구, `Landing.tsx` 의 `VALID_DESTS`·`clientKeywordRoute`. **한쪽만 고치면 안 되고, 넷이 일치해도 안심할 수 없다.**
  - ⛔ **넷이 완벽히 동기화된 채로 다 같이 옛 사이트를 가리킬 수 있다.** 실제로 몇 주 동안 그랬다 — 일정이 `/guide` 에서 `/plan` 으로 분리됐는데 `schedule` 인텐트만 그대로라 "시험 언제야" 가 날짜 한 줄 없는 페이지로 갔고, 마이페이지 첫 탭이 이북 서재가 되면서 "내 점수" 가 서재로 갔고, 강의를 팔기 시작했는데 시드에 `강의` 가 한 글자도 없었다. 사람 눈으로는 못 잡는다(넷이 서로 일치하니까).
  - **그래서 `tests/route-map.mjs` 가 있다**(74건 · `test:db` 에 포함). 네 곳 동기화 + **⭐목적지가 `App.tsx` 에 실재하는 라우트인가** + `/mypage/<탭>` 목적지의 탭이 `MyPage` 의 `TABS` 에 있는가 + 대표 검색어 40여 개의 도착지 + 서버/클라 폴백 글자 일치를 본다. **페이지를 옮기거나 탭 key 를 바꾸면 여기서 걸린다** — 검색만 조용히 옛 주소로 보내던 그 상태를 막는 게 목적이다.
  - ⛔ **목적지를 함부로 늘리지 말 것.** 서로 비슷한 말이 목적지 둘로 갈리면 벡터가 못 가른다 — 그래서 레벨테스트 기록/인증서는 목적지로 안 만들었고(“내 점수”와 구분 불가), 의견함(`/feedback`)도 `/faq` 가 흡수한다.
  - ⛔ **재시드는 학습분(`source='llm'`)도 같이 비운다.** 예전엔 `source='seed'` 만 지워서, 문구를 고치고 재시드해도 예전에 학습된 질의가 **옛 페이지로 계속 갔다.** 학습분은 시드에서 다시 자라므로 버려도 잃는 게 없다.
  - ⚠️ `/feedback`(의견함)으로 가는 길은 FAB 하나뿐이다 — 검색은 `/faq` 로 보내는데 **그 화면에 의견함 링크가 없다.** 의견을 쓰러 온 사람은 아직 한 번에 못 닿는다.
  - 배포: `npx.cmd supabase functions deploy route-query` + `route-seed`(이건 `--no-verify-jwt`) → **재시드** `ROUTE_SEED_KEY=... node tools/reseed-routes.mjs`(762문구 × 600ms ≒ 8분) → 확인 `node tools/probe-routes.mjs`.
    - ⛔ **재시드를 안 하면 배포가 아무 효과가 없다.** 앵커가 먼저 답하고 LLM 을 안 부르기 때문이다 — 2026-08-26 실측: 함수를 올린 직후에도 `시험 언제야` 가 `{"dest":"/guide","hit":true}` 로 옛 답을 그대로 줬다.
    - ⚠️ **`ROUTE_SEED_KEY` 는 `.env.local` 에 적어 뒀다**(git 에 안 올라간다). 옛 값은 **아무도 몰랐다** — 어느 세션이 요청 없이 이 가드를 걸어놓고 값을 안 남겼고, Supabase 는 시크릿을 SHA-256 해시로만 보여줘서 되찾을 방법이 없다. 그래서 2026-08-26 에 한 번 갈아끼웠다(이 키를 읽는 곳은 `route-seed` 하나뿐이라 갈아도 깨지는 게 없다). **또 잃어버리면 또 갈아야 한다 — 값을 지우지 말 것.**
- **`/feedback` 의견함 — 파일 첨부(2026-08-26)**: 캡처만이 아니라 **PPT·PDF 로 정리해 보내는 사람**까지 받는다(지시). 한 건에 **3개 · 파일당 20MB**, 붙이는 순간 올라가고 제출에는 **경로만** 실어보낸다. 관리자는 의견함 모달의 `📎` 버튼으로 연다.
  - ⛔ **브라우저가 Storage 에 직접 올리지 않는다.** 그러려면 `storage.objects` 에 anon insert 정책이 필요한데, 의견함은 **비로그인 누구나** 쓰는 화면이라 그 순간 우리 스토리지가 **가드 없는 무제한 업로드 엔드포인트**가 된다. 대신 `feedback` 함수가 경로 하나짜리 **서명 업로드 URL**(`createSignedUploadUrl`)을 굽고 브라우저는 그 토큰으로만 올린다 — 서명 업로드는 RLS 를 안 보므로 **버킷 정책이 0개**여도 동작하고, 정책이 0개라 토큰 없이는 아무도 못 올린다. 읽기도 관리자 함수가 굽는 서명 URL 뿐이다(`feedbackFileUrl`, 10분).
  - ⛔ **발급도 세야 한다** — 발급 자체는 로그인 없이 부를 수 있다. `feedback_upload_claim` RPC 가 advisory lock 안에서 **10분 15건 · 하루 400MB** 를 본다(엣지 함수에서 세면 동시 요청에 샌다). 그 원장(`feedback_uploads`)이 하는 일 셋: 바닥선 · "그 경로가 정말 이 사람이 방금 올린 것인가" 확인 · **올려놓고 안 보낸 고아 목록**.
  - ⛔ **클라가 보낸 이름·크기를 믿지 않는다.** 제출은 경로만 받고 `feedback_post` 가 이름·크기를 원장에서 다시 읽는다 — 안 그러면 '3KB 캡처' 라고 적힌 200MB 파일이 관리자 목록에 뜬다. 남의 경로·없는 경로는 `ip_hash` 가 안 맞아 조용히 빠진다.
  - ⛔ **확장자 화이트리스트가 진짜 관문이다**(`ALLOWED_EXT`). content-type 은 클라가 정하는 값이라 못 믿어서 버킷 `allowed_mime_types` 를 일부러 비워 뒀다. ⚠️ **svg·html 을 넣지 말 것** — 스크립트를 품을 수 있어 관리자가 서명 URL 을 새 탭에서 열면 스토리지 오리진에서 실행된다.
  - ⛔ **스토리지 키는 ASCII 만 받는다 — 한글 파일명을 그대로 쓰면 업로드가 `InvalidKey` 400 이다**(2026-08-26 실기기 확인). Supabase Storage 의 키 검사가 `\w`(=`[A-Za-z0-9_]`) 기준이다. **서명 URL 발급은 멀쩡히 200 이고 올릴 때만 터져서** 안 겪어보면 못 찾는다. 그래서 `safeKeyName` 이 키를 ASCII 로 뭉갠다(`스모크 테스트.png` → `file.png`) — 사람에게 보여줄 원본 이름은 `feedback_uploads.name` 에 그대로 남고 앞의 uuid 폴더가 충돌을 막으므로 잃는 게 없다.
    - ⚠️ **확장자를 먼저 떼고 나서 뭉갠다.** 순서를 바꾸면 앞자리 정리(`^[._-]+`)가 확장자 앞의 점까지 먹어서 `스모크.png` 가 **`png` 라는 이름**이 된다(그렇게 나왔다).
  - ⚠️ **멱등 판정에 첨부까지 넣는다.** body 만 보면 "쓰고 나서 파일을 붙여 다시 보낸" 사람이 첨부 없는 옛 글의 id 를 돌려받아 파일이 통째로 사라진다. 반대로 첨부 목록을 '아직 안 묶인 것' 으로만 만들면 더블클릭의 두 번째 호출이 빈 배열이 되어 멱등이 깨진다 — 그래서 목록을 만들 땐 `feedback_id` 를 **안 본다**.
  - ⚠️ **붙이는 순간 올린다**(제출 때 몰아 올리지 않는다). 20MB PPT 를 제출 버튼 뒤에 숨기면 다 쓰고 나서 몇십 초를 기다리다 실패를 보고, 그 시점엔 뭘 고쳐야 하는지도 모른다. 대가는 고아 파일이고 그건 원장이 목록으로 들고 있다.
  - ⚠️ **상한 20MB·3개는 네 곳이 한 벌이다** — 화면(`Feedback.tsx`) · 서버(`functions/feedback`) · DB CHECK(`feedbacks_files_shape`·`feedback_uploads_size_chk`) · 버킷 `file_size_limit`. 화면이 더 헐거우면 통과한 줄 알았던 파일이 업로드에서만 이유 없이 실패한다.
  - ⚠️ **`feedback_post` 는 6인자 → 7인자로 갈아탔다**(옛 것을 `drop` 하고 새로 만든다). 기본값을 준 채 인자만 늘리면 두 벌이 남아 호출이 모호해져(`function is not unique`) 접수가 통째로 죽는다.
  - ⚠️ **고아 청소 크론은 아직 없다.** `feedback_id is null and created_at < now() - interval '1 day'` 가 그 목록이다.
  - **배포 완료(2026-08-26)** — 마이그레이션 `20260826120000` 적용 + `feedback-files` 버킷 생성(정책 0개 확인) + `feedback`·`admin` 배포(둘 다 `verify_jwt=true` 유지). ⛔ 버킷 만들기를 빼먹으면 업로드가 통째로 `Bucket not found` 다(`avatars` 가 그래서 몇 달 죽어 있었다). 되살릴 때 쓸 SQL 은 `supabase/storage-buckets.sql` 의 그 블록.
  - 검증: `tests/db/t-feedback.mjs`(55건 — ⭐남의 경로 차단·⭐이름·크기는 원장 값·⭐더블클릭에도 첨부 보존·⭐파일만 붙여 재전송하면 새 글·발급 바닥선) + **프로덕션 실경로 스모크**(비로그인 anon 으로 발급 → Storage 직접 업로드 200 → 접수 → 첨부 저장 확인 → `.exe` 400 거절 확인, 흔적은 지움).
- **방문 통계 (2026-08-31 · `20260831130000`)** — 관리자 **홈 대시보드**(좌상단 이름 클릭) 안의 '방문 통계' 섹션. 일별 방문자·조회수 추이 + 국가별·지역별·기기·브라우저·OS·많이 본 화면. 라우트가 바뀔 때마다 `App.tsx` 의 `<VisitTracker/>` 가 `track-visit` 를 부르고, 집계는 `visit_stats` RPC 한 방이 한다(`admin` 의 `visitStats` 액션).
  - ⛔ **IP 를 저장하지도, IP 로 국가를 정하지도 않는다.** 국가는 **브라우저가 제3자(ipwho.is)에게 직접 물어본** 두 글자를 실어 보낸 것이고, 서버는 그걸 그대로 받는다 — `src/lib/geo.ts` 의 2026-08-24 결정을 그대로 따른 것이다. **엣지 함수에서 `cf-ipcountry`·`x-forwarded-for` 를 읽는 쪽으로 바꾸지 말 것**(그 순간 "우리가 위치정보를 수집한다"로 성격이 바뀐다). 대가는 광고차단기에 막힌 방문이 **'미상'** 으로 남는 것이고, 화면이 그 사실을 밝힌다.
  - ⛔ **User-Agent 원문을 저장하지 않는다.** `track-visit` 가 기기(모바일/태블릿/PC)·브라우저·OS 세 값으로 접어서 넣는다. ⚠️ 브라우저 판정은 **순서가 곧 규칙**이다 — 엣지·삼성·웨일·오페라는 UA 에 `chrome` 을, 크롬은 `safari` 를 달고 다녀서 넓은 것부터 보면 전부 한쪽으로 뭉친다.
  - ⛔ **지역(시도)은 이벤트에 안 담는다** — 조회할 때 `user_id → profiles.region_code` 를 조인한다. 담으면 ① 알아낸 적 없는 위치가 이벤트에 박히고 ② 사용자가 지역을 정정해도 옛 기록이 안 따라온다. 그래서 **국가와 지역은 모수가 다르다**(국가=전체 방문자, 지역=지역을 설정한 로그인 회원). 합계가 안 맞는 게 정상이고, 화면은 **제목에 괄호로**(`지역별 (회원)`) 그걸 밝힌다. ⛔ 안내 문장을 다시 달지 말 것(2026-08-31 지시 — 매번 읽어야 하는 소음이 된다). 밝힐 게 생기면 제목에 붙인다.
  - ⛔ **행이 무한히 늘지 않는 게 설계다.** PK 가 `(day, visitor_id, path)` 라 같은 사람이 같은 날 같은 화면을 100번 봐도 행은 하나고 `views` 만 오른다. 페이지뷰마다 행을 쌓는 쪽으로 되돌리지 말 것 — 이 표는 **비로그인도 쓸 수 있는 쓰기 경로**(anon 키)라 행 수에 바닥이 있어야 한다. 화면 주소의 아이디 자리(`/test/result/<uuid>`)를 `:id` 로 접는 것도 같은 이유다(쿼리스트링은 통째로 버린다 — `?next=`·`?ref=` 에 남의 주소가 섞인다).
  - ⚠️ `visit_track` 의 `user_id`·`country` 는 **`coalesce(새 값, 기존 값)`** 이다. 그냥 덮으면 방문 도중 로그인한 사람의 uid 를 그 다음 익명 요청이 다시 null 로 지운다.
  - ⚠️ '방문자'는 사람이 아니라 **브라우저**다(localStorage 난수). 폰·PC 로 오면 둘로 세고, 기록을 지우면 새 사람이 된다.
  - ⚠️ 기간(7/30/90)을 바꾸면 **다시 불러온다**. 막대만 클라에서 자르면 추이는 7일인데 국가표는 90일인 화면이 된다.
  - 안 세는 것: 관리자 경로(`/admin*`) · 개발 서버(localhost) · 봇 UA. 보존기간 크론은 없다(정리는 마이그레이션 머리 주석의 `delete … where day < current_date - 400`).
  - 배포: 마이그레이션 적용 + `npx.cmd supabase functions deploy track-visit admin` (**둘 다 플래그 없이** — anon 키가 실려 오므로 공개 예외가 필요 없다). 프론트는 `master` push. 검증 = `tests/db/t-visit-stats.mjs`(27건).
- **레벨 추천**: 검색어 → `recommend-level` 함수 → Gemini 임베딩 코사인 → 레벨. 앵커 문구가 품질 좌우. 레벨 7개라 pgvector 불필요(메모리 비교). → `docs/온보딩.html` §12
- **허브 캐릭터 업로드 (2026-08-31 · `20260831140000`)** — 관리자 › WORLD ARENA › 꾸미기 관리 › **캐릭터 업로드**. 캐릭터를 늘리는 데 **배포가 필요 없다**(2026-08-20 의 "그림은 코드, 가격은 DB" 선을 캐릭터에서만 옮긴 것 — 캐릭터가 가진 수치는 비율 하나뿐이라 그림에서 재면 되기 때문이다. 스킨은 9패치 값 15줄이 그림과 같이 와야 해서 여전히 배포다).
  - ⛔ **시트를 자르는 건 여전히 `tools/build-char-art.mjs` 다.** 올리는 건 **완제품 lv1~7** 이다. 흰 배경 빼기·Lv.7 후광 역산은 판단이 섞인 일이고(배경 뺀 시트를 사람이 따로 넣는다) Deno 엣지에는 그 이미지 처리기가 아예 없다.
  - ⛔ **코드의 파일 경로(`/hub/char/<키>/lv<n>.webp`)를 지우지 말 것.** 지금 그림이 있는 두 캐릭터(`char_a_m`·`char_a_f`)는 `hub_char_art` 에 행이 없어서 계속 그쪽에서 그려진다. 표를 단일 출처로 만들면 그 둘을 누군가 다시 올리기 전까지 허브가 폴백 한 장으로 뜬다.
  - ⛔ **저장은 `hub_char_art` + `shop_catalog` 두 행을 같이 쓴다.** 상점 행이 없으면 화면에 **영영 안 나온다** — 허브의 첫 선택 후보도 상점 목록도 `get-hub` 가 `shop_catalog`(active)에서 만든다.
  - ⛔ **브라우저가 버킷에 직접 올리지 않는다.** `admin` 이 구운 **서명 업로드 URL** 로만 올린다(`hub-char` 버킷 정책 0개 = 토큰 없이는 아무도 못 올린다). 스토리지 정책으로 관리자를 가리려면 정책 안에서 `admin_users` 를 뒤져야 해서 게이트가 두 벌이 된다.
  - ⚠️ **파일 이름에 타임스탬프를 박는다.** 같은 경로에 덮어쓰면 공개 URL 이 그대로라 CDN·브라우저가 옛 그림을 계속 준다 — "올렸는데 화면이 안 바뀐다". 대가는 안 쓰는 옛 파일이 버킷에 남는 것(청소 크론 없음).
  - ⚠️ **비율은 브라우저가 잰다**(올린 그림의 가로/세로). 엣지에 디코더가 없다. 7장이 같은 캔버스라 아무 장이나 같은 값이다.
  - ⛔ **키는 화면에 없다 — 서버가 정한다**(`nextCharKey` → `char_001`…). 관리자에게 `char_003` 은 아무 뜻도 없는 글자다. 이름으로 만들 수도 없다: 키가 그대로 스토리지 경로가 되는데 **Storage 는 ASCII 만 받아서** 한글 이름을 쓰면 서명 URL 은 200 이고 **올릴 때만** InvalidKey 400 이 난다(의견함 첨부에서 겪은 그 함정). 새 캐릭터는 **첫 업로드 때** 서버가 키를 만들어 돌려주고 화면이 그걸 숨겨 들고 있는다 — 안 붙잡으면 7장이 각각 다른 키로 흩어진다.
  - ⚠️ 이름은 `hub_char_art.name_ko`(원본) + `name_i18n`(번역본만, ko 제외). 사전(`hub.part.<키>`)은 배포물이라 못 늘리므로 **업로드된 캐릭터만** DB 이름이 이긴다(`charArtName`).
  - ⚠️ **미리보기는 기본 스킨(초원) 하나로 고정**한다. 썸네일만 봐서는 크기를 못 읽는다(레벨마다 캔버스 안 크기가 다르고 Lv.7 이 크다) — 배경 위에 올려야 판단이 된다. 스킨마다 발끝 높이가 달라 여러 개를 보여주면 "어느 게 맞냐"가 된다.
  - ⚠️ **보유·착용 목록(`cosmeticOwners`)은 착용을 두 자리에서 모은다** — 캐릭터는 `user_characters.base_key`, 파츠는 같은 행의 `equipped` 안. 한쪽만 보면 "보유 12명 / 착용 0명" 같은 거짓말이 나온다. **산 기록 없이 입고 있는 사람**도 세운다(첫 캐릭터는 공짜라 `user_cosmetics` 에 안 남는다) — 빼면 "착용 30명인데 목록엔 2명"이 된다.
  - ⚠️ 조회는 `charArtSrc` 가 렌더 중에 불리는 **동기 함수**라(공유 카드처럼 훅을 못 쓰는 자리도 부른다) 모듈이 한 번 받아 들고 있고, 도착하면 `<CharArt>` 가 구독으로 다시 그린다. 안 알리면 이미 그려진 화면이 폴백인 채로 남는다.
  - 배포: 마이그레이션 + **`supabase/storage-buckets.sql` 의 `hub-char` 블록 실행**(⛔ 버킷을 안 만들면 업로드가 통째로 `Bucket not found` — `avatars` 가 그래서 몇 달 죽어 있었다) + `npx.cmd supabase functions deploy admin` + 프론트 push.
- **캐릭터(아바타)**: `profiles.avatar_url` 한 컬럼에 `gem:#hex`(젬 색) 또는 `img:<public-url>`(업로드 이미지) 저장. 그 외 값/NULL(구글 가입 URL 등)은 무시하고 시드 젬으로 표시. 해석·팔레트·업로드는 `src/lib/avatar.ts`(`parseAvatar`/`uploadAvatar`), 렌더는 `<Avatar>`(`GemAvatar.tsx`).
  - ⚠️ **아바타를 %크기 소켓에 넣을 땐 `aspect-ratio: 1 !important` 를 반드시 같이 걸 것 — 안 그러면 달걀이 된다.** `<Avatar>` 는 인라인 style 로 px 크기 + `border-radius:50%` 를 박기 때문에, `width/height:100%` 만 덮어쓰면 퍼센트 높이가 auto 로 떨어지는 순간 박스가 세로로 눌려 **원이 타원**이 된다. 반복해서 재발한 버그다(시상대 → 티어바). `ranking.css` 의 '아바타 달걀 방지' 블록에 소켓 선택자를 **모아서** 관리한다 — 소켓을 새로 만들면 그 블록에 선택자만 추가하고, 소켓마다 규칙을 따로 쓰지 말 것. 업로드는 Supabase Storage **공개 버킷 `avatars`**(경로 `<uid>/...`, RLS=본인 폴더만). 리더보드도 이미지/색을 반환하므로 변경 시 `leaderboard` 함수 재배포 필요.
    - ⛔ **그 버킷은 2026-08-25 까지 실제로 없었다 — 아바타 업로드가 통째로 실패하고 있었다**(`Bucket not found`). 코드는 처음부터 `avatars` 를 부르는데 만드는 단계만 아무도 안 밟은 것이다. 지금은 만들었고, 버킷·정책 SQL 은 **`supabase/storage-buckets.sql`** 에 모아 뒀다(마이그레이션이 아니다 — `storage` 스키마는 pglite 에 없어서 섞으면 `test:db` 가 죽는다).
    - ⚠️ **Supabase Storage 는 버킷이 없을 때와 권한이 없을 때 똑같이 `Bucket not found` 를 준다**(존재 여부를 숨긴다). 그 메시지를 정책 문제로 넘겨짚지 말고 `select id from storage.buckets` 로 있는지부터 볼 것.
- **뒤로/홈 칩은 앱 전체에서 한 규칙이다(2026-08-20 통일)** — `shared.css` 의 공용 규칙 하나가 `.topbar`·`.gd-back`·`.pl-back`·`.hub-back`·`.mgp-back`·`.dy-back`·`.ebr-back` 을 다 그린다. 기준은 `/guide` 의 칩(얇은 1px 테두리 + 한 단 밝은 면 + 보조색 글자 + 부드러운 그림자)이고, 화살표도 전부 Material `arrow_back` 이다.
  - 예전엔 화면마다 따로 그려서 **일곱 가지**가 돌아다녔다 — 원형 화살표 칩(`.topbar`), 두꺼운 카툰 테두리 셋(`.hub-back`·`.dy-back`·`.mgp-back`), 인라인 스타일(`.ebr-back`), 아레나 전용(`.aa-home`), Tailwind 인라인 넉 벌. 같은 자리의 같은 버튼이 페이지마다 달라 보였다.
  - ⚠️ **색은 전용 토큰 `--backchip-*` 으로 박는다. 전역 `--line`·`--ink`·`--blue` 를 쓰면 안 된다** — `.hub` 가 `--line` 을 검정(`#33323f`)으로 덮어써서 그 화면에서만 칩이 두꺼운 검정 테두리로 뒤집힌다. `/guide` 가 `--g-*` 를 따로 둔 것과 같은 이유다.
  - ⚠️ `.ebr-back`(이북 뷰어)만 밝은 값을 자기 안에 고정한다 — 그 머리말은 **테마와 무관하게 항상 흰 띠**라서, 안 고정하면 다크에서 흰 띠 위에 검은 칩이 얹힌다.
  - ⚠️ **새 화면에 또 그리지 말 것** — `<TopBar/>` 를 쓰거나 그 규칙의 선택자에 이름만 추가한다. `/exam/check` 아래쪽 '시험 안내로' 버튼은 제외했다(왼쪽 위 칩이 아니라 화면 하단 가운데 큰 CTA 라 역할이 다르다).
- **테마(다크/라이트)**: `html.dark` 클래스 하나로 토큰을 뒤집는다(`stitch.css` 의 `html.dark` 블록이 `--color-*`·`--bg`·`--ink` 등 단일 출처). **기본값 = 다크**(2026-08-04) — `index.html` 이 `<html class="dark">` 를 박고 인라인 스크립트가 `localStorage.theme === 'light'` 일 때만 벗긴다(FAB 패널의 해/달 토글이 저장). 페이지 단위 고정은 `.force-dark`(랜딩 — 배경이 항상 우주) / `.force-light`(`/exam/run` 응시화면 · 로그인 카드) 두 개뿐이고 테마 무관하게 유지된다.
  - ⚠️ **떠 있는 두 버튼(`.fab`·`.fab-top`)의 면은 테마와 무관하게 항상 흰색**이다(`fab.css` 의 `--fab-face`/`--fab-face-line`/`--fab-face-ink`). 다크에서 `--bg` 를 쓰면 어두운 배경 위 어두운 원이라 안 보인다. **이 두 버튼 안에서 `--ink`·`--line2` 를 쓰면 안 된다**(다크에선 밝은 값이라 흰 면에서 증발). 열리는 패널(`.panel`)은 해당 없음 — 계속 테마를 따른다.
- **등급 연출**: 결과창은 원점수 판정으로 **승급 배너+애니**(강등이 없으니 하락 배너도 없다), 레벨별 누적 레이더(고스트=현재−deltas) 표시(`Result.tsx`). 대시보드는 레벨별 레이더를 ‹ ›로 전환.
- **칭호(자격증)에는 급수가 없다 (2026-08-07 정정)**: `user_titles` RPC 가 옛 모델(정답률로 `1급~4급`, 트랙 `Pro`/`Master` 둘)을 계속 계산하고 있어서 화면에 **제도상 없는 'CARIS Pro 1급'** 이 찍혔다. 2026-07 개편으로 티어 6개가 **각각 독립 시험(합격 60%)** 이 됐으므로 칭호 = **합격한 티어 그 자체**다(`20260807130000`). RPC 반환이 `[{track,grade}]` → `[{tier, exam_title}]`(`exam_tiers.sort` 내림차순)로 바뀌었고 소비처는 `leaderboard`(me.title)·`Hub.tsx`(배지·칭호 모달) 둘뿐이다.
  - 표시 이름은 SQL 이 만들지 않고 **티어 key 만** 내려준다 — 이름의 단일 출처는 프론트 `src/lib/caris.ts` 의 `tierName()`, 서버 `_shared/exam-tickets.ts` 의 `TIER_LABEL` 이다. SQL 에 CASE 로 한 벌 더 두면 동기화 페어가 늘어난다.
- **`/daily`·`/games` i18n (2026-08-07)**: 화면 문구는 `daily.*`·`mg.*` 로 이관했다. 미니게임 제목·소개·뱃지는 `lib/minigames.ts` 에서 빼고 **`mg.<id>.title|tagline|badge` 키 조립**으로 바꿨다(데이터에 한국어를 두면 언어를 바꿔도 커버만 한국어로 남는다).
  - **게임 안 문구도 번역된다 (2026-08-07)**: 게임은 자립형 HTML(iframe)이라 앱 사전을 못 쓴다 → 부모가 `iframe src` 에 `?lang=` 을 붙이고, **공용 사전 `public/games/i18n.js`** 가 그걸 읽어 갈아끼운다. HTML 은 `data-i18n="키"`(원문은 그대로 두어 사전이 없어도 한국어로는 보인다), JS 생성 문구는 `MGI18N.t('키', {n})`. 문서 끝에서 `MGI18N.apply()` 한 번.
    - 사전을 게임마다 두지 않는 이유 = 6벌이 되고 `랭킹` 같은 **앱 브리지 공통 문구**가 파일마다 갈린다(실제로 6벌 복제돼 있었다).
    - ⚠️ **캔버스에 그리는 글자는 없다** — 전부 DOM 이라 이 방식으로 다 덮인다. 새 게임을 만들 때도 문구를 캔버스에 그리지 말 것.
    - 적용 완료 = 용어 퀴즈 3종(`beat-cari`·`shoot-cari`·`pick-cari`). **퍼즐 3종(`reach-cari`·`program-cari`·`build-cari`)은 아직 한국어**(레벨별 학습 설명문이 많아 분량이 큼).
  - ⚠️ **문항 자체는 아직 한국어다.** 콘텐츠가 `src/lib/terms.ts` 와 `public/games/*.html` 의 `POOL` **두 벌로 복제**되어 있어서(파일 머리 주석이 "양쪽 같이 갱신" 이라고 적어둔 그 구조), 번역을 얹으면 12벌이 된다. 레벨테스트(`questions` 다국어 JSONB + `translate-questions`)처럼 **콘텐츠를 한 곳으로 모으는 게 선행**이고, 게임에는 `MGBridge` 에 문항 주입 메시지를 하나 더 두면 된다(미결).
- **공유 카드도 화면 언어를 따른다 (2026-08-07)**: 캔버스에 그리는 글자까지 `share.card.*`. 훅을 못 쓰는 계층이라 `ShareCardData.lang` 을 받아 `tr()` 로 뽑는다 — 호출부(`Hub`·`Ranking`·`ChatBoard`) 셋 다 `lang` 을 넘겨야 한다.
- **티어 엠블렘**: 티어는 백분위 파생 **5단계**(브론즈~다이아, `tierForPercentile`). 엠블렘은 이미지 단일 체계 — 화면은 `<TierBadge>`가 `public/emblems/<tier>.webp`(256px), 공유 카드는 같은 그림의 `<tier>.png`(512px, 캔버스용). 마이페이지 히어로 옆 **티어 사다리**(`TIER_ORDER`, 내 티어만 원색)도 이걸 쓴다. ⚠️ 옛 레벨 엠블렘(iron~master 7단계 SVG `TierEmblem`·`emblemKeyForLevel`)은 삭제됐다.

## 결제 (엑심베이 단일 PG · 2026-08-13)

**상세 → [`docs/notes/결제-응시권.md`](./docs/notes/결제-응시권.md)** (묶음·곁다리 결제, 응시권, SEB 인계, 응시 중단, 자격증 발급비). 결제를 건드리기 전에 반드시 읽을 것.

넘기면 안 되는 네 줄만 여기 남긴다:

- **PG 는 엑심베이 하나.** 정가는 **달러 한 벌**(센트 정수)이고 청구 통화는 **사용자 국가**가 정한다(한국=원화·국내 MID, 그 외=달러·해외 MID).
- ⛔ **금액을 요청으로 받지 않는다.** `create` 는 상품 ID만 받고 `_shared/payments.ts` 의 `resolveProduct` 가 DB 에서 다시 뽑는다. 승인 API 에도 **저장된 값**을 넘긴다.
- ⛔ **중복 지급은 코드가 아니라 DB 가 막는다** — `payments` 의 부분 유니크 `(user_id, product_type, product_ref) where status='paid'`.
- ⛔ **지급 먼저, `fulfilled_at` 나중.** 반대로 하면 지급 실패 시 "이미 줬다"는 기록만 남아 미지급을 영영 못 찾는다. `status='paid' AND fulfilled_at IS NULL` 이 대사(reconcile)가 보는 신호다.
- ⚠️ `verify_jwt=false` 로 배포하는 결제 함수는 **`payments-webhook`·`payments-return` 둘뿐**이다. 나머지엔 `--no-verify-jwt` 금지.


---

## 운영에서 자주 막히는 것 (반드시 숙지)

- **프론트는 `master` push → Cloudflare 자동배포**(빌드 수 분 소요). 함수는 **별도 CLI 배포** 필요. git push 로 함수 안 올라감. SPA 라우팅은 `wrangler.jsonc`(`not_found_handling`)로 처리 — `_redirects` 금지(무한루프).
- ⛔ **`package.json` 의 의존성을 건드리면 `bun install` 로 `bun.lock` 을 같이 커밋할 것.** Cloudflare 는 `bun install --frozen-lockfile` 로 설치해서 둘이 어긋나면 **빌드가 시작도 못 하고 죽는다**(`error: lockfile had changes, but lockfile is frozen`). 우리 로컬은 `npm` 을 쓰므로 `package-lock.json` 만 갱신되고 `bun.lock` 은 그대로 남는 게 기본값이다 — 그래서 **두 번 겪었다**(playwright 추가 `1530743`, 토스 SDK 제거 `48bfe88`). 화면이 안 바뀌는 이유를 코드에서 찾기 전에 Cloudflare 빌드 로그부터 볼 것.
- `_shared` import 하는 함수는 **CLI 로만** 안전 배포(대시보드 웹에디터는 `../_shared` 깨질 수 있음). `recommend-level` 만 단일 파일이라 대시보드 가능.
- **결제 함수 배포**: `npx.cmd supabase functions deploy payments` (플래그 없이) + `npx.cmd supabase functions deploy payments-webhook --no-verify-jwt` (**이 함수만** 예외). 엑심베이 `status_url` 은 서버가 `/ready` 에 실어 보내므로 대시보드 설정이 필요 없다 — 값은 `https://<ref>.supabase.co/functions/v1/payments-webhook?k=<PAYMENTS_WEBHOOK_SECRET>`.
- **SEB 인계 함수 배포**: `npx.cmd supabase functions deploy seb-handoff` (플래그 없이 — `verify_jwt` 켠 채로 맞다). SEB 안에서도 anon 키가 실려 오므로 공개 예외가 필요 없다. `--no-verify-jwt` 로 올리지 말 것.
- **채팅 번역 배포**: `npx.cmd supabase functions deploy chat-translate` (플래그 없이). **워커도 anon 키를 실어 보내므로 공개 예외가 필요 없다** — 워커 권한은 함수 안의 `x-translate-worker-key` 가 판정한다(서비스 롤 키를 워커에 두지 않는다). 시크릿은 `TRANSLATE_WORKER_KEY` 하나. ⚠️ 옛 `chat-edit`·`chat-delete` 는 삭제됐으니 대시보드에 남아 있으면 지울 것(코드가 없어도 옛 배포본은 계속 뜬다).
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

## 만들기 전에 방향부터 — `brief` 스킬 (`.claude/skills/brief/`)

작업 지시가 모호할 때 **코드를 먼저 읽고**, `읽음 / 모름` 두 줄로 보고한 뒤, 모름을 클릭 답변형 선택지로 만들어 한 번만 묻는다. 오타·문구 하나, 파일과 자리를 이미 지정한 수정, 이어지는 작업, 사용자의 질문에는 발동하지 않는다.
⛔ **질문 없이 파일을 고치기 시작하면 위반이다** — 첫 툴 호출만 보고 끊을 수 있어야 한다.

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
| [`docs/hub-skin-mock.html`](./docs/hub-skin-mock.html) | **허브 배경·캐릭터 자리 맞추기 시안** — 슬라이더로 맞춘 뒤 값을 `hub.css` 로 옮긴다(브라우저로 열 것) |
| [`docs/review-report.html`](./docs/review-report.html) | 코드 리뷰 리포트(생성물) |
| [`docs/notes/`](./docs/notes/) | **화면·기능별 상세 노트 5벌** — 라우트 표에서 갈라져 나온 것. 그 화면을 건드리기 전에 읽는다 |

> 새 기능/운영 사항을 추가하면 해당 문서를 갱신하고, 큰 변화는 이 표에 매핑한다.
