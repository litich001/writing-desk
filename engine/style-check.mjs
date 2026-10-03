// AI 味自检：把正文里明显违规的模式挑出来
// 规则来自历年踩过的坑，不是通用标准
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')

const body = fs.readFileSync(path.join(ROOT, 'data/body.md'), 'utf8')
// 参考来源表和引用块是原标题，不能算
const clean = body.replace(/^\|.*\|$/gm, '').replace(/^>.*$/gm, '')

const RULES = [
  [/不是[^。]{0,20}，?而是[^。]{0,20}，?而是/g, '不是A而是B三段式'],
  [/总而言之|综上所述|归根结底|说到底|一言以蔽之/g, '万能总结'],
  [/这(让我们)?(看到|感受到|明白|提醒我们)|愿我们|未来可期|值得深思/g, '空洞拔高'],
  [/首先[，,]|其次[，,]|最后[，,]|再次[，,]|此外[，,]/g, '议论文连接词'],
  /* 加粗：原来是「出现 ** 就报错」，那条规则是错的。
     用户明确要求「有强调的内容，有一些重点，不然通篇下来都是长文」，
     而且排版内核会把 ** 渲染成 <strong>（实测无残留星号）。
     真正的问题是「滥用」—— 5000 字的稿子加粗 100 处就成了一片高亮。
     改判密度，见下方统一密度检查区。 */
  /* 破折号原来是「出现即报错」，和 styles.mjs 的密度判法不一致 ——
     同一个东西两个标准，检查器自相矛盾。
     破折号在中文里是正常插入语，问题是「用得密」，移到下方统一密度检查。 */
  [/我们(认为|应该|需要)/g, '空泛主语'],
  [/[a-z]{4,} [a-z]{4,}/g, '英文词组'],
  [/在这个快速变化的时代|众所周知|不容置疑/g, '套话'],
  [/不仅仅是.{1,12}更是/g, '递进套句']
]

let bad = 0
RULES.forEach(([re, name]) => {
  const m = clean.match(re)
  if (m) { bad++; console.log('  ★ ' + name + ' ×' + m.length + ' 例：' + m[0].slice(0, 40)) }
})

const chars = body.replace(/\s/g, '').length
const paras = body.split(/\n\s*\n/).filter(x => x.trim()).length
const secs = (body.match(/^## /gm) || []).length
const imgs = (body.match(/^!\[/gm) || []).length

/* 密度统一检查区。
   破折号和加粗都改成密度判，因为「出现即报错」会把正常用法判死：
   · 破折号：中文里是正常插入语，每千字 > 1.5 个才算密集（与 styles.mjs 同阈值）
   · 加粗：每千字 > 12 处算滥用，< 3 处算没重点
   两个检查器必须用同一套阈值，否则自相矛盾（这次就踩了）。 */
const bolds = (body.match(/\*\*/g) || []).length / 2
const perK = chars > 0 ? (bolds / chars) * 1000 : 0
const cleanChars = clean.replace(/\s/g, '').length
const dashes = (clean.match(/——/g) || []).length
const dashPerK = cleanChars > 0 ? (dashes / cleanChars) * 1000 : 0

if (chars > 800) {
  if (perK > 12) { bad++; console.log(`  ★ 加粗滥用 ×${bolds}（每千字 ${perK.toFixed(1)} 处，上限 12）`) }
  if (bolds < 3) { bad++; console.log(`  ★ 没有重点 ×${bolds}（5000 字的稿子至少要有几处加粗）`) }
  if (dashPerK > 1.5) { bad++; console.log(`  ★ 破折号过密 ×${dashes}（每千字 ${dashPerK.toFixed(2)} 处，上限 1.5）`) }
}

console.log(`  ${chars} 字 · ${paras} 段 · ${secs} 节 · ${imgs} 图 · 加粗 ${bolds} 处（每千字 ${perK.toFixed(1)}）· 破折号 ${dashes} 处（每千字 ${dashPerK.toFixed(2)}）`)
if (bad) {
  console.log(`  ✗ 文风自检：还有 ${bad} 类问题`)
  process.exit(1)
} else {
  console.log('  ✓ 文风自检通过')
}
