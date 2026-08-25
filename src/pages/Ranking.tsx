import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../context/AuthProvider'
import { callFunction, supabase } from '../lib/supabase'
import { countryName, flagUrl } from '../lib/regions'
import { showPercentile, arenaLevelForScore } from '../lib/scoring'
import { useT, type TFunc } from '../lib/i18n'
import TopBar from '../components/TopBar'
import { Avatar } from '../components/GemAvatar'
import ShareCardModal from '../components/ShareCardModal'
import { scopedForCard, type CardScoped, type ShareCardData } from '../lib/shareCard'

interface HofUser {
  rank: number
  // 방(/room/:uid) 진입용. scoped_top 의 top 행에만 있고 me 행에는 없다 → '내 순위' 바에서는 null.
  uid: string | null
  name: string
  level: number
  rating: number // 시즌 총점(season_total) — 서버 leaderboard 응답 필드명은 하위호환상 rating 유지
  color: string | null
  image: string | null
  mascot: string | null
  // 시상대 이름 뒤 국기. top 행에만 있고(scoped_top 20260818130000) me 행에는 없다.
  // 온보딩 전(국가 미설정)이면 null → 국기를 아예 안 그린다.
  country: string | null
  me: boolean
  // ⚠️ 서버는 아직 tier 를 내려주지만(DB ranking_tier) 티어 표시는 2026-08-04 제거돼 읽지 않는다.
  percentile: number | null // 0~1, 낮을수록 상위 (해당 보드 범위 안 기준)
  // 장착한 캐릭터·스킨(2026-08-20). 카드 좌 패널이 그 사람의 배경 + 캐릭터로 그려진다.
  //   ⚠️ top 행에만 온다 — me 행에는 uid 가 없어 서버가 조인할 대상을 못 찾는다('내 순위' 바는 카드를 안 연다).
  character: string | null
  skin: string | null
}
/** 이어보기 커서 — 점수·시각·id 세 값이 한 벌이다.
 *  ⚠️ 점수만 보내면 동점자가 통째로 건너뛰어진다(실측 3만5천 명 중 7,419명 누락).
 *     서버가 준 것을 **그대로** 되돌려주기만 하면 된다. */
interface HofCursor { score: number; at: string; id: string; rank: number }
interface HofResponse {
  top: HofUser[]
  total: number
  cursor?: HofCursor | null
  me: (HofUser & { pointsToPass?: number | null }) | null
  code?: string | null // 적용된 국가/지역 코드(전세계는 null)
  needsAuth?: boolean // 비로그인이라 국가·지역 보드를 만들 수 없음
  needsRegion?: boolean // 로그인했지만 국가·지역 미설정(온보딩 전)
}

// 랭킹 범위 — 셋 다 **개인** 리더보드고 모수만 다르다(전체 / 내 국가 / 내 지역).
// 옛 '지역·국가 집계 버킷' 탭(평균·참여율 카드)은 여기서 제거됐다 — 그 뷰는 /arena 지도가 계속 쓴다.
// 탭 순서는 넓은 쪽 → 좁은 쪽(전세계 → 내 국가 → 내 지역). 오른쪽으로 갈수록 모수가 좁혀지는 사다리.
type Scope = 'global' | 'my-country' | 'my-region'
const SCOPES: Scope[] = ['global', 'my-country', 'my-region']

function avatarUrlOf(u: { image: string | null; color: string | null; mascot?: string | null }): string | null {
  if (u.mascot) return `mascot:${u.mascot}`
  if (u.image) return `img:${u.image}`
  if (u.color) return `gem:${u.color}`
  return null // Avatar 가 seed 로 젬색 생성
}

// (더미 리더보드 제거 — 실데이터 또는 빈 상태만 표시)

