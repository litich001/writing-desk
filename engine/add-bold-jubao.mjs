/**
 * 给正文加 Markdown 粗体
 *
 * 密度目标：每千字 8~12 处（5000 字 → 40~60 处）。
 * 低于 3 处是「没重点」，高于每千字 12 处是「一片高亮」。
 *
 * 规则明确，三类才加：
 *   1. 核心数字 —— 读者要记住的
 *   2. 核心判断 —— 段落里的结论，不是每句都加
 *   3. 关键原话 —— 通报里的原话、法条名称
 * 相邻两段不都加粗，会互相抢。
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const F = path.join(ROOT, 'data', 'body.md')
const raw = fs.readFileSync(F, 'utf8')

const MARKS = [
  // 开头：结论前置
  '1520次。这个数字本身就是答案',
  '通报里没有说他们有没有牟利。也没说他们赚了多少钱',
  '这恰恰是通报最狠的地方',
  '其实愤怒用错了地方',
  '1520次投诉是有投入的',
  '这不是愤怒的分布方式。这是排班的分布方式',
  '真正该问的不是"怎么这么不要脸"，而是"这么做划不划算"',
  '答案是划算。这就够了',

  // 退一赔三
  '退一赔三',
  '《消费者权益保护法》第五十五条',
  '问题出在"重复使用"上',
  '找到一条能赔的路，然后把它跑成一条流水线',

  // 12315
  '12315是全国统一的投诉举报平台',
  '现在有两个人的报告塞在这个入口里',
  '他前面可能有一个人，已经就同一类商品发过一百多次举报',
  '算的那个，就成了成本',

  // 终止调解
  '终止调解，不是终止处理',
  '《市场监督管理投诉举报处理办法》第十六条第一款第（三）项和第二十三条第一款第（六）项',
  '第十七条第一款第（二）项',
  '翻译成人话：我不陪你演了，但你举报的违法线索，我照样查',
  '这两件事必须同时成立，缺一件都不对',
  '只终止调解不核查，就是纵容',
  '只核查不终止调解，就是消耗',
  '把人的通道掐了，把事的通道留着',

  // 为什么拖这么久
  '按区局的说法，杨某某在近一年内累计投诉举报735件，蔡某某1520件。近一年，不是近一个月',
  '不是不知道，是不敢动',
  '职业索赔者在打假，而且打的多半是真的',
  '你停掉他的通道，就等于同时停掉了那些真的线索',
  '动机不纯和内容属实，这两件事同时为真，怎么处理',
  '不合并，就不矛盾',

  // 这条线不能划到另一头
  '只终止调解不核查，就是纵容',
  '分界线在哪',
  '在品类集中度和诉求重复模式',
  '数据不会撒谎，但前提是你真的去看了',

  // 内容为真
  '3C认证要进认证官网查，广告法要一条条比对',
  '也就是说，他们举报的内容，是真的，而且不简单',
  '前半句是骂他们，后半句是认他们的举报',
  '这件事最微妙的地方',
  '只终止调解，不管核查，是懒政。只核查，不终止调解，是软磨',
  '终止调解这个动作，本质上是在给核查腾出空间',
  '它不减掉你举报的义务，只是让执法资源先花在核实事实',

  // 终止调解的副作用
  '终止调解是终局性的。一旦作出决定，这次投诉就结束了',
  '核查处置是主动行为，不是被动流程',
  '这句话的重量，比整篇通报都重',
  '做了一半的处理，比不做还麻烦',
  '因为它释放了一个信号：终止调解了，但这事没人管了',
  '这套处理是成对的',

  // 数字怎么看
  '这两个比例不算特别高',
  '全部是火灾报警设备',
  '全部是营养品',
  '品类完全集中，加上次数极大，这就不是个人行为了，这是流水线',
  '我写这些，不是为了给职业索赔者定性',
  '定性是监管部门的权责范围，不是我的',
  '少了"终止调解"，职业索赔会继续挤占通道',
  '少了"核查处置"，劣质的燃气报警器和无3C认证的电源适配器会继续卖',
  '这条路能走通。但要有人愿意走到底'
]

let out = raw
let done = 0
const missed = []

for (const mark of MARKS) {
  const bolded = '**' + mark + '**'
  if (out.includes(bolded)) { done++; continue }

  let hit = 0
  out = out.split('\n').map(line => {
    if (line.startsWith('|') || line.startsWith('>')) return line
    if (!line.includes(mark)) return line
    hit++
    if (hit > 1) return line
    return line.replace(mark, bolded)
  }).join('\n')

  if (hit) done++
  else missed.push(mark)
}

console.log('标记 ' + done + ' / ' + MARKS.length + ' 处')
if (missed.length) {
  console.log('\n未匹配（原文措辞不同，需核对）：')
  missed.forEach(m => console.log('  - ' + m.slice(0, 46)))
}
const chars = out.replace(/\s/g, '').length
const count = (out.match(/\*\*/g) || []).length / 2
console.log('\n正文加粗处: ' + count)
console.log('正文字数: ' + chars)
console.log('每千字: ' + (chars ? (count / chars * 1000).toFixed(1) : 0))

if (process.argv.includes('--save')) {
  fs.writeFileSync(F, out, 'utf8')
  console.log('\n已写回 data/body.md')
} else {
  console.log('\n（预览模式，加 --save 才写盘）')
}