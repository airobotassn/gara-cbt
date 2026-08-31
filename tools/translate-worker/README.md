# 엣지 번역 워커

채팅을 미리 번역해 창고(`chat_translations`)를 채운다. **Edge 브라우저의 온디바이스 번역은 공짜에 무제한**이라, **번역하는 건 이 워커뿐이다** — 서버에는 번역 엔진이 없으므로 이게 꺼져 있으면 번역이 안 되고 원문이 남는다.

## 요구사항

- **Microsoft Edge Dev 채널 · 데스크톱** (Windows / macOS / Linux)
  - Translator API 는 **모바일에 없다**. 크롬도 되지만 언어가 39개뿐이라 엣지(145개+)를 쓴다
  - ⛔ **Edge Stable 을 쓰지 말 것(2026-08-27).** 151 에서 번역 엔진(`Chrome TranslateKit` 컴포넌트)을
    **자기 서버가 거절한다** — 내부 로그에 `MakePipeline result.status: error-invalidAppId`. 그 결과
    `availability()` 는 계속 `downloadable`("받으면 된다")이라고 답하는데 `create()` 는 요청을 보내지도
    않고 **오류 없이 영원히 매달린다.** 8/21~8/27 엿새 동안 번역이 0건이었는데 오류가 안 나서 아무도 몰랐다.
    · 배제한 것: 실행 인자·headless·프로필·정책·IPv6·기능 플래그·컴포넌트 서버 교체·엔진 파일 직접 복사 — 전부 무효
    · **Edge Dev(153)·크롬에서는 같은 코드가 즉시 동작한다.** MS 가 고쳐야 하는 회귀다
    · 8/21 까지 멀쩡했던 건 **옛 버전에서 이미 받아둔 엔진**이 프로필에 남아 있었기 때문이다.
      8/24 업데이트가 그걸 무효화하면서 처음으로 다운로드가 필요해졌고, 거기서 드러났다
  - ⚠️ Stable 이 고쳐지면 `TRANSLATE_CHANNEL=msedge` 로 되돌리면 된다. **되돌리기 전에 반드시
    부팅 로그의 `모델 확보` 줄을 확인할 것** — 안 되면 워커가 다시 조용히 헛돈다
  - 파이어폭스·사파리·브레이브·웨일·삼성인터넷에는 없다(구글 내부 코드 의존이라 크로미움 포크도 안 된다)
- Node 18+ (`@playwright/test` 는 이미 devDependency)
- 메모리 1GB 여유 · 디스크 수 GB(언어팩은 **쌍(pair)마다** 받는다)

## 실행

```bash
SUPABASE_URL=https://<ref>.supabase.co \
SUPABASE_ANON_KEY=<anon key> \
TRANSLATE_WORKER_KEY=<함수 시크릿과 같은 값> \
node tools/translate-worker/worker.mjs
```

| 환경변수 | 기본값 | |
|---|---|---|
| `TRANSLATE_CHANNEL` | `msedge` | 번역할 브라우저. **설치 스크립트는 `msedge-dev` 를 박는다**(위 ⛔ 참고). 값은 Playwright 채널 이름 — `msedge` · `msedge-dev` · `msedge-beta` · `chrome` |
| `TRANSLATE_PROFILE_DIR` | `%LOCALAPPDATA%\gara-translate-profile[-채널]` | ⚠️ **고정 필수** — 바뀌면 언어팩을 매번 다시 받는다. **저장소 안에 두지 말 것**(Vite 감시자가 EBUSY 로 죽는다). 채널마다 따로 쓴다 |
| `TRANSLATE_DEBUG` | (없음) | `1` 이면 브라우저 내부 로그를 프로필의 `chrome_debug.log` 에 남긴다. 번역기가 안 받아질 때 **여기서만** 이유가 보인다 |
| `TRANSLATE_TICK_MS` | `1000` | 프론트 재시도가 1.5초부터라 그 안에 채워야 첫 요청자가 바로 본다 |
| `TRANSLATE_BATCH` | `500` | 한 사이클 상한. 밀린 백로그가 클 때를 위한 안전장치 |
| `TRANSLATE_HEADED` | (없음) | `1` 이면 브라우저 창을 띄운다. 기본은 headless — 서버에서 화면 없이 돌아야 하기 때문 |

`TRANSLATE_WORKER_KEY` 는 Supabase 함수 시크릿에도 같은 값으로 넣어야 한다.
**안 넣으면 워커 경로가 아예 닫힌다**(빈 값으로 열리지 않게 막아뒀다).

```bash
npx.cmd supabase secrets set TRANSLATE_WORKER_KEY=<값>
```

## 돌아가는 방식

```
1초마다 → 서버에 "번역할 것 있나?"(pending)
        → 없으면 그냥 잠   ← 대부분의 사이클이 여기서 끝난다
        → 있으면 브라우저에서 번역 → 서버에 저장(store)
```

**판단은 전부 서버가 한다.** 무엇을 번역할지(`chat_translation_pending` RPC)도, 무엇을 저장할지도 `chat-translate` 함수가 정한다. 워커는 브라우저를 굴리는 손이라 **백엔드를 Spring 으로 옮겨도 이 폴더는 손대지 않는다.**

