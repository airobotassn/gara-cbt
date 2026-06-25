---
name: report
description: 수정·신규 화면을 시연 없이 건넬 단일 HTML 보고서를 자동 생성한다. Playwright로 화면을 촬영해 이미지를 base64로 내장 → 파일 하나(.claude/skills/report/out/index.html)로 만들어 메신저로 그대로 전송 가능. 화면마다 스크린샷 + 한 줄 설명, 공개 페이지는 라이브(수정 전) vs 로컬(수정 후) 비교도 가능. 사용자가 "보고서 만들어줘", "변경 리포트", "○○ 화면 보고용으로", "수정한 거 보고서로", "report", "before after 비교 만들어줘" 같은 요청을 할 때 사용.
---

# report — 변경 리포트(보고용 단일 HTML) 생성

동료·상사에게 **시연 없이** 수정/신규 화면을 건넬 단일 HTML을 자동 생성한다.
Playwright로 화면을 촬영 → 이미지 base64 내장 → `.claude/skills/report/out/index.html`(파일 하나, 메신저로 그대로 전송). 화면마다 스크린샷 + 한 줄 설명. **단순하게 유지할 것.**

## 폴더 구조 (이 스킬이 자기완결적으로 들고 있다)

```
.claude/skills/report/
  SKILL.md       이 파일(절차)
  config.mjs     URLS · META · SCREENS — 매 호출마다 이번에 보고할 화면으로 교체
  lib.mjs        촬영(shoot) + 가짜 세션·함수 목킹(데이터 화면용)
  template.mjs   단일 HTML 템플릿
  generate.mjs   엔트리 — dev 서버 확인 → 화면별 촬영 → out/index.html
  out/           생성물(gitignore)
```

## 실행 절차

### 1) 이번에 보고할 화면을 추린다
이번 세션에서 바뀌었거나 보여줄 화면을 정한다. 막막하면 `git status` / `git diff`와 대화 맥락으로 무엇이 바뀐 화면인지 파악한다. 각 화면은 아래 필드를 가진다(`config.mjs` 상단 주석 참고):
- 필수: `title`, `desc`(무엇이 바뀌었나 한 줄), `path`(라우트)
- 선택: `lang` · `theme` · `device` · `authed` · `steps`

### 2) `config.mjs` 의 SCREENS 교체
`.claude/skills/report/config.mjs` 의 `SCREENS` 배열을 1)에서 정한 화면들로 **갈아끼운다**. `META.title`/`desc`도 맥락에 맞게 손본다. (config.mjs는 매번 덮어쓰는 작업 파일이다 — diff가 곧 그 보고서의 기록.)

### 3) 데이터 화면이면 목(mock) 확인 — ⚠️ 중요
`authed: true` 화면(결과·대시보드·랭킹 등)은 `lib.mjs` 의 함수 목 응답으로 렌더된다.
**API 응답 형태가 바뀌었으면 `lib.mjs` 의 해당 목도 같이 고칠 것.** 안 그러면 빈 화면이 찍힌다.
(예: `get-result` 에 `perf`/`prevPerf`를 추가했으면 목에도 넣어야 레이더 음영이 보인다.)

### 5) 생성 실행
```bash
node .claude/skills/report/generate.mjs
```
- dev 서버(`localhost:5173`)가 안 떠 있으면 자동으로 `npm run dev`를 띄웠다 끈다.
- 처음 한 번은 Playwright 브라우저가 필요할 수 있다 → 실패 시 `npx playwright install chromium` 후 재실행.
- 윈도우에서 `node`가 실행정책에 막히면 그냥 `node` 경로 그대로 시도(이 스킬은 npm 스크립트가 아니라 node 직접 실행).

### 6) 결과 안내
생성되면 경로를 사용자에게 알려준다: **`.claude/skills/report/out/index.html`** (파일 하나, 더블클릭으로 열거나 메신저로 그대로 전송). 어떤 화면을 몇 장 담았는지 한두 줄로 요약.

## 원칙
- **단순함 유지.** 화면 추가는 SCREENS에 한 줄, 그게 전부여야 한다.
- 없는 성과를 만들지 말 것 — 실제로 바뀐 화면만 담는다.
- 비밀키·실데이터를 목에 넣지 말 것(데모용 가짜 데이터만).
