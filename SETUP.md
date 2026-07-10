# 셋업 가이드 (Supabase + 구글 로그인 + Edge Functions)

처음 1회만 하면 됩니다. 순서대로 진행하세요.

## 1. Supabase 프로젝트 만들기
1. https://supabase.com 가입 → **New project** (Region: `Northeast Asia (Seoul)` 추천)
2. 프로젝트가 생성되면 **Project Settings → API** 에서 아래 3개를 메모:
   - **Project URL**
   - **anon public** key
   - **service_role** key (비밀 — 어디에도 붙여넣지 말 것, 자동 주입됨)

## 2. 프론트 환경변수 채우기
프로젝트 루트의 `.env.local` 을 열고 1번의 값 입력:
```
VITE_SUPABASE_URL=https://<프로젝트ref>.supabase.co
VITE_SUPABASE_ANON_KEY=<anon public key>
```

## 3. DB 스키마 + 시드 적용
Supabase 대시보드 → **SQL Editor** 에서:
1. `supabase/schema.sql` 전체 복사 → 붙여넣기 → **Run**
2. `supabase/seed.sql` 전체 복사 → 붙여넣기 → **Run** (샘플 문제 168개 — 나중에 실제 문항으로 교체)

## 4. 익명 로그인 + 구글 로그인 켜기
**Authentication → Providers**
- **Anonymous** → Enable (비로그인 응시에 필수)
- **Google** → Enable
  - Google provider 화면에 표시된 **Callback URL**(`https://<ref>.supabase.co/auth/v1/callback`)을 복사
  - https://console.cloud.google.com → 프로젝트 생성 → **OAuth 동의 화면**(External) 구성
  - **사용자 인증 정보 → OAuth 클라이언트 ID → 웹 애플리케이션** 생성
    - 승인된 리디렉션 URI 에 위 Callback URL 붙여넣기
  - 발급된 **Client ID / Client Secret** 을 Supabase Google provider 에 입력 → Save

**Authentication → URL Configuration**
- Site URL: `http://localhost:5173`
- Redirect URLs 에 추가: `http://localhost:5173/**`
- (배포 후) Netlify 도메인(`https://gara-home.netlify.app`)도 Site URL 로 두고 `…/**` 를 Redirect URLs 에 추가

## 5. Edge Functions 배포
Supabase CLI 필요. (PATH 갱신 위해 새 터미널 권장)
```powershell
# CLI 설치 (스코프 패키지)
npm i -g supabase

# 로그인 (브라우저 열림)
supabase login

# 프로젝트 연결 (<ref> = Project URL 의 서브도메인)
supabase link --project-ref <ref>

# 함수 5종 배포
supabase functions deploy start-test
supabase functions deploy submit-test
supabase functions deploy get-result
supabase functions deploy list-attempts
supabase functions deploy recommend-level

# 레벨 추천(recommend-level)용 Gemini 키를 함수 시크릿으로 등록
#   키 발급: https://aistudio.google.com/apikey
supabase secrets set GEMINI_API_KEY=<your-gemini-api-key>
```
> service_role / URL / anon key 는 함수 런타임에 **자동 주입**되므로 따로 설정하지 않습니다.
> 윈도우 PowerShell 에서 `supabase` 가 안 잡히면 `npx.cmd supabase ...` 로 실행하세요. (자세히는 [`docs/운영_배포_가이드.md`](./docs/운영_배포_가이드.md))

## 6. 로컬 실행
```powershell
npm run dev
```
http://localhost:5173 접속 → SEMI-CARIS 진행.

## 검증 체크
- 비로그인 응시 → 결과창 **총점만** 노출, 티어/레이더/해설 잠김
- 결과창에서 구글 로그인 → **같은 결과로 잠금 해제 + 유지**
- 3일 내 재응시 거부 / 익명 farming 이관 거부
- 개발자도구 콘솔에서 `test_attempts` 직접 쿼리 시 0행(서버 잠금 확인)
