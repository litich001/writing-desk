/* safe() 的行为测试：中文名要放行，路径穿越必须挡住
   这个函数保护着 /api/img-b64、图片删除、图片打包三处入口 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const src = fs.readFileSync(path.join(ROOT, 'server.mjs'), 'utf8')

// 把 safe 的函数体抠出来，组装成箭头函数再 eval
const m = src.match(/const safe = n => \{([\s\S]*?)\n\}/)
if (!m) { console.log('  ✗ 没找到 safe()'); process.exit(1) }
const safe = eval('(n => {' + m[1] + '\n})')

const CASES = [
  // [输入, 期望（'ok' = 放行，null = 拒绝）, 说明]
  ['yb_游本昌晚年影像_me5y.jpg', 'ok', '中文名图片'],
  ['xhw_munnhqk2_0.jpg', 'ok', '纯英文名'],
  ['照片 2026.jpg', 'ok', '含空格'],
  ['日本語ファイル.jpg', 'ok', '日文名'],
  ['../../secret.txt', null, '上级目录穿越'],
  ['..\\..\\secret.txt', null, 'Windows 路径穿越'],
  ['a/b.jpg', null, '正斜杠分隔'],
  ['a\\b.jpg', null, '反斜杠分隔'],
  ['', null, '空串'],
  [null, null, 'null'],
  ['x'.repeat(300), null, '超长'],
  ['a<b>c.jpg', null, '含尖括号']
]

let bad = 0
for (const [inp, want, desc] of CASES) {
  const got = safe(inp)
  // 放行时 safe 返回原名（原样返回，不是布尔），拒绝时返回 null
  const pass = want === 'ok' ? got === inp : got === null
  if (!pass) bad++
  console.log('  ' + (pass ? '✓' : '✗') + ' ' + desc.padEnd(18) +
    (want === 'ok' ? ' 应放行' : ' 应拒绝') + '  实际=' + JSON.stringify(got))
}

console.log(bad ? '  ✗ safe() 有 ' + bad + ' 项不符' : '  ✓ safe() 全部符合预期')
process.exit(bad ? 1 : 0)
