// 러닝 라이브러리의 **뼈대와 항목 줄** — 스토어(/ebooks)와 서재(/mypage/ebooks)가 이걸 같이 쓴다.
//
// 왜 뺐나(2026-08-25): 마이페이지 서재를 "러닝 라이브러리와 똑같은 형태"로 바꾸라는 요청이 왔는데,
//   3열 뼈대·표지 줄·강의 줄을 화면마다 따로 쓰면 **같은 화면이 두 벌**이 되어 한쪽만 고쳐진다
//   (열 배경색·표지 폭 51%·좁은 화면 탭처럼 이유가 붙은 값이 특히 그렇다).
//   두 화면의 차이는 **데이터와 버튼**뿐이다: 스토어는 파는 목록 + 구매, 서재는 산 목록 + 열기.
//
// ⚠️ 여기 있는 값들은 취향이 아니라 역산·반려 이력이 붙은 값이다. 고치기 전에 CLAUDE.md 의
//    '/ebooks = 러닝 라이브러리' 절을 먼저 읽을 것(표지 51%·열 배경·잔글씨 금지·h-[] 고정 금지).
import { Fragment, useCallback, useEffect, useRef, useState } from 'react'
import EbookCover from './EbookCover'
import { usdc } from '../lib/money'
import { ytEmbed } from '../lib/lectures'
import { useT } from '../lib/i18n'
import type { TFunc, Lang } from '../lib/i18n'
import type { EbookRow, ServerLecture } from '../lib/types'

/** 왼쪽 열 한 칸 — 레벨(1~7·무관) 또는 급수(Beginner~Zenith·무관). 두 카탈로그가 같은 모양을 쓴다. */
export interface LibGroup {
  key: string // 레벨은 '1'~'7', 급수는 티어 key. 'any' = 그 카탈로그의 '무관' 자리
  label: string // 왼쪽 열 · 좁은 화면 설명줄에 쓰는 이름
  short: string // 좁은 화면 가로 칩(폭이 좁아 짧게)
  desc: string
  color: string
  /** 칸 오른쪽 배지(전체구매의 -10% 같은 것). 없으면 안 그린다. */
  badge?: React.ReactNode
  /** 이 칸 **아래**에 구분선을 긋는다 — 사다리에 안 서는 특별 칸(전체구매)을 떼어 놓는 용도. */
  divider?: boolean
}

/** 가운데·오른쪽 열 하나. */
export interface LibPane {
  key: string
  title: string
  body: React.ReactNode
  /** 꼬리말 왼쪽 안내문. 없으면 안 그린다. */
  foot?: string
  /** 꼬리말 오른쪽 페이지 넘김. ⚠️ 넘길 게 없으면 **undefined 를 넘길 것** — null 을 반환하는
   *  엘리먼트를 줘도 객체 자체는 truthy 라 빈 띠만 남는다. */
  pager?: React.ReactNode
  /** 본문 **밖**에 고정으로 붙는 띠(전체구매 요약). 넓은 화면은 아래, 좁은 화면은 위에 붙는다 —
   *  좁은 화면에서 아래에 두면 떠 있는 FAB(왼쪽 아래)가 버튼을 덮는다(2026-08-19 실제로 가려졌다). */
  bar?: (edge: 'top' | 'bottom') => React.ReactNode
}

/** 교재 표지 폭(열 본문 폭 대비). 강의 썸네일은 이 값을 쓰지 않는다 — 영상은 가로가 긴 물건이라
 *  열 폭을 꽉 채우고 제목을 그 밑에 둔다(2026-08-11 지시).
 *  ⚠️ 51% 는 **줄 높이를 강의 줄과 맞추려고 역산한 값**이다(표지 A4 → 폭×1.414 + 패딩 32 ≒ 썸네일 16:9 + 제목·채널).
 *     줄여 놓으면 교재 줄이 짧아 박스 아래가 100px 씩 텅 빈다(실제로 그렇게 만들었다가 지적받음).
 *     ⚠️ max-w 를 걸지 말 것 — 열이 넓어질 때 표지만 안 커져 다시 어긋난다. */
const MEDIA_W = 'w-[51%] shrink-0 self-start'

// ══════════════════════════════════════════════════════════════
// 뼈대
// ══════════════════════════════════════════════════════════════

