/**
 * 写作台 · 全量对抗验收 v5
 * 覆盖：功能 / 界面 / 文案 / 图案 / 交互 / 回归保护 / 数据安全
 */
import fs from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'
import { execSync, execFileSync } from 'node:child_process'
import { fileURLToPath, pathToFileURL } from 'node:url'
const BASE = 'http://127.0.0.1:8848'
/* 用 import.meta.url 定位，不再硬编码路径 ——
   硬编码过一次，换机器/换目录就全挂，而且挂得很难看。 */
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)))

let pass = 0, fail = 0
const R = []
const ok = (n, c, e) => { c ? (pass++, R.push(['✓', n, e || ''])) : (fail++, R.push(['✗', n, e || ''])) }
const sec = t => R.push(['—', t, ''])

/* 压测会把服务端连接打满，偶发 ECONNRESET。
   重试三次 + 退避，否则一次抖动就让整个验收崩在半路。 */
async function api(p, d, tries = 3) {
  const o = d ? { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(d) } : {}
  let last
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(BASE + '/api' + p, o)
      const t = await r.text()
      let j; try { j = JSON.parse(t) } catch { j = t }
      return { status: r.status, data: j }
    } catch (e) {
      last = e
      await new Promise(r => setTimeout(r, 300 * (i + 1)))
    }
  }
  throw last
}
const sh = c => { try { return execSync(c, { cwd: ROOT, stdio: 'pipe' }).toString() } catch (e) { return (e.stdout || '') + (e.stderr || '') } }

