/** 抓正文配图入库。抓不到就如实跳过 —— 绝不用旧图或无关图凑数。 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const DATA = path.join(ROOT, 'data')
const IMGDIR = path.join(DATA, 'images')
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126 Safari/537.36'

const PAGES = [
  {
    u: 'http://www.xinhuanet.com/sports/20250224/332effbaf1cd454d99fb9d32ebed7ddd/c.html',
    src: '新华网',
    cap: '2月23日，王曼昱在颁奖仪式上与奖杯合影',
    // 图 URL 形如 20250224332eff..._20250224<hash>.jpg 或 zxcode_...jpg
    // 关键是含赛事 id 且排除二维码(zxcode 是新华的二维码)
    keep: s => /20250224332effbaf1cd454d99fb9d32ebed7ddd_\d{8,}[a-f0-9]+\.jpg$/i.test(s) && !/zxcode/i.test(s)
  },
  {
    u: 'http://www.news.cn/sports/20250223/abe1efa52e7249e7ab44a40fd0439132/c.html',
    src: '新华网',
    cap: '2月23日，冠军王曼昱（中）、亚军孙颖莎（左）和季军蒯曼在颁奖仪式上合影',
    keep: s => /20250223abe1efa52e7249e7ab44a40fd0439132_\d{8,}[a-f0-9]+\.jpg$/i.test(s) && !/zxcode/i.test(s)
  }
]

const log = []
const added = []
const list = JSON.parse(fs.readFileSync(path.join(DATA, 'images.json'), 'utf8'))

for (const p of PAGES) {
  try {
    const r = await fetch(p.u, { headers: { 'user-agent': UA, referer: p.u }, signal: AbortSignal.timeout(15000) })
    const html = await r.text()
    const base = new URL(p.u).origin
    const cands = [...html.matchAll(/<img[^>]+src="([^"]+\.jpg)"/gi)]
      .map(m => m[1].trim())
      .filter(s => p.keep(s))
      .map(s => { try { return new URL(s, p.u).href } catch { return '' } })
    log.push(p.src + ' 候选 ' + cands.length + ' 张: ' + cands[0]?.slice(0, 80))
    let n = 0
    for (const u of cands.slice(0, 2)) {
      try {
        const ir = await fetch(u, { headers: { 'user-agent': UA, referer: p.u }, signal: AbortSignal.timeout(15000) })
        if (!ir.ok) throw new Error('HTTP ' + ir.status)
        const ct = (ir.headers.get('content-type') || '')
        if (!/^image\//.test(ct)) throw new Error('非图片 ' + ct)
        const buf = Buffer.from(await ir.arrayBuffer())
        if (buf.length < 15000) throw new Error('太小 ' + buf.length)
        const file = 'yt_'
        const name = (p.src === '新华网' ? 'xhw' : 'xhw') + '_' + Date.now().toString(36) + '_' + n + '.jpg'
        fs.writeFileSync(path.join(IMGDIR, name), buf)
        const id = Date.now().toString(36) + '_' + n
        list.push({ id, file: name, cap: p.cap, src: p.src, url: u, risk: '低', at: new Date().toISOString() })
        added.push(name + ' ' + (buf.length / 1024).toFixed(0) + 'KB')
        log.push('  ✓ ' + name + '  ' + (buf.length / 1024).toFixed(0) + 'KB  ' + u.slice(0, 70))
        n++
      } catch (e) { log.push('  ✗ ' + u.slice(0, 60) + ' → ' + e.message) }
    }
  } catch (e) { log.push(p.src + ' 页面失败：' + e.message) }
}

fs.writeFileSync(path.join(DATA, 'images.json'), JSON.stringify(list, null, 2), 'utf8')
console.log(log.join('\n'))
console.log('\n图片库 ' + list.length + ' 张，本次新增 ' + added.length + ' 张')
if (!added.length) console.log('⚠ 一张都没抓到 —— 报告时应如实说明本篇未配图')
