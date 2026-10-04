/* UI 几何检查 —— 拿真实矩形算遮挡和挤压。
 *
 * ★ 为什么单独一个文件：
 *   验收测试.js 跑在 node 里，拿不到 getBoundingClientRect。
 *   而「挡没挡」「挤没挤」这两件事，
 *   光看 CSS 源码是看不出来的 ——
 *   height:32px 写在源码里看着挺正常，
 *   实际渲染出来两行文字就叠在一起。
 *
 *   这个项目栽过的最贵一次就是这个：
 *   我验了「四个导航项都在」「点得动」「宽度够」，
 *   全部通过，用户说「都互相遮挡和重合」。
 *   少的那一条就是「拿矩形算一算」。
 *
 * 跑法：node engine/ui-check.mjs
 * 前置：写作台服务已在 8848 起着。
 *
 * 它做什么：
 *   一 侧栏四步 —— 项高够不够装两行、行间距是不是负的、项间有没有叠
 *   二 逐页扫 —— 同一列的兄弟元素有没有互相遮挡
 *   三 文字有没有被压到 0 高（grid 隐式行塌缩就是这么查出来的）
 */
import fs from 'fs'
const BASE = 'http://127.0.0.1:8848'

/* ★ new URL('..', import.meta.url).pathname 在 Windows 上不能用。
     pathname 是百分号编码的，中文目录会变成
       E:\Codex\Opencode\%E5%86%99%E4%BD%9C%E5%8F%B0\
     writeFileSync 拿着这个路径就 ENOENT。
     必须用 fileURLToPath，它会做 unescape。 */
import { fileURLToPath } from 'url'
import path from 'path'
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

/* 这里不引浏览器 SDK —— 用原生 fetch 拉页面，
   页面逻辑要真跑起来才有矩形，所以走的是「打开页面 + 执行脚本」的路。
   但 node 里没有 DOM，所以真正的计算必须放在浏览器上下文里。

   ★ 权衡：
     方案一 用 puppeteer 之类 → 多一个依赖，这个项目刻意不装
     方案二 把 CSS 里的关键数值算一遍 → 算不出真实布局
     方案三 生成一个自检页，让浏览器自己算，结果写进 DOM，
             node 用 fetch 读回来 → 零依赖，且是真实布局

   选方案三。 */

