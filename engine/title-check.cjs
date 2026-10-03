/**
 * 修标题与正文不符
 *
 * 症状：project.title = 「济公」火的那一年，他闲了二十年
 *       body.md      = 一年举报1520次的人，不该被当成消费者
 *       —— 标题是上一篇的，正文是这一篇的。
 *
 * 根因：写稿只覆盖 body.md，没人管 project.title。
 *       而 titleIdeas 还在的时候，标题是本地拼的，拼完也不写回 project。
 *
 * 修法：
 *   1. 立刻把标题对齐到正文
 *   2. 加一个校验脚本，以后每次改完稿子跑一下，不一致就报出来
 */
const fs = require('fs')
const path = require('path')

const ROOT = __dirname.replace(/[\\/]engine$/, '')
const P = path.join(ROOT, 'data', 'project.json')
const B = path.join(ROOT, 'data', 'body.md')

const proj = JSON.parse(fs.readFileSync(P, 'utf8').replace(/^\uFEFF/, ''))
const body = fs.readFileSync(B, 'utf8')

/* 从正文找主题线索 */
const firstLine = body.split(/\n/).map(s => s.trim()).filter(Boolean)[0] || ''
const heads = (body.match(/^## .+$/gm) || []).map(h => h.replace(/^## /, ''))

/* 判定标题与正文是否配套：
   标题里的关键信息（数字、人名、引号内词）应该在正文里出现 */
function check(title, bodyText) {
  const clean = String(title || '').replace(/[「」《》"']/g, '')
  if (!clean) return { ok: false, why: '标题是空的' }

  // 取标题里最实的信息：数字、2字以上的专名
  const nums = clean.match(/\d+/g) || []
  const chars = clean.split('').filter(c => /[一-龥]/.test(c))
  // 标题里的连续实词（2~4 字）在正文出现的比例
  const grams = []
  for (let i = 0; i + 2 <= chars.length; i += 2) grams.push(chars.slice(i, i + 2).join(''))
  const hit = grams.filter(g => bodyText.includes(g)).length
  const ratio = grams.length ? hit / grams.length : 0

  const numMiss = nums.filter(n => !bodyText.includes(n))
  if (numMiss.length) return { ok: false, why: '标题里的数字 ' + numMiss.join(',') + ' 正文里没有' }
  if (ratio < 0.3) return { ok: false, why: '标题用词与正文重合度 ' + (ratio * 100).toFixed(0) + '%，太低' }
  return { ok: true, ratio }
}

console.log('\n  标题 / 正文 配套检查')
console.log('  ' + '-'.repeat(58))
console.log('  正文首行：' + firstLine.slice(0, 46))
console.log('  当前标题：' + (proj.title || '(空)'))
console.log('')

const r = check(proj.title, body)
if (r.ok) {
  console.log('  ✓ 标题与正文配套（用词重合 ' + (r.ratio * 100).toFixed(0) + '%）')
} else {
  console.log('  ✗ ' + r.why)
  console.log('')

  /* 不给标题候选 —— 标题要理解全文才能起，本地拼不出来就是拼不出来。
     但可以告诉用户这篇文章里有哪些「实料」可以拿来做标题。
     这是事实清单，不是标题模板：只是把稿子里现成的东西列出来。 */
  console.log('  这篇稿子里可以拿去当标题的实料：')
  const facts = []
  const push = (kind, v) => { if (v && !facts.some(f => f.v === v)) facts.push({ kind, v }) }

  // 开头那句里的数字
  const lead = firstLine.match(/\d+/g) || []
  lead.slice(0, 2).forEach(n => push('开头数字', n))
  // 小节标题里的数字和判断
  heads.slice(0, 6).forEach(h => {
    const n = h.match(/\d+/)
    if (n) push('小节', n[0] + '（' + h.replace(/^[^0-9]*\d+\s*/, '').slice(0, 12) + '…）')
  })
  // 正文中反复出现的 4 字词
  const freq = new Map()
  for (const m of body.matchAll(/[一-龥]{4}/g)) freq.set(m[0], (freq.get(m[0]) || 0) + 1)
  ;[...freq.entries()].filter(([, c]) => c >= 4).sort((a, b) => b[1] - a[1]).slice(0, 6)
    .forEach(([w, c]) => push('高频词', w + ' ×' + c))

  facts.slice(0, 10).forEach(f => console.log('    · [' + f.kind + '] ' + f.v))
  console.log('')
  console.log('  → 这些是原料，成品标题要靠理解全文后自己写。')
  console.log('    成稿页点「复制『起标题』的要求」，粘到 AI 那边，会按这些原料出 8 个方向。')
  console.log('')

  /* 接受新标题的两种传法：
       node engine/title-check.cjs "标题"        ← 直接传
       node engine/title-check.cjs --set=标题      ← 等号形式
     后面这种是为了绕开 PowerShell 把带空格的引号参数吃掉的问题
     （踩过：argv[2] 直接 undefined，中文参数根本没进来）。 */
  const arg = process.argv.slice(2).join(' ').trim()
  const viaEq = arg.replace(/^--set=/, '').trim()
  const newTitle = viaEq || arg

  if (newTitle && newTitle !== '--set=') {
    proj.title = newTitle
    fs.writeFileSync(P, JSON.stringify(proj, null, 2), 'utf8')
    console.log('  已写入标题：' + newTitle)
    const again = check(proj.title, body)
    console.log('  复查：' + (again.ok ? '配套（重合 ' + (again.ratio * 100).toFixed(0) + '%）' : again.why))
  } else {
    console.log('  拿到标题后：node engine/title-check.cjs --set=你的标题')
  }
  process.exit(newTitle ? 0 : 1)
}
console.log('')