export default function Ranking() {
  const { user, isFullUser, loading, loginWithGoogle } = useAuth()
  const { t, lang } = useT()
  // 사용자가 탭을 직접 고르기 전엔 null — 그동안은 아래 defaultScope 가 적용된다.
  const [picked, setPicked] = useState<Scope | null>(null)
  // 범위별 응답 캐시 — 탭을 오갈 때 재조회하지 않는다. 캐시 키에 로그인 여부를 섞어서,
  // 로그인/로그아웃하면 키가 어긋나 자동으로 다시 받는다(응답의 me 가 달라지므로).
  const [boards, setBoards] = useState<Record<string, HofResponse>>({})
  const [errs, setErrs] = useState<Record<string, boolean>>({})
  // 탭 라벨용 내 국가·지역 코드(데이터 도착 전에도 '대한민국·서울'로 보여야 하므로 프로필에서 먼저 읽는다).
  //   uid 를 같이 들고 있다가 렌더에서 대조 — 계정이 바뀌면 이전 사용자 코드가 남지 않는다.
  const [profile, setProfile] = useState<{ uid: string; country: string | null; region: string | null } | null>(null)
  const uid = user?.id ?? null
  const myCode = uid && isFullUser && profile?.uid === uid ? profile : { country: null, region: null }
  // 기본 탭 = **전세계**. 랭킹은 "내가 몇 등이냐"보다 "여기가 얼마나 큰 판이냐"를 먼저 보여주는 화면이다.
  // ⚠️ 예전엔 내 지역(`myCode.region ? 'my-region' : 'global'`)이었다. 그 탓에 첫 화면이 사람 몇 명뿐인
  //    좁은 보드였고, 프로필(국가·지역) 조회가 끝날 때까지 보드 조회 자체를 미뤄야 해서 첫 화면도 늦었다.
  //    상수가 되면서 그 대기(profileReady 게이트)도 같이 없앴다 — 내 지역은 탭으로 한 번 누르면 된다.
  const defaultScope: Scope = 'global'
  const scope = picked ?? defaultScope

  useEffect(() => {
    if (!uid || !isFullUser) return
    let alive = true
    supabase
      .from('profiles')
      .select('country_code,region_code')
      .eq('id', uid)
      .maybeSingle()
      .then(({ data }) => {
        if (!alive) return
        setProfile({ uid, country: data?.country_code ?? null, region: data?.region_code ?? null })
      })
    return () => {
      alive = false
    }
  }, [uid, isFullUser])

  // 보드 조회 — 랭킹은 공개라 비로그인도 전세계 탭은 본다(서버가 me 만 비움).
  const cacheKey = `${isFullUser ? 'u' : 'g'}:${scope}`
  useEffect(() => {
    if (loading) return
    if (boards[cacheKey] || errs[cacheKey]) return
    let alive = true
    callFunction<HofResponse>('leaderboard', { scope })
      .then((d) => {
        if (alive) setBoards((prev) => ({ ...prev, [cacheKey]: d }))
      })
      .catch(() => {
        if (alive) setErrs((prev) => ({ ...prev, [cacheKey]: true }))
      })
    return () => {
      alive = false
    }
  }, [scope, cacheKey, loading, boards, errs])

  // ── 이어보기(무한 스크롤) ────────────────────────────────────────────────
  // 첫 화면은 위 effect 가 TOP 10 을 받고, 그 뒤는 커서로 50명씩 이어 붙인다.
  //   ⚠️ 탭마다 따로 쌓는다(cacheKey) — 탭을 옮겼다 돌아오면 봤던 만큼 그대로 남는다.
  //   ⚠️ 총원·내 순위·백분위는 다시 받지 않는다. 그 계산이 랭킹 조회를 285ms 로 만드는 부분이고
  //      첫 화면이 이미 받은 값이다.
  const [more, setMore] = useState<Record<string, HofUser[]>>({})
  const [cursors, setCursors] = useState<Record<string, HofCursor | null>>({})
  const [paging, setPaging] = useState(false)
  const pagingRef = useRef(false)

  const loadMore = async (key: string, board: Scope) => {
    if (pagingRef.current) return
    // 커서가 아직 없으면 첫 화면 응답의 것을 쓴다. null 이 **명시적으로** 들어와 있으면 끝까지 본 것이다.
    const cur = key in cursors ? cursors[key] : (boards[key]?.cursor ?? null)
    if (!cur) return
    pagingRef.current = true
    setPaging(true)
    try {
      const r = await callFunction<{ rows: HofUser[]; cursor: HofCursor | null }>('leaderboard', {
        scope: 'page', board, cursor: { score: cur.score, at: cur.at, id: cur.id }, startRank: cur.rank + 1, limit: 50,
      })
      setMore((prev) => ({ ...prev, [key]: [...(prev[key] ?? []), ...(r.rows ?? [])] }))
      // 받은 게 없으면 커서를 null 로 박아 더 이상 요청하지 않는다.
      setCursors((prev) => ({ ...prev, [key]: (r.rows?.length ?? 0) > 0 ? r.cursor : null }))
    } catch {
      // 실패는 조용히 둔다 — 다음 스크롤에서 다시 시도된다(이미 보고 있는 목록은 그대로다).
    } finally {
      pagingRef.current = false
      setPaging(false)
    }
  }

  // 탭 라벨: 전세계는 고정, 국가·지역은 **실제 이름**(대한민국 · 서울). 코드가 없으면 일반 라벨로 폴백.
  const labelOf = (s: Scope): string => {
    if (s === 'global') return t('rank.tab_world')
    if (s === 'my-country') return myCode.country ? countryName(myCode.country, lang) : t('rank.tab_country')
    if (!myCode.region) return t('rank.tab_region')
    const nm = t(`region.${myCode.region}`)
    return nm === `region.${myCode.region}` ? myCode.region : nm
  }

  const data = boards[cacheKey] ?? null
  const err = !!errs[cacheKey]

  // 제목 블록 — 시상대가 보일 땐 시상대 그림의 '날개 사이'에 얹히고(PersonalBoard),
  // 로딩·빈 보드·안내 화면에선 평범한 헤더로 그린다. 어느 상태에서도 제목이 사라지지 않게.
  // 부제('전체 TOP 10' / '경기도 TOP 10')는 제거했다 — 어느 보드인지는 위 탭바가 이미 말해준다.
  const titleNode = <h1 className="hof-title">{t('rank.hall')}</h1>

  // 4~10위 창 안에서 내 행으로 스크롤 — 하단 '내 순위' 바를 탭했을 때(게임 리더보드 관습).
  const listRef = useRef<HTMLDivElement>(null)
  const jumpToMe = () => {
    listRef.current?.querySelector('[data-me-anchor]')?.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }

  const gated = !!(data?.needsAuth || data?.needsRegion)

  // 보드에서 사람을 누르면 그 사람 카드(PNG)를 **그때그때** 만들어 보여준다.
  //   · 저장하지 않는다 — TOP10 은 계속 바뀌어서 저장하는 순간 낡는다.
  //   · 국가·지역 순위만 따로 받는다(아래 pickCard) — 목록 행에는 그 보드의 순위 하나뿐이다.
  //   · publicOnly=true → 가입일·초대코드처럼 랭킹 화면에 없던 개인 정보는 안 그린다.
  const [cardOf, setCardOf] = useState<HofUser | null>(null)
  // 국가·지역 순위는 목록 행에 없다(전세계 보드는 전세계 순위만 안다) → 카드를 열 때 그 사람 것만 따로 받는다.
  //   ⚠️ 목록을 그릴 때 미리 받지 않는다 — TOP10 이면 사람마다 두 번씩, 스크롤할 때마다 다시 조회하게 된다.
  const [cardRanks, setCardRanks] = useState<CardScoped | null>(null)
  async function pickCard(u: HofUser) {
    setCardOf(u)
    setCardRanks(null)
    if (!u.uid) return
    try { setCardRanks(await scopedForCard(u.uid, lang)) } catch { /* 못 받으면 '—' 로 나간다 — 카드는 이미 떠 있다 */ }
  }
  const cardData: ShareCardData | null = cardOf
    ? {
        lang,
        name: cardOf.name,
        avatarUrl: avatarUrlOf(cardOf),
        seed: cardOf.name,
        percentile: cardOf.percentile,
        rank: cardOf.rank,
        rankTotal: data?.total ?? null,
        countryRank: cardRanks?.countryRank ?? null, countryTotal: cardRanks?.countryTotal ?? null,
        regionRank: cardRanks?.regionRank ?? null, regionTotal: cardRanks?.regionTotal ?? null,
        country: cardRanks?.country ?? null,
        region: cardRanks?.region ?? null,
        seasonTotal: cardOf.rating,
        joinedAt: null,
        referralCode: null, // 남의 카드에 내 초대 코드를 박지 않는다
        publicOnly: true,
        // 그 사람이 입고 있는 캐릭터·배경. 랭킹 시상대에 이미 보이는 그림이라 새로 노출되는 건 없다.
        character: cardOf.character,
        skin: cardOf.skin,
        // 캐릭터 레벨은 서버가 따로 안 준다 — 시즌 총점에서 파생하는 값이라 여기서 계산한다
        // (허브가 자기 화면에 쓰는 것과 **같은 함수**라 두 화면의 캐릭터 모습이 어긋나지 않는다).
        charLevel: arenaLevelForScore(cardOf.rating),
      }
    : null

  // 레이아웃 = 한 화면 고정 틀.
  //   고정: 뒤로가기 → 탭바 → 엠블럼 → 제목 → 시상대   (제목은 시상대 그림에 박혀 있어 분리 불가)
  //   스크롤: 4~10위 리스트 하나 (.hof-listwin — 눌린 홈 모양의 '창')
  //   고정: 내 순위 바 (창 밖이라 순위 행과 겹칠 수 없다)
  return (
    <div className="wrap hof-wrap">
      {/* 랭킹 진입점이 허브(CARI) 도크 CTA 라 뒤로가기도 허브로 */}
      <TopBar to="/hub" label={t('common.my_home')} />

      {/* 제목은 페이지 전체의 제목이라 탭바 **위**, 전체 폭 가운데다.
          (한때 본문 안에 있었는데, 2단이 되면서 왼쪽 칸 안에 갇혀 화면 기준으로 왼쪽에 치우쳐 보였다.
           위계도 이쪽이 맞다 — 제목 → 보드 고르는 탭 → 내용) */}
      <header className="hof-head">{titleNode}</header>

      <div className="hof-tabs" role="tablist">
        {SCOPES.map((s) => (
          <button
            key={s}
            role="tab"
            aria-selected={scope === s}
            className={`hof-tab ${scope === s ? 'on' : ''}`}
            onClick={() => setPicked(s)}
          >
            {labelOf(s)}
          </button>
        ))}
      </div>

      {/* 방패 엠블럼은 뺐다 — 시상대 1등 링에 이미 왕관이 얹혀 있어 중복이고,
          한 화면 고정 틀에서 110px 을 먹어 4~10위 창이 1줄밖에 안 남았다(2026-08-03). */}

      {/* 본문 래퍼 — 폰에서는 display:contents 라 아무것도 안 하고(지금까지의 세로 흐름 그대로),
          데스크톱에서만 2단 그리드가 된다: 왼쪽 제목+시상대 / 오른쪽 4~10위+내 순위 바.
          래퍼가 필요한 이유 = 두 칸에 들어갈 요소(head·podium·listwin·mebar)가 조건부 분기 세 갈래에
          흩어져 있어서, 공통 부모 없이는 그리드 영역을 지정할 수가 없다. */}
      <div className="hof-body">
      {data?.needsAuth ? (
        <>
          <div className="panel-card" style={{ textAlign: 'center' }}>
            <p style={{ color: 'var(--muted)', fontSize: 14 }}>{t('rank.scope_guest')}</p>
            <button
              className="btn-ink"
              onClick={() => loginWithGoogle(`${window.location.origin}/ranking`)}
              style={{ marginTop: 12, border: 'none', cursor: 'pointer' }}
            >
              {t('rank.guest_login')}
            </button>
          </div>
        </>
      ) : data?.needsRegion ? (
        <>
          <div className="panel-card" style={{ textAlign: 'center' }}>
            <p style={{ color: 'var(--muted)', fontSize: 14 }}>{t('rank.scope_no_region')}</p>
            <Link to="/onboarding" className="btn-ink" style={{ display: 'inline-block', marginTop: 12, textDecoration: 'none' }}>
              {t('rank.scope_set_region')}
            </Link>
          </div>
        </>
      ) : (
        <PersonalBoard
          t={t} lang={lang} data={data} err={err} listRef={listRef} onPick={pickCard}
          more={more[cacheKey] ?? []}
          hasMore={(cacheKey in cursors ? cursors[cacheKey] : (data?.cursor ?? null)) != null}
          paging={paging}
          onNeedMore={() => loadMore(cacheKey, scope)}
        />
      )}

      {data && !gated ? (
        <MeBar t={t} data={data} isFullUser={isFullUser} loginWithGoogle={loginWithGoogle} onJumpToMe={jumpToMe} />
      ) : null}
      </div>

      {cardData ? (
        <ShareCardModal
          data={cardData}
          title={`${cardOf?.name} 카드`}
          readOnly
          // 카드 아래 '방 보기' — 상위 랭커 방으로 들어가는 길이다.
          roomHandle={cardOf?.uid ?? null}
          onClose={() => { setCardOf(null); setCardRanks(null) }}
        />
      ) : null}
    </div>
  )
}

