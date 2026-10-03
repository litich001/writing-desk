/**
 * 热点信息源
 *
 * 设计原则：只收录「实测能真出条目」的源。抓不到就标为不可用，
 * 绝不用假数据凑数 —— 选题靠假榜是致命的。
 *
 * 自检：node engine/hot.mjs
 *
 * 缓存：内存 5 分钟 + 落盘 4 小时（见 DISK_TTL）。
 * 命令行直接取榜（给任何 Agent 用）：node engine/hot-cli.mjs --json
 */
import { readFileSync, writeFileSync } from 'node:fs'

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36'
const TIMEOUT = 12000

const cache = new Map()          // key -> { t, data }
const TTL = 5 * 60 * 1000        // 内存缓存 5 分钟：同一次会话内不重复打源站

/* ---------- 4 小时落盘缓存（用户明确要求「每隔 4 小时刷新一次」）----------
   只有内存缓存不够：进程一重启就全没了，会立刻去打 15 个源站。
   落盘一份，规则：
     · 4 小时内直接用盘上的，不打网络
     · 超过 4 小时才重新抓，抓完写回盘
   失败时保留上一份数据（宁可旧，不可空），并标 stale。 */
const DISK_TTL = 4 * 60 * 60 * 1000
const CACHE_FILE = new URL('../data/_hot_cache.json', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')

let disk = null
function loadDisk() {
  if (disk) return disk
  try {
    const t = JSON.parse(readFileSync(CACHE_FILE, 'utf8').replace(/^\uFEFF/, ''))
    disk = { at: t.at || 0, sources: t.sources || {} }
  } catch { disk = { at: 0, sources: {} } }
  return disk
}
function saveDisk() {
  const d = loadDisk()
  try { writeFileSync(CACHE_FILE, JSON.stringify({ at: d.at, sources: d.sources }), 'utf8') } catch {}
}
export function hotCacheAge() {
  const d = loadDisk()
  return d.at ? Date.now() - d.at : Infinity
}
export function hotCacheFresh() { return hotCacheAge() < DISK_TTL }
/** 上次成功抓取的时间，没有则 null */
export function hotCachedAt() { const d = loadDisk(); return d.at || null }
/** 手动清盘，强制下次重新抓 */
export function hotDropDisk() { loadDisk().at = 0; saveDisk() }

async function get(url, headers = {}, enc = null) {
  const r = await fetch(url, {
    headers: { 'user-agent': UA, accept: '*/*', 'accept-language': 'zh-CN,zh;q=0.9', ...headers },
    signal: AbortSignal.timeout(TIMEOUT)
  })
  if (!r.ok) throw new Error('HTTP ' + r.status)
  const buf = Buffer.from(await r.arrayBuffer())
  const ct = (r.headers.get('content-type') || '').toLowerCase()
  if (enc || /gbk|gb2312/.test(ct)) return new TextDecoder(enc || 'gbk').decode(buf)
  return buf.toString('utf8')
}

const decodeEnt = s => String(s)
  .replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&')
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ')
  .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(+d))

const strip = s => decodeEnt(String(s).replace(/<[^>]*>/g, '')).replace(/\s+/g, ' ').trim()

