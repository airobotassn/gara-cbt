// 이북 뷰어 (/ebooks/read/:id) — 구매한 이북 HTML 을 전체화면 iframe 으로 연다.
//   본문은 비공개 버킷이라 ebooks 함수가 소유 확인 후 발급한 서명 URL(1시간)만 열 수 있다.
//   ⚠️ 서명 URL 을 iframe src 에 그대로 물리면 안 된다 — Supabase Storage 는 HTML 을
//      `text/plain` + `nosniff` 로 내려보내(스토리지 도메인 XSS 방지) 소스코드가 그대로 보인다.
//      그래서 여기서 텍스트로 받아 srcdoc 으로 넣는다(그래서 단일 HTML 파일 원칙 — 상대경로 리소스는 못 씀).
//   상단 얇은 바(뒤로 + 제목)는 미니게임 플레이 화면과 같은 형태.
import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useAuth } from '../context/AuthProvider'
import { callFunction } from '../lib/supabase'
import { useT } from '../lib/i18n'
import { EBOOK_LANG_LABEL } from '../lib/ebookTranslate'
import type { EbookReadResp } from '../lib/types'

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
            try { sessionStorage.setItem('postLoginRedirect', `/ebooks/read/${id ?? ''}`) } catch { /* 무시 */ }
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
          onClick={() => navigate('/mypage/ebooks')}
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
          이 <style> 은 컴포넌트가 언마운트되면 사라지므로 다른 화면 인쇄에는 영향이 없다. */}
      <style>{'@media print{body{display:none!important}}'}</style>
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
          onClick={() => navigate('/mypage/ebooks')}
          aria-label={t('ebook.reader_back')}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
            padding: '7px 13px 7px 10px',
            borderRadius: 999,
            border: '1px solid #d9e0f0',
            background: '#fff',
            color: '#28324c',
            fontWeight: 800,
            fontSize: 13.5,
            cursor: 'pointer',
          }}
        >
          <span style={{ fontSize: 15, lineHeight: 1 }}>‹</span> {t('ebook.reader_back')}
        </button>
        <strong style={{ fontSize: 15, color: '#28324c', letterSpacing: '-.01em' }}>{book?.title ?? ''}</strong>
        {book?.author && <span style={{ fontSize: 11.5, color: '#7c869e', fontWeight: 700 }}>{book.author}</span>}
        {/* 번역본이 있는 책만 언어 선택을 띄운다(한 언어뿐이면 고를 게 없다). */}
        {(book?.langs?.length ?? 0) > 1 && (
          <select
            value={book?.lang ?? readLang}
            onChange={(e) => setReadLang(e.target.value)}
            aria-label={t('ebook.reader_lang')}
            style={{
              marginLeft: 'auto',
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
