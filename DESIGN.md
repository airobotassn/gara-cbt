# GARA Precision — 디자인 시스템 가이드

이 문서는 현재 적용된 **GARA Precision**(Stitch 기반) 디자인을 정리한 것이다.
새 페이지를 만들 때 이 규칙·토큰·스니펫을 그대로 따르면 전체와 일관되게 맞는다.

---

## 0. 핵심 원칙 (먼저 읽기)

1. **헤더(상단 GNB) 없음.** 페이지에 `<nav>`/`<header>` 상단바를 만들지 않는다.
   네비게이션은 **좌하단 FAB**(`src/components/Layout.tsx`)이 전담한다. (응시 화면 `/exam/run/*`·SEB 안에서만 FAB 숨김)
2. **푸터는 공통 컴포넌트** `src/components/SiteFooter.tsx` 하나만 쓴다. 페이지마다 푸터를 새로 만들지 않는다.
3. **라이트 테마 + GARA 블루 `#004ac6` 하나**로 통일. (네이비/다른 블루 섞지 말 것)
4. **폰트**: 라틴/숫자 = Hanken Grotesk, 한글 = Pretendard 자동 폴백.
5. **페이지 이동 시 항상 최상단**으로 스크롤됨(`App.tsx`의 `ScrollToTop` 전역 처리 — 신경 안 써도 됨).
6. 텍스트는 가능하면 **i18n**(`useT()`의 `t('key')`)로. 6개국어(ko·en·ja·zh·hi·vi) 다 채울 것.
7. 디자인만 입히고 **로직(응시·채점·SEB·인증·데이터)은 절대 건드리지 않는다.**

---

## 1. 시스템이 사는 곳

| 파일 | 내용 |
|---|---|
| `src/index.css` | **`@theme` 블록**(색·폰트·사이즈·간격 토큰). ⚠️ Tailwind v4는 `@import`된 파일의 `@theme`를 못 읽으니 **반드시 여기(진입 파일)에** 둔다. |
| `src/styles/stitch.css` | 커스텀 유틸 클래스(glass-panel, mesh-gradient, ambient-shadow 등) |
| `src/components/SiteFooter.tsx` | 전 페이지 공통 푸터 |
| `src/components/Layout.tsx` | 전역 FAB(네비) |
| 폰트/아이콘 | `index.html`에서 Hanken Grotesk + Material Symbols + Pretendard 로드 |

스택: React 19 + Vite + **Tailwind CSS v4**(`@import 'tailwindcss'`). 차트 등은 자체 SVG.

---

## 2. 색 토큰 (Tailwind 유틸로 바로 사용)

`bg-<token>` / `text-<token>` / `border-<token>` 형태로 사용. 투명도는 `/10`, `/20` 등.

| 토큰 | 값 | 용도 |
|---|---|---|
| `primary` / `primary-container` | `#004ac6` | **브랜드 블루**(버튼·강조·아이콘). 둘 다 동일값으로 통일 |
| `on-primary` | `#ffffff` | 블루 위 글자 |
| `background` / `surface` | `#faf8ff` | 페이지 배경 |
| `surface-container-lowest` | `#ffffff` | 카드 |
| `surface-container-low` | `#f3f3fd` | 틴트 밴드/보조 표면 |
| `surface-container` / `-high` / `-highest` | `#ededf8`/`#e7e7f2`/`#e2e2ec` | 단계별 표면 |
| `on-surface` | `#191b23` | 본문/제목 |
| `on-surface-variant` | `#434654` | 보조 텍스트 |
| `outline` / `outline-variant` | `#737685` / `#c3c6d6` | 캡션 / 보더 |
| `secondary` | `#00687a` | 보조 액센트(틸) — 합격·완료 등 |
| `tertiary` | `#751f00` | 3차 액센트(러스트) |
| `error` / `error-container` | `#ba1a1a` / `#ffdad6` | 에러·필독·강등 |

