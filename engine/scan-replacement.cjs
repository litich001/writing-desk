/* 扫描编码残渣（U+FFFD 替换符）。

   为什么需要：写文件时如果某个汉字被截断，会留下 U+FFFD。
   它不影响代码运行（只是注释里的一个字），但：
     · 说明写文件那一步出过问题，可能不止这一处
     · 用户在界面上/文档里看到会当成乱码
   肉眼扫不出来 —— 必须扫。

   第一版只扫了根目录的几个文件，漏掉 engine/ 下的，
   结果 audit-dead.mjs 里的一个残渣躲了好几轮。 */
const fs = require('fs')
const path = require('path')

const ROOT = __dirname.replace(/[\\/]engine$/, '')
const SKIP = new Set(['node_modules', '.git', 'data', 'docs'])
/* scan-garbled.mjs 和本文件自身要排除：
   它们体内本来就有 U+FFFD 字面量（那是它们的检测规则，不是残渣）。
   不排除的话永远扫不干净，闸门就废了。 */
const SELF = new Set(['scan-garbled.mjs', 'scan-replacement.cjs'])

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP.has(e.name)) continue
    const p = path.join(dir, e.name)
    if (e.isDirectory()) { walk(p, out); continue }
    if (SELF.has(e.name)) continue
    if (/\.(js|mjs|cjs|css|html|json|md|txt)$/i.test(e.name)) out.push(p)
  }
  return out
}

const files = walk(ROOT)
let total = 0

for (const f of files) {
  let t
  try { t = fs.readFileSync(f, 'utf8') } catch { continue }
  if (!t.includes('\uFFFD')) continue
  const hits = [...t.matchAll(/.{0,25}\uFFFD+.{0,25}/g)]
  total += hits.length
  console.log('  ' + path.relative(ROOT, f) + '  ' + hits.length + ' 处')
  hits.slice(0, 3).forEach(m => console.log('      ' + JSON.stringify(m[0])))
}

console.log('')
console.log(total ? '  有 ' + total + ' 处编码残渣' : '  全部干净，没有替换符')
process.exit(total ? 1 : 0)