/**
 * 3열(레벨 | 가운데 | 오른쪽) + 좁은 화면(가로 칩 + 탭) 뼈대.
 *
 * ⚠️ 열 높이를 h-[...] 로 못박지 말 것. 레벨당 교재가 1권이라 화면 높이로 고정하면 한 줄 밑으로
 *    수백 px 가 텅 빈 검은 상자가 된다(2026-08-06 그렇게 만들었다가 반려).
 * ⚠️ 세 열은 **서로 높이를 맞춘다**(items-stretch 기본). 기준은 화면 높이가 아니라 **제일 긴 열의 내용**이고,
 *    그게 maxH 를 넘을 때만 각 열이 자기 안에서 스크롤한다.
 */
export function LibraryFrame({
  groups, activeKey, onPick, colTitle, panes, pane, onPane, wideMaxH, narrowMaxH,
}: {
  groups: LibGroup[]
  activeKey?: string
  onPick: (g: LibGroup) => void
  colTitle: string
  /** [가운데, 오른쪽] 두 열. 좁은 화면에서는 이 둘이 탭이 된다. */
  panes: [LibPane, LibPane]
  pane: string
  onPane: (k: string) => void
  /** ⚠️ 위에 뭘 더 얹으면 이 값도 다시 잴 것 — 화면마다 머리말 높이가 달라 호출부가 준다. */
  wideMaxH: string
  narrowMaxH: string
}) {
  const active = groups.find((g) => g.key === activeKey) ?? groups[0]
  const shown = panes.find((p) => p.key === pane) ?? panes[0]

  return (
    <>
      {/* ── 넓은 화면: 레벨 | 가운데 | 오른쪽 3열.
          ⚠️ max-h 는 **두 열을 묶은 겹에도 같이** 걸린다([&>*]) — 안 걸면 그 겹만 화면 밖으로 자란다.
          ⚠️ 짧은 열은 아래가 빈다(items-stretch). 그게 싫으면 items-start 로 되돌리면 되고,
             그러면 레벨 열만 따로 논다(2026-08-21 요청으로 지금 형태가 됐다). */}
      <div className="hidden lg:flex gap-4 [&>*]:max-h-[var(--lib-max)]" style={{ ['--lib-max' as string]: wideMaxH }}>
          <Pane title={colTitle} className="w-[276px] shrink-0">
            <ul className="p-2.5">
              {groups.map((g) => {
                const on = g.key === active?.key
                return (
                  <Fragment key={g.key}>
                    <li>
                      <button
                        type="button"
                        onClick={() => onPick(g)}
                        aria-current={on ? 'true' : undefined}
                        /* 선택 표시 = 액센트 링. 면 밝기 한 단만으로는 지금 무엇을 보고 있는지 안 보였다. */
                        className={`w-full flex items-center gap-3 rounded-xl px-3.5 py-3 text-left transition ${on ? 'bg-surface-container-lowest text-on-surface shadow-[inset_0_0_0_1.5px_var(--color-primary)]' : 'text-on-surface-variant hover:bg-surface-container hover:text-on-surface'}`}
                      >
                        <span className="h-3 w-3 shrink-0 rounded-full" style={{ background: g.color, opacity: on ? 1 : 0.42 }} />
                        <span className={`min-w-0 flex-1 truncate font-title-md text-[17px] ${on ? 'font-bold' : 'font-semibold'}`}>{g.label}</span>
                        {g.badge}
                      </button>
                    </li>
                    {g.divider && <li aria-hidden className="mx-3 my-2 h-px bg-outline-variant/60" />}
                  </Fragment>
                )
              })}
            </ul>
          </Pane>

          {/* 가운데·오른쪽을 묶는 겹. 이 겹의 높이 = 둘 중 긴 쪽이고, 두 열이 그 높이로 함께 선다.
              ⚠️ 화면 높이에 맞춰 늘리는 게 아니다(그건 2026-08-06 반려됐다) — **긴 쪽 내용만큼**이다. */}
          <div className="flex min-w-0 flex-1 gap-4">
            {panes.map((p) => (
              <Pane key={p.key} title={p.title} className="flex-1 min-w-0" foot={p.foot} pager={p.pager} bar={p.bar?.('bottom')}>
                {p.body}
              </Pane>
            ))}
          </div>
      </div>

      {/* ── 좁은 화면: 레벨은 가로 칩, 두 열은 탭 하나로 접는다. */}
      <div className="lg:hidden">
        <GroupStrip groups={groups} activeKey={active?.key} onPick={onPick} />

        {active && (
          <p className="mb-3 px-1 font-body-md text-[16px] leading-[24px] text-on-surface-variant break-keep">
            <b className="text-on-surface">{active.label}</b> — {active.desc}
          </p>
        )}

        {/* 여기도 h-[...] 고정 금지 — 위 3열과 같은 이유(항목 1개일 때 빈 검은 상자가 된다). */}
        <div
          className="flex flex-col max-h-[var(--lib-max)] rounded-2xl border border-outline-variant bg-surface-container-low ambient-shadow overflow-hidden"
          style={{ ['--lib-max' as string]: narrowMaxH }}
        >
          <div className="flex shrink-0 border-b border-outline-variant/70">
            {panes.map((p) => (
              <button
                key={p.key}
                type="button"
                onClick={() => onPane(p.key)}
                className={`flex-1 px-4 py-3.5 font-title-md text-[17px] transition-colors ${shown.key === p.key ? 'text-on-surface font-bold border-b-2 border-primary' : 'text-on-surface-variant'}`}
              >
                {p.title}
              </button>
            ))}
          </div>
          {shown.bar?.('top')}
          <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain">{shown.body}</div>
          {/* 꼬리말 = 안내문 + 지금 보고 있는 탭의 페이지 넘김. 둘 다 없으면 띠 자체를 안 그린다. */}
          {(shown.foot || shown.pager) && (
            <div className="shrink-0 flex items-center justify-between gap-3 border-t border-outline-variant/70 px-4 py-2">
              <p className="min-w-0 font-body-md text-[14px] text-outline">{shown.foot ?? ''}</p>
              {shown.pager}
            </div>
          )}
        </div>
      </div>
    </>
  )
}

