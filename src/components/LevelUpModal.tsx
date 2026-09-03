// ARENA 레벨업 축하 — /hub 에서만 뜬다(2026-08-26).
//
// 왜 만들었나: 레벨업이 화면에서 **아무 말 없이** 일어났다. ARENA 레벨은 저장되는 값이 아니라
// 점수 파생값이라 "직전 레벨"을 아는 자리가 없었고, 그래서 감지 자체가 불가능했다.
// 사용자가 실제로 본 것은 축하가 아니라, 허브에 돌아왔을 때 지난 방문 점수로 먼저 그려진 캐릭터가
// (lastLook) 서버 응답이 오는 순간 다음 레벨 그림으로 **소리 없이 툭 바뀌는 것**이었다.
//
// 두 막이다(2026-08-26 지시):
//   1막 '진화'  — 캐릭터가 흰 실루엣이 되어 맥동하다 섬광과 함께 새 모습으로 바뀌고,
//                 레벨 숫자가 팍 뜨면서 폭죽이 터진다(포켓몬 진화 연출).
//   2막 '결과'  — 이전 → 지금 비교 카드 + 버튼.
//
// ⚠️ 레벨업은 거의 항상 **허브 밖에서** 일어난다(레벨테스트 클리어 +1,000 · 학습/미니게임 +2 · 출석 +5).
//    그래서 "레벨이 오르는 그 순간"에 연출을 붙일 자리가 없고, **허브로 돌아왔을 때 밀린 축하를 하는**
//    구조다. 허브 안에서 오르는 유일한 경로(자동 출석)도 get-hub 를 다시 받으므로 같은 길로 처리된다.
//
// ⛔ **이 컴포넌트는 레벨업 한 칸만 그린다.** 여러 레벨을 한 번에 뛰었으면 호출부가 이걸 여러 번
//    띄운다(2026-08-26 지시). 한 모달 안에서 오른쪽만 계단으로 올리는 판을 먼저 만들었다가 되돌렸다 —
//    그러면 왼쪽이 처음 레벨에 박혀 있어서 **중간 상승이 '이전 → 지금' 한 쌍으로 한 번도 안 보인다**
//    (Lv.3→5 에서 3→4 는 오른쪽 숫자만 스쳐 지나갔다). 레벨업은 각각이 사건이라 각각 축하한다.
// ⚠️ 판정은 서버가 한다(get-hub 의 levelUp). 이 컴포넌트는 받은 값을 그리기만 한다.
import { useEffect, useMemo, useRef, useState } from 'react'
import CharArt from './CharArt'
import { useT } from '../lib/i18n'

/** 1막(진화)이 끝나고 2막(결과)으로 넘어가는 시각. hub.css 의 진화 타임라인 끝과 한 쌍이다.
 *  ⚠️ CSS 쪽 animation-delay 를 손대면 이 값도 같이 옮길 것 — 짧으면 폭죽이 잘리고,
 *     길면 다 끝난 화면을 멀뚱히 보게 된다.
 *  ⚠️ 2.7초였다가 5.9초로 늘렸다(2026-09-03 · "아직도 빠르다"). 형태 교대(옛↔새 실루엣이
 *     점점 빨라지며 번갈아 뜨는 구간)가 0.45~3.85s 를 쓰고, 그 뒤에 섬광·색 복귀·레벨 숫자·폭죽이
 *     차례로 온다. 이 구간을 줄이면 교대가 몇 번 못 돌아 '변하는 중' 이 안 읽힌다. */
const EVOLVE_MS = 5900

// 움직임 줄이기 설정에서 뭘 뺄 것인가 — 여기서 세 번 헛짚었다. 기록해 둔다(폭죽도 같은 길을 갔다).
//   1차: 1막을 **통째로 건너뛰었다** → 레벨업했는데 결과 카드만 떴다.
//   2차: 크로스페이드만 남겼다 → "너무 별로다". 그림 두 장이 녹아들 뿐 무슨 일인지 안 읽힌다.
//   3차: 원래 연출을 1.5초로 **압축**했다 → "너무 빠르다". 맞다 — 같은 사건을 절반 시간에 밀어넣으면
//        하나하나가 스쳐 지나가고, 빨라진 움직임은 오히려 더 자극적이다.
//
// ⛔ **결론: 속도도 줄이지 않는다.** 이 설정에서 빼는 것은 **전체화면 흰 섬광 하나**뿐이다.
//    화면 전체가 통째로 번쩍이는 것이 이 연출에서 유일하게 부담스러운 대목이고, 나머지(광원·빛줄기·
//    실루엣·맥동·등장 팝·레벨 숫자·폭죽)는 캐릭터 한 명 크기 안에서 일어나는 일이라 그대로 둔다.
//    그래서 길이도 화려한 판과 **같다**.

