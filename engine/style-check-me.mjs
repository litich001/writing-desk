#!/usr/bin/env node
/**
 * 检查当前正文符合哪种文风
 *
 * 用法：node engine/style-check-me.mjs [风格id]
 * 不带参数就用 project.json 里的 style
 * 拿的是 data/body.md —— 也就是用户真正要发出去的那篇
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { STYLES, checkStyle } from './styles.mjs'

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const read = f => { try { return fs.readFileSync(path.join(ROOT, 'data', f), 'utf8') } catch { return '{}' } }

const proj = JSON.parse(read('project.json').replace(/^\uFEFF/, '') || '{}')
const body = (() => { try { return fs.readFileSync(path.join(ROOT, 'data', 'body.md'), 'utf8') } catch { return '' } })()

const arg = process.argv[2]
const id = arg || proj.style || 'auto'

console.log('')
if (!body.trim()) {
  console.log('  正文是空的，没什么可查的。')
  process.exit(0)
}
if (id === 'auto') {
  console.log('  当前文风是「你判断」，没有指定具体风格。')
  console.log('  可查的风格：' + Object.keys(STYLES).join(' / '))
  console.log('  用法：node engine/style-check-me.mjs sharp')
  process.exit(0)
}
if (!STYLES[id]) {
  console.log('  未知风格：' + id)
  console.log('  可选：' + Object.keys(STYLES).join(' / '))
  process.exit(1)
}

const r = checkStyle(body, id)
const st = STYLES[id]

console.log('  ' + '='.repeat(58))
console.log('  文风检查：' + st.n + '（' + id + '）')
console.log('  ' + st.brief)
console.log('  ' + '='.repeat(58))
console.log('  正文 ' + body.replace(/\s/g, '').length + ' 字，' +
  body.split(/\n\s*\n/).filter(p => p.trim()).length + ' 段')
console.log('')

if (r.pass) {
  console.log('  ✓ 合格，' + r.score + ' 分')
} else {
  console.log('  ✗ ' + r.verdict)
  if (r.aiHits.length) {
    console.log('')
    console.log('    AI 味：')
    r.aiHits.forEach(h => console.log(`      · ${h.n} ×${h.n_hit}　「${h.sample}」`))
  }
  if (r.forbids.length) {
    console.log('')
    console.log('    违反硬禁：')
    r.forbids.forEach(f => console.log(`      · ${f.n} ×${f.n_hit}　${f.why}`))
  }
  if (r.requires.length) {
    console.log('')
    console.log('    缺了必备：')
    r.requires.forEach(q => console.log(`      · ${q.n}　${q.why}`))
  }
}

console.log('')
console.log('    偏好项（越高越像）：')
r.prefers.forEach(p => {
  const pct = p.target > 0 ? Math.min(100, Math.round(p.v / p.target * 100)) : 0
  const bar = '█'.repeat(Math.round(pct / 10)).padEnd(10, '░')
  console.log(`      ${p.n.padEnd(6)} ${bar} ${String(p.v).padEnd(6)}/目标 ${p.target}`)
})
console.log('')
process.exit(r.pass ? 0 : 1)
