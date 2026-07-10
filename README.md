# AI 활용능력 SEMI-CARIS

"당신의 AI 활용능력은 어느 정도인가요?" — 20문항으로 6개 영역의 AI 활용능력을 측정하고 롤 스타일 티어를 부여하는 사이트.

- 비로그인도 응시 가능 → **총점만** 노출
- 구글 로그인 시 **티어 · 영역별 레이더 분석 · 오답노트** 잠금 해제 (비로그인 결과 그대로 유지)
- 3일 1회 응시 제한, 서버 단일지점 잠금(잠금 데이터는 클라가 받지 못함)

## 기술 스택
- React + Vite + TypeScript + Tailwind CSS v4 (차트는 자체 SVG)
- Supabase (Postgres / Auth: 구글+익명 / Edge Functions)
- Google Gemini 임베딩 (`gemini-embedding-001`) — 레벨 추천 전용
- 배포: **Cloudflare** (Workers 정적자산, GitHub `master` 자동배포) · 함수는 Supabase CLI

> 작업 시작 전 **[`CLAUDE.md`](./CLAUDE.md)**(중심 가이드 + 문서 맵)와 **`docs/온보딩.html`**(셋업·개발·배포 단일 진입점)을 먼저 볼 것.

## 시작하기
1. **셋업**: [`SETUP.md`](./SETUP.md) 를 따라 Supabase·구글 로그인·Edge Functions 구성
2. **기획안**: [`docs/기획안.md`](./docs/기획안.md) · **온보딩(셋업~배포)**: `docs/온보딩.html`
3. 개발 서버:
   ```powershell
   npm install
   npm run dev
   ```

## 구조
```
src/
  lib/         supabase 클라이언트, 타입, 티어·카테고리·설정 (공유 규칙)
  context/     AuthProvider (익명/구글/claim 이관)
  hooks/       useAntiCheat (1층 복사차단 + 2층 이탈감지)
  components/  Layout, TierEmblem, RadarChartBox
  pages/       Landing, LevelSelect, TestRunner, Result, Ranking, Dashboard, AuthCallback
supabase/
  schema.sql   테이블 + RLS (잠금 테이블은 service role 전용)
  seed.sql     샘플 문제 168개 (교체 필요)
  functions/   start-test · submit-test · get-result · list-attempts · recommend-level
```

## 보안 모델 (요약)
- `questions.correct_index` · `test_attempts` · `attempt_answers` 는 **클라 직접 SELECT 불가** (RLS에 정책 미부여 = service role 전용)
- 출제·채점·결과 서빙은 **Edge Function 에서만**. 익명 유저에겐 총점 외 데이터를 **응답에서 제외**
- 자세한 설계는 `docs/기획안.md` 참조
