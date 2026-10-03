#!/usr/bin/env node
/**
 * 热点榜命令行入口 —— 任何 Agent 都能调
 *
 * 为什么要有这个（用户问：别人从 GitHub 下载，任何 Agent 能不能用这些榜？）
 * 诚实的答案是：不能「即插即用」—— 榜单本质是 HTTP 抓取 + HTML 解析，
 * 不同 Agent 的网络能力和运行时差异太大。
 * 但能做到的是：给一个纯 CLI，任何能执行 Node 命令的环境都能拿到数据，
 * 不需要启动写作台的 server，不需要打开浏览器。
 *
 * 用法：
 *   node engine/hot-cli.mjs                  # 人看的表格
 *   node engine/hot-cli.mjs --json           # 给 Agent 用的 JSON
 *   node engine/hot-cli.mjs --json --flat    # 扁平列表（只留 title/url/from），最适合喂给模型
 *   node engine/hot-cli.mjs --json --top 30  # 只取前 30 条
 *   node engine/hot-cli.mjs --json --only weibo
 *   node engine/hot-cli.mjs --force          # 忽略 4 小时缓存，强制重抓
 *   node engine/hot-cli.mjs --json --stale   # 缓存过期也返回旧数据，附带 stale 标记
 *
 * 退出码：0 = 至少一个源出了条目；1 = 全军覆没（调用方能据此判断要不要重试）
 */
import { fetchAll, hotCacheInfo, SOURCES } from './hot.mjs'

const args = process.argv.slice(2)
const has = f => args.includes(f)
const val = (f, d) => { const i = args.indexOf(f); return i >= 0 && args[i + 1] ? args[i + 1] : d }

const json = has('--json')
const flat = has('--flat')
const top = Number(val('--top', 0)) || 0
const only = val('--only', '')
const force = has('--force')
const allowStale = has('--stale')

// 收集全部能用的条目（跨平台去重由 hotBag 负责，这里复用服务端的算法）
function merge(sources) {
  const bag = new Map()
  for (const s of sources.filter(x => x.ok && x.items.length)) {
    for (const it of s.items) {
      const key = String(it.title).replace(/[^一-龥a-zA-Z0-9]/g, '').slice(0, 14)
      if (!key) continue
      const cur = bag.get(key)
      if (cur) { if (!cur.from.includes(s.name)) cur.from.push(s.name) }
      else bag.set(key, { title: it.title, url: it.url || '', heat: it.heat || 0, from: [s.name] })
    }
  }
  return [...bag.values()]
}

/* 输出缓冲：一次性写。
   逐行 console.log 在 Windows 重定向到文件时会变成 UTF-16，
   读回来全是乱码，测试脚本没法解析。 */
const OUT = []
const say = s => OUT.push(s)
const flush = () => process.stdout.write(OUT.join('\n') + '\n')

let list
try {
  const sources = await fetchAll(force)
  list = only
    ? merge(sources.filter(s => s.id === only))
    : merge(sources)

  if (!list.length && !allowStale) {
    // 缓存过期 + 全部抓取失败：明确告诉调用方，不要假装成功
    const info = hotCacheInfo()
    say(`[hot-cli] 全部源都没抓到条目。缓存时间: ${info.cachedAt ? new Date(info.cachedAt).toLocaleString('zh-CN') : '无'}`)
    say('[hot-cli] 加 --stale 可以返回过期缓存。')
    flush()
    process.exit(1)
  }
  if (top > 0) list = list.slice(0, top)

  if (json) {
    const info = hotCacheInfo()
    const out = flat
      ? { count: list.length, at: info.cachedAt, items: list.map(x => ({ title: x.title, url: x.url, from: x.from.join('/') })) }
      : { count: list.length, at: info.cachedAt, nextRefreshAt: info.nextRefreshAt, sources: SOURCES.length, items: list }
    say(JSON.stringify(out, null, 2))
  } else {
    const info = hotCacheInfo()
    say('')
    say(`  热点榜  ${list.length} 条　（${SOURCES.length} 个源）`)
    say('  ' + '-'.repeat(58))
    list.forEach((x, i) => {
      const n = String(i + 1).padStart(3, ' ')
      const t = x.title.length > 40 ? x.title.slice(0, 40) + '…' : x.title
      say(`  ${n}. ${t}`)
      say(`      ${x.from.join('/')}${x.url ? '  ' + x.url : ''}`)
    })
    say('  ' + '-'.repeat(58))
    const at = info.cachedAt ? new Date(info.cachedAt).toLocaleString('zh-CN', { hour12: false }) : '未缓存'
    const next = info.nextRefreshAt ? new Date(info.nextRefreshAt).toLocaleString('zh-CN', { hour12: false }) : '—'
    say(`  缓存: ${at}　4 小时后自动刷新: ${next}`)
    say('  需要 JSON: node engine/hot-cli.mjs --json')
    say('')
  }
  flush()
  process.exit(0)
} catch (e) {
  say(`[hot-cli] 失败: ${e && e.message ? e.message : e}`)
  flush()
  process.exit(1)
}
