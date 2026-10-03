/**
 * 给这篇加粗
 * 口语闲谈不适合满屏加粗（会打断说话的节奏），密度取下限 8/千字。
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const F = path.join(ROOT, 'data', 'body.md')
let body = fs.readFileSync(F, 'utf8')

/* 口语闲谈里，加粗只给「需要停顿一下」的地方：
   事实、转折、结论。原话可以加，因为说话时的重音就是这样。 */
const MARKS = [
  '但它不是"旅游治病"',
  '2013年，退休前夕，她被诊断出甲状腺癌',
  '十五万，去一个月。',
  '就我一个人在那里坚持，我拍到了',
  '"你的肿瘤小了，一个月的变化，不用马上做手术，可以继续观察。"',
  '是"继续观察"',
  '不是"好了"',
  '甲状腺癌里头，确实有那么一小撮情况会自己变小',
  '她现在的情况报道里也没说',
  '这跟她有没有治好病，是两回事',
  '"走的地方多了，见的东西多了，看淡了，想开了，有些东西真的就不会再计较了。"',
  '"活过来"',
  '拍鸟的人我知道一点',
  '大部分人的"想去南极"是朋友圈里的一个定位，是"下次吧"',
  '她是真的去了',
  '"可以继续观察"，观察不是治愈',
  '她能做成，是因为她本来就具备这些条件',
  '我们只看到结果，看不到前提',
  '旁边的人都撤了，她还在',
  '她说我太高兴了',
  '能说出这句话的人，人生里肯定有那么一两个瞬间是"活过来"的',
  '她就是想做那一个镜头，然后她真的去站住了'
]

let done = 0
const missed = []
for (const m of MARKS) {
  if (body.includes('**' + m + '**')) { done++; continue }
  if (!body.includes(m)) { missed.push(m.slice(0, 32)); continue }
  body = body.replace(m, '**' + m + '**')
  done++
}

console.log('加粗 ' + done + ' / ' + MARKS.length + ' 处')
if (missed.length) {
  console.log('未匹配：')
  missed.forEach(m => console.log('  - ' + m))
}

const chars = body.replace(/\s/g, '').length
const n = (body.match(/\*\*/g) || []).length / 2
console.log('\n加粗 ' + n + ' 处，每千字 ' + (n / chars * 1000).toFixed(1) + '（口语体取下限，目标 8~12）')
console.log('字数 ' + chars)

if (process.argv.includes('--save')) {
  fs.writeFileSync(F, body, 'utf8')
  console.log('\n已写回')
} else {
  console.log('\n（预览，加 --save 写盘）')
}