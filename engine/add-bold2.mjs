/**
 * 重写后补加粗
 *
 * 重写正文时把加粗丢了（只剩 4 处，每千字 1.0，远低于 8~12 的健康区间）。
 * 用户明确要求「有强调的内容，有一些重点，不然通篇下来都是长文」。
 *
 * 规则明确，三类才加：
 *   1. 核心数字  2. 核心判断  3. 关键原话
 * 相邻两段不都加粗（会互相抢）—— 脚本按顺序检查。
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const F = path.join(ROOT, 'data', 'body.md')
let body = fs.readFileSync(F, 'utf8')

const MARKS = [
  // 一、成本表
  '1520 次',
  '也没有说赚了多少钱',
  '这两句没写出来，比写出来更值得看',
  '1520 次投诉是有成本的',
  '愤怒不会是这么分布的，排班才会',
  '划算。',

  // 二、退一赔三
  '退一赔三',
  '《消费者权益保护法》第五十五条',
  '惩罚性赔偿，针对的是主观恶意',
  '问题出在重复使用上',
  '找到一条能赔的路，然后把它跑成一条流水线',
  '难的是要天天跑',

  // 三、12315
  '12315 是全国统一的投诉举报平台',
  '能去的地方就是 12315',
  '现在有两个人的报告塞在这个入口里',
  '他可能等，也可能算了',
  '算的那个，就成了成本',

  // 四、终止调解
  '终止调解，不是终止处理',
  '我不陪你演了，但你举报的违法线索，我照样查',
  '这两件事必须同时成立，缺一件都不对',
  '只终止调解不核查，就是纵容',
  '只核查不终止调解，就是消耗',
  '把人的通道掐了，把事的通道留着',

  // 五、为什么不动
  '近一年，不是近一个月',
  '不是不知道，是不敢动',
  '职业索赔者在打假，而且打的多半是真的',
  '你停掉他的通道，就等于同时停掉了那些真的线索',
  '动机不纯和内容属实，这两件事同时为真',
  '不合并，就不矛盾',

  // 六、这条线
  '终止调解是一把刀',
  '分界线在哪？',
  '数据不会撒谎，但前提是你真的去看了',

  // 七、内容是真的
  '他们举报的内容是真的，而且不简单',
  '3C 认证要进认证官网查，广告法要一条条比对',
  '前半句是骂他们，后半句是认他们的举报',
  '你们查了吗',
  '只终止调解，不管核查，是懒政',

  // 八、给核查腾位置
  '终止调解是终局性的',
  '这句话的重量，比整篇通报都重',
  '做了一半的处理，比不做还麻烦',

  // 九、数字怎么看
  '这两个比例不算特别高',
  '全部是火灾报警设备',
  '全部是营养品',
  '品类完全集中，加上次数极大，这就不是个人行为了，这是流水线',

  // 十、最后
  '这两句哪个都不能少',
  '这套处理是成对的',
  '这条路能走通。但要有人愿意走到底',
  '通报没有说'
]

let done = 0
const missed = []
for (const m of MARKS) {
  const bolded = '**' + m + '**'
  if (body.includes(bolded)) { done++; continue }
  if (!body.includes(m)) { missed.push(m.slice(0, 30)); continue }
  body = body.replace(m, bolded)
  done++
}

console.log('加粗 ' + done + ' / ' + MARKS.length + ' 处')
if (missed.length) {
  console.log('未匹配：')
  missed.forEach(m => console.log('  - ' + m))
}

const chars = body.replace(/\s/g, '').length
const n = (body.match(/\*\*/g) || []).length / 2
console.log('\n加粗 ' + n + ' 处，每千字 ' + (n / chars * 1000).toFixed(1) + '（目标 8~12）')
console.log('字数 ' + chars)

if (process.argv.includes('--save')) {
  fs.writeFileSync(F, body, 'utf8')
  console.log('\n已写回')
} else {
  console.log('\n（预览，加 --save 写盘）')
}