/** 1막(진화)이 끝나고 2막(결과)으로 넘어가는 시각 — 움직임 줄이기 설정에서도 같다(위 주석). */
const EVOLVE_SOFT_MS = 5900

/** 폭죽 조각 수. 늘리면 화려해지지만 저사양 기기에서 프레임이 떨어진다. */
const SPARKS = 22

export default function LevelUpModal({
  charKey,
  from,
  index,
  count,
  onConfirm,
}: {
  charKey: string | null
  /** 이 모달이 축하하는 상승의 **이전** 레벨. 새 레벨은 언제나 from + 1 이다. */
  from: number
  /** 이번이 몇 번째 축하인지(0부터). 한 번에 여러 레벨을 뛰었을 때만 의미가 있다. */
  index: number
  /** 이번 방문에 축하할 총 횟수. 1이면 진행 표시를 안 그린다. */
  count: number
  /** 확인. 호출부가 워터마크를 올리고, 남았으면 다음 축하를 띄운다. */
  onConfirm: () => void
}) {
  const { t } = useT()
  const to = from + 1
  const last = index >= count - 1
  const okRef = useRef<HTMLButtonElement | null>(null)

  // ⚠️ 움직임을 줄여달라는 설정에서도 1막은 그대로 돈다. 다른 건 **전체화면 흰 섬광을 안 그리는 것** 뿐이다
  //    (위 EVOLVE_SOFT_MS 주석 참고). 판정은 **초기화**에서 해야 한다 — 이펙트 안에서 setState 를
  //    동기로 부르면 섬광이 한 프레임 번쩍였다 사라진다.
  const [soft] = useState(
    () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches,
  )
  const [phase, setPhase] = useState<'evolve' | 'result'>('evolve')

  // 폭죽 조각 — 각도·거리·크기·색을 미리 뽑아 CSS 변수로 넘긴다.
  //   ⚠️ CSS 의 cos()/sin() 을 쓰지 않는다(브라우저 지원이 갈린다) — 좌표를 여기서 계산해 넘긴다.
  //   ⚠️ **Math.random 을 쓰지 않는다.** 렌더 중 순수하지 않은 호출은 lint 가 막고(react-hooks/purity),
  //      실제로도 재렌더마다 폭죽이 자리를 바꾼다. 대신 인덱스에서 값을 뽑아 흩뿌린다 —
  //      결정론이라 안 흔들리면서 규칙적으로도 안 보이고, 레벨마다 모양이 달라진다.
  const sparks = useMemo(() => {
    const rnd = (n: number) => { const x = Math.sin((n + to * 7.13) * 12.9898) * 43758.5453; return x - Math.floor(x) }
    return Array.from({ length: SPARKS }, (_, i) => {
      const a = (i / SPARKS) * Math.PI * 2 + rnd(i) * 0.28
      // ⚠️ 가깝게 터지면(90~220px) 조각이 캐릭터 몸에 붙어 '폭죽'이 아니라 얼룩으로 읽힌다.
      //    인물 바깥으로 확실히 나가야 터지는 맛이 난다.
      const d = 165 + rnd(i + 101) * 215
      return {
        x: Math.cos(a) * d,
        y: Math.sin(a) * d,
        size: 7 + rnd(i + 202) * 9,
        delay: rnd(i + 303) * 180,
        hue: [0, 42, 48, 12, 200][i % 5],
      }
    })
  }, [to])

  useEffect(() => {
    if (phase !== 'evolve') return
    const id = setTimeout(() => setPhase('result'), soft ? EVOLVE_SOFT_MS : EVOLVE_MS)
    return () => clearTimeout(id)
  }, [phase, soft])

  // ⚠️ 배경을 눌러도 안 닫는다 — 실수로 축하를 날리면 되돌릴 방법이 없다(워터마크가 올라가 다시 안 뜬다).
  //    1막에서는 아무 데나 누르면 **건너뛰기**(닫기가 아니다). 2막에서만 Esc 가 확인이 된다.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      if (phase === 'evolve') setPhase('result')
      else onConfirm()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [phase, onConfirm])

  useEffect(() => { if (phase === 'result') okRef.current?.focus() }, [phase])

  // ── 1막: 진화 ──────────────────────────────────────────────────────────────
  if (phase === 'evolve') {
    return (
      <div
        className={`lvup is-evolve${soft ? ' is-soft' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-label={t('hub.lvup.title')}
        onClick={() => setPhase('result')}
      >
        <div className="evo">
          <div className="evo-glow" aria-hidden="true" />
          <div className="evo-rays" aria-hidden="true" />

          {/* 옛 모습 — 색이 빠져 흰 실루엣이 되고 맥동한다. 실루엣은 같은 그림을 한 장 더 얹어
              filter 로 하얗게 태운 것이다(색 → 흰색을 filter 전환으로 하면 중간이 지저분하다). */}
          <div className="evo-char is-old" aria-hidden="true">
            <CharArt charKey={charKey} level={from} className="evo-img evo-color" />
            <CharArt charKey={charKey} level={from} className="evo-img evo-sil" />
          </div>

          {/* 새 모습 — 섬광 뒤에 실루엣으로 나타났다가 색을 되찾는다. */}
          <div className="evo-char is-new">
            <CharArt charKey={charKey} level={to} className="evo-img evo-color" alt={`Lv.${to}`} />
            <CharArt charKey={charKey} level={to} className="evo-img evo-sil" />
          </div>

          {/* ⛔ 움직임 줄이기 설정에서 **이것 하나만** 뺀다 — 화면 전체가 통째로 하얗게 번쩍이는 대목이라
              이 연출에서 유일하게 부담스러운 자리다. CSS 로 숨기지 않고 DOM 에도 안 넣는다. */}
          {!soft && <div className="evo-flash" aria-hidden="true" />}

          <div className="evo-lv">
            <span className="evo-lv-txt">Lv.{to}</span>
          </div>

          {(
            <div className="evo-fx" aria-hidden="true">
              {sparks.map((s, i) => (
                <span
                  key={i}
                  className="evo-spark"
                  style={{
                    ['--sx' as string]: `${s.x}px`,
                    ['--sy' as string]: `${s.y}px`,
                    ['--ss' as string]: `${s.size}px`,
                    ['--sd' as string]: `${s.delay}ms`,
                    ['--sh' as string]: `${s.hue}`,
                  }}
                />
              ))}
            </div>
          )}
        </div>
      </div>
    )
  }

  // ── 2막: 결과 ──────────────────────────────────────────────────────────────
  return (
    <div className="lvup" role="dialog" aria-modal="true" aria-labelledby="lvup-title">
      <div className="lvup-card">
        <div className="lvup-spark" aria-hidden="true">
          <span className="lvup-s1">✦</span><span className="lvup-s2">✧</span>
          <span className="lvup-s3">✦</span><span className="lvup-s4">✧</span>
        </div>

        <h2 className="lvup-title" id="lvup-title">
          <span aria-hidden="true">✦</span> {t('hub.lvup.title')} <span aria-hidden="true">✦</span>
        </h2>

        <div className="lvup-pair">
          <figure className="lvup-side is-before">
            <CharArt charKey={charKey} level={from} className="lvup-img" />
            <figcaption>
              <em>{t('hub.lvup.before')}</em>
              <b>Lv.{from}</b>
            </figcaption>
          </figure>

          <div className="lvup-arrow" aria-hidden="true">→</div>

          <figure className="lvup-side is-after">
            <CharArt charKey={charKey} level={to} className="lvup-img" />
            <figcaption>
              <em>{t('hub.lvup.now')}</em>
              <b>Lv.{to}</b>
            </figcaption>
          </figure>
        </div>

        {/* ⚠️ 여러 번 띄울 때만 그린다. 이게 없으면 확인을 눌렀는데 축하가 **또** 떠서 고장으로 읽힌다 —
            몇 번 중 몇 번째인지 보여주는 게 이 점들의 유일한 일이다. 점 하나는 정보가 0이라 안 그린다. */}
        {count >= 2 && (
          <div className="lvup-dots" aria-hidden="true">
            {Array.from({ length: count }, (_, i) => (
              <span key={i} className={`lvup-dot${i <= index ? ' on' : ''}`} />
            ))}
          </div>
        )}

        {/* ⚠️ 마지막이 아니면 '다음'이라고 말한다. 둘 다 '확인'이면 눌렀는데 또 뜨는 이유를 알 수 없다. */}
        <button ref={okRef} type="button" className="lvup-ok" onClick={onConfirm}>
          {last ? t('hub.lvup.ok') : t('hub.lvup.next')}
        </button>
      </div>
    </div>
  )
}
