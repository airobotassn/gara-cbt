# 엣지 번역 워커

채팅을 미리 번역해 창고(`chat_translations`)를 채운다. **Edge 브라우저의 온디바이스 번역은 공짜에 무제한**이라, **번역하는 건 이 워커뿐이다** — 서버에는 번역 엔진이 없으므로 이게 꺼져 있으면 번역이 안 되고 원문이 남는다.

## 요구사항

- **Microsoft Edge 148 이상 · 데스크톱** (Windows / macOS / Linux)
  - Translator API 는 **모바일에 없다**. 크롬도 되지만 언어가 39개뿐이라 엣지(145개+)를 쓴다
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
| `TRANSLATE_PROFILE_DIR` | `%LOCALAPPDATA%\gara-translate-profile` | ⚠️ **고정 필수** — 바뀌면 언어팩을 매번 다시 받는다. **저장소 안에 두지 말 것**(Vite 감시자가 EBUSY 로 죽는다) |
| `TRANSLATE_TICK_MS` | `1000` | 프론트 재시도가 1.5초부터라 그 안에 채워야 첫 요청자가 바로 본다 |
| `TRANSLATE_BATCH` | `500` | 한 사이클 상한. 밀린 백로그가 클 때를 위한 안전장치 |

`TRANSLATE_WORKER_KEY` 는 Supabase 함수 시크릿에도 같은 값으로 넣어야 한다.
**안 넣으면 워커 경로가 아예 닫힌다**(빈 값으로 열리지 않게 막아뒀다).

```bash
npx.cmd supabase secrets set TRANSLATE_WORKER_KEY=<값>
```

## 돌아가는 방식

```
2초마다 → 서버에 "번역할 것 있나?"(pending)
        → 없으면 그냥 잠   ← 대부분의 사이클이 여기서 끝난다
        → 있으면 브라우저에서 번역 → 서버에 저장(store)
```

**판단은 전부 서버가 한다.** 무엇을 번역할지(`chat_translation_pending` RPC)도, 무엇을 저장할지도 `chat-translate` 함수가 정한다. 워커는 브라우저를 굴리는 손이라 **백엔드를 Spring 으로 옮겨도 이 폴더는 손대지 않는다.**

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

- **첫 실행은 창이 뜬다**(`headless: false`). 언어팩 다운로드가 사용자 동작을 요구해서, Playwright 가 페이지 버튼을 실제로 클릭한다. 이미 받아둔 쌍이면 그 클릭은 그냥 지나간다
- **워커가 꺼져 있으면 새 번역이 안 생긴다.** 이미 창고에 있는 건 계속 보이고, 없는 건 원문으로 남는다(오류는 안 난다)
- **일회성 CI 러너(GitHub Actions 등)에서는 못 돌린다** — 매 실행마다 언어팩을 다시 받는다
- **MS 로 요청이 나가지 않는다**(온디바이스). 언어팩 다운로드만 쌍당 1회. 호출 횟수 제한·과금 없음
- ⚠️ 회색지대다 — 명시적 금지 문구는 없지만 의도된 용법은 아니다. MS 가 게이팅을 걸면 번역이 통째로 멈춘다 — 그때는 서버 번역 엔진(Azure·구글)을 붙여야 한다
