/**
 * 修复 line-check 的误报 + 精确定位真正的粘连
 *
 * 第一版把「句号后没空格」当成问题 —— 中文本来就不用空格，58 行里 50 多行是误报。
 * 误报的闸门等于没闸门，这一版只保留能真正识别的判据。
 */
const fs = require('fs')
const F = 'data/body.md'
const lines = fs.readFileSync(F, 'utf8').split('\n')

let bad = 0
console.log('\n  粘连检测（去掉误报后的版本）')
console.log('  ' + '='.repeat(66))

lines.forEach((l, i) => {
  const bare = l.replace(/\*\*/g, '')
  const issues = []

  // 1. 标题粘进正文
  //    判据：一行的开头不是 #，但中间出现了行首标题符号 → 说明前面粘了正文
  //    （第一版用 indexOf('## ') > 0，把行首的 "### 来源" 也判成粘连 ——
  //      因为 "### " 里含 "## "，indexOf 找到位置 1。加 ^ 锚点就没这问题。）
  const isHeading = /^#{1,6}\s/.test(bare)
  if (!isHeading && /#{2,6}\s/.test(bare)) issues.push('标题粘在句中')

  // 2. 超长行 = 粘连
  //    阈值用实测定的，不是拍的：正常稿子行长中位数 29 字，最长 117 字，
  //    超过 120 的 0 行。所以 130 是「正常绝对到不了」的位置。
  //    第一版定 110，结果把 112 和 117 字的正常长句判成粘连 —— 误报的闸门等于没闸门。
  if (bare.length > 130) issues.push('超长（' + bare.length + ' 字），疑似粘连')

  // 3. 空残句：去掉标点和加粗后几乎没内容
  const core = bare.replace(/[？?。，、；：""''（）《》\s]/g, '')
  if (core.length <= 1 && bare.trim().length > 0) issues.push('空残句「' + bare.trim() + '」')

  // 4. 加粗不配对（单行内）
  if ((l.match(/\*\*/g) || []).length % 2 === 1) issues.push('加粗单行不成对')

  if (issues.length) {
    bad++
    console.log('  行' + (i + 1) + '  ' + issues.join(' / '))
    console.log('       ' + l.slice(0, 96))
  }
})

console.log('  ' + '='.repeat(66))
console.log(bad ? '  ' + bad + ' 行真有问题' : '  没有粘连')
console.log('')
process.exit(bad ? 1 : 0)