// 미니게임 게임별 랭킹 모달 — 게임 인트로/아웃트로 우상단 '랭킹' 버튼이 열고, 전체 유저 보드를 보여준다.
//   · 게임 HTML 안이 아니라 **부모(앱)** 에 그린다: 게임이 6개라 안에 그리면 같은 UI 를 6번 유지해야 하고
//     아바타·다크모드·세션을 iframe 이 갖고 있지 않다. 게임은 postMessage 로 열기만 요청한다(MiniGame.tsx).
//   · ⚠️ 디자인은 새로 만들지 않는다 — 시상대(TOP3)·리스트(4위~)·내 순위 바 전부 `/ranking` 과 **같은
//     `.hof-*`**(ranking.css), 모달 껍데기는 이 화면의 기존 모달 `.mgm-*`(minigame.css)를 그대로 쓴다.
//     시상대 메달색도 ranking.css 규칙대로 금·은·동이 아니라 코발트 3단계다(토큰은 minigame.css 의 .mgr-modal).
//   · 지표(metric)에 따라 값 표기만 다르다: 'score'=점수, 'level'=도달 레벨(+동률 해소용 소요시간 병기).
import { useEffect, useState } from 'react'
import { callFunction } from '../lib/supabase'
import { Avatar } from './GemAvatar'
import { useT } from '../lib/i18n'

interface Row {
  rank: number
  name: string
  score: number
  tieMs: number | null
  achievedAt: string
  color: string | null
  image: string | null
  mascot: string | null
  character: string | null
  me: boolean
}

interface RankResp {
  gameId: string
  metric: 'score' | 'level'
  max: number
  top: Row[]
  total: number
  me: (Row & { plays: number; percentile: number | null; scoreToPass: number | null }) | null
  needsAuth?: boolean
  error?: string
}

/** 아바타 문자열 복원 — 서버가 색/이미지로 분해해 내려주므로 <Avatar> 가 먹는 형태로 되돌린다(Ranking.tsx 와 동일). */
function avatarUrlOf(r: Pick<Row, 'color' | 'image' | 'mascot' | 'character'>): string | null {
  if (r.image) return `img:${r.image}`
  if (r.color) return `gem:${r.color}`
  if (r.mascot) return `mascot:${r.mascot}`
  if (r.character) return `char:${r.character}`
  return null
}

function fmtMs(ms: number | null): string {
  if (ms == null) return ''
  const s = Math.round(ms / 100) / 10
  if (s < 60) return `${s.toFixed(1)}초`
  const m = Math.floor(s / 60)
  return `${m}분 ${Math.round(s - m * 60)}초`
}

