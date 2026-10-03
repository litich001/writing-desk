/** 全库乱码扫描：找出「存进去就不是人话」的文本 */
import fs from 'node:fs'
import path from 'node:path'

const ROOT = path.dirname(new URL('.', import.meta.url).pathname.replace(/%E/g, '%E').replace(/\/$/, ''))
const root = process.argv[2] || 'E:/文档/默认项目/写作台'

const walk = d => {
  const out = []
  for (const f of fs.readdirSync(d, { withFileTypes: true })) {
    if (f.name === 'node_modules' || f.name === '.git') continue
    const p = path.join(d, f.name)
    if (f.isDirectory()) out.push(...walk(p))
    else if (/\.(js|mjs|css|html|json|md|txt)$/i.test(f.name)) out.push(p)
  }
  return out
}

const BAD = [
  ['U+FFFD 替换符', /�/],
  ['锟斤拷', /锟斤拷/],
  ['ï»¿ (BOM 被当文本)', /ï»¿/],
  ['æ 开头 (UTF-8 当 Latin-1)', /æ[\u0080-\u00ff]{1,}/],
  ['â€ 开头 (UTF-8 当 Latin-1)', /â[\u0080-\u00ff]{1,}/],
  ['Ã 开头的西欧乱码', /Ã[\u0080-\u00bf]{1,}/],
  ['连续 3 个以上问号', /\?{3,}/],
  ['U+0000-U+0008 控制符', /[\u0000-\u0008]/],
  ['孤立代理项', /[\uD800-\uDFFF](?![\uDC00-\uDFFF])/]
]

let bad = 0
console.log('\n' + '='.repeat(66))
console.log('  乱码扫描')
console.log('='.repeat(66))
const SELF = path.basename(new URL(import.meta.url).pathname)
for (const f of walk(root)) {
  if (path.basename(f) === SELF) continue   // 本脚本含检测模式本身，会自我误报
  let t
  try {
    const raw = fs.readFileSync(f)
    const bom = raw[0] === 0xef && raw[1] === 0xbb && raw[2] === 0xbf
    t = raw.toString('utf8')
    if (t.includes('�') && bom) { /* 仍是替换符，说明原文件已坏 */ }
    const rel = f.replace(root.replace(/\\/g, '/'), '').replace(/^\//, '')
    const hits = BAD.filter(([, re]) => re.test(t)).map(([n]) => n)
    if (hits.length) {
      bad++
      console.log(`  ✗ ${rel}`)
      console.log(`      ${hits.join(' / ')}`)
      for (const [n, re] of BAD) {
        const m = re.exec(t)
        if (m) {
          const i = m.index
          console.log(`      位置 ${i}: …${t.slice(Math.max(0, i - 30), i + 30).replace(/\n/g, ' ')}…`)
          break
        }
      }
    }
  } catch (e) { }
}
console.log('='.repeat(66))
console.log(bad ? `  ${bad} 个文件存在乱码` : '  ✓ 未发现乱码（文本层干净，问题不在存盘）')
console.log('='.repeat(66) + '\n')
