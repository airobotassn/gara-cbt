import { useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { isMobileDevice } from '../lib/device'
import MobileBlock from '../components/MobileBlock'
import { sebPracticeLaunchUrl } from '../lib/seb'
import SebInstall from '../components/SebInstall'
import { useT } from '../lib/i18n'
import { callFunction } from '../lib/supabase'

// gara_3 (시험환경 테스트) 목업 디자인 그대로 + 실제 점검 로직(SEB 감지·환경체크·모의응시) 보존.
// 원본: stitch_design_critique_assistant/gara_3/code.html

// 무엇을 점검하는지 보여주는 목록일 뿐, **여기서 판정하지 않는다**(2026-08-25).
// ⚠️ ✔/✘ 를 되살리지 말 것 — 진짜 점검은 SEB 안(`/exam/envcheck`)에서 한다. 일반 브라우저에서
//    통과해도 SEB 에서 갈리는 항목이라, 여기서 초록 체크를 보여주면 '다 됐다'로 읽힌 뒤 뒤집힌다.
const CHECK_ITEMS = ['check.chk_pc', 'check.chk_screen', 'check.chk_fs', 'check.chk_net', 'check.chk_seb'] as const

export default function ExamCheck() {
  const navigate = useNavigate()
  const { t, lang } = useT()
  // 어느 응시권으로 점검하러 왔는지 — 응시권 카드가 `?ticket=` 로 넘긴다.
  // 없어도 된다(그냥 체험). 그때도 "이 PC 는 된다"는 사실은 남긴다.
  const [params] = useSearchParams()
  const ticketId = params.get('ticket')
  // 점검 기록 전송 중 — 중복 클릭과 '보냈는데 아직 안 끝남' 을 둘 다 막는다.
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  if (isMobileDevice()) return <MobileBlock />

  async function startPractice() {
    if (busy) return
    setBusy(true)
    setErr('')
    try {
      // ⛔ 점검 기록을 **여기서 남기지 않는다.** 예전엔 버튼을 누른 순간 기록해서, SEB 가 안 떠도
      //    "점검 완료" 가 됐다 — 정작 확인하려던 "이 PC 에서 SEB 가 뜨는가" 를 증명하지 못했다.
      //    대신 일회용 표를 받아 실행 링크에 실어 보내고, **SEB 안에서 그 표를 쓸 때** 서버가 기록한다.
      //    그러면 기록이 남았다는 것 자체가 SEB 가 떴다는 증거가 된다.
      const h = await callFunction<{ nonce: string }>('seb-handoff', {
        action: 'issue',
        purpose: 'envcheck',
        ...(ticketId ? { ticketId } : {}),
      })
      window.location.href = sebPracticeLaunchUrl(lang, h.nonce)
    } catch (e) {
      setErr(e instanceof Error ? e.message : t('prep.err_start'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="bg-background text-on-surface min-h-screen flex flex-col antialiased">
      {/* 헤더 없음 — FAB이 네비 */}
      <main className="flex-grow pt-12 pb-24 px-margin-mobile md:px-margin-desktop w-full max-w-container-max mx-auto">
        <div className="glass-panel rounded-2xl p-8 md:p-10 ambient-shadow flex flex-col gap-12 max-w-4xl mx-auto border-white/40">
          {/* Header */}
          <div className="flex flex-col items-center text-center gap-6">
            {/* 로고만 — 감싸던 원판(테두리·그림자·방사 그라디언트)과 동심원 2개는 제거(2026-08-05).
                object-contain: logo.webp 는 자체 여백이 39% 라 cover 로 채우면 행성이 잘린다. */}
            <img alt="CARIS Logo" className="w-44 aspect-square object-contain" src="/logo.webp" />
            <div>
              <h1 className="font-headline-lg-mobile md:font-headline-lg text-headline-lg-mobile md:text-headline-lg text-on-surface mb-4">{t('check.title')}</h1>
              <p className="font-body-lg text-body-lg text-on-surface-variant break-keep leading-relaxed max-w-2xl mx-auto">{t('check.sub')}</p>
            </div>
          </div>

          <div className="space-y-8">
            {/* 응시 환경 점검 — 자동 체크리스트와 SEB 실행 확인을 한 칸에 둔다(2026-08-25).
                ⚠️ 이 둘을 다시 쪼개지 말 것. 체크리스트 마지막 줄(보안 브라우저)에 답하는 게
                바로 아래 버튼이라, 나누면 같은 질문을 두 칸에서 두 번 묻는 꼴이 된다.
                ⚠️ 번호(1·2·3)도 되살리지 말 것 — 재응시자는 점검만 하면 되고 처음 온 사람은
                설치부터라, '순서대로 하라'는 번호가 둘 중 한쪽에게는 늘 틀린 말이 된다. */}
            <div className="p-8 rounded-2xl bg-surface-container-lowest border border-surface-container-highest shadow-sm hover:shadow-md transition-shadow">
              <div className="flex-grow">
                <h2 className="font-title-md text-title-md font-bold text-on-surface mb-2">{t('check.sec2_title')}</h2>
                <p className="font-body-md text-body-md text-on-surface-variant mb-6 leading-relaxed break-keep max-w-prose whitespace-pre-line">{t('check.sec2_desc')}</p>
                <ul className="space-y-3">
                  {CHECK_ITEMS.map((k) => (
                    <li key={k} className="flex items-center gap-3">
                      <span className="material-symbols-outlined text-outline text-[20px]">check_circle</span>
                      <span className="font-label-md text-label-md font-bold text-on-surface break-keep">{t(k)}</span>
                    </li>
                  ))}
                </ul>

                {/* 위 목록의 '보안 브라우저' 줄은 이 버튼을 눌러야만 답이 난다 — 그래서 목록 바로 밑이다.
                    누르면 SEB 가 뜨고, 그 안에서 같은 점검을 한 뒤 기록이 남는다(모의 문제는 없다). */}
                <div className="mt-8 pt-8 border-t border-surface-container-highest">
                  <button onClick={() => { void startPractice() }} disabled={busy} className="bg-primary-container text-on-primary font-title-md text-title-md px-8 py-3 rounded-xl hover:translate-y-[-2px] transition-transform duration-200 ambient-shadow inline-flex items-center justify-center gap-2 w-full md:w-auto font-bold">
                    <span className="material-symbols-outlined text-[20px]">play_arrow</span>
                    {t('check.sebtest_btn')}
                  </button>
                  {/* whitespace-pre-line — 사전의 \n 을 살린다. 한 줄로 길게 흐르면 안 읽힌다. */}
                  <p className="font-body-md text-body-md text-on-surface-variant mt-4 leading-relaxed break-keep max-w-prose whitespace-pre-line">{t('check.sebtest_desc')}</p>
                  {err && <p className="prep-warn" style={{ marginTop: 10 }}>{err}</p>}
                </div>
              </div>
            </div>

            {/* 설치 — 점검 아래다. 이미 설치한 사람이 '또 설치해야 하나' 로 읽지 않게 한다. */}
            <div className="p-8 rounded-2xl bg-surface-container-lowest border border-surface-container-highest shadow-sm hover:shadow-md transition-shadow">
              <div className="flex-grow">
                <h2 className="font-title-md text-title-md font-bold text-on-surface mb-2">{t('check.sec1_title')}</h2>
                <p className="font-body-md text-body-md text-on-surface-variant mb-2 leading-relaxed break-keep max-w-prose">{t('check.sec1_desc')}</p>
                {/* 설치가 아래로 내려간 대가 — 위 버튼을 눌렀는데 아무 일도 안 일어난 사람에게
                    갈 곳을 알려준다. 이 한 줄이 없으면 처음 온 사람은 멈춘 채로 끝난다. */}
                <p className="font-body-md text-body-md text-on-surface-variant mb-6 leading-relaxed break-keep max-w-prose">{t('check.sec1_hint')}</p>
                <SebInstall />
              </div>
            </div>
          </div>

          <div className="mt-8 flex justify-center">
            {/* 응시권 카드가 있는 자리로 돌려보낸다(2026-08-25). 여기 오는 사람은 대부분
                마이페이지 응시권 카드의 '환경 점검' 을 눌러서 왔고, 점검이 끝나면 그 카드로
                돌아가 응시를 시작한다. ⚠️ `/exam`(커버 화면)으로 되돌리지 말 것 — 거기엔
                점검 뒤 이어서 할 것이 없어 한 단계를 더 거쳐야 카드에 닿는다. */}
            <button onClick={() => navigate('/mypage/attempts')} className="bg-surface-container-lowest text-on-surface-variant hover:text-primary-container font-title-md text-title-md px-8 py-3 rounded-xl transition-all border border-outline-variant hover:border-primary-container hover:shadow-md inline-flex items-center justify-center gap-2">
              <span className="material-symbols-outlined text-[20px]">arrow_back</span>
              {t('check.back')}
            </button>
          </div>
        </div>
      </main>

    </div>
  )
}
