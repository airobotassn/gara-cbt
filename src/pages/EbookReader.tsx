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
import type { EbookReadResp } from '../lib/types'

export default function EbookReader() {
  const { t } = useT()
  const navigate = useNavigate()
  const { id } = useParams<{ id: string }>()
  const { isFullUser, loading: authLoading, loginWithGoogle } = useAuth()
  const [book, setBook] = useState<EbookReadResp | null>(null)
  const [html, setHtml] = useState('')
  const [err, setErr] = useState('')

  useEffect(() => {
    if (authLoading || !isFullUser || !id) return
    let alive = true
    ;(async () => {
      try {
        const b = await callFunction<EbookReadResp>('ebooks', { action: 'read', id })
        if (!alive) return
        setBook(b)
        const res = await fetch(b.url)
        if (!res.ok) throw new Error(`본문을 불러오지 못했습니다 (${res.status})`)
        const text = await res.text()
        if (!alive) return
        setHtml(text)
        setErr('')
      } catch (e) {
        if (alive) setErr(e instanceof Error ? e.message : '이북을 불러올 수 없습니다.')
      }
    })()
    return () => {
      alive = false
    }
  }, [id, isFullUser, authLoading])

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