> 새 페이지에서 블루는 무조건 `primary` 또는 `primary-container`(둘 다 #004ac6). 임의 hex(`text-[#...]`) 쓰지 말 것.

---

## 3. 타이포그래피

`font-<name>`(패밀리) + `text-<name>`(크기)를 같이 쓴다. 예: `font-display-lg text-display-lg`.

| 이름 | size / line / weight | 용도 |
|---|---|---|
| `display-lg` | 48 / 56 / 700 (−0.02em) | 히어로 대제목, 큰 숫자(점수·스탯) |
| `headline-lg` | 32 / 40 / 600 (−0.01em) | 섹션 제목(데스크톱) |
| `headline-lg-mobile` | 28 / 36 / 600 | 섹션 제목(모바일) |
| `title-md` | 20 / 28 / 600 | 카드 제목 |
| `body-lg` | 18 / 28 / 400 | 리드 문단 |
| `body-md` | 16 / 24 / 400 | 본문 |
| `label-md` | 14 / 20 / 500 (0.01em) | 라벨·버튼·메타 |
| `label-sm` | 12 / 16 / 600 (0.05em) | 아이브로·캡션·태그 |

반응형 제목 패턴: `font-headline-lg-mobile text-headline-lg-mobile md:font-headline-lg md:text-headline-lg`

---

## 4. 간격 토큰

| 토큰 | 값 | 용도 |
|---|---|---|
| `px-margin-mobile` | 20px | 모바일 좌우 여백 |
| `px-margin-desktop` | 40px | 데스크톱 좌우 여백 |
| `max-w-container-max` | 1280px | 콘텐츠 최대폭 |
| `gap-gutter` | 24px | 거터 |
| `base` | 8px | 기본 단위 |

표준 콘텐츠 컨테이너: `px-margin-mobile md:px-margin-desktop max-w-container-max mx-auto`

여백 감각(권장): 섹션 세로 `py-16`, 카드 `p-6`~`p-10`, 히어로 `min-h-[460px]` 정도. (과거 목업의 `py-24`/`p-16`/`600px`는 너무 커서 줄임)

---

## 5. 커스텀 유틸 (`src/styles/stitch.css`)

| 클래스 | 효과 |
|---|---|
| `glass-panel` | 반투명 흰 패널(blur 40, 보더) — 큰 컨테이너 카드 |
| `glass-card` | 가벼운 글래스 카드(blur 12) |
| `mesh-gradient` | 옅은 블루/라벤더 히어로 틴트(평면) |
| `mesh-gradient-bg` | **컬러풀 애니메이션 메시**(코발트 베이스) — 메인/안내 히어로 배경(흰 글자) |
| `mesh-bg` | 코너 옅은 코발트 radial — 잔잔한 페이지 배경 |
| `hero-bg` | 상단 중앙 옅은 블루 radial |
| `ambient-shadow` | 코발트 틴트 앰비언트 그림자(패널·버튼) |
| `ambient-shadow-hover` | 호버 시 리프트(+그림자) |
| `ambient-mesh` | 800px blur 블롭(배경 장식) |
| `scrollbar-hide` | 가로 스크롤바 숨김(칩 줄 등) |

---

## 6. 페이지 골격 (복붙 시작점)

```tsx
import SiteFooter from '../components/SiteFooter'

export default function MyPage() {
  return (
    <div className="bg-background text-on-surface min-h-screen flex flex-col">
      {/* 헤더 없음 — FAB이 네비 */}
      <main className="flex-grow pt-12 pb-24 px-margin-mobile md:px-margin-desktop max-w-container-max mx-auto w-full">
        {/* ... 콘텐츠 ... */}
      </main>
      <SiteFooter />
    </div>
  )
}
```

- 상단 `pt-12`로 시작(헤더가 없으므로 큰 오프셋 불필요).
- 전체 폭 배경 섹션이 필요하면 `<main>` 안에서 `bg-white`/`bg-surface-container-low` 섹션을 `px-... max-w-container-max mx-auto` 내부 래퍼와 함께 쓴다.

---

## 7. 컴포넌트 스니펫

### 버튼
```tsx
{/* Primary */}
<button className="bg-primary-container text-on-primary font-title-md text-title-md px-8 py-3 rounded-xl hover:translate-y-[-2px] transition-transform duration-200 ambient-shadow inline-flex items-center gap-2 font-bold">
  버튼 <span className="material-symbols-outlined">arrow_forward</span>
</button>

{/* Ghost / Outline */}
<button className="bg-white text-on-surface-variant hover:text-primary border border-outline-variant hover:border-primary px-8 py-3 rounded-xl transition-all">버튼</button>
```

### 카드
```tsx
<div className="bg-white rounded-2xl p-6 border border-outline-variant/30 ambient-shadow ambient-shadow-hover transition-all">
  <div className="w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center mb-4">
    <span className="material-symbols-outlined text-primary">school</span>
  </div>
  <h3 className="font-title-md text-title-md text-on-surface mb-2">제목</h3>
  <p className="font-body-md text-body-md text-on-surface-variant">설명</p>
</div>
```

### 태그/배지
```tsx
<span className="px-3 py-1 rounded-full bg-primary/10 text-primary border border-primary/20 font-label-sm text-label-sm uppercase tracking-wider font-bold">공지</span>
{/* 합격/완료 = secondary, 에러/필독 = error 로 색만 교체 */}
```

### 아이브로(섹션 위 작은 라벨)
```tsx
<span className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-primary/10 text-primary font-label-sm text-label-sm uppercase tracking-widest">
  <span className="w-2 h-2 rounded-full bg-primary"></span> 라벨
</span>
```

### 아이콘 (Material Symbols)
```tsx
<span className="material-symbols-outlined">verified</span>
{/* 채움 아이콘: */}
<span className="material-symbols-outlined" style={{ fontVariationSettings: "'FILL' 1" }}>check_circle</span>
```

### 탭 / 아코디언 / OMR 등
- 탭: 활성 `text-primary border-b-[3px] border-primary`, 비활성 `text-outline`.
- 아코디언: `useState`로 열림 토글, 아이콘 `add_circle` ↔ `do_not_disturb_on`.
- 더 복잡한 예시는 기존 페이지 참고: FAQ=`Faq.tsx`, 카드목록=`Notice.tsx`, 스텝=`ExamCheck.tsx`, 스탯=`Guide.tsx`/`ExamGate.tsx`, 결과카드=`ExamResult.tsx`, OMR/응시=`CbtRunner.tsx`.

---

## 8. 페이지 ↔ 경로 ↔ 원본 목업

| 경로 | 페이지 | 원본 |
|---|---|---|
| `/` | Landing (원래 `.lp` 히어로, **건드리지 말 것**) | — |
| `/guide` | 자격검정 안내 | gara_9 |
| `/exam` | 응시 게이트 | gara_4 |
| `/exam/check` | 시험환경 테스트 | gara_3 |
| `/exam/run/:id` | CBT 응시 화면(자체 UI, FAB 숨김) | gara_6 |
| `/exam/result/:id` | 성적 결과 | 자체 디자인(목업 없음) |
| `/notice` | 공지사항 | gara_2 |
| `/faq` | 고객센터 | gara_1 |
| `/mypage` | 마이페이지 | gara_5 |
| `/about` | 협회 소개 | gara_8 |
| `/privacy`·`/terms` | 약관(한국어) | — |

원본 목업 HTML: `C:\Users\User\Desktop\stitch_design_critique_assistant\gara_*/code.html`

---

## 9. 자주 막히는 것 (Gotchas)

- **@theme는 `index.css`에만.** `@import`한 css의 `@theme`는 Tailwind v4가 무시 → 색/폰트가 전부 투명·기본값으로 깨짐.
- 목업이 `text-[#004ac6]` 같은 **임의 hex**를 쓰더라도, 신규 작업은 `primary` 토큰으로 통일.
- 새 페이지에 **헤더/푸터 만들지 말 것** — FAB + `<SiteFooter/>`.
- FAB을 숨겨야 하는 화면(시험 중 등)은 `Layout.tsx`의 `inTest` 조건에 추가.
- Material Symbols 아이콘이 글자로 보이면 `index.html` 폰트 로드 확인.
- 페이지별로 색을 다르게 해야 하면 루트에 `style={{ '--color-primary': '#xxxxxx' } as CSSProperties}` 스코프(현재는 전부 #004ac6라 불필요).

---

## 배포

프론트는 **`master` push → Cloudflare 자동배포**(수 분). 엣지 함수는 별도 CLI 배포. (자세히는 `CLAUDE.md` / `docs/온보딩.html`)
