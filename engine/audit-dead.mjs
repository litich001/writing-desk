/**
 * 死代码审计
 *
 * 这轮把 titleIdeas 删了（标题改由 AI 生成），
 * 顺手就要确认它依赖的一堆东西是不是也变成死代码。
 *
 * 死代码不是「无害」：
 *   · 下一个人（或下几轮的我）会以为它有用，浪费时间读它
 *   · 它里面可能藏着写死的领域词（游本昌那篇留下的「所有人都记住了…」）
 *   · 改了它怕改坏，其实它根本不生效
 *
 * 判据：函数在文件里被调用过几次。
 * 定义一次 + 零调用 = 死代码。
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')

/* 只扫自己写的文件，不扫 node_modules */
const FILES = ['app.js', 'server.mjs', '验收测试.js', '布局体检.js', '回归基线.js']
const ENGINES = fs.readdirSync(path.join(ROOT, 'engine')).filter(f => f.endsWith('.mjs') || f.endsWith('.js'))

/** 抽出所有顶层函数名 */
function defs(src) {
  const out = []
  for (const m of src.matchAll(/^\s*(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/gm)) out.push(m[1])
  for (const m of src.matchAll(/^\s*(?:const|let)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?\(/gm)) out.push(m[1])
  for (const m of src.matchAll(/^\s*(?:const|let)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?function/gm)) out.push(m[1])
  return [...new Set(out)]
}

/** 数一个名字在全仓被引用几次（去掉定义那一处） */
function uses(name, sources) {
  const re = new RegExp('\\b' + name.replace(/\$/g, '\\$') + '\\b', 'g')
  let n = 0
  for (const [f, src] of sources) {
    const c = (src.match(re) || []).length
    // 同一文件里定义 + 至少 1 次调用 = 活的
    if (f.includes('app.js') || f.includes('server')) n += Math.max(0, c - 1)
    else n += c
  }
  return n
}

const sources = []
for (const f of FILES) {
  const p = path.join(ROOT, f)
  if (fs.existsSync(p)) sources.push([f, fs.readFileSync(p, 'utf8')])
}
for (const f of ENGINES) {
  sources.push(['engine/' + f, fs.readFileSync(path.join(ROOT, 'engine', f), 'utf8')])
}

console.log('\n  死代码审计')
console.log('  ' + '-'.repeat(58))
console.log('  扫了 ' + sources.length + ' 个文件\n')

const dead = []
for (const [f, src] of sources) {
  for (const name of defs(src)) {
    if (uses(name, sources) === 0) dead.push({ file: f, name })
  }
}

if (!dead.length) {
  console.log('  没有死代码')
} else {
  console.log('  定义了但没人用：')
  for (const d of dead) console.log('    · ' + d.name.padEnd(22) + d.file)
  console.log('\n  这些函数占着地方，读代码的人会以为它们有用。')
}

/* ---------- 写死的领域词 ---------- */
/* 这轮的真实教训：titleIdeas 里全是游本昌那篇的固定文案
   （「所有人都记住了…」「没有小角色，只有小演员」）。
   删掉 titleIdeas 之后，要确认别处还有没有同类的残留。 */
console.log('\n  ' + '-'.repeat(58))
console.log('  写死的领域词（上一篇的痕迹）')
console.log('  ' + '-'.repeat(58))
const LEAKS = [
  ['游本昌', '济公|爷叔|繁花|八宝山|龙套'],
  ['体育饭圈', '饭圈|看台|赛场|快门声|偶像|删帖'],
  /* 「交付」单独看会误报 —— 成稿页那个面板本来就叫「交付」，
     和汽车交付没关系。要带上下文才查：「交付时间」「即交付」。 */
  ['问界 M9', '问界|极氪|增程|(?:即|将|已)交付|交付时间']
]
const jsSrc = fs.readFileSync(path.join(ROOT, 'app.js'), 'utf8')
// 剥注释再查 —— 注释里记录历史是好事，不能算命中
const jsCode = jsSrc.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

let leakCount = 0
for (const [topic, re] of LEAKS) {
  const m = jsCode.match(new RegExp(re, 'g'))
  if (m) {
    leakCount += m.length
    console.log('  ★ app.js 代码里有「' + topic + '」相关词 ' + m.length + ' 处：' + [...new Set(m)].join('、'))
  }
}
if (!leakCount) console.log('  app.js 代码里干净（注释里的历史记录不算）')

console.log('')
process.exit(dead.length ? 0 : 0)   // 报告为主，不作为闸门