/** 좁은 화면의 레벨·급수 가로 칩 줄.
 *
 *  ⚠️ 양끝의 ‹ › 는 **장식이 아니라 유일한 안내다**(2026-09-03 지적). 그냥 가로 스크롤만 두면
 *     화면에 잘린 칸이 안 보이는 각도에서는 옆에 더 있다는 사실 자체가 드러나지 않아,
 *     폰으로 들어온 사람은 Lv.1~2 만 있는 줄 안다. 눌러서도 옮길 수 있어야 한다.
 *  ⚠️ 세로 목록으로 펴지 않는 이유 = 8칸이 화면 절반을 먹어 교재·강의가 아래로 밀려난다.
 *  ⚠️ 끝에 닿으면 그 방향 버튼을 죽인다(자리는 남긴다) — 없앴다 만들었다 하면 칩 줄 폭이 흔들려
 *     누르려던 칩이 손가락 밑에서 움직인다. */
function GroupStrip({
  groups, activeKey, onPick,
}: {
  groups: LibGroup[]
  activeKey?: string
  onPick: (g: LibGroup) => void
}) {
  const { t } = useT()
  const ref = useRef<HTMLDivElement>(null)
  const [edge, setEdge] = useState({ l: false, r: false })

  const readEdge = useCallback(() => {
    const el = ref.current
    if (!el) return
    const max = el.scrollWidth - el.clientWidth
    // 1px 여유 — 소수점 폭에서 scrollLeft 가 max 에 정확히 안 닿아 오른쪽 버튼이 영영 살아 있다.
    setEdge({ l: el.scrollLeft > 1, r: el.scrollLeft < max - 1 })
  }, [])

  // 칸 목록(카탈로그 전환)·화면 폭이 바뀌면 다시 잰다. 스크롤 이벤트는 아래 onScroll 이 받는다.
  useEffect(() => {
    readEdge()
    const el = ref.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(readEdge)
    ro.observe(el)
    return () => ro.disconnect()
  }, [groups, readEdge])

  const nudge = (dir: 1 | -1) => {
    const el = ref.current
    if (!el) return
    el.scrollBy({ left: dir * el.clientWidth * 0.8, behavior: 'smooth' })
  }

  // ⚠️ 흐릿하게 두지 말 것(2026-09-03 지적 — 안 보인다). 이 줄의 배경(surface-container-low) 위에
  //    보조색 글자만 얹으면 칩들 사이에서 그냥 사라진다. 한 단 밝은 면 + 테두리 + 본문색 글자로
  //    '누르는 것' 이라고 말한다. 끝에 닿았을 때만 흐려진다(자리는 남는다 — 줄 폭이 흔들리면 안 된다).
  const arrow =
    'flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-outline-variant bg-surface-container-high text-[24px] font-bold leading-none text-on-surface transition-colors hover:bg-surface-container-highest disabled:border-transparent disabled:bg-transparent disabled:text-outline disabled:opacity-40'

  return (
    <div className="mb-3 flex items-center gap-1 rounded-2xl border border-outline-variant bg-surface-container-low px-1.5 py-2.5">
      <button type="button" onClick={() => nudge(-1)} disabled={!edge.l} aria-label={t('ll.prev')} className={arrow}>‹</button>
      <div
        ref={ref}
        onScroll={readEdge}
        className="flex min-w-0 flex-1 gap-2 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {groups.map((g) => {
          const on = g.key === activeKey
          return (
            <button
              key={g.key}
              type="button"
              onClick={() => onPick(g)}
              className={`flex shrink-0 items-center gap-2 rounded-full px-3.5 py-2 font-label-md text-[16px] transition ${on ? 'bg-surface-container-lowest text-on-surface font-bold shadow-[inset_0_0_0_1.5px_var(--color-primary)]' : 'text-on-surface-variant'}`}
            >
              <span className="h-2.5 w-2.5 rounded-full" style={{ background: g.color, opacity: on ? 1 : 0.42 }} />
              {g.short}
            </button>
          )
        })}
      </div>
      <button type="button" onClick={() => nudge(1)} disabled={!edge.r} aria-label={t('ll.next')} className={arrow}>›</button>
    </div>
  )
}

