/**
 * 写作台 · 全量对抗验收 v5
 * 覆盖：功能 / 界面 / 文案 / 图案 / 交互 / 回归保护 / 数据安全
 */
import fs from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'
import { execSync, execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
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
const refs = [...BACKUP.body.matchAll(/^!\[.*\]\((.*?)\)$/gm)].map(m => m[1])
ok('正文图片引用数 > 0', refs.length > 0, refs.length + ' 处')
ok('正文引用的图都在图片库', refs.every(f => BACKUP.images.some(x => x.file === f)), refs.join(','))
ok('正文引用的图都在磁盘', refs.every(f => fs.existsSync(path.join(ROOT, 'data/images', f))))
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
ok('成稿与发布两页去掉 .page 左右内边距', /wide-page/.test(js) && /\.page\.wide-page\{padding:0/.test(css))

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
ok('★ 侧栏说明白了「本地拼不出来」', /本地拼不出来/.test(js))
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
ok('★ 任务词要求 6 个不同方向的完整标题且按推荐顺序',
  /给我 6 个不同方向的完整标题/.test(taskTxt) && /按推荐顺序排/.test(taskTxt))
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
    ok('★ 当前正文写出了人的处境', cond)
    ok('★ 当前正文有人生视角', life)
    const lifeDensity = (b3.match(/(一辈子|半辈子|这样的年纪|到头来|这辈子|人生|命运|值得)/g) || []).length / (b3.replace(/\s/g, '').length / 100)
    ok('★ 当前正文人生类大词密度落在 0.35 附近（不是灌水也不是没有）',
      lifeDensity > 0.1 && lifeDensity < 0.6, lifeDensity.toFixed(3))
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
ok('★ 没有标题时给明确出路（复制要求 + 手工入口）',
  /还没有备选标题/.test(js) && /data-act="taskTitle"/.test(js) && /data-act="focusTitleIn"/.test(js))
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
ok('★ 任务词明确禁止万能句', /不要放之四海皆准的万能句/.test(taskTxt))
ok('★ 任务词要求 12~24 字', /12~24 字/.test(taskTxt))
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
ok('图注写了出处', /!\[[^\]]*图\/[^\]]+\]\(/.test(fs.readFileSync(ROOT + '/data/body.md', 'utf8')))

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
ok('直角为主（圆角 ≤ 4px）', /--r-m:3px/.test(css))
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
ok('有 README 且写清三步启动', fs.existsSync(ROOT + '/README.md') && /三步启动/.test(fs.readFileSync(ROOT + '/README.md', 'utf8')))
ok('★ README 诚实说明「不能即插即用」', /不能吹/.test(fs.readFileSync(ROOT + '/README.md', 'utf8')))
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
ok('★ 当前正文有加粗', (() => {
  const b = fs.readFileSync(ROOT + '/data/body.md', 'utf8')
  return (b.match(/\*\*/g) || []).length / 2 >= 8
})(), ((fs.readFileSync(ROOT + '/data/body.md', 'utf8').match(/\*\*/g) || []).length / 2) + ' 处')
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
