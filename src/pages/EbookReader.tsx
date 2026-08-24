// 이북 뷰어 (/ebooks/read/:id) — 구매한 이북 HTML 을 전체화면 iframe 으로 연다.
//   본문은 비공개 버킷이라 ebooks 함수가 소유 확인 후 발급한 서명 URL(1시간)만 열 수 있다.
//   ⚠️ 서명 URL 을 iframe src 에 그대로 물리면 안 된다 — Supabase Storage 는 HTML 을
//      `text/plain` + `nosniff` 로 내려보내(스토리지 도메인 XSS 방지) 소스코드가 그대로 보인다.
//      그래서 여기서 텍스트로 받아 srcdoc 으로 넣는다(그래서 단일 HTML 파일 원칙 — 상대경로 리소스는 못 씀).
//   상단 얇은 바(뒤로 + 제목)는 미니게임 플레이 화면과 같은 형태.
import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useAuth } from '../context/AuthProvider'
import { callFunction } from '../lib/supabase'
import { useT } from '../lib/i18n'
import { EBOOK_LANG_LABEL } from '../lib/ebookTranslate'
import type { EbookReadResp } from '../lib/types'
import { rememberPostLogin } from '../lib/postLogin'

// ── 반출 억제 레이어 ────────────────────────────────────────────────────────────
// ⚠️ 완전 차단은 불가능하다(본문 HTML 이 이미 브라우저에 내려와 있어 devtools 로는 언제든 볼 수 있다).
//    목표는 "무심코 인쇄·복사하는 것을 막고, 유출되면 누구 것인지 남긴다".
//    이북 원본 파일은 건드리지 않고 srcdoc 에 넣기 직전에 스타일·스크립트를 덧붙인다
//    → 관리자가 올린 어떤 책에도 자동 적용된다.
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] as string)

/** 구매자 표식을 사선 타일로 반복하는 워터마크 배경(SVG data URI). */
function watermarkCss(mark: string): string {
  // 읽기를 방해하지 않을 만큼 옅게(.05) — 캡처본에서는 확대하면 식별된다.
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="460" height="260">` +
    `<text x="230" y="130" fill="rgba(20,30,60,.05)" font-size="15" font-weight="700" ` +
    `font-family="system-ui,sans-serif" text-anchor="middle" transform="rotate(-24 230 130)">${esc(mark)}</text></svg>`
  return `url("data:image/svg+xml;utf8,${encodeURIComponent(svg)}")`
}

// ── 모바일 폭 맞추기 ──────────────────────────────────────────────────────────
// 실제 이북은 A4 인쇄 레이아웃이다(`.page{width:210mm;height:297mm;overflow:hidden}` = 794px 고정,
// 글자 pt·여백 mm·절대배치). 390px 화면에 그대로 넣으면 오른쪽 404px 이 잘려 나가고 overflow:hidden
// 이라 스크롤로도 못 본다 — 실측으로 확인한 증상이다.
// → 콘텐츠 실폭을 재서 화면보다 넓을 때만 zoom 으로 축소해 한 페이지가 통째로 들어오게 한다.
//   · 스크롤/패닝이 아니라 zoom 인 이유: overflow:hidden 이라 패닝이 불가능하고, 인쇄 페이지는
//     '한 장을 통째로' 보는 게 원래 읽는 방식이다(PDF 리더와 동일).
//   · 글자가 작아지는 건 핀치 확대로 해결된다 — index.html 이 user-scalable 을 막지 않는다.
//   · 데스크톱(iframe 이 794px 보다 넓음)에서는 아무것도 하지 않는다.
//   · 웹폰트가 늦게 로드되면 레이아웃이 바뀌므로 load·fonts.ready·resize 에서 다시 잰다.
const FIT_SCRIPT =
  `var __fit=function(){var d=document.documentElement;d.style.zoom='';` +
  `var v=d.clientWidth,c=d.scrollWidth;if(c>v+2)d.style.zoom=(v/c).toFixed(4)};` +
  `__fit();window.addEventListener('load',__fit);window.addEventListener('resize',__fit);` +
  `window.addEventListener('orientationchange',__fit);` +
  `if(document.fonts&&document.fonts.ready)document.fonts.ready.then(__fit);` +
  `setTimeout(__fit,600);`

function protectHtml(raw: string, mark: string): string {
  const inject =
    `<style>` +
    // 인쇄: 본문을 통째로 숨긴다(Ctrl+P·메뉴 인쇄 모두 빈 페이지가 된다)
    `@media print{html,body{display:none!important}}` +
    // 복사·드래그 차단
    `html,body{-webkit-user-select:none;-ms-user-select:none;user-select:none;-webkit-touch-callout:none}` +
    // 구매자 워터마크(본문 위에 깔되 클릭은 통과)
    `#__wm{position:fixed;inset:0;z-index:2147483646;pointer-events:none;background-image:${watermarkCss(mark)};background-repeat:repeat}` +
    `</style><div id="__wm" aria-hidden="true"></div><script>(function(){` +
    `var stop=function(e){e.preventDefault();return false};` +
    `['contextmenu','copy','cut','selectstart','dragstart'].forEach(function(t){document.addEventListener(t,stop)});` +
    `document.addEventListener('keydown',function(e){var k=(e.key||'').toLowerCase();` +
    `if((e.ctrlKey||e.metaKey)&&(k==='p'||k==='s'||k==='c'||k==='x'||k==='u'||k==='a'))e.preventDefault()});` +
    `window.addEventListener('beforeprint',function(){document.documentElement.style.display='none'});` +
    `window.addEventListener('afterprint',function(){document.documentElement.style.display=''});` +
    FIT_SCRIPT +
    `})()</` + `script>` // 문자열에 </script> 가 그대로 들어가지 않게 쪼갠다
  return /<\/body>/i.test(raw) ? raw.replace(/<\/body>/i, `${inject}</body>`) : raw + inject
}

