/**
 * 配图：按「这张图在这段起什么作用」决定位置，不随机插
 *
 * 两张图：
 *   1. 王英本人架相机 —— 放第一节后，读者先看见人
 *   2. 野外拍摄 —— 放第二节后，那是全文最动人的一段
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const F = path.join(ROOT, 'data', 'body.md')
let body = fs.readFileSync(F, 'utf8')

const PLACE = [
  {
    file: 'jz_muqxrary_1.png',
    // 第一节末尾：交代完事情，读者该看见这个人了
    after: '这是她自己说的。十五万块，换一个月。',
    tag: '![图：王英在野外架着长焦相机。图/云南广播电视台 YNTV2《都市条形码》](jz_muqxrary_1.png)'
  },
  {
    file: 'jz_muqxrawf_2.png',
    // 第二节讲她在冰上等一个镜头那段之后
    after: '那不是"运气好"，那是她知道自己要什么，然后真的站在那儿等到了。',
    tag: '![图：王英在野外拍摄象海豹。图/云南广播电视台 YNTV2《都市条形码》](jz_muqxrawf_2.png)'
  }
]

let done = 0
const missed = []
for (const p of PLACE) {
  if (body.includes(p.file)) { done++; continue }
  if (!body.includes(p.after)) { missed.push(p.after.slice(0, 30)); continue }
  const lines = body.split('\n')
  const at = lines.findIndex(l => l.includes(p.after))
  if (at < 0) { missed.push(p.after.slice(0, 30)); continue }
  lines.splice(at + 1, 0, '', p.tag)
  body = lines.join('\n')
  done++
}

console.log('配图 ' + done + ' / ' + PLACE.length + ' 张')
if (missed.length) {
  console.log('未找到锚点：')
  missed.forEach(m => console.log('  - ' + m))
}

console.log('\n正文配图 ' + (body.match(/^!\[/gm) || []).length + ' 张')
console.log('字数 ' + body.replace(/\s/g, '').length)

if (process.argv.includes('--save')) {
  fs.writeFileSync(F, body, 'utf8')
  console.log('\n已写回')
} else {
  console.log('\n（预览，加 --save 写盘）')
}