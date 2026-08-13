# 엣지 번역 워커

채팅을 미리 번역해 창고(`chat_translations`)를 채운다. **Edge 브라우저의 온디바이스 번역은 공짜에 무제한**이라, 이게 돌면 사용자가 번역을 눌러도 창고 히트라 구글 API 가 안 불린다.

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
| `TRANSLATE_PROFILE_DIR` | `tools/translate-worker/.edge-profile` | ⚠️ **고정 필수** — 바뀌면 언어팩을 매번 다시 받는다 |
| `TRANSLATE_TICK_MS` | `2000` | 채팅 폴링이 4초라 그 안에 끝나야 구글 API 를 안 부른다 |
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

## 알아둘 것

- **첫 실행은 창이 뜬다**(`headless: false`). 언어팩 다운로드가 사용자 동작을 요구해서, Playwright 가 페이지 버튼을 실제로 클릭한다. 이미 받아둔 쌍이면 그 클릭은 그냥 지나간다
- **워커가 죽어도 기능은 안 멈춘다.** 창고가 덜 찰 뿐이고 사용자 요청은 서버가 구글 API 로 받는다 → 24시간 켜둘 필요 없다
- **일회성 CI 러너(GitHub Actions 등)에서는 못 돌린다** — 매 실행마다 언어팩을 다시 받는다
- **MS 로 요청이 나가지 않는다**(온디바이스). 언어팩 다운로드만 쌍당 1회. 호출 횟수 제한·과금 없음
- ⚠️ 회색지대다 — 명시적 금지 문구는 없지만 의도된 용법은 아니다. MS 가 게이팅을 걸면 이 경로가 막히므로 **구글 폴백을 지우면 안 된다**