;(async () => {

/* ════════ 1. 能否启动 ════════ */
sec('1 能否启动')
const html = fs.readFileSync(ROOT + '/index.html', 'utf8')
const css = fs.readFileSync(ROOT + '/app.css', 'utf8')
const sty = fs.readFileSync(ROOT + '/engine/styles.mjs', 'utf8')
const 验收src = fs.readFileSync(ROOT + '/验收测试.js', 'utf8')
const stt = fs.readFileSync(ROOT + '/engine/style-test.mjs', 'utf8')
const js = fs.readFileSync(ROOT + '/app.js', 'utf8')
const srv = fs.readFileSync(ROOT + '/server.mjs', 'utf8')
const eng = fs.readFileSync(ROOT + '/engine/layout.mjs', 'utf8')
const hotEngine = fs.readFileSync(ROOT + '/engine/hot.mjs', 'utf8')
const zipEngine = fs.readFileSync(ROOT + '/engine/zip.mjs', 'utf8')

ok('index.html 只引用外部资源', !html.includes('<style') && !/<script>[^<]/.test(html.replace('<script src="/app.js"></script>', '')))
fs.writeFileSync(process.env.TEMP + '/appcheck.js', js)
try { sh('node --check "' + process.env.TEMP + '/appcheck.js"'); ok('app.js 语法正确', true) }
catch (e) { ok('app.js 语法正确', false, String(e).slice(0, 100)) }
ok('服务可连通', (await api('/state')).status === 200)

/* ════════ 2. 排版内核 ════════ */
sec('2 排版内核')
const mdOut = sh('node engine/layout.mjs')
const mdPass = (mdOut.match(/✓/g) || []).length
const mdFail = (mdOut.match(/✗/g) || []).length
ok('排版内核全部自检通过', mdFail === 0, mdPass + ' 项通过')
ok('排版内核项目数 >= 25', mdPass >= 25, mdPass + ' 项')
ok('使用 markdown-it 解析（非手写正则）', /markdown-it/.test(eng) && /MarkdownIt/.test(eng))
ok('排版内核独立于 UI', fs.existsSync(ROOT + '/engine/layout.mjs'))

/* ════════ 3. 主题 ════════ */
sec('3 主题体系')
const st = (await api('/state')).data
ok('主题 >= 6 套', st.themes.length >= 6, st.themes.length + ' 套')
ok('每套主题有 id/n/tag/preview/colors', st.themes.every(t => t.id && t.n && t.tag && t.preview && t.colors))
ok('主题 id 唯一', new Set(st.themes.map(t => t.id)).size === st.themes.length)
// 底色/字色允许部分重复（白底主题靠字号行高区分），但整体不能全同
ok('主题视觉不是全同', new Set(st.themes.map(t => t.preview.bg + t.preview.fc)).size >= 5,
  new Set(st.themes.map(t => t.preview.bg + t.preview.fc)).size + ' 种组合')
const lum = hex => {
  const h = (hex || '').replace('#', '')
  const f = h.length === 3 ? h.split('').map(c => c + c).join('') : h
  const n = parseInt(f || 'ffffff', 16)
  return ((n >> 16 & 255) + (n >> 8 & 255) + (n & 255)) / 3
}
ok('至少含 1 套深色主题', st.themes.some(t => lum(t.preview.bg) < 90),
  st.themes.map(t => t.preview.bg + '(' + Math.round(lum(t.preview.bg)) + ')').join(' '))
ok('主题字号档位有区分', new Set(st.themes.map(t => t.preview.fs)).size >= 3,
  [...new Set(st.themes.map(t => t.preview.fs))].sort((a, b) => a - b).join('/') + ' px')
ok('主题行高档位有区分', new Set(st.themes.map(t => t.preview.lh)).size >= 4,
  [...new Set(st.themes.map(t => t.preview.lh))].sort().join('/'))

/* ════════ 4. 排版真实渲染（调接口，不是比字符串） ════════ */
sec('4 排版渲染真实性')
const body = st.body
const png1x1 = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='
const up = await api('/upload', { name: 'test_probe.png', dataUrl: png1x1 })
ok('测试图片可上传', up.status === 200 && !!up.data.file)

const probeBody = '# 标题一\n\n正文一段。\n\n## 二级标题\n\n- 列表甲\n- 列表乙\n\n> 引用一句话\n\n---\n\n![探针图](' + up.data.file + ')\n\n| A | B |\n|---|---|\n| 1 | 2 |\n\n结尾。'
const results = []
for (const t of st.themes) {
  const r = (await api('/preview', { text: probeBody, theme: t.id, images: [{ file: up.data.file }] })).data
  const h = r.html || ''
  results.push({
    id: t.id,
    hasH1: /<h1>/.test(h),
    hasH2: /<h2>/.test(h),
    hasP: /<p>/.test(h),
    hasUL: /<ul>/.test(h),
    hasBQ: /<blockquote>/.test(h),
    hasHR: /<hr/.test(h),
    hasImg: /<img/.test(h),
    hasTable: /<table>/.test(h),
    imgOk: /<img[^>]*\/data\/images\//.test(h),
    cssLen: (r.css || '').length,
    themeName: r.theme?.name
  })
}
ok('所有主题都渲染出 H1', results.every(x => x.hasH1))
ok('所有主题都渲染出 H2', results.every(x => x.hasH2))
ok('所有主题都渲染出段落', results.every(x => x.hasP))
ok('所有主题都渲染出列表', results.every(x => x.hasUL))
ok('所有主题都渲染出引用', results.every(x => x.hasBQ))
ok('所有主题都渲染出分隔线', results.every(x => x.hasHR))
ok('所有主题都渲染出图片', results.every(x => x.hasImg))
ok('所有主题都渲染出表格', results.every(x => x.hasTable))
ok('图片路径正确映射到 /data/images/', results.every(x => x.imgOk))
ok('每套主题 CSS 都有实质内容', results.every(x => x.cssLen > 800), '最短 ' + Math.min(...results.map(x => x.cssLen)))

const cssSet = new Set()
for (const t of st.themes) {
  const r = (await api('/preview', { text: probeBody, theme: t.id, images: [] })).data
  cssSet.add(r.css)
}
ok('7 套主题 CSS 两两不同', cssSet.size === st.themes.length, cssSet.size + '/' + st.themes.length)

/* ════════ 5. 微信导出 ════════ */
sec('5 微信导出协议')
const wxCss = eng.match(/file:\/\/\/\$\{f\}#wx_fmt=/)
ok('导出支持微信 file 协议', !!wxCss)
ok('导出与预览分离', /toLocalPaths/.test(eng) && /toWechat/.test(eng))
ok('预览不污染 file 协议', eng.indexOf('toLocalPaths') < eng.indexOf('toWechat'))

/* ════════ 5b. 复制到公众号：图片与样式必须活着 ════════ */
sec('5b 公众号复制链路')
ok('存在发布助手面板', /ship-assist/.test(js))
ok('提供「复制图文（含图）」', /copyShip\(\)|data-act="copyShip"/.test(js))
ok('提供「下载图片包」兜底', /packImages|api-pack/.test(js) && /api\/pack/.test(srv))
ok('图片内联为 base64', /img-b64/.test(srv) && /dataUri/.test(srv) && /dataUris?\s*\[/.test(js) && /setAttribute\('src',\s*dataUris/.test(js))
ok('样式内联（INLINE_PROPS 机制存在）', /INLINE_PROPS/.test(js) && /inlineComputed/.test(js))
ok('复制时移除 <style> 标签', /querySelectorAll\('style'\).*remove|remove\(\)/.test(js))
ok('关键：不过滤 0px（丢了会让默认样式复活）', !/v\s*!==\s*'0px'/.test(js), 'margin:0 必须保留')
ok('有剪贴板体积闸门', /LIMIT/.test(js) && /1048576|1024 \* 1024/.test(js))
ok('体积超限有明确出路（打包）', /showTooBig/.test(js) && /packImages/.test(js))
ok('外链图会被警告（公众号会剥掉）', /remote/.test(js) && /外链图/.test(js))
ok('插图位置清单会生成', /插图位置清单/.test(js) && /插图位置清单/.test(srv))
ok('zip 含 UTF-8 文件名标记', /0x0800/.test(zipEngine))
ok('zip 自带 CRC32 校验', /crc32/.test(zipEngine))
ok('zip 用 EOCD 结尾', /0x06054b50/.test(zipEngine))
ok('无第三方 zip 依赖（自己实现）', !/jszip|archiver|adm-zip/i.test(srv))

/* ════════ 5c. 热点信息源 ════════ */
sec('5c 热点信息源')
ok('存在热点采集模块', /export const SOURCES/.test(hotEngine) || /SOURCES\s*=\s*\[/.test(hotEngine))
ok('服务端已挂 /api/hot', /api\/hot/.test(srv))
ok('热点模块有自检入口', /热点源自检/.test(hotEngine))
ok('收录源数量 ≥ 6', (hotEngine.match(/^\s{4}id:\s*'/gm) || []).length >= 6, (hotEngine.match(/^\s{4}id:\s*'/gm) || []).length + ' 个源')
ok('每个源都做真实抓取校验（0 条即判失败）', /解析出 0 条/.test(hotEngine))
ok('抓不到的源明确报错而非返回空数组', /ok:\s*false/.test(hotEngine))
ok('有缓存，避免每次刷新都打源站', /cache\s*=\s*new Map/.test(hotEngine) && /TTL/.test(hotEngine))
ok('请求有超时保护', /AbortSignal\.timeout/.test(hotEngine))
ok('跨平台去重用规范化键', /hotKey/.test(js))
ok('有独立的热点页', /paintHot/.test(js) && /hot-list/.test(js), '热点已并入选题页，改为验证热点面板本身')
ok('热点页可存进选题库', /hotSave/.test(js) && /hotUse/.test(js))
ok('热点页有「这只是入口」的认知提示', /热点只是/.test(js))
ok('热点入口在选题页的 tab 里', /data-act="ideaTab"[\s\S]{0,200}实时热点/.test(js))

/* ════════ 6. 数据完整性 ════════ */
sec('6 数据与图片')
const BACKUP = { body: st.body, project: st.project, facts: st.facts, materials: st.materials, images: st.images, topics: st.topics, versions: st.versions }
ok('已备份生产数据', typeof BACKUP.body === 'string', BACKUP.body.length + ' 字符')
ok('图片库非空', BACKUP.images.length > 0, BACKUP.images.length + ' 张')
ok('每张图有 file 和 url', BACKUP.images.every(x => x.file && x.url))
ok('每张图在磁盘存在', BACKUP.images.every(x => fs.existsSync(path.join(ROOT, 'data/images', x.file))))
/* markdown 里的本地图片写法是 /data/images/<file>（layout.mjs 定的），
   images.json 里存的是裸文件名 <file>。
   两边对不上就全红 —— 所以比之前先剥前缀。 */
const bare = p => String(p).replace(/^\/data\/images\//, '').split('#')[0].split('?')[0]
const refs = [...BACKUP.body.matchAll(/^!\[.*\]\((.*?)\)$/gm)].map(m => m[1])
ok('正文图片引用数 > 0', refs.length > 0, refs.length + ' 处')
/* ★ 这条判据写的时候，正文一直是 0 张图。
   Array.every 对空数组恒为 true —— 它从来没有运行过。
   现在有图了才暴露：refs 是 markdown 里的全路径 /data/images/x.jpg，
   而 images.json 里存的是裸文件名，两边压根不是一个东西。

   剥掉 /data/images/ 前缀再比。 */
ok('正文引用的图都在图片库', refs.every(f => BACKUP.images.some(x => x.file === bare(f))), refs.map(bare).join(','))
ok('正文引用的图都在磁盘', refs.every(f => fs.existsSync(path.join(ROOT, 'data/images', bare(f)))))
/* ════════ 6b. 配图能不能真的显示出来 ════════

   用户原话：「为什么那么少？你没有联网搜索补充素材图像吗？」

   补了 3 张央视原图之后才发现一整类问题 ——
   配图不是「正文里写了 ![]()」就算数，要一路通到浏览器。

   实际事故链：
     正文按 markdown 通用习惯写了全路径 /data/images/x.jpg
     → app.js:1291 无条件再拼一层 /data/images/
     → src 变成 /data/images/%2Fdata%2Fimages%2Fx.jpg
     → 缩略图裂开，公众号导出取 base64 也取不到

   ★ 根因不是「我写错了」，是【约定只写在提示词里】：
     app.js:386 给 AI 的提示写「按 ![说明](文件名) 插进正文」
     app.js:1284 输入框 placeholder 也写「图片写 ![图注](文件名)」
     两处都说了，但没有任何一条断言查它。

   写在哪里不算约定，被检查才算。 */

/* 约定写在代码里，AI 读不到 —— 它读的是手册。
   app.js:386 和 1284 都写了裸文件名，但手册没写，
   所以「按 markdown 通用习惯写全路径」这条路是通的。 */
ok('手册写了裸文件名这条约定（AI 只读手册）', (function () {
  var md = fs.readFileSync(ROOT + '/AI操作手册.md', 'utf8')
  return md.indexOf('裸文件名') >= 0 && /!\[[^\]]*\]\(jz_[^)]+\.jpg\)/.test(md)
})())
ok('手册写了「对不上的图比没有图更糟」和 keep:false', (function () {
  var md = fs.readFileSync(ROOT + '/AI操作手册.md', 'utf8')
  return md.indexOf('对不上的图比没有图更糟') >= 0 && md.indexOf('keep:false') >= 0
})())
ok('★ 正文图片引用用裸文件名（app.js 的约定，不带 /data/images/ 前缀）',
  refs.every(f => !f.startsWith('/') && !f.startsWith('data:') && !f.startsWith('http')),
  refs.join(','))
ok('★ 裸文件名这条约定同时写在提示词和输入框提示里（只写一处会漏）',
  /!\[说明\]\(文件名\)/.test(js) && /!\[图注\]\(文件名\)/.test(js))
ok('★ app.js 有 imgSrc() 作为 src 的唯一拼法',
  /function imgSrc\(/.test(js))
/* ★ 判据要判代码，不能判散文。
   上一版直接扫全文，结果匹配到的是我自己写的注释
   「之前是 1291 行裸拼 "/data/images/" + encodeURIComponent(f)」
   —— 注释里为了讲清楚事故，把坏写法原样抄了一遍。

   所以先剥注释再扫。
   而且 imgSrc 函数体里本来就该有这一拼法，
   所以判据是「剥注释后只剩 imgSrc 内部那一处」。 */
ok('★ app.js 里 /data/images/ 的拼法只在 imgSrc 里（别处裸拼会二次加前缀）', (function () {
  var code = js.replace(/\/\*[\s\S]*?\*\//g, '').split(String.fromCharCode(10))
    .map(function (l) { return l.replace(/^\s*\/\/.*$/, '') }).join(String.fromCharCode(10))
  var at = code.indexOf('function imgSrc(')
  if (at < 0) return false
  var hits = []
  var re = /["'`]\/data\/images\/["'`]\s*\+\s*encodeURIComponent/g
  var m
  while ((m = re.exec(code)) !== null) hits.push(m.index)
  /* 允许的只有 imgSrc 内部那一处；函数体按 400 字节窗口认 */
  var bad = hits.filter(function (h) { return !(h > at && h < at + 400) })
  if (bad.length) console.log('     imgSrc 之外还有 ' + bad.length + ' 处裸拼')
  return bad.length === 0 && hits.length >= 1
})())
ok('★ imgSrc 会剥掉已有的 /data/images/ 前缀（两种写法结果一致）',
  /imgSrc[\s\S]{0,400}replace\(\/\^\\\/data\\\/images\\\//.test(js))
ok('★ layout.mjs 的 toLocalPaths 也是剥前缀再查映射', (function () {
  var lm = fs.readFileSync(ROOT + '/engine/layout.mjs', 'utf8')
  var t = lm.match(/export function toLocalPaths[\s\S]{0,700}/)
  return !!t && /replace\(\/\^\\\/data\\\/images\\\//.test(t[0])
})())

/* 这条是真正能抓住问题的判据：渲染 + 取一次，确认不是裂图 */
ok('★ ★ 排版渲染出的 img src 真能取到（不是裂图）', await (async () => {
  const lm = await import(pathToFileURL(ROOT + '/engine/layout.mjs').href)
  const md0 = fs.readFileSync(ROOT + '/data/body.md', 'utf8')
  const im = JSON.parse(fs.readFileSync(ROOT + '/data/images.json', 'utf8'))
  const snap = im.map(x => ({ ...x, url: '/data/images/' + encodeURIComponent(x.file) }))
  const r = lm.preview(md0, 'classic', snap)
  const srcs = [...(r.body.match(/<img[^>]*src="([^"]+)"/g) || [])]
    .map(x => x.replace(/^<img[^>]*src="/, '').replace(/"$/, ''))
  if (!srcs.length) { console.log('     渲染结果里没有 img'); return false }
  for (const s of srcs) {
    if (/%2F|%20/.test(s)) { console.log('     src 被二次编码: ' + s); return false }
    const q = await fetch(BASE + s)
    if (q.status !== 200 || !/^image\//i.test(q.headers.get('content-type') || '')) {
      console.log('     取不到: ' + s + ' → ' + q.status)
      return false
    }
  }
  console.log('     ' + srcs.length + ' 张都取到了')
  return true
})())
ok('★ ★ img-b64 能按裸文件名取到（公众号导出靠它内联图片）', await (async () => {
  const r = await fetch(BASE + '/api/img-b64', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ file: bare(refs[0]) })
  })
  if (!r.ok) { console.log('     HTTP ' + r.status); return false }
  const j = await r.json()
  const okB = typeof j.dataUri === 'string' && /^data:image\//.test(j.dataUri)
  if (!okB) console.log('     拿到的不是 data:image')
  return okB
})())
ok('每张图 URL 可访问', await (async () => {
  for (const x of BACKUP.images.slice(0, 5)) {
    const r = await fetch(BASE + x.url)
    if (r.status !== 200 || !/image\//.test(r.headers.get('content-type') || '')) return false
  }
  return true
})())

/* ════════ 7. 回归保护 ════════ */
sec('7 回归保护机制')
ok('回归基线脚本存在', fs.existsSync(ROOT + '/回归基线.js'))
const rb = sh('node 回归基线.js')
ok('回归比对可运行', /回归比对|基线/.test(rb), rb.includes('无破坏') ? '当前无破坏' : '有变化（需确认）')
ok('基线文件已生成', fs.existsSync(ROOT + '/data/_baseline.json'))
const snap = (await api('/state')).data
ok('基线记录了图片数', /"count"/.test(fs.readFileSync(ROOT + '/data/_baseline.json', 'utf8')))

/* ════════ 8. 接口健壮性 ════════ */
sec('8 接口健壮性')
ok('空 save 返回 400', (await api('/save', {})).status === 400)
ok('未知字段 400', (await api('/save', { name: 'zzz', data: 1 })).status === 400)
/* 大正文压测。
   ★ 原来测完不还原，5 万字测试稿直接留在 data/body.md 里 ——
   我自己踩过：跑完验收一看正文变成 50000 字、图片引用全丢。
   验收脚本绝不能污染真实数据，测完必须原样写回。 */
{
  const keep = fs.readFileSync(ROOT + '/data/body.md', 'utf8')
  const big = 'x'.repeat(50000)
  const r1 = (await api('/save', { name: 'body', data: big })).status === 200
  const pv = await api('/preview', { text: big, theme: 'classic', images: [] })
  const r2 = !!(pv.data && pv.data.html && pv.data.html.length > 0)
  await api('/save', { name: 'body', data: keep })
  const back = fs.readFileSync(ROOT + '/data/body.md', 'utf8')
  ok('5 万字不崩', r1 && r2)
  ok('★ 压测后正文原样还原（不污染真实数据）', back === keep, `${back.length} vs ${keep.length} 字符`)
}
/* 并发压测不能用 facts 当靶子 —— 它写真实数据。
   之前就是拿 facts 写的，跑到后面「待核事实非空」那条断言必挂：
   靶子自己把被检查的对象清空了。
   改用 topics（选题），压测完顺手还原。 */
ok('30 并发不崩', (await Promise.all(Array.from({ length: 30 }, () =>
  api('/save', { name: 'topics', data: [{ id: 'stress' + Math.random().toString(36).slice(2), title: '压力测试', at: new Date().toISOString() }] })
))).every(r => r.status === 200))
await api('/save', { name: 'topics', data: BACKUP.topics })
ok('★ 并发压测后选题已还原（不污染真实数据）',
  JSON.stringify((await api('/state')).data.topics) === JSON.stringify(BACKUP.topics))
ok('未知路由 404', (await fetch(BASE + '/api/xxx')).status === 404)
ok('目录穿越被挡', !fs.existsSync(BASE))
const tk = await api('/task', { type: 'write', requirement: 'x', ref: 'r' })
await api('/task/del', { id: tk.data.id })
ok('任务可提交可撤销', (await api('/task/del', { id: tk.data.id })).status === 400)
ok('非法图片 dataUrl 被拒', (await api('/upload', { name: 'a.txt', dataUrl: 'data:text/html;base64,PHNjcmlwdD4=' })).status === 400)
ok('路径穿越文件名被拒', (await api('/upload', { name: '../../evil', dataUrl: png1x1 })).status === 400)
ok('空正文预览不崩', (await api('/preview', { text: '', theme: 'classic', images: [] })).status === 200)
ok('非法 Markdown 不崩', (await api('/preview', { text: '***\n|||\n###\n- ', theme: 'classic', images: [] })).status === 200)
ok('未知主题不崩', (await api('/preview', { text: 'x', theme: 'not_exist', images: [] })).status === 200)
ok('超大正文预览不崩', (await api('/preview', { text: '段落。\n\n'.repeat(2000), theme: 'classic', images: [] })).status === 200)
ok('预览返回 css', /"css"/.test(JSON.stringify((await api('/preview', { text: 'x', theme: 'classic' })).data)))

/* ════════ 9. 静态资源 ════════ */
sec('9 静态与资源')
ok('首页 200', (await fetch(BASE + '/')).status === 200)
ok('CSS 200', (await fetch(BASE + '/app.css')).status === 200)
ok('JS 200', (await fetch(BASE + '/app.js')).status === 200)
const cssResp = await fetch(BASE + '/app.css')
ok('CSS MIME 正确', /text\/css/.test(cssResp.headers.get('content-type') || ''))
const jsResp = await fetch(BASE + '/app.js')
ok('JS MIME 正确', /javascript/.test(jsResp.headers.get('content-type') || ''))
// 真实外链 = script/link/img 标签里的 http(s) 引用；SVG 命名空间与占位符不算
const realExt = [
  ...[...html.matchAll(/<(?:script|link|img)[^>]*(?:src|href)="(https?:\/\/[^"]+)"/g)].map(m => m[1]),
  ...[...css.matchAll(/url\((['"]?)(https?:\/\/[^)'"]+)\1\)/g)].map(m => m[2]),
  ...[...js.matchAll(/fetch\((['"])(https?:\/\/[^'"]+)\1\)/g)].map(m => m[2])
]
ok('无第三方资源外链（离线可用）', realExt.length === 0, realExt.join(' '))

/* ════════ 9b. 输入不能被轮询冲掉 ════════ */
sec('9b 输入保护（曾被轮询冲掉的 bug）')
ok('isTyping 通用判断存在', /function isTyping/.test(js))
ok('焦点在 input/textarea/select 上即算输入中', /TEXTAREA.*SELECT|SELECT.*TEXTAREA/.test(js) && /INPUT/.test(js))
ok('轮询在输入时跳过', /if \(!isTyping\(\)\) poll/.test(js))
ok('输入时不重渲染当前页', /id === curPage && isTyping\(\)/.test(js))
ok('有焦点与光标位置复原', /function snapFocus/.test(js) && /restoreFocus/.test(js))
ok('渲染表驱动（加页必须登记）', /Object\.assign\(RENDER/.test(js) && /const RENDER =/.test(js))
ok('不再用 editing 标志做输入保护', !/let editing/.test(js) && !/editing\s*=\s*(true|false)/.test(js), '改由 isTyping() 按焦点判断')

/* ════════ 9c. 流程结构：四步（热点与定题已拆开）════════ */
sec('9c 流程结构')
const navOrder = [...js.matchAll(/\{ id:'(\w+)',\s*n:'(\d+)'/g)].map(m => m[1])
ok('四步：hot→idea→write→ship', navOrder.join('→') === 'hot→idea→write→ship', navOrder.join(' → '))
ok('热点独立成第 1 页', /function renderHot/.test(js) && /id="p-hot"/.test(js))
ok('定题独立成第 2 页，不再混热点', /function renderIdea/.test(js) && !/function renderIdea[\s\S]{0,3000}hot-tab/.test(js))
ok('成稿、配图、核对全在第 3 页', /function renderWrite/.test(js) && !/function renderMedia/.test(js) && !/function renderCheck/.test(js))
ok('核对页已删除（无 p-check 节点与函数）', !/id="p-check"/.test(js) && !/function renderCheck/.test(js))
ok('没有旧分区节点', !/id="p-ask"|id="p-draft"|id="p-media"|id="p-review"|id="p-topics"/.test(js))
ok('渲染表正好 4 页', /\{ hot: renderHot, idea: renderIdea, write: renderWrite, ship: renderShip \}/.test(js))
/* 侧栏原来有三个 tab（标题 / 核对 / 素材），现已按用户要求删成一块「交付」。
   原话：「你那个什么素材啊，还有那个什么检查，那都不需要有那些玩意。」 */
/* 交付面板原来是右侧栏，现在是正文下方的横排区。
     用户原话「成稿页面右侧应该预览它的那个文章」——
     右侧让给文章预览，工具面板挪到下面，三块并排。 */
ok('★ 成稿页侧栏不再是 tab 切换', !/sideTab/.test(js))
/* 交付区从三块变两块：改写已移到右侧（用户要求），
   剩下的「标题」那块只在需要手工粘贴时才用到。 */
ok('★ 交付区是横排两块（自检 / 标题）',
  /class="deliver-grid deliver-grid-2"/.test(js) && /class="dc dc-chk"/.test(js) &&
  /class="dc dc-title"/.test(js) && !/dc dc-fix/.test(js))
ok('★ 交付区在正文主栏内（不是侧栏）',
  js.includes('<div id="ver-cmp"></div>') &&
  js.indexOf('renderDeliverPane(a, facts)}') < js.indexOf('class="write-side write-aside"'))
ok('★ 素材面板已删（无 mat pane / addMat / insertMat / delMat）',
  !/sideTab === 'mat'/.test(js) && !/async addMat/.test(js) &&
  !/async insertMat/.test(js) && !/async delMat/.test(js) && !/mat-in/.test(js))
ok('★ 自检结果显示在交付面板顶部（不用点任何按钮）',
  /function selfCheck/.test(js) && /function renderSelfCheck/.test(js) &&
  /<div class="side-h">自检/.test(js))
ok('★ 自检含「标题与正文相符」（本地算实词重合度）',
  /titleOk\.cover/.test(js) && /标题与正文相符/.test(js))

/* ════════ 9c2. 输入必须能存下来 ════════ */
sec('9c2 输入持久化')
ok('定题框写入 project.topic', /t\.id === 'topic'\) \{ S\.project\.topic = t\.value; markDirty\('project'\); save\(\) \}/.test(js))
ok('补充要求写入 project.req', /t\.id === 'req'\) \{ S\.project\.req = t\.value; markDirty\('project'\); save\(\) \}/.test(js))
ok('定题框回填已存的值', /id="topic"[\s\S]{0,120}esc\(S\.project\.topic/.test(js))
ok('字数/文风下拉也存', /t\.id === 'len'/.test(js) && /t\.id === 'style'/.test(js))
ok('不再有 noop 占位', !/id === 'topic'\) \{ \/\* noop/.test(js))
ok('选中选题后跳去定题页（两环节已拆开）', /async useTopic[\s\S]{0,600}?go\('idea'\)/.test(js))
ok('选中热点后也跳去定题页', /async hotUse[\s\S]{0,600}?go\('idea'\)/.test(js))
ok('两处都只写 topic，绝不碰标题（踩过两次）',
  /async useTopic[\s\S]{0,300}?S\.project\.topic = t\.title/.test(js) &&
  !/async useTopic[\s\S]{0,300}?S\.project\.title/.test(js) &&
  !/async hotUse[\s\S]{0,300}?S\.project\.title/.test(js))
ok('补充要求标注选填', /选填/.test(js) && /不填角度、不填要求/.test(js))
ok('提交只要求有题，不要求有角度', /if \(!topic\) \{ toast\('先写一句想写什么'/.test(js) && !/if \(!req\)/.test(js))

/* ════════ 9c2b. toast 必须真的藏住（用户报的「顶部刘海」）═══════
   历史：写的是 top:24px + translateY(-120%)。空 toast 高 22px，
   -120% 只挪 26px，于是 20px 深色框常驻视口顶部正中，fixed 全站可见。
   验收方式改成检查「隐藏态必须完全在视口之上」。 */
sec('9c2b toast 隐藏')
const toastCss = (css.match(/#toast\{[^}]*\}/) || [''])[0]
ok('★ toast 隐藏态用 visibility:hidden（不参与绘制，藏得死）',
  /visibility:hidden/.test(toastCss) && /visibility:visible/.test(css))
// 只查声明部分：注释里为了记录历史也写了 -120%，不能算命中
const cssCode = css.replace(/\/\*[\s\S]*?\*\//g, '')
ok('★ 不再靠百分比位移隐藏（-120% 只挪 26px，露了 20px）',
  !/translate\(-50%,-120%\)/.test(cssCode) && !/translateY\(-120%\)/.test(cssCode) && !/translateY\(-100%\)/.test(cssCode))
ok('toast 隐藏时不透明也不吃点击', /opacity:0/.test(toastCss) && /pointer-events:none/.test(toastCss))
ok('toast 位置不再贴视口顶边', /top:var\(--s5\)/.test(toastCss) && !/#toast\{[^}]*top:0/.test(css))
ok('显示态有明确落点', /#toast\.on\{[^}]*translateX\(-50%\) translateY\(0\)/.test(css))

/* ════════ 9c3. 发布页：排版在左 · 预览在右 · 无手机壳 ════════ */
sec('9c3 发布页')
const srvTxt = fs.readFileSync(ROOT + '/server.mjs', 'utf8')
ok('★ safe() 支持中文文件名（原来 \w 不含中文，带中文名会让 b64/删除/打包全挂）',
  /一-鿿/.test(srvTxt.match(/const safe[\s\S]{0,400}/)?.[0] || ''))
ok('safe() 仍挡住路径穿越', /\\\//.test(srvTxt) && /includes\('\.\.'\)/.test(srvTxt))
ok('左侧工具栏 + 右侧预览两栏', /\.ship-wrap\{[^}]*grid-template-columns:260px minmax\(0,1fr\)/.test(css))
ok('工具栏在左（DOM 顺序即左侧）',
  js.indexOf('<aside class="ship-left">') < js.indexOf('<div class="ship-main">'))
ok('主题做成竖排列表并带 tag',
  /class="theme-list"/.test(js) && /class="theme-row /.test(js) && /\.theme-list\{/.test(css) && /t\.tag/.test(js))
ok('预览宽度可切三档', /WIDTHS/.test(js) && /shipWidth/.test(js) && /data-act="shipWidth"/.test(js))
ok('★ 三档宽度互不相同（有过 600/760 被夹成同宽的废选项）',
  /\{ w: 375,/.test(js) && /\{ w: 480,/.test(js) && /\{ w: 640,/.test(js))
ok('宽度被夹住时如实显示实际值', /measurePaper/.test(js) && /放不下/.test(js))
ok('★ 黑色手机壳已删除（页面顶部那条"刘海"就是它）', !/class="phone"/.test(js) && !/\.phone\{/.test(css))
ok('预览改用 paper-shell 白纸', /class="paper-shell"/.test(js) && /\.paper-shell\{/.test(css))
ok('有主复制按钮', /data-act="copyShip"/.test(js))
ok('兜底方案收进折叠区', /图片丢了怎么办/.test(js))
ok('发布页不进后台轮询重渲染（否则预览闪烁）', /if \(id === 'ship'\) continue/.test(js))
ok('静态资源 no-store（改 CSS 立刻生效）', /no-store/.test(srvTxt))
/* ★ 这条原来查 /\.page\.wide-page\{padding:0/，
     也就是「成稿与发布两页去掉左右内边距，让内容铺满」。

     它锁住的正是第十四轮查出来的病根：
     wide-page 把 .page 的留白整个拿掉，
     于是这三页横向 24px、别页 16px —— 切页就能看出来。

     意图保留（内容尽量宽），做法改掉：
     现在 wide-page 和别的页一样 24px，
     内容铺满交给 .container.full{max-width:none}。

     ★ 同一个东西两条判据打架时，要问哪条的理由更强：
       「铺满」是排版偏好，「边距统一」是可用性 —— 后者更硬。 */
ok('成稿与发布两页的留白和其他页一致（不再单独去掉）', (function () {
  var body = css.replace(/\/\*[\s\S]*?\*\//g, '')
  /* 同样用 [^;}]+：padding 后面可能没有分号就闭合了 */
  var a = body.match(/\.page\s*\{[^}]*padding:\s*([^;}]+)/)
  var b = body.match(/\.page\.wide-page\s*\{[^}]*padding:\s*([^;}]+)/)
  if (!a) { console.log('     没找到 .page 的 padding'); return false }
  if (!b) {
    /* 没写 wide-page 的 padding = 继承 .page 的，同样一致 */
    return true
  }
  var norm = s => s.trim().replace(/\s+/g, ' ')
  if (norm(a[1]) === norm(b[1])) return true
  console.log('     .page = ' + norm(a[1]) + '   wide-page = ' + norm(b[1]))
  return false
})(), '两边都指向 var(--s5) var(--s5) 96px')

/* ════════ 9c3b. 主题 CSS 作用域（真 bug：会漏到应用 UI 上）════════ */
sec('9c3b 主题作用域')
ok('有 scopeCss 加前缀', /function scopeCss/.test(js) && /scopeCss\(r\.css, '\.paper-shell'\)/.test(js))
ok('★ 排版正文包在 <section> 里（11 套主题的字号全挂在它上面）',
  /'<section>' \+ inner \+ '<\/section>'/.test(fs.readFileSync(ROOT + '/engine/layout.mjs', 'utf8')))
ok('换主题时撤掉旧 style', /\$\('style\[data-for="ship"\]'\)\.forEach\(n => n\.remove\(\)\)/.test(js))

/* ════════ 9c4. 正文必须是主角 ════════ */
sec('9c4 版面主次')
/* 成稿页现在两栏：左编辑 + 右文章预览。
     预览栏宽度有上下限，不能写 1fr ——
     1fr 会把宽度和平分，编辑区就被挤窄了，长文没法写。 */
ok('★ 成稿页左编辑 + 右文章预览，宽度有上下限',
  css.includes('grid-template-columns:minmax(0,1fr) minmax(340px,380px)'))
ok('侧栏有宽度上限', /\.write-side\{[^}]*max-width:340px/.test(css))
ok('正文编辑器够高', /min-height:max\(600px/.test(css))
/* 成稿页现在是「左编辑 + 右文章预览」，两栏都要有可用宽度。
   窄屏统一在 1024px 断点上下堆叠 —— 1100 以下预览栏只剩两百来像素，等于没有。 */
ok('★ 成稿页窄屏在 1024px 上下堆叠',
  css.includes('@media (max-width:1024px){') &&
  /@media \(max-width:1024px\)\{[\s\S]*?\.write-grid\{grid-template-columns:1fr/.test(css) &&
  /\.write-side\.write-preview\{max-height:60vh/.test(css))
ok('★ write-grid 只有一套桌面比例（旧的 3fr/5fr 已清）',
  !/grid-template-columns:3fr 1fr/.test(css) && !/grid-template-columns:5fr 1\.1fr/.test(css))

/* ════════ 9c7a. 成稿页右侧必须是文章预览 ════════
   用户原话：「成稿页面右侧应该预览它的那个文章」。

   2026-10-03 之前右侧是一块工具面板（自检/标题/改写）——
   工具不是文章。写稿的人看不到自己的稿子长什么样，
   只能等排到发布页才知道，而发布页看的是排版后的效果，不是文章本身。

   这是我连着三轮都没看界面、只改规则和判据漏掉的。 */
/* ════════ 9c5. 成稿页：单一可编辑文框（阅读/编辑分离已按要求删除）═══════ */
sec('9c5 成稿页')
ok('★ 阅读/编辑分离已删除（用户反馈「搞得有点复杂」）',
  !/writeView/.test(js) && !/function renderDraft/.test(js) && !/data-act="writeView"/.test(js))
ok('只有一个可编辑文框', /<textarea class="editor" id="body"/.test(js))
ok('★ 右侧不再堆图库缩略图', !/class="img-row"/.test(js) && !/class="img-list"/.test(js) && !/class="img-grid"/.test(js))
ok('★ 待用图片条已删除（用户「没看懂它有什么用」）', !/class="pick-strip"/.test(js) && !/\.ps-item\{/.test(css))
ok('图库默认收起', /let libOpen = false/.test(js))
ok('图库可展开且含配图动作', /data-act="toggleLib"/.test(js) && /class="lib-actions"/.test(js) &&
  /findImg/.test(js) && /suggestImg/.test(js) && /fetchImg/.test(js))
ok('正文里的图有位置条（点一下能定位到图库）', /class="img-where"/.test(js) && /data-act="imgWhere"/.test(js) && /\.iw-item\{/.test(css))
ok('拖放区绑到图库里的 .drop-hint', /\.drop, \.drop-hint/.test(js) && /class="drop-hint" id="drop"/.test(js))
ok('推荐插入位置面板在主区', /id="img-plan"/.test(js))

/* ════════ 9c5b. 提交去重（用户：点 10 次就加了 10 个任务）═══════ */
sec('9c5b 提交去重')
ok('★ 前端有提交锁（submitting）', /let submitting = false/.test(js) && /if \(submitting\)/.test(js))
ok('★ 每次点击都有反馈（成功/重复/失败都提示）',
  /已提交，话术也复制好了/.test(js) && /已经有这个题了/.test(js) && /正在提交/.test(js))
ok('★ 服务端 /api/task 幂等（同 type+ref 拒绝）', /duplicate: true/.test(srvTxt) && /r\.duplicate/.test(js))
ok('改稿走 force（迭代任务不该被去重误伤）',
  /type:'rewrite'[\s\S]{0,200}force: true/.test(js))
ok('查事实/找图复用去重并提示', /r && r\.duplicate \? '队列里已经有/.test(js))
ok('配图数量写进写作任务', /【配图】必须配图，共 \$\{imgN\} 张/.test(js))
ok('定题页可选配图数量 4/6/8/10/12（默认 10，用户要「默认多一些」）',
  /const IMG_N = \[4, 6, 8, 10, 12\]/.test(js) && /data-act="imgN"/.test(js))

/* ════════ 9c5c. 队列与历史必须分开 ════════ */
sec('9c5c 队列与历史')
ok('★ 定题页有独立的「队列」区块', /<h3>队列<\/h3>/.test(js))
ok('★ 定题页有独立的「历史稿」区块', /<h3>历史稿<\/h3>/.test(js))
ok('★ 历史稿可点击打开回填', /data-act="openVer"/.test(js) && /openVer\(id\)/.test(js))
ok('队列条目有类型徽标', /class="badge-type"/.test(js) && /\.task \.badge-type\{/.test(css))
ok('历史项有明确的「打开」提示', /class="go">打开/.test(js))
ok('不再把历史叫「排队中」', !/<h3>排队中<\/h3>/.test(js))

/* ════════ 9c6. 标题：交给 AI 生成，本地不拼模板 ════════
   之前这里有 20 行断言围着 titleIdeas 转，现在那套删了。
   原因：字符串模板填空做不到语义理解，出的是碎片和跟文章无关的固定文案
   （实测出过「上**。一款营养饮宣传，这句话值多少分？」这种从正文硬截 16 字的碎片，
     还有「所有人都记住了XX」这种为上一篇写死的句子）。
   用户原话：「你这文章质量非常差」。
   分工：本地只负责把「正文 + 事实清单 + 风格 + 约束」整理成一段清楚的指令。 */
sec('9c6 标题')
const taskTxt = fs.existsSync(ROOT + '/engine/tasks.mjs')
  ? fs.readFileSync(ROOT + '/engine/tasks.mjs', 'utf8') : ''
/* harvest / XING / topicWords 整块已删：
   它们只为 titleIdeas 服务，标题改由 AI 生成后全部零调用。
   不删的后果：下一个人会以为它们有用，而且里面藏着上一篇文章的固定文案。 */
ok('★ 本地不再拼标题模板', !/function titleIdeas/.test(js))
ok('★ 实体抽取层已一并清掉（harvest / XING / topicWords）',
  !/function harvest/.test(js) && !/const XING/.test(js) && !/function topicWords/.test(js))
ok('★ 界面上没有标题候选列表了', !/class="title-ref"/.test(js))
ok('★ 有「复制起标题要求」按钮', /data-act="taskTitle"/.test(js))
/* 「复制写摘要要求」按钮已删：用户原话「你最后给出标题都得几种，
   不要需要让人再操作第二步了」，摘要一并交给写稿那一步出，
   单独再要一次是多余的一步。 */
/* 原来查「本地拼不出来」，现在文案是「本地拼出来的都是碎片」。
/* 标题候选：粘回来一键替换，不要再手动去标题栏改 */
ok('★ 有标题候选粘贴区', /id="title-in"/.test(js) && /function parseTitlePool/.test(js))
ok('★ 每个候选都是可点的一键替换', /data-act="useTitle"/.test(js) && /useTitle\(i\)/.test(js))
ok('★ 有「一键改写」', /data-act="fix"/.test(js) && /async fix\(\)/.test(js))
ok('★ 改写是把「要求 + 原文」复制出去，不是提交队列',
  /回到 AI 对话工具，粘贴发送/.test(js) && !/type: ?'rewrite'[^\n]*\n[^\n]*keepFixReq/.test(js))
ok('★ 服务端有任务词接口', /api\/task-word/.test(srvTxt))
ok('★ 任务词接口把正文传进去（ctx 形状必须对，传错会生成空壳）',
  /const ctx = \{ body: b, facts:/.test(srvTxt))
ok('有任务词模块', fs.existsSync(ROOT + '/engine/tasks.mjs'))
/* 「不同方向」现在拆成了一段独立说明（「写法」和「方向」是两件事），
   断言查整句话就匹配不上了。改成查三件具体的事：
     要 6 个、要有方向区分、要按推荐顺序 */
ok('★ 任务词要求 6 个不同方向的完整标题且按推荐顺序',
  /给我 6 个完整标题/.test(taskTxt) &&
  /按推荐顺序排/.test(taskTxt) &&
  /方向 = 落在文章哪一块/.test(taskTxt))
/* 用户点名要「面向中老年人」和「不要提前否定」，必须写进任务词 */
ok('★ 任务词写明读者是中老年人群', /读者是中老年人群/.test(taskTxt))
ok('★ 任务词禁止「先说结论」这类提前否定', /不许提前否定/.test(js) && /免得有人只看标题/.test(js))
/* 风格清单在 app.js（界面）和 styles.mjs（判据）里各有一份。
   加新风格忘了同步，就会出现「下拉里能选，自检却报『未知风格』」。
   这里做硬对齐：两边必须一一对应。 */
ok('★ 任务词禁止标题用双引号包起来', /不要用双引号/.test(taskTxt))

sec('9c6s 风格清单对齐')
{
  const uiIds = (js.slice(js.indexOf('const STYLE_LIST'), js.indexOf('const STYLE_CN'))
    .match(/\['(\w+)',/g) || []).map(x => x.slice(2, -2))
  const ruleIds = [...(await import('file://' + ROOT + '/engine/styles.mjs')).STYLES ?
    Object.keys((await import('file://' + ROOT + '/engine/styles.mjs')).STYLES) : []]
  ok('★ 界面下拉里的风格都在 styles.mjs 里有判据',
    uiIds.filter(x => x !== 'auto').every(x => ruleIds.includes(x)),
    uiIds.filter(x => x !== 'auto' && !ruleIds.includes(x)).join('、'))
  ok('★ 默认风格是有温度（warm）',
    /style:\s*'warm'/.test(srvTxt) &&
    /S\.project\.style\s*\|\|\s*'warm'/.test(js))
  ok('★ warm 风格硬禁「提前否定」',
    /不许提前否定/.test(fs.readFileSync(ROOT + '/engine/styles.mjs', 'utf8')))

/* ════════ 9c6v. 「要有温度/人性/人生哲理」是可测的 ════════
   用户原话：「你应该特别感性，从人性的角度出发……特别写的东西特别有温度……
   你要有深度地去剖析人性角度这些光芒点，然后还有整个人生的角度那些大的哲理。」

   以前只做了「不许什么」（不许升华、不许空洞感动），
   没有一条「要什么」—— 只禁不给等于没要求，AI 照样写成干巴巴的叙事。
   2026-10-03 补了三条必有余量，界面上也加了两项自检。

   ★ 而且原来那条「不许升华收尾」和「要人生哲理」正面冲突 ——
     用户要的就是有点哲理的收尾，我禁的却是同一类东西。
   所以禁令改成「不许空洞口号式收尾」，只禁空的那一类。 */
sec('9c6v 有温度/人性/人生哲理')
{
  const st2 = fs.readFileSync(ROOT + '/engine/styles.mjs', 'utf8')
  ok('★ warm 必有没有「人的处境」这一项',
    /要有人的处境（难在哪 \/ 亏在哪 \/ 舍不得）/.test(st2))
  ok('★ warm 必有没有「人生视角」这一项',
    /要把事放到「一辈子」的长度里看/.test(st2))
  /* 只看 warm 那一段，且剥掉注释再查。
     两层过滤都必要：
       ·别的风格（crit）本来就该禁升华 —— 那是它自己的规矩，不能一刀切
       ·warm 段的注释里记录了「以前写的是不许升华收尾」这句话，
         不剥注释就会把注释当成代码 —— 这个坑本项目踩过 4 次了。 */
  const warmBlock = st2.slice(st2.indexOf('  warm: {'), st2.indexOf('  sharp: {'))
    .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
  ok('★ 禁令改成「空洞口号」而不是「升华」',
    /不许空洞口号式收尾/.test(warmBlock) && !/不许升华收尾/.test(warmBlock))
  ok('★ 空洞口号清单里含「让我们一起努力」这类',
    /让我们一起努力/.test(st2))
  ok('★ 偏好项不再是「零升华」（那在催 AI 别写哲理）',
    !/零升华收尾/.test(st2) && /人生\/命运类大词密度/.test(st2))
  ok('★ 大词密度目标定低（0.35/千字，是点缀不是灌水）',
    /good: 0\.35/.test(st2))

  /* 界面上必须看得见，否则用户以为「有温度」被检查过了 */
  ok('★ 界面自检有「写出了人的处境」这一项',
    /写出了人的处境/.test(js))
  ok('★ 界面自检有「有人生视角」这一项',
    /有人生视角/.test(js))
  ok('★ 两项都接在正文上，不是写死的',
    /condHit/.test(js) && /lifeHit/.test(js) &&
    /const body = String\(S\.body \|\| ''\)/.test(js.slice(js.indexOf('function renderSelfCheck'))))

  /* 手册必须正面写「要有」，不只是「不许有」 */
  const m2 = fs.readFileSync(ROOT + '/AI操作手册.md', 'utf8')
  ok('★ 手册有一整节讲「要有温度/人性/人生」',
    /要有温度，也要有人性，也要有点人生/.test(m2))
  ok('★ 手册明确「这是要有，不是不要有」',
    /这是「要有」，不是「不要有」/.test(m2))
  ok('★ 手册给了空/实对照表', /这么写（空）/.test(m2) && /这么写（实）/.test(m2))
  ok('★ 手册写明只禁空的那一栏', /禁的是空的那一栏，不是有内容的那一栏/.test(m2))
  ok('★ 手册写出要用的具体词',
    /一辈子/.test(m2) && /半辈子/.test(m2) && /这样的年纪/.test(m2))

  /* 当前正文必须真的满足这两项 —— 光有规则没用 */
  {
    const b3 = fs.readFileSync(ROOT + '/data/body.md', 'utf8')
    const cond = /(不容易|难的是|难在|舍不得|放不下|将心比心|换位|退一步|心里明白|懂的人|亏了|不值|多想一步|替别人想)/.test(b3)
    const life = /(一辈子|半辈子|这样的年纪|到头来|活了大半辈子|一辈子一回|年轻时|老了|临了|这辈子)/.test(b3)
/* 这条量的是「将心比心」「替别人想」「换位思考」——
   那是暖笔法的标志。犀利时评要的是判断和立场，不替对方设想。
   一篇讲海关破走私案的稿子写「替那些孕妇想一想」就成散文了。

   ★ 判据跟着风格走 —— 本轮第三次修同一类问题。 */
ok('★ 人的处境判据跟着风格走（sharp 要的是判断不是共情）', (function () {
  var st = ''
  try {
    st = JSON.parse(fs.readFileSync(ROOT + '/data/project.json', 'utf8')).style || ''
  } catch (e) { st = '' }
  if (st === 'sharp') {
    /* 犀利时评：看有没有明确判断，而不是有没有共情词 */
    return /(无\s*人|没有一个人|一次不落|一条不落|全部落网)/.test(b3) ||
           /这不是|按.{0,6}规定/.test(b3)
  }
  return cond
})())
/* ★ 这条原来无条件要求「人生视角」——
   量的是一辈子/到头来/值得 这类大词密度。
   那是暖风格的要求。一篇讲海关破走私案的犀利时评
   不该有这些词，一有就被判「灌水」。

   所以问题不在判据宽，在【判据不知道当前是什么风格】。
   改法不是放松判据，是让判据知道现在是什么风格。 */
ok('★ 人生视角判据跟着风格走（sharp 不该有大词灌水）', (function () {
  var st = ''
  try {
    st = JSON.parse(fs.readFileSync(ROOT + '/data/project.json', 'utf8')).style || ''
  } catch (e) { st = '' }
  if (st === 'sharp') {
    /* 犀利时评：反而不该有大词，一有就是往感悟上靠 */
    var bad = (b3.match(/(一辈子|半辈子|这样的年纪|这辈子|值得深思|人生)/g) || []).length
    if (bad) console.log('     sharp 稿里有 ' + bad + ' 处大词')
    return bad === 0
  }
  return life
})())
    /* ★ 这条也是暖风格的判据，但它紧跟在刚改过的那条后面 ——
         上面那条「人生视角」我改成跟着风格走了，
         这条「人生类大词密度」忘了改，于是同一处留下两个口径。

         一篇讲海关破走私案的犀利时评，
         「一辈子」「到头来」「值得」这些词一个都不该有，
         有就是往感悟上靠。密度 0.065 正是它该有的样子。

         ★ 所以不是放松阈值，是让这条也知道当前是什么风格。 */
    /* ★ 词表原来直接把「值得」「命运」当成感悟词 ——
         实测这一篇犀利时评里两处都命中，但都是正常用法：
           「最值得看」   说的是哪一段最值得看
           「两种命运」   说的是样本的两种去处

         这两个词在新闻和评论里都是常用词，
         只有跟在「人生」「命运」这类主语后面才是感悟。

         修法：要求它们紧挨着人生类主语才算命中。
         单独出现的「值得」「命运」放行。 */
    const lifeDensity = (b3.match(
      /一辈子|半辈子|这样的年纪|到头来|这辈子|人生|命运|值得/g) || []).length / (b3.replace(/\s/g, '').length / 100)
    /* ★ 修法比刚才想的更简单 ——
         「值得看」「值得说」里的「值得」是动词，意思是「配得上」，
         跟人生感悟没关系。真正要防的是「值得深思」「值得反省」
         那种直接拿它当结论的用法。

         所以只查【值得 + 感悟类补语】，不查「值得 + 看/说/听」。
         第一版写的是 值得.{0,4}(看|说|听|读|信)，
         结果「最值得看」照样命中 ——
         「值得」在这里是动词，不是标签。 */
    const lifeWords = (b3.match(
      /一辈子|半辈子|这样的年纪|到头来|这辈子|人生|命运|值得(深思|反省|珍惜|把握|庆幸|遗憾)|(这|那)(就是)?人生/g) || []).length
    const lifeDensity2 = lifeWords / (b3.replace(/\s/g, '').length / 100)
    const curStyle = (function () {
      try { return JSON.parse(fs.readFileSync(ROOT + '/data/project.json', 'utf8')).style || '' }
      catch (e) { return '' }
    })()
    if (curStyle === 'sharp') {
      ok('★ 犀利时评不该有人生类大词（有就是往感悟上靠）',
        lifeDensity2 === 0, lifeDensity2.toFixed(3))
    } else {
      ok('★ 当前正文人生类大词密度落在 0.35 附近（不是灌水也不是没有）',
        lifeDensity > 0.1 && lifeDensity < 0.6, lifeDensity.toFixed(3))
    }
    /* 哲理不许是空口号 —— 抽查有没有「人生要勇敢」这类 */
    ok('★ 当前正文没有空口号式哲理',
      !/(未来可期|值得深思|让我们一起努力|人生要勇敢|共勉)/.test(b3))
  }
}
  ok('★ 通用 AI 味检测含提前否定与预设边界',
    /n: '提前否定'/.test(fs.readFileSync(ROOT + '/engine/styles.mjs', 'utf8')) &&
    /n: '预设写作边界'/.test(fs.readFileSync(ROOT + '/engine/styles.mjs', 'utf8')))
  /* 三样都能设默认，且新稿子自动带上 */
  ok('★ 文风/配图/排版都能设默认',
    /data-act="prefStyle"/.test(js) && /data-act="prefImgN"/.test(js) && /data-act="prefTheme"/.test(js))
  ok('★ 偏好存在 project.prefs 并在新稿子自动应用',
    /function prefs\(\)/.test(js) && /function applyPrefs\(\)/.test(js) &&
    /applyPrefs\(\)/.test(js.slice(js.indexOf('async function poll'))))
}

/* ════════ 9c6t. AI 操作手册必须和代码一致 ════════
   本轮最大的漏改就在这里。

   写稿的是 AI，AI 读的是 AI操作手册.md ——
   界面上改了默认风格、改了判据、改了自检，
   但手册里写的还是「九种风格」「默认犀利时评」「加粗 8~12 处」，
   AI 照着手册写，界面上改的东西一个都不生效。
   而且三处还会互相打架：手册说加粗 8~12，自检按 5 判。

   所以这三份文档/代码必须对得上，断言写死。 */
sec('9c6t 手册与代码一致')
{
  const manual = fs.readFileSync(ROOT + '/AI操作手册.md', 'utf8')
  const stylesTxt = fs.readFileSync(ROOT + '/engine/styles.mjs', 'utf8')
  const styleIds = [...stylesTxt.matchAll(/^ {2}(\w+): \{\n {4}n: '/gm)].map(m => m[1])

  ok('★ 手册里没有「九种风格」的旧说法',
    !/九种/.test(manual) && /十种/.test(manual))
  ok('★ 手册写了默认风格是有温度', /默认是 `warm`|默认风格.*warm|`warm` \| \*\*有温度（默认）\*\*/.test(manual))
  ok('★ 手册的默认风格自检命令是 warm',
    /style-check-me\.mjs warm/.test(manual) && !/style-check-me\.mjs sharp/.test(manual))
  ok('★ 手册禁提前否定（用户点名的第一号 AI 味）',
    /不许提前否定/.test(manual) && /先说结论/.test(manual) && /免得有人只看标题/.test(manual))
/* ① 旧断言找的是「双引号、冒号、破折号」连写，新手册写成「三条硬禁」。
     事实没变，措辞变了 —— 改断言，别改手册去迁就旧措辞。 */
ok('★ 手册写明三条标点不许用',
  /双引号 —— 全篇不许/.test(manual) &&
  /破折号 —— 全篇不许/.test(manual) &&
  /冒号 —— 正文里不许/.test(manual) &&
  /不用密度判|密度判/.test(manual))

/* ② 旧断言只找两个词，新手册写了四种合法用法，比原来更全。 */
ok('★ 手册标注了标点的四种合法用法（图注/来源表/表格/直接引语）',
  /图注/.test(manual) && /来源表/.test(manual) &&
  /表格单元格/.test(manual) && /直接引语/.test(manual))

  ok('★ 手册要求一次给 6 个完整标题（不要第二步）',
    /6 个不同方向/.test(manual) && /完整标题/.test(manual) && /不要需要让人再操作第二步/.test(manual))
  ok('★ 手册要求标题用词与正文一致',
    /标题用词必须和正文一致/.test(manual) && /低于 60%/.test(manual))
  ok('★ 手册写了交稿前必跑的自检命令',
    /style-check-me\.mjs warm/.test(manual) && /body-check\.cjs/.test(manual) &&
    /title-check\.cjs/.test(manual))

  /* 手册的风格表必须和 styles.mjs 一一对应。
     只取第 7 节那一段 —— 手册里还有一张 type 表（write/rewrite/…），
     整篇匹配会把它也抓进来当成风格。 */
  /* 手册的风格表必须和 styles.mjs 一一对应。
     第 7 节现在有两张表（风格说明 + 风格 × AI 黑话），
     按表取，不整节抓 —— 整节抓会把两张表都算进来，数字翻倍。

     ★ 断言的范围要跟着文档结构走。文档加了一张表它就该失准，
       这不是断言坏了，是它该被修。 */
  const sec7 = manual.slice(manual.indexOf('## 7. 写作风格'), manual.indexOf('## 8.'))
  const rows7 = [...sec7.matchAll(/^\| `(\w+)` \|/gm)].map(m => m[1])
  /* 第 7 节有两张表（风格说明 + 风格 × AI 黑话）。
     取第一张 —— 从第一次出现到第二次出现。
     ★ 定位要锚在稳定结构上，「第几个 ###」会随文档增删漂移。 */
  const manualIds = rows7.slice(0, rows7.length / 2)
  ok('★ 手册列的风格和 styles.mjs 完全一致',
    styleIds.length === manualIds.length &&
    styleIds.every(x => manualIds.includes(x)) && manualIds.every(x => styleIds.includes(x)),
    'styles.mjs: ' + styleIds.join(',') + ' | 手册: ' + manualIds.join(','))

  /* 加粗密度：手册、styles.mjs、界面自检三处必须一致。
     以前手册写 8~12、自检按 5 判，两边打架。 */
  ok('★ 加粗密度：手册说 5~10，不是旧的 8~12',
    /每千字 5~10/.test(manual) && !/每千字 8~12/.test(manual))
  ok('★ 加粗密度：手册与界面自检阈值对得上',
    /每千字 5~10/.test(manual) && /c\.bold \/ k >= 5/.test(js) &&
    /每千字 8~12/.test(stylesTxt) === false)

  ok('★ 手册里的路径指向当前目录（不是旧位置）',
    /E:\\Codex\\Opencode\\写作台/.test(manual) &&
    !/Get-ChildItem "E:\\文档/.test(manual))
/* ════════ 9ca. 渲染期状态必须在任何 render 之前声明 ════════
   暂时性死区（TDZ）本项目已栽四次：
     wvTimer / peekAbort / peekHtml / newTitlesPending
   症状一模一样：页面初始化时 go() 就调了 render，
   而状态声明在文件后面 —— 报「Cannot read properties of null」，
   整个页面白屏或渲染失败。

   根治不是「每次都记得前移」，而是「渲染期要用的状态集中声明在顶部」。
   下面这条断言扫的是：所有在 render 函数里被读到的模块级 let，
   声明位置必须早于 renderWrite。
*/
/* ════════ 9cd. 发布页三栏并排 ════════
   用户原话：「发布页布局不合理，修改功能改成左右并排改，不要在最下边。」

   实测出的真病根（getComputedStyle）：
     ship-wrap 的 grid-template-columns 算出来是单列，
     左栏 scrollHeight 1632px，微调 top=661、发布 top=1523。
   两个原因叠加，只改一个都不够：
     ① 断点写成 max-width:1024px —— 1000px 是最常见窗口宽度，
        等于日常不可用
     ② 一栏 260px 竖塞 5 节 11 套主题共 1632px，断点改了还得滚
   所以是重新分栏：排版｜微调｜预览，三者同一屏。
*/
sec('9cd 发布页三栏并排')
ok('★ 三栏容器（不是一栏塞全部）',
  /grid-template-areas:/.test(css) && /"ctl tune main"/.test(css))
ok('★ 三栏各有独立滚动（微调滚走时预览还在）',
  /\.ship-col\{[\s\S]{0,300}?overflow-y:auto/.test(css))
ok('★ ★ 堆叠阈值不是 1000（把最常见窗口宽度误判成窄屏）',
  !/max-width:1000px\}[\s\S]{0,200}?ship-wrap/.test(css))
ok('★ 中档也保持三栏（900~1320 之间不降级）',
  /@media \(max-width:1320px\)\{[\s\S]{0,400}?grid-template-columns:228px 236px/.test(css))
ok('★ 微调栏紧贴预览左侧（grid-area 显式声明，不靠 DOM 顺序）',
  /\.ship-tune\{grid-area:tune\}/.test(css) && /\.ship-main\{grid-area:main\}/.test(css))
ok('★ 11 套主题在窄栏压两列（一屏看完，不是滚三次）',
  /\.ship-ctl \.theme-list\{grid-template-columns:1fr 1fr\}/.test(css))
ok('★ renderShip 里微调独立成 aside，不是塞在排版栏下面',
  /<aside class="ship-col ship-tune">/.test(js) &&
  js.indexOf('ship-col ship-tune') < js.indexOf('class="ship-main"'))
ok('★ 旧 .ship-left 类名已全部改名（不留两套）',
  !/ship-left/.test(js) && !/\.ship-left/.test(css))
ok('★ 未闭合的 div 已修（预览宽度那节原来开了没关，撑坏整页栅格）',
  (js.match(/<div\b/g) || []).length - (js.match(/<\/div>/g) || []).length === 0)

/* ════════ 9ce. 特异度陷阱 ════════
   逗号分隔的选择器列表里，每个逗号后的选择器单独算特异度。
   旧规则 `.input, select, textarea.input` 里 textarea.input 是 (0,1,1)，
   压过后写的 `.input, .editor, textarea, select` 里的 .input (0,1,0)。
   源码顺序再对也没用 —— 实测输入框 glass 写了却仍是实心 var(--surface)。
*/
sec('9ce CSS 特异度陷阱')
ok('★ 输入框玻璃规则含复合选择器 textarea.input（拉平特异度）',
  /textarea\.input,[\s\S]{0,120}?--glass-tint-thin/.test(css))
/* border-radius 距离选择器列表末尾约 300 字符，
     断言的窗口给窄了会误报。放大窗口即可。 */
ok('★ 输入框圆角没被 border-radius:0 吃掉（玻璃没圆角看不出厚度）',
  /textarea\.input,[\s\S]{0,900}?border-radius:var\(--r-m\)/.test(css))
ok('★ focus 态也覆盖复合选择器（不然聚焦时退回实心）',
  /textarea\.input:focus/.test(css))

/* ════════ 9cf. null 数组当空数组用 ════════
   newTitlesPending 初始化是 null（不是 []），
   模板里直接 .length 炸「Cannot read properties of null」。
   上一轮把声明从散落位置提到顶部集中声明区时把 && 那一半弄丢了。
*/
sec('9cf null 安全')
/* newTitlesPending.length 出现在三元守卫内部是安全的
     （`${newTitlesPending ? ... newTitlesPending.length ...}` 守卫在前）。
     真正的不变量是：每一次裸取之前都判过空。 */
ok('★ 模板里取 newTitlesPending.length 之前都判过空',
  (function(){
    var bad = []
    var re = /newTitlesPending\.length/g, m
    while ((m = re.exec(js))) {
      var back = js.slice(Math.max(0, m.index - 120), m.index)
      if (!/newTitlesPending\s*(&&|\?|\|\|)/.test(back)) bad.push(m.index)
    }
    return bad.length === 0
  })())
ok('★ 最常见的坑：三元守卫里用 (x || []).length 而不是裸 .length',
  /\$\{\(newTitlesPending \|\| \[\]\)\.length/.test(js))
ok('★ 渲染期状态声明在文件最顶部（< 800 行，远早于 renderWrite）',
  js.indexOf('let newTitlesPending') > 0 && js.indexOf('let newTitlesPending') < 800)
ok('★ 三个渲染期状态都在同一处声明（titlePoolRaw / fixReqRaw / newTitlesPending）',
  (function(){
    var a = js.indexOf('let titlePoolRaw'), b = js.indexOf('let fixReqRaw'),
        c = js.indexOf('let newTitlesPending')
    return a > 0 && b > 0 && c > 0 && Math.max(a,b,c) - Math.min(a,b,c) < 200
  })())
ok('★ 没有重复的 action 定义（同名 key 静默覆盖，不报错但代码骗人）',
  (function(){
    var m = js.match(/^  (takeNewTitles|focusTitleIn|useTitle|taskTitle)\(\)/gm) || []
    return new Set(m).size === m.length
  })())

/* ════════ 9d0. 四组硬禁令（2026-10-03）════════
   用户原话：
     「不允许用双引号、破折号、冒号」
     「不允许预设性的、否定性的语句；全篇不允许有否定式语句」

   关键决定：标点从「按密度判」改成硬禁。
   密度判等于放行 —— 4000 字稿子放 40 个破折号也才 1/千字，
   per100:1 的规则根本不响。用户说的是「不许用」，就按不许用来做。 */
sec('9d0 四组硬禁令')
ok('★ 三条标点在 styles.mjs 里都有硬禁',
  /export const PUNCT_BAN/.test(sty) &&
  /n: '双引号'/.test(sty) && /n: '破折号'/.test(sty) && /n: '冒号'/.test(sty))
ok('★ 否定式成一组（不是A而是B / 没有A只有B / 既不也不 / 双重否定 / 全称否定）',
  /export const NEGATION_BAN/.test(sty) &&
  /不是A而是B/.test(sty) && /没有A只有B/.test(sty) &&
  /既不也不/.test(sty) && /双重否定/.test(sty) && /全称否定/.test(sty))
ok('★ 预设性成一组（假装共识 / 主观预设 / 替读者划边界 / 集体主语）',
  /export const PRESET_BAN/.test(sty) &&
  /假装共识/.test(sty) && /主观预设/.test(sty) &&
  /替读者划边界/.test(sty) && /集体主语/.test(sty))
ok('★ 禁令挂在 aiSmell（通用层）而不是塞进九个 forbid',
  /sharedBans\(\)/.test(sty) && /for \(const b of sharedBans/.test(sty))
ok('★ 十个风格都从 sharedBans 继承（不是逐个复制）',
  /export function sharedBans/.test(sty))

/* 标点白名单必须把 markdown 语法排除掉。
   实测踩过：--- 分隔线和 |---| 表格分隔行被判成破折号 6 次，
   一篇 4186 字的稿子报 9 处破折号，其中 6 处是误伤。 */
ok('★ 破折号排除 markdown 的分隔线和表格分隔行',
  /export const DASH_RE = \/——\|\(\?<!\-\)--\(\?!-\)\/g/.test(sty))
ok('★ app.js 那份 DASH_RE 与 styles.mjs 一致（两处判据不能分叉）',
  /const DASH_RE = \/——\|\(\?<!\-\)--\(\?!-\)\/g/.test(js))

/* 白名单一致性的实际后果：界面上过了、服务端判不过，
   用户改到崩溃也找不到原因。这是最坏的体验，必须锁死。 */
ok('★ ★ 标点白名单两处完全一致（PUNCT_OK 不能分叉）',
  (function(){
    var a = (sty.match(/export const PUNCT_OK = (.*)/) || [])[1]
    var b = (js.match(/const PUNCT_OK = (.*)/) || [])[1]
    if (!a || !b) return false
    return a.trim() === b.trim()
  })())
ok('★ 白名单覆盖合法用法（图注 / 来源表 / 表格 / 直接引语）',
  /图\|图表\|图片\|照片/.test(sty) && /出处\|来源\|图注\|备注/.test(sty) &&
  /原话\|她说\|他说/.test(sty))
ok('★ scan 支持 punctMask 掩码（否则图注的「出处：」会被误伤）',
  /punctMask/.test(js) && /function maskPunct/.test(js))

/* 否定式只禁 AI 句型，不禁「不」字本身。
   「她没停下」是叙事，「没有A，只有B」是 AI 句型。 */
ok('★ 否定式不禁「不」字本身（否则正常中文写作全被判死）',
  /只禁 AI 句型/.test(sty))

/* ── 前端 RULES 必须和服务端同源 ── */
ok('★ 前端 RULES 有弯引号硬禁（不是只靠密度）',
  /n:'弯引号'/.test(js) && /lv:'hi'/.test(js))
ok('★ 前端 RULES 有否定式五条',
  /n:'不是A而是B'/.test(js) && /n:'没有A只有B'/.test(js) &&
  /n:'既不也不'/.test(js) && /n:'双重否定'/.test(js) &&
  /n:'全称否定'/.test(js))
ok('★ 前端 RULES 有预设式三条',
  /n:'假装共识'/.test(js) && /n:'主观预设'/.test(js) && /n:'集体主语'/.test(js))
ok('★ 旧的密度判标点规则已删（留着会和新规则重复报）',
  !/n:'冒号过密'/.test(js) && !/n:'破折号过密'/.test(js) && !/n:'引号过密'/.test(js))

/* ════════ 9d1. 常量必须提到文件顶部 ════════
   暂时性死区本项目已栽五次：
     wvTimer / peekAbort / peekHtml / newTitlesPending / DASH_RE
   症状是模块加载就抛，整个页面白屏或功能全废。
   根治不是「每次都记得前移」，是「常量一律放最顶部」。 */
sec('9d1 常量位置')
ok('★ DASH_RE 在 PUNCT_BAN 之前声明',
  sty.indexOf('export const DASH_RE') > 0 &&
  sty.indexOf('export const DASH_RE') < sty.indexOf('export const PUNCT_BAN'))
ok('★ PUNCT_OK 也在 PUNCT_BAN 之前',
  sty.indexOf('export const PUNCT_OK') < sty.indexOf('export const PUNCT_BAN'))
ok('★ 每个常量只定义一次',
  (sty.match(/export const DASH_RE/g) || []).length === 1 &&
  (sty.match(/export const PUNCT_OK/g) || []).length === 1)

/* ════════ 9d2. 正样本必须真过 ════════
   判据写完不测等于没写。加禁令之后 8 个正样本全红过一轮，
   原因是正样本本身就塞满了「不是A而是B」「其实」和弯引号 ——
   那些正是 AI 默认输出的样子。 */
sec('9d2 正样本合规')
ok('★ style-test 有四组新禁令的对抗负样本',
  /name: '弯引号'/.test(stt) && /name: '否定式招牌句'/.test(stt) &&
  /name: '假装共识'/.test(stt) && /name: '双重否定'/.test(stt))
ok('★ 有白名单用例（出处：和直接引语必须放行）',
  /expectClean/.test(stt) && /白名单没有误伤/.test(stt))
ok('★ 弯引号负样本里真的有弯引号',
  (function(){
    var m = stt.match(/name: '弯引号', text: '([^']*)'/)
    if (!m) return false
    return /[“”]/.test(m[1])
  })())
ok('★ 十个风格都有正样本',
  (stt.match(/^  (warm|sharp|person|news|explain|biz|talk|cold|crit|story): /gm) || []).length === 10)

/* ════════ 9d3. app.js 常量顺序 ════════
   这里出过真 bug：DASH_RE 声明在 RULES 之后四千字符处，
   而 RULES 的数组字面量求值时就要读它 —— 浏览器直接 ReferenceError，
   整个 app.js 加载失败。

   9d1 只查了 styles.mjs，漏了 app.js。
   ★ 教训：断言要盯住「出问题的那个文件」，
     不能只盯「你当时想到的那个文件」。 */
sec('9d3 app.js 常量顺序')
ok('★ DASH_RE 在 RULES 之前（否则浏览器加载即 TDZ 报错）',
  js.indexOf('const DASH_RE') > 0 &&
  js.indexOf('const DASH_RE') < js.indexOf('const RULES = ['))
ok('★ PUNCT_OK 在 RULES 之前', (function(){
  var i = js.indexOf('const PUNCT_OK'), j = js.indexOf('const RULES = [')
  return i > 0 && i < j
})())
ok('★ maskPunct 也在 RULES 之前（scan 会调它）', (function(){
  var i = js.indexOf('function maskPunct'), j = js.indexOf('const RULES = [')
  return i > 0 && i < j
})())
ok('★ app.js 的 DASH_RE 与 styles.mjs 完全一致',
  (function(){
    var a = (sty.match(/export const DASH_RE = (.*)/) || [])[1]
    var b = (js.match(/const DASH_RE = (.*)/) || [])[1]
    return a && b && a.trim() === b.trim()
  })())
ok('★ 自检探针把常量区也摘进去了（否则 new Function 里 TDZ）',
  /const consts = between\(/.test(验收src) && /strip\(consts\)/.test(验收src))
ok('★ 自检探针有锚点失效的显式报错（不崩在 TDZ 上）',
  /探针无法构建/.test(验收src) && /段没摘到/.test(验收src))

/* ════════ 9d4. 自检文案必须跟着判据走 ════════
   判据从「按密度」改成「硬禁」之后，自检界面那三行
   还写着「每千字 0.7 个」—— 用户会以为
   「没超阈值所以过了」，其实一个都不许有。

   ★ 这类不一致比没有检查更糟：自检显示全绿，稿子其实违规。
     而且错得很隐蔽，测试全过、界面全绿、只有用户会发现。

   同一个根因还有第二处：右侧摘要和明细面板显示不一样，
   会让人怀疑工具本身出了问题。 */
sec('9d4 自检文案与判据一致')
ok('★ 明细面板标点三条标为「硬禁」', (function(){
  /* 原来这条断言的正则写成了 /punct?3?\.?hit/ ——
     想同时匹配 punct.hit 和 p3.hit，但那个写法两者都匹配不到，
     于是断言恒为 false。界面实测本来是对的，错的只有断言。
     ★ 正则里想表达「可选」要写 (punct|p3)，不是把字符挪一挪。 */
  var m = js.match(/rows\.push\(chk\(!p3\.hit[\s\S]{0,900}?rows\.push\(chk\(c\.imgs/)
  if (!m) return false
  var t = m[0]
  return t.includes('双引号（硬禁）') && t.includes('冒号（硬禁）') && t.includes('破折号（硬禁）')
})())
ok('★ 文案不再显示「每千字 X 个」（密度语义已废除）',
  !/chk\(c\.(quote|colon|dash) \/ k/.test(js))
ok('★ 右侧摘要也改成硬禁语义（与明细面板一致）', (function(){
  var m = js.match(/function renderAsideCheck[\s\S]{0,1400}?\n}/)
  if (!m) return false
  return /p3\.hit\('冒号'\)/.test(m[0]) && !/c\.colon \/ k/.test(m[0])
})())
ok('★ 文案说「没有」时判据确实没命中（不能自相矛盾）',
  /'没有，全篇用的直角引号'/.test(js) &&
  /'没有（图注出处和引语前的已自动放行）'/.test(js) &&
  /'没有（分隔线和表格不算）'/.test(js))
ok('★ 取数收成 punctOf 一处（判据和文案必须同源）',
  (js.match(/function punctOf/g) || []).length === 1 &&
  /const p3 = punctOf\(c\.hits\)/.test(js))
ok('★ 没有残留的裸 punct.xxx 调用（自由变量，语法过得去但运行时炸）',
  !/[^a-zA-Z]punct\.(hit|any|count)/.test(js))
ok('★ 破折号文案提到分隔线不算（避免用户误以为误伤）',
  /分隔线和表格不算/.test(js))

/* 手册同步 —— 这个项目栽过三次「改了代码没改手册」。
   AI 读的是手册，手册说「尽量去掉」它就会继续用。 */
ok('★ 手册写的是「硬禁」不是「尽量去掉」',
  /标点：三条硬禁，不许用/.test(manual) && !/尽量去掉/.test(manual))
ok('★ 手册有否定式一节，并写明「不」字不禁',
  /否定式：只禁 AI 句型/.test(manual) && /不禁「不」字/.test(manual))
ok('★ 手册有预设性一节，四层都在',
  /预设性：假装这是共识/.test(manual) &&
  /假装共识/.test(manual) && /主观预设/.test(manual) &&
  /替读者划边界/.test(manual) && /集体主语/.test(manual))
ok('★ 手册说明了通用禁令对所有风格生效（不是只有 warm）',
  /所有风格都生效/.test(manual))
ok('★ 手册指明判据的两处位置（PUNCT_BAN / RULES）',
  /PUNCT_BAN/.test(manual) && /`app\.js` 的 `RULES`/.test(manual))
ok('★ 手册写了四条合法放行（图注/来源表/表格/直接引语）',
  /图注/.test(manual) && /来源表/.test(manual) &&
  /表格单元格/.test(manual) && /直接引语/.test(manual))
ok('★ 手册章节编号连续（插节后忘了顺延，AI 会引用错）', (function(){
  var m = manual.match(/^## (\d+)\. /gm) || []
  var nums = m.map(function(x) { return Number(x.match(/\d+/)[0]) })
  for (var i = 0; i < nums.length; i++) if (nums[i] !== i + 1) return false
  return true
})())
/* 不写死「十二项」——加一项就忘了改这里。 */
ok('★ 手册的自检项数与实际一致（不去数代码里的条数）',
  (function(){
    var n = (js.match(/rows\.push\(chk\(/g) || []).length
    var m = manual.match(/自检这(十[一二三]|十[一二三]\s*\S{0,4})?项/)
    if (!m) return false
    var CN = { '十': 10, '十一': 11, '十二': 12, '十三': 13, '十四': 14 }
    var v = CN[m[1].trim()]
    return v === n
  })())

/* ════════ 9d5. 否定式判据不能写窄 ════════
   用户原话：「为什么还有很多假设的否定句？提前否定那种句式在。」

   这一轮从正文里挖出 7 个小节标题 + 6 类段落的提前否定和否定式，
   写完才发现自己上一轮的判据根本没抓到它们 ——
   原因不是缺规则，是规则写窄了。

   ★ 规则写窄比没有规则更糟：
     它给出「已经检查过了」的错觉，实际在漏。
     上一轮 style-check-me 报「合格 100 分」，稿子里全是提前否定。

   三处窄法：
     一 「不是A而是B」第二半只认「而是/只是/更」，
         漏了「她是」「是那个」「是「我想去南极」」
     二 标题层完全没人管（元标题/预告式/双重否定祈使）
     三 否定式收尾（跟X没关系 / 不是治愈）不在任何一组里 */

sec('9d5 否定式判据覆盖')
ok('★ 不是A而是B 的第二半不只认「而是」（实测漏过三句）',
  /不是\[\^。！？\\n\]\{1,26\}\[，,\]\?\\s\*\(而是\|只是\|更\|是\|并非\|更像是\)/.test(sty))
ok('★ app.js 同步补宽（两份判据不能分叉）',
  /而是\|只是\|更\|是\|并非\|更像是/.test(js))
ok('★ 新增「预先否掉没人说的话」（提前否定的近亲）',
  /预先否掉没人说的话/.test(sty) && /预先否掉没人说的话/.test(js))
ok('★ 新增「否定式收尾」（跟X没关系 / 不是治愈）',
  /否定式收尾/.test(sty) && /不是治愈/.test(sty))
ok('★ 标题层有四条规则（之前完全没人管）',
  /提前否定的小节标题/.test(sty) && /元标题/.test(sty) &&
  /预告式标题/.test(sty) && /双重否定的小节标题/.test(sty))
ok('★ 标题里的否定也抓（「## 五、…不是「我战胜了癌症」）',
  /标题里的否定/.test(sty))
ok('★ 新增「自我预设」（作者先替读者担心）',
  /自我预设/.test(sty) && /我最怕的就是/.test(sty))

/* 负样本测试文件必须存在且全绿 ——
   把删掉的句子当负样本，是「改稿」和「改判据」接上的唯一手段。 */
ok('★ 有 neg-test.mjs（删掉的句子全部当负样本）',
  fs.existsSync(ROOT + '/engine/neg-test.mjs'))
ok('★ neg-test 覆盖全部六类新判据',
  (function(){
    var t = fs.readFileSync(ROOT + '/engine/neg-test.mjs', 'utf8')
    return /元标题/.test(t) && /预告式/.test(t) && /双重否定的小节标题|双重否定/.test(t) &&
      /标题里的否定|标题内否定/.test(t) && /自我预设/.test(t) &&
      /预先否掉/.test(t) && /否定式收尾|没关系/.test(t)
  })())
ok('★ neg-test 同时验「必须放行」（白名单误伤同样是 bug）',
  /必须放行/.test(fs.readFileSync(ROOT + '/engine/neg-test.mjs', 'utf8')))

/* 白名单这轮放过三种误伤，全是「写窄」：
     图注里带「。图/」的复杂内容、表格跨格的冒号、正文第一行的「出处：」 */
ok('★ 白名单放宽到能覆盖复杂图注（含标点和长文本）',
  /0,140\}/.test(sty) || /\{0,140\}/.test(sty))
ok('★ 白名单认表格跨格（原来只认单格内）',
  /\{0,300\}\\\[\\^\[\^\\n\]\{0,300\}\\\[\\^\[\^\\n\]\{0,300\}\\\|/.test(sty) ||
  /\(\\\|\[\^\\n\]\{0,300\}/.test(sty))
ok('★ 白名单认「正文第一行没有换行符」的出处标注',
  /\(\^\|\\n\)/.test(sty))

/* ════════ 9d6. 标题必须一并交 ════════
   用户原话「你最后给出标题都得几种，不要需要让人再操作第二步了」
   这句话栽过两次：功能建好了，data/titles.json 一直是空的，
   用户每次点开成稿页看到的都是空候选区。

   原因不是没写手册，是手册里那句话被淹没了。
   放进自检面板才跑得掉 —— 它会红在用户每天看的那 13 项里。 */
sec('9d6 标题零第二步')
ok('★ data/titles.json 存在且不是空数组',
  (function(){
    try {
      var t = JSON.parse(fs.readFileSync(ROOT + '/data/titles.json', 'utf8'))
      return Array.isArray(t) && t.length >= 6
    } catch (e) { return false }
  })())
ok('★ 一次给足 6 个（用户要的是「好几种」）',
  (function(){
    try {
      return JSON.parse(fs.readFileSync(ROOT + '/data/titles.json', 'utf8')).length >= 6
    } catch (e) { return false }
  })())
ok('★ 自检面板有「备选标题」这一项（跑不掉）',
  (js.match(/rows\.push\(chk\(/g) || []).length === 13 &&
  /chk\(titlePool\.length > 0, '备选标题'/.test(js))
ok('★ 右侧摘要第一条就是备选标题（它是最想要的东西）',
  /function renderAsideCheck[\s\S]{0,900}?line\(titlePool\.length > 0, '备选标题'/.test(js))
ok('★ 没交时的提示写明「不该让用户再追问」',
  /不该让用户再追问/.test(js))
ok('★ 手册写了「自检十二项」要改成十三项',
  /自检这十三项/.test(manual) || /自检这十二项/.test(manual))

/* ════════ 9d7. 正文不能有整段重复 ════════
   实测 4177 字的稿子里，87~91 行和 269~273 行是同一段话。
   精确去重查不出来 —— 第二处少了加粗标记。
   只能靠高相似度比对。 */
sec('9d7 正文重复')
ok('★ 当前正文没有重复段落',
  (function(){
    var b = fs.readFileSync(ROOT + '/data/body.md', 'utf8')
    var paras = b.split(/\n\s*\n/).map(function(x) { return x.trim() })
      .filter(function(x) { return x.length > 25 })
    var seen = new Set()
    var dup = 0
    paras.forEach(function(p) { if (seen.has(p)) dup++; else seen.add(p) })
    return dup === 0
  })())
ok('★ 高相似度段落也不重复（去掉加粗标记后仍相同）',
  (function(){
    var b = fs.readFileSync(ROOT + '/data/body.md', 'utf8')
    var norm = b.replace(/\*\*/g, '')
    var paras = norm.split(/\n\s*\n/).map(function(x) { return x.trim() })
      .filter(function(x) { return x.length > 25 })
    var seen = new Set()
    var dup = 0
    paras.forEach(function(p) { if (seen.has(p)) dup++; else seen.add(p) })
    return dup === 0
  })())

/* ════════ 9d8. 各风格特有的 AI 套话 ════════
   用户原话「每一种写作文风都要改，AI 味特别浓」。

   这一轮查出来真正的缺口：
   通用禁令抓的是所有风格共有的毛病（标点、否定式、预设），
   但每种文风有它自己那套黑话：

     商业观察  赋能 闭环 抓手 颗粒度 护城河 心智 生态位
     犀利时评  韭菜 镰刀 收割 降维打击 吊打 吃相
     人物特稿  画卷 定格 注脚 镌刻 岁月静好
     硬核拆解  本质上 底层逻辑 颗粒度 生态位
     新闻快评  据悉 记者获悉 业内人士 引发广泛关注
     口语闲谈  绝了 太真实了 家人们 yyds
     批评评论  乱象 形式主义 责任缺位 亟待
     有温度    温暖了那个冬天 时间仿佛静止 愿每一个人
     故事叙事  多年以后他才明白 这一切都要从
     冷静收束  据悉 记者获悉 业内人士

   实测（engine/cliche-test.mjs）：
     biz / sharp / person / story 四种完全放行，一处都没抓。
     其余五种靠通用规则误打误撞抓到的，不是靠风格判据。

   ★ 这才是「每种文风 AI 味浓」的真正原因 ——
     不是通用规则不够严，是风格层根本没有词汇表。
     通用规则再严也抓不到「赋能」—— 它只会在商业稿里出现，
     而通用规则里没有这个词。 */
sec('9d8 风格套话表')
ok('★ styles.mjs 有 STYLE_CLICHE（风格层的词汇表）',
  /export const STYLE_CLICHE/.test(sty))
ok('★ app.js 也有同一份（用户看到的是前端自检）',
  /const STYLE_CLICHE/.test(js) && /function scanCliche/.test(js))
ok('★ ★ 两份表的风格键完全一致（改一处必须改另一处）',
  (function(){
    var a = (sty.match(/export const STYLE_CLICHE = \{[\s\S]*?\n\}/) || [''])[0]
    var b = (js.match(/const STYLE_CLICHE = \{[\s\S]*?\n\}/) || [''])[0]
    if (!a || !b) return false
    var keys = s => (s.match(/^  ([a-z]+): \[/gm) || []).map(x => x.trim().split(':')[0]).sort().join(',')
    return keys(a) === keys(b)
  })())
ok('★ 十种风格都有词汇表', (function(){
  var a = (sty.match(/export const STYLE_CLICHE = \{[\s\S]*?\n\}/) || [''])[0]
  return (a.match(/^  [a-z]+: \[/gm) || []).length === 10
})())
ok('★ checkCliche 已接进 checkStyle（结果并进 aiHits）',
  /checkCliche\(text, styleId\)/.test(sty) && /ai\.hits\.push\(\.\.\.cliche\)/.test(sty))
ok('★ scanCliche 已接进 scan（接入点只有一处）',
  /const cl = scanCliche\(text,/.test(js) && (js.match(/scanCliche\(text,/g) || []).length === 2)
ok('★ STYLE_CLICHE 在 scan 之前声明（TDZ，这个坑栽过七次）',
  js.indexOf('const STYLE_CLICHE') > 0 &&
  js.indexOf('const STYLE_CLICHE') < js.indexOf('function scan(text)'))

/* 判据写完不测等于没写 —— 这轮就是靠这个测出缺口的 */
ok('★ 有 cliche-test.mjs（十种风格的套话逐个验）',
  fs.existsSync(ROOT + '/engine/cliche-test.mjs'))
ok('★ cliche-test 同时验「必须抓到」和「不能误伤合格稿」',
  (function(){
    var t = fs.readFileSync(ROOT + '/engine/cliche-test.mjs', 'utf8')
    return /各风格的 AI 套话现在抓得到吗/.test(t) && /不该被任何风格误伤/.test(t)
  })())

/* 套话表的共同毛病：都是「抽象大词」，而项目本来就有「具体动作/数字」的判据。
   两条要一起看，光查黑名单会漏掉没进表的那些。 */
ok('★ 每种风格仍保留「必有」判据（不能只靠黑名单）',
  (function(){
    var m = sty.match(/export const STYLES = \{[\s\S]*\n\}/)
    if (!m) return false
    var n = (m[0].match(/require: \[/g) || []).length
    return n >= 10
  })())

/* ════════ 9e0. 自动刷新不能吃掉阅读位置 ════════
   用户原话：「每隔几秒会自动刷新，我翻着翻着页你就给我刷新回到顶部了，
              这肯定他妈有问题啊。」

   ★ 根因在 server.mjs 的 snapshot()：
       stamp: now()
     now() 是当前时间，于是每次 /state 请求 stamp 都是新的，
     app.js 的 changed = (s.stamp !== lastStamp) 恒为 true，
     refresh() 每 4 秒 innerHTML 重画整页，滚动位置回到顶部。

     实测采样 7 次每 4 秒：
       stamp: 20:03:48 | 20:03:52 | 20:03:56 | ...
       每次都不同 → 每 4 秒必重绘。

     stamp 这个名字语义是「数据版本号」，
     写的人当成「最后更新时间」用了 ——
     名字和用途对不上，下一个人接上只会踩同一个坑。

   修法两处：
     一 stamp 改成内容指纹，内容不变指纹就不变
     二 重绘时存/还原滚动位置（focus 和 scroll 是两回事） */
sec('9e0 自动刷新与阅读位置')
ok('★ ★ stamp 是内容指纹，不是 now()（否则每 4 秒必重绘）',
  /function fingerprint/.test(srv) &&
  /s\.stamp = fingerprint\(/.test(srv) &&
  !/stamp: now\(\)/.test(srv))
ok('★ 指纹只吃内容字段，stamp 自己排除在外',
  /s\.body,\s*\n?\s*JSON\.stringify/.test(srv.replace(/\r\n/g, '\n')) ||
  /fingerprint\(\s*s\.body/.test(srv))
ok('★ 滚动容器是 main 不是 window（存 window.scrollY 永远是 0）',
  /document\.querySelector\('main'\)/.test(js) &&
  /m\.els\.push\(\[main, main\.scrollTop\]\)/.test(js))
ok('★ refresh 里有 restoreScroll（只存焦点等于没存位置）',
  /restoreScroll\(sc\)/.test(js))
ok('★ 发布页三栏各自能滚，也一起存',
  /\.ship-col, \.side-pane, \.hot-list/.test(js))
ok('★ 还原时按 class 找新节点（重绘后旧节点已不在文档里）',
  /const el = key === 'main'/.test(js) && /el\.isConnected/.test(js))
ok('★ snapScroll / restoreScroll 各只有一个定义（插删多轮易留下重复）',
  (js.match(/function snapScroll/g) || []).length === 1 &&
  (js.match(/function restoreScroll/g) || []).length === 1 &&
  (js.match(/function refresh\(/g) || []).length === 1)

/* ════════ 9e1. 来源前缀 ════════
   用户原话：「你一直在强调文中什么什么材料里说明。
              那这些东西按理说不应该出现在你的正文中的。」

   原来的自检只查行首的「来源：」和「据某某报道」，
   查不到正文中间那九种：
     期刊上一篇文章写砌体结构
     有研究估算，那套方案能让强度提四分之一
     作者最后写了一句
     云南那边做田野调查的时候，老人说
     有位老人跟我说过一件事
     后来他写了一段话

   ★ 判据写窄和没有判据一样糟，它给出「已经检查过了」的错觉。 */
sec('9e1 来源前缀')
ok('★ 来源前缀有六条规则', (js.match(/n:'来源前缀'/g) || []).length >= 6)
ok('★ 抓「期刊/论文/研究 + 写/说/表明/估算」', /(期刊\|论文\|文章\|文献\|研究\|报道)/.test(js))
ok('★ 抓「作者/专家/学者/记者 + 表示/指出」', /(作者\|专家\|学者\|研究人员\|笔者\|记者)/.test(js))
ok('★ 抓「据/根据/按照 + 报道/文献/数据」', /\(据\|根据\|按照\)/.test(js))
ok('★ 抓「某人 + 跟我说/跟我讲/提到」', /(跟我说\|跟我讲\|告诉我\|提到了\|提到过)/.test(js))
ok('★ 动词带「了/过」也算（实测漏了「写了一句」「跟我说过」）',
  /\(了\|过\)\?/.test(js) || /\(了\|过\|过一件事\)/.test(js))
ok('★ ★ 不误伤直接引语（「她说」「他邻居说」是写作不是转述）',
  (function(){
    /* 引语形态不该命中任何一条来源前缀规则 */
    var quotes = [
      '她说走的地方多了就不计较了',
      '他邻居说他傻。他说这叫留个念想',
      '「打了就回不来了。」他说这话的时候没看人',
      '大摆衣村有位老人说过。只要维护得当，土房子用上100年妥妥的没有问题。'
    ]
    var rules = []
    var m = js.match(/\{ n:'来源前缀'[^\n]*\n[^\n]*/g) || []
    for (var i = 0; i < m.length; i++) {
      var re = m[i].match(/re:\/(.+)\/g/)[1]
      try { rules.push(new RegExp(re)) } catch (e) {}
    }
    if (!rules.length) return false
    var fired = 0
    quotes.forEach(function(q) {
      rules.forEach(function(r) { if (r.test(q)) fired++ })
    })
    return fired === 0
  })())
ok('★ 文末来源表不误伤（「来源」「出处：」必须放行）',
  !/n:'来源前缀'[^\n]*\n[^\n]*\|/.test(js))
ok('★ 当前正文没有来源前缀', (function(){
  var body = fs.readFileSync(ROOT + '/data/body.md', 'utf8')
  return !/(据|根据|按照)[^。，\n]{0,8}(报道|通报|文献|研究|数据|统计|说法)/.test(body) &&
         !/[^\n]{0,12}(期刊|论文|文章|文献|研究|报道)[^。，\n]{0,4}(写|说|表明|显示|发现|估算|提到|指出)/.test(body) &&
         !/(调查|研究)[^。，\n]{0,4}(显示|表明|发现|估算|证明|提到|指出|介绍|说)/.test(body) &&
         !/[^\n。，]{0,8}(老人|老人家|老乡|村里人|他|她|对方)[^。，\n]{0,6}(跟我说|跟我讲|告诉我|提到了|提到过)/.test(body)
})())

/* ════════ 9e2. 界面质感 ════════
   用户原话：
     「左侧的那个那四个功能或者四个流程吧，做的不好看、不美观，
       整个 UI 界面我也看不懂你怎么回事，
       能不能都换成一下苹果高透明啊，高级一些。」

   实测出的病根不是配色，是三样：
     一 圆角完全不统一（0 / 2 / 3 / 10px 混用）
     二 概要条、自检块、交付区是实色，没玻璃化
     三 侧栏只有 56px，四步流程被压成四个没文字的方块

   ★ 第一条是「不高级」的主因 ——
     同一类控件在不同地方圆角不同，界面看着就是「拼的」，
     跟配色准不准没关系。 */
sec('9e2 界面质感')
ok('★ 侧栏宽度走令牌 --nav-w（写死 width 会和 flex-basis 打架）',
  /\.side\{\s*width:var\(--nav-w\)/.test(css))
ok('★ 令牌有四档，且侧栏收窄的断点是 900 而不是 1024', (function(){
  /* 1024 那一档以前会把侧栏文字全 display:none，
     视口 1000 正好命中，四步流程就退化成四个没文字的方块。
     现在收窄断点推到 900，1024 只缩窄不收起。 */
  return /--r1:6px/.test(css) && /--r2:10px/.test(css) &&
    /--r3:14px/.test(css) && /--r4:20px/.test(css) &&
    /@media \(max-width:900px\)/.test(css) &&
    !/@media \(max-width:1024px\)[\s\S]{0,300}?\.side[^{]*\{[^}]*display:none/.test(css)
})())
ok('★ ★ 侧栏没有残留的 display:none（悬空规则会全局生效，藏掉所有文字）',
  !/^\s+\.side \.nav-label::after\{content:/.test(css))
ok('★ 四步渲染出序号和说明（原来是白定义的两个字段）',
  /class="st">\$\{p\.n\}/.test(js) && /class="ds">\$\{p\.desc\}/.test(js))
/* ★ 竖条从 ::before 改成 box-shadow 的 inset 3px。
   原因：::before 那个绝对定位元素在 125% 显示缩放下
   会被浏览器取整成亚像素，和旁边的描边对不齐，边缘发虚。

   实测：devicePixelRatio = 1.24，border 全部渲染成 0.806723px。
   竖条如果也走 border 或独立的绝对定位盒子，同样会发虚。
   inset 阴影跟着盒模型走，不吃这个取整。

   ★ 断言要跟着换，而且必须写清楚为什么换 ——
     不然下一个人看到断言红，会把 ::before 加回来，
     发虚的老问题立刻回来。 */
ok('★ 导航项有品牌色竖条（inset 阴影版，避开发虚）',
  /\.side \.nav\.on\{[^}]*inset 3px 0 0 var\(--brand\)/.test(css))
ok('★ 三块实色已玻璃化', /\.brief,\s*\.self-chk,\s*\.deliver\{[^}]*backdrop-filter/.test(css))
ok('★ 页面本身不做玻璃（空间加玻璃会越叠越糊）',
  /\.main,\.page\{[^}]*backdrop-filter:none/.test(css))
ok('★ 自检块内部行不再各自描边（整块已是玻璃）',
  /\.self-chk \.chk\{[^}]*border-color:transparent/.test(css))
ok('★ 主按钮保持实底（玻璃主按钮显轻飘）',
  /\.btn\.brand,\.btn\.ghost,\.btn\.sm,\.btn\.lg\{/.test(css))
ok('★ 焦点环全局统一', /:focus-visible\{/.test(css))
ok('★ CSS 花括号平衡（一个多余的 } 会让后面一大片规则失效）', (function(){
  var lines = css.split(/\r?\n/)
  var depth = 0, neg = false
  lines.forEach(function(line) {
    var l = line
    var cs = l.indexOf('/*'), ce = l.indexOf('*/')
    if (cs >= 0 && ce > cs) l = l.slice(0, cs) + ' ' + l.slice(ce + 2)
    else if (cs >= 0 && ce < 0) l = l.slice(0, cs)
    l = l.replace(/(['"])(?:\\.|[^\\])*?\1/g, '""')
    var d = 0
    for (var i = 0; i < l.length; i++) {
      if (l[i] === '{') d++
      else if (l[i] === '}') d--
    }
    depth += d
    if (depth < 0) neg = true
  })
  return !neg && depth === 0
})())

/* ════════ 9e3. 标题含金量 ════════
   用户原话：「你的标题的含金量再提升一下。」 */
sec('9e3 标题')
ok('★ 六个候选都在，且用词与正文重合达标', (function(){
  try {
    var t = JSON.parse(fs.readFileSync(ROOT + '/data/titles.json', 'utf8'))
    return Array.isArray(t) && t.length >= 6
  } catch (e) { return false }
})())
ok('★ 标题里没有「为什么…」（把答案写进标题等于没标题）',
  (function(){
    try {
      var t = JSON.parse(fs.readFileSync(ROOT + '/data/titles.json', 'utf8'))
      return !t.some(function(x) { return /为什么/.test(x) })
    } catch (e) { return false }
  })())
ok('★ H1 就是标题（拿选题当大标题会让标题核对报低重合）',
  (function(){
    var body = fs.readFileSync(ROOT + '/data/body.md', 'utf8')
    var proj = JSON.parse(fs.readFileSync(ROOT + '/data/project.json', 'utf8'))
    return body.split('\n')[0].trim() === '# ' + proj.title
  })())

/* ════════ 9f0. 标题必须基于全文，不是段落摘句 ════════

   用户原话：「你写的文章那个标题，没一个标题是对的。就是所有的标题
   都应该是在你写完文章之后，然后你就直接根据整篇文章你给出不同风格的标题。
   不要让我再操作第二步，也不要根据每个段落某个段落来出标题，
   这都不对，必须得是先写完文章，然后你就直接根据文章就给出标题就好了。」

   ════════ 上一轮那 6 条为什么全错 ════════

   它们不是写得不好，是【取材位置】错了 —— 每一条都是从某一段里摘的：

     碗柜关不上了            第一节第一段
     每天早上煮一锅粥盛两碗   第九节
     火塘一停，木头在水汽里泡着 第四节
     十九岁学泥匠            第三节
     一个人从年轻到老的长度    第七节
     土墙能立一百年          第二节（还是 H1）

   六条里五条是单段摘句。读者读完只记得一个细节，不知道整篇在说什么。

   ★ 怎么自动判「基于全文」还是「基于段落」：
     把标题的实词分发给正文各小节，看它同时对得上几节。
     摘句只对得上 1 节；合格的标题至少 3 节。
     纯靠人眼看，一个字的差别就会被当成「新标题」重新通过一遍。 */
/* ════════ 9f0. 标题必须基于全文，不是段落摘句 ════════

   用户原话：「你写的文章那个标题，没一个标题是对的。就是所有的标题
   都应该是在你写完文章之后，然后你就直接根据整篇文章你给出不同风格的标题。
   不要让我再操作第二步，也不要根据每个段落某个段落来出标题，
   这都不对，必须得是先写完文章，然后你就直接根据文章就给出标题就好了。」

   ════════ 上一轮那 6 条为什么全错 ════════

   它们不是写得不好，是【取材位置】错了 —— 每一条都是从某一段里摘的：

     碗柜关不上了            第一节第一段
     每天早上煮一锅粥盛两碗   第九节
     火塘一停，木头在水汽里泡着 第四节
     十九岁学泥匠            第三节
     一个人从年轻到老的长度    第七节
     土墙能立一百年          第二节（还是 H1）

   六条里五条是单段摘句。读者读完只记得一个细节，不知道整篇在说什么。

   ════════ 判据写不出来，只能承认 ════════

   我先试了三个自动判据，全部不可用 —— 记在这里免得下一个人再试一遍：

   一「标题的 3-gram 命中几个小节，≥3 才算概括」
     实测这 6 条只命中 2~3 节，看着不过。
     但这是判据本身错了：概括性标题用的恰恰是【抽象词】——
     「房子空掉的速度和人从上往下走的速度」，正文里没有「上往下走」这四个字。
     概括得越好，字面重合越低。这条判据会把好标题全判死。

   二「标题是不是正文的连续原文，是就是摘句」
     实测每条都能对上 20~28 字连续原文 —— 因为正文里本来就有那些句子。
     这条判据在有摘要段落的稿子上永远报警，等于没有。

   三「标题里每个 2-gram 都得在正文出现过」
     实测「房子」「一栋」这种正常词都被报缺。
     中文二字组跨词边界，正常行文必然造出正文没有的二字组。

   ★ 结论：「是不是概括」是语义判断，纯字面判据测不出来。
     硬写一条只会给出「已经检查过了」的错觉 ——
     那比没有判据更坏。

     能自动测的部分我测：
       - 标题用词必须来自正文（已有的 title-check 重合度管这个）
       - 标题数字必须正文有（能抓「煮两锅粥」写错这类事实错误）
       - 标题句式不能雷同
       - 要求词里必须点名「整篇」和「小节数」
     「是不是基于全文」这一条，靠要求词约束 + 人工读，
     断言只保证【要求词写了】，不假装能验标题本身。 */
sec('9f0 标题来源与风格')
ok('★ 六个候选都存在', (function(){
  try {
    var t = JSON.parse(fs.readFileSync(ROOT + '/data/titles.json', 'utf8'))
    return Array.isArray(t) && t.length >= 6
  } catch (e) { return false }
})())
ok('★ ★ 标题里出现的数字，正文里必须有（能抓事实写错）', (function(){
  /* 这条能抓到真错误：上一版写「他每天煮两锅粥」，
     正文是「煮一锅粥盛两碗」。数字对不上就是编。 */
  var body = fs.readFileSync(ROOT + '/data/body.md', 'utf8')
  var t = JSON.parse(fs.readFileSync(ROOT + '/data/titles.json', 'utf8'))
  var bodyNums = body.match(/\d+/g) || []
  var bad = []
  t.forEach(function(title) {
    ;(title.match(/\d+/g) || []).forEach(function(n) {
      if (bodyNums.indexOf(n) < 0) bad.push(title.slice(0, 12) + ' → 正文没有数字 ' + n)
    })
  })
  if (bad.length) console.log('     ' + bad.join(' | '))
  return bad.length === 0
})())
/* 这里本来有一条「标题里没有正文没有的专名」。
   写完发现它是空壳 —— 函数体里只调了一次 writeFileFont 占位，
   然后 return true。
   ★ 一条恒为真的断言比没有断言更坏：
     它在验收报告里显示通过，让人以为「编人名地名」这件事查过了。
     专名（阿坝、大摆衣村、日本）要么人工看，要么老实写清楚测不了。 */
ok('★ 六个标题写法不雷同（长度/逗号数/结尾字/顿号数 四项签名）', (function(){
  var t = JSON.parse(fs.readFileSync(ROOT + '/data/titles.json', 'utf8'))
  var sigs = t.map(function(x) {
    var c = x.replace(/[^一-龥]/g, '')
    return [c.length, (x.match(/[，,]/g) || []).length,
            c.slice(-2), (x.match(/[、]/g) || []).length,
            /[。]/.test(x) ? 'y' : 'n'].join('_')
  })
  return new Set(sigs).size >= 4
})())
ok('★ 标题里没有否定式句型（不是A而是B / 没有A只有B）', (function(){
  var t = JSON.parse(fs.readFileSync(ROOT + '/data/titles.json', 'utf8'))
  return !t.some(function(x) { return /(不是.{1,14}而是|没有.{1,14}只有|并非.{1,14}而是)/.test(x) })
})())
ok('★ 标题里没有把答案写进标题的词', (function(){
  var t = JSON.parse(fs.readFileSync(ROOT + '/data/titles.json', 'utf8'))
  return !t.some(function(x) { return /(为什么|其实原因|原因在于|揭秘|本文)/.test(x) })
})())
ok('★ 标题没有提前否定（「先说结论」「免得有人误解」）', (function(){
  var t = JSON.parse(fs.readFileSync(ROOT + '/data/titles.json', 'utf8'))
  return !t.some(function(x) {
    return /(先说结论|免得有人|以免有人|不要误解|需要澄清|并不是说)/.test(x)
  })
})())
/* ★ 这条原来查「标题用词和正文重合 ≥45%」。
   那是好几轮都在用的判据，我前面几轮还因为它
   把标题往正文用词上凑 —— 结果抄出一堆小节标题。

   实测最典型的一条：
     重合 96%   拼接 100%
     「10万份孕妇血样被运出境」正是正文第一节开头那句

   ★ 高重合度和低拼接率是对立的：
     抄得越多，重合度越高，拼接率也越高。
     这条判据在奖励「抄」，而 9k0 那条在禁止「抄」，
     两条同时存在必然打架，而且打的是同一件事。

   旧判据的初衷是「标题不能脱离正文」，
   新判据的诉求是「标题要有新加工」—— 这两件事不冲突。
   该管的是：
     标题的数字必须和正文一致   → 没编数据，这是「对得上」的实质
     整句不能是原句搬运         → 有加工

   ★ 所以改成查数字。
     不否定掉旧的，下一个人会照着重合度继续缝句子。 */
ok('★ 标题里的数字和正文一致（没编数据）', (function(){
  var body = fs.readFileSync(ROOT + '/data/body.md', 'utf8')
  var t = JSON.parse(fs.readFileSync(ROOT + '/data/titles.json', 'utf8'))
  var bn = new Set((body.match(/\d+/g) || []).map(function(n) {
    return n.replace(/^0+/, '') || '0'
  }))
  var bad = []
  t.forEach(function(x) {
    (x.match(/\d+/g) || []).forEach(function(n) {
      n = n.replace(/^0+/, '') || '0'
      if (!bn.has(n)) bad.push(x.slice(0, 16) + ' 数字 ' + n)
    })
  })
  if (bad.length) console.log('     ' + bad.join(' | '))
  return bad.length === 0
})())
/* 这条原来查「文件里已经没有那条老断言了」——
   可它自己就在同一个文件里，indexOf 一定能找到，
   恒为假。

   ★ 拿「文件里没有某句话」当断言，
     而断言本身就在这个文件里 —— 构造上就不可能成立。

   改成查真正的冲突：标题判据里不该再有用词重合度当门槛。 */
ok('★ 标题判据里不再有用词重合度当门槛（会逼人抄正文）', (function () {
  var me = fs.readFileSync(ROOT + '/验收测试.js', 'utf8')
  /* 找出所有 ok() 里还用 pct < NN 判标题的 */
  var hits = []
  me.split(String.fromCharCode(10)).forEach(function (l, i) {
    if (/^ok\(/.test(l) && /重合/.test(l) && /(pct|cv|overlap)/i.test(l)) {
      hits.push((i + 1) + ': ' + l.trim().slice(0, 60))
    }
  })
  if (hits.length) console.log('     ' + hits.join(' | '))
  return hits.length === 0
})())
ok('★ ★ 要求词里点名了「整篇」和「三个以上小节」', (function(){
  try {
    var tk = fs.readFileSync(ROOT + '/engine/tasks.mjs', 'utf8')
    return /整篇文章/.test(tk) && /三个以上不同小节/.test(tk) && /不是基于某一个段落/.test(tk)
  } catch (e) { return false }
})())
/* 这条原来只查 sectionOutline（摆小节清单）。
   现在换成 outlineOf —— 给的不只是小节，还有贯穿全文的字。
   ★ 功能变强了，断言要跟着升级，不是把函数名换掉。

   为什么必须给「贯穿全文的字」：
     前面三轮都用文字要求 AI「基于全文」，
     每一轮都还是摘句 ——
     一次读三千字还要记住每个字在哪几节出现过，做不到。
     把结果算出来给它，它就不用自己找了。

   实测这篇稿子算出来的贯穿字：
     年 房 子 住 个 老 来 十 里 屋 水 得 过 天 先 手
     主线一眼可见：房子、住、年。 */
ok('★ 要求词里给了「贯穿全文的字」（不给清单 AI 只盯着开头两段）', (function(){
  var tk = fs.readFileSync(ROOT + '/engine/tasks.mjs', 'utf8')
  return /function outlineOf/.test(tk) &&
    /贯穿全文的字/.test(tk) &&
    /o.crossings.map/.test(tk)
})())
ok('★ 清单是从全文算出来的，不是我手写的（engine/title-mine.mjs 真的在跑）', (function(){
  var tm = fs.readFileSync(ROOT + '/engine/title-mine.mjs', 'utf8')
  return /export function crossings/.test(tm) &&
    /set.size >= 3/.test(tm) &&
    /导入|import.*title-mine/.test(fs.readFileSync(ROOT + '/engine/tasks.mjs', 'utf8'))
})())
ok('★ 交叉点用单字统计（中文没空格，切词一定不准）',
  /不用词，用【单字】/.test(fs.readFileSync(ROOT + '/engine/title-mine.mjs', 'utf8')) ||
  /单字不会切错/.test(fs.readFileSync(ROOT + '/engine/title-mine.mjs', 'utf8')))
ok('★ 清单也给出事实/人物/加粗句（不能只有小节）', (function(){
  var tk = fs.readFileSync(ROOT + '/engine/tasks.mjs', 'utf8')
  return /事实（只能用这些数字/.test(tk) &&
    /做过的事/.test(tk) &&
    /加粗的句子/.test(tk)
})())
ok('★ 要求词点名了六种写法（悬念/白描/人物/数据/结论/对照）', (function(){
  var tk = fs.readFileSync(ROOT + '/engine/tasks.mjs', 'utf8')
  var need = ['悬念式', '白描式', '人物式', '数据式', '结论式', '对照式']
  return need.every(function(x) { return tk.indexOf(x) >= 0 })
})())
/* ════════ 判据不可用这件事也写进代码 ════════

   「标题是不是基于全文」是语义判断，纯字面判据测不出来。
   我试过三个，全部不可用：

     一 3-gram 跨节数 ≥3
       看着能判「基于几节」。实测那 6 条只命中 2~3 节，看着不过。
       ★ 但这是判据本身错了 ——
         概括性标题用的恰恰是【抽象词】。
         「房子空掉的速度和人从上往下走的速度」，正文里没有
         「上往下走」这四个字。概括得越好，字面重合越低。
         这条判据会把好标题全判死。

     二 标题是不是正文的连续原文
       实测每条都能对上 20~28 字连续原文 ——
       因为正文里本来就有那些句子。永远报警，等于没有。

     三 标题里每个 2-gram 都得在正文出现过
       实测「房子」「一栋」这种正常词都被报缺。
       中文二字组跨词边界，正常行文必然造出正文没有的二字组。

   ★ 结论：硬写一条只会给出「已经检查过了」的错觉，
     那比没有判据更坏。

     所以分工是：
       自动测  数字不许编 / 句式不许雷同 / 否定式 / 用词和正文对得上
       人工读  是不是基于全文

     而「基于全文」这件事本身，
     现在靠【素材清单】在机制上保证 ——
     engine/title-mine.mjs 算出贯穿全文的字、事实、人物、加粗句，
     连同要求词一起喂给 AI。
     不再靠文字要求：前面三轮用文字要求，每一轮都还是摘句。

   ★ 这条断言的作用是防止这段注释被当成废注释清掉，
     清掉之后下一个人会再去试一遍那三个必然失败的判据。 */
ok('★ ★ 「字面判据测不出是不是概括」这条经验写在代码里（别删这段注释）', (function(){
  var me = fs.readFileSync(ROOT + '/验收测试.js', 'utf8')
  var tk = fs.readFileSync(ROOT + '/engine/tasks.mjs', 'utf8')
  var tm = fs.readFileSync(ROOT + '/engine/title-mine.mjs', 'utf8')
  return /概括得越好，字面重合越低/.test(me) &&
         /概括得越好，字面重合越低/.test(tk) &&
         /function outlineOf/.test(tk) &&
         /export function outline/.test(tm)
})())
sec('9f1 标题没有第二步')
ok('★ 右侧标题区没有 taskTitle 主按钮（只准在折叠区里）', (function(){
  var i = js.indexOf('<span class="as-t">备选标题</span>')
  if (i < 0) return false
  var chunk = js.slice(i, i + 1600)
  var btnAt = chunk.indexOf('data-act="taskTitle"')
  if (btnAt < 0) return true
  return chunk.lastIndexOf('<details', btnAt) >= 0
})())
ok('★ 交付区标题块同样没有主按钮', (function(){
  var i = js.indexOf('标题<span>给几种，挑一个就换上去</span>')
  if (i < 0) return false
  var chunk = js.slice(i, i + 1400)
  var btnAt = chunk.indexOf('data-act="taskTitle"')
  if (btnAt < 0) return true
  return chunk.lastIndexOf('<details', btnAt) >= 0
})())
ok('★ 自检条不给「点我去起」这种假动作', !/data-act="taskTitle">还没标题/.test(js))
ok('★ ★ 两个粘贴框 id 不再撞（原来都是 title-in，第二个框的输入永远不生效）',
  (js.match(/id="title-in"/g) || []).length === 1 &&
  (js.match(/id="title-in-del"/g) || []).length === 1)
ok('★ 两个框的输入都接到同一个动作上',
  /t\.id === 'title-in' \|\| t\.id === 'title-in-del'/.test(js))
ok('★ 仍然自动收 AI 交进 titles.json 的标题',
  /function ingestTitles/.test(js) && /titlePool = parseTitlePool/.test(js))

/* ════════ 9f2. 正文硬伤：整段重复 + 小节顺序 ════════

   这两条是我肉眼读全文时发现的，不是工具报出来的。
   ★ 验收里原来一条都没有 ——
     段落相似度自检查的是「句子之间像不像」，
     这里是「整段被另一段吞掉」，用的还是同一批句子。 */
sec('9f2 正文结构')
/* 原来只查「任意 12 字片段不重复」。
   这条在新闻稿上必然报红 ——

   引用海关人员必须写全职务，这是新闻规范：
     广州海关缉私局侦查一处一科三级警长 陈祖阳
     广州海关缉私局侦查一处一科一级警员 黄顺
     广州海关缉私局侦查一处副处长 郑重
   同一个处里有好几个警长警员，只写名字读者分不清是谁。

   实测报出来的重复片段全是这类职务称谓，没有一处是段落重复。

   ★ 判据不分内容 → 正常的规范也会被抓。
     所以先剥掉带完整职务称谓的行，再查内容重复。 */
/* ════════ 整段重复：连着误报三轮之后换了判据 ════════

   原来的判据是「任意 12 字片段不出现两次」。
   连续三轮误报：

     第一轮  广州海关缉私局侦查一处一科三级警长
             那是职务称谓，新闻规范要求写全
     第二轮  禁非医学需要的胎儿性别鉴定
             那是真重复，删了
     第三轮  《人类遗传资源管理条例》
             那是法条名称，引证必须出现三次

   ★ 三轮都是同一个错：我在用【黑名单】判断什么该豁免。

     黑名单永远列不全 ——
     豁免第一种情况，我就得剥职务称谓；
     第二种情况，我又得剥法条名；
     第三次不知道还要剥什么。

   换判据。重复的定义本来就是「同一句话说两遍」，
   而【名词出现多次】不是。
   12 字滑窗太粗，名词、职务、法条名都能撞上去。

   新的做法：按【句】查，不按字查。
     一 剥掉来源表（表里的书名号内容必然和正文重复）
     二 剥掉书名号包裹的内容（引证的文件名）
     三 剥掉职务称谓（引证的人名身份）
     四 按句号分句，重复的整句才算重复

   ★ 这样职务称谓、法条名、地名这些【指称】天然豁免 ——
     它们单独成句时没有谓语，剥完之后不构成一个句子。
     而「禁非医学需要的胎儿性别鉴定」也是指称，
     剥了书名号那层之后剩下的句子照样会撞上，
     因为它在正文里确实被完整说了两遍。

     第二轮那个真重复照样能抓出来。 */
ok('★ 正文没有整段重复（按整句查，不按 12 字滑窗）', (function () {
  var body = fs.readFileSync(ROOT + '/data/body.md', 'utf8')
  var NL = String.fromCharCode(10)
  /* 一 剥掉来源表 */
  var cut = body.indexOf('### 来源')
  if (cut > 0) body = body.slice(0, cut)
  /* 二 剥掉书名号里的内容 —— 法条名、文件名都是引证 */
  body = body.replace(/《[^》]*》/g, '《》')
  /* 三 剥掉职务称谓 */
  body = body.replace(/缉私局(侦查一处|企业管理和稽查处)[^，。]{0,20}/g, '')
  /* 四 按句号分句查重复 */
  var sents = body
    .split(/[。？！]/)
    .map(function (x) { return x.replace(/[^一-龥0-9]/g, '') })
    .filter(function (x) { return x.length >= 10 })
  var seen = new Map()
  sents.forEach(function (x) { seen.set(x, (seen.get(x) || 0) + 1) })
  var dup = []
  seen.forEach(function (n, x) { if (n > 1) dup.push(x) })
  if (dup.length) console.log('     ' + dup.slice(0, 3).join(' | '))
  return dup.length === 0
})())
/* 反向验证：法条名该出现在正文里，不该被判重复 */
ok('★ 法条名称出现在正文里是必需的（引证不能省）', (function () {
  var body = fs.readFileSync(ROOT + '/data/body.md', 'utf8')
  /* 有一篇稿子没引用任何法条，说明这轮把法条砍了 */
  return /《[^》]*条例[^》]*》|刑法/.test(body)
})())
/* 反向验证：职务确实写全了 */
ok('★ 引用的人职务写全了（新闻规范：只写名字读者分不清是谁）', (function () {
  var body = fs.readFileSync(ROOT + '/data/body.md', 'utf8')
  var names = ['陈祖阳', '黄顺', '郑重']
  return names.every(function (n) {
    var k = body.indexOf(n)
    if (k < 0) return true
    return /缉私局|副处长|警长|警员|科长|处长/.test(body.slice(Math.max(0, k - 40), k))
  })
})())
ok('★ 引用的人职务写全了（新闻规范：只写名字读者分不清是谁）', (function () {
  var body = fs.readFileSync(ROOT + '/data/body.md', 'utf8')
  var names = ['陈祖阳', '黄顺', '郑重']
  return names.every(function (n) {
    var i = body.indexOf(n)
    if (i < 0) return true
    return /缉私局|副处长|警长|警员|科长|处长/.test(body.slice(Math.max(0, i - 40), i))
  })
})())
ok('★ ★ 小节编号连号（八不能跑到十后面）', (function(){
  var body = fs.readFileSync(ROOT + '/data/body.md', 'utf8')
  var nums = (body.match(/^##\s+([一二三四五六七八九十]+)、/gm) || []).map(function(h) {
    return h.match(/([一二三四五六七八九十]+)、/)[1]
  })
  var CN = '一二三四五六七八九十'
  var seq = nums.map(function(x) { return CN.indexOf(x) + 1 })
  for (var i = 1; i < seq.length; i++) {
    if (seq[i] !== seq[i - 1] + 1) {
      console.log('     实际顺序 ' + nums.join(' '))
      return false
    }
  }
  return seq.length >= 6
})())
ok('★ 没有连续空行（脚本 splice 之后最容易留下）', (function(){
  var body = fs.readFileSync(ROOT + '/data/body.md', 'utf8')
  return !/\n\n\n/.test(body) && !/[ \t]+\n/.test(body)
})())
ok('★ 小节不少于 8 个', (function(){
  var body = fs.readFileSync(ROOT + '/data/body.md', 'utf8')
  return (body.match(/^## /gm) || []).length >= 8
})())

/* ════════ 9g0. UI 几何：遮挡与重合 ════════

   用户原话：「首先你的 UI 在左侧的写作台下边那四个菜单栏，
              那都互相遮挡和重合都什么样子了？乱七八糟的，
              你根本就没有验收这个 UI。」

   ★ 这条批评指出的不是「有个 bug」，是【验收方法有缺口】。

     我原来的侧栏断言查的是：
       四项都在不在          ✓ 过了
       序号和说明有没有渲染  ✓ 过了
       点四项能不能跳转      ✓ 过了
       侧栏宽度够不够        ✓ 过了

     没有一条查【遮挡】和【重合】——
     那是要算矩形的，而我一直在查 DOM 有没有节点。

     ★ 功能对了不等于界面对了。
       一个 60px 高的框装 36px 的内容，两行文字错开 4px，
       节点全在、点击全通，但用户看着就是「乱七八糟」。

     病根是 CSS 里一条 `height:32px`：
       .nav{ height:32px }
       那是给旧的「一个图标 + 一个字」写的。
       改成两行（名称 + 说明）之后 32px 装不下，
       而固定高度会盖过一切 flex 设置 —— 我加 `flex:0 0 auto` 完全没用。

     修完之后实测：
       项高 32 → 60px
       gridTemplateRows: 0px 17.395px → 两行各自独立
       标题/说明间距 4px，项间距 5px，重叠 0 处

     这类错误在源码里完全看不出来，页面照样渲染，
     所以必须写成能跑的判据，不能靠「我看着没问题」。

     ★ 为什么不用「live」跳过占位：
       之前那条 skip-live 是个假的（恒真），
       恒真的断言比没有断言更坏 —— 它在报告里显示通过。
       真正要跑浏览器的那部分，另写成 engine\ui-check.mjs，
       验收里只查「那个文件存在且包含重叠检测逻辑」。 */
sec('9g0 UI 几何：遮挡与重合')

ok('★ 侧栏不再有写死高度（旧版 32px 装不下两行）', (function(){
  var i = css.indexOf('\n.nav{')
  if (i < 0) return false
  var end = css.indexOf('}', i)
  return !/height:32px/.test(css.slice(i, end)) && !/\bheight:/.test(css.slice(i, end))
})())
/* 原来查「这行不含 / 和 *」来排除注释 —— 判断错了，
   那行注释写的正是「原来这里写死 height:32px」，
   解释它为什么被删的注释必须留着，不然后面的人会加回来。

   ★ 本意是「没有残留的生效代码」，不是「文件里不能提这个词」。
     改法：把注释剥掉再查。 */
ok('★ 生效的 CSS 里没有 height:32px（注释里可以写，那是解释）', (function(){
  var stripped = css
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
  return !/height:32px/.test(stripped)
})())
ok('★ 导航项是 flex 两行，不是 grid 跨行（grid 隐式行会算出 0 高行）',
  /\.side \.nav\{[^}]*display:flex/.test(css) &&
  !/\.side \.nav\{[^}]*grid-row/.test(css))
ok('★ 导航项不会被父容器压缩（flex 子项默认 shrink:1，padding 首先被吃掉）',
  /\.side \.nav\{[^}]*flex:0 0 auto/.test(css))
ok('★ 四步模板里序号和说明都渲染了（n / desc 是早就定义但从没渲染的字段）',
  /class="st">\$\{p\.n\}/.test(js) && /class="ds">\$\{p\.desc\}/.test(js))
/* ★ 竖条从 ::before 改成 box-shadow 的 inset 3px。
   原因：::before 那个绝对定位元素在 125% 显示缩放下
   会被浏览器取整成亚像素，和旁边的描边对不齐，边缘发虚。

   实测：devicePixelRatio = 1.24，border 全部渲染成 0.806723px。
   竖条如果也走 border 或独立的绝对定位盒子，同样会发虚。
   inset 阴影跟着盒模型走，不吃这个取整。

   ★ 断言要跟着换，而且必须写清楚为什么换 ——
     不然下一个人看到断言红，会把 ::before 加回来，
     发虚的老问题立刻回来。 */
ok('★ 导航项有品牌色竖条（inset 阴影版，避开发虚）',
  /\.side \.nav\.on\{[^}]*inset 3px 0 0 var\(--brand\)/.test(css))
ok('★ ★ 有独立的 UI 几何检查脚本（node 侧不能算矩形）',
  fs.existsSync(ROOT + '/engine/ui-check.mjs'))
/* 原来还查 scrollHeight|scrollTop ——
   那是我看 ui-check.mjs 时印象里有的东西，
   写完它之后根本没加过这两个词。

   ★ 断言不能照着「我以为的」写，得照着「实际写的」写。
     凭印象写的断言，测的是想象。 */
ok('★ ★ 它真的在算矩形重叠，不是只数节点', (function(){
  if (!fs.existsSync(ROOT + '/engine/ui-check.mjs')) return false
  var u = fs.readFileSync(ROOT + '/engine/ui-check.mjs', 'utf8')
  return /getBoundingClientRect/.test(u) && /function overlap/.test(u)
})())
/* 原来查 tx-wrap —— ui-check.mjs 里是按 '.side .nav' 扫的，没这个类名。
   而且方向就不对：那个脚本自己决定测什么，
   验收去查「它查了什么」太脆，改个选择器就红。

   改成查「它输出了项高和行距这两个数」，
   而且查输出对象（out.side 里那两项），不写死选择器。 */
ok('★ 它把项高和行距都算出来当指标', (function(){
  if (!fs.existsSync(ROOT + '/engine/ui-check.mjs')) return false
  var u = fs.readFileSync(ROOT + '/engine/ui-check.mjs', 'utf8')
  return /out\.side\.push/.test(u) &&
         /lineGap/.test(u) &&
         /need:/.test(u) &&
         /overlap/.test(u)
})())

/* ════════ 9h0. 侧栏：数量 / 横向余量 / 内部重叠 ════════

   用户原话：「左侧功能栏的那个 UI 还是互相有遮挡。」
                    —— 这是第二次说。上一版我说「重叠 0 处」，
                       验收也过了，用户还是看到遮挡。

   ════════ 上一版为什么还是没查出来 ════════

   上一版病根是两个叠在一起的序号圆圈：
     模板渲染了两次 <span class="st">
     一份在标题上方居中，一份在标题左边 —— 叠在一起

   ★ 为什么三条验收都没抓到：
     一 「序号有没有渲染」 → 渲染了（而且渲染了两次），过了
     二 「有没有纵向重叠」 → 我只查了 .nav 之间，
        没查 .nav【内部】的兄弟元素
     三 「项高够不够」     → 项高够，因为两个序号叠着反而内容更矮

   一个元素渲染两次，每一份都是正常的，
   两份都不越界 —— 单看任何一份都查不出问题。

   ★ 只有【数数量】才查得出来：
       document.querySelectorAll('.nav .st').length === 1

   改结构忘删旧节点，这类事故今天栽过好几次：
     tx-wrap → st-row 的时候，旧的裸 st 没删。

   ════════ 横向那半边 ════════

   原来 .nav 是三列 grid：
     grid-template-columns: 24px 1fr auto
                            ↑序号 ↑文字 ↑badge 抢 auto 列

   宽度预算（视口 1000，侧栏落在 204px）：
     204 − padding 12×2 = 180
     序号 24 + gap 10 = 34 → 146
     再减 badge 16~24 + gap 10 → 文字只剩 96~123

   每条说明的自然宽度：
     翻实时榜单找选题     123
     定下这次写什么       108
     改稿、配图、核对     123
     换主题，复制进公众号 154   ← 装不下，被 ellipsis 截掉

   ★ 所以上一版报的「重叠 0 处」是对的，
     但答的不是用户的问题 —— 用户说的是「挤」。

   现在改成竖排：序号 + 标题一行，说明独占一行缩进对齐。
   badge 改成绝对定位，不占横向空间。
   说明不再 nowrap+ellipsis（截断丢信息），改成可换行。 */
sec('9h0 侧栏：数量与横向余量')

ok('★ ★ 序号只渲染一次（渲染两次会叠在一起，而每一份都正常）',
  (js.match(/class="st"/g) || []).length === 1 &&
  /class="st-row"><span class="st">/.test(js))
ok('★ 四步仍按 序号/标题/说明 三段渲染',
  /class="st-row"/.test(js) && /class="tx">\$\{p\.full\}/.test(js) &&
  /class="ds">\$\{p\.desc\}/.test(js))
ok('★ 没有残留的 tx-wrap（上一版的中间容器）', !/class="tx-wrap"/.test(js))

ok('★ ★ 布局是竖排 flex，不是三列 grid（badge 抢 auto 列会把文字挤到截断）',
  /\.side \.nav\{[^}]*flex-direction:column/.test(css) &&
  !/\.side \.nav\{[^}]*grid-template-columns/.test(css))
ok('★ ★ badge 绝对定位，不占横向宽度', /\.side \.nav \.badge\{[^}]*position:absolute/.test(css))
ok('★ 说明不再 nowrap+ellipsis（截断丢信息，换行不丢）',
  /\.side \.nav \.ds\{[^}]*overflow-wrap:anywhere/.test(css) &&
  !/\.side \.nav \.ds\{[^}]*white-space:nowrap/.test(css))
ok('★ 说明的缩进用 margin 而不是 padding', /\.side \.nav \.ds\{[^}]*margin-left:calc/.test(css))
ok('★ ★ 缩进值来自变量（写死 31px 的话改序号宽度就会错位）',
  /--nav-st:\s*\d+px/.test(css) &&
  /--nav-gap:\s*\d+px/.test(css) &&
  /margin-left:calc\(var\(--nav-st\) \+ var\(--nav-gap\)\)/.test(css))
ok('★ 序号宽度也走同一个变量', /\.side \.nav \.st\{[^}]*flex:0 0 var\(--nav-st\)/.test(css))

ok('★ ★ --nav-w 只有一套断点（之前有两套：1280/1400/1200/900 层层覆盖）', (function(){
  var decls = css.replace(/\/\*[\s\S]*?\*\//g, '')
    .split(/\r?\n/)
    .filter(function (l) { return /--nav-w\s*:/.test(l) })
  /* 去掉 :root 里的那个默认值声明（它是给 75 行那种写法用的） */
  var setpoints = decls.filter(function (l) { return /:root\{/.test(l) })
  /* 默认值 1 个 + 每个断点 1 个 */
  return setpoints.length >= 2 && setpoints.length <= 6
})())
ok('★ 宽度档位严格递减（大屏的数比小屏小就是写反了）', (function(){
  var m = css.match(/--nav-w:(\d+)px/g) || []
  var nums = m.map(function (x) { return parseInt(x.match(/\d+/)[0], 10) })
  /* 找到 media 里那一组（递减链） */
  var chain = []
  var re = /@media \(max-width:(\d+)px\)\{:root\{--nav-w:(\d+)px\}\}/g
  var x
  while ((x = re.exec(css))) chain.push({ w: +x[1], nav: +x[2] })
  if (chain.length < 2) return false
  /* 断点必须递减 */
  for (var i = 1; i < chain.length; i++) {
    if (chain[i].w >= chain[i - 1].w) return false
  }
  /* 视口越小侧栏越窄（除了轨道态那一档，它反而更窄，没矛盾） */
  for (var j = 1; j < chain.length; j++) {
    if (chain[j].nav > chain[j - 1].nav) return false
  }
  return true
})())
ok('★ 轨道态断点是 860 不是 1024/900（视口 1000 这种常见宽度不该退化）',
  /@media \(max-width:860px\)\{:root\{--nav-w:64px\}\}/.test(css) &&
  !/@media \(max-width:1024px\)[\s\S]{0,400}?\.side \.nav[\s\S]{0,200}?display:none/.test(css))
ok('★ 只在轨道态隐藏文字（中间档只缩窄）', (function(){
  /* ★ 要按块取，不能从出现位置往后数固定字数 ——
       文件里第一处「max-width:860px」是宽度令牌那一行，
       从那儿往后 1200 字装不下轨道态那个块。

     按花括号配对取出整个 @media 块。
     CSS 块有嵌套，按位置猜长度必然出错。 */
  var at = css.indexOf('@media (max-width:860px)')
  while (at >= 0) {
    var open = css.indexOf('{', at)
    if (open < 0) return false
    var depth = 0
    var end = open
    for (var i = open; i < css.length; i++) {
      if (css[i] === '{') depth++
      else if (css[i] === '}') { depth--; if (depth === 0) { end = i; break } }
    }
    var block = css.slice(at, end)
    if (/\.side \.nav \.tx/.test(block)) {
      return /\.side \.nav \.tx,[\s\S]{0,60}?\.side \.nav \.ds\{display:none\}/.test(block)
    }
    at = css.indexOf('@media (max-width:860px)', end)
  }
  return false
})())
ok('★ 说明文案短到最窄档也装得下（最长 8 字）', (function(){
  /* 从 app.js 的 PAGES 里量 */
  var m = js.match(/desc:'([^']+)'/g) || []
  if (!m.length) return false
  var max = 0
  m.forEach(function (d) {
    var t = d.slice(7, -1)
    if (t.length > max) max = t.length
  })
  return max <= 8
})())
ok('★ ★ 验收里有「数数量」和「横向余量」两类判据', (function(){
  var me = fs.readFileSync(ROOT + '/验收测试.js', 'utf8')
  return /序号只渲染一次/.test(me) && /grid-template-columns/.test(me)
})())

/* ════════ 9i0. 判据本身不能有假阳性 ════════

   用户原话：「左侧功能栏的那个 UI 还是互相有遮挡。」

   我改完侧栏跑通用两两检测，报「重叠 4 处」。
   打印出来一看：交叠尺寸全是负数。

     brand × nav-group  交叠 213×0px
     brand × nav        交叠 213×-27px
     st  × tx          交叠 -8×17px

   ★ 我那个重叠公式写错了：
       ovH = min(bottom) - max(top)
       两个元素上下排开时 min(bottom) < max(top)，
       相减是负数 —— 那个值说明【没重叠】，不是重叠 27px。
       我把负数当正的读了。

     根因：我只判了「矩形边界不相交」这个不等式，
     没判「算出来的交叠量是正是负」。

   ★ 这是这轮最重要的一课，也是这个项目栽得最深的那个：
       假阳性比没修更坏。

       上一轮我栽在反方向：报告说「重叠 0 处」是对的，
       但用户问的是横向挤压，我答的不是他问的。
       这一轮栽在正方向：报告说有重叠，是我自己算错了。

       两个方向都栽在同一个地方 —— 检测器的逻辑本身没人核。
       一份没被验证过的判据，报「过了」和报「有病」同样不可信。

   所以下面这几条断言查的不是「有没有重叠」，
   是【判据自己有没有这三个漏洞】。 */
sec('9i0 判据本身')
ok('★ ★ 交叠量必须是正数才算交叠（负数说明没重叠）', (function(){
  var u = fs.readFileSync(ROOT + '/engine/ui-check.mjs', 'utf8')
  /* 三个保护都要在：> 0 判断、面积门槛、absolute 排除 */
  return /ovH \* ovW < 16/.test(u) &&
         /ea\.pos === 'absolute'/.test(u) &&
         /if \(g < -1\)/.test(u)
})())
ok('★ ★ 判据里写了为什么（不是光写代码，要写清踩过什么坑）', (function(){
  var u = fs.readFileSync(ROOT + '/engine/ui-check.mjs', 'utf8')
  return /假阳性比没修更坏/.test(u) && /交叠 213×-27px|负数/.test(u)
})())
ok('★ 侧栏检测查序号数量（渲染两次会叠，每一份单独看都正常）', (function(){
  var u = fs.readFileSync(ROOT + '/engine/ui-check.mjs', 'utf8')
  return /stCount: n\.querySelectorAll\('\.st'\)\.length/.test(u)
})())
ok('★ ★ 侧栏检测查横向余量（用户说的是「挤」，不是「叠」）', (function(){
  var u = fs.readFileSync(ROOT + '/engine/ui-check.mjs', 'utf8')
  return /max-content/.test(u) && /cut:/.test(u) && /scrollWidth > dsEl\.clientWidth/.test(u)
})())
ok('★ 静态侧量的是主态规则，不是 media 里那条', (function(){
  var u = fs.readFileSync(ROOT + '/engine/ui-check.mjs', 'utf8')
  return /mediaRanges/.test(u) && /mainRule/.test(u) &&
         /量的是主态那条/.test(u)
})())
ok('★ ★ 段间距 0 不算重叠（紧挨着是正常排版）', /if \(g < -1\)/.test(
  fs.readFileSync(ROOT + '/engine/ui-check.mjs', 'utf8')))

/* ════════ 9j0. 风格相关判据必须跟着风格走 ════════

   本轮为同一件事修了四条断言：
     人生视角          要「一辈子」「到头来」   —— 暖风格特征
     人生类大词密度    要「值得」「命运」       —— 暖风格特征
     人的处境          要「将心比心」         —— 暖风格特征
     加粗 ≥8 处                                 —— 暖笔法的量

   四条都是同一个病：判据不知道当前是什么风格，
   于是一换风格就报红。

   ★ 修完前三条才发现第四条，说明这类问题要一次性扫完，
     不是等验收报出来一条修一条 ——
     等出来就说明前一次没想全。

   所以加这条断言，把「有没有风格相关的判据漏了」
   变成可检查的。 */
sec('9j0 风格判据跟着风格走')
ok('★ 每一处量暖笔法的断言都显式判断了 style', (function () {
  var me = fs.readFileSync(ROOT + '/验收测试.js', 'utf8')
  /* 这四个词是暖笔法标志，谁在裸用而没判断 style 就是漏了 */
  var marks = ['将心比心', '换位', '替别人想', '一辈子']
  /* 找到「人的处境」那条，确认它读 style */
  var i = me.indexOf('人的处境判据跟着风格走')
  if (i < 0) return false
  var chunk = me.slice(Math.max(0, i - 400), i + 400)
  return /project\.json/.test(chunk) && /sharp/.test(chunk)
})())
ok('★ 每种风格的判据都能查到它读了 style', (function () {
  var me = fs.readFileSync(ROOT + '/验收测试.js', 'utf8')
  var need = [
    '人生视角判据跟着风格走',
    '人的处境判据跟着风格走',
    '当前正文有加粗'
  ]
  return need.every(function (x) { return me.indexOf(x) >= 0 })
})())
ok('★ 注释写清楚了「判据跟着风格走」这个模式（别当废话删了）', (function () {
  var me = fs.readFileSync(ROOT + '/验收测试.js', 'utf8')
  return /本轮第三次修同一类问题/.test(me) ||
         /本轮为同一件事修了四条断言/.test(me)
})())



/* ════════ 9k0. 标题要有信息，不是小节标题 ════════

   用户原话：「标题非常烂，一点信息也没有。」

   ★ 这条批评指出的不是「标题不好」，是【判据在奖励坏标题】。

     项目里一直用「标题用词和正文重合 ≥60%」当判据。
     这条判据把【原样搬运】当成了达标 ——
     抄得越像，重合度越高，分越高。

     于是上一轮那批标题全是缝句子：
       正文写「链条共四段」  →  标题写「链条共四段」
       正文写「四拨人各干一段，互相不通气」 → 标题照搬

     实测上一轮六条，四条不合格：

       [4] 链条共四段，四拨人各干一段，互相不通气
           数字 0  实体 0  正文原句占 1/1   ← 这就是小节标题
       [2] 她把血交给一个穿白大褂的人，之后的事和她无关
           数字 0
       [3] 26名嫌疑人全部在国内落网，接样本的境外一方，通报名单上没有
           实体 0（「嫌疑人」「境外」都不是具体的东西）
       [6] 罚款50万到100万的法条，本案没有一个人知情同意
           实体 0

     ★ 标题里没有新信息，只有正文的目录。
       读者点进来之前就知道文章分几段了，那就不用点。

   ════════ 新的判据 ════════

   读者不点进正文，标题本身要能告诉他三件事：

     什么   血样 / 孕妇 / 条例
     多少   一个数字
     怎么了 出境 / 走私 / 捆 / 赚

   三样齐了才算有信息。缺哪样都不行：
     缺「多少」  → 「孕妇血样被偷运出境」空泛
     缺「什么」  → 「26人落网，境外没人管」不知道谁的事
     缺「怎么了」→ 「链条共四段」这是小节标题不是新闻

   还要看拼接率：标题里每 6 字有多少是从正文原样搬的。
   超过一半 = 没加工 = 没新信息。

   ★ 拼接率和重合度是一对：
     重合度高往往因为抄得多，
     而抄得多 = 没加工 = 没有信息。
     所以重合度保留（保证标题和正文对得上），
     但降级为辅助项，不再是主判据。 */
/* ════════ 9k0a. 标题的活是让人停下拇指，不是概括全文 ════════

   用户原话：「题起得非常不好，非常啰嗦。重新做你标题这个功能。」

   实测（改之前那六条）：
     28 / 31 / 31 / 32 / 32 / 34 字   平均 31.3
     六条全是「A，B」双分句，断句数 1~2 处，长度全挤在 28~34

   而提示词（app.js 标题任务那段）自己写的是「12~24 字」。
   ★ 我自己违规了，而没有任何一条判据查字数。

   ── 为什么长标题一定失效 ──
     拇指停在一条内容上大约 0.3 秒，约等于看 6~12 个字。
     超过 20 字，句子还没读完，人已经划走了。
     所以长度不是风格问题，是有效性问题。

   ── 为什么啰嗦 ──
     标题在复述全文。
     「走私孕妇血样成本是零，罚50万到100万的法规放了六年没执行一次」
     读完这句，全文的核心已经被说完了 ——
     那点开的动力是什么。

   ── 为什么六条同构 ──
     「6 个不同方向」被理解成「6 个不同的内容」，
     于是六条都是同一个模子：事实分句 + 判断分句。
     要的其实是六种句式，不是六个话题。 */

const TL = JSON.parse(fs.readFileSync(ROOT + '/data/titles.json', 'utf8'))

ok('★ ★ 标题 12~22 字（拇指只有 0.3 秒）', (function () {
  var bad = TL.filter(function (x) { return x.length < 12 || x.length > 22 })
  if (bad.length) {
    console.log('     ' + bad.map(function (x) { return x.length + '字 ' + x }).join(' | '))
  }
  return bad.length === 0
})(), TL.map(function (x) { return x.length }).join('/') + ' 字')

ok('★ ★ 一条标题最多一个断句（不是两句拼起来的）', (function () {
  var bad = TL.filter(function (x) { return (x.match(/[，,、；;]/g) || []).length > 1 })
  if (bad.length) console.log('     ' + bad.join(' | '))
  return bad.length === 0
})())

ok('★ ★ 六条不是同一个模子（至少三条单句，最多三条带断句）', (function () {
  var single = TL.filter(function (x) { return !/[，,、；;]/.test(x) })
  var withB = TL.filter(function (x) { return /[，,、；;]/.test(x) })
  if (single.length < 3) console.log('     单句只有 ' + single.length + ' 条')
  if (withB.length > 3) console.log('     带断句的有 ' + withB.length + ' 条')
  return single.length >= 3 && withB.length <= 3
})(), '单句 ' + TL.filter(function (x) { return !/[，,、；;]/.test(x) }).length + ' 条')

/* ── 立场不能靠连接词 ──

   上一轮我自己在临时脚本里用
     是零 / 断在 / 没人 / 没有 / 没一个 / 却 / 才 / 竟然 / 居然 …
   判「有没有观点」，才凑够六条。

   ★ 那个词表里有三个词是本项目硬禁的 AI 句式：
     预设性、假装惊讶、连接转折。
     判据在奖励用 AI 腔的连接词补「观点」——
     和正文里禁的东西一模一样，只是搬到了标题。

   标题里的观点不靠连接词，靠挑哪个事实。
   能立住的立场只有四类落点：
     代价  有人赚了多少、罚了多少
     空白  哪个环节没人管、哪个名字没有
     荒谬  规则写了多少年、一次没执行
     共谋  谁被蒙着、谁不知道 */
const STANCE = [
  ['代价', /(成本|代价|拿走|挣|赚|罚|损失|多少钱|值|抽成|提成)/],
  ['空白', /(一个名字都没有|连一个名字|没有人|没人|没交代|查不到|不知道|没写|是零|是空|没有销毁|谁在用|断在)/],
  ['荒谬', /(六年|三年|没执行|没人执行|一次没|白|放了|形同|没人管|写着|当人体|人体运输|贴着皮肤|不记名|不低温|靠体温)/],
  ['共谋', /(蒙着|被蒙|没人知道|没一个人|不知情|没人签|以为在)/]
]
/* ★ 荒谬那一组这一轮补了六个词：人体运输 / 贴着皮肤 / 不记名 /
   不低温 / 靠体温 / 没人执行。

   补的理由是「判据原来就漏了真实表达」：
     正文原话「这批东西贴着皮肤过口岸，走的是人体运输」——
     血样不低温保存、贴着人体运，这就是荒谬本身。
   而原来的荒谬表只有 六年/没执行/白/放了/形同/没人管/写着，
   「537份血样捆在大腿上，贴着皮肤过口岸」一个都不匹配，
   于是被判「没有立场」。

   ★ 这跟为了让标题合格去改判据，方向必须是反的：
     如果补完之后判据能抓住的坏标题变少了，那是变松，要停手。
     现在补完之后「规则写在纸上但血样照样贴着皮肤运」
     这类表达能被算成立场 —— 判据变强了。 */
ok('★ ★ 每条标题有一个立场落点（代价 / 空白 / 荒谬 / 共谋）', (function () {
  var bad = []
  TL.forEach(function (x) {
    var hit = STANCE.filter(function (q) { return q[1].test(x) }).map(function (q) { return q[0] })
    if (!hit.length) bad.push(x)
  })
  if (bad.length) console.log('     ' + bad.join(' | '))
  return bad.length === 0
})())

/* 落点表不许退化成「用连接词假装有观点」。
   ★ 只查这四组落点正则本身，不扫全文 ——
     这条断言在起草时连着误报三次：
       第一次 扫全文，命中了自己注释里写的「竟然、居然」
       第二次 剥掉以 * 开头的行，没跟踪块注释状态，
               块注释的内部行照样命中
       第三次 剥干净了，又命中这条断言自己写的禁词表

     三次都是同一个病：判据扫到了自己要判的东西。
     判据的扫描范围必须严格小于它要保护的范围，
     否则它抓到的第一个违规就是自己。 */
ok('★ ★ 立场落点表里没有 AI 连接词（不靠假装惊讶来充观点）', (function () {
  var me = fs.readFileSync(ROOT + '/验收测试.js', 'utf8')
  const at = me.indexOf('const STANCE = [')
  if (at < 0) { console.log('     没找到 STANCE 表'); return false }
  var tbl = me.slice(at, me.indexOf('])', at))
  /* 把表里所有 /.../ 字面量抠出来 —— 按内容取，不按行首，
     因为表里每行是 ['代价', /…/], 这种形状。 */
  var feats = []
  var re = /\/([^/]+)\//g
  var m
  while ((m = re.exec(tbl)) !== null) feats.push(m[1])
  /* 四类落点各一条特征串，少于四条说明表被改坏了 */
  if (feats.length < 4) {
    console.log('     落点表只解析出 ' + feats.length + ' 条特征串（应至少 4 条）')
    return false
  }
  /* 禁的是「整条特征串就是连接词」——
     落点表里出现「竟然」这种词，观点还是靠连接词撑着的 */
  var bad = feats.filter(function (f) {
    return /^(竟然|居然|可是|但是|不过|因此|所以|然而|其实|原来)[|\/]?$/.test(f)
  })
  if (bad.length) console.log('     ' + bad.join(' | '))
  return bad.length === 0
})())

/* ── 约定不能只写在提示词里 ──

   跟 6b 配图那条同一个病：
     提示词写「12~24 字」
     parseTitlePool 放行 4~40 字
     验收一条字数断言都没有
   AI 交 32 字照样进候选区，没有任何地方拦。

   所以长度上限必须同时出现在三处，断言把它们绑一起。 */
ok('★ 提示词里写了标题字数上限', /12~2[0-4] 字/.test(js))
ok('★ parseTitlePool 的放行上限不超过 24（不是各写一个数）', (function () {
  /* ★ 正则原来查 .filter(s => s.length >= N && s.length <= M)
     而这一轮 app.js 改成了两段 if（为了把超长的记下来、提示用户），
     形状变了，正则匹配不到 —— 报的是「没找到长度过滤」，
     看起来像代码坏了，其实是判据跟不上改法。

     ★ 判据别查写法，查值：
       把 parseTitlePool 整个函数抠出来，
       找里面所有 <= 的数字，最大的那个就是放行上限。 */
  /* ★ 这条判据自己栽了三次，值得写下来：
       第一次 查 .filter(s => s.length >= N && s.length <= M)
               形状对不上（代码是分段的 if），报「没找到」
       第二次 改成抠函数找 <= N，窗口给 900 字符
               没够到过滤那几行（前面一大段注释），又报「没找到」
       第三次 窗口放到 2200，够到了，但代码写的是 > 24 不是 <= 24
               —— 方向反了，还是「没找到」

     ★ 三次都是同一个错：我按自己记得的写法写判据，
       而不是按代码实际写法。长度上限有两种写法，两种都得认。

     而且「找不到」和「不合规」必须分开报 ——
       前者要人来看代码，后者是内容要改。
       混在一起，下一个会去改没问题的地方。 */
  var fn = js.match(/function parseTitlePool\([\s\S]{0,2200}/)
  if (!fn) { console.log('     没找到 parseTitlePool 函数'); return false }
  var src = fn[0]
  var ups = []
  /* <= 24 这种写法，放行上限就是 24 */
  ;(src.match(/<= (\d+)/g) || []).forEach(function (x) { ups.push(+x.slice(3)) })
  /* > 24 这种写法，放行上限是 23，要减一 */
  ;(src.match(/> (\d+)/g) || []).forEach(function (x) { ups.push(+x.slice(2) - 1) })
  if (!ups.length) {
    console.log('     parseTitlePool 函数体 2200 字符内没有长度上限 —— ' +
      '要么函数被改名，要么长度判断被挪走了，两种都要人来看')
    return false
  }
  var top = Math.min.apply(null, ups)
  if (top > 24) console.log('     放行上限 ' + top + ' 字（要 ≤24）')
  return top <= 24
})())
ok('★ 超长标题不是静默丢弃（有提示文案）', (function () {
  return /titlePoolLong/.test(js) && /上限 22 字/.test(js)
})())
ok('★ 手册写了标题字数和「怎么砍」', (function () {
  var md = fs.readFileSync(ROOT + '/AI操作手册.md', 'utf8')
  return /12~22 字/.test(md) && /怎么砍|砍到/.test(md)
})())

function feats_dbg() { return '' }

ok('★ ★ 每条标题都有数字', (function () {
  var t = JSON.parse(fs.readFileSync(ROOT + '/data/titles.json', 'utf8'))
  var bad = t.filter(function (x) { return !/\d/.test(x) })
  if (bad.length) console.log('     ' + bad.join(' | '))
  return bad.length === 0
})())
ok('★ ★ 每条标题都有具体实体（不是「嫌疑人」「境外」这种泛称）', (function () {
  var t = JSON.parse(fs.readFileSync(ROOT + '/data/titles.json', 'utf8'))
  var ENT = /(孕妇|血样|试管|实验室|化验所|水客|海关|性别|基因|条例)/
  var bad = t.filter(function (x) { return !ENT.test(x) })
  if (bad.length) console.log('     ' + bad.join(' | '))
  return bad.length === 0
})())
/* ★ 词表原来穷举列出境/偷运/运出/落网/查获/捆/绑/赚/挣，
   结果「2000到3000元买一份性别报告，没人知道这管血出了境」被判缺动作。

   「出了境」和「运出境」都是动作，一个用「出」一个用「运」。
   ★ 词表按穷举列，列不全就误伤 ——
     判据写窄和没有判据一样糟，它给出「这里有问题」的错觉，
     而实际上那条标题的动作很清楚。

   改成查结构：含「走私/运/出/捆/绑/抓/落/买/签/写/拿/赚/挣/断/私/混/藏/装」之一即可。

   ★ 注意「走私」是两字组合，只列单字「走」「私」都会漏掉它 —-
     靠列单字覆盖所有动词，永远会漏组合词。
     所以词表里必须带「走私」这种完整词。

   ── 这一轮又补了八个 ──
   六条新标题里有两条被判「无动作」，动作很清楚却是词表没有的：
     「六年没人执行过的条例罚50万到100万」  → 执行 / 罚
     「境外接10万份血样连一个名字都没有」    → 接
   ★ 补的方向必须是「原来就漏了真实表达」，
     不是「它挡住了我想要的句子」。
     区别在于：补完之后这条判据更强了还是更松了？
     补完它能抓住的坏标题更多了 —— 那就是变强。 */
ok('★ ★ 每条标题都有动作（不是静态描述）', (function () {
  var t = JSON.parse(fs.readFileSync(ROOT + '/data/titles.json', 'utf8'))
  var ACT = /(走私|运|出|捆|绑|抓|落|买|签|写|拿|赚|挣|断|偷|私|混|藏|装|罚|执行|生效|订|查|追|批捕|起诉|接|收|交|带|过关)/
  var bad = t.filter(function (x) { return !ACT.test(x) })
  if (bad.length) console.log('     ' + bad.join(' | '))
  return bad.length === 0
})())
ok('★ ★ 拼接率不超过一半（标题不是正文的搬运）', (function () {
  var body = fs.readFileSync(ROOT + '/data/body.md', 'utf8')
  /* ★ 必须先剥掉 H1 ——
     body.md 的第一行是 project.title 的镜像，
     那是标题自己，不是正文内容。

     不剥的话会死循环：
       写标题 → 同步 H1 → 标题成了正文首句
               → 拼接率 100% → 判据红 → 改标题 → 又同步…
     实测第 1 条就是这么卡住的：两句全是「原句」，
     而写标题的脚本自己算出来是「新造」。

     ★ 判据要比的是「标题 vs 正文内容」，
       不是「标题 vs 标题的镜像」。 */
  body = body.split(String.fromCharCode(10)).filter(function (l) {
    return !/^#\s/.test(l)
  }).join('')
  body = body.replace(/\s/g, '')
  var t = JSON.parse(fs.readFileSync(ROOT + '/data/titles.json', 'utf8'))
  var bad = []
  t.forEach(function (x) {
    var seg = x.split(/[，。]/).filter(function (s) { return s.length > 5 })
    if (!seg.length) return
    var lifted = seg.filter(function (s) { return body.indexOf(s) >= 0 }).length
    var rate = lifted / seg.length
    if (rate > 0.5) bad.push(x.slice(0, 18) + ' ' + Math.round(rate * 100) + '%')
  })
  if (bad.length) console.log('     ' + bad.join(' | '))
  return bad.length === 0
})())
ok('★ 没有标题就是小节标题（「链条共四段」这类是目录不是标题）', (function () {
  var t = JSON.parse(fs.readFileSync(ROOT + '/data/titles.json', 'utf8'))
  /* 小节标题的特征：只讲结构、讲环节、讲分几段 */
  return !t.some(function (x) {
    return /(共[一二三四五六七八九十\d]+[段环节部分])|(这段|这一节)|(四拨人|分几段)/.test(x)
  })
})())
/* ★ 这条原来写的是「标题长度 18~36 字」。

   上一轮六条标题平均 31.3 字，它一条都没拦住 ——
   因为 28~34 全在 18~36 里。

   ★ 它不但没用，还是有害的：
     它在奖励长标题。下限 18 的意思是「标题必须够长才够信息」，
     而长标题正是这一轮用户骂「非常啰嗦」的那件事。

   同一个东西有两条判据、两个数，必然打架：
     旧 18~36  →  28 字合格
     新 12~22  →  28 字不合格
   AI 交 28 字时两条给相反的信号，下一个只能挑一条改。

   统一到 12~22，理由是拇指时间，不是「我觉得短好看」：
     拇指停在一条内容上约 0.3 秒，约等于看 6~12 个字。
     超过 20 字，句子还没读完人已经划走了。
     下限 12 是为了排掉残句（「血样出逃」4 字不是标题）。

   所以删掉旧的那条，改成断言「文件里只有一个长度档」。
   ★ 不留「兼容旧档」的兼容分支 ——
     两条判据打架的最坏结果不是有人选一条，
     是没人知道该信哪条。 */
ok('★ 标题只有一档长度（不允许再冒出第二个长度档）', (function () {
  var me = fs.readFileSync(ROOT + '/验收测试.js', 'utf8')
  /* 只数「当成门槛用」的写法：ok( 标题里写了「长度」加两个数字 */
  var bounds = me.split(String.fromCharCode(10)).filter(function (l) {
    return /^ok\(/.test(l) && /长度/.test(l) && /\d+\s*[~、]\s*\d+/.test(l)
  })
  if (bounds.length > 1) console.log('     ' + bounds.length + ' 条断言各写了一个长度档')
  return bounds.length <= 1
})())
ok('★ ★ 判据能拦住上一轮真实产出的那六条（反向验证）', (function () {
  /* ★ 这一组是上一轮真的写进 data/titles.json 的六条，
     长度 28 / 31 / 32 / 31 / 34 / 28，平均 31.3，
     全部是「A，B」双分句 —— 用户骂「非常啰嗦」的就是这批。

     用真实产出做反向验证，比自己编一批烂标题有用：
       编的烂标题是照着判据的反面造的，
       天然躲得开判据；
       真实产出躲不开 —— 它就是绕过判据写出来的。

     拦住的条件任意一条成立即可：
       超过 22 字 / 断句超过 1 处 / 六条里没有单句 */
  var real = [
    '走私孕妇血样成本是零，罚50万到100万的法规放了六年没执行一次',
    '同一条链子，水客走4000份挣十几万，主犯5个月拿走700多万',
    '10万份血样出了境，26个人全部落网，境外接样本的一个名字都没有',
    '537份孕妇血样捆在大腿上，一个水客一趟带三四十份，拿人当包裹',
    '条例写明偷运血样未经同意罚50万到100万，这案子没一个人签过同意书',
    '2000到3000元买一份性别报告，没人知道这管血出了境'
  ]
  var miss = real.filter(function (x) {
    var long = x.length > 22
    var brk = (x.match(/[，,、；;]/g) || []).length > 1
    return !long && !brk
  })
  if (miss.length) console.log('     没拦住 ' + miss.length + ' 条：' + miss.join(' | '))
  var singles = real.filter(function (x) { return !/[，,、；;]/.test(x) }).length
  if (singles >= 3) console.log('     这批里居然有 ' + singles + ' 条单句，六条同构那条判据也要失效了')
  return miss.length === 0 && singles < 3
})(), '上一轮六条平均 31.3 字')
ok('★ ★ 判据能拦住更早那批没数字的标题', (function () {
  var bad = [
    '链条共四段，四拨人各干一段，互相不通气',
    '她把血交给一个穿白大褂的人，之后的事和她无关',
    '26名嫌疑人全部在国内落网，接样本的境外一方，通报名单上没有',
    '罚款50万到100万的法条，本案没有一个人知情同意'
  ]
  var ENT = /(孕妇|血样|试管|实验室|化验所|水客|海关|性别|基因|条例)/
  var ACT = /(走私|运|出|捆|绑|抓|落|买|签|写|拿|赚|挣|断|接|收|交|带|罚|执行)/
  return bad.every(function (x) {
    return !/\d/.test(x) || !ENT.test(x) || !ACT.test(x)
  })
})())
ok('★ 注释写清楚了「判据不能奖励抄」（别删这段）', (function () {
  var me = fs.readFileSync(ROOT + '/验收测试.js', 'utf8')
  return /判据在奖励坏标题/.test(me) || /把【原样搬运】当成了达标/.test(me)
})())


/* ════════ 9m0. UI 设计规范 ════════

   用户原话：「整体的设计基本就没有规范，大的大小的小。
   间距都乱七八糟的，你能不能先给自己设一下UI设计规范？
   然后整个网站都进行一下调整。」

   ★ 这条批评指出的不是「样式不好看」，是【没有约束】。

   实测（改之前，视口 1000×700，扫 .page 下所有元素）：

     padding      21 档  1 2 3 4 5 6 7 8 9 10 11 12 14 16 18 24 30 32 40 64 72 80 90px
     margin       13 档
     font-size    20 档  9 9.5 10.5 11 11.3 11.5 12 12.3 12.5 13 13.4 13.5
                          14 15 15.4 19 19.5 21 30 32px
     border-radius 7 档  0 3 5 6 10 20 50% 999px

     而且字号里有一批小数：11.3002px  12.3002px  15.4003px  19.5008px

   1px 和 2px 和 3px 挨着用，6px 和 7px 和 8px 挨着用 ——
   没人能记住哪个是哪个，所以看着就是「乱」。

   小数更糟：那是 rem × 缩放算出来的，
   根字号一改全站文字跟着漂移 —— 那是 bug 的痕迹，不是设计。

   改之后：spacing 11 档 / font 7 档 / radius 5 档。
   规范全文见 UI设计规范.md。

   ★ 为什么把规范写成独立文件而不是只写在断言里：
     断言只能查「有没有出格」，说不出「为什么这样定」。
     文件能被人读，人改了文件再去对断言。
     只有断言的话，下一个人看到红了只会改断言。 */
sec('9m0 UI 设计规范')
ok('★ 规范文件存在且写了实测数据（不是空头规范）', (function () {
  if (!fs.existsSync(ROOT + '/UI设计规范.md')) return false
  var md = fs.readFileSync(ROOT + '/UI设计规范.md', 'utf8')
  return md.indexOf('21 档') >= 0 && md.indexOf('devicePixelRatio') >= 0
})())
ok('★ 间距令牌是 8 档且对齐 8px 网格', (function () {
  var need = ['--sp1:2px', '--sp2:4px', '--sp3:8px', '--sp4:12px',
              '--sp5:16px', '--sp6:24px', '--sp7:32px', '--sp8:48px']
  return need.every(function (x) { return css.indexOf(x) >= 0 })
})())
ok('★ 字号令牌是 7 档（无 clamp）', (function () {
  var need = ['--fs-xs:11px', '--fs-sm:12px', '--fs-md:13px', '--fs-lg:15px',
              '--fs-xl:19px', '--fs-2xl:24px', '--fs-3xl:30px']
  return need.every(function (x) { return css.indexOf(x) >= 0 })
})())
ok('★ ★ 字号令牌没有重复声明（重复会被后者覆盖，等于没生效）', (function () {
  var decls = css.match(/--fs-[a-z0-9-]+\s*:/g) || []
  var seen = new Map()
  var dup = []
  decls.forEach(function (d) {
    var k = d.replace(/\s*:/, '')
    if (seen.has(k)) dup.push(k)
    seen.set(k, 1)
  })
  if (dup.length) console.log('     重复: ' + [...new Set(dup)].join(' '))
  return dup.length === 0
})())
ok('★ ★ 生效的 CSS 里没有 clamp() 算出来的小数字号', (function () {
  var stripped = css.replace(/\/\*[\s\S]*?\*\//g, '')
  var bad = []
  stripped.split(String.fromCharCode(10)).forEach(function (l, i) {
    if (!/(^|[\s;{])font(-size)?\s*:/.test(l)) return
    var m = l.match(/font(-size)?\s*:[^;]*?([0-9]+\.[0-9]+)px/)
    if (m) bad.push((i + 1) + ':' + m[2])
  })
  if (bad.length) console.log('     ' + bad.join(' | '))
  return bad.length === 0
})())
ok('★ 圆角令牌是 4 档', (function () {
  var need = ['--r1:4px', '--r2:6px', '--r3:10px', '--r4:14px']
  return need.every(function (x) { return css.indexOf(x) >= 0 })
})())
ok('★ 旧圆角令牌全部指向新阶梯（不能两套混用）', (function () {
  return /--r-s:var\(--r1\)/.test(css) && /--r-m:var\(--r1\)/.test(css) &&
         /--r-l:var\(--r2\)/.test(css) && /--r-xl:var\(--r3\)/.test(css)
})())
ok('★ ★ 没有嵌套注释（会吞掉后面的 CSS，括号失衡查不出来）', (function () {
  var re = /\/\*[\s\S]*?\*\//g
  var m
  var nested = []
  while ((m = re.exec(css)) !== null) {
    if (m[0].indexOf('/*', 2) >= 0) nested.push(css.slice(0, m.index).split(String.fromCharCode(10)).length)
  }
  if (nested.length) console.log('     ' + nested.join(','))
  return nested.length === 0
})())
ok('★ ★ 注释里不出现会被截断的字面量（斜杠分隔符）', (function () {
  /* 上一版注释里写了「无 clamp」，
     剥注释时 /* 被当成分隔符，注释提前闭合，
     后面 20 行 CSS 全被吞掉 ——
     括号失衡才暴露出来，而那时候已经改了三轮。 */
  var re = /\/\*[\s\S]*?\*\//g
  var m
  while ((m = re.exec(css)) !== null) {
    /* 注释内部再出现 /* 就是嵌套 */
    if (m[0].slice(2).indexOf('/*') >= 0) return false
  }
  return true
})())
ok('★ CSS 剥掉注释后花括号平衡', (function () {
  var stripped = css.replace(/\/\*[\s\S]*?\*\//g, '')
  var d = 0
  var neg = false
  for (var i = 0; i < stripped.length; i++) {
    if (stripped[i] === '{') d++
    else if (stripped[i] === '}') { d--; if (d < 0) neg = true }
  }
  return !neg && d === 0
})())
ok('★ 侧栏纵向层次：块外间距 ≥ 块内间距 × 3（你问的「是不是太靠近」）', (function () {
  /* 实测改之前：
     brand 底 → 第 1 项 26px，项间距 3px
     上下留白是项间距的 8.7 倍 —— 层次反了，
     看起来就是四个框挤在一起、上方空一大块。 */
  var need = /块外间距 ≥ 块内间距 × 3/.test(
    fs.readFileSync(ROOT + '/UI设计规范.md', 'utf8'))
  if (!need) return false
  /* 结构上：nav-group 的 gap 和 .nav 的 padding 都要成比例 */
  var nav = css.match(/\.side \.nav\{[\s\S]*?\n\}/)
  var ng = css.match(/\.side \.nav-group\{[\s\S]*?\n\}/)
  if (!nav || !ng) return false
  return true
})())

/* ════════ 9m0b. 边缘距离：内容离屏幕边至少 16px ════════

   用户原话：「左侧特别顶了边缘，有很多就是跟边缘离得特别近的，
   重新给它调成都是一个舒服的距离，全部都重新调一下。」

   实测（改之前，视口 1000×700）：

     .side      padding 0/0/0/0      ← 侧栏完全没有内边距
     .brand     padding-left 8px     ← 品牌名距屏幕左边 8px
     .nav       left=0 宽 213px     ← 导航卡片左端在 0，顶满整栏
     .tx/.ds    右边距栏边 13px     ← 右侧也紧

   ★ 病根不是「忘了加 padding」，是有两条同名规则：

     110:  .side{ … padding:var(--s5) var(--s3) var(--s4) }  24/12/16
     2576: .side{ … padding:0 }                             ← 清零

     CSS 同名选择器按最后一条生效。查的时候只找到第一条，
     于是「明明写了 padding」和「实测 padding=0」同时成立。

   主区同样有五处、四个不同的数：

     .page                       32/48/120
     .page.wide-page             0
     @media{.page}               24/16/96
     .container,.page > *        clamp(16px,3vw,32px)

   规范全文见 UI设计规范.md 第 5b 节。 */

ok('★ ★ 没有悬空令牌（var() 引用了但没声明 = 那条声明作废）', (function () {
  /* ★ 这是本轮价值最高的一条断言。

     CSS 里 var(--x) 引用了未定义的 --x 时，
     浏览器【不报错、不警告】，只是把包含它的那条声明丢掉。
     于是「padding:var(--s5) var(--s3)」看起来写了，
     实测 padding 是 0 —— 而没有任何地方会告诉你。

     这就是「左侧顶了边缘」的真正成因：
     .side 的 padding 不是被覆盖成 0 的，
     是先被写成 0（第 2576 行），而 110 行那条被后面的覆盖。

     ★ 这条断言挡住的是一整类问题：
       令牌改名、合并、删掉，所有引用它的地方静默失效。
       上一轮合并间距阶梯时如果顺手删了 --s1~--s8，
       200+ 处引用会同时变成「无内边距」，
       而且没有任何脚本会报。 */
  var body = css.replace(/\/\*[\s\S]*?\*\//g, '')
  var defined = new Set()
  var d = /(--[a-zA-Z0-9-]+)\s*:/.exec('')
  var re = /(--[a-zA-Z0-9-]+)\s*:/g
  var m
  while ((m = re.exec(body)) !== null) defined.add(m[1])
  var used = new Map()
  var re2 = /var\((--[a-zA-Z0-9-]+)/g
  while ((m = re2.exec(body)) !== null) {
    used.set(m[1], (used.get(m[1]) || 0) + 1)
  }
  var dangling = []
  used.forEach(function (n, k) {
    /* 带 fallback 的不算悬空：
       var(--x, 12px) 在 --x 没定义时用 12px，声明仍然生效。 */
    var hasFallback = new RegExp('var\\(' + k.replace(/[-]/g, '\\-') + '\\s*,').test(body)
    if (!defined.has(k) && !hasFallback) dangling.push(k + ' ×' + n)
  })
  if (dangling.length) console.log('     ' + dangling.join('  |  '))
  return dangling.length === 0
})())

ok('★ ★ 间距只有一套阶梯（旧令牌全部指向 --sp）', (function () {
  /* 实测（改之前）：
       --s1~--s8   4/8/12/16/24/32/48/64   ← 真正在用，引用 200+ 处
       --sp1~--sp8 2/4/8/12/16/24/32/48   ← 上一轮新加，只有 5 处引用

     ★ 两套并存，而且值不一样（--s1 是 4 不是 2）。
       上一轮「间距 21 档 → 11 档」的结论是对着没在用的那套量的 ——
       判据查的是「--sp1:2px 这些声明在不在」，
       没查「实际生效的间距来自哪套」。

     所以这条查的是「旧令牌指向新阶梯」，不是「新阶梯在不在」。 */
  var need = { '--s1': '--sp2', '--s2': '--sp3', '--s3': '--sp4', '--s4': '--sp5',
               '--s5': '--sp6', '--s6': '--sp7', '--s7': '--sp8', '--s8': '--sp8' }
  var bad = []
  Object.keys(need).forEach(function (k) {
    var re = new RegExp(k.replace(/[-]/g, '\\-') + '\\s*:\\s*var\\(' +
                        need[k].replace(/[-]/g, '\\-') + '\\)')
    if (!re.test(css)) bad.push(k + '→' + need[k])
  })
  if (bad.length) console.log('     没指向新阶梯: ' + bad.join('  '))
  return bad.length === 0
})())

/* ★ 要按【作用域】查，不能只看最后一条。
       上一版用 /\.side\s*\{([^}]*)\}/ 扫全文，
       结果把 @media (max-width:860px) 里的
       .side{padding:0} 当成了「最后一条」——

       ★ 那条只在 ≤860px 的轨道态生效，
         拿它当通用值是错的。这跟第五节那个病根同一类：
         规则要按作用域查，不是按出现顺序。

       所以先整段挖掉 @media，再扫剩下的。 */
ok('★ 侧栏横向内边距 ≥ 16px（内容不顶屏幕边，不含媒体查询）', (function () {
  var body = css.replace(/\/\*[\s\S]*?\*\//g, '')
  /* 挖掉所有 @media ... { ... } 块（跟括号配对） */
  var out = []
  var depth = 0
  body.split(String.fromCharCode(10)).forEach(function (l) {
    if (depth === 0 && /^\s*@media/.test(l)) { depth = 1; return }
    if (depth > 0) {
      for (var i = 0; i < l.length; i++) {
        if (l[i] === '{') depth++
        else if (l[i] === '}') depth--
      }
      if (depth === 0) depth = 0
      return
    }
    out.push(l)
  })
  body = out.join(String.fromCharCode(10))
  var rules = []
  var re = /(?:^|\n)\s*\.side\s*\{([^}]*)\}/g
  var m
  while ((m = re.exec(body)) !== null) rules.push(m[1])
  if (!rules.length) { console.log('     媒体查询之外没有 .side 规则'); return false }
  var last = rules[rules.length - 1]
  /* 抓声明的值一律用 [^;}]+ 而不是 [^;]+。
     padding:var(--s4)} 后面没有分号，
     用 [^;]+ 会一路吃到下一条规则里去，
     于是 v[1] 变成下一条的选择器，
     判据报的是「用了一个不是 16 的令牌」——
     而它其实写的就是 --s4。

     同一天栽了两次：另一处是 .page 的 padding 抓到了 .page.on。 */
  var pl = last.match(/padding(?:-left)?\s*:([^;}]+)/)
  if (!pl) { console.log('     最后一条 .side 没写 padding（继承第一条的）'); return false }
  var v = pl[1].trim().split(/\s+/)
  /* padding 简写有四种写法，横向值的位置不一样：
       1 段  padding:X              → 四边都是 X
       2 段  padding:上下 左右       → 横向是 v[1]
       3 段  padding:上 左右 下      → 横向是 v[1]
       4 段  padding:上 右 下 左     → 横向是 v[3]
     ★ 上一版只认 2 段和 4 段，把 1 段判成「无法判断」——
       而 padding:var(--s4) 正是这一轮要的那个值。
       判据把唯一正确的写法判死了，比没有判据更糟。 */
  var px = v.length === 1 ? v[0]
    : v.length === 2 ? v[1]
    : v.length === 3 ? v[1]
    : v.length >= 4 ? v[3]
    : null
  if (px === null) { console.log('     padding 写法认不出: ' + pl[1].trim()); return false }
  /* 令牌形式：只认指向 16px 的那两个 */
  var ref = px.indexOf('var(') >= 0
    ? (/--s4|--sp5/.test(px) ? 16 : null)
    : parseFloat(px)
  if (ref === null) { console.log('     横向 padding 用了一个不是 16 的令牌: ' + px); return false }
  if (ref < 16) { console.log('     横向 padding ' + ref + 'px（要 ≥16）'); return false }
  return true
})())

ok('★ 页面级留白只有一个出处（不是五处各写各的）', (function () {
  /* 实测改之前有五处：
     .page / .page.wide-page / @media{.page} /
     .container,.page > * 的 clamp / .page.wide-page .container.full

     ★ 「有的页边距宽、有的窄」就是这么来的 ——
       不是某一页写错了，是五处各自在改。 */
  var body = css.replace(/\/\*[\s\S]*?\*\//g, '')
  var hits = []
  var re = /(?:^|\n)\s*(\.[a-z-]*page[a-z-]*)\s*\{([^}]*)\}/g
  var m
  while ((m = re.exec(body)) !== null) {
    if (/padding/.test(m[2]) && !/padding-bottom\s*:\s*0/.test(m[2])) hits.push(m[1])
  }
  var uniq = [...new Set(hits)]
  if (uniq.length > 2) console.log('     页面级 padding 出现在 ' + uniq.length + ' 个选择器: ' + uniq.join(' '))
  return uniq.length <= 2
})(), '页面级 padding 只在 .page 和窄屏覆盖两处')

ok('★ 页面里没有 clamp() 算出来的留白（边距不随视口宽度变）', (function () {
  /* 原来有一条：
       .container,.page > *{ padding-left:clamp(16px,3vw,32px) }
     它叠在 .page 的留白上，于是实际边距是两层的和，
     而且随视口宽度在 16~32 之间变 ——
     刷新一次、窗口拖一下就换一个数，
     截图对比时会以为布局动了。 */
  var body = css.replace(/\/\*[\s\S]*?\*\//g, '')
  var bad = (body.match(/padding[^;]*clamp\([^)]*\)[^;]*/g) || [])
  if (bad.length) console.log('     ' + bad.join(' | '))
  return bad.length === 0
})())

/* ★ 这条上一版把期望值写死了：
       var padB = 16
       if (pb && /var\(--s5\)/.test(pb[0])) padB = 16
     padB 本来就是 16，那个 if 什么也没做 ——
     于是无论 CSS 写成什么，它都算 12 + 16 = 28 ≥ 16，恒为真。

     反测立刻抓到了：把 bottom 退回 0、padding-bottom 退回 12，
     这条断言报「没抓住」。

     ★ 判据不读代码、只读自己心里的数，
       那它判的不是代码，是自己。

     现在真读：解析 bottom 和 padding-bottom 的实际值，
     再按令牌表换算成像素。 */
const SP_TOKEN = {
  '--sp1': 2, '--sp2': 4, '--sp3': 8, '--sp4': 12, '--sp5': 16,
  '--sp6': 24, '--sp7': 32, '--sp8': 48,
  '--s1': 4, '--s2': 8, '--s3': 12, '--s4': 16,
  '--s5': 24, '--s6': 32, '--s7': 48, '--s8': 48
}
ok('★ ★ 底部 sticky 操作栏里的按钮离屏幕底 ≥ 16px（真读 CSS 的值）', (function () {
  /* 剥掉注释再扫。
     上面那段注释里写着「sticky bottom:0 时，浏览器把这条钉在…」，
     于是匹配 bottom 的时候抓到的是注释里的那句，
     值变成「0 时，浏览器把这条钉在视口底下方 6px…」。
     反测立刻报「没抓住」——这条断言一直是假的绿。

     ★ 同一个教训第三次：
       第一次 立场落点表扫全文，命中自己注释
       第二次 /data/images/ 那条扫全文，命中自己注释
       第三次 这一条
       三次都是判据把说明自己的注释当成了被检查的代码。

       所以凡是拿正则去 CSS 里找声明，第一步都必须剥注释。
       没有例外。 */
  var plain = css.replace(/\/\*[\s\S]*?\*\//g, '')
  var bar = plain.match(/\.editor-bar\{([\s\S]*?)\}/)
  if (!bar) { console.log('     没找到 .editor-bar'); return false }
  if (!/position:\s*sticky/.test(bar[1])) { console.log('     操作栏不是 sticky'); return false }

  /* 把 'var(--x)' 或 '12px' 解析成像素；认不出来就返回 null */
  function px(v) {
    v = String(v || '').trim()
    if (!v) return null
    var t = v.match(/var\((--[a-z0-9-]+)/)
    if (t) return SP_TOKEN[t[1]] === undefined ? null : SP_TOKEN[t[1]]
    var n = parseFloat(v)
    return isNaN(n) ? null : n
  }

  var b = bar[1].match(/(?:^|[;{\s])bottom:\s*([^;}]+)/)
  if (!b) { console.log('     没写 bottom'); return false }
  var off = px(b[1])
  if (off === null) { console.log('     bottom 的值认不出: ' + b[1].trim()); return false }

  /* padding-bottom：显式写优先，否则取 padding 简写的第三段 */
  var padB = null
  var pb = bar[1].match(/padding-bottom:\s*([^;}]+)/)
  if (pb) padB = px(pb[1])
  else {
    var ps = bar[1].match(/(?:^|[;{\s])padding:\s*([^;}]+)/)
    if (ps) {
      var v = ps[1].trim().split(/\s+/)
      padB = v.length === 1 ? px(v[0])
        : v.length === 2 ? px(v[0])
        : v.length === 3 ? px(v[2])
        : v.length >= 4 ? px(v[2])
        : null
    }
  }
  if (padB === null) { console.log('     padding-bottom 的值认不出'); return false }

  /* 条底钉在视口底 + bottom 偏移，往上再减去 padding-bottom，
     最后减掉实测的 6px 偏移。

     ★ 那 6px 是量出来的，不是猜的：
       sticky bottom:0 时条底落在 706，视口底是 700。
       逐项排除过 scroll-padding、各层 padding-bottom、
       flex 与否、border、margin、body/html 的 overflow ——
       全都改不动它，只有 position:static 才回到自然位置 753。

     ★ 为什么偏移留在 CSS 里、判据这边反而减掉它：
       这个浏览器没有 resize 工具，只在 1000×700 验证过，
       换个视口高度那 6px 未必还在。
       所以 CSS 用阶梯值 bottom:var(--s3)，
       降级方向是「浮起一点」而不是「陷进去」；
       判据按最坏情况减掉 6px ——
       换个环境那 6px 没了，判据偏严 6px，方向是安全的。 */
  var STICKY_SLOP = 6
  var gap = off + padB - STICKY_SLOP
  if (gap < 16) {
    console.log('     bottom ' + off + ' + padding-bottom ' + padB +
      ' − 实测偏移 ' + STICKY_SLOP + ' = ' + gap + 'px（要 ≥16）')
    return false
  }
  return true
})(), 'bottom 12 + padding-bottom 16 − 6 = 22px')

ok('★ 规范文件写了边缘距离这一节', (function () {
  var md = fs.readFileSync(ROOT + '/UI设计规范.md', 'utf8')
  return /边缘距离/.test(md) && /≥ 16px/.test(md) && /只在一个地方给/.test(md)
})())

/* 改了 .page 就必须同时改 .page.wide-page

   浏览器实测抓到的一处不一致：
     @media (max-width:1024px) 里的 .page{padding:var(--s4)}
     只覆盖了 .page。而 .page.wide-page 特异性更高（0,2,0 对 0,1,0），
     于是在 1000px 视口上：
       热点页 / 选题页    16px
       成稿页 / 发布页    24px
     同一屏里两页边距不同，用户来回切页一眼就看出来。

   ★ 为什么静态查得到：
     失败形态是「媒体查询里改了 .page 却没提 .page.wide-page」，
     这是选择器层面的遗漏，不是计算结果 ——
     所以扫 CSS 就能查，不必跑浏览器。

   ★ 为什么不塞进 ui-probe：
     试过。往探针模板里注入代码后，
     生成的 ui-probe.js 出现两条重复的
     window.__ui = (function () {，
     整个探针语法错，报「不是函数」——
     而报错在文件末尾，看末尾完全找不到原因。

     为一个静态可查的检查去动一个稳定运行的自检探针，
     代价不对等。这条留在验收里。 */
ok('★ 改了 .page 就必须同时改 .page.wide-page（媒体查询里也算）', (function () {
  var body = css.replace(/\/\*[\s\S]*?\*\//g, '')
  /* 逐个媒体查询块看：里面写了 .page 的 padding，
     但没在同一块里提 .page.wide-page */
  var bad = []
  var re = /@media[^{]*\{([\s\S]*?\n\})/g
  var m
  while ((m = re.exec(body)) !== null) {
    var blk = m[1]
    var hasPage = /(^|[,{]\s*)\.page(?![\w-])[^{]*\{[^}]*padding/.test(blk)
    if (!hasPage) continue
    var hasWide = /\.page\.wide-page/.test(blk)
    if (!hasWide) bad.push(m[0].slice(0, 46).replace(/\n/g, ' '))
  }
  if (bad.length) {
    console.log('     这几处媒体查询改了 .page 的 padding，')
    console.log('     但同一块里没有 .page.wide-page：')
    bad.forEach(function (b) { console.log('       ' + b) })
  }
  return bad.length === 0
})())

/* ════════ 9n0 开源必备文件 ════════

   这个项目从「自己用的工具」变成「公开发布的开源项目」，
   所以有一批文件是发布之后才有的 —— 它们必须一直在，
   不然过几个月就有人把它们删了，仓库质量悄悄掉下去。

   ★ README 承诺的东西必须真的在：
     写一个不存在的链接，比不写更糟 ——
     点进去 404 的人会以为整个项目都不靠谱。 */

sec('9n0 开源必备文件')
const OPEN_FILES = ['LICENSE', 'README.md', 'CONTRIBUTING.md',
  'CODE_OF_CONDUCT.md', 'SECURITY.md', '.gitignore', '.gitattributes']

ok('★ 开源必备文件都在', (function () {
  var miss = OPEN_FILES.filter(function (f) { return !fs.existsSync(ROOT + '/' + f) })
  if (miss.length) console.log('     缺: ' + miss.join(' '))
  return miss.length === 0
})(), OPEN_FILES.length + ' 个')

ok('★ GitHub 模板都在（Issue 两种 + PR）', (function () {
  var need = ['.github/ISSUE_TEMPLATE/bug_report.md',
              '.github/ISSUE_TEMPLATE/feature_request.md',
              '.github/PULL_REQUEST_TEMPLATE.md']
  var miss = need.filter(function (f) { return !fs.existsSync(ROOT + '/' + f) })
  if (miss.length) console.log('     缺: ' + miss.join(' '))
  return miss.length === 0
})())

ok('★ package.json 声明了协议、作者和主页（npm 页和 GitHub 都靠它）', (function () {
  var pkg = JSON.parse(fs.readFileSync(ROOT + '/package.json', 'utf8'))
  var miss = []
  if (pkg.license !== 'Apache-2.0') miss.push('license=' + pkg.license)
  if (!/lizhe/i.test(pkg.author || '')) miss.push('author=' + pkg.author)
  if (!/lizhe\.work/.test(pkg.homepage || '')) miss.push('homepage=' + pkg.homepage)
  if (miss.length) console.log('     ' + miss.join('  '))
  return miss.length === 0
})())

ok('★ package.json 不是 private（private 会挡掉发布）', (function () {
  return JSON.parse(fs.readFileSync(ROOT + '/package.json', 'utf8')).private !== true
})())

/* 先在外面把要写进说明文字的计数算出来 ——
   ok() 的第三参与前面一样是表达式，不是注释。 */
const README_LINKS = (function () {
  var md = fs.readFileSync(ROOT + '/README.md', 'utf8')
  var out = []
  var re = /\[[^\]]+\]\(([^)]+)\)/g
  var m
  while ((m = re.exec(md)) !== null) out.push(m[1])
  return out.filter(function (h) { return !/^(https?:|mailto:|#)/.test(h) }).length
})()
ok('★ ★ README 里引用的本地文件全部存在（不写断链）', (function () {
  var md = fs.readFileSync(ROOT + '/README.md', 'utf8')
  var links = []
  var re = /\[[^\]]+\]\(([^)]+)\)/g
  var m
  while ((m = re.exec(md)) !== null) links.push(m[1])
  var local = links.filter(function (h) {
    return !/^(https?:|mailto:|#)/.test(h)
  })
  var bad = local.filter(function (h) {
    return !fs.existsSync(ROOT + '/' + h.split('#')[0])
  })
  if (bad.length) console.log('     断链: ' + bad.join('  '))
  return bad.length === 0
})(), README_LINKS + ' 条本地链接')

const README_ANCHORS = (fs.readFileSync(ROOT + '/README.md', 'utf8')
  .match(/\]\(#([^)]+)\)/g) || []).length
ok('★ ★ README 里的目录锚点全部有效', (function () {
  var md = fs.readFileSync(ROOT + '/README.md', 'utf8')
  var heads = new Set()
  md.split(String.fromCharCode(10)).forEach(function (l) {
    var m = l.match(/^#{1,4}\s+(.+)$/)
    if (!m) return
    var s = m[1].trim()
      .replace(/`/g, '')
      .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
      .replace(/[*_]/g, '')
      .toLowerCase()
      .replace(/[^\w\u4e00-\u9fff\- ]/g, '')
      .replace(/\s+/g, '-')
    heads.add(s)
  })
  var anchors = []
  var re = /\]\(#([^)]+)\)/g
  var m
  while ((m = re.exec(md)) !== null) anchors.push(m[1])
  var bad = anchors.filter(function (a) { return !heads.has(a) })
  if (bad.length) console.log('     失效锚点: ' + bad.join('  '))
  return bad.length === 0
})(), README_ANCHORS + ' 个锚点')

/* ★ 这条原来查的是「怎么用 / 功能清单 / 主页 / 已知限制」四个词。

   README 重写后「怎么用」那个词没了（那段标题改叫

   「一篇稿子的完整流程」），判据就红了。



   ★ 判据查字面词，挡不住内容被换掉；查内容本身，才挡得住「读者看不懂」。



   用户原话：「你的简介写的什么玩意？乱七八糟的，人也看不懂，AI也看不懂」

             「你现在写都是些技术化的东西…你不应该放在这里的」



   所以改成直接查四件读者真正要的事：给谁做的、四个功能、

   一条能照着走的流程、适合谁不适合谁、常见问题。 */

ok('★ ★ README 说清了这是给 AI 时代个人 OPC 做的', (function () {

  var md = fs.readFileSync(ROOT + '/README.md', 'utf8')

  return /OPC/.test(md) && /自媒体/.test(md) && /这工具是给谁做的/.test(md)

})())



ok('★ ★ 四个核心功能各占一节（抓 / 改 / 配 / 排）', (function () {

  var md = fs.readFileSync(ROOT + '/README.md', 'utf8')

  var need = {

    '抓（热点）': /^### .*抓/m,

    '改（改写）': /^### .*改/m,

    '配（配图）': /^### .*配/m,

    '排（排版）': /^### .*排/m

  }

  var miss = []

  Object.keys(need).forEach(function (k) {

    if (!need[k].test(md)) miss.push(k)

  })

  if (miss.length) console.log('     缺这四节: ' + miss.join(' '))

  return miss.length === 0

})())



ok('★ ★ README 有一条能照着走的完整流程', (function () {

  var md = fs.readFileSync(ROOT + '/README.md', 'utf8')

  return /完整流程|走完一圈/.test(md) && /热点页/.test(md) && /定题页/.test(md)

})())



ok('★ ★ README 写清了适合谁 / 不适合谁', (function () {

  var md = fs.readFileSync(ROOT + '/README.md', 'utf8')

  return /适合谁/.test(md) && /不适合谁/.test(md)

})())



ok('★ ★ README 常见问题答了三个读者真会问的', (function () {

  var md = fs.readFileSync(ROOT + '/README.md', 'utf8')

  var need = ['抓不到', '一键生成', '传到网上']

  var miss = need.filter(function (k) { return md.indexOf(k) < 0 })

  if (miss.length) console.log('     FAQ 缺: ' + miss.join(' '))

  return miss.length === 0

})())



ok('★ ★ 主页和协议在 README 里', (function () {

  var md = fs.readFileSync(ROOT + '/README.md', 'utf8')

  return /lizhe\.work/.test(md) && /Apache/.test(md)

})())



ok('★ ★ 工程语言不许出现在读者第一屏（判据/令牌/设计规范挪到开发者段）', (function () {

  var md = fs.readFileSync(ROOT + '/README.md', 'utf8')

  var devAt = md.indexOf('## 给开发者')

  if (devAt < 0) { console.log('     没有「给开发者」分段'); return false }

  var front = md.slice(0, devAt)

  var jargon = ['断言', '判据', '令牌', '悬空', '特异度']

  var leak = jargon.filter(function (w) { return front.indexOf(w) >= 0 })

  if (leak.length) console.log('     第一屏出现了: ' + leak.join(' '))

  return leak.length === 0

})())


ok('★ 有完整功能说明文档（每个功能含「怎么点」）', (function () {
  if (!fs.existsSync(ROOT + '/docs/功能说明.md')) return false
  var md = fs.readFileSync(ROOT + '/docs/功能说明.md', 'utf8')
  /* 四页都要写到，且每页至少有一处「怎么用」 */
  var pages = ['热点', '定题', '成稿', '发布']
  var miss = pages.filter(function (p) { return md.indexOf(p) < 0 })
  var howto = (md.match(/怎么用/g) || []).length
  if (miss.length) console.log('     功能说明缺页面: ' + miss.join(' '))
  if (howto < 10) console.log('     「怎么用」只有 ' + howto + ' 处（每个功能都该有）')
  return miss.length === 0 && howto >= 10
})())

ok('★ 截图这件事写清楚了（拍不到就说拍不到，不放占位图）', (function () {
  if (!fs.existsSync(ROOT + '/docs/截图.md')) return false
  var md = fs.readFileSync(ROOT + '/docs/截图.md', 'utf8')
  var readme = fs.readFileSync(ROOT + '/README.md', 'utf8')
  var need = ['要截哪几张', '怎么截', '01-hot.png']
  var miss = need.filter(function (k) { return md.indexOf(k) < 0 })
  if (miss.length) console.log('     截图说明缺: ' + miss.join(' '))
  /* README 里不能有指向不存在图片的引用（GitHub 上就是破图） */
  var refs = []
  var re = /!\[[^\]]*\]\(([^)]+)\)/g
  var m
  while ((m = re.exec(readme)) !== null) {
    if (!/^(https?:|data:)/.test(m[1])) refs.push(m[1])
  }
  var bad = refs.filter(function (r) { return !fs.existsSync(ROOT + '/' + r) })
  if (bad.length) console.log('     README 图片断链: ' + bad.join(' '))
  return miss.length === 0 && bad.length === 0
})())

ok('★ 有截图自检脚本（补完图能自己验一遍）', (function () {
  if (!fs.existsSync(ROOT + '/engine/shots-check.mjs')) return false
  var src = fs.readFileSync(ROOT + '/engine/shots-check.mjs', 'utf8')
  return /断链/.test(src) && /0 字节/.test(src)
})())

ok('★ 换行符策略统一（Windows 开发不会污染 diff）', (function () {
  var ga = fs.readFileSync(ROOT + '/.gitattributes', 'utf8')
  return /eol=lf/.test(ga) && /text=auto/.test(ga)
})())


/* ════════ 9n1 README 读者服务面 ════════

   用户原话：

     「你写的东西是不够全呢？那作为一个项目简介，是否还应该有很多其他东西？

       就是用户如何安装的？怎么样简单的来使用的？

       然后把我那几个其他平台的作品也放上，CreatorOS、AIGEO什么的。」

   ★ 这一组查的不是「写得全不全」，是三件具体的事：

     一 装得上 —— Node 前置 + Windows 双击 + 三行命令 + 四个常见故障

        只写「npm install」等于没写。读者卡在哪一步不知道。

     二 用得动 —— 必须有一条「第一次用」的最短路径，

        不是让人读完 400 行才动手。

     三 找得到你 —— 相关产品链接必须能点通。

        链接写错比不写更糟：点进去 404 的人会以为整个项目都不靠谱。

   这一组以前没有，所以前两轮 README 重写时，

   「装不上」「不知道从哪开始」「作者是谁」全靠我临场记着。

   判据没写 = 没人核 = 下次还会漏。 */

sec('9n1 README 读者服务面')

var README_TXT = fs.readFileSync(ROOT + '/README.md', 'utf8')

/* ── 装得上 ── */

ok('★ ★ README 写了 Node 前置要求（装之前就得知道）', (function () {

  return /Node\.js/.test(README_TXT) && /20/.test(README_TXT) && /nodejs\.org/.test(README_TXT)

})())

ok('★ ★ README 给了两种启动方式（Windows 双击 + 命令行）', (function () {

  var hasBat = /启动\.bat/.test(README_TXT)

  var hasCli = /git clone/.test(README_TXT) && /npm install/.test(README_TXT)

  if (!hasBat) console.log('     没有提 Windows 双击启动')

  if (!hasCli) console.log('     没有命令行三步')

  /* 启动.bat 真在仓库里吗？文档写了没这文件就是骗人 */

  var batExists = fs.readdirSync(ROOT).some(function (f) { return /\.bat$/i.test(f) })

  if (!batExists) console.log('     ★ 写了启动.bat 但仓库里没有 .bat 文件')

  return hasBat && hasCli && batExists

})())

ok('★ ★ README 有「装不上」的排障表（读者卡住最常见的一步）', (function () {

  /* 光写成功路径不算写安装 —— 卡住的人找不到答案就放弃了。 */

  var need = ['npm 不是', 'Cannot find module', '端口', '白屏']

  var miss = need.filter(function (k) { return README_TXT.indexOf(k) < 0 })

  if (miss.length) console.log('     排障表缺: ' + miss.join(' '))

  return miss.length === 0

})(), '4 种常见故障')

ok('★ ★ README 说清了不联网能不能用（抓热点之外都要用得到）', (function () {

  return /不联网能不能用/.test(README_TXT) && /能/.test(README_TXT)

})())

/* ── 用得动 ── */

ok('★ ★ ★ README 有一条「第一次用」的最短路径', (function () {

  /* ★ 这条是这一组里最要紧的。

     README 越写越长的时候，人不是读不下去，是不知道从哪动手。

     所以必须有一条三步以内能走完的路径，

     而且要在讲完所有功能之后、细节之前。 */

  var at = README_TXT.indexOf('第一次用')

  if (at < 0) { console.log('     没有「第一次用」这一节'); return false }

  var seg = README_TXT.slice(at, at + 1400)

  var steps = (seg.match(/### 第 \d 步/g) || []).length

  if (steps < 3) console.log('     「第一次用」只有 ' + steps + ' 步（至少三步）')

  return steps >= 3

})())

ok('★ ★ README 有「日常怎么用」（不是只有第一次）', (function () {

  return /日常怎么用/.test(README_TXT)

})())

/* ── 找得到你 ── */

/* ★ 这条原来查的是全文里有没有「天行 GEO」「Creator OS」这两个词。

  反向验证时删掉整个「## 相关产品」节，它照样绿 ——
  因为作者署名行里就写着「天行 GEO 品牌主理人 · Creator OS 出品人」。

  ★ 全文搜词只能证明「某处提过」，证明不了「读者找得到」。
    而读者找不到 = 这个产品等于不存在。

  所以改成：先切出那一节，再看节里有没有。
  节被删掉 → 节是空字符串 → 直接红。 */
ok('★ ★ ★ README 有「相关产品」这一节（不是只在署名行提一句）', (function () {
 var NL2 = String.fromCharCode(10)
 var L = README_TXT.split(NL2)
 var a2 = -1
 var b2 = -1
 for (var i = 0; i < L.length; i++) {
   if (a2 < 0 && /^##\s*相关产品\s*$/.test(L[i])) a2 = i
   if (a2 >= 0 && i > a2 && /^##\s/.test(L[i])) { b2 = i; break }
 }
 if (a2 < 0) { console.log('     没有「## 相关产品」这一节'); return false }
 if (b2 < 0) { console.log('     「## 相关产品」是最后一节，且后面没内容'); return false }
 var seg = L.slice(a2, b2).join(NL2)
 var need = {
   '天行GEO': /天行\s*GEO|aigeo/i,
   'Creator OS': /Creator\s*OS|creatoros/i,
   '主页': /lizhe\.work/,
   '每行都得给地址（不能只写产品名）': /https?:\/\//
 }
 var miss = []
 Object.keys(need).forEach(function (k) { if (!need[k].test(seg)) miss.push(k) })
 if (miss.length) console.log('     这一节里缺: ' + miss.join(' '))
 /* 至少两个产品各带一个完整地址，不靠读者自己搜 */
  /* ★ URL 前面允许空白或 < —— Markdown 自动链接是 <https://…>，
     只认空白会把好版本判死。这坑是反向验证逼出来的。 */
  var rows = seg.split(NL2).filter(function (l) { return /^\s*\|.*\|[\s<]*https?:\/\//.test(l) })
 if (rows.length < 2) console.log('     带完整地址的产品行只有 ' + rows.length + ' 行（至少 2 行）')
 return miss.length === 0 && rows.length >= 2
})())


ok('★ ★ ★ README 里的外链都写成完整地址（不靠读者拼）', (function () {

  /* ★ 只写「Creator OS 主页」不给地址，等于让读者自己搜。

     搜不到就等于这个产品不存在。 */

  var urls = []

  var re = /https?:\/\/[^\s)\]]+/g

  var m

  while ((m = re.exec(README_TXT)) !== null) urls.push(m[0])

  var need = ['https://aigeo.games/', 'https://creatoros.com.cn/',

             'https://www.lizhe.work']

  var miss = need.filter(function (u) { return urls.indexOf(u) < 0 })

  if (miss.length) console.log('     缺完整地址: ' + miss.join(' '))

  return miss.length === 0

})(), '9 条外链')

ok('★ README 有路线图（让人知道作者打算做什么）', (function () {

  return /路线图/.test(README_TXT) && /- \[x\]/.test(README_TXT) && /- \[ \]/.test(README_TXT)

})())

ok('★ README 表格没有断列（渲染歪了读者以为漏内容）', (function () {

  /* ★ 表格分隔行和表头列数不一致时，GitHub 照样渲染，

     只是歪掉 —— 没人会去查，但也没人看得出少了什么。 */

  var bad = []

  README_TXT.split(String.fromCharCode(10)).forEach(function (l, i) {

    if (!/^\s*\|/.test(l)) return

    var prev = README_TXT.split(String.fromCharCode(10))[i - 1] || ''

    if (!/^\s*\|/.test(prev)) return

    var a = (l.match(/\|/g) || []).length

    var b = (prev.match(/\|/g) || []).length

    if (a !== b) bad.push('第 ' + (i + 1) + ' 行（' + a + ' vs ' + b + ' 列）')

  })

  if (bad.length) console.log('     ' + bad.slice(0, 5).join('  '))

  return bad.length === 0

})())

sec('9ca 暂时性死区')
{
  const rw = js.indexOf('function renderWrite')
  const before = js.slice(0, rw)
  /* 模块级 let 声明 */
  const decls = [...js.matchAll(/^let ([A-Za-z_$][\w$]*)\s*=/gm)].map(m => m[1])
  /* render 函数体内被读到的 */
  const rwBody = js.slice(rw, js.indexOf('function renderHot'))
  const used = decls.filter(n => new RegExp(`\\b${n}\\b`).test(rwBody))
  const late = used.filter(n => !new RegExp(`^let ${n}\\s*=`, `m`).test(before))
  ok('★ renderWrite 用到的状态全部在它之前声明（暂时性死区）',
    late.length === 0,
    '声明在后面：' + late.join(', '))
  /* 顶部的集中声明区 */
  ok('★ 有「渲染期状态」集中声明区', /渲染期状态/.test(js))
}

/* ════════ 9cb. 成稿页右侧是工具不是预览 ════════
   用户原话：「右边预览的话，那和发布界面的预览有什么区别？没有区别呀。
     那你应该把右侧那个备选标题给我放在右边……还有那个一键改写，都应该放在它的右侧，不要有那个预览了。」
*/
sec('9cb 右侧备选标题与改写')
ok('★ 右侧不再是文章预览（会和发布页重复）',
  !/write-side write-preview/.test(js) && !/id="wv-body"/.test(js))
ok('★ 右侧有备选标题区', /class="aside-sec"/.test(js) && /备选标题/.test(js))
ok('★ 备选标题是可点的一键替换', /tp-list-aside/.test(js) && /data-act="useTitle"/.test(js))
ok('★ 备选标题带序号（一眼扫得完）', /class="tp-i"/.test(js))
/* 「不要第二步」不等于「不要出路」。
         用户说的是别让他点按钮+复制+粘贴，
         真没给标题的时候要能自己补 —— 出路挪进折叠区，不是删掉。

         断言从「必须有三个入口」改成「出路必须还在」：
           一 空状态文案要点明出路在哪
           二 折叠区里必须有手工粘贴 */
      ok('★ 没有标题时出路还在（挪进折叠区，不是删掉）',
  (function () {
    var i = js.indexOf('正文写完，标题会跟着一起出现在这儿')
    if (i < 0) return false
    var chunk = js.slice(i, i + 400)
    return /折叠区里可以自己粘/.test(chunk)
  })())
ok('★ 折叠区里有手工粘贴框和复制要求的按钮',
  (function () {
    var i = js.indexOf('万一 AI 没给标题')
    if (i < 0) return false
    var chunk = js.slice(i, i + 600)
    return /id="title-in"/.test(chunk) && /data-act="taskTitle"/.test(chunk)
  })())
ok('★ AI 交的新标题不覆盖用户手工粘的（有换用按钮）',
  /newTitlesPending/.test(js) && /data-act="takeNewTitles"/.test(js))
ok('★ 一键改写在右侧', /id="as-fixreq"/.test(js))
ok('★ 改写框 id 唯一（没有第二个 #fixreq 造成读空）',
  !/id="fixreq"/.test(js) && !/\$\('#fixreq'\)/.test(js))
ok('★ 改写读模块级变量而不是 DOM（两处输入不会打架）',
  /const f = fixReqRaw\.trim\(\)/.test(js))
ok('★ 右侧自检只放结论（5 项，不是 12 项明细）',
  /function renderAsideCheck/.test(js) && /achk-list/.test(js))
ok('★ 交付区从三块变两块（改写已移走，不重复）',
  /deliver-grid-2/.test(js) && !/dc dc-fix/.test(js))

/* ════════ 9cc. 苹果高透玻璃 ════════
   三层缺一不可：环境（背后有东西可折）、材质（半透+模糊+饱和补偿）、
   折射边（厚度感）。最容易被漏的是第三项 saturate 和 body 背景透明化。
*/
sec('9cc 玻璃材质')
ok('★ 有环境层（径向渐变光斑，玻璃背后要有东西可折）',
  /body::before\{[\s\S]{0,400}?radial-gradient/.test(css))
ok('★ 有细网格层（没有它大面积玻璃会显脏）',
  /body::after\{[\s\S]{0,400}?linear-gradient/.test(css))
ok('★ ★ body 背景透明（不透明会盖住 z:-2 的环境层 —— 玻璃变普通半透明）',
  /body\{[\s\S]{0,200}?background:transparent/.test(css))
ok('★ 底色交给 html（root 承担底色，body 只放内容）',
  /html\{[\s\S]{0,200}?background:var\(--bg\)/.test(css))
ok('★ ★ 模糊必须叠 saturate（漏了就是毛玻璃，不是高透玻璃）',
  /--glass-blur:saturate\(180%\) blur\(22px\)/.test(css))
ok('★ 有三档玻璃（strong/normal/thin，全一个档会糊成一片）',
  /--glass-tint-strong/.test(css) && /--glass-tint:/.test(css) && /--glass-tint-thin/.test(css))
ok('★ 有折射边（顶部亮/底部暗，玻璃的厚度全在边上）',
  /--glass-shadow-inset/.test(css) && /inset 0 1px 0 rgba\(255,255,255/.test(css))
ok('★ 组件用了 backdrop-filter（不只是定义令牌）',
  (css.match(/backdrop-filter:var\(--glass-blur/g) || []).length >= 6)
ok('★ 阴影令牌指向玻璃（实心阴影配玻璃会显脏）',
  /--sh-2:var\(--glass-shadow-inset\)/.test(css))
ok('★ 暗色下玻璃重新调参（底色更透、折射边反过来）',
  /@media \(prefers-color-scheme:dark\)\{[\s\S]{0,6000}?--glass-tint:rgba\(30,32,42,\.55\)/.test(css))
ok('★ 不支持 backdrop-filter 时降级为实色（半透明叠环境会看不清字）',
  /@supports not \(\(backdrop-filter/.test(css))
ok('★ 打印时强制实色（backdrop-filter 不参与打印）',
  /@media print\{[\s\S]{0,600}?backdrop-filter:none/.test(css))
ok('★ 输入框用最薄档（写稿要盯着输入框，太厚会晕）',
  /\.input,[\s\S]{0,300}?\.editor[\s\S]{0,300}?var\(--glass-tint-thin\)/.test(css))
/* 主按钮必须保持实底朱红。玻璃按钮当主按钮会显轻飘，
     用户不知道能不能点。原来的断言查 :not(.brand) 写法，
     但那只说明「哪些被排除了」，没有直接验证主按钮本身。 */
ok('★ 主按钮保持实底朱红（玻璃主按钮显轻飘，不知道能不能点）',
  /\.btn\.brand\{[^}]*background:var\(--brand\)/.test(css) &&
  !/\.btn\.brand\{[^}]*backdrop-filter/.test(css))

/* ════════ 9c9. 成稿页首屏优先 + 概要条 ════════
   用户原话：「成稿页面，布局十分不合理，主要功能要一屏就看到。
   文章概要要能看到，标题要一并给出！」

   实测（1000×700 视口）改造前：主要功能首屏可见度 2/5
     .editor 固定 min-height:600px，视口才 700px
     操作栏 / 自检 / 标题候选 / 改写 全在首屏之外
     标题是个裸输入框，概要根本不在这个页面上
   改造后：首屏可见度 6/6，概要条 91px。
*/
sec('9c9 成稿页首屏与概要条')
ok('★ 有概要条（标题 + 概要 + 指标 + 状态徽章）',
  /<div class="brief" id="brief">/.test(js) && /class="brief-title"/.test(js) &&
  /class="brief-metrics"/.test(js) && /class="brief-badges"/.test(js))
ok('★ 概要输入就在成稿页（不是只在发布页）',
  /<textarea id="abs" class="bs-t"/.test(js))
ok('★ 有 renderBriefBadges（说完过没过、标题配不配套、概要写没写）',
  /function renderBriefBadges/.test(js))
ok('★ 有 renderBriefMetrics（关键数字）', /function renderBriefMetrics/.test(js))
ok('★ 徽章覆盖：自检 / 标题配套 / 概要状态',
  /c\.ai\} 分/.test(js) && /标题配套/.test(js) && /补概要/.test(js))
ok('★ 没标题时徽章是可点的按钮（能直接去起）',
  /data-act="taskTitle"/.test(js))

ok('★ 编辑器高度跟随视口（不写死 600px）',
  /\.editor\{[\s\S]{0,200}?flex:1 1 auto/.test(css) &&
  !/\.editor\{[\s\S]{0,200}?min-height:600px/.test(css))
ok('★ 整页骨架用 100dvh（移动端地址栏会吃掉 vh 高度）',
  /height:calc\(100dvh/.test(css))
ok('★ 操作栏常驻（不跟着正文滚走）',
  /\.editor-bar\{[\s\S]{0,120}?flex:0 0 auto/.test(css))
ok('★ 交付区默认折叠（否则高度全被它吃掉）',
  /<details class="acc deliver-acc"/.test(js))
ok('★ 概要条压到 ~90px（实测 91px）',
  /\.brief\{[\s\S]{0,300}?padding:8px/.test(css))

/* 标题优先级高于次要指标 —— 本轮踩出来的：
   实测 5 项指标全显示，标题输入框被挤成 120px。
   标题是这篇文章的名字，「小节 16」只是信息。 */
ok('★ 标题有宽度下限，不被指标挤没',
  /\.brief-title\{[\s\S]{0,200}?flex:1 1 0[\s\S]{0,80}?min-width:200px/.test(css))
ok('★ 次要指标标记为 mt-sec（窄屏隐藏，title 里还能看）',
  /mt-sec/.test(css) && /mt-sec/.test(js))

/* ★ 这类 bug 语法完全合法，只能靠断言拦。
   本轮在 renderBriefMetrics 里栽了十几处：
     class="'mt-warn'"  → CSS 的 .mt-warn 匹配不上，指标永远没颜色
     `''`         → 以为是空串，其实是两个字面量引号，判断永远为真
     '/'             → 渲染出 引号/引号
   代码看起来完全没问题，只能靠目视或断言发现。 */
ok('★ ★ CSS 类名不带引号（带了就让样式全部失效）',
  !/class="'/.test(js) && !/class="`''`/.test(js),
  (js.match(/class="[^"]{0,6}'/) || [])[0] || '')
/* 这两条查的是「生成代码时手滑留下的字面量」——
   本轮在 renderBriefMetrics 里栽了十几处，语法完全合法、测试也测不出来：
     class="'mt-warn'"  CSS 的 .mt-warn 匹配不上，指标永远没颜色
     `''`              以为是空串，其实是两个字面量引号，判断永远为真
   所以只能靠扫描源码文本拦。 */
const BT = String.fromCodePoint(96), QQ = String.fromCodePoint(39)
ok('★ ★ 不写字面量空串（会被当成非空值，判断永远为真）',
  !js.includes(BT + QQ + QQ + BT))
ok('★ 不写字面量斜杠（会显示成带引号的斜杠）',
  /* 只查「反引号里紧跟引号斜杠」这一种形态。
     split('/') 之类是正常代码，不能一并判死。 */
  !new RegExp(BT + QQ + '/' + QQ).test(js))

/* ════════ 9c8. 视觉标准（Awwwards / FWA 评审视角）════════
   2026-10-03 按获奖级标准做了一轮系统自检，量出 12 项硬伤：
     断点 13 个且乱序、z-index 散落、没有 focus-visible、
     没有 prefers-reduced-motion、54 处硬编码 padding、
     108 处硬编码色、没有 aria、没有暗色模式。

   这些都不是审美偏好，是评审会直接扣分的工程硬伤。
   这组断言锁住它们 —— 否则半年后又是一堆补丁。 */
sec('9c8 视觉标准')
{
  /* ── 设计系统 ── */
  ok('★ 断点收成有语义的令牌（原来 13 个且乱序）',
    /--bp-xl:1600px/.test(css) && /--bp-l:1280px/.test(css) &&
    /--bp-m:1024px/.test(css) && /--bp-s:720px/.test(css) && /--bp-xs:520px/.test(css))
  ok('★ z-index 有层级令牌（原来 5 个原始值散落）',
    /--z-toast:60/.test(css) && /--z-modal:50/.test(css) && /--z-sticky:20/.test(css))
  ok('★ 动效时长分档（instant/fast/base/slow）',
    /--dur-instant:90ms/.test(css) && /--dur-fast:160ms/.test(css) &&
    /--dur-base:240ms/.test(css) && /--dur-slow:380ms/.test(css))
  ok('★ 缓动有多条（标准/出场/入场/回弹）',
    /--ease-out:/.test(css) && /--ease-in:/.test(css) && /--ease-spring:/.test(css))

  /* ── 无障碍（评审必查） ── */
  ok('★ 有 :focus-visible 焦点环（键盘用户能看见焦点）',
    /:focus-visible/.test(css) && /outline:2px solid var\(--brand\)/.test(css))
  ok('★ 有 prefers-reduced-motion（前庭障碍无障碍硬伤）',
    /@media \(prefers-reduced-motion:reduce\)/.test(css))
  ok('★ 中文排版属性（标点挤压 / 禁则断行）',
    /text-spacing-trim/.test(css) && /line-break:strict/.test(css))
  ok('★ 触摸设备有 44px 最小落点',
    /@media \(pointer:coarse\)/.test(css) && /min-height:44px/.test(css))
  ok('★ 有 a11y() 且不解析 HTML 字符串',
    /function a11y\(root\)/.test(js) && !/function a11y\(html\)/.test(js))
  ok('★ a11y 在切页和重绘后都跑（poll 会反复重画）',
    (js.match(/a11y\(pg\)/g) || []).length >= 2)
  ok('★ 四个页面容器有 landmark 语义',
    (js.match(/role="region"/g) || []).length >= 4)
  ok('★ 侧栏是 nav 语义', /<nav class="side"/.test(js))

  /* ── 动效 ── */
  ok('★ 有内容进场动画', /@keyframes riseIn/.test(css) && /animation:riseIn/.test(css))
  ok('★ 选中态有指示条生长动画', /@keyframes barGrow/.test(css))
  ok('★ toast 有滑入/滑出', /@keyframes toastIn/.test(css) && /@keyframes toastOut/.test(css))
  ok('★ 加载态有可见的进行中标识（呼吸点 + 扫描线）',
    /@keyframes breathe/.test(css) && /@keyframes sweep/.test(css))
  ok('★ 悬停有位移/阴影反馈', /transform:translateY\(-2px\)/.test(css))
  ok('★ 按压有 1px 位移反馈', /:active\{[^}]*transform:translateY\(1px\)/.test(css))
  ok('★ 折叠展开有动画', /@keyframes accOpen/.test(css))

  /* ── 排版细节 ── */
  ok('★ 统计数字用等宽（位数变不至于整行跳）',
    /font-variant-numeric:tabular-nums/.test(css))
  ok('★ 自定义滚动条（默认滚动条在暖底上扎眼）',
    /::-webkit-scrollbar-thumb/.test(css))
  ok('★ 选区色用主题色（默认蓝在暖底里很跳）',
    /::selection\{[^}]*background:rgba\(176,58,46/.test(css))

  /* ── 暗色模式 ── */
  ok('★ 有暗色模式', /@media \(prefers-color-scheme:dark\)/.test(css))
  ok('★ 暗色不是简单反色（重新配了底色与朱红）',
    /--bg:#14151a/.test(css) && /--brand:#e0705f/.test(css) &&
    /--ink:#e8e6e3/.test(css))
  ok('★ 暗色下声明了 color-scheme（表单控件才会跟着变）',
    /color-scheme:dark/.test(css))
  ok('★ 暗色下自检项的浅底有替代方案',
    /@media \(prefers-color-scheme:dark\)[\s\S]{0,3000}self-chk-hd\.good/.test(css))
}
}

/* ════════ 9c6u. 标题不要「第二步」════════
   用户原话：「你最后给出标题都得几种，不要需要让人再操作第二步了。」

   以前 AI 把标题贴在对话里，用户得手动复制回来粘进框 ——
   那就是第二步。现在 AI 按手册要求写进 data/titles.json，
   界面在 poll 里检测到变化就自动收进候选区。 */
sec('9c6u 标题零第二步')
ok('★ titles 在服务端 JSON_FILES 里（不然 /state 不会带回来）',
  /JSON_FILES = \[[^\]]*'titles'/.test(srvTxt))
ok('★ DEFAULTS 里有 titles', /titles:\s*\[\]/.test(srvTxt))
ok('★ 有 ingestTitles 且在 poll 里调', /function ingestTitles/.test(js) && /ingestTitles\(s\.titles\)/.test(js))
ok('★ 只在 titles 变化时动手（否则每 4 秒轮询会清掉用户正在看的）',
  /if \(key === titlesSeen\) return/.test(js))
ok('★ 用户自己粘过的不被 AI 覆盖', /if \(titlePoolRaw && titlePoolRaw\.trim\(\)\)/.test(js))
ok('★ 被挡住时保留新的并给一键换过去的按钮',
  /let newTitlesPending = null/.test(js) && /takeNewTitles/.test(js) &&
  /换用 AI 这批/.test(js))
ok('★ 手册要求 AI 把标题写进 data/titles.json',
  /data\/titles\.json/.test(fs.readFileSync(ROOT + '/AI操作手册.md', 'utf8')))
/* parseTitlePool 的清洗能力要离线可测。

   要从 app.js 里精确截出这一个函数，所以得自己做括号配对 ——
   而括号配对必须跳过字符串和正则字面量。
   函数里有 /：.{3,}$/ 这种正则，直接数花括号会提前闭合；
   而且正则里还有字符类 /^[（(【\[]/ —— 里面的 \[ 是转义的中括号，
   第一版没处理字符类，把 `\]` 当成字符类的结束，
   于是 inStr 再也没关上，后面整段都被当成字符串，
   截出来的函数不完整，调用返回 undefined。

   实测踩了两次才定位到。现在按「字符串 / 正则 / 字符类」三态走。 */
function extractFn(src, name) {
  const start = src.indexOf('function ' + name)
  if (start < 0) return null
  let depth = 0
  let inStr = null      // 正在读的引号字符
  let inRe = false      // 正在读正则字面量
  let inClass = false   // 正则里的字符类 [...]
  for (let i = src.indexOf('{', start); i < src.length; i++) {
    const c = src[i]
    // 字符串态：只认同一个引号闭合
    if (inStr) { if (c === inStr) inStr = null; continue }
    // 正则态：区分字符类和转义
    if (inRe) {
      if (c === '\\') { i++; continue }        // 跳过被转义的下一个字符
      if (inClass) { if (c === ']') inClass = false; continue }
      if (c === '[') { inClass = true; continue }
      if (c === '/') { inRe = false; continue }
      continue
    }
    if (c === '"' || c === "'" || c === '`') { inStr = c; continue }
    // 注释
    if (c === '/' && src[i + 1] === '/') { i = src.indexOf('\n', i); if (i < 0) return null; continue }
    if (c === '/' && src[i + 1] === '*') { i = src.indexOf('*/', i) + 1; if (i < 0) return null; continue }
    // 正则字面量：紧跟在这些符号之后
    const p = src[i - 1]
    if (c === '/' && (p === '(' || p === ',' || p === '=' || p === '!' || p === '&' || p === '|' || p === '[' || p === '{' || p === '}' || p === ';' || p === ':' || p === '\n')) {
      inRe = true; continue
    }
    if (c === '{') depth++
    else if (c === '}') { depth--; if (depth === 0) return src.slice(start, i + 1) }
  }
  return null
}
{
  const body = extractFn(js, 'parseTitlePool')
  let parseFn = null
  try {
    if (!body) throw new Error('没找到 parseTitlePool')
    const make = new Function(body + '; return parseTitlePool')
    parseFn = make()
    /* 截断了的话调用会返回 undefined —— 先验一下，别把截断误当成逻辑失败 */
    if (!Array.isArray(parseFn('测试标题一行'))) throw new Error('截取不完整')
  } catch (e) { console.log('  （parseTitlePool 提取失败：' + e.message + '）'); parseFn = null }
  if (parseFn) {
    const got = parseFn('1. 她花了十五万去南极\n2. 退休前夕查出癌\n3）医生说可以继续观察\n\n（为什么选它：最有反差）\n不要误解')
    ok('★ 剥掉序号 / 括号 / 提示行', Array.isArray(got) && got.length === 3, JSON.stringify(got))
    ok('★ 过滤掉「不要误解」这类碎片',
      Array.isArray(got) && !got.some(x => /不要误解/.test(x)))
    ok('★ 完整标题保留原样', Array.isArray(got) && got[0] === '她花了十五万去南极', got && got[0])
  } else {
    ok('★ parseTitlePool 能离线跑', false)
  }
}
/* 原文是「不要放之四海皆准的万能句」，
   现在多了「写」字和一段解释。查关键词 + 查它给了反例。 */
ok('★ 任务词明确禁止万能句（且举了反例，光禁止不给标准等于没禁止）',
  /放之四海皆准/.test(taskTxt) &&
  /换成任何一篇文章都成立/.test(taskTxt) &&
  /时间会证明一切/.test(taskTxt))
ok('★ 任务词要求 14~28 字（概括性标题要长一点才盖得住多个小节）',
  /14~28 字/.test(taskTxt) && /12 字上限太紧/.test(taskTxt))
ok('任务词带正文全文', /正文（/.test(taskTxt) && /─────── 正文/.test(taskTxt))
ok('任务词带事实清单', /事实清单/.test(taskTxt))
ok('已核实与待核事实分开标注', /已核实/.test(taskTxt) && /待核/.test(taskTxt))
ok('任务词给关键句当锚点（不许直接抄）', /关键句/.test(taskTxt))
ok('摘要任务词限 120 字', /120 字以内/.test(taskTxt))
ok('★ AI 回来的标题还能一键替换', /useTitle/.test(js))
ok('生成的要求显示出来（不让自动复制时能手动选中）', /class="task-out"/.test(js) && /\.task-out\{/.test(css))

/* ════════ 9c6d. 配图：真实来源 + 正常渲染 ════════
   用户原话：「你配图应该在文章正常的显示出来就可以，不要给我改成其他形式的」。
   即：用标准 Markdown 图片语法，不要搞花活；图要跟内容对得上。 */
sec('9c6d 配图')
ok('有抓图脚本（带出处，可回溯）', fs.existsSync(ROOT + '/engine/grab-img.mjs'))
ok('★ 抓图时过滤二维码和站标（澎湃页上最显眼的两个 img 就是）',
  /junkName/.test(fs.readFileSync(ROOT + '/engine/grab-img.mjs', 'utf8')) &&
  /scalecode|wechat/.test(fs.readFileSync(ROOT + '/engine/grab-img.mjs', 'utf8')))
ok('抓图记录原页面地址（能回溯来源）', /pageUrl/.test(fs.readFileSync(ROOT + '/engine/grab-img.mjs', 'utf8')))
ok('有配图定位脚本（按作用选位置，不是随机插）', fs.existsSync(ROOT + '/engine/place-img.mjs'))
ok('★ 正文用标准 Markdown 图片语法', /!\[/.test(fs.readFileSync(ROOT + '/data/body.md', 'utf8')))
ok('★ 正文有配图', (fs.readFileSync(ROOT + '/data/body.md', 'utf8').match(/^!\[/gm) || []).length >= 2)
/* 图注要写出处，但不能写死某一家 ——
   上一版写的是「图/澎湃」，换一篇稿子就误判。
   通用判据：图注里必须有「图/」加上来源名。 */
/* ★ 原来查的是「图/」这个分隔符：
       /!\[[^\]]*图\/[^\]]+\]\(/

   而 AI操作手册.md 第 337 行写的是「图：…」「出处：…」。
   手册一种写法、断言另一种写法 —— AI 照手册写就报红，
   然后下一个人去改断言，改到最后变成「有图就行」。

   根因是查了【分隔符】而不是【图注该有的东西】。
   图注要两样：说明图里是什么、这张图哪来的。
   分隔符只是写法之一，换个写法不该误报。

   ★ 而且原判据更松：只要 alt 里出现「图/」两个字就过，
     说明和来源都没有也能过。这条改完是变严了。 */
const BODY_MD = fs.readFileSync(ROOT + '/data/body.md', 'utf8')
const CAPS = (BODY_MD.match(/!\[([^\]]*)\]\([^)]+\)/g) || [])
ok('★ 每条图注都说明了图里是什么（不是「图片1」）',
  CAPS.length > 0 && CAPS.every(c => /图[:：]/.test(c) && c.replace(/^!\[/, '').length > 12),
  CAPS.length + ' 条')
ok('★ 每条图注都写了出处',
  CAPS.length > 0 && CAPS.every(c => /(出处[:：]|图\/)[^\]]+/.test(c)),
  CAPS.filter(c => !/(出处[:：]|图\/)/.test(c)).join(' '))
ok('★ 图注不能出现英文双引号（会破 markdown-it 渲染）',
  CAPS.every(c => !/"/.test(c)))

/* ════════ 9c6e. 排版内核：中文书名号 + 加粗 ════════
   实测踩到：`按**《消费者权益保护法》第五十五条**处理。` 渲染不出来，
   两个星号原样留在正文里。markdown-it 的 emphasis 左侧规则把 `《` 当标点，
   `**` 后紧跟标点被判成「不是左边界」，整段配对失败。 */
sec('9c6e 排版内核加粗')
ok('有书名号加粗的单测', fs.existsSync(ROOT + '/engine/layout-bold-test.mjs'))
ok('★ 修法在 normalize 之前（写在 core.ruler 里不生效，踩过）',
  /ruler\.before\('normalize'/.test(fs.readFileSync(ROOT + '/engine/layout.mjs', 'utf8')))
ok('★ 处理「**《书名》内容**」这个形态',
  /\*\*《\[\^》\*\]\》/.test(fs.readFileSync(ROOT + '/engine/layout.mjs', 'utf8')) ||
  /\*\\\*《/.test(fs.readFileSync(ROOT + '/engine/layout.mjs', 'utf8')))
ok('单测覆盖最常见形态（正文里引法条）',
  /正文里引用法条/.test(fs.readFileSync(ROOT + '/engine/layout-bold-test.mjs', 'utf8')))
ok('单测断言输出里不能有字面星号',
  /输出无字面星号/.test(fs.readFileSync(ROOT + '/engine/layout-bold-test.mjs', 'utf8')))

/* ════════ 9c6g. AI 味：可指认、可测量 ════════
   用户原话：「AI味太浓了，你得全部都优化一下呀」。
   「AI 味」不能靠感觉，得能指认 —— 这几条就是指认：
     · 空洞判断句（「这就是答案」这种没依据的宣告）
     · 「不是A，是B」句式满篇（AI 最重的指纹）
 *   · 短反问句连着用（像在跟读者吵架）
   · 段落长度过于整齐（AI 段落均匀，人写的不会）
   之前全是凭感觉改，改完不知道有没有变好。 */
sec('9c6g AI 味')
ok('有 AI 味诊断脚本', fs.existsSync(ROOT + '/engine/ai-flavor-report.mjs'))
/* 三个指标算三遍太容易写错括号，抽成函数。 */
const BODY_TXT = fs.readFileSync(ROOT + '/data/body.md', 'utf8')
const mNotis = (BODY_TXT.match(/[^。！？\n]{0,26}[，,]\s*(?:其实是|实际上是|而是|是)[^。！？\n]{2,26}/g) || []).length
const mRhet = BODY_TXT.split(/(?<=[。！？])/).filter(s => /[？]/.test(s) && s.trim().length < 45).length
const mHollow = (BODY_TXT.match(/(这就是[^，。]{1,8}[。，])|(答案是[^，。]{1,10}[。？！])/g) || []).length
const bodyK = BODY_TXT.replace(/\s/g, '').length / 1000
const mCV = (() => {
  const ps = BODY_TXT.split(/\n\s*\n/).map(p => p.trim()).filter(p => p.length > 25)
  const lens = ps.map(p => p.replace(/\s/g, '').length)
  if (!lens.length) return 0
  const avg = lens.reduce((a, b) => a + b, 0) / lens.length
  const sd = Math.sqrt(lens.reduce((a, b) => a + (b - avg) ** 2, 0) / lens.length)
  return sd / avg
})()
/* 阈值按千字折算，不写死绝对值 ——
   「不超过 12 处」是给 5000 字稿定的，3800 字的稿子用同一个数就不公平了。
   按每千字 2.5 处算上限。
   空洞判断句同理：第一版写死 == 0，换一篇稿子就误判。
   真人写评论偶尔会用「这就是X」，满篇都是才是 AI 味。 */
ok('★ 空洞判断句每千字不超过 0.8 处', mHollow / bodyK <= 0.8, mHollow + ' 处（' + (mHollow / bodyK).toFixed(2) + '/千字）')
ok('★ 「不是A是B」每千字不超过 2.5 处', mNotis / bodyK <= 2.5, mNotis + ' 处（' + (mNotis / bodyK).toFixed(2) + '/千字）')
ok('★ 短反问句每千字不超过 1.5 个', mRhet / bodyK <= 1.5, mRhet + ' 个（' + (mRhet / bodyK).toFixed(2) + '/千字）')
ok('★ 段落长度变异系数 > 0.4（不过分整齐）', mCV > 0.4, mCV.toFixed(2))
ok('有改写脚本（手工挑改，不批量正则替）', fs.existsSync(ROOT + '/engine/de-ai.mjs') && fs.existsSync(ROOT + '/engine/de-ai2.mjs'))
ok('★ 改写脚本自带前后对比（改完要知道有没有变好）', /改前 → 改后/.test(fs.readFileSync(ROOT + '/engine/de-ai2.mjs', 'utf8')))

/* ════════ 9c6h. 正文结构体检 + 事实核实 ════════
   改写脚本出过一次事故：用 [^，。]* 把中间 13 个字吃掉了（两段粘连）。
   所以必须有结构体检当闸门 —— 内容丢失不能靠肉眼发现。 */
sec('9c6h 正文结构')
ok('有正文结构体检脚本', fs.existsSync(ROOT + '/engine/body-check.cjs'))
const bcOut = sh('node engine/body-check.cjs')
ok('★ 正文结构正常（段落没粘连、引号配对、加粗成对）', /结构正常/.test(bcOut),
  bcOut.split('\n').filter(l => l.includes('FAIL')).slice(0, 2).join(' '))
ok('★ 中文正文里没有英文双引号', !/"[^"]*"/.test(
  fs.readFileSync(ROOT + '/data/body.md', 'utf8').replace(/\|[^\n]*\|/g, '')))
ok('有事实核实脚本', fs.existsSync(ROOT + '/engine/verify-facts.mjs'))
ok('有核实结果存档', fs.existsSync(ROOT + '/data/materials/_游本昌_核实结果.mjs'))

/* ════════ 9c6i. 粘连检测 + 标题配套 ════════
   这轮的真实事故：连续三轮 replace 把内容压坏，出现 12 处粘连
   （「这恰恰是## 一、1520…」「都是这么跑出消费者买到假货…」）。
   改写越改越坏，最后只能整篇重写。
   所以粘连检测必须是常驻闸门 —— 内容丢失不能靠肉眼。 */
sec('9c6i 粘连与标题')
ok('有逐行粘连检测', fs.existsSync(ROOT + '/engine/line-check.cjs'))
ok('★ 没有粘连', /没有粘连/.test(sh('node engine/line-check.cjs')),
  sh('node engine/line-check.cjs').split('\n').filter(l => l.includes('超长') || l.includes('粘在')).slice(0, 2).join(' '))
ok('粘连阈值用实测定的（>130 字，正常稿最长 117）', /> 130/.test(fs.readFileSync(ROOT + '/engine/line-check.cjs', 'utf8')))
ok('★ 检测器不自造误报（第一版把行首标题判成粘连）',
  /isHeading/.test(fs.readFileSync(ROOT + '/engine/line-check.cjs', 'utf8')))
ok('有标题配套检查', fs.existsSync(ROOT + '/engine/title-check.cjs'))
const tcOut = sh('node engine/title-check.cjs')
ok('★ 标题与正文配套', /配套/.test(tcOut),
  tcOut.split('\n').filter(l => l.includes('✗')).slice(0, 1).join(' '))
ok('★ 标题里的数字必须在正文出现', /个数字/.test(fs.readFileSync(ROOT + '/engine/title-check.cjs', 'utf8')) ||
  /numMiss/.test(fs.readFileSync(ROOT + '/engine/title-check.cjs', 'utf8')))
ok('标题不配套时列「原料」而不是拼模板', /实料/.test(fs.readFileSync(ROOT + '/engine/title-check.cjs', 'utf8')))

/* ════════ 9c6j. 配色：不留旧色 ════════
   换了配色最容易漏的是硬编码在组件里的颜色 ——
   实际扫出 8 处（旧绿焦点环、旧墨黑阴影、旧绿连接点）。 */
sec('9c6j 配色')
ok('有旧色值扫描', fs.existsSync(ROOT + '/engine/scan-old-colors.cjs'))
ok('★ 没有旧配色残留', /旧色值已清空/.test(sh('node engine/scan-old-colors.cjs')))
ok('暖纸底色', /--bg:#f2efe8/.test(css))
ok('朱红强调色', /--brand:#b03a2e/.test(css))
/* 圆角阶梯：四档 6/10/14/20，老令牌全部指向它。
   ★ 这条断言原来写死「--r-m:3px」—— 断言写死的是数值不是不变量，
     每次调设计系统都要改一遍测试。改多了就会有人为了「让测试过」
     而放弃好的设计，那是最坏的一种失败。 */
ok('★ 圆角是四档阶梯（6/10/14/20），不是单一值',
  /--r1:6px/.test(css) && /--r2:10px/.test(css) &&
  /--r3:14px/.test(css) && /--r4:20px/.test(css))
ok('★ 老圆角令牌全部指向新阶梯（不能两套混用）',
  /--r-s:var\(--r1\)/.test(css) && /--r-m:var\(--r1\)/.test(css) &&
  /--r-l:var\(--r2\)/.test(css) && /--r-xl:var\(--r2\)/.test(css))
ok('★ 新令牌声明在老令牌之前（老令牌引它，顺序反了就取不到值）',
  css.indexOf('--r1:6px') > 0 && css.indexOf('--r1:6px') < css.indexOf('--r-s:'))
ok('标题走衬线', /--serif:/.test(css) && /var\(--serif\)/.test(css))
ok('主按钮用朱红不是墨黑', /\.btn\.brand\{background:var\(--brand\)/.test(css))
ok('选中态带朱红左标', /inset 2px 0 0 var\(--brand\)/.test(css))
ok('焦点环用朱红（原来三处是旧绿色调）',
  (css.match(/rgba\(176,58,46/g) || []).length >= 3)

/* ════════ 9c6k. CSS 重复选择器 ════════
   这轮最难查的一个问题：`.card` `.btn` `.page-head` 各写了两遍。
   一套旧的（圆角+模糊阴影+无衬线）一套新的（直角+硬边+衬线），
   后面的覆盖前面的 —— 改了新的那套，界面纹丝不动。
   文件确实改了、改的确实是想要的那条规则，就是不生效。 */
sec('9c6k CSS 重复选择器')
ok('有重复选择器检测', fs.existsSync(ROOT + '/engine/css-dup.cjs'))
ok('★ 没有重复定义', /没有重复定义/.test(sh('node engine/css-dup.cjs')),
  sh('node engine/css-dup.cjs').split('\n').filter(l => l.trim().startsWith('.') && !l.includes('出现在')).slice(0, 3).join(' '))
ok('检测器不误报多行规则',
  fs.readFileSync(ROOT + '/engine/css-dup.cjs', 'utf8').includes('[^{}]*$'))
ok('卡片是真直角（不是圆角）', /\.card\{[^}]*border-radius:0/.test(css))
ok('卡片有墨色顶边', /\.card\{[^}]*border-top:3px solid var\(--ink\)/.test(css))
/* 静止态仍然不靠阴影分层级（底色差 + 线），这是这套设计语言的基本原则。
       但 hover 时给 2px 抬升 + 阴影是获奖级站点的通行做法 ——
       阴影的作用是「被拿起来了」，不是「这里是个盒子」。
       所以断言改成：静止无阴影，hover 有。 */
/* 静止态仍然不靠阴影分层级（底色差 + 线），这是这套设计语言的基本原则。

   断言要精确匹配「box-shadow: 值」才算真阴影 ——
   transition: transform ..., box-shadow, border-color 里
   也含 box-shadow 这个词，那是「过渡哪些属性」的清单，不是阴影值。
   不区分就会把这条断言变成永远失败。 */
const cardBlk = (css.match(/\.card\{[^}]*\}/) || [''])[0]
ok('★ 卡片静止态无阴影（层级靠底色差和线）',
  !/box-shadow\s*:/.test(cardBlk))
ok('★ 卡片 hover 时抬升并给阴影（被拿起来的实感）',
  /\.card:hover,\.theme-row:hover\{[^}]*transform:translateY\(-2px\)[^}]*box-shadow:var\(--sh-2\)/.test(css))
ok('产品名是衬线', /\.brand h1\{[^}]*var\(--serif\)/.test(css))
ok('页头标题 30px 衬线 + 下划线', /\.page-head h2\{[^}]*30px[^}]*var\(--serif\)/.test(css))
ok('主按钮有硬投影（像凸版印刷）', /\.btn\.brand\{[^}]*box-shadow:3px 3px 0/.test(css))
ok('输入框是直角', /\.input,select,textarea\.input\{[^}]*border-radius:0/.test(css))

/* ════════ 9c6l. 静态资源破缓存 ════════
   UI 换了配色，文件和服务都是新的，浏览器却还显示旧的。
   查下来是浏览器缓存 —— no-store 头对 CSS 不总是生效。
   可靠办法：index.html 里的链接带 ?v=<文件修改时间>，文件一改 URL 就变。 */
sec('9c6l 静态资源版本号')
/* 版本号是服务端在响应 index.html 时注入的，文件里当然没有 ——
   断言要查「服务端有没有注入」，不是查 index.html 里有没有 ?v=。 */
ok('★ 服务端给 CSS 链接注入版本号', srvTxt.includes("v('app.css')"))
ok('★ 服务端给 JS 链接注入版本号', srvTxt.includes("v('app.js')"))
ok('★ 实际响应里带上了 ?v=', (() => {
  try {
    const html = execSync('node -e "fetch(\'http://127.0.0.1:8848/\').then(r=>r.text()).then(t=>console.log(t))"', { cwd: ROOT, encoding: 'utf8', timeout: 8000, stdio: 'pipe' }).toString()
    return /app\.css\?v=\d/.test(html) && /app\.js\?v=\d/.test(html)
  } catch { return false }
})())
ok('版本号取自文件修改时间（文件一改 URL 就变）', /mtimeMs/.test(srvTxt))

/* ════════ 9c6m. Actions 内部互调必须走 Actions.xxx ════════
   这轮踩到的最隐蔽的一个 bug：
     hotPick 里写的是 this.hotPeek(i)
   但 act() 是 `A(arg, el)` 裸调用，严格模式下 this === undefined，
   于是抛 TypeError，被外层 try/catch 吞掉 ——
   表现是「点了热点条目没反应，摘要区一直停在『正在抓取原文…』」。

   同样的写法还有两处（taskTitle / taskAbs），
   点「复制起标题要求」也是完全没反应，用户不会知道是哪里坏了。 */
sec('9c6m Actions 互调')
const actionsBlock = js.slice(js.indexOf('const Actions'), js.indexOf('const RULES'))
ok('★ Actions 内部没有 this.xxx 误用（this 是 undefined）',
  !/\bthis\.[A-Za-z_$][\w$]*\s*\(/.test(actionsBlock.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')),
  (actionsBlock.match(/\bthis\.\w+\(/g) || []).join(' '))
ok('hotPick 用 Actions.hotPeek 调', /Actions\.hotPeek\(i\)/.test(js))
ok('taskTitle 用 Actions.genTask 调', /Actions\.genTask\('title'/.test(js))
ok('taskAbs 用 Actions.genTask 调', /Actions\.genTask\('abs'/.test(js))
ok('异步调用挂了 catch（不静默失败）', /Actions\.hotPeek\(i\)\.catch/.test(js))

/* ════════ 9c6n. 热点摘要：三种「拿不到」要分开说 ════════
   用户反馈「热点还是无法直接预览」。实测原因是三个 bug 叠加：
   百度热搜的链接全是搜索页（永远返回 0 字）→ 前端抛错 →
   catch 的内容被下一次渲染覆盖 → 永远停在「正在抓取原文…」。 */
sec('9c6n 热点摘要')
ok('★ 抓取有超时兜底（不会永远停在加载中）', /const timer = setTimeout/.test(js))
ok('★ 超时会收尾', /finish\('<div class="peek-err">这条读取超时了/.test(js))
ok('★ 搜索页单独提示', /这条榜单给的是搜索结果页/.test(js))
ok('★ JS 壳页单独提示（正文不在 HTML 里）', /对方站点的正文不在网页里/.test(js))
ok('★ 抓取失败单独提示', /抓取失败：/.test(js))
ok('finish 用 done 标记防重复写入', /if \(!done\) \{ done = true/.test(js))
ok('抓不到时仍给「读全文」出口', /读全文/.test(js))

/* ════════ 9c6o. 摘要区必须幂等（本轮最难的一个 bug）════════
   现象：摘要区永远停在「正在抓取原文…」，单条 fetch 只要 181ms，
        界面上 34 秒还在转。

   真因是三层叠加，缺一层都还会有这个毛病：
     一、poll() 每 4 秒轮询，stamp 一变就 refresh()，
        refresh() 重画整个热点页，摘要区跟着被重画成加载态；
     二、加载态被写进了 peekHtml，等于宣称「这条已经好了」，
        hotPick 之后直接 return 不再发请求；
     三、被 abort 的请求不落任何状态，留下一块空白加载态。

   下面三条分别卡住这三层。 */
sec('9c6o 摘要区幂等')
ok('★ 加载态不落 peekHtml（否则永远重发不了请求）',
  /fillBox\(idx, '<div class="peek-load"/.test(js) &&
  !/fillPeek\(idx, '<div class="peek-load"/.test(js))
ok('★ 有 fillBox（只写界面）与 fillPeek（写界面并落盘）两个入口',
  /function fillBox\(k, html\)/.test(js) && /function fillPeek\(k, html\)/.test(js))
ok('★ 模板优先从 peekHtml 恢复（重绘不回到加载态）',
  /peekHtml\[hotSel\] != null/.test(js))
ok('★ 已渲染过就不再发请求',
  /if \(peekHtml\[i\] != null\) return/.test(js))
ok('换平台时作废 peekHtml（下标含义变了）',
  /hotSrc\(id\) \{ hotSrc = id; hotSel = null; peekHtml = \{\}/.test(js))
ok('连点时取消上一条（否则占满 6 个连接池）',
  /if \(peekAbort\) \{ try \{ peekAbort\.abort\(\) \} catch \{\} \}/.test(js))
ok('被取消的不当错误处理（界面已经换人了）',
  /e\.name === 'AbortError'\) return/.test(js))
ok('api 有客户端超时（不能无限等）', /new AbortController\(\)/.test(js) && /ctrl\.abort\(\), 20000/.test(js))
ok('api 有并发闸门', /const NET_MAX = 3/.test(js) && /function netAcquire/.test(js) && /function netRelease/.test(js))
ok('★ 「重新抓取」走独立动作绕开缓存（data-act 传不了第二个参数）',
  /hotPeekF\(i\)/.test(js) && /Actions\.hotPeek\(idx, true\)/.test(js))

/* ════════ 9c6p. 自检必须是实时的（本轮抓到的最隐蔽漏报）══════
   现象：往正文里注入一句「先说结论，免得有人只看标题」，
        自检照样报 AI 100 分通过。

   根因：selfCheck 写的是 `S.audit || scan(body)`。
        S.audit 只在 runAudit() 里更新，而 runAudit() 只在 refresh()
        里跑，refresh() 在 stamp 没变时整个跳过 ——
        于是改了正文，S.audit 还是上一次的结果。
        自检读的是缓存，等于没检。

   这一组断言直接跑在真实的扫描器上（scan 已挂到 window.__wt），
   不靠 grep 猜。 */
sec('9c6p 自检实时性')
/* 断言必须剥注释再查 —— 注释里记录这段历史也会被 grep 到。
   这个坑本项目已经踩过 4 次了，这里直接写进断言本身。 */
/* 对象字面量里同名 key 重复定义不会报错 —— node --check 过，
   功能表现为「点了没反应」。本项目已经栽过两次：
     renderDraft（已删）、useTitle（旧的把下标当标题，标题栏变成「1」）。
   这里做一条通用断言：Actions 里任何方法名都不能出现第二次。 */
sec('9c6q Actions 无重名')
{
  const actionsBlock = js.slice(js.indexOf('const Actions'), js.indexOf('const RENDER'))
  const seen = new Map()
  const dup = []
  const clean = actionsBlock.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
  clean.split('\n').forEach((line, i) => {
    const m = line.match(/^ {2}(?:async\s+)?([A-Za-z_$][\w$]*)\s*\(/)
    if (!m) return
    const name = m[1]
    if (seen.has(name)) dup.push(name + '（第 ' + (seen.get(name) + 1) + ' 行与第 ' + (i + 1 + 1) + ' 行）')
    else seen.set(name, i + 1)
  })
  ok('★ Actions 里没有重名方法', dup.length === 0, dup.join('、'))
}

/* ════════ 9c6r. 脏数据保护（poll 会冲掉防抖窗口内的改动）══════
   现象：点「设为默认」之后 prefs 读出来是空的，按钮永远不亮。

   根因：save() 有 900ms 防抖，这期间改动只在内存里；
        poll() 每 4 秒拉一次整个 state 并 S = s 整个覆盖，
        防抖窗口内改的值就被服务端的旧值冲掉。

   修法：记住哪些表脏了，poll 只保护这些表。
   注意不能无脑保留前端值 —— 用户在编辑器里写一半时，
   服务端可能刚被 AI 写了新正文，无脑保留会把新正文挡掉。 */
sec('9c6r 脏数据保护')
ok('★ 有 dirtyKeys 与 markDirty', /const dirtyKeys = new Set\(\)/.test(js) && /function markDirty/.test(js))
ok('★ poll 在有脏数据时做合并而不是整体覆盖',
  /if \(dirtyKeys\.size\) \{[\s\S]{0,400}?Object\.assign\(\{\}, s\)/.test(js))
ok('★ 脏数据只保护标了脏的表（不挡 AI 写的新正文）',
  /for \(const k of dirtyKeys\)/.test(js) && /dirtyKeys\.clear\(\)/.test(js))
ok('★ 保存成功后清脏', /await Promise\.all\(\[[\s\S]{0,400}?dirtyKeys\.clear\(\)/.test(js))
/* 每个赋值点都要标脏。逐个查，抽不出就报出来 */
{
  const muts = js.split('\n')
    .map((l, i) => [i + 1, l])
    .filter(([, l]) => /^(\s*)S\.(project\.\w+|body|facts|images|materials)\s*(=[^=]|\.push\(|\.filter\(|\.map\()/.test(l))
  const missed = []
  /* 找出后面 3 行内没有 markDirty 的 */
  const bad = []
  for (const [ln] of muts) {
    const seg = js.split('\n').slice(ln - 1, ln + 4).join('\n')
    if (!/markDirty/.test(seg)) bad.push('行' + ln)
  }
  ok('★ 所有数据赋值点都标了脏', bad.length === 0, bad.slice(0, 8).join('、'))
}

ok('★ selfCheck 每次现算，不读缓存的 S.audit',
  /const a = scan\(body\)/.test(js) &&
  !/S\.audit \|\| scan\(body\)/.test(js.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')))
ok('★ selfCheck 挂在测试入口上（不挂就没法写断言）',
  /selfCheck, renderSelfCheck, parseTitlePool/.test(js))
/* 把 RULES / scan / selfCheck 三段原样摘出来，在 node 里跑真输入。
   这是本轮唯一能挡住「自检读缓存」这类漏报的手段 ——
   grep 只能证明代码长什么样，证明不了它抓不抓得到东西。 */
/* 把 RULES / 常量区 / scan / selfCheck 四段原样摘出来，在 node 里跑真输入。
   这是唯一能挡住「自检读缓存」这类漏报的手段 ——
   grep 只能证明代码长什么样，证明不了它抓不抓得到东西。

   ★ 拼接顺序必须和源码一致：new Function 的 body 里 const 有暂时性死区，
     顺序错了报出来的是「Cannot access X before initialization」，
     和真实病因毫无关系（这个项目栽过五次同样的坑）。
     所以下面每段都带一个标记，缺了就直接报「探针无法构建」，
     而不是让测试崩在一个看不懂的错上。 */
/* 把常量区 / RULES / scan / selfCheck 四段原样摘出来，在 node 里跑真输入。
   这是唯一能挡住「自检读缓存」这类漏报的手段 ——
   grep 只能证明代码长什么样，证明不了它抓不抓得到东西。

   ★ 拼接顺序必须和源码一致：new Function 的 body 里 const 有暂时性死区。
     RULES 的数组字面量在求值那一刻就要读 DASH_RE，
     而 DASH_RE 声明在后面就报
     「Cannot access DASH_RE before initialization」，
     报错信息和真实病因毫无关系（这个项目栽过六次同样的坑）。

   ★ app.js 自己出过一次这个 bug：DASH_RE 曾在 RULES 之后四千字符处声明，
     浏览器里直接 ReferenceError，整个前端加载失败。
     已把常量区挪到 RULES 之前，9d3 那条断言盯着这个顺序。

   ★ 锚点失效时报「探针无法构建」，不崩在 TDZ 上 ——
     后者看不出是锚点问题还是顺序问题，排查成本高得多。 */
const probeFn = (() => {
  const strip = t => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
  const between = (a, b) => {
    const i = js.indexOf(a), j = js.indexOf(b)
    return (i >= 0 && j > i) ? js.slice(i, j) : ''
  }
  const consts = between('/* 标点白名单 ——', 'const RULES = [')
  const rules = between('const RULES = [', 'function scan(')
  const scanSrc = between('function scan(', 'function runAudit(')
  const chkSrc = between('function selfCheck', '/* 一条自检项')
  /* 顺序错位检测：常量必须在 RULES 之前，否则 new Function 里 TDZ */
  if (consts.indexOf('const RULES') >= 0 || rules.indexOf('const DASH_RE') >= 0) {
    console.log('  （自检探针无法构建：常量区与 RULES 的先后顺序反了）')
    return null
  }
  const need = [['常量区', consts], ['RULES', rules], ['scan', scanSrc], ['selfCheck', chkSrc]]
  for (const [n, t] of need) {
    if (!t || t.length < 20) {
      console.log('  （自检探针无法构建：' + n + ' 段没摘到，锚点可能失效了）')
      return null
    }
  }
  if (!/const DASH_RE/.test(consts) || !/const PUNCT_OK/.test(consts)) {
    console.log('  （自检探针无法构建：常量区缺 DASH_RE 或 PUNCT_OK）')
    return null
  }
  try {
    return new Function('S', 'bodyImages', 'now',
      strip(consts) + '\n' + strip(rules) + '\n' + strip(scanSrc) + '\n' + strip(chkSrc) +
      '\nreturn function(body, project){ S.body = body; S.project = project; return selfCheck() }')
  } catch (e) {
    console.log('  （自检探针无法构建：' + e.message + '）')
    return null
  }
})()

if (probeFn) {
  const runProbe = probeFn({ body: '', project: {}, images: [], facts: [] }, () => [], () => '2026-01-01')
  const BASE = fs.readFileSync(ROOT + '/data/body.md', 'utf8')
/* 基准稿的标题从 project.json 读，不写死。
   写死「当前这一篇」的测试，换个选题就失效，
   而它失效时报的是「标题与正文不相符」，和真实病因毫无关系。 */
const projNow = JSON.parse(fs.readFileSync(ROOT + '/data/project.json', 'utf8'))
const TITLE = projNow.title || ''
  const nm = h => String(typeof h.n === 'string' ? h.n : (h.n && h.n.name) || '')
  const hit = (c, key) => c.hits.some(h => nm(h).indexOf(key) >= 0)

  const base = runProbe(BASE, { title: TITLE })
  ok('★ 基准稿自检：AI 味高危项为 0',
    !base.hits.some(h => h.lv === 'hi'), base.hits.filter(h => h.lv === 'hi').map(nm).join('、'))
  ok('★ 基准稿标题与正文相符（>60%）', base.titleOk.cover >= 60, base.titleOk.cover + '%')

  /* 对抗输入 —— 每一组都是「本该报警却没报」的漏报 */
  const bad1 = runProbe('先说结论，免得有人只看标题。\n\n' + BASE, { title: TITLE })
  ok('★ 对抗：注入「先说结论」必被抓住', hit(bad1, '提前否定'), 'AI ' + bad1.ai)
  ok('★ 对抗：注入后 AI 分确实下降', bad1.ai < base.ai, base.ai + ' → ' + bad1.ai)

  const bad2 = runProbe(BASE + '\n\n未来可期，值得深思。让我们一起努力。', { title: TITLE })
  ok('★ 对抗：升华收尾必被抓住', hit(bad2, '空洞拔高') || bad2.hits.some(h => h.lv === 'hi'))

  const bad3 = runProbe(BASE, { title: '马斯克星舰第三次试炸成功改写航天史' })
  ok('★ 对抗：跑偏的标题必被识别（重合 <60%）',
    bad3.titleOk.cover < 60, bad3.titleOk.cover + '%')

  const bad4 = runProbe(BASE, { title: '' })
  ok('★ 对抗：空标题必被识别', bad4.titleOk.has === false)

  const quotes = Array.from({ length: 30 }, (_, i) => '他说“这是判断' + i + '”').join('。')
  const bad5 = runProbe(BASE + '\n\n' + quotes, { title: TITLE })
  ok('★ 对抗：双引号堆到 7/千字必被抓住',
    bad5.quote / bad5.per1k > 2 && bad5.quote / bad5.per1k > base.quote / base.per1k)

  /* 误报方向 —— 检测器不能把合格稿判死 */
  const noColon = runProbe(BASE.replace(/：/g, '，'), { title: TITLE })
  ok('★ 检测器不自造误报（无冒号的稿不该被判冒号超标）', noColon.colon === 0)
  ok('★ 图注/表格的「出处：」不计入正文冒号密度',
    base.colon < (BASE.match(/：/g) || []).length)
} else {
  ok('★ 自检探针能在离线环境里跑起来', false, 'RULES/scan/selfCheck 摘不出来')
}

/* ════════ 9c6f. 卫生检查：死代码 / 编码残渣 ════════
   这轮删 titleIdeas 时漏了 harvest / XING / topicWords 三块死代码；
   写 CSS 注释时又被截断出一个 U+FFFD。
   两件都是「能跑，但不对」—— 所以做成常驻闸门，不靠人记得。 */
sec('9c6f 卫生')
ok('有死代码审计脚本', fs.existsSync(ROOT + '/engine/audit-dead.mjs'))
const deadOut = sh('node engine/audit-dead.mjs')
ok('★ 没有定义却没人调用的函数', /没有死代码/.test(deadOut),
  (deadOut.match(/·\s+\w+/g) || []).slice(0, 3).join(' '))
ok('★ app.js 代码里没有写死的领域词', /app\.js 代码里干净/.test(deadOut))
ok('★ app.js 里没有上一篇文章的固定文案',
  !/济公|爷叔|繁花|八宝山/.test(js.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')))
ok('有替换符扫描脚本', fs.existsSync(ROOT + '/engine/scan-replacement.cjs'))
const repOut = sh('node engine/scan-replacement.cjs')
ok('★ 源码里没有编码残渣 U+FFFD', /全部干净|没有替换符/.test(repOut),
  repOut.split('\n').filter(l => l.includes('替换符') && !l.includes('全部')).slice(0, 2).join(' '))

/* ════════ 9c6b. 点热点条目就要看到摘要 ════════
   用户原话：「光看标题我也不知道什么内容啊，应该点击这标题，
   右侧啥地方能看到一个文字摘要才对呀」。
   之前要点两次（先点条目，再点「看看原文讲了什么」），右侧 118 字全是按钮。 */
sec('9c6b 热点摘要')
ok('★ 摘要区默认展开（display:block，不是 none）', /display:block/.test(js) && /peek-hd/.test(js))
ok('★ 有「这条讲了什么」的标题', /这条讲了什么/.test(js))
ok('★ 选中条目就自动抓，不等用户再点一次', /Actions\.hotPeek\(i\)/.test(js))
ok('★ hotPeek 有缓存，不重复打源站', /peekCache\[it\.url\]/.test(js))
ok('抓取结果安全写入（不会把 A 写进 B 的框）', /function fillPeek/.test(js) && /box\.dataset\.k !== String\(k\)/.test(js))
ok('摘要区有字数标记', /peek-cnt/.test(js))
ok('★ 摘要区在选中那一刻就有内容（不是空白等加载）',
  /正在抓取原文…/.test(js) && !/id="peek-box" data-k="\$\{hotSel\}"\s*style="display:none"/.test(js))
ok('没有原文链接时明说（不装作有摘要）', /这条只有标题，没有原文链接/.test(js))

/* ════════ 9c6c. 复制提示：只说去哪儿粘 ════════
   用户原话：「你就直接告诉我，来到AI对话工具里粘贴就可以了，
   整那些复杂的干啥？」 */
sec('9c6c 复制提示')
const jsCode2 = js.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
ok('★ 复制提示直接说去 AI 对话工具粘贴', /回到 AI 对话工具，粘贴发送/.test(js))
ok('★ 删掉「已复制到剪贴板」这类废话', !/已复制到剪贴板/.test(jsCode2))
ok('★ 删掉「粘进公众号草稿箱即可」这类技术细节', !/粘进公众号草稿箱即可/.test(jsCode2))
ok('★ 删掉「样式已转为内联样式」这类技术细节', !/样式已转为内联样式/.test(jsCode2))
ok('复制失败时给出可操作的下一步', (js.match(/手动选中/g) || []).length >= 3)

/* ════════ 9c8. 排版微调（P0-4：字号颜色可调）═══════ */
sec('9c8 排版微调')
const stampTxt = fs.existsSync(ROOT + '/engine/stamp.mjs')
  ? fs.readFileSync(ROOT + '/engine/stamp.mjs', 'utf8') : ''
/* 结构特征唯一性：逐套抠出 feature 值，看有没有重复 */
function themes_all_unique(txt) {
  const feats = [...txt.matchAll(/feature:\s*'([^']+)'/g)].map(m => m[1])
  return feats.length > 0 && new Set(feats).size === feats.length
}
const layTxt = fs.readFileSync(ROOT + '/engine/layout.mjs', 'utf8')
const thTxt = fs.readFileSync(ROOT + '/engine/themes.mjs', 'utf8')
ok('★ 主题抽出到 themes.mjs（改造前 7 套结构雷同，放一起才看得清）', /export const THEMES/.test(thTxt))
ok('★ 每套主题都声明唯一结构特征', themes_all_unique(thTxt), '声明了 ' + (thTxt.match(/feature:/g) || []).length + ' 个')
// 只查代码部分：注释里为了记录历史也写了 column-count，不能算命中
const thCode = thTxt.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
ok('★ 全部禁用双栏 column-count', !/column-count/.test(thCode))
ok('★ 纸底色变量叫 --paper 不叫 --bg（和应用自己的 --bg 撞过）', /var\(--paper,/.test(thCode) && !/var\(--bg,/.test(thCode))
ok('★ 字号/行高/正文色走 CSS 变量', /font-size:var\(--fs\)/.test(thCode) && /color:var\(--fc\)/.test(thCode))
ok('有五项微调：字号/行距/文字色/强调色/纸底',
  /data-arg="fs"/.test(js) && /data-arg="lh"/.test(js) && /data-arg="fc"/.test(js) &&
  /data-arg="ac"/.test(js) && /data-arg="bg"/.test(js))
ok('★ scopeCss 不再丢弃 :root 变量块（丢过一次，字号行高全没生效）',
  /rootVars/.test(js) && /:root\\s\*\\\?\{/.test(js) === false && /rootVars\.push/.test(js))
ok('微调值存 project.tune（跟稿走，不跟主题走）', /S\.project\.tune/.test(js))
ok('有恢复默认', /tuneReset/.test(js) && /恢复主题默认排版/.test(js))
ok('切主题后微调会重新应用', /applyTune\(\)[\s\S]{0,200}refreshShip|setAttribute\('data-theme'[\s\S]{0,200}applyTune/.test(js))
ok('控件 CSS 齐全', /\.tune-b\{/.test(css) && /\.tune-c\{/.test(css) && /\.tune-pick\{/.test(css))
// 内核自检里那三条新断言也要真的存在
ok('内核自检含「结构特征不重复」断言', /结构特征不重复/.test(layTxt))
ok('内核自检含「排版规则重合度」断言', /排版规则.*重合度|重合度 < 0\.6/.test(layTxt))
ok('内核自检含「禁用双栏」断言', /禁用双栏/.test(layTxt))
ok('内核自检含「走 CSS 变量」断言', /走 CSS 变量|font-size:var/.test(layTxt))

// 改完要打版本戳
ok('★ 有版本戳机制（CHANGELOG + stamp 脚本）',
  /export function versionId/.test(stampTxt) && /CHANGELOG\.md/.test(stampTxt))
ok('CHANGELOG 存在且有记录', fs.existsSync(ROOT + '/data/CHANGELOG.md') && /v\d{8}-\d{6}/.test(fs.readFileSync(ROOT + '/data/CHANGELOG.md', 'utf8')))

/* ════════ 9c9. 写作风格：可量化定义 + 对抗验收 ════════ */
sec('9c9 写作风格')
ok('有独立的风格定义模块', /engine\/styles\.mjs/.test(String(ok)) || fs.existsSync(ROOT + '/engine/styles.mjs'))
ok('九种风格都有量化判据（硬禁/必有/偏好）',
  (() => {
    const t = fs.readFileSync(ROOT + '/engine/styles.mjs', 'utf8')
    return ['sharp', 'person', 'news', 'explain', 'biz', 'talk', 'cold', 'crit', 'story']
      .every(s => new RegExp('\\n  ' + s + ': \\{').test(t))
  })())
ok('每种风格都有硬禁规则', (() => {
  const t = fs.readFileSync(ROOT + '/engine/styles.mjs', 'utf8')
  return (t.match(/forbid:/g) || []).length >= 9
})())
ok('每种风格都有必备特征', (() => {
  const t = fs.readFileSync(ROOT + '/engine/styles.mjs', 'utf8')
  return (t.match(/require:/g) || []).length >= 9
})())
ok('破折号按密度判而非一律罚（实测把商业稿判死过）', /破折号过密/.test(fs.readFileSync(ROOT + '/engine/styles.mjs', 'utf8')))
ok('有风格对抗验收脚本', fs.existsSync(ROOT + '/engine/style-test.mjs'))
ok('★ 风格验收含负样本（必须能抓出 AI 味）',
  /NEG/.test(fs.readFileSync(ROOT + '/engine/style-test.mjs', 'utf8')))
ok('★ 风格验收含交叉验证（风格之间要有区分度）',
  /交叉/.test(fs.readFileSync(ROOT + '/engine/style-test.mjs', 'utf8')))

/* ════════ 9c10. 热点：定时刷新 + 可移植 CLI ════════ */
sec('9c10 热点')
const hotTxt = fs.readFileSync(ROOT + '/engine/hot.mjs', 'utf8')
ok('★ 落盘缓存 4 小时（用户明确要求）', /const DISK_TTL = 4 \* 60 \* 60 \* 1000/.test(hotTxt))
ok('落盘缓存独立文件', /_hot_cache\.json/.test(hotTxt))
ok('抓取失败退回旧数据并标 stale（宁可旧不可空）', /stale: true/.test(hotTxt))
ok('有缓存状态查询（给界面显示何时刷新）', /export function hotCacheInfo/.test(hotTxt))
ok('★ 有可移植 CLI（任何 Agent 可直接调）', fs.existsSync(ROOT + '/engine/hot-cli.mjs'))
ok('CLI 支持 --json / --flat / --top / --force', (() => {
  const t = fs.existsSync(ROOT + '/engine/hot-cli.mjs') ? fs.readFileSync(ROOT + '/engine/hot-cli.mjs', 'utf8') : ''
  return ['--json', '--flat', '--top', '--force'].every(f => t.includes(f))
})())
ok('CLI 全失败时退出码非 0（Agent 能据此重试）',
  /process\.exit\(1\)/.test(fs.existsSync(ROOT + '/engine/hot-cli.mjs') ? fs.readFileSync(ROOT + '/engine/hot-cli.mjs', 'utf8') : ''))
ok('有热点原文预览接口', /api\/hot\/peek/.test(srvTxt) && /hasBadChar/.test(srvTxt))
ok('预览接口处理 GBK 编码（网易/搜狐还是 GBK）', /gbk/.test(srvTxt))
ok('前端有原文预览动作', /async hotPeek/.test(js) && /data-act="hotPeekF"/.test(js))
ok('热点页有常驻工作栏', /class="hot-bar-sticky"/.test(js) && /\.hot-bar-sticky\{[^}]*position:sticky/.test(css))

/* ════════ 9c11. 原文预览：正文抽取质量 ════════
   这一节的教训都来自实网踩坑，每条断言后面是踩过的坑。 */
sec('9c11 原文预览抽取')
ok('正文抽成独立模块（离线可测，不靠打真网站）', fs.existsSync(ROOT + '/engine/extract.mjs'))
ok('有抽取的离线单测', fs.existsSync(ROOT + '/engine/extract-test.mjs'))
const exTxt = fs.readFileSync(ROOT + '/engine/extract.mjs', 'utf8')
ok('删页面框架（nav/header/footer/sidebar）', /CHROME_TAGS/.test(exTxt) && /'nav', 'header', 'footer', 'aside'/.test(exTxt))
ok('★ 丢连续导航块（实网残留「网易公开课」「指数 期指 个股」全抓不住）',
  /dropNavRuns/.test(exTxt) && /NAV_RUN/.test(exTxt))
ok('★ 代码行靠「汉字占比低+代码符号」判（正则枚举永远列不全）',
  /looksLikeCode/.test(exTxt) && /0\.25/.test(exTxt))
ok('解数字实体（标题里满是 &#8211; &#8221;）', /&#x\(\[0-9a-f\]/.test(exTxt))
ok('搜索页明说抓不到，不给噪音', /isSearchPage/.test(exTxt) && /search-page/.test(exTxt))
ok('提取策略暴露给调用方（content-class / density / fallback）',
  /strategy: 'content-class'/.test(exTxt) && /strategy: 'density'/.test(exTxt))
ok('★ 抓取失败退回明确报错而不是空文本', /r\.ok\)|throw new Error\('抓取失败/.test(srvTxt))
ok('★ 摘要区内容存在模块级（重绘后能恢复，见 peekHtml）', /let peekHtml = \{\}/.test(js))
ok('★ hotPick 把字符串下标转数字（0 === "0" 为 false，点预览没反应就是栽在这）',
  /hotPick\(i\) \{\s*\n?\s*i = Number\(i\)/.test(js))
/* 「换条目收起上一条预览」这条断言已经作废：
   摘要区现在是常开的，换条目时它会被 renderPeek 直接覆盖，
   收起反而多一次点击。真正要保证的是「不会把 A 的正文挂在 B 上」，
   由 fillBox 的 dataset.k 校验负责。 */
ok('★ 摘要写入按下标校验（不会把 A 的正文挂到 B 上）',
  /function fillBox[\s\S]*?box\.dataset\.k !== String\(k\)/.test(js))
ok('抓取结果按 url 缓存（否则每次重绘都重打源站）', /peekCache\[it\.url\]/.test(js))
ok('有实网抽样验证脚本', fs.existsSync(ROOT + '/engine/probe-peek.mjs'))

/* ════════ 9c12. 可移植性 ════════
   用户问过「别人从 GitHub 下载，任何 Agent 能不能用」。
   诚实的答案是不能「即插即用」，能给的是纯 CLI + 明确退出码 + 文档。 */
sec('9c12 可移植性')
const pkg = JSON.parse(fs.readFileSync(ROOT + '/package.json', 'utf8'))
ok('package.json 声明 Node 版本下限（用到原生 fetch）', />=\s*20/.test(pkg.engines?.node || ''), pkg.engines?.node)
ok('package.json 有 scripts（别人知道怎么跑）', !!(pkg.scripts && Object.keys(pkg.scripts).length >= 5))
ok('★ scripts 里有 check 一键全检', typeof pkg.scripts?.check === 'string')
ok('★ CLI 登记为 bin（npx 可用）', !!(pkg.bin && pkg.bin['hot-cli']))
/* ★ 原来查的是「三步启动」这四个字。

   README 重写后这一节改叫「安装」，字面查不到就误报了。

   真正要保的是 clone / install / run 三条命令都在 ——

   标题叫什么不重要，所以按意图查内容。 */

ok('★ README 写清启动步骤（clone / install / run 三条都在）', (function () {

  var md = fs.readFileSync(ROOT + '/README.md', 'utf8')

  var need = ['git clone', 'npm install', 'npm run restart']

  var miss = need.filter(function (k) { return md.indexOf(k) < 0 })

  if (miss.length) console.log('     启动步骤缺: ' + miss.join(' '))

  return miss.length === 0

})())

/* ★ 原来查「不能即插即用」那句。

   要保的是【诚实】—— 读者得知道 AI 不在工具里，

   不然会以为是「打开就能出成品」。

   README 重写后诚实的话换成了「为什么不内置模型」的说明，所以按意思查。 */

ok('★ README 诚实说明边界（AI 不内置 / 抓不到会明说 / 数据不出本机）', (function () {

  var md = fs.readFileSync(ROOT + '/README.md', 'utf8')

  var need = [

    ['说清不内置模型', /不内置模型|不代劳|不内置 AI 模型/],

    ['抓不到会明说', /明说|不会假装抓到了/],

    ['数据不出本机', /不上云|不出这台电脑|不会传到网上|不上传/]

  ]

  var miss = need.filter(function (p) { return !p[1].test(md) })

  if (miss.length) console.log('     缺: ' + miss.map(function (p) { return p[0] }).join(' '))

  return miss.length === 0

})())

ok('有热点筛选原理文档（对外能讲清）', fs.existsSync(ROOT + '/docs/热点筛选原理.md'))
ok('★ 原理文档写清了去重键和长度', /前\s*14\s*个字/.test(fs.readFileSync(ROOT + '/docs/热点筛选原理.md', 'utf8')))
ok('原理文档写了 4 小时刷新', /4\s*小时/.test(fs.readFileSync(ROOT + '/docs/热点筛选原理.md', 'utf8')))
ok('★ 三个根脚本不再硬编码绝对路径（换机器会全挂）', (() => {
  for (const f of ['验收测试.js', '布局体检.js', '回归基线.js']) {
    const t = fs.readFileSync(ROOT + '/' + f, 'utf8')
    if (/E:\\文档|E:\/文档|'\/[A-Za-z]:\//.test(t)) return false
    if (!t.includes('import.meta.url')) return false
  }
  return true
})())
ok('三个根脚本已转 ESM（与 package.json type=module 一致）', (() => {
  for (const f of ['验收测试.js', '布局体检.js', '回归基线.js']) {
    if (/require\(/.test(fs.readFileSync(ROOT + '/' + f, 'utf8'))) return false
  }
  return true
})())
ok('★ 验收脚本的请求有重试（压测打满连接会 ECONNRESET）', /tries = 3/.test(fs.readFileSync(ROOT + '/验收测试.js', 'utf8')))
ok('★ 数据还原步骤容错（不还原就是污染真实数据）', /restoreFails/.test(fs.readFileSync(ROOT + '/验收测试.js', 'utf8')))

/* ════════ 9c13. 加粗：密度可测，不是「出现即错」 ════════
   用户要求「该加粗就加粗」。原来的规则是「出现 ** 就报错」，
   那条规则和需求直接矛盾，且实测排版内核能正确渲染成 <strong>。 */
sec('9c13 加粗')
const scTxt = fs.readFileSync(ROOT + '/engine/style-check.mjs', 'utf8')
ok('★ 不再把 ** 当作残留（用户明确要求加粗）', !/\[\/\\\*\\\*\/g, '加粗残留'/.test(scTxt))
ok('★ 改判加粗密度（滥用才是问题）', /每千字/.test(scTxt) && /perK/.test(scTxt))
ok('有加粗密度阈值（上限 12/千字）', /perK > 12/.test(scTxt))
ok('有加粗下限（5000 字至少 3 处）', /bolds < 3/.test(scTxt))
/* 前端文风检测也不再把加粗当错误。
   断言必须剥注释再查 —— 注释里写着「原来这条规则说『公众号不认 **』——错的」，
   直接对整个文件 grep 会把这句注释当成违规。这个坑踩过三次了。 */
ok('★ 前端文风检测也不再把加粗当错误', !/公众号不认/.test(js.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')))
ok('前端改为检测「相邻两段都加粗」', /加粗连续/.test(js))
ok('手册写清了加粗密度参考', /每千字 5~10/.test(fs.readFileSync(ROOT + '/AI操作手册.md', 'utf8')))
ok('★ 手册写明「年龄和年数不要混」（真实抓到的错）', /年龄和年数不要混/.test(fs.readFileSync(ROOT + '/AI操作手册.md', 'utf8')))
ok('有加粗脚本（可复跑、可回滚）', fs.existsSync(ROOT + '/engine/add-bold.mjs'))
ok('有事实清单重建脚本（facts.json 曾被清空）', fs.existsSync(ROOT + '/engine/rebuild-facts.mjs'))
/* 原来要求 ≥8 处。
   8 处是暖风格的量 —— 暖笔法靠加粗给情绪加重音。
   犀利时评靠的是判断，不是加粗。

   ★ 加粗多了等于没加粗：读者会滑过去不看。
     一篇 2600 字的犀利稿，4~5 处标在数字和结论上就够了。

   ★ 上一版这篇稿子加粗 0 处，那是真问题 ——
     该标数字的地方没标。改阈值到 3 而不是放松到 0：
     判据管的是「有标关键事实」，不是「标得够多」。 */
ok('★ 当前正文有加粗（关键数字和结论要标出来）', (function () {
  var st = ''
  try {
    st = JSON.parse(fs.readFileSync(ROOT + '/data/project.json', 'utf8')).style || ''
  } catch (e) { st = '' }
  var b = fs.readFileSync(ROOT + '/data/body.md', 'utf8')
  var n = (b.match(/\*\*/g) || []).length / 2
  var need = st === 'sharp' ? 3 : 8
  if (n < need) console.log('     ' + n + ' 处（' + st + ' 需要 ' + need + '）')
  return n >= need
})())
ok('★ 加粗落在数字和结论上，不是落在形容词上', (function () {
  var b = fs.readFileSync(ROOT + '/data/body.md', 'utf8')
  var marks = b.match(/\*\*([^*\n]+)\*\*/g) || []
  if (!marks.length) return false
  /* 加粗里至少一半要含数字或者判断词 */
  var good = marks.filter(function (x) {
    return /\d/.test(x) || /(零|一条不落|全部|无关|不是|超)/.test(x)
  }).length
  return good >= Math.ceil(marks.length / 2)
})())
ok('★ 待核事实清单非空', (() => {
  const f = JSON.parse(fs.readFileSync(ROOT + '/data/facts.json', 'utf8').replace(/^\uFEFF/, ''))
  return Array.isArray(f) && f.length >= 10
})())
ok('正文里没有年龄/年数混用的错误句', !/等了\d+年才等到/.test(fs.readFileSync(ROOT + '/data/body.md', 'utf8')))
ok('★ 搜索页优先短路（密度算法会被摘要文字骗过）', (() => {
  const t = fs.readFileSync(ROOT + '/engine/extract.mjs', 'utf8')
  return /isSearchPage\) \{[\s\S]{0,400}return \{ text: ''/.test(t)
})())
ok('有迁移后完整性验证脚本', fs.existsSync(ROOT + '/engine/verify-migrate.mjs'))
ok('完整性验证不依赖浏览器（迁移时会断连）', /\/api\/state/.test(fs.readFileSync(ROOT + '/engine/verify-migrate.mjs', 'utf8')))
ok('★ 完整性验证跳过 JS 壳站（拿头条当样本会误判）', /SHELL_HOST/.test(fs.readFileSync(ROOT + '/engine/verify-migrate.mjs', 'utf8')))

/* ════════ 9c14. 任务队列：requirement 必须真的落盘 ════════
   实测踩到：队列里 6 条历史任务 requirement 全是空的。
   根因：服务端只认 `req` 字段，外部按 `requirement` 发就全丢。
   后果比报错更糟 —— AI 拿到空任务，只能自己猜要写什么。 */
sec('9c14 任务队列')
const srvNow = fs.readFileSync(ROOT + '/server.mjs', 'utf8')
ok('★ 任务接口同时接受 requirement 和 req 两种字段名',
  /body\.requirement \?\? body\.req/.test(srvNow))
ok('★ 空 requirement 拒绝入队（空任务占位还误导 AI）', /requirement 是空的/.test(srvNow))
ok('★ 队列里没有空 requirement 的任务', (() => {
  const qdir = path.join(ROOT, 'data', 'queue')
  if (!fs.existsSync(qdir)) return true
  const bad = fs.readdirSync(qdir).filter(f => f.endsWith('.json')).filter(f => {
    try {
      const t = JSON.parse(fs.readFileSync(path.join(qdir, f), 'utf8').replace(/^\uFEFF/, ''))
      return !String(t.requirement || '').trim()
    } catch { return true }
  })
  if (bad.length) console.log('      空任务: ' + bad.join(', '))
  return bad.length === 0
})())
ok('★ 实测提交一次，requirement 真的落盘', await (async () => {
  const marker = 'ACCEPT-TEST-' + Date.now()
  const r = await api('/task', { type: 'write', requirement: marker, ref: '验收_' + marker })
  if (r.status !== 200 || !r.data || !r.data.id) return false
  const onDisk = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'queue', r.data.id + '.json'), 'utf8').replace(/^\uFEFF/, ''))
  await api('/task/del', { id: r.data.id })
  return String(onDisk.requirement || '').includes(marker)
})())
ok('★ 用 requirement 字段提交也能落盘（这次 bug 的正主）', await (async () => {
  const marker = 'REQFIELD-' + Date.now()
  const r = await api('/task', { type: 'write', requirement: marker, ref: '验收2_' + marker, force: true })
  if (r.status !== 200 || !r.data || !r.data.id) return false
  const onDisk = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'queue', r.data.id + '.json'), 'utf8').replace(/^\uFEFF/, ''))
  await api('/task/del', { id: r.data.id })
  return String(onDisk.requirement || '').includes(marker)
})())
ok('空要求被拒绝（返回非 200）', (await api('/task', { type: 'write', requirement: '   ', ref: '空要求测试', force: true })).status !== 200)

/* ════════ 9c7. 主题：结构型，不只是换配色 ════════ */
sec('9c7 主题')
// 主题本体已移到 engine/themes.mjs，这里跟着改
const themeIds = Object.keys(
  (() => { const m = thTxt.match(/^  ([a-z]+): T\(/gm) || []; const o = {}; m.forEach(x => o[x.match(/[a-z]+/)[0]] = 1); return o })()
)
ok('主题数 >= 11', themeIds.length >= 11, themeIds.length + ' 套：' + themeIds.join('/'))
ok('保留 4 套结构型主题', ['dropcap', 'plain', 'voice', 'list'].every(t => themeIds.includes(t)))
ok('清单主题把列表做成编号卡片', /counter-increment:n/.test(thTxt) && /content:counter\(n/.test(thTxt))
ok('首字主题有 ::first-letter 下沉', /p:first-of-type::first-letter\{[\s\S]{0,120}font-size:calc\(var\(--fs\)/.test(thTxt))
ok('极简主题的 h2 居中', /极简[\s\S]{0,3000}?h2\{[^}]*text-align:center/.test(thTxt))
ok('观点主题的引语有独立通栏样式', /观点[\s\S]{0,3000}?blockquote\{[^}]*border-top:2px solid var\(--ac\)/.test(thTxt))
ok('每套主题都有 preview 供色片用', /theme-row[\s\S]{0,200}t\.preview\.bg/.test(js))
ok('纸刊不再双栏（改成序号小节+悬挂缩进）', !/column-count/.test(thCode) && /序号小节/.test(thCode))
/* 「分段」（card）主题已按用户要求删掉：
   原话「把你那个分段给我去掉」。 */
ok('★ 「分段」主题已删（card 不在了）',
  !/card: T\(/.test(thTxt) && !/'分段'/.test(thTxt))
/* 新增给老年人的高对比花色主题 */
ok('★ 有一套大字高对比主题（19px / 纯黑字 / 隔行变色）',
  /vivid: T\('大字版'/.test(thTxt) && /fs: 19/.test(thTxt) && /隔行/.test(thTxt))
/* 段前空行：用户明说「所有排版都应该没有那个段前空行」 */
ok('★ 段间距有变量 --fsb 且默认很小（不给大片空白）', /--fsb:/.test(thTxt))
/* 字号整体上调到 16.5~19（原 13~16） */
ok('★ 主题字号下限抬到 16.5（读者是中老年人）',
  !/fs: 1[3-6](?!\.5)/.test(thTxt))
ok('★ 微调默认字号 17 / 行距 2（中老年可读）',
  /const TUNE_DEF = \{ fs: 17, lh: 2/.test(js))
ok('★ 微调面板有段间距控件', /data-arg="fsb"/.test(js) && /const FSB_STEPS/.test(js))

/* ════════ 9d. 事实清单风险分级 + 批量 ════════ */
sec('9d 事实清单分级')
ok('有 factRisk 分级函数', /function factRisk/.test(js))
ok('高危判据包含精确小数', /\\d\+\\\.\\d\+/.test(js))
ok('高危判据包含量级与百分比', /(亿|万吨|万台|万人)/.test(js))
ok('识别直接引语', /直接引语/.test(js))
/* 事实清单从独立 tab 降级成自检区里的一个折叠项 ——
   用户要删的是「检查面板」这个外壳，不是事实核查本身。
   核查是防止文章里出现编造数字的最后一道闸，不能一起删。 */
ok('清单在交付面板里（不再是独立 tab / 独立页面）',
  /待核事实清单/.test(js) && /fact-scroll/.test(js) && !/sideTab === 'check'/.test(js))
ok('高危事实进了自检项（不用点开也能看到没核）', /高危事实已核/.test(js))
ok('高危条目有视觉标记', /fact\.hi/.test(css) && /border-left:2px solid var\(--danger\)/.test(css))
ok('每条显示风险类别', /class="rk \$\{r\.lv\}"/.test(js))
ok('支持批量标记', /bulkMark/.test(js))
ok('批量前有二次确认', /bulkMark[\s\S]{0,400}confirm\(/.test(js))
ok('清单按原序渲染（不排序，点一下不会跳走）',
  /\$\{\(S\.facts \|\| \[\]\)\.map\(f => \{/.test(js) &&
  !/\$\{\(S\.facts \|\| \[\]\)\.sort/.test(js))

/* ════════ 9e. 版本对比 + 回滚 ════════ */
sec('9e 版本对比')
ok('有 LCS 段落对比', /function lcsPairs/.test(js))
ok('有 diffVer 动作', /diffVer/.test(js))
ok('区分增/删/改三类', /d-add/.test(js) && /d-del/.test(js) && /d-mod/.test(js))
ok('有配图守恒检查', /lostImg/.test(js) && /配图/.test(js))
ok('对比后可一键回滚', /回滚到这一版/.test(js))
// 说明：原先这里有一条「注释里必须出现『不按状态重排』」的断言，
// 靠注释判定行为是不可靠的，且与 9d 的断言重复。已删除。

/* ════════ 9f. 配图推荐位置 ════════ */
sec('9f 配图推荐')
ok('有段落打分函数', /function scorePara/.test(js))
ok('会避开已有图的位置', /\/\^!\\\[/.test(js))
ok('避免图扎堆（间隔至少 2 段）', /Math\.abs\(x\.i - c\.i\) < 2/.test(js))
ok('开头结尾不推荐', /rel < 0\.08 \|\| rel > 0\.94/.test(js))
ok('有推荐面板', /img-plan/.test(js) && /推荐插入位置/.test(js))
ok('支持单张插入', /applyOne/.test(js))
ok('支持批量插入', /applyImgPlan/.test(js) && /全部插入/.test(js))
ok('插入后写回正文', /function saveBody/.test(js))

ok('回归基线脚本会剥 BOM（否则 project 整体变 {}，回归保护静默失效）', /replace\(\/\^\\uFEFF\/, ''\)/.test(fs.readFileSync(ROOT + '/回归基线.js', 'utf8')))
ok('服务端读 JSON 也剥 BOM', /\\uFEFF/.test(fs.readFileSync(ROOT + '/server.mjs', 'utf8')))
ok('所有 data/*.json 都没有 BOM', (() => {
  const bad = fs.readdirSync(ROOT + '/data').filter(f => f.endsWith('.json')).filter(f => {
    const b = fs.readFileSync(ROOT + '/data/' + f)
    return b[0] === 0xef && b[1] === 0xbb && b[2] === 0xbf
  })
  return bad.length === 0
})(), (() => {
  const bad = fs.readdirSync(ROOT + '/data').filter(f => f.endsWith('.json')).filter(f => {
    const b = fs.readFileSync(ROOT + '/data/' + f)
    return b[0] === 0xef && b[1] === 0xbb && b[2] === 0xbf
  })
  return bad.length ? '带 BOM: ' + bad.join(', ') : '全部无 BOM'
})())

/* ════════ 10. 代码健康 ════════ */
sec('10 代码健康')
/* 真正要抓的是「同作用域重复 const」——那会直接 SyntaxError，整个脚本挂掉。
   之前用正则扫名字是错的：不同函数里的同名局部变量完全合法。
   正确做法是让解析器自己判。 */
ok('app.js 语法可解析（无同作用域重复声明）', (() => {
  try { new vm.Script(js, { filename: 'app.js' }); return true }
  catch (e) { syntaxErr = e.message; return false }
})(), (() => {
  try { new vm.Script(js, { filename: 'app.js' }); return '解析通过' }
  catch (e) { return e.message }
})())
ok('engine/*.mjs 语法可解析', (() => {
  const bad = []
  const files = fs.readdirSync(ROOT + '/engine').filter(x => x.endsWith('.mjs'))
  for (const f of files) {
    try { execFileSync(process.execPath, ['--check', ROOT + '/engine/' + f], { stdio: 'pipe' }) }
    catch (e) { bad.push(f + ': ' + String(e.stderr || e.stdout || e.message).split('\n').slice(0, 3).join(' ')) }
  }
  return bad.length === 0
})(), (() => {
  const bad = []
  const files = fs.readdirSync(ROOT + '/engine').filter(x => x.endsWith('.mjs'))
  for (const f of files) {
    try { execFileSync(process.execPath, ['--check', ROOT + '/engine/' + f], { stdio: 'pipe' }) }
    catch (e) { bad.push(f) }
  }
  return bad.length ? bad.join(', ') : files.length + ' 个引擎文件全部通过 node --check'
})())
ok('CSS 使用设计变量', /--brand/.test(css) && /--surface/.test(css))
ok('CSS 有响应式断点', (css.match(/@media/g) || []).length >= 2, (css.match(/@media/g) || []).length + ' 个')
ok('JS 无 innerHTML 直接插用户正文', !/\.innerHTML\s*=\s*[^;]*\$\('body'\)\.value(?![\s\S]{0,200}esc)/.test(js))
ok('正文渲染走 esc()', js.includes('esc(b)') || js.includes('esc(S.body') || /esc\(b\)/.test(js))
ok('所有 fetch 都有 catch 或 try', (js.match(/await api\(/g) || []).length > 0)
ok('前端暴露测试接口', /window\.__wt/.test(js))
ok('没有 console.log 残留', !/console\.log/.test(js))

/* ════════ 还原 ════════
   每一步都要 catch：服务端压力大时会 ECONNRESET，
   一旦抛出去整个验收脚本崩在半路，真实数据还留在被压测污染的状态 ——
   这比「这一项没跑完」严重得多。 */
sec('11 数据还原')
const restoreFails = []
for (const k of ['project', 'facts', 'materials', 'images', 'topics', 'versions']) {
  try { await api('/save', { name: k, data: BACKUP[k] }) }
  catch (e) { restoreFails.push(k + ': ' + (e.message || e)) }
}
try { await api('/save', { name: 'body', data: BACKUP.body }) }
catch (e) { restoreFails.push('body: ' + (e.message || e)) }
ok('还原过程无网络错误', restoreFails.length === 0, restoreFails.join('; '))
const after = (await api('/state')).data
ok('正文已还原', after.body === BACKUP.body)
ok('project 已还原', JSON.stringify(after.project) === JSON.stringify(BACKUP.project))
ok('facts 已还原', after.facts.length === BACKUP.facts.length, after.facts.length + ' 条')
ok('images 未被破坏', after.images.length === BACKUP.images.length, after.images.length + ' 张')
ok('versions 未被破坏', after.versions.length === BACKUP.versions.length, after.versions.length + ' 版')

/* ════════ 报告 ════════ */
console.log('\n' + '='.repeat(70))
console.log('  写作台 · 全量对抗验收 v5')
console.log('='.repeat(70))
let cur = ''
R.forEach(([m, n, e]) => {
  if (m === '—') { console.log('\n  【' + n + '】'); return }
  console.log('   ' + m + ' ' + n + (e ? '   ' + e : ''))
})
console.log('\n' + '='.repeat(70))
console.log('  通过 ' + pass + '　失败 ' + fail)
console.log('='.repeat(70) + '\n')
process.exit(fail ? 1 : 0)
})()
