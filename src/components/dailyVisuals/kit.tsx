// DAILY QUIZ 해설 그림 공용 부품 (2026-09-08).
//
// 그림이 8장이던 시절엔 DailyVisual.tsx 한 파일에 부품과 그림이 같이 있었다. 그림을 대량으로 늘리면서
// **부품만 여기로** 뽑았다 — 그림 파일(batch*.tsx)이 여러 벌이라 부품을 각자 베끼면 굵기·색 규칙이 파일마다 갈린다.
//
// ⛔ **색을 직접 쓰지 말 것.** SVG presentation attribute 에는 var() 가 안 먹으므로
//    **선은 stroke="currentColor"**(루트 .vz 가 color 를 잡는다), **면은 .vz-* 클래스**로 칠한다.
//    daily.css 의 토큰만 쓰기 때문에 다크모드가 자동으로 따라온다. #hex 를 박으면 한쪽 테마에서 증발한다.
import type { ReactNode } from 'react'

/** 모든 그림의 viewBox 가로. 세로는 그림마다 다르다(Frame 의 h). */
export const VW = 320

/** 그림 + 아래 조작줄 공통 껍데기. foot 에 칩·슬라이더를 넣으면 그림 바로 밑에 붙는다. */
export function Frame({ h, children, foot }: { h: number; children: ReactNode; foot?: ReactNode }) {
  return (
    <div className="dy-viz">
      <svg className="vz" viewBox={`0 0 ${VW} ${h}`} role="img">{children}</svg>
      {foot && <div className="dy-viz-foot">{foot}</div>}
    </div>
  )
}

/** 카툰 톤 막대(팔·다리·관) — 굵은 외곽선 위에 얇은 면을 덮어 '테두리 있는 막대'를 만든다. */
export function Limb({ x1, y1, x2, y2, w = 15 }: { x1: number; y1: number; x2: number; y2: number; w?: number }) {
  return (
    <>
      <line x1={x1} y1={y1} x2={x2} y2={y2} stroke="currentColor" strokeWidth={w} strokeLinecap="round" />
      <line x1={x1} y1={y1} x2={x2} y2={y2} className="vz-limb" strokeWidth={w - 6} strokeLinecap="round" />
    </>
  )
}

/** 관절·연결점 — 흰 면에 굵은 외곽선. */
export function Joint({ x, y, r = 7 }: { x: number; y: number; r?: number }) {
  return <circle cx={x} cy={y} r={r} className="vz-card" stroke="currentColor" strokeWidth={3} />
}

/**
 * 테두리 있는 상자 — '무엇이 무엇을 담는다'를 그릴 때의 기본 단위(모듈·서버·메모리 칸 등).
 * tone 으로 면 색만 고른다: card(밝은 카드) · mute(바탕) · brand(파랑) · teal(청록) · gold(노랑).
 */
export function Box({ x, y, w, h, r = 10, tone = 'card' }: {
  x: number; y: number; w: number; h: number; r?: number
  tone?: 'card' | 'mute' | 'brand' | 'teal' | 'gold'
}) {
  const cls = { card: 'vz-card', mute: 'vz-mute', brand: 'vz-brand', teal: 'vz-teal', gold: 'vz-gold-f' }[tone]
  return <rect x={x} y={y} width={w} height={h} rx={r} className={cls} stroke="currentColor" strokeWidth={3} />
}

/**
 * 화살표 — 흐름·인과를 그리는 가장 많이 쓰는 부품.
 * tone: flow(청록, 기본 흐름) · turn(노랑, 회전·되돌아옴) · bad(빨강, 실패·위험) · dash(점선, 개념적 연결)
 * ⚠️ 화살촉은 marker 를 쓰지 않는다(marker 는 currentColor 상속이 브라우저마다 다르다) — 선 두 개로 그린다.
 */
export function Arrow({ x1, y1, x2, y2, tone = 'flow', w = 3, head = 8 }: {
  x1: number; y1: number; x2: number; y2: number
  tone?: 'flow' | 'turn' | 'bad' | 'dash'; w?: number; head?: number
}) {
  const cls = { flow: 'vz-arrow', turn: 'vz-turn', bad: 'vz-goal', dash: 'vz-dash' }[tone]
  const a = Math.atan2(y2 - y1, x2 - x1)
  const hx = (d: number) => x2 - head * Math.cos(a + d)
  const hy = (d: number) => y2 - head * Math.sin(a + d)
  return (
    <g className={cls} strokeWidth={w} strokeLinecap="round" fill="none">
      <line x1={x1} y1={y1} x2={x2} y2={y2} />
      <line x1={x2} y1={y2} x2={hx(0.5)} y2={hy(0.5)} />
      <line x1={x2} y1={y2} x2={hx(-0.5)} y2={hy(-0.5)} />
    </g>
  )
}

/**
 * 글자 라벨. tone: mute(기본 회색) · hot(파랑 강조) · ok(청록) · bad(빨강) · inv(색 면 위 흰 글자)
 * ⚠️ 라벨은 **거들기만** 한다. 그림이 말을 못 해서 문장을 적고 있다면 그림을 다시 그릴 것.
 */
export function Lab({ x, y, children, tone = 'mute', size = 13, anchor = 'middle' }: {
  x: number; y: number; children: ReactNode
  tone?: 'mute' | 'hot' | 'ok' | 'bad' | 'inv'; size?: number; anchor?: 'start' | 'middle' | 'end'
}) {
  const cls = { mute: 'vz-lab', hot: 'vz-lab-hot', ok: 'vz-lab-ok', bad: 'vz-lab-bad', inv: 'vz-lab-inv' }[tone]
  return (
    <text x={x} y={y} className={cls} fontSize={size} fontWeight={800} textAnchor={anchor}>{children}</text>
  )
}

/** 조작줄 칩(누르는 것). on 이면 테두리가 물든다 — 면을 칠하지 않는 게 앱 공통 규칙이다. */
export function Chip({ on, onClick, children, tone }: {
  on?: boolean; onClick: () => void; children: ReactNode; tone?: 'mv' | 'tn'
}) {
  return (
    <button className={`dy-viz-chip${tone ? ` ${tone}` : ''}${on ? ' on' : ''}`} onClick={onClick}>{children}</button>
  )
}
