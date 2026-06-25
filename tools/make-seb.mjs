// GARA 자격검정용 .seb(Safe Exam Browser 설정) 생성기.
// 포맷(공식): final = gzip( "plnd" + gzip( XML plist ) )  — plnd = 비암호화.
//
// 사용:
//   node tools/make-seb.mjs <startURL> [출력경로] [허용모니터수]
//   예) 로컬(듀얼모니터): node tools/make-seb.mjs http://localhost:5174/exam public/gara.seb 2
//       배포(엄격 1대):   node tools/make-seb.mjs https://가라도메인/exam public/gara.seb 1
import { gzipSync, gunzipSync } from 'node:zlib'
import { writeFileSync, mkdirSync } from 'node:fs'
import { dirname } from 'node:path'

const startURL = process.argv[2] || 'http://localhost:5174/exam'
const outPath = process.argv[3] || 'public/gara.seb'
// 허용 모니터 수 — 기본 8(사실상 제한 없음). SEB가 추가 모니터를 검게 덮으므로 여러 대여도 안전.
const maxDisplays = Math.max(1, Number(process.argv[4] || 8))
const origin = new URL(startURL).origin

const plist = `<?xml version="1.0" encoding="UTF-8"?>
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

const inner = gzipSync(Buffer.from(plist, 'utf8'))
const prefixed = Buffer.concat([Buffer.from('plnd', 'ascii'), inner])
const seb = gzipSync(prefixed)

mkdirSync(dirname(outPath), { recursive: true })
writeFileSync(outPath, seb)

// 라운드트립 자가검증(잘못된 파일 방지)
const d1 = gunzipSync(seb)
const pfx = d1.subarray(0, 4).toString('ascii')
const d2 = gunzipSync(d1.subarray(4))
const ok = pfx === 'plnd' && d2.toString('utf8').includes('<key>startURL</key>')
console.log(`wrote ${outPath} (${seb.length} bytes) startURL=${startURL} prefix=${pfx} selfcheck=${ok ? 'OK' : 'FAIL'}`)
if (!ok) process.exit(1)
