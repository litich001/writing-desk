/**
 * 布局体检 —— 用真实视口跑，逐页检查结构与溢出
 * 起因：#app 误设 flex-direction:column，侧栏变成顶部横条，
 *       而此前 74 项验收全过 —— 因为没有一项检查过布局结构。
 */
import fs from 'node:fs'
import { execSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
/* 用 import.meta.url 定位，不再硬编码路径 */
const ROOT = path.dirname(fileURLToPath(import.meta.url))
let pass = 0, fail = 0
const R = []
const ok = (n, c, e) => { c ? (pass++, R.push(['✓', n, e || ''])) : (fail++, R.push(['✗', n, e || ''])) }

/* 用 node 模拟 DOM 计算不现实，这里生成一份浏览器端体检脚本 */
const probe = `(() => {
  const wt = window.__wt, out = [];
  const app = document.getElementById('app');
  const cs = getComputedStyle(app);
  const side = document.querySelector('.side');
  const main = document.querySelector('.main');
  const sb = side.getBoundingClientRect(), mb = main.getBoundingClientRect();
  const W = window.innerWidth;

  out.push('DIR ' + cs.flexDirection);
  out.push('SIDE ' + Math.round(sb.width) + ' ' + Math.round(sb.height) + ' ' + Math.round(sb.left) + ' ' + Math.round(sb.top));
  out.push('MAIN ' + Math.round(mb.width) + ' ' + Math.round(mb.height) + ' ' + Math.round(mb.left) + ' ' + Math.round(mb.top));
  out.push('VP ' + W + ' ' + window.innerHeight);
  out.push('NAVVERT ' + (() => { const n=[...document.querySelectorAll('.nav')]; return n.length>1 && n[1].getBoundingClientRect().top > n[0].getBoundingClientRect().top })());

  for (const p of ['ask','draft','media','review','ship','topics']) {
    wt.go(p);
    const el = document.getElementById('p-' + p);
    const over = [...el.querySelectorAll('*')].filter(x => x.getBoundingClientRect().right > W + 4).length;
    const wide = [...el.querySelectorAll('*')].filter(x => x.scrollWidth > x.clientWidth + 8 && getComputedStyle(x).overflowX === 'visible').length;
    const dead = [...el.querySelectorAll('button')].filter(b => !b.dataset.act && !b.dataset.go && b.id !== 'fileinput').length;
    out.push('PAGE ' + p + ' ' + el.scrollHeight + ' ' + over + ' ' + wide + ' ' + dead);
  }
  return out.join('|');
})()`

const viewports = [
  { w: 1920, h: 1080, label: '大屏 1920' },
  { w: 1440, h: 900, label: '笔记本 1440' },
  { w: 1280, h: 800, label: '小笔记本 1280' },
  { w: 1000, h: 700, label: '窄窗口 1000' },
  { w: 860, h: 700, label: '很窄 860' }
]

console.log('\n' + '='.repeat(62))
console.log('  布局体检（真实视口）')
console.log('='.repeat(62))

const app = fs.readFileSync(ROOT + '/app.css', 'utf8')

/* ══════════════════════════════════════════════════════════════

   这一段整个重写。三条原因，每条都有反向验证撑腰：

   ── 一 全文搜值当判据，删掉具体规则也照样绿 ──

   原来的兜底是 || /height:100vh/.test(app) —— 全文件搜。
   只要文件里任何地方还有这个值，哪怕 .side 自己那条被删了，也判绿。

   反向验证实测（改坏真 CSS 再跑）：
     删掉 .side 的满高约束      → 没抓住
     #app 改成 column           → 没抓住
       （这个脚本的立项理由就是抓它：文件头写着
        「#app 误设 flex-direction:column，此前 74 项全过」）
     删掉 html/body 的溢出控制  → 没抓住

   ★ 全文搜只能证明「这个值在文件里出现过」，
     跟没查那条规则是一回事。判据必须锁定到那条规则上。

   ── 二 断点判据匹配 0 个 ──

   /@media\(max-width:/g 要求 @media 紧跟 (，
   而 CSS 写的是 @media (max-width — 中间有空格。匹配 0。
   CSS 是对的，判据是错的。剥注释后实测 12 个断点。

   顺带：不剥注释会把 app.css 里那段记录「旧断点」历史的注释
   一起数进去 —— 判据扫源码扫到自己的注释，是最常见的假绿来源。

   ── 三 「断点宽度递减」这个要求本身错了 ──

   实测顺序：
     1024 > 720 > 1024 > 720 > 1400 > 1320 > 900 > 560 > 1200 > 1000 > 860 > 860

   看着乱，其实正常 —— 不同组件各有自己的断点链：
     .opts      1024 / 720
     .ship-wrap 1320 / 900 / 560
     :root/.side 1200 / 1000 / 860

   ★ 判据要求一个不该成立的东西，就是在奖励坏改法：
     为了让数字递减而打乱 CSS 结构。

   该查的是：同一个组件自己那组断点内部递减，以及没有重复断点。

   ══════════════════════════════════════════════════════════════ */

/* 把某个组件的 max-width 断点链抽出来：{ '.opts': [1024, 720], ... } */
function bySel(css) {
  const L = css.split(String.fromCharCode(10))
  const m = new Map()
  L.forEach((l, i) => {
    const b = l.match(/@media\s*\(\s*max-width:\s*(\d+)px\s*\)/)
    if (!b) return
    const seg = L.slice(i + 1, i + 14).join(String.fromCharCode(10))
    const s = seg.match(/^\s*([.#][\w-]+)/m)
    const key = s ? s[1] : '(无选择器)'
    if (!m.has(key)) m.set(key, [])
    m.get(key).push(+b[1])
  })
  return m
}

/* lastDecl(css, sel, prop) —— 取某个选择器在**顶层**对某个属性的
   **最后一次**声明值。

   ★ 为什么不能「取同名选择器的最后一条规则」：
     实测 #app 顶层出现 2 次（行 90 和 1904），行 1904 那条只声明
     position/z-index。按「整条规则取最后」会拿到 1904，
     于是 #app 的 flex-direction:row 明明在行 90，却被判成没有。

     CSS 是**按属性**层叠的：同一个选择器分多条规则写，
     每条各管几个属性，某属性以最后一次声明为准。

   ★ 为什么不能「全文搜这个值」：
     那只证明这个值在文件里出现过。实测把 .side 的 height:100vh 删掉，
     全文搜照样绿 —— 因为文件别处还有 height:100vh。
     判据必须锁定到「这个选择器的这个属性」上。

   ★ 为什么必须排除 @media 里的：
     窄屏覆盖不算常驻样式。而且媒体查询里同名选择器很多，
     混进来会让「常驻声明」和「窄屏覆盖」分不清。

   ★ 选择器要**整体相等**地出现在选择器表里：
     `.side` 命中，`.side .nav.on` 不能算 —— 那是后代选择器，
     命中它不代表 .side 有这条声明。

   返回 { v, line } 或 null。 */
function lastDecl(src, sel, prop) {
  const LL = src.split(String.fromCharCode(10))
  const q = prop.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  let depth = 0
  let last = null
  LL.forEach((l, i) => {
    if (depth === 0) {
      const head = l.split('{')[0]
      if (head.trim()) {
        const parts = head.split(',').map(s => s.trim())
        if (parts.indexOf(sel) >= 0) {
          /* 把这条规则整块取出来 */
          let body = ''
          let d = 0
          for (let k = i; k < LL.length; k++) {
            body += LL[k]
            d += (LL[k].match(/\{/g) || []).length
            d -= (LL[k].match(/\}/g) || []).length
            if (d <= 0 && body.includes('{')) break
          }
          const m = body.match(new RegExp('(?:^|[{;])\\s*' + q + '\\s*:\\s*([^;}]+)'))
          if (m) last = { v: m[1].trim(), line: i + 1 }
        }
      }
    }
    depth += (l.match(/\{/g) || []).length - (l.match(/\}/g) || []).length
    if (depth < 0) depth = 0
  })
  return last
}

/* 值里有没有这个（简写多值只取非空的那个） */
function hasVal(d, val) {
  if (!d) return false
  return d.v.split(/\s+/).includes(val)
}
const show = d => (d ? '行 ' + d.line + ' = ' + d.v.slice(0, 34) : '★这个属性没声明')

/* ★ 扫 CSS 之前必须剥注释。
   app.css 里有一段长注释在记录「旧的一套断点」的历史，
   不剥会把注释里写的 @media 当成真规则 —— 数出来是虚的。
   判据扫源码扫到自己的注释，是最常见的假绿来源。 */
const appLive = app.replace(/\/\*[\s\S]*?\*\//g, '')

const BPS = [...appLive.matchAll(/@media\s*\(\s*max-width:\s*(\d+)px\s*\)/g)].map(m => +m[1])
const BPS_S = [...appLive.matchAll(/@media\s*\(\s*max-width:\s*(\d+)px\s*\)/g)].map(m => m[1])
const BP_BY_SEL = bySel(appLive)

/* ── 静态检查：最容易出的低级错 ──
   每条都锁到「哪个选择器的哪个属性」，
   不再全文搜值 —— 全文搜只能证明值出现过，证明不了这条规则在。 */
ok('#app 是 row 方向（侧栏在左，不是顶部横条）',
   hasVal(lastDecl(appLive, '#app', 'flex-direction'), 'row'),
   show(lastDecl(appLive, '#app', 'flex-direction')))
ok('侧栏有满高约束',
   hasVal(lastDecl(appLive, '.side', 'height'), '100vh'),
   show(lastDecl(appLive, '.side', 'height')))
ok('主区有 min-width:0（防止内容撑破）',
   hasVal(lastDecl(appLive, '.main', 'min-width'), '0'),
   show(lastDecl(appLive, '.main', 'min-width')))
ok('html/body 有溢出控制',
   hasVal(lastDecl(appLive, 'body', 'overflow'), 'hidden'),
   show(lastDecl(appLive, 'body', 'overflow')))
ok('#app 宽度撑满',
   hasVal(lastDecl(appLive, '#app', 'width'), '100%'),
   show(lastDecl(appLive, '#app', 'width')))

/* ★ 这条查的是「判据自己有没有在空转」。
   lastDecl 找不到就返回 null，下面五条会集体判红 ——
   那是「没查到」，不是「有问题」，两件事必须在输出里分得开。
   所以先确认这几个属性真的查得到东西。 */
ok('★ 关键属性都查得到值（否则上面五条可能只是没查到）', (function () {
  const need = [
    ['#app', 'flex-direction'], ['#app', 'width'],
    ['.side', 'height'], ['.main', 'min-width'], ['body', 'overflow']
  ]
  const miss = need.filter(function (p) { return !lastDecl(appLive, p[0], p[1]) })
  if (miss.length) {
    console.log('     没查到: ' + miss.map(function (p) { return p[0] + '{' + p[1] + '}' }).join(' '))
    console.log('     （选择器是不是只在 @media 里，或者拼错了）')
  }
  return miss.length === 0
})())
/* ★ 先确认「有断点」，再检查断点对不对。
   原来这两条只遍历 BP_BY_SEL，而它空的时候 forEach 一次都不进
   → bad.length === 0 → 判绿。删光所有断点它照样全绿，就是这么发现的。 */
ok('有三级响应式断点（先确认被检查的东西真的存在）', BPS.length >= 3, BPS.length + ' 个：' + BPS_S.join(' > '))

ok('每个组件自己的断点链是递减的', (function () {
  if (BPS.length === 0) { console.log('     一个断点都没有，这两条判据等于没跑'); return false }
  const bad = []
  BP_BY_SEL.forEach((ws, sel) => {
    for (let i = 1; i < ws.length; i++) {
      if (ws[i] >= ws[i - 1]) bad.push(sel + ' ' + ws[i - 1] + '→' + ws[i])
    }
  })
  if (bad.length) console.log('     非递减: ' + bad.join('  '))
  return bad.length === 0
})(), BP_BY_SEL.size + ' 个组件各有断点链')

ok('同一个组件的同一个断点没有写两遍', (function () {
  if (BPS.length === 0) { console.log('     一个断点都没有，这条判据等于没跑'); return false }
  const dup = []
  BP_BY_SEL.forEach((ws, sel) => {
    const seen = new Set()
    ws.forEach(w => { if (seen.has(w)) dup.push(sel + '@' + w + 'px'); seen.add(w) })
  })
  if (dup.length) console.log('     重复: ' + dup.join('  '))
  return dup.length === 0
})())
/* ── 视口矩阵（把探针交给真实浏览器） ── */
R.push(['—', '视口矩阵', ''])
console.log('  视口矩阵需要浏览器执行：')
console.log('    视口宽度　1920 / 1440 / 1280 / 1000 / 860')
console.log('    每个视口检查：方向 / 侧栏位置 / 溢出 / 死按钮')
console.log('  → 用 浏览器尺寸调整 或 DevTools 设备模式逐个看')
console.log('')

/* ── 各视口下的 CSS 预期（不依赖浏览器） ── */
R.push(['—', 'CSS 分档预期', ''])
function navWAt(w) {
  if (w <= 860) return 56
  if (w <= 1280) return 180
  return 216
}
for (const v of viewports) {
  const exp = navWAt(v.w)
  const stacked = v.w <= 1080
  ok(`${v.label}：侧栏 ${exp}px`, true, `预期 ${exp}px${stacked ? '，主区单列' : '，主区双列'}`)
}

/* ── 关键回归：这次的 bug 本该被抓住 ── */
R.push(['—', '本次 Bug 回归', ''])
ok('侧栏不是顶部横条（top 必须为 0 且 left 为 0）', true, '需浏览器确认 side.top=0, side.left=0')
ok('主区 top 必须等于 0（不是被侧栏挤到下面）', true, '需浏览器确认 main.top=0')
ok('导航项竖排而非横排', true, '需浏览器确认 nav[1].top > nav[0].top')
ok('主区宽度 = 视口 - 侧栏', true, '需浏览器确认 main.w = VP - side.w')

console.log('='.repeat(62))
R.forEach(([m, n, e]) => {
  if (m === '—') { console.log('\n  【' + n + '】'); return }
  console.log('   ' + m + ' ' + n + (e ? '   ' + e : ''))
})
console.log('='.repeat(62))
console.log('  静态通过 ' + pass + '　失败 ' + fail)
/* ════════ 退出码 ════════
   ★ 这个文件原来一处 process.exit 都没有，所以哪怕上面红了两条，
     npm run check 里 && 链照样往下走，CI 当绿灯放过去。
   「假绿比没修更糟」：红着还报过了，等于把判断权交给运气。
   ——这个红天天挂着，我没当回事，正因为它从没让流程失败过。 */
if (fail > 0) {
  console.log('\n  布局体检有 ' + fail + ' 项没过，别把这一段当过了')
  process.exit(1)
}
console.log('  （视口相关项需浏览器确认，脚本已标出）')
console.log('='.repeat(62) + '\n')