/** 열 한 칸 — 머리말(고정) + 본문 + 꼬리말(안내문 왼쪽 · 페이지 넘김 오른쪽).
 *  본문은 한 번에 한 항목이라 보통 안 넘치지만, 항목 자체가 화면보다 길면 그때는 여기서 스크롤한다. */
export function Pane({
  title, foot, pager, bar, className = '', children,
}: {
  title: string
  foot?: string
  pager?: React.ReactNode
  bar?: React.ReactNode
  className?: string
  children: React.ReactNode
}) {
  return (
    // ⚠️ 다크가 기본이라 bg-surface-container-lowest(#0d0f15)를 쓰면 페이지 배경(#0a0c11)과 거의 같아
    //    열 경계가 안 보인다(2026-08-06 반려). 한 단 밝은 surface-container-low + 진한 테두리로 띄운다.
    <section className={`flex flex-col min-h-0 rounded-2xl border border-outline-variant bg-surface-container-low ambient-shadow overflow-hidden ${className}`}>
      {/* ⚠️ 열 제목을 11px 대문자 캡션으로 두지 말 것(2026-08-06 반려) — 이 화면의 뼈대라 제목처럼 보여야 한다. */}
      <div className="shrink-0 border-b border-outline-variant/70 px-4 py-3.5">
        <h2 className="font-title-md text-[18px] font-bold text-on-surface">{title}</h2>
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain">{children}</div>
      {bar}
      {(foot || pager) && (
        <div className="shrink-0 flex items-center justify-between gap-3 border-t border-outline-variant/70 px-4 py-2">
          <p className="min-w-0 font-body-md text-[14px] text-outline">{foot ?? ''}</p>
          {pager}
        </div>
      )}
    </section>
  )
}

/** 페이지 넘김 — 한 페이지에 한 개라 페이지 수 = 항목 수다. 한 개뿐이면 아예 그리지 않는다. */
export function Pager({ page, total, onGo, t }: { page: number; total: number; onGo: (p: number) => void; t: TFunc }) {
  if (total <= 1) return null
  const btn = 'flex h-9 w-9 items-center justify-center rounded-lg text-[20px] leading-none text-on-surface-variant transition-colors hover:bg-surface-container hover:text-on-surface disabled:opacity-30 disabled:hover:bg-transparent'
  return (
    <div className="flex shrink-0 items-center gap-0.5">
      <button type="button" onClick={() => onGo(page - 1)} disabled={page <= 0} aria-label={t('ll.prev')} className={btn}>‹</button>
      {/* tabular-nums — 자릿수가 바뀌어도 버튼이 좌우로 흔들리지 않는다. */}
      <span className="px-1.5 font-body-md text-[15px] tabular-nums text-on-surface-variant">{page + 1} / {total}</span>
      <button type="button" onClick={() => onGo(page + 1)} disabled={page >= total - 1} aria-label={t('ll.next')} className={btn}>›</button>
    </div>
  )
}

export function PaneEmpty({ text, action }: { text: string; action?: React.ReactNode }) {
  return (
    <div className="px-5 py-10 text-center font-body-md text-body-md text-outline break-keep">
      {text}
      {action && <div className="mt-4">{action}</div>}
    </div>
  )
}

