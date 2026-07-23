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
  const { t } = useT()
  const navigate = useNavigate()
  const { isFullUser, loginWithGoogle } = useAuth()
  const [rows, setRows] = useState<EbookRow[] | null>(null)
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const [msg, setMsg] = useState('')

  useEffect(() => {
    callFunction<EbookListResp>('ebooks', { action: 'store' })
      .then((r) => setRows(r.ebooks))
      .catch((e) => setErr(e instanceof Error ? e.message : '이북을 불러올 수 없습니다.'))
  }, [isFullUser])

  async function buy(b: EbookRow) {
    if (!isFullUser) {
      try { sessionStorage.setItem('postLoginRedirect', '/ebooks') } catch { /* 무시 */ }
      void loginWithGoogle(`${window.location.origin}/auth/callback`)
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

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
            {(rows ?? []).map((b) => (
              <article key={b.id} className="bg-surface-container-lowest rounded-2xl p-5 border border-outline-variant/30 ambient-shadow ambient-shadow-hover transition-all duration-300 flex gap-5">
                <EbookCover title={b.title} coverUrl={b.coverUrl} className="w-[104px] shrink-0" />
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

      <SiteFooter />
    </div>
  )
}
