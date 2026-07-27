# CLAUDE.md

이 파일은 Claude Code(및 개발자)가 이 저장소에서 작업할 때 보는 **중심 가이드 + 문서 맵**이다.
세부 내용은 각 문서로 연결한다. 변경 시 관련 문서도 같이 갱신할 것.

> **⚠️ 통합됨 (2026-07):** 이 저장소는 이제 **CARIS CBT 자격검정(메인) + 무료 CARIS ARENA(`/test/*` 모듈)** 가 한 앱이다.
> 아래 "프로젝트 한눈에"는 CARIS ARENA 시절 옛 설명이라 전면 갱신 예정 — 현재 구조는 **[통합 전략](docs/통합전략.md)** · **[배포 안내](docs/통합-배포-안내.md)** 를 먼저 볼 것.
> 요점: 라우트 `/`(CBT 홈)·`/exam/*`(CARIS)·`/test/*`+`/ranking`(CARIS ARENA). CARIS ARENA 테이블은 충돌 회피로 `test_*` 리네임(`test_questions`·`test_answers` 등), 함수는 `start-test`·`submit-test`·`get-result`·`list-attempts`·`recommend-level`·`leaderboard`·`submit-report`·`admin-test`. 스코어링 sync 페어 = **`src/lib/scoring.ts` ↔ `supabase/functions/_shared/scoring.ts`**. CARIS ARENA 전용 프론트 파일은 `testTypes.ts`·`testConfigLevel.ts`·`useAntiCheatLevel.ts`(CBT 동명 파일과 분리).

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

## 프로젝트 한눈에

**GARA · AI 활용능력 CARIS ARENA** — "당신의 AI 활용능력은 어느 정도인가요?"
20문항으로 **레벨별 6개 영역**을 측정하고 **레벨 사다리(1~7, 원점수로 승급/유지/강등)** 로 등급을 부여하는 웹 서비스. 등급+그 레벨 진행도를 **랭킹 점수(0~10000)** 로 환산해 리더보드를 매긴다. 문항은 **6개국어 다국어**(화면 언어로 응시).

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
| `/guide` (급수·응시안내) | `pages/Guide.tsx` | `guide.css` ⚠️급수 색 양쪽 동기화 | — |
| `/notice` · `/notice/:id` | `Notice.tsx` · `NoticeDetail.tsx` | `shared.css` | `admin`(운영 CRUD) |
| `/faq` | `pages/Faq.tsx` | `shared.css` | `admin` |
| `/about` · `/privacy` · `/terms` | `About/Privacy/Terms.tsx` | `policy.css` | — |
| `/login` · `/auth/callback` | `Login.tsx` · `AuthCallback.tsx` | — | (Supabase Auth) |
| `/onboarding` (국가·지역·학교) | `pages/Onboarding.tsx` | `shared.css` | `set-region` |
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
| `/hub` (실동작 로비) | `pages/Hub.tsx` | `hub.css`(직접 import) | `get-hub` · `complete-daily` · `gacha-draw` · `gacha-exchange` · `shop-buy` |
| `/games/:gameId` | `pages/MiniGame.tsx` (목록=`lib/minigames.ts`) | `hub.css` | — |
| `/daily` (오늘의 학습) | `pages/Daily.tsx` — 루트 클래스 `.dy-page` | `daily.css`(직접 import) | `get-hub` · `complete-daily` |
| **WORLD ARENA (무료 레벨테스트 `/test/*`)** ||||
| `/arena` (지도+지역랭킹) | `pages/WorldArena.tsx` + `components/ArenaMap.tsx` · `lib/arena/*` | `arena.css` | `leaderboard` |
| `/test/select` (레벨 선택) | `pages/LevelSelect.tsx` | `levelselect.css` | `recommend-level` |
| `/test/:attemptId` (응시) | `pages/TestRunner.tsx` | `test.css` | `start-test` · `submit-test` |
| `/test/result/:attemptId` | `pages/Result.tsx` | `result.css` | `get-result` · `submit-report` |
| `/ranking` (리더보드) | `pages/Ranking.tsx` | `ranking.css` | `leaderboard` |
| **관리자** ||||
| `/admin` (탭 = `?top=`·`?tab=`) | `pages/Admin.tsx` (top=caris) · `pages/AdminLevelTest.tsx` (top=level) | `admin.css` | `admin` · `admin-test` |

