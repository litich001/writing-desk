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
    var txEl = n.querySelector('.tx')
    var dsEl = n.querySelector('.ds')
    var stEl = n.querySelector('.st')
    var tx = txEl && txEl.getBoundingClientRect()
    var ds = dsEl && dsEl.getBoundingClientRect()
    var st = stEl && stEl.getBoundingClientRect()
    out.side.push({
      h: Math.round(r.height),
      top: Math.round(r.top),
      bottom: Math.round(r.bottom),
      /* 序号圆圈渲染了几个？
         渲染两次会叠在一起，而每一份单独看都正常 ——
         「序号有没有渲染」查不出来，只有数数量才查得出来。
         上一版就是这么漏的：模板里 st 出现了两次。 */
      stCount: n.querySelectorAll('.st').length,
      stH: st ? Math.round(st.height) : 0,
      txH: tx ? Math.round(tx.height) : 0,
      dsH: ds ? Math.round(ds.height) : 0,
      lineGap: (tx && ds) ? Math.round(ds.top - tx.bottom) : 0,
      dsHave: ds ? Math.round(ds.width) : 0,
      need: 0,
      cut: false
    })
    /* 量说明文字单行到底要多宽：克隆一份不限宽 */
    if (dsEl) {
      var probe = dsEl.cloneNode(true)
      probe.style.position = 'absolute'
      probe.style.visibility = 'hidden'
      probe.style.width = 'max-content'
      probe.style.whiteSpace = 'nowrap'
      document.body.appendChild(probe)
      out.side[i].need = Math.round(probe.getBoundingClientRect().width)
      document.body.removeChild(probe)
      /* scrollWidth > clientWidth 就是横向被截断 */
      out.side[i].cut = dsEl.scrollWidth > dsEl.clientWidth + 1
    }
    boxes.push(r)
  }
  for (var j = 1; j < boxes.length; j++) {
    var g = Math.round(boxes[j].top - boxes[j - 1].bottom)
    out.side[j].gap = g
    /* 间距为 0 是紧挨着，不算重叠；必须 < -1 才报 */
    if (g < -1) out.collide.push('侧栏第' + j + '项与第' + (j + 1) + '项重叠 ' + (-g) + 'px')
  }

  /* 二 逐页：同列兄弟元素遮挡
     ★ 这里踩过一次很典型的坑：
       我原来只判「矩形边界不相交」，然后把
         ovH = min(bottom) - max(top)
       直接当重叠量报出来。
       但两个元素上下排开时 ovH 是【负数】——
       实测输出「交叠 213×-27px」，负数明明是没重叠。
       我把负数当正的读了，于是报出「重叠 4 处」，
       用户一看根本没有。

       ★ 假阳性比没修更坏 —— 验收说有重叠，
         那我就是在用噪音淹没真正的问题。

       现在加三道保护：
         一 ovH 和 ovW 都必须 > 0 才算交叠
         二 交叠面积要 >= 16 平方像素（4×4），
           1~3px 是描边、阴影、子像素误差
         三 绝对定位的元素不参与 ——
           徽标本来就浮在右上角，它和文字重叠是设计意图 */
  function scan(sel, page) {
    var root = document.querySelector(sel)
    if (!root) return
    var kids = []
    for (var i = 0; i < root.children.length; i++) {
      var e = root.children[i]
      var r = e.getBoundingClientRect()
      if (r.width > 1 && r.height > 1) {
        kids.push({
          e: e, r: r,
          c: (e.className || e.tagName).toString().slice(0, 22),
          pos: getComputedStyle(e).position
        })
      }
    }
    for (var a = 0; a < kids.length; a++) {
      for (var b = a + 1; b < kids.length; b++) {
        var ea = kids[a], eb = kids[b]
        var ra = ea.r, rb = eb.r
        /* 只查同一列的（左边差不多齐），
           横向并列的两个块贴在一起不算遮挡 */
        if (Math.abs(ra.left - rb.left) > 4) continue
        if (!overlap(ra, rb)) continue
        var ovH = Math.min(ra.bottom, rb.bottom) - Math.max(ra.top, rb.top)
        var ovW = Math.min(ra.right, rb.right) - Math.max(ra.left, rb.left)
        if (ovH * ovW < 16) continue
        if (ea.pos === 'absolute' || eb.pos === 'absolute') continue
        out.collide.push(page + ' ' + sel + ' ' + ea.c + ' × ' + eb.c +
          ' 压 ' + Math.round(ovW) + '×' + Math.round(ovH) + 'px')
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

/* ★ 匹配到的最后一条，往往在 @media 里面 ——
     轨道态那一档把 flex-direction、padding 全改了一遍，
     量到的是它，主态的规则反而没量到。

     办法：一条条收集，然后挑【不在任何 media 里】的那条。
     判据：它的位置在最后一个 @media 之前
     —— 太糙。更稳的是把 @media 块的字符区间全挖出来，
     规则落在区间里就算在 media 内。 */
function allRuleBlocks(sel) {
  const re = new RegExp(sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') +
    '\\{([\\s\\S]*?)\\n\\}', 'g')
  const out = []
  let m2
  while ((m2 = re.exec(css))) out.push({ body: m2[1], at: m2.index })
  return out
}

/** 把所有 @media 块覆盖的区间挖掉 */
function mediaRanges() {
  const out = []
  const re = /@media[^{]*\{/g
  let m2
  while ((m2 = re.exec(css))) {
    const open = css.indexOf('{', m2.index)
    let depth = 0
    let end = open
    for (let i = open; i < css.length; i++) {
      if (css[i] === '{') depth++
      else if (css[i] === '}') { depth--; if (depth === 0) { end = i; break } }
    }
    out.push([m2.index, end])
  }
  return out
}

const inside = (at, ranges) => ranges.some(r => at >= r[0] && at <= r[1])

const ranges = mediaRanges()
const blocks = allRuleBlocks('.side .nav')
/* 主态规则 = 不在任何 media 里的最后一条 */
const mainRule = blocks.filter(b => !inside(b.at, ranges)).pop()
const rule = mainRule ? mainRule.body : (blocks.length ? blocks[blocks.length - 1].body : null)

console.log('')
console.log('  .side .nav 一共 ' + blocks.length + ' 条规则，' +
  blocks.filter(b => inside(b.at, ranges)).length + ' 条在 media 里，' +
  '量的是主态那条（在 media 外的最后一条）')
if (!rule) {
  console.log('★ 找不到 .side .nav 的规则块')
  process.exitCode = 1
} else {
  const fail = []
  /* 原来这里写的是 rule.match(/padding:\s*(\d+)px/) —— 只认裸 px。
     间距令牌化之后 .side .nav 写的是
       padding:var(--s3) var(--s2) var(--s3)
     匹配不到，于是报「.nav 没有 padding」。

     这条判据一直在默默失效：上一次它还是绿的，
     只因为那会儿 .nav 恰好写的是裸 px（8px 12px 8px）。
     它绿的时候验证的不是现在这套写法。

     而且它报的错是「没有 padding」——听起来像布局坏了，
     实际是判据看不懂令牌。这种错报比不报更坏：
     下一个人会去加 padding，把内边距越加越大。 */
  const SP_TOKEN = {
    '--sp1': 2, '--sp2': 4, '--sp3': 8, '--sp4': 12, '--sp5': 16,
    '--sp6': 24, '--sp7': 32, '--sp8': 48,
    '--s1': 4, '--s2': 8, '--s3': 12, '--s4': 16,
    '--s5': 24, '--s6': 32, '--s7': 48, '--s8': 48
  }
  /* 把 var(--s3) 或 12px 解析成数字；认不出来返回 null */
  function pxOf(v) {
    v = String(v || '').trim()
    if (!v) return null
    const t = v.match(/var\((--[a-z0-9-]+)/)
    if (t) return SP_TOKEN[t[1]] === undefined ? null : SP_TOKEN[t[1]]
    const n = parseFloat(v)
    return isNaN(n) ? null : n
  }
  /* padding 简写：1 段四边同值 / 2 段 上下 左右 / 3 段 上 左右 下 / 4 段 */
  const pm = rule.match(/padding:\s*([^;}]+)/)
  let padTop = null, padLeft = null, padRaw = null
  if (pm) {
    padRaw = pm[1].trim()
    const v = padRaw.split(/\s+/)
    padTop = pxOf(v[0])
    padLeft = v.length === 1 ? pxOf(v[0])
      : v.length === 2 ? pxOf(v[1])
      : v.length === 3 ? pxOf(v[1])
      : pxOf(v[3])
  }
  const fixed = (rule.match(/\bheight:\s*(\d+)px/) || [])[1]

  if (fixed) {
    fail.push('.nav 写死了 height:' + fixed +
      'px —— 换成两行内容后装不下，且会盖过 flex 设置')
  }
  if (padTop === null) {
    fail.push('.nav 的 padding 认不出（既不是裸 px 也不是已知令牌）: ' + (padRaw || '整条没写'))
  } else if (padTop < 8) {
    fail.push('.nav padding 只有 ' + padTop + 'px，两行内容挤在一起')
  }
  if (padLeft !== null && padLeft < 8) {
    fail.push('.nav 横向 padding 只有 ' + padLeft + 'px，序号离卡片边太近')
  }
  if (!/flex:0 0 auto/.test(rule)) {
    fail.push('.nav 没有 flex:0 0 auto，父容器空间不够时会先吃掉 padding')
  }
  if (/grid-row/.test(rule)) {
    fail.push('.nav 还用 grid 跨行，隐式行可能算出 0 高（这次就是这么塌的）')
  }

  console.log('── 静态侧（不需要浏览器，查的是最后一条 .side .nav）──')
  console.log('  .nav padding  ' + (padRaw || '★没有') +
    (padTop !== null ? '（上' + padTop + ' 左' + padLeft + '）' : ''))
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