/**
 * AI 味诊断：具体到句子，给出改法
 *
 * 用户原话：「你写的这文章写作风格，AI味太浓了，你得全部都优化一下呀」
 *
 * 「AI 味」不是玄学，是可指认的：
 *   · 空洞的判断句（「这就是答案」「这就是流水线」—— 没有主体、没有依据）
 *   · 模板化的段落结构（每节都是「先摆事实→再摆对比→最后下判断」）
 *   · 抽象名词代替具体动作（「界定」「正当性」「路径」这类词在通篇出现）
 *   · 反问句当衔接（连续用「凭什么」「怎么都」「多少」，像在跟读者吵架）
 *   · 每段都要有金句（真实文章不是每段都有）
 *
 * 这个脚本不判「像不像 AI」，只统计上面这些可指认的特征。
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const F = path.join(ROOT, 'data', 'body.md')
const body = fs.readFileSync(F, 'utf8')

/* 去掉表格和来源表 */
const clean = body
  .split('\n')
  .filter(l => !l.startsWith('|'))
  .join('\n')

const sents = clean
  .split(/(?<=[。！？])/)
  .map(s => s.trim())
  .filter(s => s.length > 10)

console.log('\n  AI 味诊断')
console.log('  ' + '='.repeat(66))
console.log('  正文 ' + body.replace(/\s/g, '').length + ' 字，' + sents.length + ' 句\n')

/* ---------- 1. 空洞判断句：无主语的断言 ---------- */
console.log('【1】空洞判断句（「这就是X」「答案是X」这类没有依据的断言）')
const HOLLOW = /(这就是[^，。]{1,8}[。，])|(答案是[^，。]{1,10}[。？！])/g
const h1 = clean.match(HOLLOW) || []
h1.forEach(x => console.log('    · ' + x))
if (!h1.length) console.log('    无')
console.log('')

/* ---------- 2. 反问句当衔接 ---------- */
console.log('【2】反问句（真实文章里偶尔用，连着用就是 AI 在跟读者吵）')
const RHET = /[？？]/g
const r1 = sents.filter(s => /[？]/.test(s) && s.length < 45)
console.log('    ' + r1.length + ' 个短反问句：')
r1.slice(0, 8).forEach(s => console.log('    · ' + s.slice(0, 42)))
console.log('')

/* ---------- 3. 抽象名词（书面报告腔）---------- */
console.log('【3】抽象名词（报告腔，公众号不该有）')
const ABSTRACT = /(正当性|路径|机制性|可能性|必要性|有效性|合理性|规范性|制度性|结构性|根本性|系统性|闭环|抓手|赋能|范式|维度|层面)/g
const a1 = [...new Set(clean.match(ABSTRACT) || [])]
console.log('    ' + (a1.length ? a1.join('、') : '无'))
console.log('')

/* ---------- 4. 「这不是A，是B」句式 ---------- */
console.log('【4】「不是A，是B」判断句（AI 最爱用，一篇超过 3 处就是套路）')
const NOTIS = /[^。！？\n]{0,26}[，,]\s*(?:其实是|实际上是|而是|是)[^。！？\n]{2,26}/g
const n1 = [...new Set(clean.match(NOTIS) || [])]
n1.slice(0, 10).forEach(s => console.log('    · ' + s.trim().slice(0, 46)))
console.log('    共 ' + n1.length + ' 处' + (n1.length > 3 ? '  ★ 偏多' : ''))
console.log('')

/* ---------- 5. 段落结构是否过于整齐 ---------- */
console.log('【5】段落长度分布（AI 写的段落长度很均匀，人写的不会）')
const paras = clean.split(/\n\s*\n/).map(p => p.trim()).filter(p => p.length > 25)
const lens = paras.map(p => p.replace(/\s/g, '').length)
const avg = lens.reduce((a, b) => a + b, 0) / lens.length
const sd = Math.sqrt(lens.reduce((a, b) => a + (b - avg) ** 2, 0) / lens.length)
console.log('    ' + paras.length + ' 段，平均 ' + avg.toFixed(0) + ' 字，标准差 ' + sd.toFixed(0))
console.log('    变异系数 ' + (sd / avg).toFixed(2) + (sd / avg < 0.45 ? '  ★ 过于整齐（AI 味）' : '  正常'))
const sorted = [...lens].sort((a, b) => a - b)
console.log('    最短 ' + sorted[0] + ' / 最长 ' + sorted[sorted.length - 1])
console.log('')

/* ---------- 6. 加粗是否过密（每个加粗前都有「判断」= 每段都在喊）---------- */
console.log('【6】加粗密度')
const bolds = (body.match(/\*\*/g) || []).length / 2
const chars = body.replace(/\s/g, '').length
console.log('    ' + bolds + ' 处，每千字 ' + (bolds / chars * 1000).toFixed(1) + ' 处')
console.log('')

console.log('  ' + '='.repeat(66))