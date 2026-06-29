# Safe Exam Browser(SEB) 연동 설정

GARA 자격검정을 **보안 브라우저(SEB)** 로만 응시하게 잠그는 설정 절차다.
코드(클라 게이트 + 서버 해시 검증)는 이미 들어가 있고, **배포 후 아래 값만 채우면** 강제된다.

> 핵심: SEB로 시험을 열면 그 PC가 OS 수준에서 잠긴다(캡처·복사·앱전환·녹화 차단). 서버 해시 검증은
> "SEB인 척 위장한 일반 브라우저"를 추가로 걸러내는 보강 장치다. **둘 다 못 막는 건 옆에서 다른 폰으로
> 화면 촬영** — 그건 웹캠 감독(프록터링) 영역.

---

## 동작 흐름
1. 응시자가 SEB를 1회 설치한다.
2. 진입 페이지(`/exam`)에서 "보안 브라우저로 시작"을 누르면 `sebs://.../gara-<lang>.seb` 링크로 **설치된 SEB가 실행**된다.
3. SEB가 `.seb` 설정의 시작 URL(= 우리 시험 페이지)을 잠금 모드로 연다.
4. 시험 화면·서버 함수가 "이 요청이 진짜 SEB에서 왔는지"(헤더 해시)를 검증한다.
5. 제출하면 quitURL(`/exam/done`)로 이동 → SEB 자동 종료.

운영(`import.meta.env.PROD`)에서만 강제되고, 로컬 개발/데모는 자동 우회된다(`src/lib/seb.ts`의 `SEB_REQUIRED`).

---

## `.seb` 가 실제로 잠그는 것 (현재 설정값)
`tools/make-seb-all.mjs` 가 박는 값(실측):
- **종료 잠금**: `allowQuit=true` + `hashedQuitPassword`(감독관용, 기본 `gara-exit-2026`) → 응시자가 임의로 못 끈다. 시험 종료(quitURL=`/exam/done`)만 비번 없이 자동 종료.
- **브라우저 제한**: 새로고침·뒤로/앞으로·환경설정 창 비활성. 주소창 없음.
- **모니터(다중 디스플레이)**: SEB는 실행 시 **연결된 모든 화면을 검게 덮는다** → 보조 모니터는 사용 불가, 시험은 주 모니터에서만 진행. `allowedDisplaysMaxNumber=8`(사실상 무제한)이라 **모니터를 뽑지 않아도** 응시 가능하고 보조 화면은 덮여서 못 쓴다.
  - 2대 이상 연결 시 **아예 차단**(뽑아야 시작)하고 싶으면 생성 시 끝 숫자를 `1`로.
- **VM/유저전환 차단**: `allowVirtualMachine=false`, `allowUserSwitching=false`.
- **BEK 전송**: `sendBrowserExamKey=true` → 매 요청에 `X-SafeExamBrowser-RequestHash` 헤더가 실린다.
- ⚠️ **URL 필터는 꺼짐(`URLFilterEnable=false`)** — 즉 "허용 URL만 여는" 화이트리스트는 **현재 미적용**. 주소창 없음·뒤로가기 차단으로 이동이 제한될 뿐이다. 외부 사이트 접근까지 엄격히 막으려면 `.seb`에 URLFilter 허용 규칙(시험 도메인 + Supabase 함수 도메인)을 추가해야 한다.

---

## 1) `.seb` 생성 (스크립트)
6개 언어 × (실제/연습) 일괄 생성, `public/` 에 출력:
```bash
node tools/make-seb-all.mjs https://<배포도메인> public 8
# 예) node tools/make-seb-all.mjs https://gara-cbt.airobotassn.workers.dev public 8
# 끝 숫자 = 허용 모니터 수 (8 = 무제한/보조화면은 덮임, 1 = 단일 모니터 강제)
```
생성물:
- `public/gara-<lang>.seb` → 시작 URL `/exam?lang=<lang>`
- `public/gara-practice-<lang>.seb` → `/exam/run/practice?lang=<lang>`
- fallback `gara.seb` / `gara-practice.seb` (ko)

> 단일 파일만 필요하면 `tools/make-seb.mjs <startURL> <출력경로> <허용모니터수>`.

## 2) Browser Exam Key(BEK) 확인 (Config Tool)
서버 해시 검증에 넣을 키. [SEB + Config Tool](https://safeexambrowser.org/download_en.html) 설치 후:
- 생성된 `.seb` 를 Config Tool로 **열기** → **Security 탭**의 **Browser Exam Key(64자리 16진수)** 복사.
- ⚠️ BEK는 설정 내용에 따라 정해진다. **언어별 .seb는 시작 URL이 달라 BEK가 다를 수 있으니**, 운영에 쓰는 파일 기준으로 확인하고 **반드시 실제 SEB로 검증**(아래 5번)할 것.

## 3) `.seb` 호스팅
- `public/*.seb` 는 빌드 시 `dist/` 로 복사돼 `https://<배포도메인>/gara-<lang>.seb` 로 서빙된다(추가 작업 없음 — master push → Cloudflare 자동배포).
- 다른 도메인/CDN에 둘 거면 `.env` 의 `VITE_SEB_CONFIG_URL` 지정. 없으면 현재 origin의 `/gara.seb` 사용(`src/lib/seb.ts` 의 `sebConfigUrl()`).

## 4) 서버(시크릿) 켜기
Supabase 함수 시크릿에 키를 넣고 함수 재배포:
```bash
supabase secrets set SEB_REQUIRED=true SEB_BROWSER_EXAM_KEY=<복사한 BEK> --project-ref lditytpxuuojfznwfnep
# (선택) 함수가 보는 URL이 어긋나면 정확한 함수 URL 지정:
# supabase secrets set SEB_EXAM_URL=https://lditytpxuuojfznwfnep.supabase.co/functions/v1/start-exam
supabase functions deploy start-exam submit-exam --project-ref lditytpxuuojfznwfnep
```
- 키가 **설정되기 전까지는 서버 검증을 건너뛴다**(응시자 잠금 방지). 키를 넣는 순간부터 강제.
- ⚠️ `.seb` 를 바꿔 재생성하면 **BEK가 바뀐다** → 시크릿도 새 BEK로 갱신해야 검증이 안 깨진다.

## 5) 테스트(반드시 실제 SEB로)
- ✅ SEB로 `gara.seb` 실행 → 로그인 → 시험 시작 → `start-exam` 200(정상 출제)
- ✅ 일반 브라우저로 `/exam/run/...` 직접 접근 → "보안 브라우저로 응시하세요" 차단 + 서버 403
- ⚠️ SEB인데도 `start-exam` 이 403이면: 함수가 보는 `req.url` 이 SEB가 해시한 URL과 달라서임.
  - `SEB_EXAM_URL` 을 실제 함수 URL로 지정해 후보에 추가하거나,
  - 급하면 `SEB_BROWSER_EXAM_KEY` 를 잠시 비워 **클라 게이트만**으로 운영(그래도 SEB로 열어야 하므로 OS 잠금은 유지됨).

---

## 참고
- 헤더 해시 스펙: `X-SafeExamBrowser-RequestHash = SHA256(요청URL + BrowserExamKey)` (소문자 16진수). 서버 구현: `supabase/functions/_shared/seb.ts`.
- `.seb` 생성기: `tools/make-seb-all.mjs`(언어별 일괄) · `tools/make-seb.mjs`(단일).
- 클라 판별/실행 링크: `src/lib/seb.ts`, 안내 화면: `src/components/SebRequired.tsx`.
- SEB는 Windows/macOS/iPad 지원. 응시자 OS에 맞는 버전 안내 필요.
