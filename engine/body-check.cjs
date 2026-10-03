const fs = require('fs')
const F = 'data/body.md'
const b = fs.readFileSync(F, 'utf8')
const paras = b.split('\n\n').map(p => p.trim()).filter(Boolean)

let bad = 0

console.log('\n  正文结构体检')
console.log('  ' + '-'.repeat(56))

// 1. 超长段落（粘连迹象）
const long = paras.filter(p => p.replace(/\s/g, '').length > 150 && !p.startsWith('|'))
if (long.length) {
  bad++
  console.log('  FAIL 超长段落 ' + long.length + ' 个（可能是两段被粘在一起）:')
  long.forEach(p => console.log('        ' + p.length + ' 字 …' + p.slice(0, 50)))
} else {
  console.log('  PASS 没有超长段落（段落粘连）')
}

// 2. 一行里出现两个以上句号块
const multi = paras.filter(p => (p.match(/[。！？]/g) || []).length > 6 && !p.startsWith('|'))
if (multi.length) {
  console.log('  提示 ' + multi.length + ' 个段落句号较多（不一定有问题，看内容）:')
  multi.slice(0, 3).forEach(p => console.log('        ' + p.length + ' 字'))
}

// 3. 英文双引号残留（中文正文里该用「」）
const q = (b.match(/"/g) || []).length
if (q) { bad++; console.log('  FAIL 英文双引号 ' + q + ' 处（中文正文该用「」）') }
else console.log('  PASS 没有英文双引号')

// 4. 引号配对
const open = (b.match(/「/g) || []).length
const close = (b.match(/」/g) || []).length
if (open !== close) { bad++; console.log('  FAIL 引号不配对：「' + open + ' 」' + close) }
else console.log('  PASS 引号配对（' + open + ' 对）')

// 5. 加粗配对
const bold = (b.match(/\*\*/g) || []).length
if (bold % 2) { bad++; console.log('  FAIL 加粗星号不成对（' + bold + ' 个）') }
else console.log('  PASS 加粗配对（' + bold / 2 + ' 处）')

// 6. 必填要素
const must = [
  ['正文长度', b.replace(/\s/g, '').length > 3000],
  ['有小节标题', (b.match(/^## /gm) || []).length >= 8],
  ['有配图', (b.match(/^!\[/gm) || []).length >= 1],
  ['有来源表', b.includes('| 来源 | 内容 | 日期 |')]
]
must.forEach(([n, ok]) => {
  if (!ok) bad++
  console.log((ok ? '  PASS ' : '  FAIL ') + n)
})

console.log('  ' + '-'.repeat(56))
console.log(bad ? '  ' + bad + ' 项问题' : '  结构正常')
process.exit(bad ? 1 : 0)