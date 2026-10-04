/**
 * 写作台 · 本地服务
 * 职责：静态资源 / 数据读写 / 任务队列 / 图片 / 排版
 * 不连任何模型，不需要 API Key
 */
import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { preview, forWechat, THEMES } from './engine/layout.mjs'
import { fetchAll } from './engine/hot.mjs'
import { extractArticle } from './engine/extract.mjs'
import { titleTask, abstractTask } from './engine/tasks.mjs'
import { zip } from './engine/zip.mjs'

const ROOT = path.dirname(fileURLToPath(import.meta.url))
const DATA = path.join(ROOT, 'data')
const IMGDIR = path.join(DATA, 'images')
const SNAPDIR = path.join(DATA, 'versions')
const QUEUE = path.join(DATA, 'queue')
const PORT = Number(process.argv[2] || 8848)

/* titles 也在里面：AI 交稿时把 6 个候选标题写进 data/titles.json，
   界面在 poll 里检测到变化就自动收进候选区（见 app.js 的 ingestTitles）。
   用户原话「不要需要让人再操作第二步了」——
   以前得用户自己把 AI 贴在对话里的标题复制回来。 */
const JSON_FILES = ['project', 'topics', 'materials', 'facts', 'audit', 'images', 'versions', 'titles']
const DEFAULTS = {
  project: {
    title: '', abstract: '', foot: '', theme: 'classic',
    /* 默认风格从 sharp（犀利时评）改成 warm（有温度）。
       用户反馈原话：默认风格「质量还是稍微差一些」「含有你很多 AI 特别常用
       的句式，比如说提前否定，比如说先说结论，免得有人看标题」。
       而 sharp 的 brief 第一句就是「结论前置」—— 正是那个毛病的来源。
       读者是中老年人群，要的是感性、有温度、从人性角度剖析。 */
    tpl: 'mag', style: 'warm', len: '3000',
    /* 默认字号 17px（一号半）、行距 2.0 —— 适配中老年读者 */
    opts: { fs: '17', lh: '2', fc: '#111111', ac: '#c0392b' }
  },
  topics: [], materials: [], facts: [], images: [], versions: [], audit: null,
  /* AI 交稿时把 6 个候选标题写进这里，界面自动收下。
     用户原话「不要需要让人再操作第二步了」——
     以前得用户自己把 AI 给的标题复制回来粘进框里，那正是第二步。 */
  titles: []
}

const ok = (res, d) => { res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(d)) }
const bad = (res, m) => { res.writeHead(400, { 'content-type': 'application/json; charset=utf-8' }); res.end(JSON.stringify({ error: m })) }
/* 文件名白名单。
   原来只有 \w.\-，而 JS 的 \w 不含中文 —— 任何带中文名的图片
   都会让 /api/img-b64、删除、打包全挂（实测报「文件名不合法」）。
   现在放行中日韩字符，但仍然挡掉路径分隔符和 ..，防止穿越。 */
const safe = n => {
  if (!n || typeof n !== 'string') return null
  if (n.length > 200) return null
  if (/[/\\]/.test(n)) return null
  if (n.includes('..')) return null
  if (!/^[\w.\-㐀-䶿一-鿿぀-ヿ가-힯 ]+$/.test(n)) return null
  return n
}
const now = () => new Date().toLocaleString('zh-CN', { hour12: false })
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6)

const readJSON = f => { try { return JSON.parse(fs.readFileSync(path.join(DATA, f), 'utf8').replace(/^\uFEFF/, '')) } catch { return null } }
function writeJSON(name, data) {
  if (!safe(name)) throw new Error('bad name')
  const f = path.join(DATA, name + '.json'), t = f + '.tmp'
  fs.writeFileSync(t, JSON.stringify(data, null, 2), 'utf8')
  fs.renameSync(t, f)
}
const readBody = () => { const f = path.join(DATA, 'body.md'); return fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : '' }
function writeBody(txt) {
  const f = path.join(DATA, 'body.md'), t = f + '.tmp'
  fs.writeFileSync(t, String(txt ?? ''), 'utf8'); fs.renameSync(t, f)
}

