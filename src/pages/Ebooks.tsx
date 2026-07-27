// 이북 스토어 (/ebooks) — 관리자가 등록한 이북을 구매하는 화면.
//   ⚠️ 결제(PG) 미연동: '구매하기'를 누르면 ebooks 함수가 즉시 열람 권한을 지급한다(데모).
//      실제 결제가 붙으면 이 버튼 뒤에 결제창을 끼우고 ebooks/buy 에 paymentRef 를 넘기면 된다.
//   구매한 책을 읽는 곳은 여기가 아니라 마이페이지 › 이북 서재(/mypage/ebooks).
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthProvider'
import { callFunction } from '../lib/supabase'
import { useT } from '../lib/i18n'
import SiteFooter from '../components/SiteFooter'
import EbookCover from '../components/EbookCover'
import type { EbookListResp, EbookRow } from '../lib/types'

export default function Ebooks() {
  const { t, lang } = useT()
  const navigate = useNavigate()
  const { isFullUser } = useAuth()
  const [rows, setRows] = useState<EbookRow[] | null>(null)
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const [msg, setMsg] = useState('')
  // 비로그인이 구매를 누르면 곧장 OAuth 로 튕기지 않고 이 모달을 먼저 띄운다.
  const [loginOpen, setLoginOpen] = useState(false)
  // 표지 확대 — 목록 썸네일은 어떤 기기에서든 표지 글자까지 읽히진 않는다(표지가 문서형 디자인).
  // 기종별로 크기를 맞추는 대신, 탭하면 화면 가득 띄워 준다.
  const [zoom, setZoom] = useState<EbookRow | null>(null)

  useEffect(() => {
    callFunction<EbookListResp>('ebooks', { action: 'store', lang })
      .then((r) => setRows(r.ebooks))
      .catch((e) => setErr(e instanceof Error ? e.message : '이북을 불러올 수 없습니다.'))
  }, [isFullUser, lang])

  // 모달은 Esc 로도 닫는다.
  useEffect(() => {
    if (!loginOpen && !zoom) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      setLoginOpen(false)
      setZoom(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [loginOpen, zoom])

  // 로그인 수단이 구글만이 아니라서(카카오도 있음) 특정 provider 를 호출하지 않고 로그인 페이지로 보낸다.
  //   /login 이 어느 수단으로 로그인하든 AuthCallback 이 이 키를 읽어 스토어로 되돌린다.
  function goLogin() {
    try { sessionStorage.setItem('postLoginRedirect', '/ebooks') } catch { /* 무시 */ }
    navigate('/login')
  }

  async function buy(b: EbookRow) {
    if (!isFullUser) {
      setLoginOpen(true) // 바로 OAuth 로 튕기지 않고 모달로 한 번 받아준다
      return
    }
    setBusy(b.id)
    setMsg('')
    try {
      await callFunction('ebooks', { action: 'buy', id: b.id })
      setRows((prev) => prev?.map((x) => (x.id === b.id ? { ...x, owned: true } : x)) ?? prev)
      setMsg(t('ebook.bought'))
    } catch (e) {
      setMsg(e instanceof Error ? e.message : t('ebook.load_failed'))
    } finally {
      setBusy(null)
    }
  }

  const loading = !err && rows === null

  return (
    <div className="bg-background text-on-background min-h-screen relative overflow-x-hidden flex flex-col">
      <main className="flex-grow px-margin-mobile md:px-margin-desktop pb-24 pt-12 relative">
        <div
          className="fixed inset-0 mesh-gradient-bg -z-10 pointer-events-none"
          style={{ maskImage: 'linear-gradient(to bottom, white 0%, white 300px, transparent 600px)', WebkitMaskImage: 'linear-gradient(to bottom, white 0%, white 300px, transparent 600px)', opacity: 0.15 }}
        ></div>

        <div className="max-w-5xl mx-auto w-full relative z-10">
          <header className="mb-8 md:mb-12">
            <h1 className="font-display-lg text-4xl md:text-display-lg font-bold text-on-surface mb-3 tracking-tight break-keep">{t('ebook.store_title')}</h1>
            <p className="font-body-lg text-body-lg text-on-surface-variant">{t('ebook.store_sub')}</p>
          </header>

          {msg && (
            <div className="mb-6 rounded-xl border border-primary/20 bg-primary/5 px-5 py-3.5 font-body-md text-primary">{msg}</div>
          )}
          {!isFullUser && !loading && (
            <div className="mb-6 rounded-xl border border-outline-variant/40 bg-surface-container-low px-5 py-3.5 font-body-md text-on-surface-variant">{t('ebook.login_to_buy')}</div>
          )}

          {err && <div className="bg-surface-container-lowest rounded-2xl p-8 border border-outline-variant/30 text-center text-on-surface-variant">{err}</div>}
          {loading && <div className="bg-surface-container-lowest rounded-2xl p-12 border border-outline-variant/30 text-center text-on-surface-variant">{t('common.loading')}</div>}

          {!loading && !err && (rows?.length ?? 0) === 0 && (
            <div className="bg-surface-container-lowest rounded-2xl p-12 border border-outline-variant/30 text-center text-on-surface-variant">{t('ebook.empty_store')}</div>
          )}

          {/* 카드: 좁은 화면은 세로 스택 — 가로 배치를 유지하면 표지 폭이 화면의 40% 이하로 눌려
              어떤 기기에서도 표지 글자가 안 보인다. 640px 이상에서만 가로 배치. */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
            {(rows ?? []).map((b) => (
              <article key={b.id} className="bg-surface-container-lowest rounded-2xl p-5 border border-outline-variant/30 ambient-shadow ambient-shadow-hover transition-all duration-300 flex flex-col sm:flex-row gap-4 sm:gap-5">
                {/* self-start 필수 — flex 자식은 기본이 stretch 라 표지 박스가 카드 높이만큼 늘어나
                    표지 박스의 aspect 비율이 무시된다(모바일에서 0.47까지 찌그러졌다).
                    폭은 기기 크기가 아니라 카드 폭에 비례(모바일 = 카드의 62%, 상한 240px). */}
                <button
                  type="button"
                  onClick={() => setZoom(b)}
                  aria-label={t('ebook.cover_zoom')}
                  className="w-[62%] max-w-[240px] self-center sm:self-start sm:w-[184px] sm:max-w-none shrink-0 cursor-zoom-in"
                >
                  <EbookCover title={b.title} coverUrl={b.coverUrl} width={240} className="w-full" />
                </button>
                <div className="flex flex-col min-w-0 flex-1">
                  <h3 className="font-title-md text-lg font-bold text-on-surface break-keep mb-1">{b.title}</h3>
                  {b.author && <p className="font-body-sm text-[13px] text-outline mb-2">{b.author}</p>}
                  {b.description && (
                    <p className="font-body-md text-body-md text-on-surface-variant mb-3 line-clamp-3">{b.description}</p>
                  )}
                  <div className="mt-auto flex items-center justify-between gap-3 pt-2">
                    <span className="font-title-md text-[17px] font-bold text-on-surface">
                      {b.price > 0 ? `${b.price.toLocaleString('ko-KR')}원` : t('ebook.free')}
                    </span>
                    {b.owned ? (
                      <button
                        onClick={() => navigate('/mypage/ebooks')}
                        className="px-5 py-2.5 bg-secondary/10 text-secondary border border-secondary/20 font-label-md text-[14px] font-bold rounded-xl hover:bg-secondary/15 transition-colors flex items-center gap-1.5"
                      >
                        <span className="material-symbols-outlined text-[18px]">check</span>
                        {t('ebook.go_library')}
                      </button>
                    ) : (
                      <button
                        onClick={() => buy(b)}
                        disabled={busy === b.id}
                        className="px-5 py-2.5 bg-primary-container text-on-primary font-label-md text-[14px] font-bold rounded-xl hover:bg-primary transition-colors ambient-shadow disabled:opacity-60"
                      >
                        {busy === b.id ? t('ebook.processing') : b.price > 0 ? t('ebook.buy') : t('ebook.get_free')}
                      </button>
                    )}
                  </div>
                </div>
              </article>
            ))}
          </div>
        </div>
      </main>

      {/* 로그인 유도 모달 — 비로그인이 구매를 눌렀을 때. 배경 클릭·Esc·닫기로 취소(강제 이동 아님). */}
      {/* 표지 확대 — 배경 아무 데나 누르면 닫힌다. 원본을 그대로 띄우되 화면을 넘지 않게. */}
      {zoom && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm cursor-zoom-out"
          role="dialog"
          aria-modal="true"
          aria-label={zoom.title}
          onClick={() => setZoom(null)}
        >
          {zoom.coverUrl ? (
            <img
              src={zoom.coverUrl}
              alt={zoom.title}
              className="max-h-[92dvh] max-w-[min(100%,620px)] w-auto h-auto rounded-xl shadow-2xl"
            />
          ) : (
            <div className="w-[min(90vw,360px)]">
              <EbookCover title={zoom.title} coverUrl={null} className="w-full" />
            </div>
          )}
        </div>
      )}

      {loginOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-5 bg-black/40 backdrop-blur-sm"
          role="dialog"
          aria-modal="true"
          aria-labelledby="ebook-login-title"
          onClick={() => setLoginOpen(false)}
        >
          <div
            className="w-full max-w-xs bg-surface-container-lowest rounded-2xl border border-outline-variant/30 p-6 ambient-shadow text-center"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 id="ebook-login-title" className="font-title-md text-lg font-bold text-on-surface break-keep mb-5">
              {t('ebook.login_modal_title')}
            </h2>
            <button
              onClick={goLogin}
              className="w-full px-5 py-3 bg-primary-container text-on-primary font-label-md text-[15px] font-bold rounded-xl hover:bg-primary transition-colors ambient-shadow"
            >
              {t('common.login')}
            </button>
            <button
              onClick={() => setLoginOpen(false)}
              className="mt-2.5 w-full px-5 py-2.5 text-on-surface-variant font-label-md text-[14px] font-bold rounded-xl hover:text-primary transition-colors"
            >
              {t('common.close')}
            </button>
          </div>
        </div>
      )}

      <SiteFooter />
    </div>
  )
}
