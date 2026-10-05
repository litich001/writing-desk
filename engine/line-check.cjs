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

  // 6. 图片没有独占整行
  //    反测三种坏法时发现的：图片混在句子里，第 5 类判据抓不到
  //    （因为它不在行首），那次只是被「超长」顺手抓到。
  //
  //    ★ 靠顺带抓到等于没抓到 —— 那行只要短一点就漏。
  //    所以直接判：行里有 ![ 但不在行首，就是错的。
  //    markdown 图片必须独立成行，混在句子里前后文都会被劈开。
  if (l.indexOf('![') >= 0 && !/^\s*!\[/.test(l)) {
    issues.push('图片没有独占整行（混在句子里会把前后文劈开）')
  }

  // 5. 图片劈开了段落
  //    插图时把图放进段落中间，句子会被劈成两半，
  //    前半句在图前面，后半句在图后面。
  //    实测过一次：上面的四类判据全过，稿子照样是坏的 ——
  //    没有标题、没有超长行、不是空残句、加粗在上一行是成对的。
  //    所以这类只能靠「结构」认：图片后面紧跟正文就是劈开。
  if (/^!\[/.test(l.trim())) {
    /* 5a 同一行：图片语法结束后还剩正文 —— 这是事故的原样形态。
       实测那行是
         ![…](/data/images/x.jpg)26名嫌疑人落网，9人已被…
       图片在行首，正文在同一行后面。
       原来只看下一行，差一个位置就漏了。 */
    const rest = l.trim().replace(/^!\[[^\]]*\]\([^)]+\)/, '')
    if (rest && /[\u4e00-\u9fa5A-Za-z0-9]/.test(rest[0])) {
      issues.push('5a 图片后面同一行还跟着正文「' + rest.slice(0, 18) + '」')
    }

    /* 5b 下一行 */
    const nx = (lines[i + 1] || '').trim()
    const 结构允许 = !nx || /^#|^\||^!\[|^---|^>/.test(nx)
    if (!结构允许 && /[\u4e00-\u9fa5A-Za-z0-9]/.test(nx[0])) {
      issues.push('5b 图片劈开了段落，下一行接的是正文')
    }
  }

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