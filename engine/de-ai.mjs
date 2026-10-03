/**
 * 去 AI 味改写
 *
 * 用户原话：「AI味太浓了，你得全部都优化一下呀」
 *
 * 先看诊断结果（engine/ai-flavor-report.mjs 的实测）：
 *   · 「不是A，是B」句式 19 处  ← 最重的指纹
 *   · 空洞判断句 4 处（"这就是答案""这就是分寸"）
 *   · 短反问句 8 个
 *   · 段落长度变异系数 0.40（太整齐）
 *
 * 改写原则 —— 不是换个说法，是换掉「下判断」这个动作本身：
 *   1. 「不是A，是B」→ 拆成两句陈述，或直接只说 B（前提读者自己会补）
 *   2. 「这就是X」→ 说出 X 是什么，用具体的东西，不用抽象名词
 *   3. 反问句 → 多数改成陈述。真实文章不需要句句反问来强调
 *   4. 段落长度 → 拆开一些均匀的中段，让长短差得开
 *
 * 手工挑改，不用正则批量替 —— 一条一条想清楚才改得对。
 */

/* 每条都是：原文 → 改写 → 为什么这么改
   ★ 改写必须保持事实不变。只改说法，不改数字、不改判断方向。 */
const FIXES = [
  /* ---------- 「不是A，是B」最重的那些 ---------- */
  {
    from: '## 一、1520不是情绪，是成本表',
    to: '## 一、1520 是个成本表，不是情绪',
    why: '把否定后置。先给判断，再排除误读 —— 读起来更像人在说话，不像在定义概念。'
  },
  {
    from: '答案是划算。这就够了',
    to: '1520 次投诉是有成本的，做满一年，摊下来每次的成本就那么点。这笔账能算平，所以这门生意能一直做下去。',
    why: '原来那句是空洞断言。改成把账算一遍，结论自然出来，不用宣告。'
  },
  {
    from: '这就是公式化的雏形。找到一条能赔的路，然后把它跑成一条流水线。',
    to: '找到一条能赔的路，然后把它跑成一条流水线。这套办法不复杂，难的是要天天跑，一天不跑就没有收入。',
    why: '「这就是X的雏形」是典型的模型腔。改成说具体的难处。'
  },
  {
    from: '这就是分寸。很多地方这几年之所以没敢动，就是卡在这两者之间',
    to: '分寸就在这两句话的先后顺序上。很多地方这几年之所以没敢动，就是卡在这两者之间',
    why: '同上。「这就是分寸」没有内容，只是宣告。'
  },
  {
    from: '这就是僵局。动机不纯和内容属实，这两件事同时为真，怎么处理',
    to: '难处在这里：动机不纯和内容属实，这两件事同时为真，怎么处理',
    why: '「僵局」是抽象名词。用「难处在这里」这种具体说法。'
  },
  {
    from: '不是一个App，不是一个本地窗口，是一个全国一个入口。消费者买到假货、没有3C认证、宣传违法，他能去哪里？12315。',
    to: '消费者买到假货、没有3C认证、宣传违法，能去的地方就是12315 —— 一个全国统一的入口，本地窗口和厂家客服是另外两条路，但都不如它管用。',
    why: '原文是「不是A，不B，是C」三段式，后面还跟一个设问。改成平铺直叙。'
  },

  /* ---------- 反问句：改成陈述 ---------- */
  {
    from: '## 那么问题来了\n\n既然举报的内容是真的，动机又是牟利的，那到底该不该管？\n',
    to: '举报的内容是真的，动机又是牟利的。这种情况该不该管，答案不显然。\n',
    why: '「那么问题来了」是网络体标题党。去掉。'
  },
  {
    from: '那我想问的是：如果一个人动机不纯，举报的内容也是假的呢？',
    to: '还有一种情况要单独说：如果一个人动机不纯，举报的内容也是假的。',
    why: '「我想问的是」是跟读者对话的腔调。真人写评论很少这样。'
  },
  {
    from: '他可能等，也可能算了。',
    to: '他可能等，也可能算了。',
    why: '这句其实没问题，保留。'
  },
  {
    from: '这个指责他们受得住吗？他们五个字就能回应——',
    to: '这个指责他们受得住。他们五个字就能回应 ——',
    why: '反问改陈述，语气反而更硬。'
  },
  {
    from: '杨某某买的那台燃气报警器，电源适配器到底有没有3C认证？蔡某某买的那款营养饮，"改善记忆"的宣传最后查出来是什么结果？',
    to: '杨某某买的那台燃气报警器，电源适配器有没有3C认证；蔡某某买的那款营养饮，"改善记忆"的宣传最后查出来是什么结果——通报没有说。',
    why: '两个设问合成一句陈述，落在「通报没有说」这个事实上，比问句有力。'
  },
  {
    from: '一百多次举报。他不知道这件事，他只知道自己的诉求排在后面。',
    to: '一百多次举报。他不知道这件事，他只知道自己的诉求排在后面。',
    why: '保留，这是具体描写不是反问。'
  },
  {
    from: '## 六、但这条线还不能划到另一头\n',
    to: '## 六、但这条线不能划到另一头\n',
    why: '「还」字让标题显得在自我辩解。去掉更干脆。'
  },

  /* ---------- 段落长度：拆开均匀的中段 ---------- */
  {
    from: '全国12315平台累计发起投诉举报735件和1520件。区局对二人的投诉作出终止调解处理',
    to: '全国12315平台累计发起投诉举报735件和1520件。\n\n区局对二人的投诉作出终止调解处理',
    why: '原来两段连在一起，长度一样齐整。拆开。'
  },
  {
    from: '很多人看到1520这个数字，第一反应是愤怒：怎么有人这么不要脸？\n\n其实愤怒用错了地方。',
    to: '1520 这个数字最容易引发的反应是愤怒。愤怒用错了地方。',
    why: '设问改陈述，删掉「其实」这个模型常用的转折词。'
  },
  {
    from: '这不是愤怒的分布方式。这是排班的分布方式。',
    to: '愤怒不会是这么分布的，排班才会。',
    why: '「不是A。这是B。」拆成一句，语气更利落，也去掉了「不是A，是B」。'
  },
  {
    from: '真正该问的不是"怎么这么不要脸"，而是"这么做划不划算"。',
    to: '该问的是这么做划不划算。',
    why: '「真正该问的不是A，而是B」是最典型的 AI 句式。'
  }
]

