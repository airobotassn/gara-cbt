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

### 작업 끝나면 이 틀로 보고한다 (10줄 이내)

작업이 끝났을 때 내 맘대로 읊지 않는다. **아래 세 칸을 채우고 끝낸다.**
안 채워도 되는 칸은 없고, 칸 밖의 말은 붙이지 않는다.

```
■ 뭐가 달라졌나
  · <사용자가 겪는 단위> — <전 → 후>
■ 직접 확인
  <사용자가 손으로 해볼 수 있는 것 1~2개>
■ 못 한 것
  <없으면 "없음">
```

- **기준은 코드가 아니라 사용자가 겪는 것이다.** 파일명·함수명·줄번호를 이 틀 안에 쓰지 않는다.
  - 화면 작업 → `결과 화면 — 로그인하면 6축 레이더가 이제 나옴 (전엔 빈칸)`
  - **화면 안 건드리는 백엔드 작업 → "이제 뭐가 되고 뭐가 안 되나"로 쓴다.**
    `코인 선물 — 같은 코인을 두 번 보내는 게 이제 안 됨 (동시에 눌러도 한 번만 나감). 화면은 그대로.`
  - 화면도 동작도 안 변한 작업(리팩터링·주석)이면 그렇게 쓴다: `겉으로 달라지는 건 없음. 나중에 고치기 쉬워진 것뿐.`
- **`직접 확인` 은 사용자가 실제로 할 수 있는 것만.** 화면이면 URL, 백엔드면 명령어(`npm run test:db`).
  확인할 방법이 없으면 `내가 테스트로 확인함 (48건 통과)` 처럼 **내가 뭘 확인했는지**를 쓴다.
- **10줄을 넘기지 않는다.** 넘을 것 같으면 항목을 줄이는 게 아니라 문장을 줄인다.
- 코드를 어디서 어떻게 고쳤는지는 **물어보면** 설명한다. 먼저 풀지 않는다.
- 여러 개를 한 번에 했으면 `뭐가 달라졌나` 에 `·` 줄을 늘린다. 칸을 늘리지 않는다.

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
| `/mypage` · `/mypage/:section` | `pages/MyPage.tsx` | `dashboard.css` | `my-attempts` · `mypage-ai` · `ebooks` |
| `/ebooks` (러닝 라이브러리 = 교재+강의) | `pages/Ebooks.tsx` | (Tailwind 유틸) | `ebooks` |
| `/ebooks/read/:id` (이북 뷰어) | `pages/EbookReader.tsx` | (인라인) | `ebooks` |
| `/checkout?type=&ref=` (결제) | `pages/Checkout.tsx` | (Tailwind 유틸) | `payments` |
| `/pay/success` · `/pay/fail` (결제 결과) | `pages/PayResult.tsx` | (Tailwind 유틸) | `payments` |
| **캐릭터 허브 / 미니게임** ||||
| `/hub` (실동작 로비) | `pages/Hub.tsx` | `hub.css`(직접 import) | `get-hub` · `complete-daily` · `gacha-draw` · `gacha-exchange` · `shop-buy` · `redeem-referral` · `coin-gift` |
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

- **메인 히어로 = 밤지구 순위 지구본(2026-08-06 반영)**: 옛 NASA 밤지구 **영상**(`EarthHero.tsx` + `public/earth.mp4` 21.6MB)을 캔버스 렌더러 `components/RankGlobe.tsx` 로 갈아치웠다. 지구를 사진으로 깔지 않고 그 자리에서 그린다 — 바다는 거의 검게, 모든 나라는 균일한 어두운 판, **상위 10개국의 국토 면이 빛나고** 1·2·3위는 금·은·동 + 그 땅 위에 `1st`·`2nd`·`3rd`. 전송량 21.6MB → 약 40KB(`geo/world.json` brotli 32KB + 렌더러)이고 그 경계 파일은 `/arena` 가 이미 받는 것이라 실질 추가분은 더 작다.
  - **모든 수치의 단일 출처 = `RankGlobe.tsx` 의 `CFG`**(바다·대륙 밝기, 발광, 색조, 크기·위치, 자전 속도 …). CSS 에는 기하가 하나도 없다(옛 `earthhero.css` 와 정반대). 값은 시안 **`docs/globe-mock.html`** 에서 슬라이더로 맞춘 뒤 '설정값 복사'로 옮긴 것이라, 바꿀 때도 시안에서 먼저 맞추는 게 빠르다. `CFG` 키 이름 = 시안 컨트롤 항목명.
  - ⚠️ **위성사진을 깔면 안 된다**(`public/earth/*.webp` 3장은 그 시도의 잔재). 사하라 갈색·아마존 초록·구름 흰색이 순위색과 같은 세기로 튀어서, 지구가 사실적일수록 순위가 안 읽힌다.
  - ⚠️ **면 발광은 면적 편향이 있다** — 보정(`AREA_REF` 기준 `^0.42`)을 끄면 6위 중국이 1위 한국보다 압도적으로 밝고 16위 호주가 화면에서 제일 크게 빛난다(시안에서 실제로 그랬다). 순위를 면적과 무관하게 읽히게 하려면 광점 모드가 맞고, 지금은 "땅이 빛나는" 그림을 택한 대신 면적 보정으로 누르고 있다.
  - ⚠️ **구면 클리핑(`clipAngle(90)`)은 필수다.** 뒷면 점을 테두리로 밀어붙이는 근사를 쓰면 러시아·남극처럼 경도로 긴 땅이 넘어갈 때 폴리곤이 넓적하게 늘어나 **바다를 덮었다 벗겨졌다** 한다(자전하니 얼룩이 표면을 훑는 것처럼 보인다 — 실제로 겪고 d3-geo 로 교체했다).
  - 초기 경도 `ROT_LON0 = -80`(동경 80° 정면)은 유럽·인도·중국·한국을 한 화면에 넣으려는 값이다. 태평양(-150)으로 두면 상위권이 전부 뒤편이라 **불빛이 하나도 안 보인다.**
  - 순위 소스는 `/arena` 와 **동일**(`buildRegions` — 실집계 `leaderboard` `scope:'country'` 우선, 없는 나라는 `data.ts` 의 데모 목값). ⚠️ 실집계는 현재 **대한민국 한 곳뿐**이라 화면에 보이는 순위는 대부분 목값이다.
  - ⚠️ `landing.css` 의 `.lp > *:not(.eh):not(.rg)` — 배경 레이어를 예외에서 빠뜨리면 flex 아이템으로 접혀 **0×0** 이 된다(실제로 `.rg` 를 그렇게 잃었다). 같은 파일의 `padding-bottom: 34vh`(옛 영상 구도에서 문구를 위로 밀던 우회)도 제거해 스택이 화면 한가운데 선다.
  - **조작 = 끌어서 돌리기**(`/arena` 와 같은 감각). 누르면 페이지 이동하는 동작은 없다 — `/arena` 로 가는 길은 `WORLD ARENA` 버튼이다. 드래그 중에는 자동 회전이 멈추고, 손을 뗀 각도를 새 기준(`spinBase`/`spinFrom`)으로 삼아 `RESUME_MS`(2.2초) 뒤 이어서 돈다. ⚠️ 기준을 안 잡으면 손 떼는 순간 원래 궤도로 순간이동한다. ⚠️ 캔버스에 `touch-action:none` 이 없으면 모바일에서 브라우저가 스크롤로 가로채 회전이 끊긴다.
  - 절약은 **화면 밖이면 렌더 정지** 하나만 넣었다(대가 없는 유일한 것). 30fps 제한은 자전이 끊겨 보이고, WebGL 은 폴백을 두 벌 유지해야 해서 안 했다.