export default function EbookReader() {
  const { t, lang } = useT()
  const navigate = useNavigate()
  const { id } = useParams<{ id: string }>()
  const { user, isFullUser, loading: authLoading, loginWithGoogle } = useAuth()
  const [book, setBook] = useState<EbookReadResp | null>(null)
  const [html, setHtml] = useState('')
  const [err, setErr] = useState('')
  // 읽을 언어. 기본 = 화면 언어(번역본이 없으면 서버가 한국어로 폴백해 준다).
  //   화면 언어 타입(Lang)에 묶지 않는다 — 책이 가진 언어 목록에서 고르는 값이라 서버가 판정한다.
  const [readLang, setReadLang] = useState<string>(lang)
  useEffect(() => { setReadLang(lang) }, [lang])

  useEffect(() => {
    if (authLoading || !isFullUser || !id) return
    let alive = true
    setHtml('')
    ;(async () => {
      try {
        const b = await callFunction<EbookReadResp>('ebooks', { action: 'read', id, lang: readLang })
        if (!alive) return
        setBook(b)
        const res = await fetch(b.url)
        if (!res.ok) throw new Error(`본문을 불러오지 못했습니다 (${res.status})`)
        const text = await res.text()
        if (!alive) return
        // 워터마크 표식 = 구매자(이름 · 이메일) + 열람일. 유출본에서 누구 것인지 드러난다.
        const meta = (user?.user_metadata ?? {}) as Record<string, unknown>
        const who = String(meta.full_name ?? meta.name ?? '') || (user?.email ?? '')
        const mail = user?.email ?? ''
        const stamp = new Date().toLocaleDateString('sv-SE')
        setHtml(protectHtml(text, [who, mail !== who ? mail : '', stamp].filter(Boolean).join(' · ')))
        setErr('')
      } catch (e) {
        if (alive) setErr(e instanceof Error ? e.message : '이북을 불러올 수 없습니다.')
      }
    })()
    return () => {
      alive = false
    }
  }, [id, isFullUser, authLoading, user, readLang])

  // ── 전체화면 ────────────────────────────────────────────────────────────────
  // 레벨테스트(TestRunner)와 같은 브라우저 Fullscreen API. 다만 응시처럼 '전체화면으로 시작'
  // 게이트를 한 장 더 두진 않는다 — 서재에서 책을 누른 게 이미 시작이라, 화면을 하나 더 끼우면
  // 읽기 전에 확인창만 늘어난다. 대신 그 클릭의 사용자 제스처가 살아 있는 동안(마운트 직후)
  // 요청한다. 제스처가 만료돼 브라우저가 거절하면 헤더의 '전체화면' 버튼이 남는다.
  // 나가면 = 책을 덮은 것 → 곧장 서재로. ESC·F11·시스템 UI 어느 쪽으로 나가든 같다.
  const [fsOn, setFsOn] = useState(false)
  const enteredFsRef = useRef(false)
  const fsSupported = !!document.fullscreenEnabled

  const goLibrary = useCallback(() => {
    enteredFsRef.current = false // 아래 리스너가 서재로 한 번 더 보내지 않게
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => {})
    navigate('/mypage/ebooks')
  }, [navigate])

  useEffect(() => {
    if (authLoading || !isFullUser) return
    const onChange = () => {
      const on = !!document.fullscreenElement
      setFsOn(on)
      if (on) {
        enteredFsRef.current = true
        return
      }
      if (enteredFsRef.current) {
        enteredFsRef.current = false
        navigate('/mypage/ebooks')
      }
    }
    document.addEventListener('fullscreenchange', onChange)
    void document.documentElement.requestFullscreen?.().catch(() => {})
    return () => {
      // ⚠️ 리스너를 먼저 뗀 뒤에 나간다 — 안 그러면 다른 화면으로 떠나는 언마운트에서도
      //    전체화면 해제가 감지돼 방금 고른 목적지 대신 서재로 튕긴다.
      document.removeEventListener('fullscreenchange', onChange)
      if (document.fullscreenElement) void document.exitFullscreen().catch(() => {})
    }
  }, [authLoading, isFullUser, navigate])

  if (authLoading) {
    return <div className="wrap"><div className="card pad" style={{ textAlign: 'center', color: 'var(--muted)' }}>{t('common.loading')}</div></div>
  }

  // 로그인 게이트 — 이북은 구매자 전용이므로 게스트는 여기서 막는다.
  if (!isFullUser) {
    return (
      <div style={{ minHeight: '60vh', display: 'grid', placeItems: 'center', padding: 24, textAlign: 'center', gap: 12 }}>
        <p style={{ fontWeight: 800, color: 'var(--ink, #28324c)' }}>{t('ebook.login_to_buy')}</p>
        <button
          onClick={() => {
            rememberPostLogin(`/ebooks/read/${id ?? ''}`)
            void loginWithGoogle(`${window.location.origin}/auth/callback`)
          }}
          style={{ padding: '10px 20px', borderRadius: 999, border: 0, cursor: 'pointer', background: '#004ac6', color: '#fff', fontWeight: 800 }}
        >
          {t('common.login_google')}
        </button>
      </div>
    )
  }

  if (err) {
    return (
      <div style={{ minHeight: '60vh', display: 'grid', placeItems: 'center', padding: 24, textAlign: 'center', gap: 12 }}>
        <p style={{ fontWeight: 800, color: 'var(--ink, #28324c)' }}>{err}</p>
        <button
          onClick={goLibrary}
          style={{ padding: '10px 20px', borderRadius: 999, border: 0, cursor: 'pointer', background: '#004ac6', color: '#fff', fontWeight: 800 }}
        >
          {t('ebook.reader_back')}
        </button>
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100dvh', background: '#f4f6fb' }}>
      {/* 바깥(앱 셸)에서 인쇄를 걸어도 iframe 이 같이 찍히므로 뷰어가 떠 있는 동안은 페이지 자체를 인쇄에서 뺀다.
          이 <style> 은 컴포넌트가 언마운트되면 사라지므로 다른 화면 인쇄에는 영향이 없다.
          ⚠️ 헤더 반응형도 여기 둔다 — 이 화면은 전용 CSS 파일이 없고(인라인 스타일) 미디어쿼리는 인라인으로 못 쓴다.
             모바일(390px)에서 한 줄에 뒤로·제목·저자·언어 4개가 다 들어가 전부 눌렸다:
             뒤로 라벨이 두 줄로 깨지고(87→60px), 제목이 두 줄로 늘어 헤더가 본문을 잡아먹었다. */}
      <style>{`
        @media print{body{display:none!important}}
        /* 뒤로·언어는 절대 줄어들지 않는다. 줄어들 곳은 제목 하나뿐(말줄임). */
        .ebr-back{flex:none;white-space:nowrap}
        /* ⚠️ flex:1 을 주면 안 된다 — 데스크톱에서 제목이 남는 폭을 다 먹어 저자가 제목 옆이 아니라
           오른쪽 끝(언어 옆)으로 밀린다. 기본 flex-shrink 만으로 좁을 때 알아서 줄어든다. */
        .ebr-title{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
        .ebr-author{flex:none;white-space:nowrap}
        /* 전체화면 버튼과 언어 셀렉트는 둘 다 오른쪽 끝. 남는 폭은 먼저 나오는 auto 가 다 먹으므로
           둘 다 margin-left:auto 를 줘도 붙어서 선다(하나만 보일 때도 오른쪽 정렬 유지). */
        .ebr-fs{flex:none;margin-left:auto}
        .ebr-lang{flex:none;margin-left:auto}
        @media (max-width:600px){
          /* 좁으면 아이콘만 — 제목에 폭을 몰아준다 */
          .ebr-fs .lb{display:none}
          .ebr-fs{min-height:40px}
          /* 좁은 화면에선 제목에 폭을 몰아준다 — 저자는 목록·스토어에서 이미 보이므로 여기선 생략. */
          .ebr-author{display:none}
          /* 터치 타깃(권장 44px)에 맞춰 뒤로·셀렉트를 키운다. 데스크톱은 종전 크기 유지. */
          .ebr-back{min-height:40px}
          .ebr-lang{min-height:40px;padding-top:8px;padding-bottom:8px}
        }
      `}</style>
      <header
        style={{
          flex: '0 0 auto',
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          padding: '8px 12px',
          background: 'linear-gradient(#ffffff,#f4f6fb)',
          borderBottom: '1px solid #e6e9f3',
          boxShadow: '0 2px 8px rgba(80,100,150,.08)',
          zIndex: 2,
        }}
      >
        <button
          className="ebr-back"
          onClick={goLibrary}
          aria-label={t('ebook.reader_back')}
        >
          {/* 모양은 앱 공용 뒤로 칩(shared.css)이 준다 — 인라인 스타일로 다시 그리면 여기만 또 갈린다. */}
          <span className="material-symbols-outlined">arrow_back</span> {t('ebook.reader_back')}
        </button>
        <strong className="ebr-title" style={{ fontSize: 15, color: '#28324c', letterSpacing: '-.01em' }} title={book?.title ?? ''}>
          {book?.title ?? ''}
        </strong>
        {book?.author && <span className="ebr-author" style={{ fontSize: 11.5, color: '#7c869e', fontWeight: 700 }}>{book.author}</span>}
        {/* 자동 진입이 막혔을 때만 보이는 보조 버튼(전체화면이면 숨는다) — 이건 사용자 클릭이라 브라우저가 거절하지 않는다 */}
        {fsSupported && !fsOn && (
          <button
            className="ebr-fs"
            onClick={() => { void document.documentElement.requestFullscreen?.().catch(() => {}) }}
            aria-label={t('ebook.reader_fs')}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              padding: '7px 12px',
              borderRadius: 999,
              border: '1px solid #d9e0f0',
              background: '#fff',
              color: '#28324c',
              fontWeight: 800,
              fontSize: 13,
              cursor: 'pointer',
            }}
          >
            <span style={{ fontSize: 14, lineHeight: 1 }}>⛶</span>
            <span className="lb">{t('ebook.reader_fs')}</span>
          </button>
        )}
        {/* 번역본이 있는 책만 언어 선택을 띄운다(한 언어뿐이면 고를 게 없다). */}
        {(book?.langs?.length ?? 0) > 1 && (
          <select
            className="ebr-lang"
            value={book?.lang ?? readLang}
            onChange={(e) => setReadLang(e.target.value)}
            aria-label={t('ebook.reader_lang')}
            style={{
              padding: '6px 10px',
              borderRadius: 999,
              border: '1px solid #d9e0f0',
              background: '#fff',
              color: '#28324c',
              fontWeight: 700,
              fontSize: 13,
              cursor: 'pointer',
            }}
          >
            {book!.langs.map((lg) => (
              <option key={lg} value={lg}>
                {EBOOK_LANG_LABEL[lg] ?? lg}
              </option>
            ))}
          </select>
        )}
      </header>
      {html ? (
        <iframe
          srcDoc={html}
          title={book?.title ?? ''}
          // allow-same-origin 은 주지 않는다 — srcdoc 은 우리 오리진을 물려받으므로,
          // 책 안의 스크립트가 앱 세션(로컬스토리지의 Supabase 토큰)에 닿지 못하게 격리한다.
          sandbox="allow-scripts allow-popups allow-popups-to-escape-sandbox"
          style={{ flex: 1, width: '100%', border: 0, display: 'block', background: '#fff' }}
        />
      ) : (
        <div style={{ flex: 1, display: 'grid', placeItems: 'center', color: '#7c869e', fontWeight: 700 }}>{t('common.loading')}</div>
      )}
    </div>
  )
}