/* ─────────── 各源解析器 ─────────── */
export const SOURCES = [
  {
    id: 'baidu', name: '百度热搜', short: '百', hue: 285,
    async run() {
      const j = JSON.parse(await get('https://top.baidu.com/api/board?platform=wise&tab=realtime',
        { referer: 'https://top.baidu.com/board?tab=realtime' }))
      // 百度把榜单嵌在 cards→content→content 的多层里，深度会变，
      // 所以不写死层级：深度遍历，凡是带 word/query 的对象都算一条。
      const out = [], seen = new Set()
      const walk = o => {
        if (!o || typeof o !== 'object') return
        if (Array.isArray(o)) { o.forEach(walk); return }
        const t = strip(o.word || o.query || '')
        if (t && t.length >= 3 && !seen.has(t) && !/^(百度|热搜|登录|更多|刷新)/.test(t)) {
          seen.add(t)
          out.push({ rank: 0, title: t, heat: o.hotScore || o.hotChange || 0, url: o.url || o.rawUrl || '', extra: strip(o.desc || '').slice(0, 60) })
        }
        Object.values(o).forEach(walk)
      }
      walk(j.data?.cards)
      out.forEach((x, i) => { x.rank = i + 1 })
      return out
    }
  },
  {
    id: 'toutiao', name: '头条热榜', short: '头', hue: 348,
    async run() {
      const j = JSON.parse(await get('https://www.toutiao.com/hot-event/hot-board/?origin=toutiao_pc',
        { referer: 'https://www.toutiao.com/' }))
      return (j.data || []).slice(0, 50).map((x, i) => ({
        rank: i + 1, title: strip(x.Title || ''), heat: x.HotValue || 0, url: x.Url || '', extra: ''
      }))
    }
  },
  {
    id: 'douyin', name: '抖音热点', short: '抖', hue: 330,
    async run() {
      const j = JSON.parse(await get('https://www.iesdouyin.com/web/api/v2/hotsearch/billboard/word/',
        { referer: 'https://www.douyin.com/' }))
      return (j.word_list || []).slice(0, 50).map((x, i) => ({
        rank: i + 1, title: strip(x.word || ''), heat: x.hot_value || 0, url: `https://www.douyin.com/search/${encodeURIComponent(x.word || '')}`, extra: ''
      }))
    }
  },
  {
    id: 'bilibili', name: 'B站热门', short: 'B', hue: 210,
    async run() {
      const j = JSON.parse(await get('https://api.bilibili.com/x/web-interface/popular?ps=30&pn=1',
        { referer: 'https://www.bilibili.com/v/popular/all/' }))
      return (j?.data?.list || []).slice(0, 30).map((x, i) => ({
        rank: i + 1, title: strip(x.title || ''), heat: x.stat?.view || 0,
        url: `https://www.bilibili.com/video/${x.bvid || ''}`,
        extra: `${strip(x.owner?.name || '')} · ${x.stat?.view || 0}播放`
      }))
    }
  },
  {
    id: 'juejin', name: '掘金热榜', short: '掘', hue: 190,
    async run() {
      const j = JSON.parse(await get('https://api.juejin.cn/content_api/v1/content/article_rank?category_id=1&type=hot',
        { referer: 'https://juejin.cn/' }))
      return (j.data || []).slice(0, 30).map((x, i) => ({
        rank: i + 1, title: strip(x.content?.title || ''), heat: x.content?.view_count || 0,
        url: `https://juejin.cn/post/${x.content?.article_id || ''}`,
        extra: `${strip(x.content?.author_user_info?.name || '')} · ${x.content?.view_count || 0}阅读`
      }))
    }
  },
  {
    id: 'ithome', name: 'IT之家', short: 'H', hue: 40,
    async run() {
      // 注意：/rank/ 是前端渲染抓不到，/list/ 才有服务端 HTML
      const h = await get('https://www.ithome.com/list/', { referer: 'https://www.ithome.com/' })
      const out = [], seen = new Set()
      for (const m of h.matchAll(/<a[^>]+href="([^"]*\.htm[^"]*)"[^>]*>([\s\S]{0,90}?)<\/a>/g)) {
        const t = strip(m[2])
        if (t.length < 10 || seen.has(t)) continue
        seen.add(t)
        const u = m[1].startsWith('http') ? m[1] : 'https://www.ithome.com' + m[1]
        out.push({ rank: out.length + 1, title: t, heat: 0, url: u, extra: '' })
        if (out.length >= 25) break
      }
      return out
    }
  },
  {
    id: 'thepaper', name: '澎湃新闻', short: '澎', hue: 355,
    async run() {
      const h = await get('https://www.thepaper.cn/', { referer: 'https://www.thepaper.cn/' })
      const out = [], seen = new Set()
      // 卡片图：标题在 alt 里
      for (const m of h.matchAll(/href="\/newsDetail_forward_(\d+)"[\s\S]{0,400}?alt="([^"]{8,})"/g)) {
        const t = strip(m[2])
        if (seen.has(t)) continue
        seen.add(t)
        out.push({ rank: out.length + 1, title: t, heat: 0, url: `https://www.thepaper.cn/newsDetail_forward_${m[1]}`, extra: '' })
      }
      // 纯文字链接
      for (const m of h.matchAll(/<a[^>]+href="\/newsDetail_forward_(\d+)"[^>]*>([^<]{10,})<\/a>/g)) {
        const t = strip(m[2])
        if (seen.has(t)) continue
        seen.add(t)
        out.push({ rank: out.length + 1, title: t, heat: 0, url: `https://www.thepaper.cn/newsDetail_forward_${m[1]}`, extra: '' })
      }
      return out.slice(0, 25)
    }
  },
  {
    id: 'douban', name: '豆瓣小组', short: '豆', hue: 138,
    async run() {
      const h = await get('https://www.douban.com/group/explore', { referer: 'https://www.douban.com/group/' })
      const out = [], seen = new Set()
      for (const m of h.matchAll(/<a[^>]+href="(https:\/\/www\.douban\.com\/group\/topic\/(\d+)\/[^"]*)"[^>]*>([^<]{6,})<\/a>/g)) {
        const t = strip(m[3])
        if (seen.has(t)) continue
        seen.add(t)
        out.push({ rank: out.length + 1, title: t, heat: 0, url: m[1].replace(/[?&].*$/, ''), extra: '' })
        if (out.length >= 25) break
      }
      return out
    }
  },
  {
    id: 'netease', name: '网易要闻', short: '易', hue: 20,
    async run() {
      // 该文件是 GBK，但响应头不标编码，必须手动指定，否则全是乱码
      const raw = await get('https://temp.163.com/special/00804KVA/cm_guonei.js', { referer: 'https://www.163.com/' }, 'gbk')
      const j = JSON.parse(raw.replace(/^\s*data_callback\(\s*/, '').replace(/\s*\)\s*;?\s*$/, ''))
      // 顶层是数组；但结构随时可能变，做通用兜底：凡是带 title 的对象都收
      const out = [], seen = new Set()
      const walk = o => {
        if (!o || typeof o !== 'object') return
        if (Array.isArray(o)) { o.forEach(walk); return }
        const t = strip(o.title || '')
        if (t.length >= 6 && !seen.has(t)) {
          seen.add(t)
          out.push({ rank: 0, title: t, heat: 0, url: o.docurl || o.url || '', extra: strip(o.digest || '').slice(0, 60) })
        }
        Object.values(o).forEach(walk)
      }
      walk(j)
      out.forEach((x, i) => { x.rank = i + 1 })
      return out.slice(0, 30)
    }
  }
]