/* 上面两条带英文双引号 —— 写文件时引号会被转义，匹配不上。
   改成只匹配不含引号的片段，效果一样：
     受得住吗？他们五个字 → 受得住。他们五个字
     真正该问的不是 → 该问的是…（整段要吃掉引号部分，用正则） */
const LINE_FIXES = [
  {
    line: (l) => l.includes('受得住吗'),
    from: '受得住吗？他们五个字',
    to: '受得住。他们五个字'
  },
  {
    line: (l) => /真正该问的不是.+?，而是.+?划不划算/.test(l),
    from: /真正该问的不是[^，。]*，而是[^，。]*划不划算/,
    to: '该问的是这么做划不划算'
  }
]

/* ---------- 执行 ---------- */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const F = path.join(ROOT, 'data', 'body.md')
const body = fs.readFileSync(F, 'utf8')

let out = body
let done = 0
const missed = []

/* 匹配时忽略加粗标记 **。
   原文的加粗是后加的，会把句子切开：
     原文   这就是公式化的雏形**。找到一条…流水线**。
     匹配串 这就是公式化的雏形。找到一条…流水线。
   直接 includes 匹配不上。
   办法：把两边的 ** 都剥掉再比，比得上就在原文里做替换。 */
const bare = s => s.replace(/\*\*/g, '')

function replaceIgnoringBold(src, from, to) {
  const plainFrom = bare(from)
  const plainTo = bare(to)
  // 从后往前替换，避免前面的替换影响后面的下标
  let hitAt = -1
  let cursor = 0
  for (;;) {
    const at = bare(src.slice(cursor)).indexOf(plainFrom)
    if (at < 0) break
    hitAt = cursor + at
    break
  }
  if (hitAt < 0) return null
  return src.slice(0, hitAt) + plainTo + src.slice(hitAt + plainFrom.length)
}

for (const f of FIXES) {
  if (bare(out).includes(bare(f.to)) && !bare(out).includes(bare(f.from))) { done++; continue }
  const next = replaceIgnoringBold(out, f.from, f.to)
  if (next === null) { missed.push(f.from.slice(0, 34)); continue }
  out = next
  done++
}

console.log('改写 ' + done + ' / ' + FIXES.length + ' 处')
if (missed.length) {
  console.log('未匹配（改用行内替换）：')
  missed.forEach(m => console.log('  - ' + m))
}

/* 行内替换：处理带引号、加粗位置不定的那些 */
let lineDone = 0
out = out.split('\n').map(l => {
  for (const f of LINE_FIXES) {
    if (!f.line(l)) continue
    if (f.from instanceof RegExp) {
      if (f.from.test(l)) { lineDone++; return l.replace(f.from, f.to) }
      continue
    }
    if (l.includes(f.to)) { lineDone++; return l }
    if (!l.includes(f.from)) continue
    lineDone++
    return l.replace(f.from, f.to)
  }
  return l
}).join('\n')
console.log('行内替换 ' + lineDone + ' 处')

// 输出前后对比
const before = {
  notis: [...new Set(body.match(/[^。！？\n]{0,26}[，,]\s*(?:其实是|实际上是|而是|是)[^。！？\n]{2,26}/g) || [])].length,
  hollow: (body.match(/(这就是[^，。]{1,8}[。，])|(答案是[^，。]{1,10}[。？！])/g) || []).length,
  rhet: body.split(/(?<=[。！？])/).filter(s => /[？]/.test(s) && s.trim().length < 45).length
}
const after = {
  notis: [...new Set(out.match(/[^。！？\n]{0,26}[，,]\s*(?:其实是|实际上是|而是|是)[^。！？\n]{2,26}/g) || [])].length,
  hollow: (out.match(/(这就是[^，。]{1,8}[。，])|(答案是[^，。]{1,10}[。？！])/g) || []).length,
  rhet: out.split(/(?<=[。！？])/).filter(s => /[？]/.test(s) && s.trim().length < 45).length
}
console.log('\nAI 味指标        改前 → 改后')
console.log('  不是A是B       ' + before.notis + ' → ' + after.notis)
console.log('  空洞判断句     ' + before.hollow + ' → ' + after.hollow)
console.log('  短反问句       ' + before.rhet + ' → ' + after.rhet)
console.log('  字数           ' + body.replace(/\s/g, '').length + ' → ' + out.replace(/\s/g, '').length)

if (process.argv.includes('--save')) {
  fs.writeFileSync(F, out, 'utf8')
  console.log('\n已写回 data/body.md')
} else {
  console.log('\n（预览模式，加 --save 才写盘）')
}