// ===== 하단 고정 '내 순위' 바 — 스크롤 영역 바깥이라 순위 행과 겹치지 않는다 =====
function MeBar({
  t,
  data,
  isFullUser,
  loginWithGoogle,
  onJumpToMe,
}: {
  t: TFunc
  data: HofResponse
  isFullUser: boolean
  loginWithGoogle: (redirect: string) => void
  onJumpToMe: () => void
}) {
  const me = data.me
  const total = data.total ?? 0
  const mePct = me?.percentile != null ? Math.max(1, Math.round(me.percentile * 100)) : me && total > 0 ? Math.max(1, Math.round((me.rank / total) * 100)) : 0
  // '눌러서 내 행으로'는 내가 **창 안(4~10위)** 에 있을 때만 성립한다.
  // TOP 3 는 시상대에 고정 노출이라 이동할 게 없고, 10위 밖이면 애초에 보드에 없다.
  const inList = data.top.slice(3).some((u) => u.me)

  if (!isFullUser) {
    return (
      <div className="hof-mebar unranked">
        <div className="nm unr">{t('rank.guest_bar')}</div>
        <button
          className="hof-mebar-cta"
          onClick={() => loginWithGoogle(`${window.location.origin}/ranking`)}
          style={{ border: 'none', background: 'none', cursor: 'pointer' }}
        >
          {t('rank.guest_login')}
        </button>
      </div>
    )
  }
  if (!me) {
    return (
      <div className="hof-mebar unranked">
        <div className="nm unr">{t('rank.unplaced')}</div>
        <Link to="/test/select" className="hof-mebar-cta">{t('rank.cta_test')}</Link>
      </div>
    )
  }
  return (
    <div className="hof-mebar">
      <div
        className={`hof-bar ${inList ? 'jump' : ''}`}
        {...(inList
          ? {
              role: 'button' as const,
              tabIndex: 0,
              onClick: onJumpToMe,
              onKeyDown: (e: React.KeyboardEvent) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault()
                  onJumpToMe()
                }
              },
            }
          : {})}
      >
        <img src="/ranking/tierbar.png" alt="" className="bar-frame" />
        <span className="bar-rk" data-digits={String(me.rank).length}>{me.rank}</span>
        <span className="bar-ava"><Avatar avatarUrl={avatarUrlOf(me)} seed={me.name} size={48} /></span>
        <span className="bar-nm">
          {me.name}
          {/* 모수가 적으면 백분위 자체를 감춘다 — 3명뿐인데 1등이 '상위 33%' 로 찍히면 오히려 못한 것처럼 읽힌다.
              대체 문구("N명 중 M위")도 넣지 않는다: 사람이 모이면 그때 조용히 나타나는 게 낫다(scoring.ts 참고). */}
          {showPercentile(total) && <small>{t('rank.top_label')} {mePct}%</small>}
        </span>
        <span className="bar-pt">{t('rank.pt', { n: me.rating })}</span>
      </div>
    </div>
  )
}