export default function MiniGameRankModal({
  gameId,
  title,
  onClose,
}: {
  gameId: string
  title: string
  onClose: () => void
}) {
  const { t } = useT()
  const [data, setData] = useState<RankResp | null>(null)
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    callFunction<RankResp>('minigame-rank', { gameId })
      .then((d) => {
        if (!alive) return
        if (d.error) setErr(d.error)
        else setData(d)
      })
      .catch((e) => { if (alive) setErr(e instanceof Error ? e.message : '랭킹을 불러오지 못했어요.') })
    return () => { alive = false }
  }, [gameId])

  // ESC 로 닫기 — 게임 위에 뜨는 오버레이라 키보드 탈출로가 필요하다.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const metric = data?.metric ?? 'score'
  const val = (v: number) => (metric === 'level' ? `Lv.${v}` : v.toLocaleString())
  // 시상대 = 2·1·3 순서로 배치(가운데가 1위). 3명 미만이면 빈 칸으로 자리만 잡는다 — /ranking 과 동일.
  const top = data?.top ?? []
  const podium = [top[1], top[0], top[2]]
  const podClass = ['p2', 'p1', 'p3']
  const rest = top.slice(3)
  // '상위 N%' — Ranking.tsx 와 동일 계산(백분위 없으면 순위/총원으로 대체, 최소 1%).
  const mePct = data?.me
    ? data.me.percentile != null
      ? Math.max(1, Math.round(data.me.percentile * 100))
      : data.total > 0
        ? Math.max(1, Math.round((data.me.rank / data.total) * 100))
        : 0
    : 0

  return (
    <div className="mgm-backdrop" onClick={onClose} role="presentation">
      <div
        className="mgm-modal mgr-modal"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={`${title} 랭킹`}
      >
        <div className="mgm-head">
          <h3>{title} 랭킹</h3>
          <button className="mgm-close" onClick={onClose} aria-label="닫기">✕</button>
        </div>

        <p className="mgr-note">
          {metric === 'level'
            ? '도달 레벨이 높은 순 · 같으면 걸린 시간이 짧은 순'
            : '점수가 높은 순 · 같으면 먼저 도달한 순'}
          {data ? ` · 참가 ${data.total.toLocaleString()}명` : ''}
        </p>

        {err && <p className="mgr-note mgr-mid">{err}</p>}
        {!err && !data && <p className="mgr-note mgr-mid">불러오는 중…</p>}

        {data && !err && (
          top.length === 0 ? (
            <p className="mgr-note mgr-mid">아직 기록이 없어요. 첫 기록의 주인이 되어보세요!</p>
          ) : (
            <>
              {/* === 시상대 TOP 3 — /ranking 과 같은 그림·좌표(ranking.css). 제목만 없다(모달 헤더가 대신한다). === */}
              <div className="hof-podium">
                <div className="hof-podium-art">
                  <img src="/ranking/podium.png" alt="" className="hof-podium-img" />
                  {podium.map((r, i) =>
                    r ? (
                      <span key={r.rank} className={`hof-slot ${podClass[i]}`}>
                        <Avatar avatarUrl={avatarUrlOf(r)} seed={r.name} size={120} />
                      </span>
                    ) : null,
                  )}
                  {/* 이름·점수는 그림 안 크림 명판 위(=/ranking 과 같은 .hof-plate).
                      미니게임엔 티어가 없어 엠블럼 칸은 아예 그리지 않는다. */}
                  {podium.map((r, i) =>
                    r ? (
                      <div key={`n${r.rank}`} className={`hof-plate ${podClass[i]}`}>
                        <span className="hof-plate-txt">
                          <b>{r.name}</b>
                          <span>
                            {val(r.score)}
                            {metric === 'level' && r.tieMs != null ? <small>{fmtMs(r.tieMs)}</small> : null}
                          </span>
                        </span>
                      </div>
                    ) : null,
                  )}
                </div>
              </div>

              {/* === 4위 ~ === 티어리스트 바. 미니게임엔 티어가 없어 방패 소켓은 비워 둔다. */}
              {rest.length > 0 && (
                <div className="hof-list">
                  {rest.map((r) => (
                    <div key={r.rank} className={`hof-row ${r.me ? 'me' : ''}`}>
                      <div className="hof-bar">
                        <img src="/ranking/tierbar.png" alt="" className="bar-frame" />
                        <span className="bar-rk">{r.rank}</span>
                        <span className="bar-ava"><Avatar avatarUrl={avatarUrlOf(r)} seed={r.name} size={48} /></span>
                        <span className="bar-nm">
                          {r.name}
                          {r.me ? <span className="meflag">{t('rank.you')}</span> : null}
                        </span>
                        <span className="bar-pt">
                          {val(r.score)}
                          {metric === 'level' && r.tieMs != null ? <small>{fmtMs(r.tieMs)}</small> : null}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </>
          )
        )}

        {/* 내 순위 — TOP N 안에 있어도 항상 보여준다(/ranking 과 같은 규칙). 위 목록과 중복돼도
            '내 기록이 지금 몇 등인지'를 찾아 스크롤하지 않게 하는 쪽이 낫다. */}
        {data && !err && (
          data.me ? (
            // 구조·크기 전부 /ranking 의 내 순위 바와 동일: 이름 옆 small 로 '상위 N%'(meflag 대신).
            <div className="hof-mebar">
              <div className="hof-bar">
                <img src="/ranking/tierbar.png" alt="" className="bar-frame" />
                <span className="bar-rk">{data.me.rank}</span>
                <span className="bar-ava"><Avatar avatarUrl={avatarUrlOf(data.me)} seed={data.me.name} size={48} /></span>
                <span className="bar-nm">
                  {data.me.name}
                  <small>{t('rank.top_label')} {mePct}%</small>
                </span>
                <span className="bar-pt">{val(data.me.score)}</span>
              </div>
            </div>
          ) : (
            <p className="mgr-note mgr-mid">
              {data.needsAuth ? '로그인하면 내 순위가 표시돼요.' : '아직 내 기록이 없어요 — 한 판 하고 오면 등록됩니다.'}
            </p>
          )
        )}
      </div>
    </div>
  )
}