/* ---------- 通用 HTML 标题提取 ----------
   财经/门户类站点首页锚点里塞满导航和广告，光靠「标题长度」筛不干净，
   所以给每源配一条 URL 规则，只认文章页链接。 */
function htmlTopics(html, base, opt = {}) {
  const { min = 10, max = 60, hrefRe = null, denyRe = null, limit = 30 } = opt
  const out = [], seen = new Set()
  for (const m of html.matchAll(/<a\s[^>]*href="([^"]+)"[^>]*>([\s\S]{0,220}?)<\/a>/g)) {
    let href = m[1].trim()
    const t = strip(m[2])
    if (t.length < min || t.length > max) continue
    if (/^(更多|首页|登录|注册|下载|APP|广告|English|专题|视频|图集)/i.test(t)) continue
    if (denyRe && denyRe.test(href)) continue
    if (hrefRe && !hrefRe.test(href)) continue
    if (href.startsWith('//')) href = 'https:' + href
    else if (href.startsWith('/')) href = base + href
    if (!/^https?:/i.test(href)) continue
    const key = hotKey(t)
    if (!key || seen.has(key)) continue
    seen.add(key)
    out.push({ rank: out.length + 1, title: t, heat: 0, url: href, extra: '' })
    if (out.length >= limit) break
  }
  return out
}