for (const d of [DATA, IMGDIR, SNAPDIR, QUEUE]) fs.mkdirSync(d, { recursive: true })
for (const k of Object.keys(DEFAULTS)) if (!fs.existsSync(path.join(DATA, k + '.json'))) writeJSON(k, DEFAULTS[k])
if (!fs.existsSync(path.join(DATA, 'body.md'))) writeBody('')

/* 内容指纹 —— stamp 的正确语义是「数据版本号」，不是「现在几点」。
   原来写的是 now()，于是每次请求 stamp 都是新的，
   前端的 changed 恒为 true，每 4 秒重画整页，
   用户翻到的位置被冲回顶部。

   这个函数只吃内容，不吃时间：
     内容没变 → 指纹不变 → 前端不重绘
     内容变了 → 指纹变   → 前端更新

   用的是一个 32 位 FNV-1a 变体，不是密码学哈希 ——
   这里只要「变了能发现」，不需要防碰撞攻击。 */
function fingerprint(...parts) {
  const t = parts.join('\u0001')
  let h = 0x811c9dc5
  for (let i = 0; i < t.length; i++) {
    h ^= t.charCodeAt(i)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return h.toString(36) + '-' + t.length.toString(36)
}

function snapshot() {
  const s = { stamp: '', themes: Object.entries(THEMES).map(([id, t]) => ({ id, n: t.name, tag: t.tag, preview: t.preview, colors: t.colors })) }
  for (const k of JSON_FILES) s[k] = readJSON(k + '.json') || DEFAULTS[k]
  s.body = readBody()
  s.queue = fs.readdirSync(QUEUE).filter(f => f.endsWith('.json')).sort().map(f => { try { return JSON.parse(fs.readFileSync(path.join(QUEUE, f), 'utf8')) } catch { return null } }).filter(Boolean)
  // 附上每张图的可访问地址，前端不用自己拼
  s.images = (s.images || []).map(x => ({ ...x, url: '/data/images/' + encodeURIComponent(x.file) }))
  /* 指纹只吃真正会影响界面的字段。
     把 stamp 自己排除在外，否则指纹每次都变，又回到老问题。
     队列数量和图片数也算进去 —— 它们会变徽标。 */
  s.stamp = fingerprint(
    s.body,
    JSON.stringify([s.project, s.topics, s.materials, s.facts, s.images, s.titles, s.versions, s.audit]),
    s.queue.length,
    s.themes.length
  )
  return s
}

const readReq = req => new Promise((res, rej) => {
  let b = ''
  req.on('data', c => { b += c; if (b.length > 60e6) req.destroy() })
  req.on('end', () => { try { res(b ? JSON.parse(b) : {}) } catch (e) { rej(e) } })
  req.on('error', rej)
})

/* 乱码探测：UTF-8 解码后出现替换符 U+FFFD，说明原文不是 UTF-8
   （网易、搜狐、部分地方站还是 GBK/GB2312）。 */
const hasBadChar = s => s.includes('\uFFFD')
const decodeEntities = s => String(s || '')
  .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<')
  .replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
  .replace(/&#(\d+);/g, (m, d) => { try { return String.fromCodePoint(+d) } catch { return '' } })
  .replace(/&[a-z]+;/gi, '')

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x')
  const p = decodeURIComponent(url.pathname)
  res.setHeader('access-control-allow-origin', '*')
  res.setHeader('access-control-allow-headers', 'content-type')
  res.setHeader('access-control-allow-methods', 'GET,POST,DELETE,OPTIONS')
  if (req.method === 'OPTIONS') { res.writeHead(204); return res.end() }

  try {
    /* ─── 排版预览（用 markdown-it 内核） ─── */
    if (p === '/api/preview' && req.method === 'POST') {
      const { text, theme, images } = await readReq(req)
      const r = preview(text || '', theme || 'classic', images || [])
      return ok(res, { html: r.body, css: r.theme.css, theme: r.theme })
    }

    /* ─── 生成「交给 AI 的要求」───
       标题、摘要、角度都需要理解全文，本地拼不出来（之前用字符串模板拼，
       出来全是碎片）。所以只负责把正文+事实+约束整理成清楚的指令。 */
    if (p === '/api/task-word' && req.method === 'POST') {
      const { kind, body, style, facts, title, summary } = await readReq(req)
      const b = String(body || '')
      if (b.replace(/\s/g, '').length < 200) return bad(res, '正文太短，先把稿子写完')
      // 注意 ctx 的形状：tasks.mjs 读的是 ctx.body / ctx.facts。
      // 第一版这里传成了 { S: {...} }，跟 tasks.mjs 对不上，
      // 结果任务词里正文和事实全是空的 —— 看起来「生成成功」，其实是空壳。
      const mod = await import('./engine/tasks.mjs')
      const ctx = { body: b, facts: Array.isArray(facts) ? facts : [] }
      const text = kind === 'abs'
        ? mod.abstractTask(ctx)
        : kind === 'angle'
          ? mod.angleTask(ctx, title, summary)
          : mod.titleTask(ctx, { n: style || '你判断', brief: '根据这篇稿子自己的调性' })
      return ok(res, { text, chars: text.length })
    }

    /* ─── 热点原文预览 ───
       用户要「点一下就能看原文」，但浏览器直接抓第三方会被跨域挡。
       所以由服务端代抓：只取正文文字，不执行脚本。 */
    if (p === '/api/hot/peek' && req.method === 'POST') {
      const { url } = await readReq(req)
      if (!/^https?:\/\//i.test(url || '')) return bad(res, '只支持 http/https')
      let raw
      try {
        const r = await fetch(url, {
          headers: {
            'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36',
            'accept-language': 'zh-CN,zh;q=0.9'
          },
          signal: AbortSignal.timeout(12000)
        })
        if (!r.ok) return bad(res, '抓取失败 HTTP ' + r.status)
        const buf = Buffer.from(await r.arrayBuffer())
        raw = new TextDecoder('utf-8', { fatal: false }).decode(buf)
        // 有些站点是 GBK，抓下来全是乱码。检测到就按 GBK 重解。
        if (hasBadChar(raw) && !/charset=["']?gb/i.test(raw.slice(0, 2000))) {
          try { raw = new TextDecoder('gbk').decode(buf) } catch {}
        }
      } catch (e) {
        return bad(res, '抓取失败：' + (e.message || '网络错误'))
      }
      const title = (raw.match(/<title[^>]*>([\s\S]{0,200}?)<\/title>/i) || [])[1] || ''
      /* 正文抽取走独立模块（engine/extract.mjs）。
         在这里堆正则的结果是「抓回来一堆站点导航」：
         新浪首页 新闻 体育 财经 娱乐 …、订阅 RSS订阅 收藏 分享 评论 …
         用户要的是看文章，不是看菜单，所以必须先删页面框架再按文本密度挑正文块。
         该模块有离线单元测试，不依赖打真网站。 */
      const ex = extractArticle(raw, url)
      return ok(res, {
        url,
        title: decodeEntities(title).trim().slice(0, 120),
        text: ex.text.slice(0, 6000),
        chars: ex.chars,
        strategy: ex.strategy,
        isSearchPage: ex.strategy === 'search-page'
      })
    }

    /* ─── 图片 ─── */
    if (p === '/api/upload' && req.method === 'POST') {
      const { name, dataUrl } = await readReq(req)
      const clean = safe(String(name || 'img').replace(/\.[^.]*$/, ''))
      if (!clean) return bad(res, '文件名不合法')
      const m = /^data:image\/(png|jpe?g|webp|gif|svg\+xml);base64,([\s\S]+)$/i.exec(dataUrl || '')
      if (!m) return bad(res, '只支持 png/jpg/webp/gif/svg')
      const ext = m[1].toLowerCase() === 'svg+xml' ? 'svg' : m[1].toLowerCase().replace('jpeg', 'jpg')
      const file = clean + '.' + ext
      const buf = Buffer.from(m[2], 'base64')
      if (buf.length > 20e6) return bad(res, '超过 20MB')
      fs.writeFileSync(path.join(IMGDIR, file), buf)
      return ok(res, { file, size: buf.length })
    }

    if (p === '/api/fetch-img' && req.method === 'POST') {
      const { url: u } = await readReq(req)
      if (!/^https?:\/\//i.test(u || '')) return bad(res, '只支持 http/https')
      const r = await fetch(u, { headers: { 'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)', referer: 'https://weibo.com/' } })
      if (!r.ok) return bad(res, '抓取失败 HTTP ' + r.status)
      const ct = (r.headers.get('content-type') || '').split(';')[0]
      if (!/^image\//i.test(ct)) return bad(res, '不是图片：' + ct)
      const ext = ({ 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif' })[ct] || 'jpg'
      const buf = Buffer.from(await r.arrayBuffer())
      if (buf.length > 20e6) return bad(res, '超过 20MB')
      const file = 'img_' + uid() + '.' + ext
      fs.writeFileSync(path.join(IMGDIR, file), buf)
      return ok(res, { file, size: buf.length })
    }

    /* ─── 图片转 base64（公众号复制时内联图片用） ─── */
    if (p === '/api/img-b64' && req.method === 'POST') {
      const { file } = await readReq(req)
      const f = safe(file)
      if (!f) return bad(res, '文件名不合法')
      const full = path.join(IMGDIR, f)
      if (!fs.existsSync(full)) return bad(res, '图片不存在')
      const ext = path.extname(f).slice(1).toLowerCase()
      const mime = ext === 'png' ? 'image/png' : ext === 'gif' ? 'image/gif'
        : ext === 'webp' ? 'image/webp' : ext === 'svg' ? 'image/svg+xml' : 'image/jpeg'
      const b64 = fs.readFileSync(full).toString('base64')
      return ok(res, { file: f, mime, dataUri: `data:${mime};base64,${b64}`, kb: Math.round(b64.length * 0.75 / 1024) })
    }

    /* ─── 图片打包下载（微信不允许外链时的兜底方案） ─── */
    if (p === '/api/pack' && req.method === 'POST') {
      const { files, manifest } = await readReq(req)
      const list = (Array.isArray(files) ? files : []).map(safe).filter(Boolean).slice(0, 60)
      if (!list.length) return bad(res, '没有可打包的图片')
      const entries = []
      for (let i = 0; i < list.length; i++) {
        const full = path.join(IMGDIR, list[i])
        if (!fs.existsSync(full)) continue
        const ext = path.extname(list[i])
        const base = path.basename(list[i], ext)
        entries.push({ name: String(i + 1).padStart(2, '0') + '-' + base + ext, data: fs.readFileSync(full) })
      }
      if (!entries.length) return bad(res, '图片都不在本地')
      // 附一份插图位置清单，发布时照着放就行
      entries.push({
        name: '00-插图位置清单.txt',
        data: Buffer.from(manifest || '（无位置信息）', 'utf8')
      })
      const buf = zip(entries)
      const title = safe(String(manifest || 'images').split('\n')[0] || 'images') || 'images'
      res.writeHead(200, {
        'content-type': 'application/zip',
        'content-disposition': `attachment; filename="images.zip"; filename*=UTF-8''${encodeURIComponent(title + '-图片包.zip')}`,
        'content-length': buf.length
      })
      return res.end(buf)
    }

    /* ─── 热点榜 ─── */
    if (p === '/api/hot' && req.method === 'GET') {
      const force = url.searchParams.get('force') === '1'
      const only = url.searchParams.get('only')
      const list = await (only ? fetchAll(force) : fetchAll(force))
      const pick = only ? list.filter(x => x.id === only) : list
      return ok(res, { at: new Date().toISOString(), sources: pick, total: pick.reduce((a, b) => a + b.count, 0) })
    }

    if (p.startsWith('/api/image/del/') && req.method === 'POST') {
      const file = safe(p.split('/api/image/del/')[1])
      if (file && fs.existsSync(path.join(IMGDIR, file))) fs.unlinkSync(path.join(IMGDIR, file))
      const list = readJSON('images.json') || []
      writeJSON('images', list.filter(x => x.file !== file))
      // 同时从正文里摘掉引用
      const b = readBody()
      if (file && b.includes('](' + file + ')')) writeBody(b.split('\n').filter(l => !(/^!\[.*\]\(.*\)$/.test(l.trim()) && l.includes(file))).join('\n'))
      return ok(res, { ok: true })
    }

    /* ─── 数据 ─── */
    if (p === '/api/state' && req.method === 'GET') return ok(res, snapshot())

    if (p === '/api/save' && req.method === 'POST') {
      const { name, data } = await readReq(req)
      if (!name) return bad(res, '缺少 name')
      if (name === 'body') writeBody(data)
      else if (JSON_FILES.includes(name)) writeJSON(name, data)
      else return bad(res, '未知字段：' + name)
      return ok(res, { ok: true })
    }

    if (p === '/api/commit' && req.method === 'POST') {
      const { label, text } = await readReq(req)
      const body = text ?? readBody()
      const id = 'v_' + uid()
      fs.writeFileSync(path.join(SNAPDIR, id + '.md'), body, 'utf8')
      const meta = readJSON('versions.json') || []
      const proj = readJSON('project.json') || {}
      meta.unshift({ id, at: now(), label: label || proj.title || '未命名', chars: body.replace(/\s/g, '').length, file: id + '.md' })
      writeJSON('versions', meta.slice(0, 30))
      if (text !== undefined) writeBody(text)
      return ok(res, { ok: true, count: meta.length })
    }

    if (p === '/api/version/read' && req.method === 'POST') {
      const { id } = await readReq(req)
      const f = path.join(SNAPDIR, path.basename(String(id)) + '.md')
      if (!fs.existsSync(f)) return bad(res, '版本不存在')
      return ok(res, { text: fs.readFileSync(f, 'utf8') })
    }

    if (p === '/api/task' && req.method === 'POST') {
      /* 字段名两个都收。
         原来是只认 `req`，但字段叫 requirement 更符合语义，而且外部调用
         （命令行脚本、我自己写的小工具）多半会按 requirement 发。
         结果就是：外部提交的任务 requirement 全是空的 ——
         队列里 6 条历史任务全空，查了很久才定位到这。 */
      const body = await readReq(req)
      const type = body.type
      const requirement = body.requirement ?? body.req ?? ''
      const ref = body.ref
      const force = body.force
      const ty = type || 'write'
      const rf = String(ref || '').trim()

      /* 幂等：同一 type + 同一 ref 已在队列里就拒绝。
         用户连点 10 次「开始写」会落 10 个完全一样的任务，AI 那边要处理 10 遍。
         服务端做最终防线 —— 前端会加锁，但多标签页、脚本调用绕得过去。 */
      if (!force) {
        const existing = fs.readdirSync(QUEUE).filter(f => f.endsWith('.json')).map(f => {
          try { return JSON.parse(fs.readFileSync(path.join(QUEUE, f), 'utf8')) } catch { return null }
        }).filter(Boolean)
        const dup = existing.find(t => t.type === ty && String(t.ref || '').trim() === rf)
        if (dup) {
          return ok(res, { ok: false, duplicate: true, id: dup.id, at: dup.at, message: '队列里已经有同一个任务了' })
        }
      }

      /* 空要求不入队。
         队列里躺了 6 条 requirement 为空的任务 —— AI 那边拿到的是个空任务，
         等于要自己猜用户要写什么。
         空任务比没任务更糟：它占位、去重、还显示在界面上。 */
      if (!String(requirement).trim()) {
        return bad(res, 'requirement 是空的：写清楚要写什么再提交。任务要求丢了 AI 只能瞎猜。')
      }

      const t = { id: uid(), at: now(), status: 'open', type: ty, requirement: requirement || '', ref: rf, title: (readJSON('project.json') || {}).title || '' }
      fs.writeFileSync(path.join(QUEUE, t.id + '.json'), JSON.stringify(t, null, 2), 'utf8')
      return ok(res, t)
    }

    if (p === '/api/task/del' && req.method === 'POST') {
      const { id } = await readReq(req)
      const f = path.join(QUEUE, String(id) + '.json')
      if (safe(String(id)) && fs.existsSync(f)) { fs.unlinkSync(f); return ok(res, { ok: true }) }
      return bad(res, '任务不存在')
    }

    if (p === '/api/reset' && req.method === 'POST') {
      for (const k of Object.keys(DEFAULTS)) writeJSON(k, DEFAULTS[k])
      writeBody('')
      for (const f of fs.readdirSync(QUEUE)) fs.unlinkSync(path.join(QUEUE, f))
      for (const f of fs.readdirSync(SNAPDIR)) fs.unlinkSync(path.join(SNAPDIR, f))
      return ok(res, { ok: true })
    }

    /* ─── 静态 ─── */
    const rel = p === '/' ? '/index.html' : p
    const full = path.join(ROOT, rel)
    if (!full.startsWith(ROOT) || !fs.existsSync(full) || fs.statSync(full).isDirectory()) { res.writeHead(404); return res.end('not found') }

    /* index.html 里的 CSS/JS 链接要带版本号。
       起因：UI 换了配色，文件和服务都是新的，浏览器却还在显示旧的 ——
       用户反馈「你的UI又没有改」。查下来是浏览器缓存。
       响应头已经设了 no-store，实测仍会被缓存（浏览器对 CSS 的处理不一律）。
       可靠办法：链接带 ?v=<文件修改时间>，文件一改 URL 就变，缓存自动失效。
       不用手动记着加参数 —— 服务端注入。 */
    if (p === '/' || p === '/index.html') {
      const v = f => { try { return Date.now() + '-' + fs.statSync(path.join(ROOT, f)).mtimeMs } catch { return String(Date.now()) } }
      let html = fs.readFileSync(full, 'utf8')
      html = html.replace(/(href="\/app\.css)(")/, '$1?v=' + v('app.css') + '$2')
      html = html.replace(/(src="\/app\.js)(")/, '$1?v=' + v('app.js') + '$2')
      res.writeHead(200, {
        'content-type': 'text/html; charset=utf-8',
        'cache-control': 'no-store, no-cache, must-revalidate',
        'pragma': 'no-cache',
        'expires': '0'
      })
      return res.end(html)
    }

    const ext = path.extname(full).toLowerCase()
    const mime = {
      '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
      '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.md': 'text/markdown; charset=utf-8',
      '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif'
    }[ext] || 'application/octet-stream'
    /* no-store 而不是 no-cache：后者仍允许浏览器直接用缓存副本，
       会导致改了 CSS 却看到旧界面 —— 本地工具必须每次都拿最新的。 */
    res.writeHead(200, {
      'content-type': mime,
      'cache-control': 'no-store, no-cache, must-revalidate',
      'pragma': 'no-cache',
      'expires': '0'
    })
    fs.createReadStream(full).pipe(res)
  } catch (e) { res.writeHead(500); res.end(String(e.stack || e)) }
})

server.listen(PORT, '127.0.0.1', () => {
  console.log('\n  写作台  http://127.0.0.1:' + PORT)
  console.log('  数据 ' + DATA + '\n  排版内核 markdown-it  ·  主题 ' + Object.keys(THEMES).length + ' 套\n')
})