// ══════════════════════════════════════════════════════════════
// 항목 줄
// ══════════════════════════════════════════════════════════════

/** 교재 한 줄 — 표지(탭하면 확대) + 제목 + 가격/버튼.
 *    표지 폭은 강의 썸네일과 같은 MEDIA_W 다(2026-08-11 — 두 열의 항목 크기를 맞췄다).
 *    목록이라고 더 줄이지 말 것 — 표지 글자가 아무 데서도 안 읽힌다.
 *  ⚠️ 스토어와 서재가 **같은 줄**을 쓴다 — 산 것이면 '읽기'(onOpen), 아니면 가격+구매(onBuy). */
export function BookRow({
  b, t, lang, busy, onZoom, onBuy, onOpen,
}: {
  b: EbookRow
  t: TFunc
  lang: Lang
  busy?: boolean
  onZoom: () => void
  onBuy?: () => void
  onOpen: () => void
}) {
  return (
    <li className="flex gap-4 px-4 py-4 transition-colors hover:bg-surface-container/60">
      {/* self-start 필수 — flex 자식 기본값 stretch 라 표지 박스가 줄 높이만큼 늘어나 A4 비율이 깨진다. */}
      <button type="button" onClick={onZoom} aria-label={t('ebook.cover_zoom')} className={`${MEDIA_W} cursor-zoom-in`}>
        {/* width = 표시 폭(약 222)의 2배 — 고밀도 화면에서 표지 글자가 뭉개지지 않게 스토리지 변환으로 받는다. */}
        <EbookCover title={b.title} coverUrl={b.coverUrl} width={444} className="w-full" />
      </button>
      <div className="flex min-w-0 flex-1 flex-col">
        <h3 className="font-title-md text-[19px] font-bold text-on-surface break-keep line-clamp-2">{b.title}</h3>
        {b.author && <p className="mt-1 font-body-md text-[15px] text-outline truncate">{b.author}</p>}
        {b.description && <p className="mt-2 font-body-md text-[15px] leading-[23px] text-on-surface-variant line-clamp-4 break-keep">{b.description}</p>}
        <div className="mt-auto flex flex-wrap items-center justify-between gap-2 pt-3">
          {/* 이미 산 것에 가격을 계속 띄우면 아직 안 산 것처럼 읽힌다 — 값 자리에 '보유 중'을 대신 둔다. */}
          {b.owned ? (
            <span className="inline-flex items-center gap-1.5 font-title-md text-[17px] font-bold text-secondary">
              <span className="material-symbols-outlined text-[20px]">check_circle</span>
              {t('ebook.owned')}
            </span>
          ) : (
            <span className="font-title-md text-[19px] font-bold text-on-surface">
              {/* ⚠️ price_usd_cents 는 **달러 센트**다. 문자열에 `$` 를 직접 박지 말고 usdc() 를 쓸 것. */}
              {b.price_usd_cents > 0 ? usdc(b.price_usd_cents, lang) : t('ebook.free')}
            </span>
          )}
          {b.owned ? (
            <button onClick={onOpen} className="shrink-0 px-4 py-2.5 bg-secondary/10 text-secondary border border-secondary/20 font-label-md text-[16px] font-bold rounded-xl hover:bg-secondary/15 transition-colors">
              {t('ebook.read')}
            </button>
          ) : (
            <button onClick={onBuy} disabled={busy} className="shrink-0 px-4 py-2.5 bg-primary-container text-on-primary font-label-md text-[16px] font-bold rounded-xl hover:bg-primary transition-colors ambient-shadow disabled:opacity-60">
              {busy ? t('ebook.processing') : b.price_usd_cents > 0 ? t('ebook.buy') : t('ebook.get_free')}
            </button>
          )}
        </div>
      </div>
    </li>
  )
}

/** 강의 한 줄 — **열 폭을 꽉 채운 가로 16:9 썸네일** + 그 **밑에** 제목·채널(2026-08-11 지시).
 *
 *  ⛔ **산 사람만 재생한다(2026-08-25 유료화).** 미소유는 썸네일 + 가격 + 구매하기만 보여준다 —
 *     서버가 youtubeId 를 아예 안 내려주므로 프론트에 재생 경로 자체가 없다.
 *     ⚠️ 썸네일을 흑백으로 깔거나 자물쇠를 얹지 않는다(2026-08-25 지시) — 무슨 강의인지 보여주는 게
 *        살 이유를 만드는 유일한 수단이다. 죽이는 건 버튼 하나면 된다.
 *  ⚠️ 교재 표지처럼 왼쪽으로 세우지 말 것 — 영상은 가로가 긴 물건이라 옆에 글을 붙이면 그림이 작아진다.
 *  ⚠️ 처음부터 iframe 을 깔지 않는다 — 줄 수만큼 플레이어가 로드돼 열이 눈에 띄게 무거워진다. */