const PROBE = `/* 由 engine/ui-check.mjs 生成，不要手改 */
window.__ui = (function () {
  function overlap(a, b) {
    return !(a.right <= b.left || b.right <= a.left ||
             a.bottom <= b.top || b.bottom <= a.top)
  }
  var out = { side: [], collide: [], zero: [] }

  /* 一 侧栏四步 */
  var ns = document.querySelectorAll('.side .nav')
  var boxes = []
  for (var i = 0; i < ns.length; i++) {
    var n = ns[i]
    var r = n.getBoundingClientRect()
    var tx = n.querySelector('.tx') && n.querySelector('.tx').getBoundingClientRect()
    var ds = n.querySelector('.ds') && n.querySelector('.ds').getBoundingClientRect()
    var st = n.querySelector('.st') && n.querySelector('.st').getBoundingClientRect()
    out.side.push({
      h: Math.round(r.height),
      top: Math.round(r.top),
      bottom: Math.round(r.bottom),
      stH: st ? Math.round(st.height) : 0,
      txH: tx ? Math.round(tx.height) : 0,
      dsH: ds ? Math.round(ds.height) : 0,
      lineGap: (tx && ds) ? Math.round(ds.top - tx.bottom) : 0,
      need: (tx ? tx.height : 0) + (ds ? ds.height : 0) +
            parseFloat(getComputedStyle(n).paddingTop) * 2 + 2
    })
    boxes.push(r)
  }
  for (var j = 1; j < boxes.length; j++) {
    var g = Math.round(boxes[j].top - boxes[j - 1].bottom)
    out.side[j].gap = g
    if (g < 0) out.collide.push('侧栏第' + j + '项与第' + (j + 1) + '项重叠 ' + (-g) + 'px')
  }

  /* 二 逐页：同列兄弟元素遮挡 */
  function scan(sel, page) {
    var root = document.querySelector(sel)
    if (!root) return
    var kids = []
    for (var i = 0; i < root.children.length; i++) {
      var e = root.children[i]
      var r = e.getBoundingClientRect()
      if (r.width > 1 && r.height > 1) kids.push({ e: e, r: r })
    }
    for (var a = 0; a < kids.length; a++) {
      for (var b = a + 1; b < kids.length; b++) {
        var ra = kids[a].r, rb = kids[b].r
        /* 只查同一列的（左边差不多齐），
           横向并列的两个块贴在一起不算遮挡 */
        if (Math.abs(ra.left - rb.left) < 4 && overlap(ra, rb)) {
          var ov = Math.min(ra.bottom, rb.bottom) - Math.max(ra.top, rb.top)
          out.collide.push(page + ' ' + sel + ' 第' + (a + 1) + '与第' + (b + 1) +
            '块重叠 ' + Math.round(ov) + 'px')
        }
      }
    }
  }

  /* 三 文字被压到 0 高 —— grid 隐式行塌缩就是这么查出来的 */
  function zeroH(page) {
    document.querySelectorAll('.page *').forEach(function (e) {
      var r = e.getBoundingClientRect()
      var cs = getComputedStyle(e)
      /* 只看有文字的，且父级没把它藏掉 */
      if (!e.textContent.trim()) return
      if (cs.overflow !== 'visible') return
      if (r.width > 0 && r.height < 1) {
        out.zero.push(page + ' ' + (e.className || e.tagName) + ' 高 ' + r.height)
      }
    })
  }

  var api = window.__wt
  if (!api) return { err: 'window.__wt 不在，页面没起来' }
  ;['hot', 'idea', 'write', 'ship'].forEach(function (pg) {
    api.go(pg)
    ;['.page', '.hot-grid', '.write-grid', '.ship-wrap', '.brief',
      '.self-chk', '.deliver', '.tp-list'].forEach(function (s) { scan(s, pg) })
    zeroH(pg)
  })
  api.go('write')
  return out
})()
`

/* ── 生成自检脚本 ──
   ★ 放项目根，不放 data/。
     server.mjs 的静态路由是 path.join(ROOT, rel)，
     ROOT 是项目目录，所以 /ui-probe.js 对应 <项目根>/ui-probe.js。
     放 data/ 的话路由拼出来是 <项目根>/ui-probe.js，
     实际文件却在 <项目根>/data/ui-probe.js —— 404。

     ★ 这个坑的特点：不报错，只说「取不到」，
       很自然会怀疑是服务没起，其实路由和文件位置对不上。 */
const probePath = ROOT + '/ui-probe.js'
fs.writeFileSync(probePath, PROBE)

/* ── 检查服务端能不能拿到这个文件 ── */
const res = await fetch(BASE + '/ui-probe.js').catch(e => ({ ok: false, status: String(e) }))
if (!res.ok) {
  console.log('取不到 ' + BASE + '/ui-probe.js （HTTP ' + res.status + '）')
  console.log('先跑 node engine\\restart.mjs，再跑这个脚本')
  /* ★ 用 exitCode 不用 process.exit。
       顶层 await 之后调 process.exit(1)，
       fetch 的 socket 还在关闭流程里，会撞
       Assertion failed: !(handle->flags & UV_HANDLE_CLOSING)
       —— 那是退出方式的问题，不是网络的问题，
       报错信息完全指不到真正的原因上。 */
  process.exitCode = 1
}

