# Safe Exam Browser(SEB) 연동 설정

GARA 자격검정을 **보안 브라우저(SEB)** 로만 응시하게 잠그는 설정 절차다.
코드(클라 게이트 + 서버 해시 검증)는 이미 들어가 있고, **배포 후 아래 값만 채우면** 강제된다.

> 핵심: SEB로 시험을 열면 그 PC가 OS 수준에서 잠긴다(캡처·복사·앱전환·녹화 차단). 서버 해시 검증은
> "SEB인 척 위장한 일반 브라우저"를 추가로 걸러내는 보강 장치다. **둘 다 못 막는 건 옆에서 다른 폰으로
> 화면 촬영** — 그건 웹캠 감독(프록터링) 영역.

---

## 동작 흐름
1. 응시자가 SEB를 1회 설치한다.
2. 진입 페이지(`/exam`)에서 "보안 브라우저로 시작"을 누르면 `sebs://.../gara.seb` 링크로 **설치된 SEB가 실행**된다.
3. SEB가 `.seb` 설정의 시작 URL(= 우리 시험 페이지)을 잠금 모드로 연다.
4. 시험 화면·서버 함수가 "이 요청이 진짜 SEB에서 왔는지"(헤더 해시)를 검증한다.

운영(`import.meta.env.PROD`)에서만 강제되고, 로컬 개발/데모는 자동 우회된다(`src/lib/seb.ts`의 `SEB_REQUIRED`).

---

## 1) SEB Config Tool로 `.seb` 만들기 (Windows)
- 다운로드: https://safeexambrowser.org/download_en.html (SEB + Config Tool)
- **General → Start URL**: `https://<배포도메인>/exam`  (예: `https://gara-cbt.xxx.workers.dev/exam`)
- **Config File**: "Settings for starting an exam" 선택, (선택) Quit/Settings 비밀번호 설정
- **Security → Browser Exam Key / Config Key**
  - "Send Browser Exam Key and Config Key in HTTP header" 체크 → 매 요청에 `X-SafeExamBrowser-RequestHash` 헤더가 실린다.
  - 표시되는 **Browser Exam Key(64자리 16진수)** 를 복사해 둔다. (서버 시크릿에 넣음)
- **Network → URL Filter**: 우리 도메인과 **Supabase 함수 도메인**을 허용 목록에 추가.
  - `https://<배포도메인>/*`
  - `https://lditytpxuuojfznwfnep.supabase.co/*`  ← 함수 AJAX가 막히지 않게(+ 헤더가 함수까지 가게)
- 내보내기: **File → Save Settings As → `gara.seb`**

## 2) `.seb` 호스팅
- `gara.seb` 를 프로젝트 `public/` 에 넣으면 배포 시 `https://<배포도메인>/gara.seb` 로 서빙된다.
- `src/lib/seb.ts` 의 `SEB_CONFIG_URL` 을 그 주소로 교체.

## 3) 서버(시크릿) 켜기
Supabase 함수 시크릿에 키를 넣고 함수 재배포:
```bash
supabase secrets set SEB_REQUIRED=true SEB_BROWSER_EXAM_KEY=<복사한 Browser Exam Key> --project-ref lditytpxuuojfznwfnep
# (선택) 함수가 보는 URL이 어긋나면 정확한 함수 URL 지정:
# supabase secrets set SEB_EXAM_URL=https://lditytpxuuojfznwfnep.supabase.co/functions/v1/start-exam
supabase functions deploy start-exam submit-exam --project-ref lditytpxuuojfznwfnep
```
- 키가 **설정되기 전까지는 서버 검증을 건너뛴다**(응시자 잠금 방지). 키를 넣는 순간부터 강제.

## 4) 테스트(반드시 실제 SEB로)
- ✅ SEB로 `gara.seb` 실행 → 로그인 → 시험 시작 → `start-exam` 200(정상 출제)
- ✅ 일반 브라우저로 `/exam/run/...` 직접 접근 → "보안 브라우저로 응시하세요" 차단 + 서버 403
- ⚠️ SEB인데도 `start-exam` 이 403이면: 함수가 보는 `req.url` 이 SEB가 해시한 URL과 달라서임.
  - `SEB_EXAM_URL` 을 실제 함수 URL로 지정해 후보에 추가하거나,
  - 급하면 `SEB_BROWSER_EXAM_KEY` 를 잠시 비워 **클라 게이트만**으로 운영(그래도 SEB로 열어야 하므로 OS 잠금은 유지됨).

---

## 참고
- 헤더 해시 스펙: `X-SafeExamBrowser-RequestHash = SHA256(요청URL + BrowserExamKey)` (소문자 16진수). 서버 구현: `supabase/functions/_shared/seb.ts`.
- 클라 판별/실행 링크: `src/lib/seb.ts`, 안내 화면: `src/components/SebRequired.tsx`.
- SEB는 Windows/macOS/iPad 지원. 응시자 OS에 맞는 버전 안내 필요.