// ===== 개인 리더보드 본문(시상대 + 4~10위) — 세 범위가 같은 뷰를 공유한다.
//       '내 순위' 바는 스크롤 영역 밖이라 여기 없다(MeBar).
//       제목도 여기 없다 — 탭바 위 페이지 헤더로 올라갔다(Ranking 본체). =====
function PersonalBoard({
  t,
  lang,
  data,
  err,
  listRef,
  more,
  hasMore,
  paging,
  onNeedMore,
  onPick,
}: {
  t: TFunc
  lang: string
  data: HofResponse | null
  err: boolean
  listRef: React.RefObject<HTMLDivElement | null>
  more: HofUser[]
  hasMore: boolean
  paging: boolean
  onNeedMore: () => void
  onPick: (u: HofUser) => void
}) {
  const top = data?.top ?? []
  const podium = [top[1], top[0], top[2]] // 2 · 1 · 3
  const podClass = ['p2', 'p1', 'p3']
  const rest = top.slice(3)

  // ⚠️ **창이 아직 안 넘치면 스크롤 이벤트가 영영 안 온다** → 넘칠 때까지 미리 채운다.
  //    첫 화면은 4~10위 7줄뿐이라 창을 못 채우는 경우가 흔하고(데스크톱 2단이 늘 그렇다),
  //    그러면 onScroll 이 한 번도 안 불려 무한 스크롤이 **시작조차 못 한다**(2026-08-25 실측:
  //    1920×911 에서 창 662px / 내용 662px → 스크롤 0).
  //    ⚠️ 멈추는 건 위 CSS 상한이다 — 한 페이지(50명)만 붙으면 어느 화면에서든 창을 넘어
  //       이 효과가 손을 떼고 그 뒤는 onScroll 이 이어받는다. 상한을 풀면 영영 안 넘쳐서 계속 받는다.
  useEffect(() => {
    if (!hasMore || paging) return
    const el = listRef.current
    if (!el) return
    if (el.scrollHeight - el.clientHeight < 40) onNeedMore()
  }, [hasMore, paging, more.length, listRef, onNeedMore])

  return (
    <>
      {err ? (
        <>
          <div className="panel-card" style={{ textAlign: 'center', color: 'var(--muted)' }}>
            {t('result.load_failed')}
          </div>
        </>
      ) : !data ? (
        <>
          <div className="panel-card" style={{ textAlign: 'center', color: 'var(--muted)' }}>{t('common.loading')}</div>
        </>
      ) : top.length === 0 ? (
        <>
          <div className="panel-card" style={{ textAlign: 'center' }}>
            <p style={{ color: 'var(--muted)', fontSize: 14 }}>{t('rank.no_record')}</p>
            <Link to="/test/select" className="btn-ink" style={{ display: 'inline-block', marginTop: 12, textDecoration: 'none' }}>
              {t('rank.cta_test')}
            </Link>
          </div>
        </>
      ) : (
        <>
          {/* === 시상대 TOP 3 ===
              그림 = public/ranking/podium.png. 아바타는 각 단 **위에 떠서** 윗면에 살짝 걸치고,
              이름·점수는 그림 **아래** 3칸에 둔다(새 그림엔 글자를 얹을 빈 면이 없다 — 단 앞면은
              큼직한 1·2·3 숫자가 차지한다). 둘 다 그림 기준 %좌표(실측값은 ranking.css 주석).
              글자 크기는 cqw 라 그림과 같이 줄어든다. */}
          <div className="hof-podium">
            <div className="hof-podium-art">
              <img src="/ranking/podium-gara-2026.png" alt="" className="hof-podium-img" />
              {podium.map((u, i) =>
                u && flagUrl(u.country) ? (
                  <span key={`flag-${u.rank}`} className={`hof-podium-flag ${podClass[i]}`} aria-hidden="true">
                    <span className="hof-flag-cloth">
                      <img src={flagUrl(u.country) as string} alt="" loading="lazy" decoding="async" />
                    </span>
                    <span className="hof-flag-pole" />
                  </span>
                ) : null,
              )}
              {podium.map((u, i) =>
                u ? (
                  <button
                    key={u.rank}
                    type="button"
                    className={`hof-slot ${podClass[i]}`}
                    onClick={() => onPick(u)}
                    aria-label={`${u.name} 카드 보기`}
                    {...(u.me ? { 'data-me-anchor': '1' } : {})}
                  >
                    <Avatar avatarUrl={avatarUrlOf(u)} seed={u.name} size={120} />
                  </button>
                ) : null,
              )}
            </div>
            {/* 이름·점수 = 그림 아래 3칸. 각 칸은 단 중심 %에 맞춰 절대배치라 그림이 줄어도 안 어긋난다. */}
            <div className="hof-podium-names">
              {podium.map((u, i) =>
                u ? (
                  <div key={`pl${u.rank}`} className={`hof-pn ${podClass[i]}`}>
                    {/* 이름과 국기는 한 줄에 나란히. 국기를 이름 텍스트 **안**에 넣으면 안 된다 —
                        칸이 26% 폭 + 말줄임이라 이름이 길어지는 순간 국기부터 잘려 나간다.
                        형제로 두고 국기에 flex:none 을 주면 이름만 줄어든다(css 참고). */}
                    <b>
                      <span className="hof-pn-name">{u.name}</span>
                      {flagUrl(u.country) ? (
                        <img
                          className="hof-pn-flag"
                          src={flagUrl(u.country)}
                          alt={countryName(u.country as string, lang)}
                          title={countryName(u.country as string, lang)}
                          loading="lazy"
                          decoding="async"
                        />
                      ) : null}
                    </b>
                    <span>{t('rank.pt', { n: u.rating })}</span>
                  </div>
                ) : null,
              )}
            </div>
          </div>

          {/* === 4 ~ 10 — 화면에서 유일하게 스크롤되는 '창' ===
              4위 이하가 아예 없으면(지역 보드처럼 인원이 3명 이하) 창을 아예 그리지 않는다.
              빈 창은 큰 빈 상자(세로 고정 시절) 아니면 얇은 선(2단 이후)이라 둘 다 사고처럼 보인다. */}
          {rest.length > 0 ? (
            <div
              className="hof-listwin"
              ref={listRef}
              // ⚠️ **바닥에 닿기 전에 미리 당겨온다.** 한 페이지 왕복이 780ms 라(DB 는 16~36ms,
              //    나머지는 함수 왕복) 바닥에서 요청하면 사용자가 그 시간을 그대로 기다린다.
              //    남은 스크롤이 한 화면 반 이하일 때 미리 부르면 지연이 안 느껴진다.
              onScroll={(e) => {
                if (!hasMore || paging) return
                const el = e.currentTarget
                if (el.scrollHeight - el.scrollTop - el.clientHeight < el.clientHeight * 1.5) onNeedMore()
              }}
            >
              <div className="hof-list">
                {rest.concat(more).map((u) => (
                  <HofRow key={u.rank} u={u} t={t} lang={lang} onPick={onPick} />
                ))}
              </div>
              {/* 더 있는데 아직 안 받았을 때만 알린다. 끝까지 봤으면 아무것도 안 그린다 —
                  '끝' 같은 문구를 넣으면 3만5천 명 목록에서 그 줄만 계속 눈에 걸린다. */}
              {paging ? <div className="hof-more">{t('rank.loading_more')}</div> : null}
            </div>
          ) : null}
        </>
      )}
    </>
  )
}