- **`/guide` 개편(2026-07)**: 히어로(로고 락업 + 카피 + `CARIS PLAN` 버튼 + 로봇 이미지) → "CARIS는 무엇인가요?"(특징 카드 8장) → "CARIS 자격 체계"(피라미드 + 급수별 검정과목 카드) 3단 구성. **시험 일정은 `/plan` 으로 분리**됐다(옛 히어로 우측 일정 패널·상시시험 띠는 삭제). `/guide` 에서 원서접수로 가는 경로 = `CARIS PLAN` 버튼 → `/plan` → 회차 카드 → `/exam/apply`. 페이지 배경/색 토큰(`--g-*`)은 `.guide-page`(guide.css)가 단일 출처고 `/plan` 도 그걸 쓴다.
  - 히어로 이미지 = `public/hero-robot.png`(배경 투명). **손 위 CARIS 행성은 이미지에 없다** — `logo.png` 를 CSS 로 겹친 별도 레이어(`.guide-hero-orb`, %좌표 + 글로우 + 부유 애니메이션). 로봇 이미지를 갈면 손바닥 비율에 맞춰 `.guide-hero-orb`/`.guide-hero-art::after` 의 `left`·`top` 을 다시 맞출 것.
  - ⚠️ 클래스명에 `.hl` 쓰지 말 것 — `result.css` 가 전역으로 `.hl { display:flex }` 를 잡고 있다(`.gh-hl` 로 우회).