const body = res.ok ? await res.text() : ''
if (!res.ok) {
  console.log('')
} else {

/* 浏览器里跑完把结果写进 DOM，node 这边读。
   这一步需要真实浏览器，所以脚本给的是「可直接贴进控制台」的版本，
   同时本地也做一份纯静态的估算，保证没浏览器时还能报个大概。 */
console.log('═'.repeat(64))
console.log(' UI 几何检查')
console.log('═'.repeat(64))
console.log('')
console.log('自检脚本已写到 ' + probePath)
console.log('')
console.log('★ 这一步必须在浏览器里跑 —— getBoundingClientRect 只有浏览器有。')
console.log('')
console.log('  打开 ' + BASE + '/?v=' + Date.now())
console.log('  控制台执行：')
console.log('')
console.log('    ' + body.trim().split('\n')[0].slice(0, 60) + ' …（共 ' +
  body.trim().split('\n').length + ' 行，完整内容见 ' + probePath + '）')
console.log('')
console.log('  或者在页面里执行 <script src="/ui-probe.js"></script>，')
console.log('  然后在控制台敲 __ui 就能看到结果对象。')
console.log('')

}

/* ── 静态侧的自查：把 CSS 里能算的算掉 ──
   这些不需要浏览器也能查，先做掉，
   剩下的（真实矩形）才需要浏览器。 */
const css = fs.readFileSync(ROOT + '/app.css', 'utf8')

/* ★ 要匹配【最后一条】.side .nav，不是第一条。
     CSS 里同名选择器有多条（这个项目里就有三条），
     后面写的覆盖前面写的 —— 所以生效的是最后一条。
     我用 match() 取第一条，结果量到的是那条早就在的旧规则，
     于是报「没有 flex:0 0 auto」，而实际上刚加的那条有。

     ★ 查样式要查「生效的那条」，不是「第一条」。
       顺序在 CSS 里是有语义的，查的时候不能当它不存在。
     真正可靠的还是浏览器算的，
     静态这一层只用来在没有浏览器时兜个底。 */
function lastRuleBlock(sel) {
  const re = new RegExp(sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') +
    '\\{([\\s\\S]*?)\\n\\}', 'g')
  let last = null, m2
  while ((m2 = re.exec(css))) last = m2[1]
  return last
}

const rule = lastRuleBlock('.side .nav')
if (!rule) {
  console.log('★ 找不到 .side .nav 的规则块')
  process.exitCode = 1
} else {
  const fail = []
  const padTop = (rule.match(/padding:\s*(\d+)px/) || [])[1]
  const fixed = (rule.match(/\bheight:\s*(\d+)px/) || [])[1]

  if (fixed) {
    fail.push('.nav 写死了 height:' + fixed +
      'px —— 换成两行内容后装不下，且会盖过 flex 设置')
  }
  if (!padTop) {
    fail.push('.nav 没有 padding，内容会贴着边')
  } else if (+padTop < 8) {
    fail.push('.nav padding 只有 ' + padTop + 'px，两行内容挤在一起')
  }
  if (!/flex:0 0 auto/.test(rule)) {
    fail.push('.nav 没有 flex:0 0 auto，父容器空间不够时会先吃掉 padding')
  }
  if (/grid-row/.test(rule)) {
    fail.push('.nav 还用 grid 跨行，隐式行可能算出 0 高（这次就是这么塌的）')
  }

  console.log('── 静态侧（不需要浏览器，查的是最后一条 .side .nav）──')
  console.log('  .nav padding  ' + (padTop || '★没有'))
  console.log('  .nav height   ' + (fixed || '无（好）'))
  console.log('  flex:0 0 auto ' + (/flex:0 0 auto/.test(rule) ? '有' : '★没有'))
  console.log('  grid-row      ' + (/grid-row/.test(rule) ? '★还有' : '无'))
  console.log('')

  if (fail.length) {
    console.log('── 失败 ──')
    fail.forEach(f => console.log('  ✗ ' + f))
    process.exitCode = 1
  } else {
    console.log('  静态侧全过。真实矩形还需要在浏览器里跑上面的脚本。')
    console.log('')
  }
}