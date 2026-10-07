/**
 * 检查截图是否补齐、README 里引用的图是否真的在
 *
 * 为什么要有这个：
 *   README 里写 `![说明](docs/shots/01-hot.png)` 而文件不存在，
 *   GitHub 会显示一个破图 —— 比不写更糟，看起来像整个项目都不靠谱。
 *
 *   所以这个脚本查三样：
 *     一 docs/shots/ 下的图有没有补齐
 *     二 每张是不是 0 字节（截图工具失败时会留下空文件）
 *     三 README 引用了图的话，文件是不是真的在
 *
 * 用法：node engine/shots-check.mjs
 * 全绿退出码 0，还有缺的退出码 1。
 */
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const SHOTS = path.join(ROOT, 'docs/shots')

/* 要哪几张，跟 docs/截图.md 的表一致 */
const WANTED = [
  ['01-hot.png', '热点页'],
  ['02-idea.png', '定题页'],
  ['03-write.png', '成稿页'],
  ['04-facts.png', '事实清单展开'],
  ['05-ship.png', '发布页三栏'],
  ['06-ship-dark.png', '发布页暗色']
]

console.log('')
console.log('  截图检查')
console.log('  ' + '='.repeat(60))

/* 一 二 sh
ots 目录逐个查 */
const fail = []
const missing = []

if (!fs.existsSync(SHOTS)) {
  console.log('  docs/shots/ 目录还没有（正常，截图要在有可见窗口的机器上补）')
} else {
  for (const [file, what] of WANTED) {
    const p = path.join(SHOTS, file)
    if (!fs.existsSync(p)) {
      missing.push(file + '（' + what + '）')
      continue
    }
    const size = fs.statSync(p).size
    if (size === 0) {
      fail.push(file + ' 是 0 字节 —— 截图工具失败时会留下空文件')
      console.log('  ✗ ' + file.padEnd(18) + ' 0 字节')
    } else {
      console.log('  ✓ ' + file.padEnd(18) + Math.round(size / 1024) + ' KB')
    }
  }
}

/* 三 README 里引用的图是否真的在 */
const readme = fs.readFileSync(path.join(ROOT, 'README.md'), 'utf8')
const refs = [...readme.matchAll(/!\[[^\]]*\]\(([^)]+)\)/g)].map(m => m[1])
  .filter(h => !/^(https?:|data:)/.test(h))

console.log('')
console.log('  README 里引用的图片 ' + refs.length + ' 张')
let refBad = 0
for (const r of refs) {
  const p = path.join(ROOT, r)
  if (fs.existsSync(p)) {
    console.log('  ✓ ' + r)
  } else {
    /* ★ 断链要报出来。GitHub 上就是破图。 */
    refBad++
    console.log('  ✗ ' + r + '  ← README 引用了但文件不在')
  }
}

console.log('  ' + '-'.repeat(60))
if (fail.length) {
  fail.forEach(f => console.log('  ✗ ' + f))
}
if (missing.length) {
  console.log('')
  console.log('  还缺 ' + missing.length + ' 张（补法见 docs/截图.md）：')
  missing.forEach(m => console.log('    · ' + m))
}
console.log('')
console.log(refBad
  ? '  ✗ README 有 ' + refBad + ' 个断链，先把文件补上或把引用去掉'
  : '  README 没有断链')

/* 缺图不算失败 —— 那是「还没补」，不是「坏了」。
   断链和 0 字节才算。 */
process.exitCode = (fail.length || refBad) ? 1 : 0
if (!fail.length && !refBad && !missing.length) console.log('  全部齐了 ✓')