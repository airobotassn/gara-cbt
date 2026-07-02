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

// 수동 종료(창닫기·Ctrl+Q) 시 비밀번호 요구 → 응시자가 임의로 SEB 를 끌 수 없음.
// 시험 종료(quitURL=/exam/done)는 비밀번호 없이 자동 종료(quitURLConfirm=false)로 유지.
// 감독관/관리자만 이 비밀번호로 강제 종료 가능.
const QUIT_PASSWORD = 'gara-exit-2026'
const hashedQuitPassword = sha('sha256').update(QUIT_PASSWORD).digest('hex')

function plistFor(startURL) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
\t<key>startURL</key>
\t<string>${startURL}</string>
\t<key>sebConfigPurpose</key>
\t<integer>0</integer>
\t<key>sendBrowserExamKey</key>
\t<true/>
\t<key>allowQuit</key>
\t<true/>
\t<key>hashedQuitPassword</key>
\t<string>${hashedQuitPassword}</string>
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
