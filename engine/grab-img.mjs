/**
 * 抓一篇报道里的公开配图，存进图库。
 *
 * 为什么单独写脚本：配图这件事必须走「真实来源 + 记录出处」，
 * 不能拿不相干的图凑数（用户明确要求「配图应该正常显示出来」，
 * 但「正常显示」的前提是图跟内容对得上）。
 *
 * 用法：node engine/grab-img.mjs <文章URL> [要几张]
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const IMG_DIR = path.join(ROOT, 'data', 'images')
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36'

const url = process.argv[2]
const want = Number(process.argv[3]) || 3
if (!url) { console.log('用法：node engine/grab-img.mjs <文章URL> [几张]'); process.exit(1) }

fs.mkdirSync(IMG_DIR, { recursive: true })

const html = await fetch(url, { headers: { 'user-agent': UA, 'accept-language': 'zh-CN,zh;q=0.9' } })
  .then(r => r.text())
  .catch(e => { console.log('抓页面失败：' + e.message); process.exit(1) })

const title = (html.match(/<title[^>]*>([\s\S]{0,120}?)<\/title>/i) || [])[1] || ''
const tClean = title.replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').trim()

// 收集页面里的图 URL
const raw = [
  ...[...html.matchAll(/<img[^>]+src=["']([^"']+)["']/gi)].map(m => m[1]),
  ...[...html.matchAll(/https?:\/\/[^\s"']+\.(?:jpg|jpeg|png|webp)/gi)].map(m => m[0])
]

const abs = [...new Set(raw.map(u => {
  if (u.startsWith('//')) return 'https:' + u
  if (u.startsWith('/')) { try { return new URL(u, url).href } catch { return '' } }
  return /^https?:/i.test(u) ? u : ''
}).filter(Boolean))]

/* 过滤：图标、占位图、小图、二维码、站标。
   实际踩过：澎湃页面上最显眼的两个 <img> 是「二维码」和「微信公众号」，
   文件名分别是 scalecode 和 wechat —— 抓到它们当配图，等于把二维码发出去。 */
const junk = /(icon|logo|avatar|blank|spacer|placeholder|qrcode|banner_ad|\.gif|ad[-_]|\/ad\/)/i
const junkName = /(scalecode|wechat|weixin|qrcode|qr_|_qr|loading)/i
const cands = abs.filter(u => !junk.test(u) && !junkName.test(u))
console.log('页面共 ' + abs.length + ' 个图 URL，过滤后 ' + cands.length + ' 个候选')
console.log('文章：' + tClean.slice(0, 50))

const saved = []
for (const u of cands) {
  if (saved.length >= want) break
  try {
    const r = await fetch(u, { headers: { 'user-agent': UA, referer: url }, signal: AbortSignal.timeout(15000) })
    if (!r.ok) { console.log('  跳过 HTTP ' + r.status + '  ' + u.slice(0, 70)); continue }
    const ct = r.headers.get('content-type') || ''
    if (!/image\/(jpeg|png|webp)/.test(ct)) { console.log('  跳过非图片 ' + ct); continue }
    const buf = Buffer.from(await r.arrayBuffer())
    if (buf.length < 12000) { console.log('  跳过太小 ' + Math.round(buf.length / 1024) + 'KB'); continue }

    const ext = ct.includes('png') ? 'png' : ct.includes('webp') ? 'webp' : 'jpg'
    const name = 'jz_' + Date.now().toString(36) + '_' + saved.length + '.' + ext
    fs.writeFileSync(path.join(IMG_DIR, name), buf)
    saved.push({ file: name, url: u, bytes: buf.length })
    console.log('  ✓ ' + name + '  ' + Math.round(buf.length / 1024) + 'KB  ' + u.slice(0, 70))
  } catch (e) {
    console.log('  跳过 ' + (e.message || e))
  }
}

console.log('\n存了 ' + saved.length + ' 张到 data/images/')
console.log('出处：' + url)

// 写进 images.json，标明来源和出处
if (saved.length) {
  const F = path.join(ROOT, 'data', 'images.json')
  let list = []
  try { list = JSON.parse(fs.readFileSync(F, 'utf8').replace(/^\uFEFF/, '')) } catch {}
  if (!Array.isArray(list)) list = []
  const now = new Date().toISOString()
  for (const s of saved) {
    list.push({
      id: 'g' + Date.now().toString(36) + s.file.slice(-4),
      file: s.file,
      cap: tClean.slice(0, 40),
      src: new URL(url).hostname,
      risk: '未评估',
      url: s.url,
      pageUrl: url,
      at: now
    })
  }
  fs.writeFileSync(F, JSON.stringify(list, null, 2), 'utf8')
  console.log('已写进 images.json（带出处，可回溯）')
}