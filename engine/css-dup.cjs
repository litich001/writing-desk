/**
 * CSS 重复选择器检测
 *
 * 起因（踩了两轮才发现）：
 *   app.css 里 `.card` 和 `.btn` 各写了两遍。
 *   一套是旧的（圆角 + 模糊阴影），一套是新的（直角 + 硬边）。
 *   后面的覆盖前面的 —— 所以我改了新的一套，界面却纹丝不动。
 *
 *   这是最难查的一类 bug：文件确实变了，改的也确实是想要的那条规则，
 *   但它不生效。查的时候完全看不出哪里不对。
 *
 * 判据：同一个「选择器 + {」在一个文件里出现 > 1 次。
 * 媒体查询里的重复不算（那是有意的条件覆盖）。
 */
const fs = require('fs')
const css = fs.readFileSync('app.css', 'utf8')
const lines = css.split(/\n/)

/* 找出所有「顶层选择器」定义：行首的选择器（不含缩进的，缩进的是媒体查询里的） */
const defs = new Map()
let inMedia = 0
let blockDepth = 0

lines.forEach((l, i) => {
  // 媒体查询追踪
  if (/@media/.test(l)) { inMedia++; return }
  const opens = (l.match(/{/g) || []).length
  const closes = (l.match(/}/g) || []).length

  // 顶层选择器：不在任何 {} 内、不在媒体查询内、以选择器开头
  // 必须要求这一行以 { 结尾才算一条完整定义 —— 否则
  //   .page-head h2{
  //     font:700 30px/1.25 var(--serif);
  //     ...
  //   }
  // 会被当成 4 条定义，误报一堆。
  if (blockDepth === 0 && inMedia === 0 && /\{[^{}]*\}\s*$/.test(l)) {
    const m = l.match(/^([^{@\/][^{]*?)\s*\{/)
    if (m) {
      const sel = m[1].trim()
      if (sel.length > 1) {
        if (!defs.has(sel)) defs.set(sel, [])
        defs.get(sel).push(i + 1)
      }
    }
  } else if (blockDepth === 0 && inMedia === 0 && /\{[^{}]*$/.test(l)) {
    // 多行定义：只记一次，用选择器 + 行号
    const m = l.match(/^([^{@\/][^{]*?)\s*\{/)
    if (m) {
      const sel = m[1].trim() + ' {多行'
      if (!defs.has(sel)) defs.set(sel, [])
      defs.get(sel).push(i + 1)
    }
  }
  blockDepth += opens - closes
  if (inMedia > 0 && blockDepth === 0) inMedia--
})

const dup = [...defs.entries()].filter(([, ls]) => ls.length > 1)
dup.sort((a, b) => b[1].length - a[1].length)

console.log('\n  CSS 重复选择器')
console.log('  ' + '='.repeat(58))
console.log('  扫了 ' + lines.length + ' 行，' + defs.size + ' 个顶层选择器\n')

if (!dup.length) {
  console.log('  没有重复定义')
} else {
  console.log('  ★ 重复定义了 ' + dup.length + ' 个选择器：\n')
  dup.forEach(([sel, ls]) => {
    console.log('    ' + sel)
    console.log('      出现在第 ' + ls.join('、') + ' 行')
  })
  console.log('\n  后面的会覆盖前面的 —— 改了前面那处，界面不会有任何变化。')
  console.log('  这是最难查的一类问题：文件确实改了，改的也是想要的那条，就是不生效。')
}

console.log('')
process.exit(dup.length ? 1 : 0)