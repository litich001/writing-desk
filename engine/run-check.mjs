import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const t = fs.readFileSync(path.join(ROOT, '验收测试.js'), 'utf8')

// 找所有含 ✗ 的行，单独报出来
const fails = t.split('\n')
  .map((l, i) => [i + 1, l])
  .filter(([, l]) => l.includes('✗'))
console.log('源码里含 ✗ 的行：', fails.length)

// 跑一遍并把 stdout 存成 UTF-8
const { execFileSync } = await import('node:child_process')
let out = ''
try {
  out = execFileSync('node', [path.join(ROOT, '验收测试.js')], {
    encoding: 'utf8', cwd: ROOT, maxBuffer: 20e6
  })
} catch (e) {
  out = (e.stdout || '') + (e.stderr || '')
}
fs.writeFileSync(path.join(ROOT, 'data', '_验收输出.txt'), out, 'utf8')

const lines = out.split('\n')
const bad = lines.filter(l => l.includes('✗'))
console.log('失败行：', bad.length)
bad.forEach(l => console.log('  ' + l.trim()))
const sum = lines.filter(l => /通过\s*\d+/.test(l))
sum.forEach(l => console.log('汇总：' + l.trim()))