- `/mypage` 탭(URL `/mypage/:section`) 순서 = `learning`(학습 대시보드, **기본 = `/mypage`**) · `ebooks`(이북 서재) · `attempts`(시험 응시 현황) · `earned` · `issuance`. ⚠️ 응시 현황은 예전 기본 탭이라 `/mypage` 였는데 지금은 `/mypage/attempts`.
- **`/ebooks` = 러닝 라이브러리(2026-08-06 개편)**: 옛 '이북 스토어'(카드 그리드)를 **가로 3열 — `레벨 | 교재(E-BOOK) | 강의`** 로 바꿨다. 왼쪽에서 레벨을 고르면 가운데·오른쪽이 그 레벨 것으로 갈리고, 각 열은 카페 게시판처럼 자기 안에서 세로 스크롤한다(페이지를 내려서 레벨이 바뀌는 구조가 **아니다**). 좁은 화면은 레벨을 상단 가로 칩으로 빼고 교재↔강의를 탭으로 접는다. 레벨 나누는 기준은 `ebooks.target_level` 하나 — 서버 변경 없이 `store` 응답의 `targetLevel` 로 프론트에서 묶는다(`null` 인 책은 맨 뒤 '레벨 무관').
  - ⚠️ **강의는 아직 DB 가 없다 — `src/lib/lectures.ts` 하드코딩(데모)**. 유튜브 임베드라 영상 트래픽은 구글이 부담한다(우리는 `<iframe>` 태그 몇 KB만 내보냄). 관리자 등록으로 옮길 때의 주의는 그 파일 머리 주석 참고.
  - ⚠️ **열 높이를 `h-[...]` 로 못박지 말 것 + `items-start` 필수.** 레벨당 교재가 1권이라 높이를 화면에 맞춰 고정하거나 stretch 로 두면 교재 열 아래가 수백 px 텅 빈 검은 상자가 된다(그렇게 만들었다가 반려). 각 열은 내용만큼만 서고 `max-h` 를 넘길 때만 스크롤한다.
  - ⚠️ **표지·썸네일을 "항목이 많아질 테니" 작게 줄이지 말 것.** 개수는 열 스크롤(또는 나중에 페이지 나누기)이 푸는 문제다. 표지는 열 폭의 1/3, 강의 썸네일은 열 폭 꽉 채운 16:9 가 현재 기준.
  - ⚠️ 하단에 안내문을 깔면 떠 있는 FAB(왼쪽 아래)·맨위로 버튼(오른쪽 아래)에 덮여 글자가 잘린다 — 안내문은 머리말이나 열 꼬리말에 둔다.
  - ⚠️ **11~13px 잔글씨 금지.** 열 제목은 18px 굵게(대문자 캡션 아님), 보조 문구·개수·채널명도 14~15px 아래로 내리지 말 것(2026-08-06 "저런 작은 글씨 쓰지마"로 반려).
  - ⚠️ **열 배경은 `surface-container-low`**(+ 진한 `outline-variant` 테두리). 다크가 기본인데 `surface-container-lowest`(#0d0f15)는 페이지 배경(#0a0c11)과 거의 같아 세 열의 경계가 안 보인다(2026-08-06 반려). 다른 페이지에서 카드에 `lowest` 를 쓰는 건 그 페이지 배경이 달라서다 — 여기 값을 그쪽에 맞추지 말 것.
  - 화면 보면 아는 사용법 설명문("레벨을 고르면 …")은 넣지 않는다 — 넣었다가 삭제됨.
  - 현재 데이터는 **레벨당 교재 1권 · 강의 1편**(`lectures.ts` 가 레벨당 1개). 늘려도 화면은 손댈 게 없다 — 열이 알아서 스크롤한다.
- **이북(전자책)**: 관리자가 HTML 1개 파일을 업로드(비공개 버킷 `ebooks`, 표지는 공개 버킷 `ebook-covers`) → 회원이 `/ebooks` 에서 구매 → 마이페이지 '이북 서재' 탭에서 열람(`/ebooks/read/:id` 뷰어가 서명 URL iframe). 테이블 `ebooks`·`ebook_purchases`, 함수 `ebooks`(store·picks·library·buy·read) + `admin`(ebookList/Upsert/Delete/Buyers).
  - **결제 연동됨(2026-08-06, 토스페이먼츠)**: 유료책은 `/checkout?type=ebook&ref=<id>` → 결제위젯 → `/pay/success` → 서버 승인 → 지급. `ebooks` 함수의 `buy` 는 이제 **0원 책 전용**이고 유료책엔 402 를 준다(안 막으면 함수를 직접 불러 결제를 통째로 우회할 수 있다). 아래 "결제" 절 참고.
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
  - **코인 선물(2026-08-07)**: 뒤로가기 줄 오른쪽 `선물` 버튼(공유 옆) → 모달. **친구 초대 모달에 넣지 않는다**(같은 친구코드를 쓰지만 별개 진입점으로 두기로 결정). 두 버튼은 `.hub-backrow-act` 로 묶는다 — `.hub-backrow` 가 `space-between` 이라 낱개로 넣으면 셋이 흩어진다.
    - **즉시 이체다. 취소·회수 경로가 없다.** 방어선은 ① 코드 8자 완성 시 상대 **닉네임 자동 표시** ② 확인 단계 ③ nonce 재사용 셋뿐이다.
    - ⚠️ **`client_nonce` 를 호출마다 새로 만들면 안 된다.** 뽑기·상점은 `crypto.randomUUID()` 를 호출 시점에 만들지만(재시도해도 손해가 작다), 선물은 그러면 타임아웃 후 재시도가 **두 번 보내기**가 되고 되돌릴 수 없다. `Hub.tsx` 는 **모달을 열 때 1회** 만들어 전송 성공까지 고정한다(`giftNonce`).
    - ⚠️ **잠금 순서가 이 기능의 핵심 한 줄이다.** 이체는 처음으로 두 사람의 `user_currency` 행을 잠근다 — `least/greatest` 로 **uuid 오름차순 고정**이 아니면 A→B / B→A 동시 실행이 데드락이다(동시성 테스트의 음성 대조군이 실제로 데드락을 낸다).
    - ⚠️ **`coin_gift` 안의 순서가 곧 정확성이다 — 잠금 → 멱등 재확인 → 쿨다운 → 잔액.** 셋 다 잠금 앞에 두면 동시 요청에서 조용히 깨진다(2026-08-07 실측):
      · **쿨다운이 잠금 앞**이면 같은 발신자의 동시 2발이 나란히 "직전 없음"을 보고 **둘 다 통과**한다.
      · **멱등 재확인이 쿨다운 뒤**면 같은 nonce 재시도가 `too_fast` 로 거절된다 — **돈은 이미 나갔는데 화면은 "너무 자주 보냈어요"** 를 띄워 사용자가 다시 보내게 만든다(8발 중 4발이 그렇게 거절됐다). 함수 머리의 `(0)` 검사는 잠금 전이라 경합에서 못 막는다.
    - ⚠️ **원장(`coin_transfers`)은 `on delete set null` + 닉네임 스냅샷**이다. 다른 테이블의 `cascade` 관례를 여기 적용하면 발신자가 탈퇴하는 순간 받은 사람의 이력이 사라져 "이 코인 왜 늘었지"에 영영 못 답한다. self CHECK 도 `sender_id <> recipient_id` 로 쓰면 양쪽 null 일 때 CHECK 이 깨져 SET NULL 자체가 실패한다.
    - **저장은 건별, 표시는 사람별 합산.** 허브는 **오늘 받은 것**만 상세로 보여주고 그 이전 미확인은 건수만(`giftsToday`/`giftsOlder`/`giftsUnseen` — `get-hub`). 서버는 미확인 전부를 내려준다(오늘로 자르면 하루 안 들어온 사람의 알림이 통째로 사라진다). 전체 이력은 모달 안 `선물 내역 ›`(`coin-gift` 의 `history`).
    - **금액 한도는 없다**(잔액이 곧 한도 — 코인은 시즌 점수·랭킹과 별개 지갑이라 파밍해도 순위가 안 흔들린다). 대신 **같은 사람에게 10초 쿨다운**만 건다 — 돈이 아니라 받는 사람의 알림을 지키는 장치다. 한도를 나중에 얹고 싶으면 원장이 이미 있으니 쿼리만 추가하면 된다.
    - **가루(dust)는 선물 대상이 아니다** — 뽑기 천장·한정템 교환가(150)가 설계 전제라 이체되면 천장이 무의미해진다.
    - 익명 계정은 송·수신 둘 다 불가. 수신은 따로 막지 않아도 된다 — `get-hub` 가 익명을 먼저 컷해서 `ensure_referral_code` 가 안 불리고, **코드가 없으면 지정 자체가 성립하지 않는다.**
    - 검증 두 벌. **pglite 로는 부족하다** — 단일 커넥션이라 트랜잭션을 두 개 못 열어서 이 기능에서 제일 위험한 것들을 구조적으로 재현할 수 없다.
      · `tests/db/t-coin-gift.mjs` (48건, pglite · `test:db` 에 포함) — 제약·에러코드·원장 보존 등 단일 실행 규칙.
      · `tests/db/t-coin-gift-concurrency.mjs` (17건, **진짜 Postgres** · `npm run test:concurrency`) — 데드락·같은 nonce 동시 8발·잔액 경합·쿨다운 경합·무작위 부하(총량 보존/음수 없음/원장 정합). Postgres 클라이언트는 Bun 내장(`Bun.sql`)이라 의존성이 없고, 커넥션마다 별도 `SQL` 인스턴스(`max:1`)를 만든다 — 풀에 맡기면 두 요청이 같은 커넥션을 타서 **동시 실행이 아니라 순차 실행**이 되고 테스트가 조용히 무의미해진다.
      · 실행: `docker run -d --name cari-pgtest -e POSTGRES_PASSWORD=test -e POSTGRES_DB=caritest -p 55432:5432 postgres:17-alpine` (다른 DB 는 `CARI_TEST_PG`. ⚠️ 스키마를 지우므로 운영 DB 금지). `test:db` 에는 넣지 않았다 — Docker 가 없으면 실패하는 테스트를 기본 스위트에 두면 전체가 빨간불이 된다.
      · ⚠️ **동시성 테스트에는 음성 대조군이 필수다.** 일부러 틀린 잠금 순서(`gift_naive`)가 실제로 데드락을 내는지 먼저 확인한다 — 이게 없으면 "데드락 0건"이 *순서가 옳아서*인지 *테스트가 애초에 경쟁을 못 만들어서*인지 구분할 수 없다. 같은 이유로 부하 단계는 "이체가 실제로 150건 넘게 일어났다"를 같이 본다(0건이어도 총량은 당연히 보존된다).
      · ⚠️ 부하 단계는 시작 전 원장·잔액을 리셋한다. 앞 단계의 대조군 함수와 수동 UPDATE 가 원장을 안 거치고 잔액을 바꿔서, 안 지우면 **제품이 아니라 테스트 자신의 조작**을 총량 불일치로 잡아낸다.
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
  functions/   36개 — CBT(start-exam·submit-exam·get-exam-result·verify-cert·seb-handoff) · 이북(ebooks) · 결제(payments·payments-webhook) · 레벨테스트(start-test·submit-test·get-result·list-attempts·leaderboard·recommend-level)
               · 허브(get-hub·complete-daily·gacha-draw·gacha-exchange·shop-buy·redeem-referral·coin-gift) · 검색라우터(route-query·route-seed)
               · 지식베이스(kb-*·lecture-qa) · 운영(admin·admin-test·my-attempts·mypage-ai·set-region·translate-questions)
  functions/_shared/  cors.ts · lib.ts (스코어링·인증·쿨다운 공용) · toss.ts(토스 API 래퍼) · payments.ts(주문·금액검증·지급·대사)
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
  - `/hub` 는 오래 한국어 하드코딩이었는데 2026-08-07 에 `hub.*` 132개로 일괄 이관했다. 그때 나온 함정 셋:
    - ⚠️ **문구를 정규식으로 검사해 분기하지 말 것.** 허브 토스트가 아이콘을 `/부족|필요|오류/.test(문구)` 로 골랐는데, 번역하는 순간 전부 한쪽으로 쏠린다. 지금은 `toast.bad` 플래그를 들고 다닌다.
    - ⚠️ **`t` 를 이펙트 의존성에 넣지 말 것.** 프로바이더가 `t` 를 렌더마다 새로 만들어서 deps 에 넣으면 이펙트가 매 렌더 돈다(선물 코드 자동조회가 그랬다). 실패 메시지를 **문구가 아니라 사전 키**로 state 에 담으면 이펙트가 `t` 를 안 쓰게 되고, 덤으로 언어를 바꿔도 메시지가 따라 바뀐다.
    - ⚠️ **문장을 쪼개서 인라인 `<b>` 를 끼우지 말 것** — 어순이 언어마다 달라 번역이 불가능해진다(선물 확인 문구에서 뺐다).
  - 파츠 이름은 `hub.part.<partKey>`, 활동 라벨은 `hub.earn.row.<kind>` 로 **키를 조립**한다. 상수 배열에 라벨을 같이 두면 표를 두 벌 관리하게 된다.
- **레벨 추천**: 검색어 → `recommend-level` 함수 → Gemini 임베딩 코사인 → 레벨. 앵커 문구가 품질 좌우. 레벨 7개라 pgvector 불필요(메모리 비교). → `docs/온보딩.html` §12
- **캐릭터(아바타)**: `profiles.avatar_url` 한 컬럼에 `gem:#hex`(젬 색) 또는 `img:<public-url>`(업로드 이미지) 저장. 그 외 값/NULL(구글 가입 URL 등)은 무시하고 시드 젬으로 표시. 해석·팔레트·업로드는 `src/lib/avatar.ts`(`parseAvatar`/`uploadAvatar`), 렌더는 `<Avatar>`(`GemAvatar.tsx`).
  - ⚠️ **아바타를 %크기 소켓에 넣을 땐 `aspect-ratio: 1 !important` 를 반드시 같이 걸 것 — 안 그러면 달걀이 된다.** `<Avatar>` 는 인라인 style 로 px 크기 + `border-radius:50%` 를 박기 때문에, `width/height:100%` 만 덮어쓰면 퍼센트 높이가 auto 로 떨어지는 순간 박스가 세로로 눌려 **원이 타원**이 된다. 반복해서 재발한 버그다(시상대 → 티어바). `ranking.css` 의 '아바타 달걀 방지' 블록에 소켓 선택자를 **모아서** 관리한다 — 소켓을 새로 만들면 그 블록에 선택자만 추가하고, 소켓마다 규칙을 따로 쓰지 말 것. 업로드는 Supabase Storage **공개 버킷 `avatars`**(경로 `<uid>/...`, RLS=본인 폴더만 — 버킷·정책은 대시보드 SQL로 생성). 리더보드도 이미지/색을 반환하므로 변경 시 `leaderboard` 함수 재배포 필요.
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

## 결제 (토스페이먼츠 · 2026-08-06 연동)

**코드 쓰기 전에 [`docs/토스페이먼츠-연동-가드레일.md`](./docs/토스페이먼츠-연동-가드레일.md) §8(LLM이 자주 틀리는 패턴 20개)을 먼저 볼 것.** 더 깊은 내용은 `.mcp.json` 의 토스 MCP 서버로 문서를 직접 조회한다.

- **범위**: 1차는 **국내 원화(KRW)만**. 토스 V2 표준 SDK 가 `amount.currency: "KRW"` 만 받기 때문이다(해외카드·페이팔은 MID 1개당 통화 1개라 상점·위젯을 따로 만들어야 하고 카드사 심사가 붙는다). 해외 PG는 나중에 얹되 `payments.provider` 컬럼을 처음부터 둬서 테이블을 안 갈아엎게 했다.
- **흐름**: `/checkout?type=&ref=` → `payments/create`(서버가 금액 계산) → 결제위젯 → `/pay/success` → `payments/confirm`(승인) → 지급.
- **금액을 요청으로 받지 않는다.** `create` 는 상품ID만 받고 `_shared/payments.ts` 의 `resolveProduct` 가 DB에서 다시 뽑는다. `confirm` 은 successUrl 의 `amount` 를 **저장된 주문 금액과 대조한 뒤**, 승인 API 에는 **저장된 값**을 넘긴다. 소유자(`user_id`) 확인도 필수 — 안 하면 남의 주문에 결제를 붙일 수 있다.
- **중복 지급은 코드가 아니라 DB가 막는다** — `payments` 의 부분 유니크 인덱스 `(user_id, product_type, product_ref) where status='paid'` + `ebook_purchases.unique(user_id, ebook_id)`. Idempotency-Key 는 토스 쪽 중복 승인만 막지 우리 DB 이중지급은 못 막는다.
- **지급 순서 = 지급 먼저, `fulfilled_at` 나중.** 반대로 하면 지급이 실패했을 때 "이미 줬다"는 기록만 남아 미지급을 영영 못 찾는다. `status='paid' AND fulfilled_at IS NULL` 이 "돈은 받았는데 안 준 것" 신호이고 대사가 이걸 본다.
- **PG 어댑터(포트) 구조** — 승인·조회·상태정규화는 `_shared/payment-provider.ts`(포트) 뒤에 있고, 토스 구현은 `_shared/toss.ts` 의 `tossProvider` 다. `payments.ts`·`payments` 함수는 PG 를 모르고 `getProvider(row.provider)` 로만 부른다. **엑심베이 등 새 PG = `_shared/eximbay.ts` 새 파일 + `PROVIDERS` 에 한 줄. 토스 코드는 열지 않는다**(그래서 검증된 토스 동작이 안 틀어진다). ⚠️ 프론트 결제창은 PG 마다 달라 포트로 못 숨긴다 — 그건 그때 컴포넌트 추가. `settleFromToss`→`settleFromProvider`, `TossPayment`→`ProviderPayment`(중립). status 정규화 중 `canceled→refunded` 업그레이드만 settle 이 한다(어댑터는 취소를 늘 canceled 로 준다 — 우리 DB 의 fulfilled 를 모르니까).
- **환불 자동 회수** — 사람이 토스 대시보드에서 환불하면 웹훅→`settleFromProvider` 가 `refunded` 로 바꾸는 순간, **그 결제로 지급된 것만 자동 회수**한다(`revokeForRefund`). ⛔ 대상은 사용자·상품이 아니라 **`payment_id` 로만** 특정 — 다른 구매·남의 것은 절대 안 건드린다. 안 쓴 것만 자동: 이북=열람권 삭제, **미사용(issued)** 응시권=void. **이미 소비(consumed)된 응시권은 자동 회수 안 함**(응시 후 건이라 성적·자격증 판단 필요) → 대사 목록에 남긴다. 환불을 **일으키는** 코드(토스 취소 API)는 일부러 없다 — 돈 되돌리는 건 수동. 앱 안에 고객용 '환불 요청' UI 도 아직 없다(요청은 앱 밖).
- ⚠️ **가상계좌**: 승인 응답이 와도 `WAITING_FOR_DEPOSIT` 이면 계좌가 **발급**된 것이지 결제된 게 아니다. 여기서 지급하면 돈 안 받고 물건을 준다 → `waiting_deposit` 로 두고 입금 웹훅에서 지급한다.
- ⚠️ **`payments-webhook` 만 `verify_jwt=false` 로 배포**한다(토스는 Supabase JWT 를 못 싣는다). `route-seed` 에 이은 두 번째 예외라 URL 시크릿(`?k=`)이 필수다. 나머지 함수엔 `--no-verify-jwt` 금지.
- **일반 결제 웹훅에는 서명 헤더가 없다**(그건 지급대행/셀러 웹훅 전용). 본문을 믿지 말고 식별자만 꺼내 **토스에 다시 조회**해 판정한다(`resettle`). 웹훅은 중복·역순·미도착이 다 가능하므로 웹훅만으론 부족 — `payments/reconcile`(헤더 `x-reconcile-key`)을 주기적으로 돌려야 한다.
- **시크릿**: `TOSS_SECRET_KEY`·`TOSS_WEBHOOK_SECRET`·`PAYMENTS_RECONCILE_KEY` 는 **Supabase 함수 시크릿**. 프론트엔 클라이언트 키(`VITE_TOSS_CLIENT_KEY`)만 — 브라우저 노출값이라 상관없다. ⚠️ **결제위젯 연동 키**를 쓸 것('API 개별 연동 키'와 다른 값이다).
- ⚠️ **현재 붙어 있는 건 토스 '문서용 공개 테스트 키'**(`test_gck_docs_…` / `test_gsk_docs_…`)다. 내 상점 테스트 키는 개발자센터에서 **전자결제 신청(실계약)** 을 해야 값이 보이기 때문이다(가입만으로는 안 나온다 — 2026-08-06 확인). 문서 키의 한계가 하나 있다:
  - **승인(confirm) API 는 정상 동작**한다(가짜 paymentKey 에 `NOT_FOUND_PAYMENT_SESSION` 이 온다 = 인증 통과).
  - **조회(query) API 는 안 된다** — 모든 조회가 `NOT_FOUND_MERCHANT` 404 다. 즉 **웹훅 재조회·대사가 문서 키로는 무의미**하다(내 상점 키로 바꾸면 정상화된다).
  - 그래서 `resettle` 은 HTTP 404 가 아니라 **`ORDER_ABSENT_CODES`(NOT_FOUND_PAYMENT·NOT_FOUND_PAYMENT_SESSION)일 때만** 주문을 만료로 접는다. 404 만 보고 접으면 문서 키 환경에서 **결제된 주문까지 전부 만료로 접힌다.**
- ⚠️ **약관 위젯의 초기 상태는 이벤트로 오지 않는다.** `agreementStatusChange` 는 이름 그대로 '변경'에만 오고 SDK 에 초기 상태 getter 가 없다. "동의했을 때만 결제 버튼 열기" 로 만들면 위젯이 처음부터 동의된 상태로 그려질 때 **버튼이 영영 잠긴다**(실제로 겪음). `Checkout.tsx` 는 미동의로 **확인된** 경우에만 잠근다.
- **금액 표시는 `src/lib/money.ts` 의 `krw()` 로만.** 이북 가격은 원(KRW)인데 화면이 `$` 로 찍고 있었다(2026-08-06 수정). 화면 언어가 영어여도 통화는 원이다.
- **정가(2026-08-06 정리)**: 환산 기준 **$1 = 1,500원**. 이북 = `ebooks.price`(관리자 이북 탭), 응시료 = **`exam_fees`**(관리자 → 시험등록 탭 상단 `ExamFeeBox`). 둘 다 **원 정수**이고 코드에 하드코딩된 금액·폴백은 없다. `caris.ts` 의 `fee`(달러 상수)는 제거됐고 `src/lib/fees.ts`(`useExamFees`/`feeKey`)가 살아났다. 요금 키 = `${트랙키}_${티어키}`(`t1_beginner`·`t1_pro`·`t1_elite`) — 구 급수 키(`pro`·`master_g4`~`g1`)는 삭제됐다.
  - ⚠️ **`exam_fees` 에 행이 없는 티어는 결제가 막힌다**(원서접수가 '준비 중' 표시 + 결제 버튼 비활성). 버그가 아니라 의도다 — 금액 미설정을 임시값으로 때우면 엉뚱한 돈이 청구된다. 현재 CARIS-Ⅱ(Master·Grand Master·Zenith) 3개가 여기 해당하며, 열려면 관리자 화면에서 금액만 채우면 된다.
### 응시권 (exam_tickets) — 응시료 결제의 본체 (2026-08-07)

결제와 응시 사이에 **`exam_tickets` 한 행**을 둔다. 이 행이 응시 자격의 **유일한 출처**다.

- `product_ref = "<round_id>:<tier>"`. `payments_paid_product_uniq` 가 text 원문 비교라 **정규화가 필수** — `resolveProduct` 가 DB 에서 읽은 값을 되돌려주고 insert 는 그 값만 쓴다(이북도 같은 구멍이었다).
- 응시권은 `exams.id` 가 아니라 **(회차 × 급수)** 에 묶는다. 관리자가 회차 편집에서 급수를 해제하면 `exams` 행이 **실제로 DELETE** 되는데, 응시권을 막 판 직후가 정확히 그 구간이라 체크박스 한 번에 팔린 응시권이 미아가 된다.
- **판정은 전부 DB 제약이 한다.** 코드는 23505/23503 을 사람 말로 옮기기만 한다.

| 막는 것 | 제약 |
|---|---|
| 같은 (사람×회차×급수) 응시권 2장 (수기·무료 발급 포함) | `exam_tickets_live_uniq` |
| 한 결제로 응시권 2장 (승인·웹훅·대사 3중 호출) | `exam_tickets_payment_uniq` |
| **한 응시권으로 응시 2개 — 상태 무관** | `exam_attempts_ticket_live_uniq` |
| 오타 티어 발급 (`exams.tier` 엔 CHECK 이 없다) | `exam_tickets.tier` → `exam_tiers` FK |
| 응시권 팔린 회차 삭제 | `round_id` FK (NO ACTION) |

- ⚠️ **`exam_attempts_ticket_live_uniq` 의 조건은 `where ticket_id is not null` — 상태를 넣지 마라.** `status in ('in_progress','submitted')` 로 두면 제출 안 하고 나갔다가 TTL 뒤 재진입할 때 옛 응시를 expired 로 눕히고 **같은 응시권으로 새 응시를 또 만들 수 있다.** 문항 세트가 고정이라 시험창(10일) 내내 반복하면 제한시간·1인1회가 통째로 무의미해진다(2026-08-06 검증에서 실제로 잡힘). 재진입 = '새로 만들기'가 아니라 '그 응시로 돌아가기'다.
- ⚠️ **지급 실패를 결제 실패로 만들지 마라.** 승인이 끝났으면 돈은 이미 빠졌다. 접수 마감 직후 승인·급수 해제 등으로 지급이 막히면 `paid + fulfilled_at=null` 로 남겨 대사에 걸고, 화면은 **'결제 완료 · 발급 보류'**(`pay.hold_*`)를 보여준다. 실패로 표시하면 사용자가 재결제를 시도하다 '이미 결제 완료'를 보게 돼 두 화면이 정반대로 말한다.
- ⚠️ **살아있는 결제 = `paid` + `waiting_deposit`.** 중복 검사에서 `paid` 만 보면 가상계좌 주문이 안 잡혀 "VA 로 주문해두고 카드로 또 결제" → 나중에 입금 시 **두 번 청구**가 된다.
- ⚠️ **웹훅은 영구 오류에 500 을 주면 안 된다** — 토스가 무한 재시도한다. 중복키 같은 건 200 + 사유로 닫는다.
- **정기시험 = 월 3구간**(1–10 접수 / 11–20 시험 / 21–말일 채점). 응시창은 `exam_rounds.exam_start_at`·`exam_end_at`(KST). ⚠️ 기존 회차 중 시험일이 11~20 밖인 것(제4·5회)은 백필이 **시험일 당일만** 열었다 — 11~20 을 그대로 밀면 시험창이 시험일을 안 포함해 아무도 응시 못 한다.
- **상시(rolling)는 판매하지 않는다**(2026-08 폐지). 행·표시 코드는 두고 결제 진입만 막는다.
- **응시료는 카드·간편결제만**(D3). 가상계좌는 입금이 끝나도 응시권을 발급하지 않고 대사로 넘긴다 — VA 는 접수 마감 뒤 입금이 정상이라 마감이 무의미해진다.
- **0원은 판매 불가**(무료 아님). `exam_fees.amount` 는 default 0 이라 오타 한 번이 무제한 무료 응시권이 된다. 이북만 0원 즉시지급을 허용한다.
- SEB 익명 응시 경로는 응시권 도입으로 자연히 막혔다(원래 결제 없이 응시가 됐다). 인계는 아래 참고.

### SEB 세션 인계 (2026-08-10)

SEB 는 **별도 브라우저 프로필이라 세션이 없고, 그 안에서 로그인할 방법도 없다**(SEB 가 외부 사이트를 막고 구글도 이런 브라우저를 거부한다). 그래서 켜기 전에 자격을 쥐어줘야 한다. 옛 코드는 `ensureAnonymous()` 로 익명 세션을 만들었는데 응시권 도입 후 `start-exam` 이 익명을 403 으로 막으면서 **SEB 경로가 통째로 죽어 있었다.**

흐름 = `ExamPrepare` 에서 **1회용 인계표(nonce)** 발급 → SEB 실행 링크에 실어 보냄 → SEB 가 그 쿼리를 startURL 로 옮겨줌 → `/exam/seb` 가 표를 **시험 전용 토큰**으로 교환 → `start-exam`·`submit-exam` 이 그 토큰을 받는다.

- ⚠️ **`.seb` 의 `startURLAppendQueryParameter` 가 이 구조의 전제다.** 끄면 표가 SEB 안으로 못 넘어가 응시가 시작조차 안 된다. `tools/make-seb*.mjs` 에 있고 `public/*.seb` 를 다시 뽑아야 반영된다.
- ⚠️ **정식 Supabase 세션을 넘기지 말 것.** 그 세션은 결제·코인 선물·마이페이지까지 전부 가능하고 회수 수단이 없다. 시험 전용 토큰(`_shared/exam-token.ts`)은 **`start-exam`·`submit-exam` 두 곳만** 받아주고 표에 박힌 응시권 하나로 묶인다. `getExamActor` 를 응시 계열 밖에서 쓰면 이 토큰의 존재 이유가 사라진다.
- ⚠️ **주소에 싣는 건 nonce 지 토큰이 아니다.** 표는 startURL 을 타고 주소창·접속 로그에 남는다. 그래서 5분·1회용이고, 진짜 인증수단은 SEB 안에서 교환해 받는다. 토큰 수명은 6시간 — **응시 TTL(240분)보다 짧게 잡으면 시험 도중 제출이 실패한다.**
- ⚠️ **표는 매번 새로 받는다.** 안내 팝업의 '다시 열기' 도 `openSeb()` 을 다시 부른다 — 1회용이라 재사용하면 두 번째 클릭이 조용히 실패한다.
- ⚠️ startURL 에 이미 `?lang=` 이 있어 SEB 가 `?` 로 붙일지 `&` 로 붙일지가 버전마다 다를 수 있다. 받는 쪽(`examToken.ts` 의 `readHandoffNonce`, `i18n.tsx` 의 `detect`)이 **둘 다 견디게** 해뒀다 — 그 방어를 지우려면 실기기로 먼저 확인할 것.
- `redeem` 에 레이트리밋이 없는 건 의도다 — nonce 가 32바이트 난수라 추측 불가고, 세션이 없어 계정 단위로 셀 수 없으며, IP 로 세면 같은 시험장 응시자끼리 서로를 막는다.
- ⛔ **대리응시는 이 구조가 막지 못한다.** 표를 남에게 넘기면 그만이다 — 그건 본인인증이 풀 문제고, `/exam/seb` 의 `[본인인증수단 개발중]` 안내가 그 자리를 잡아두고 있다.
- 검증: `tests/db/t-seb-handoff.mjs`(17건). **실기기 확인은 아직 안 했다** — 배포 후 실제 SEB 로 링크를 눌러봐야 한다.

### 응시 중단 — 재진입은 무효, 사고는 사람이 푼다 (2026-08-10)

우리 시험은 **감독관 없는 10일 자율응시**다. 그래서 "응시 화면을 나갔다가 검색해보고 돌아오기"가 열려 있는데,
서버는 **PC 가 뻗은 것과 일부러 나간 것을 구분할 수 없다**(둘 다 "세션이 끊겼다 다시 들어왔다"로만 보인다).
그래서 판정을 자동화하지 않는다 — **기본은 엄격하게(재진입=무효), 예외는 사람이**(관리자 복구).

- **재진입 판정은 `_shared/exam-reentry.ts` 한 곳**이고, 두 군데가 그걸 부른다: ① `seb-handoff`(표 발급) — 응시 준비 화면에서 **SEB 를 켜기 직전**, 사용자가 실제로 만나는 자리 ② `start-exam` — 준비 화면을 건너뛴 경우의 최후 방어선.
- ⚠️ **①이 없으면 SEB 가 켜지고, 잠긴 화면 안에서 무효 안내를 본 뒤 다시 SEB 를 빠져나와야 한다.** 헛걸음인 데다 잠금 브라우저를 왕복시킨다. 판정을 한 곳에 둔 이유도 같다 — 두 벌이면 "준비 화면은 통과, 시험 시작에서 무효" 로 어긋난다.
- **복구 뒤 또 끊기면 다시 무효다(2026-08-10 결정).** 코드가 횟수를 세는 게 아니라, 사고가 날 때마다 사람이 다시 판단한다는 뜻이다.
- ⚠️ **횟수로 봐주는 규칙(N회까지 허용)을 넣지 말 것.** "1번 꺼진 건 괜찮고 2번은 안 된다"는 근거가 없다 — 구분하는 척하는 것일 뿐이다. 구분이 안 되면 사람에게 넘긴다.
- **복구는 1회권이다.** `reinstated_at` 이 있는 응시만 재진입을 통과하고, 통과하는 순간 그 값을 지운다. 안 그러면 한 번 풀어준 응시가 영구 무제한 재진입이 된다.
- ⛔ **복구하면 제한시간은 처음부터 다시**, 시계는 **응시자가 실제로 다시 들어오는 순간**부터 간다(`start-exam` 이 그때 `started_at` 을 옮긴다). 복구 시점에 맞추면 안 된다 — 관리자가 눌러놓고 응시자가 몇 시간 뒤 들어오면 그 사이가 다 흘러간다.
- ⛔ **'남은 시간만 복원' 은 하지 않는다(2026-08-10 결정).** 답안은 제출할 때 한 번에 올라가므로(실시간 저장 없음) 시간만 깎아 돌려주면 **백지에서 짧은 시간**이라 처음부터 다시보다 나쁘다. 맞추려면 매 클릭을 DB 에 밀어넣어야 하는데 이 한 경우를 위해 치를 비용이 아니다.
- ⛔ **`resume_deadline` 이 응시 기간을 무시하고 열어준다.** 없으면 "마지막 날 저녁 사고 → 다음 날 처리" 에서 회차가 이미 끝나 복구가 성립하지 않는다. 관리자가 기한(기본 7일)을 정한다.
- ⚠️ **응시창이 닫히면 재진입이 무효 판정에 닿지도 못한다** — 티켓 필터(⑤)가 먼저 막기 때문이다. 그래서 그 경우는 `resume_blocked` 로 사유·문의 안내를 주고 응시를 `in_progress` 로 남기며, **복구는 `voided` 뿐 아니라 `in_progress`·`expired` 도 받는다**(`submitted` 만 거절). 복구는 '무효를 푸는 것' 이 아니라 **다시 볼 수 있게 시계와 기한을 주는 것**이다.
- ⚠️ 복구는 새 응시가 아니다 — **문항 세트는 원래 받은 그대로**다. 다른 문항으로 보게 하려면 응시권을 새로 발급해야 한다.
- **응시자 안내에 세 가지를 반드시 담는다**(`seb.voided_how`): ① 제한시간을 처음부터 다시 받는다 ② 응시 기간이 끝나도 별도 기한을 준다 ③ 확인에 영업일이 걸린다. **24시간 상주 운영이 아니므로 즉시 처리를 약속하지 않는다.**
- **정황 자료**(`exam_session_events` + `exam_attempts.last_seen_at`·`answered_count`):
  · **닫힘 신호 유무가 핵심 한 줄** — 있으면 사람이 창을 닫은 것, 없이 끊겼으면 알릴 틈이 없었던 것(정전·PC 정지).
  · 공백 길이(사고는 짧고 검색은 길다) · 끊긴 시점 진행률(하나도 안 풀고 훑기만 했는지).
  · ⚠️ **증거가 아니라 정황이다** — 랜선을 뽑으면 닫힘 신호도 안 남는다. 그래도 아무 자료 없이 판단하는 것보다 낫고 상습범은 패턴이 남는다.
- ⚠️ 하트비트는 `exam_attempts` 행을 **갱신만** 한다(이력으로 쌓지 않는다 — 50분 응시면 응시당 100행이 된다). 사건만 `exam_session_events` 에 남긴다.
- ⚠️ 떠나는 순간 쓸 인증 헤더는 **미리 만들어 둔다**(`primeExamSession`). `getSession()` 은 비동기라 창이 닫히는 순간 부르면 토큰을 받기 전에 문서가 사라져 신호가 통째로 유실된다 — 그러면 자진 종료가 '신호 없음'으로 기록돼 사고와 구분이 안 된다.
- 관리자: 응시 상세 모달의 `응시 중단 기록` 패널(`admin` 의 `examInterruption`·`examReinstate`). 복구 사유는 필수다.
- ⛔ **이걸로 부정행위가 막히지는 않는다.** 문항이 한 화면에 다 펼쳐져 있어 폰으로 보면서 검색하면 나갈 필요조차 없다. 실질적 방어는 ① 한 문항씩·뒤로가기 금지 ② 문항 수에 맞춘 제한시간 ③ 검색해도 안 나오는 적용형 문항이고, 완전한 해결은 웹캠 감독뿐이다.

**🚪 탈출구 (2026-08-10 — 테스트 중 갇혀서 재부팅한 뒤 추가)**
SEB 는 뒤로가기·새로고침·주소창·앱전환이 다 막혀 있고 수동 종료엔 비밀번호가 걸려 있다. 화면에 나가는 버튼이 없으면 **재부팅 말고 방법이 없다.**
- `<SebEscapeHatch>`(App.tsx) — SEB 안 **모든 화면** 오른쪽 아래에 뜨는 전역 안전망. 라우트가 안 맞아 랜딩으로 튕겨도 살아남는다. 페이지 CSS 없이 보이도록 인라인 스타일 + 최대 z-index.
- `<SebExitButton>` — 막다른 화면에 직접 붙이는 버튼(`/exam/seb` 오류·시작 화면, CbtRunner '출제 데이터 유실'). **막다른 화면을 새로 만들면 여기도 붙일 것.**
- ⚠️ **응시 중(`/exam/run/*`)·종료 화면에는 안 뜬다.** 시험 도중 나가는 건 '종료(포기)'라 응시 무효 기록이 남아야 하고, 한 번에 나가는 길을 주면 잠금이 무의미해진다.
- ⚠️ 종료 주소는 `lib/seb.ts` 의 `sebQuitUrl()` **한 곳**에서만 만든다 — `tools/make-seb-all.mjs` 의 `quitURL` 과 글자가 어긋나면 SEB 가 안 닫힌다.
- 앱이 아예 안 뜬 경우의 최후 수단 = `Ctrl+Q` + 종료 비밀번호 **`gara-exit-2026`**(`make-seb-all.mjs` 의 `QUIT_PASSWORD`). → `docs/SEB설정.md` 맨 앞 절.
- 검증: `tests/db/t-exam-tickets.mjs`(26건) · `tests/db/t-payments.mjs`(46건).
- 실키 심사 전 채워야 하는 것(코드 아님): 전자상거래법 사업자정보 표기, 이북 청약철회 제한 문구·응시료 환불규정(`/terms`), 미성년자 결제 동의.

### 자격증 발급비 (cert) — 지급물이 없는 유일한 상품 (2026-08-07)

`product_type='cert'`, `product_ref = exam_attempts.id`. **금액 = 그 급수의 응시료와 동일**(`exam_fees` 재조회).
지급(`grant`)이 **no-op** 이고, `payments` 행(`paid`) 자체가 발급 게이트다 — `my-attempts {issue}` 가 채번 직전에 그 행을 찾는다.

- ⚠️ **`resolveExamOffer` 를 쓰면 안 된다.** 그건 접수창(`applyWindowOpen`)까지 보는 판매 판정이라, 성적 공개 후(=접수 마감 후)에 사는 발급비가 통째로 `apply_closed` 로 막힌다. 급수 정가만 필요하므로 `resolveExamFee`(회차·접수창 무관)를 쓴다. 지금 개발 회차는 접수창이 열려 있어 **테스트로는 안 잡히는 버그**다.
- **최초 발급만 유료, 재발급은 무료**(`verify_token`·`cert_no` 가 이미 있으면 결제를 안 본다 — 번호·QR 불변이라 새로 파는 물건이 아니다).
- 응시권 생존 판정은 `ticketSourceAlive`(exam-tickets.ts) **하나**를 결제 전(`payments/create`)과 발급 시(`my-attempts`) 양쪽이 쓴다. 한쪽에만 있으면 "결제는 통과, 발급만 거절" 구간이 생겨 곧 환불거리다.
- **정가 미책정 급수(t2 등)는 발급도 막힌다** — 임시 금액으로 때우지 않는다. 열려면 관리자 화면에서 금액만 채우면 된다.
- 402 응답 `error:'cert_fee_required'` 는 **기계 코드**다(같은 핸들러의 `invalid_name_roman` 관례). 프론트가 이걸로 결제 화면 전환을 판단하므로 문구로 바꾸지 말 것.
- 결제 후 복귀: `/pay/success` → `/mypage/attempts?cert=<attemptId>` → 그 응시의 발급 화면 → **결제 전에 입력한 영문 성명으로 자동 발급**. 이름은 `sessionStorage`(`certIssueAttempt/Last/First`)로 넘기고 **꺼내는 즉시 지운다** — 남기면 결제를 취소하고 돌아온 사람이 자동발급 → 402 → 체크아웃 으로 영원히 튕긴다.
- ⚠️ **환불해도 자격증은 자동 회수하지 않는다**(`revokeForRefund` 에 cert 경로 없음 = fulfilled 유지 → 대사 목록에 남아 사람이 판단). 자격번호·QR 은 회수가 안 되는 물건이라 자동화하지 않는다.

---

## 운영에서 자주 막히는 것 (반드시 숙지)

- **프론트는 `master` push → Cloudflare 자동배포**(빌드 수 분 소요). 함수는 **별도 CLI 배포** 필요. git push 로 함수 안 올라감. SPA 라우팅은 `wrangler.jsonc`(`not_found_handling`)로 처리 — `_redirects` 금지(무한루프).
- `_shared` import 하는 함수는 **CLI 로만** 안전 배포(대시보드 웹에디터는 `../_shared` 깨질 수 있음). `recommend-level` 만 단일 파일이라 대시보드 가능.
- **결제 함수 배포**: `npx.cmd supabase functions deploy payments` (플래그 없이) + `npx.cmd supabase functions deploy payments-webhook --no-verify-jwt` (**이 함수만** 예외). 토스 개발자센터 웹훅 URL 은 `https://<ref>.supabase.co/functions/v1/payments-webhook?k=<TOSS_WEBHOOK_SECRET>`.
- **SEB 인계 함수 배포**: `npx.cmd supabase functions deploy seb-handoff` (플래그 없이 — `verify_jwt` 켠 채로 맞다). SEB 안에서도 anon 키가 실려 오므로 공개 예외가 필요 없다. `--no-verify-jwt` 로 올리지 말 것.
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
| [`docs/토스페이먼츠-연동-가드레일.md`](./docs/토스페이먼츠-연동-가드레일.md) | **결제 코드 짜기 전 필독**(토스 공식 LLM Quick Reference 사본) — 흐름 모델·SDK 버전/상품 선택 규칙·시나리오 진입점 + **LLM이 자주 틀리는 패턴 20개**(§8). 더 깊은 내용은 저장소 루트 `.mcp.json` 의 토스 MCP 서버로 문서를 직접 조회할 것 |
| [`docs/review-report.html`](./docs/review-report.html) | 코드 리뷰 리포트(생성물) |

> 새 기능/운영 사항을 추가하면 해당 문서를 갱신하고, 큰 변화는 이 표에 매핑한다.