- `/mypage` 탭(URL `/mypage/:section`) 순서 = `learning`(학습 대시보드, **기본 = `/mypage`**) · `ebooks`(이북 서재) · `attempts`(시험 응시 현황) · `earned` · `issuance`. ⚠️ 응시 현황은 예전 기본 탭이라 `/mypage` 였는데 지금은 `/mypage/attempts`.
- **이북(전자책)**: 관리자가 HTML 1개 파일을 업로드(비공개 버킷 `ebooks`, 표지는 공개 버킷 `ebook-covers`) → 회원이 `/ebooks` 에서 구매 → 마이페이지 '이북 서재' 탭에서 열람(`/ebooks/read/:id` 뷰어가 서명 URL iframe). 테이블 `ebooks`·`ebook_purchases`, 함수 `ebooks`(store·library·buy·read) + `admin`(ebookList/Upsert/Delete/Buyers). ⚠️ **결제(PG) 미연동 — 구매 = 즉시 지급(데모)**. 결제 검증 자리는 `ebooks` 함수의 `buy` 액션.
- `/admin` 서브탭(URL `?tab=`): `dash`(기본, 파라미터 없음) · `subs`(제출답안) · `grading`(채점) · `users` · `questions`(문항) · `notices` · `faq` · `rounds`(회차) · `ebooks`(이북) · `admins`. **`Admin.tsx` 3.7k줄 / `AdminLevelTest.tsx` 2.3k줄** — 전체 읽지 말고 서브탭 컴포넌트만 찾아 들어갈 것.
- 온보딩 게이트(`App.tsx`의 `OnboardingGate`): 정식 회원이 지역 미확정이면 `/test/*` · `/ranking` · `/mypage` 접근 시 `/onboarding` 으로 강제. 그 외 라우트는 통과.
- **진입점 배치(2026-07 정리)**: 미니게임은 `/arena` 하단 런처 4번째 버튼(`components/MiniGamePicker.tsx` 팝업) → `/games/:id`. 랭킹은 `/hub` 도크 CTA → `/ranking`. 레벨선택·허브에는 각각 미니게임·랭킹 진입점이 없다(중복 제거).
- **`/arena` 는 더 이상 iframe 이 아니다**: 옛 `public/world-arena.html`(자립형 d3 HTML)을 React 로 포팅하고 삭제했다. 지도 경계는 `public/geo/*.json`(world·kr-prov 즉시, kr-muni 는 시도 진입 시 지연 로드), d3 는 npm 서브모듈(`d3-geo`·`d3-zoom` 등). 문구는 `i18n.tsx` 의 `arena.*`.
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
  functions/   31개 — CBT(start-exam·submit-exam·get-exam-result·verify-cert) · 이북(ebooks) · 레벨테스트(start-test·submit-test·get-result·list-attempts·leaderboard·recommend-level)
               · 허브(get-hub·complete-daily·gacha-draw·gacha-exchange·shop-buy) · 검색라우터(route-query·route-seed)
               · 지식베이스(kb-*·lecture-qa) · 운영(admin·admin-test·my-attempts·mypage-ai·set-region·translate-questions)
  functions/_shared/  cors.ts · lib.ts (스코어링·인증·쿨다운 공용)
```

**DB 테이블**(요약): `profiles`, `questions`(다국어 JSONB·정답 클라 비노출), `test_attempts`(응시 언어·등급변동 스냅샷), `attempt_answers`, `user_level_skill`(레벨별 누적 6축 레이팅), `user_progress`(현재 등급=레벨).

## 핵심 규칙 / 컨벤션

- **보안 모델**: `questions.correct_index`·`test_attempts`·`attempt_answers`·`user_level_skill`·`user_progress` 는 **클라 직접 SELECT 금지**(RLS 미부여 = service role 전용). 출제·채점·결과 서빙은 **Edge Function 에서만**. 익명 유저 응답에선 총점 외 데이터를 서버가 제외. 정답은 언어 무관 단일 컬럼(`correct_index`)이라 번역과 무관.
- **스코어링 단일 출처**: 프론트 `src/lib/scoring.ts` 와 함수 `supabase/functions/_shared/lib.ts` 가 **동일 수식**을 유지해야 한다(둘 다 고칠 것). 만점=100 정규화·EWMA 누적은 `scoring.ts` 참고. ⚠️ 레벨별 6축 코드(`categories.ts` ↔ `_shared/lib.ts` 의 `LEVEL_AXES`)도 양쪽 동기화 필수.
- **등급 변동 규칙**: 승급컷 = **Lv.1~3은 16개, Lv.4~7은 18개**(`promoteCut`). 강등 = **4개 이하(5개 미만)를 연속 3번이면 한 단계 강등, 앞 2번은 경고**(`computeRankChange`, 경고 카운터 = `user_progress.demotion_strikes`, 5개 이상/레벨변동 시 리셋, Lv.1 강등 없음). 경고는 결과창+대시보드에 표시(`warn_strikes`). **랭킹 점수**(`computePoints`, 0~10000) = `((등급-1) + 그 등급 최신 맞힌수/승급컷) / 7 × 10000` → `user_progress.points` 에 매 응시 저장, `leaderboard_v2` RPC가 이걸로 정렬(동점=먼저 도달). 규칙/컷 바꾸면 양쪽 `scoring.ts`·`_shared/lib.ts` + 레벨선택 규칙박스 문구(`lv.rule_*`)가 같이 갱신됨.
- **i18n**: 라이브러리 없이 `src/lib/i18n.tsx` 의 `D` 사전. 6개국어(ko·en·ja·zh·hi·vi). 문구 추가 시 6개 다 채울 것. `{var}` 보간.
- **레벨 추천**: 검색어 → `recommend-level` 함수 → Gemini 임베딩 코사인 → 레벨. 앵커 문구가 품질 좌우. 레벨 7개라 pgvector 불필요(메모리 비교). → `docs/온보딩.html` §12
- **캐릭터(아바타)**: `profiles.avatar_url` 한 컬럼에 `gem:#hex`(젬 색) 또는 `img:<public-url>`(업로드 이미지) 저장. 그 외 값/NULL(구글 가입 URL 등)은 무시하고 시드 젬으로 표시. 해석·팔레트·업로드는 `src/lib/avatar.ts`(`parseAvatar`/`uploadAvatar`), 렌더는 `<Avatar>`(`GemAvatar.tsx`). 업로드는 Supabase Storage **공개 버킷 `avatars`**(경로 `<uid>/...`, RLS=본인 폴더만 — 버킷·정책은 대시보드 SQL로 생성). 리더보드도 이미지/색을 반환하므로 변경 시 `leaderboard` 함수 재배포 필요.
- **등급 연출**: 결과창은 원점수 판정으로 **승급/강등 배너+애니**, 레벨별 누적 레이더(고스트=현재−deltas) 표시(`Result.tsx`). 대시보드는 레벨별 레이더를 ‹ ›로 전환.
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
