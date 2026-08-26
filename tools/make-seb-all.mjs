// 언어별 .seb 생성기 — SEB는 새 브라우저 프로필(저장된 언어 없음)이라,
// 진입 URL(startURL)에 ?lang=<code> 를 실어 보내야 SEB 안에서도 같은 언어로 열린다.
// 포맷(공식): final = gzip( "plnd" + gzip( XML plist ) )  — plnd = 비암호화.
//
// 사용:
//   node tools/make-seb-all.mjs <origin> [출력디렉토리] [허용모니터수]
//   예) 배포:  node tools/make-seb-all.mjs https://gara-cbt.airobotassn.workers.dev public 8
//       로컬:  node tools/make-seb-all.mjs http://localhost:5174 public 8
//
// 생성물(언어 6종 × 실제/연습):
//   public/gara-<lang>.seb          startURL = <origin>/exam/seb?lang=<lang>
//   public/gara-practice-<lang>.seb startURL = <origin>/exam/envcheck?lang=<lang>
import { gzipSync, gunzipSync } from 'node:zlib'
import { writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { createHash as sha } from 'node:crypto'

const origin = (process.argv[2] || 'http://localhost:5174').replace(/\/$/, '')
const outDir = process.argv[3] || 'public'
const maxDisplays = Math.max(1, Number(process.argv[4] || 8))
const LANGS = ['ko', 'en', 'ja', 'zh', 'hi', 'vi']

// ⛔ **설정은 한 벌이다 — 응시 화면에서만 SEB 종료를 없애는 '2단계 설정' 을 만들었다가 되돌렸다(2026-08-26).**
//    문제: 문제 화면에서 SEB 자체 종료(작업표시줄 X · Ctrl+Q)로 나가면 우리 페이지를 안 거쳐
//          **서버가 그 이탈을 모른다**(그날 실측: 기록에 'start' 하나만 남았다).
//    시도: 세션을 둘로 갈라(SEB 재구성) 문제 화면만 `allowQuit=false` 로 열었다. 실기기에서 **동작까지
//          확인했다** — 표가 새 세션까지 도착했고 '종료(포기)' 가 무효로 기록됐다.
//    되돌린 이유: 그 구조에서도 **2단계를 여는 그 한 번의 로딩이 실패하면 나갈 수단이 없다**(강제 종료).
//          그런데 얻는 것은 '고의 이탈' 라벨 하나뿐이고, **정말 고의로 나갈 사람은 전원 버튼을 누르면
//          그만이라 그 라벨을 그대로 피해 간다.** 결국 이득도 손해도 정직한 응시자에게만 생기는데
//          손해 쪽(시험을 못 보고 남의 PC 를 강제 종료)이 비교가 안 되게 크다.
//    그래서 **X 는 모든 화면에 둔다.** 이탈은 라벨이 아니라 기록으로 다룬다 — 하트비트가
//    `exam_attempts.last_seen_at`·`answered_count`·`draft_answers` 를 계속 갱신하므로 "언제 끊겼고
//    어디까지 풀었나" 는 이미 서버에 남는다(관리자 응시 상세의 '응시 중단 기록' 패널이 그걸 본다).
//
//    ⚠️ **되살릴 거면 감독 체계가 생긴 뒤다.** 그때는 갇혀도 옆에서 풀어줄 사람이 있다.
//       그때 필요한 사실들(SEB 3.10 · seb-win-refactoring 소스에서 확인):
//         · 작업표시줄 X : `taskbar.ShowQuitButton = Security.AllowTermination`        (ShellOperation)
//         · Ctrl+Q      : `if (AllowTermination && activator is ITerminationActivator)` (ShellOperation)
//           → allowQuit=false 면 버튼이 안 그려지고 단축키는 등록조차 안 된다.
//         · quitURL     : RequestHandler_QuitUrlVisited → TerminationRequested → TryRequestShutdown
//           → **AllowTermination 을 보지 않는다.** 화면의 종료 버튼은 그 설정과 무관하게 동작한다.
//         · 재구성 허용 : `examSessionReconfigureAllow` + `downloadAndOpenSebConfig` **둘 다** 켜야 한다.
//           뒤엣것이 꺼져 있으면 .seb 내려받기 자체를 거절해서 아무 일도 안 일어난다(오류도 안 뜬다).
//         · 표 전달    : HandleStartUrlQuery 가 재구성일 때 ReconfigurationUrl 의 쿼리를 새 startURL 뒤에
//           붙인다(`uri.Query.LastIndexOf('?') > 0`) — 그래서 그 링크도 물음표 두 개(`??h=`)가 필요하다.
//
// ⛔ 종료 비밀번호(hashedQuitPassword)를 **일부러 넣지 않는다.** 넣으면 SEB 의 종료(X) 버튼이
//    비밀번호를 묻고, 그 순간 응시자는 나갈 방법이 없어진다 — 우리 시험은 **감독관이 없는 10일 자율응시**라
//    그 비밀번호를 대신 쳐줄 사람이 현장에 아무도 없다. 앱이 죽기라도 하면 응시자는 재부팅해야 한다
//    (2026-08-10 테스트에서 실제로 두 번 그랬다).
//
//    없애서 잃는 것 = "나갔다가 검색해보고 돌아오기"를 막는 효과. 하지만 무감독 자율응시에서는
//    옆에 폰 한 대만 있어도 성립하는 일이라, 이미 열린 구멍에 비해 실익이 없다.
//    (되돌아오는 건 '새 응시'가 아니다 — start-exam 이 같은 응시로 재진입시키고 started_at 이 유지돼
//     나가 있는 동안에도 제한시간은 계속 흐른다. 그게 실질적인 억제책이다.)
//
//    SEB 소스의 분기: hasQuitPassword ? 비밀번호창 : 예/아니오 확인창
//      (SafeExamBrowser.Client/Responsibilities/ShellResponsibility.cs · TryInitiateShutdown)
//    → 비워두면 X 버튼이 "정말 종료할까요?" 확인 후 닫힌다. 잠금화면(SEB LOCKED)도 비번이 없으면
//      자동으로 통과된다(ClientResponsibility.WaitForLockScreenResolution).
//
//    ⚠️ 감독 체계를 갖춘 시험을 열게 되면 그때 다시 넣을 것. 그때는 감독관이 비번을 들고 있어야 한다.
//
// 시험 종료(quitURL=/exam/done)는 계속 비밀번호 없이 자동 종료(quitURLConfirm=false).

/**
 * XML 이스케이프. plist 는 XML 이라 시작 주소에 `&`(쿼리 두 개 이상)가 들어가면 엔티티 시작으로 읽혀
 * **설정 파일 자체가 파싱 오류**가 된다 — SEB 가 그냥 안 열린다. 지금 주소엔 쿼리가 하나뿐이라
 * 당장 걸릴 일은 없지만, 하나 더 붙이는 순간 조용히 터지는 자리라 남겨둔다(2026-08-26 실제로 겪었다).
 */
function xmlEsc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function plistFor(rawStartURL) {
  const startURL = xmlEsc(rawStartURL)
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
\t<key>startURL</key>
\t<string>${startURL}</string>
\t<!-- SEB 실행 링크(sebs://…?h=<nonce>)의 쿼리스트링을 startURL 뒤에 붙여준다.
\t     이게 켜져 있어야 로그인 인계표가 SEB 안으로 넘어간다 — 끄면 /exam/seb 가 표를 못 받고
\t     "응시권을 결제한 계정으로 로그인하라"에서 더 못 나간다. 반드시 유지할 것.
\t     (SEB 매뉴얼 Exam ▸ Query String Parameter ▸ Allow Query Parameter)
\t     ⚠️ startURL 에 이미 ?lang= 이 있어 SEB 가 '?' 로 붙일지 '&' 로 붙일지가 버전마다 다를 수 있다.
\t        받는 쪽(SebStart·i18n)이 두 경우를 다 견디게 해놨다 — 그 방어를 지울 거면 실기기로 먼저 확인할 것. -->
\t<key>startURLAppendQueryParameter</key>
\t<true/>
\t<!-- 세션 무결성 검사 끔.
\t     켜져 있으면 SEB 가 "지난 세션이 정상 종료됐나"를 보고, 아니면 시작하자마자 빨간 잠금화면
\t     (SEB LOCKED)을 덮어 종료 비밀번호를 요구한다. 문제는 **한 번 강제종료·재부팅하면
\t     그다음부터 매번 막힌다**는 것이다 — 플래그는 정상 종료된 세션이 있어야 지워지는데
\t     잠금 때문에 정상 종료를 못 하니 스스로 빠져나올 수 없다(2026-08-10 실제로 이 고리에 갇혔다).
\t     ⚠️ 이건 "누가 시험 도중 SEB 를 죽이고 다시 켰다"를 잡는 부정행위 신호다.
\t        실제 감독 시험을 열기 전에 다시 켤 것(그때는 감독관이 비밀번호를 들고 있어야 한다). -->
\t<key>enableSessionVerification</key>
\t<false/>
\t<key>sebConfigPurpose</key>
\t<integer>0</integer>
\t<key>sendBrowserExamKey</key>
\t<true/>
\t<!-- SEB 자체 종료(작업표시줄 X · Ctrl+Q)는 **모든 화면에서 켠다.** 우리 앱이 못 뜨는 순간에도
\t     응시자가 나갈 수 있어야 한다 — 끄면 그때 남는 길이 PC 강제 종료뿐이다. 머리말 참고. -->
\t<key>allowQuit</key>
\t<true/>
\t<!-- 시험 중 다른 .seb 로 갈아타기(재구성)는 막는다. 우리가 쓰지 않는 길이고, 열어두면
\t     응시 중에 다른 설정으로 넘어가는 경로가 생긴다. 두 값이 한 쌍이라 같이 끈다
\t     (판정 순서: DownloadResponsibility → IsAllowedToReconfigure). -->
\t<key>examSessionReconfigureAllow</key>
\t<false/>
\t<key>downloadAndOpenSebConfig</key>
\t<false/>
\t<key>quitURL</key>
\t<string>${origin}/exam/done</string>
\t<key>quitURLConfirm</key>
\t<false/>
\t<key>showReloadButton</key>
\t<false/>
\t<key>browserWindowAllowReload</key>
\t<false/>
\t<key>newBrowserWindowAllowReload</key>
\t<false/>
\t<key>allowBrowsingBackForward</key>
\t<false/>
\t<key>allowPreferencesWindow</key>
\t<false/>
\t<key>URLFilterEnable</key>
\t<false/>
\t<key>allowUserSwitching</key>
\t<false/>
\t<key>allowVirtualMachine</key>
\t<false/>
\t<key>allowedDisplaysMaxNumber</key>
\t<integer>${maxDisplays}</integer>
\t<key>allowedDisplayBuiltin</key>
\t<false/>
\t<key>allowedDisplaysIgnoreFailure</key>
\t<false/>
</dict>
</plist>
`
}

function buildSeb(startURL) {
  const inner = gzipSync(Buffer.from(plistFor(startURL), 'utf8'))
  const prefixed = Buffer.concat([Buffer.from('plnd', 'ascii'), inner])
  return gzipSync(prefixed)
}

function emit(outPath, startURL) {
  const seb = buildSeb(startURL)
  writeFileSync(outPath, seb)
  // 라운드트립 자가검증 — 시작 주소 + **종료가 열려 있는지**. 종료가 닫힌 설정이 잘못 나가면
  // 응시자가 갇힌다(머리말의 되돌린 이유 참고).
  const d1 = gunzipSync(seb)
  const pfx = d1.subarray(0, 4).toString('ascii')
  const d2 = gunzipSync(d1.subarray(4)).toString('utf8')
  const quitOk = /<key>allowQuit<\/key>\s*<true\/>/.test(d2)
  // ⚠️ 날 `&` 가 남아 있으면 SEB 가 설정을 못 읽는다 — 이스케이프가 빠진 걸 여기서 잡는다.
  //    주석 안의 `&` 는 XML 에서 합법이라(설명문에 '&' 를 쓴 곳이 있다) 빼고 본다.
  const xmlOk = !/&(?!amp;|lt;|gt;|quot;|apos;|#)/.test(d2.replace(/<!--[\s\S]*?-->/g, ''))
  const ok = pfx === 'plnd' && d2.includes(`<string>${xmlEsc(startURL)}</string>`) && quitOk && xmlOk
  console.log(`  ${outPath}  ←  ${startURL}  [${ok ? 'OK' : 'FAIL'}]`)
  if (!ok) process.exit(1)
}

mkdirSync(outDir, { recursive: true })
console.log(`origin=${origin}  maxDisplays=${maxDisplays}`)
for (const lang of LANGS) {
  emit(join(outDir, `gara-${lang}.seb`), `${origin}/exam/seb?lang=${lang}`)
  emit(join(outDir, `gara-practice-${lang}.seb`), `${origin}/exam/envcheck?lang=${lang}`)
}
// 언어 미지정 fallback(=ko) — 옛 /gara.seb 참조 호환
emit(join(outDir, 'gara.seb'), `${origin}/exam/seb?lang=ko`)
emit(join(outDir, 'gara-practice.seb'), `${origin}/exam/envcheck?lang=ko`)
console.log('done.')
