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
//   public/gara-practice-<lang>.seb startURL = <origin>/exam/run/practice?lang=<lang>
import { gzipSync, gunzipSync } from 'node:zlib'
import { writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { createHash as sha } from 'node:crypto'

const origin = (process.argv[2] || 'http://localhost:5174').replace(/\/$/, '')
const outDir = process.argv[3] || 'public'
const maxDisplays = Math.max(1, Number(process.argv[4] || 8))
const LANGS = ['ko', 'en', 'ja', 'zh', 'hi', 'vi']

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

function plistFor(startURL) {
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
\t<key>allowQuit</key>
\t<true/>
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
  // 라운드트립 자가검증
  const d1 = gunzipSync(seb)
  const pfx = d1.subarray(0, 4).toString('ascii')
  const d2 = gunzipSync(d1.subarray(4)).toString('utf8')
  const ok = pfx === 'plnd' && d2.includes(`<string>${startURL}</string>`)
  console.log(`  ${outPath}  ←  ${startURL}  [${ok ? 'OK' : 'FAIL'}]`)
  if (!ok) process.exit(1)
}

mkdirSync(outDir, { recursive: true })
console.log(`origin=${origin}  maxDisplays=${maxDisplays}`)
for (const lang of LANGS) {
  emit(join(outDir, `gara-${lang}.seb`), `${origin}/exam/seb?lang=${lang}`)
  emit(join(outDir, `gara-practice-${lang}.seb`), `${origin}/exam/run/practice?lang=${lang}`)
}
// 언어 미지정 fallback(=ko) — 옛 /gara.seb 참조 호환
emit(join(outDir, 'gara.seb'), `${origin}/exam/seb?lang=ko`)
emit(join(outDir, 'gara-practice.seb'), `${origin}/exam/run/practice?lang=ko`)
console.log('done.')
