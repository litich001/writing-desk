/**
 * 配图：把抓到的图插到正文里，位置按「这张图在这段起什么作用」决定
 *
 * 用户原话：「你配图应该在文章正常的显示出来就可以，不要给我改成其他形式的」
 *   —— 意思就是正文里就该有图，用标准 Markdown 语法，不要搞花活。
 *
 * 位置规则（不是随机插，是按作用）：
 *   · 开篇主图   → 第一节讲完之后，先给读者一个视觉锚点
 *   · 论点图     → 讲「被挤掉的是谁的通道」那段之后 —— 那张图正是画这个的
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const F = path.join(ROOT, 'data', 'body.md')
const raw = fs.readFileSync(F, 'utf8')

/* 每张图：插在哪句话之后 + 图注 */
const PLACEMENT = [
  {
    file: 'jz_muo6vmne_0.jpg',
    // 第一节末尾：把「1520 不是一个数字，是成本表」的判断给出视觉
    after: '**答案是划算。这就够了',
    cap: '图：12315 投诉举报窗口前，职业索赔者抱着一摞材料，普通消费者在后面排队。图/澎湃新闻'
  },
  {
    file: 'jz_muo6vn0k_2.png',
    // 第三节讲「被挤掉的是谁的通道」之后 —— 这张图画的就是这件事
    after: '算的那个，就成了成本',
    cap: '图：同一件事的另一面 —— 窗口就那么一个。图/澎湃新闻'
  }
]

let out = raw
let done = 0
const missed = []

for (const p of PLACEMENT) {
  const tag = `![${p.cap}](${p.file})`
  if (out.includes(p.file)) { done++; continue }

  const anchor = p.after
  if (!out.includes(anchor)) { missed.push(anchor.slice(0, 30)); continue }

  // 在锚点所在段落之后插一段图
  out = out.split('\n').map(line => {
    if (!line.includes(anchor)) return line
    // 找到这一段结束（下一个空行）再插
    return line
  }).join('\n')

  const lines = out.split('\n')
  const at = lines.findIndex(l => l.includes(anchor))
  if (at < 0) { missed.push(anchor.slice(0, 30)); continue }
  lines.splice(at + 1, 0, '', tag)
  out = lines.join('\n')
  done++
}

console.log('配图 ' + done + ' / ' + PLACEMENT.length + ' 张')
if (missed.length) {
  console.log('未找到锚点：')
  missed.forEach(m => console.log('  - ' + m))
}

const n = (out.match(/^!\[/gm) || []).length
console.log('\n正文配图：' + n + ' 张')
console.log('正文字数：' + out.replace(/\s/g, '').length)

if (process.argv.includes('--save')) {
  fs.writeFileSync(F, out, 'utf8')
  console.log('\n已写回 data/body.md')
} else {
  console.log('\n（预览模式，加 --save 才写盘）')
}