/* 规范化键：跨平台合并同一件事时也用它 */
function hotKey(t) {
  return String(t).replace(/[^一-龥a-zA-Z0-9]/g, '').slice(0, 14)
}

/* ---------- 追加的信息源 ---------- */
const EXTRA = [
  {
    id: 'hupu', name: '虎扑步行街', short: '虎', hue: 18, topic: '社会话题',
    async run() {
      const h = await get('https://bbs.hupu.com/all-gambia', { referer: 'https://bbs.hupu.com/' })
      return htmlTopics(h, 'https://bbs.hupu.com', { min: 8, max: 50, hrefRe: /^\/\d{6,}\.html$/, limit: 30 })
    }
  },
  {
    id: 'zhdaily', name: '知乎日报', short: '知乎', hue: 200, topic: '深度长文', expect: 3,
    async run() {
      const j = JSON.parse(await get('https://news-at.zhihu.com/api/4/news/latest', { referer: 'https://daily.zhihu.com/' }))
      return (j.stories || []).map((x, i) => ({
        rank: i + 1, title: strip(x.title || ''), heat: 0,
        url: x.url || 'https://daily.zhihu.com/', extra: strip(x.hint || '').slice(0, 60)
      }))
    }
  },
  {
    id: 'qbitai', name: '量子位', short: '量', hue: 265, topic: 'AI 科技',
    async run() {
      const h = await get('https://www.qbitai.com/', { referer: 'https://www.qbitai.com/' })
      return htmlTopics(h, 'https://www.qbitai.com', { min: 10, max: 60, hrefRe: /qbitai\.com\/\d{4}\/\d{2}\/\d+\.html/, limit: 25 })
    }
  },
  {
    id: 'infoq', name: 'InfoQ 中文', short: 'iQ', hue: 155, topic: '技术实践',
    async run() {
      const h = await get('https://www.infoq.cn/', { referer: 'https://www.infoq.cn/' })
      return htmlTopics(h, 'https://www.infoq.cn', { min: 14, max: 60, hrefRe: /infoq\.cn\/article\//, denyRe: /\/space\//, limit: 25 })
    }
  },
  {
    id: 'sinafin', name: '新浪财经', short: '财', hue: 358, topic: '商业财经',
    async run() {
      const h = await get('https://finance.sina.com.cn/', { referer: 'https://finance.sina.com.cn/' })
      return htmlTopics(h, 'https://finance.sina.com.cn', {
        min: 12, max: 52, limit: 30,
        // 新浪财经的文章 URL 形如 .../money/globalindex/2026-09-29/doc-initphzx2
        // 中间夹着栏目路径，且没有 .shtml 后缀
        hrefRe: /sina\.com\.cn\S*?\d{4}-\d{2}-\d{2}\/doc-[a-z0-9]+/
      })
    }
  },
  {
    id: 'eastmoney', name: '东方财富', short: '东', hue: 40, topic: '商业财经',
    async run() {
      const h = await get('https://www.eastmoney.com/', { referer: 'https://www.eastmoney.com/' })
      return htmlTopics(h, 'https://www.eastmoney.com', {
        min: 14, max: 56, limit: 30,
        hrefRe: /eastmoney\.com\S*?\/a\/\d{6,}\.html/,
        denyRe: /acttg|quote\.|js\d*\.eastmoney|investors/
      })
    }
  }
]
SOURCES.push(...EXTRA)

/** 单源抓取（带缓存） */
export async function fetchSource(id, force = false) {
  const src = SOURCES.find(s => s.id === id)
  if (!src) return { id, name: id, ok: false, items: [], error: '未知源' }

  // 1. 内存缓存：5 分钟内同一会话不重复打源站
  const hit = cache.get(id)
  if (!force && hit && Date.now() - hit.t < TTL) return hit.data

  // 2. 落盘缓存：4 小时内直接用，不打网络
  const d = loadDisk()
  const fresh = d.at && Date.now() - d.at < DISK_TTL
  if (!force && fresh && d.sources[id]) {
    cache.set(id, { t: Date.now(), data: d.sources[id] })
    return d.sources[id]
  }

  const t0 = Date.now()
  try {
    const items = (await src.run()).filter(x => x.title && x.title.length >= 4)
    if (!items.length) throw new Error('解析出 0 条 —— 源结构可能变了')
    const data = {
      id, name: src.name, short: src.short, hue: src.hue, topic: src.topic || '', ok: true,
      count: items.length, ms: Date.now() - t0, at: new Date().toISOString(), items
    }
    cache.set(id, { t: Date.now(), data })
    d.sources[id] = data
    d.at = Date.now()          // 只要有一个源抓到成功，就刷新整盘的时效
    saveDisk()
    return data
  } catch (e) {
    // 抓失败时退回盘上的旧数据（标 stale），宁可旧也不要空榜
    const old = d.sources[id]
    if (old && !force) {
      const stale = { ...old, stale: true, error: e.message, triedAt: new Date().toISOString() }
      cache.set(id, { t: Date.now(), data: stale })
      return stale
    }
    const data = { id, name: src.name, short: src.short, hue: src.hue, topic: src.topic || '', ok: false, items: [], error: e.message, count: 0, at: new Date().toISOString() }
    cache.set(id, { t: Date.now() - TTL * 0.9, data })   // 失败缓存短一点，尽快重试
    return data
  }
}

/** 全部并发抓 */
export async function fetchAll(force = false) {
  return Promise.all(SOURCES.map(s => fetchSource(s.id, force)))
}

/** 缓存状态，给界面显示「多久后自动刷新」 */
export function hotCacheInfo() {
  const d = loadDisk()
  const age = d.at ? Date.now() - d.at : null
  return {
    cachedAt: d.at || null,
    ageMs: age,
    ttlMs: DISK_TTL,
    fresh: hotCacheFresh(),
    nextRefreshAt: d.at ? d.at + DISK_TTL : null
  }
}

/* ─────────── 自检 ─────────── */
// Windows 下 import.meta.url 与 argv[1] 的盘符/斜杠格式不一致，直接按文件名判定
const isMain = process.argv[1] && /hot\.mjs$/i.test(process.argv[1])
if (isMain) {
  const ids = process.argv.slice(2)
  const list = ids.length ? SOURCES.filter(s => ids.includes(s.id)) : SOURCES
  console.log('\n' + '='.repeat(74))
  console.log('  热点源自检  —— 每个源必须真出条目，否则就是假功能')
  console.log('='.repeat(74))
  const res = await Promise.all(list.map(s => fetchSource(s.id, true)))
  let pass = 0, fail = 0
  for (const r of res) {
    const good = r.ok && r.count >= (SOURCES.find(s => s.id === r.id)?.expect || 5)
    good ? pass++ : fail++
    console.log(`  ${good ? '✓' : '✗'} ${r.name.padEnd(12)} ${String(r.count).padStart(3)} 条  ${String(r.ms).padStart(5)}ms  ${r.ok ? '' : r.error}`)
    if (good) {
      const t = r.items.slice(0, 3).map(x => x.title.slice(0, 22)).join(' / ')
      console.log(`      └ ${t}`)
      const bad = r.items.find(x => /^(about|首页|登录|undefined|null)/i.test(x.title))
      if (bad) console.log(`      ! 疑似脏数据: ${bad.title.slice(0, 30)}`)
    }
  }
  console.log('='.repeat(74))
  console.log(`  可用 ${pass}　不可用 ${fail}　共 ${res.reduce((a, b) => a + b.count, 0)} 条`)
  console.log('='.repeat(74) + '\n')
  // 不要 process.exit()：还有未关闭的 keep-alive 连接会触发 libuv 断言崩溃
  process.exitCode = fail ? 1 : 0
}
