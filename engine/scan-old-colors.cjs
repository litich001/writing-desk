/* 扫旧色值残留：换配色最容易漏的是硬编码在组件里的颜色 */
const fs = require('fs')
const t = fs.readFileSync('app.css', 'utf8')

const OLD = [
  ['rgba(47,93,80', '旧绿焦点环'],
  ['rgba(31,64,56', '旧深绿按钮'],
  ['rgba(28,26,23', '旧墨黑阴影'],
  ['#3b5bdb', '旧蓝强调色'],
  ['#2f5d50', '旧绿 brand'],
  ['#17181a', '旧墨黑 ink'],
  ['#f7f7f8', '旧冷灰底'],
  ['#e3e4e6', '旧发丝线'],
  ['#3f9e6a', '旧绿连接点']
]

let total = 0
for (const [c, why] of OLD) {
  let n = 0, at = 0
  for (;;) {
    const i = t.indexOf(c, at)
    if (i < 0) break
    n++
    at = i + c.length
  }
  if (n) {
    total += n
    console.log('  ' + why + '  ' + c + '  还有 ' + n + ' 处')
    t.split('\n').forEach((l, i) => { if (l.includes(c)) console.log('      行' + (i + 1) + ': ' + l.trim().slice(0, 66)) })
  }
}
console.log(total ? '\n共 ' + total + ' 处残留' : '旧色值已清空')