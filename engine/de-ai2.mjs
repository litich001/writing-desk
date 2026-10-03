/* 第二轮去 AI 味：处理第一轮没覆盖到的
 *
 * 第一轮之后剩：
 *   · 空洞判断句 3 处
 *   · 「不是A，是B」16 处
 *   · 抽象名词「可能」
 *
 * 关键认识：光换措辞没用。真正的 AI 味来自
 * 「每个判断都要下一个结论」这个习惯。
 * 人写评论不是这样 —— 会把话说到七分，剩下三分留给读者。
 */
import fs from 'node:fs'
const F = 'data/body.md'
let body = fs.readFileSync(F, 'utf8')

const FIXES = [
  /* ---------- 空洞判断句：给出依据，而不是宣告 ---------- */
  {
    from: '这就是公式化的雏形',
    to: '办法就这么简单，简单到有点可怕',
    why: '「这就是X的雏形」是模型腔。换成具体感受。'
  },
  {
    from: '这就是分寸',
    to: '分寸就在这两句话的先后顺序上',
    why: '「这就是分寸」没有内容，只是宣告。改成点明在哪。'
  },
  {
    from: '答案是划算。这就够了',
    to: '划算。',
    why: '「这就够了」是 AI 常用的收尾强调。删掉，更利落。'
  },

  /* ---------- 「不是A，是B」剩下最重的几处 ---------- */
  {
    from: '这不是标签瑕疵，是产品合规问题',
    to: '标签瑕疵是小事，这个是产品合规问题',
    why: '「不是A，是B」改成「A 是小事，这个是 B」。'
  },
  {
    from: '**也就是说，他们举报的内容，是真的，而且不简单**',
    to: '**他们举报的内容是真的，而且不简单**',
    why: '「也就是说」是模型最爱的衔接词。'
  },
  {
    from: '一个正常人投诉，是发现问题，解决问题，结束',
    to: '一个正常人投诉，发现问题，解决问题，就结束了',
    why: '三个「是」排比太工整。拆开。'
  },
  {
    from: '**终止调解这四个字，是整套处理里最重的一步**',
    to: '**整套处理里最重的就是「终止调解」这四个字**',
    why: '把判断句的主语提前。'
  },
  {
    from: '**不是不知道，是不敢动**',
    to: '**不是不知道，是不敢动**',   // 这句本身是对的，保留
    why: '这句是真话，不改。列在这里是提醒自己：不是所有「不是A是B」都要改。'
  },
  {
    from: '很多人转发它，是为了表达愤怒。转发的时候顺手说一句"这种人就该拉黑"，很解气。',
    to: '很多人转发它是为了表达愤怒，顺手说一句「这种人就该拉黑」，很解气。',
    why: '两句合一，去掉「转发的时候」这个啰嗦的补充。'
  },
  {
    from: '大众印象里的职业打假，是那种专门在超市、商场找标签瑕疵、拍下、走人。',
    to: '大众印象里的职业打假，是在超市商场找标签瑕疵、拍下、走人。',
    why: '去掉多余的「那种」「专门」。'
  },

  /* ---------- 抽象名词 ---------- */
  {
    from: '但通报里真正值得注意的，不是1520，是"终止调解"后面跟着的那句"依法开展核查处置"。',
    to: '但通报里真正值得注意的不是1520，是「终止调解」后面那六个字：「依法开展核查处置」。',
    why: '「可能」这类抽象词换成具体的字数，「句子」换成「六个字」。'
  },

  /* ---------- 反问：把最后两个设问改成陈述落在事实上 ---------- */
  {
    from: '那我想问的是：如果一个人动机不纯，举报的内容也是假的呢？',
    to: '还有一种情况得单独说：如果一个人动机不纯，举报的内容也是假的。',
    why: '「我想问的是」是跟读者对话的腔调，真人写评论很少这样。'
  }
]

let done = 0
const missed = []
for (const f of FIXES) {
  if (body.includes(f.to) && !body.includes(f.from)) { done++; continue }
  if (!body.includes(f.from)) { missed.push(f.from.slice(0, 30)); continue }
  body = body.replace(f.from, f.to)
  done++
}

console.log('改写 ' + done + ' / ' + FIXES.length + ' 处')
if (missed.length) {
  console.log('未匹配：')
  missed.forEach(m => console.log('  - ' + m))
}

const cnt = s => ({
  notis: [...new Set(s.match(/[^。！？\n]{0,26}[，,]\s*(?:其实是|实际上是|而是|是)[^。！？\n]{2,26}/g) || [])].length,
  hollow: (s.match(/(这就是[^，。]{1,8}[。，])|(答案是[^，。]{1,10}[。？！])/g) || []).length,
  rhet: s.split(/(?<=[。！？])/).filter(x => /[？]/.test(x) && x.trim().length < 45).length
})
const b = cnt(fs.readFileSync(F, 'utf8'))
const a = cnt(body)
console.log('\n           改前 → 改后')
console.log('  不是A是B  ' + b.notis + ' → ' + a.notis)
console.log('  空洞判断  ' + b.hollow + ' → ' + a.hollow)
console.log('  短反问    ' + b.rhet + ' → ' + a.rhet)

if (process.argv.includes('--save')) {
  fs.writeFileSync(F, body, 'utf8')
  console.log('\n已写回')
} else {
  console.log('\n（预览，加 --save 写盘）')
}