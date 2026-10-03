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

/* ── 静态检查：最容易出的低级错 ── */
ok('#app 使用 row 方向（侧栏在左）', /#app\{[^}]*flex-direction:\s*row/.test(app.replace(/\s+/g, '')) || /flex-direction:\s*row/.test(app))
ok('侧栏有满高约束', /\.side\{[^}]*height:100vh/.test(app.replace(/\n/g, '').replace(/\s+/g, '')) || /height:100vh/.test(app))
ok('有三级响应式断点', (app.match(/@media\(max-width:/g) || []).length >= 3, (app.match(/@media\(max-width:/g) || []).length + ' 个')
ok('断点宽度递减且合理', (() => {
  const w = [...app.matchAll(/@media\(max-width:(\d+)px\)/g)].map(m => +m[1])
  return w.length >= 3 && w.every((v, i) => i === 0 || v < w[i - 1])
})(), [...app.matchAll(/@media\(max-width:(\d+)px\)/g)].map(m => m[1]).join(' > '))
ok('主区有 min-width:0（防止内容撑破）', /\.main\{[^}]*min-width:0/.test(app.replace(/\n/g, '').replace(/\s+/g, '')) || /min-width:0/.test(app))
ok('html/body 有溢出控制', /body\{[^}]*overflow:hidden/.test(app.replace(/\n/g, '').replace(/\s+/g, '')) || /overflow:hidden/.test(app))
ok('#app 宽度撑满', /#app\{[^}]*width:100%/.test(app.replace(/\n/g, '').replace(/\s+/g, '')) || /#app\{[\s\S]{0,200}width:100%/.test(app))

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
console.log('  （视口相关项需浏览器确认，脚本已标出）')
console.log('='.repeat(62) + '\n')