// 4~10위 한 행 = 티어리스트 바 프레임 하나.
// 그림의 소켓 배치대로: 큰 원=순위 · 작은 원=아바타 · 가운데 빈칸=이름·점수 · 방패=티어 엠블렘.
function HofRow({ u, t, lang, onPick }: { u: HofUser; t: TFunc; lang: string; onPick: (u: HofUser) => void }) {
  return (
    <div className={`hof-row ${u.me ? 'me' : ''}`} {...(u.me ? { 'data-me-anchor': '1' } : {})}>
      <div
        className="hof-bar jump"
        role="button"
        tabIndex={0}
        aria-label={`${u.name} 카드 보기`}
        onClick={() => onPick(u)}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onPick(u) } }}
      >
        <img src="/ranking/tierbar.png" alt="" className="bar-frame" />
        <span className="bar-rk" data-digits={String(u.rank).length}>{u.rank}</span>
        <span className="bar-ava"><Avatar avatarUrl={avatarUrlOf(u)} seed={u.name} size={48} /></span>
        <span className="bar-nm">
          {/* 이름 텍스트를 span 으로 감싸는 이유 = 국기·'나' 배지와 같은 flex 줄에서
              **이름만** 줄어야 하기 때문이다(이름판 소켓 폭이 48% 로 고정이다). */}
          <span className="bar-nm-txt">{u.name}</span>
          {flagUrl(u.country) ? (
            <img
              className="bar-flag"
              src={flagUrl(u.country)}
              alt={countryName(u.country as string, lang)}
              title={countryName(u.country as string, lang)}
              loading="lazy"
              decoding="async"
            />
          ) : null}
          {u.me ? <span className="meflag">{t('rank.you')}</span> : null}
        </span>
        <span className="bar-pt">{t('rank.pt', { n: u.rating })}</span>
      </div>
    </div>
  )
}
