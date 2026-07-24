// Render-level XSS-inertness proof for the chat body renderer (../src/lib/linkify.tsx).
// Deterministically asserts that untrusted text renders HTML-escaped (React text children),
// never as live markup, and that only http(s) URLs become safe <a rel="noopener noreferrer"> links.
// Stronger than a screenshot: checks the actual rendered HTML string of the real render function.
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { writeFileSync } from 'node:fs'
import { linkify } from '../src/lib/linkify.tsx'

const results = []
const rec = (check, pass, detail) =>
  results.push({ check, status: pass ? 'passed' : 'failed', verdict: pass ? 'passed' : 'failed', detail: String(detail).slice(0, 160) })

const render = (text) => renderToStaticMarkup(React.createElement('div', { className: 'chat-body' }, linkify(text)))

// 1) <img onerror> payload -> escaped, no live <img>
const h1 = render('<img src=x onerror="window.__xss=1">')
rec('XSS <img onerror> escaped, no live <img>', !/<img/i.test(h1) && h1.includes('&lt;img'), h1)

// 2) a < b & c -> escaped metachars, preserved, not mangled into a tag
const h2 = render('a < b & c')
rec('HTML metachars escaped (&lt; &amp;), not mangled', h2.includes('&lt;') && h2.includes('&amp;') && !/<b[\s>]/i.test(h2), h2)

// 3) <script> -> escaped, no live script tag
const h3 = render('<script>alert(1)</script>')
rec('<script> escaped, no live <script>', !/<script/i.test(h3) && h3.includes('&lt;script'), h3)

// 4) https URL -> safe <a rel="noopener noreferrer" target="_blank">
const h4 = render('see https://example.com now')
rec('https URL linkified to safe <a rel=noopener target=_blank>', /<a [^>]*href="https:\/\/example\.com"/.test(h4) && h4.includes('rel="noopener noreferrer"') && h4.includes('target="_blank"'), h4)

// 5) javascript: scheme NOT turned into a link (only http/https matched)
const h5 = render('javascript:alert(1)')
rec('javascript: scheme NOT linkified (rendered as text)', !/<a /i.test(h5) && h5.includes('javascript:alert(1)'), h5)

for (const r of results) console.log(`${r.status === 'passed' ? 'PASS' : 'FAIL'} | ${r.check}`)
const failed = results.filter((r) => r.status !== 'passed').length
const report = {
  schemaVersion: 1,
  kind: 'test-report',
  surface: 'render',
  suite: 'chat-xss-render',
  command: ['bun', 'tests/chat-xss-render.mjs'],
  cwd: '.',
  exitCode: failed === 0 ? 0 : 1,
  total: results.length,
  passed: results.length - failed,
  failed,
  assertions: results,
}
writeFileSync('artifacts/g004-chat-xss-render.json', JSON.stringify(report, null, 2))
console.log('\n' + JSON.stringify({ suite: 'chat-xss-render', total: results.length, passed: results.length - failed, failed }))
process.exit(failed === 0 ? 0 : 1)