export function LectureRow({
  lec, t, lang, busy, playing, onPlay, onBuy,
}: {
  lec: ServerLecture
  t: TFunc
  lang: Lang
  busy?: boolean
  playing: boolean
  onPlay: () => void
  onBuy?: () => void
}) {
  // 썸네일이 404 면(영상이 내려갔거나 id 오타) 이미지를 지우고 아래 그라데이션 판이 드러나게 둔다.
  const [thumbDead, setThumbDead] = useState(false)
  // ⚠️ 소유 여부와 **youtubeId 존재**를 같이 본다 — 옛 배포본 응답엔 id 가 없을 수 있다(그땐 재생 불가).
  const canPlay = lec.owned && !!lec.youtubeId

  const thumb = !thumbDead && (
    <img
      src={lec.thumbUrl}
      alt=""
      loading="lazy"
      decoding="async"
      onError={() => setThumbDead(true)}
      className="absolute inset-0 h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.03]"
    />
  )

  return (
    <li className="px-4 py-4 transition-colors hover:bg-surface-container/60">
      <div className="relative aspect-video overflow-hidden rounded-xl bg-gradient-to-br from-slate-700 to-slate-900">
        {playing && canPlay ? (
          <iframe
            src={ytEmbed(lec.youtubeId as string)}
            title={lec.title}
            className="absolute inset-0 h-full w-full"
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
            referrerPolicy="strict-origin-when-cross-origin"
            allowFullScreen
          />
        ) : canPlay ? (
          <button type="button" onClick={onPlay} className="group absolute inset-0 h-full w-full" aria-label={`${t('ll.play')} — ${lec.title}`}>
            {thumb}
            <span className="absolute inset-0 flex items-center justify-center">
              <span className="flex h-14 w-14 items-center justify-center rounded-full border border-white/25 bg-black/55 backdrop-blur-sm transition-transform duration-200 group-hover:scale-110">
                <svg viewBox="0 0 24 24" className="h-6 w-6 translate-x-[1px] fill-white" aria-hidden="true"><path d="M8 5v14l11-7z" /></svg>
              </span>
            </span>
          </button>
        ) : (
          // 미소유 — 그림은 그대로 보여주고 재생만 없다(누를 것이 없으므로 button 이 아니다).
          <div className="group absolute inset-0 h-full w-full">{thumb}</div>
        )}
      </div>
      <h4 className="mt-3.5 font-title-md text-[19px] font-bold text-on-surface break-keep line-clamp-2">{lec.title}</h4>
      {lec.channel && <p className="mt-1.5 font-body-md text-[15px] text-outline truncate">{lec.channel}</p>}
      {lec.description && <p className="mt-2 font-body-md text-[15px] leading-[23px] text-on-surface-variant line-clamp-3 break-keep">{lec.description}</p>}
      <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
        {lec.owned ? (
          <span className="inline-flex items-center gap-1.5 font-title-md text-[17px] font-bold text-secondary">
            <span className="material-symbols-outlined text-[20px]">check_circle</span>
            {t('ebook.owned')}
          </span>
        ) : (
          <span className="font-title-md text-[19px] font-bold text-on-surface">
            {lec.price_usd_cents > 0 ? usdc(lec.price_usd_cents, lang) : t('ebook.free')}
          </span>
        )}
        {lec.owned ? (
          <button
            onClick={onPlay}
            disabled={!canPlay}
            className="shrink-0 px-4 py-2.5 bg-secondary/10 text-secondary border border-secondary/20 font-label-md text-[16px] font-bold rounded-xl hover:bg-secondary/15 transition-colors disabled:opacity-50"
          >
            {playing ? t('ll.playing') : t('ll.watch')}
          </button>
        ) : (
          <button onClick={onBuy} disabled={busy} className="shrink-0 px-4 py-2.5 bg-primary-container text-on-primary font-label-md text-[16px] font-bold rounded-xl hover:bg-primary transition-colors ambient-shadow disabled:opacity-60">
            {busy ? t('ebook.processing') : lec.price_usd_cents > 0 ? t('ebook.buy') : t('ebook.get_free')}
          </button>
        )}
      </div>
    </li>
  )
}