## 서버에서 자동으로 띄우기

**사람이 브라우저를 켜지 않는다.** 부팅 시 이 프로세스만 뜨면 되고, Edge 는 코드가 띄운다.
headless 로 도니 로그인 세션도 화면도 필요 없다(실측 확인).

**윈도우** — 작업 스케줄러에 등록
```powershell
cd tools	ranslate-worker
.install-windows.ps1 -SupabaseUrl https://xxx.supabase.co -AnonKey eyJ... -WorkerKey gara-worker-...
Start-ScheduledTask -TaskName GaraTranslateWorker
```

**리눅스(Spring 서버)** — systemd. 절차는 `gara-translate-worker.service` 파일 머리 주석에 있다.

**창은 안 뜬다**(headless). 돌고 있는지 보려면 로그를 본다:

```powershell
Get-Content $env:LOCALAPPDATAgara-translate-workerworker.log -Tail 20 -Wait
```

### ⚠️ 죽었을 때가 설계의 절반이다

워커는 **브라우저가 죽으면 스스로 종료한다.** 살아있는 척 헛도는 게 죽는 것보다 나쁘기 때문이다
— 감시자가 "돌고 있네" 하고 안 건드린다. 종료하면 감시자(작업 스케줄러 / `Restart=always`)가
새로 띄운다. 이 둘이 한 쌍이라 **감시자 없이 워커만 돌리면 복구가 없다.**

## 부팅할 때 진짜로 한 줄 번역해 본다 (2026-08-27)

모델이 `available` 이 아니면 워커가 **시작하기 전에 실제로 번역을 시도한다.** 여기서 못 하면 앞으로도 못 한다.

```
[worker] msedge-dev · 모델 가용성 — 감지기 downloadable / 번역기(en>ko) downloadable
[worker] 모델이 아직 없습니다. 실제로 받아지는지 확인합니다(최대 90초)…
[worker] 모델 확보 — 시험 번역 "안녕하세요"          ← 정상
```
```
[worker] ⛔ 이 브라우저(msedge)는 번역기를 받지 못합니다: 시간 초과
[worker] ⛔ 이대로 두면 번역이 한 건도 안 되면서 오류도 안 납니다.
```

⛔ **가용성 값만 믿으면 안 된다.** Edge Stable 은 모델이 하나도 없는 상태에서도 `downloadable`
(= 받을 수 있다)이라고 답하고, 정작 부르면 요청도 안 보내고 매달린다. 그 상태로 두면 워커는
3분 타임아웃만 반복하며 **살아있는 척** 헛돈다 — 엿새를 그렇게 흘린 적이 있다(위 ⛔ 참고).

`TRANSLATE_STRICT=1` 이면 이때 프로세스를 끝낸다(감시자가 계속 되살리며 로그를 남기게 하려면).

## ⚠️ 조용히 헛도는 함정 (2026-08-13 실측)

로그에 **"저장할 것 없음"** 만 반복되면 **번역 모델이 없는 것**이다. 오류가 안 나서 알아채기 어렵다.

원인은 **Playwright 가 브라우저에 기본으로 넣는 인자 두 개**다.

| 인자 | 막는 것 |
|---|---|
| `--disable-component-update` | **번역 모델 자체**(모델을 배달하는 게 컴포넌트 업데이터다) ← 진짜 범인 |
| `--disable-features=…,Translate,OptimizationHints,…` | 언어 감지기 |

둘 다 `ignoreDefaultArgs` 로 빼야 한다(worker.mjs 에 반영됨). 부팅할 때 가용성을 찍으니 **첫 줄을 보면 된다**:

```
[worker] 모델 가용성 — 감지기 downloadable / 번역기(en>ko) available   ← 정상
[worker] 모델 가용성 — 감지기 downloadable / 번역기(en>ko) unavailable ← 막힘
```

Playwright 버전이 올라가면 저 인자 문자열이 바뀔 수 있고, 그러면 **말없이 다시 막힌다.**

## 알아둘 것

- **기본이 headless 다.** 언어팩 다운로드가 사용자 동작을 요구하지만 Playwright 의 클릭이 그 조건을 채운다(headless 에서도 통과). 눈으로 보려면 `TRANSLATE_HEADED=1`
- **워커가 꺼져 있으면 새 번역이 안 생긴다.** 이미 창고에 있는 건 계속 보이고, 없는 건 원문으로 남는다(오류는 안 난다)
- **일회성 CI 러너(GitHub Actions 등)에서는 못 돌린다** — 매 실행마다 언어팩을 다시 받는다
- **MS 로 요청이 나가지 않는다**(온디바이스). 언어팩 다운로드만 쌍당 1회. 호출 횟수 제한·과금 없음
- ⚠️ 회색지대다 — 명시적 금지 문구는 없지만 의도된 용법은 아니다. MS 가 게이팅을 걸면 번역이 통째로 멈춘다 — 그때는 서버 번역 엔진(Azure·구글)을 붙여야 한다
