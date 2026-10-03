/* 热点原文预览接口的行为体检：
   抓一批 URL，分别看能不能抓到正文、是不是搜索页、编码对不对。 */
const API = 'http://127.0.0.1:8848'

const post = (p, b) => fetch(API + p, {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b)
}).then(r => r.json())

const hot = await fetch(API + '/api/hot').then(r => r.json())
const srcs = (hot.data || hot).sources || []
console.log('源 ' + srcs.length + ' 个，可用 ' + srcs.filter(s => s.ok).length + ' 个')

const cands = []
for (const s of srcs.filter(x => x.ok)) {
  for (const it of (s.items || []).slice(0, 2)) if (it.url) cands.push({ src: s.name, url: it.url, title: it.title })
}
console.log('待测 ' + cands.length + ' 条')

/* 输出写文件而不是 console.log ——
   PowerShell 重定向会把 stdout 变成 UTF-16，读回来全乱码没法分析。 */
const OUT = []
const say = s => OUT.push(s)

let ok = 0, searchPage = 0, fail = 0, garbled = 0, jsLeak = 0
const CODE_RE = /\bvar\s+\w+\s*=|function\s*\w*\s*\(|jQuery\.|\.ajaxSettings|document\.|window\._|\bplugins\s*:\s*\{|\bbdms\s*:\s*\{|suds_init/
for (const c of cands) {
  let r
  try { r = await post('/api/hot/peek', { url: c.url }) } catch (e) { r = { error: '请求异常 ' + e.message } }
  const d = r.data || r
  if (d.error) {
    say(`  FAIL [${c.src}] ${d.error}  ${c.url.slice(0, 60)}`)
    fail++
  } else if (d.isSearchPage) {
    say(`  PAGE [${c.src}] 搜索页  ${c.url.slice(0, 60)}`)
    searchPage++
  } else {
    const t = d.text || ''
    const bad = t.includes('\uFFFD')
    const leak = CODE_RE.test(t)
    const cjkRatio = (t.match(/[\u4e00-\u9fa5]/g) || []).length / (t.length || 1)
    if (bad) garbled++
    if (leak) jsLeak++
    if (t.length > 150) ok++
    say(`  ${leak ? 'JSLEAK' : 'OK'} [${c.src}] ${t.length} 字  汉字${(cjkRatio * 100).toFixed(0)}%${bad ? ' 乱码' : ''}${leak ? ' ★有JS残留' : ''}  「${c.title.slice(0, 18)}」`)
    say(`      ${t.replace(/\s+/g, ' ').slice(0, 120)}`)
  }
}
say('')
say(`  有正文 ${ok} · 搜索页 ${searchPage} · 失败 ${fail} · 乱码 ${garbled} · JS残留 ${jsLeak} · 共 ${cands.length}`)

import { writeFileSync } from 'node:fs'
writeFileSync('peek-report.txt', OUT.join('\n') + '\n', 'utf8')
console.log('已写入 peek-report.txt（' + OUT.length + ' 行）')