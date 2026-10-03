/**
 * 改动打戳 —— 版本号的唯一入口
 *
 * 为什么要这个：用户要求「每次改都标版本号，精确到时间」，
 * 并且「写进系统底层架构」。所以它不是一个手动维护的文档，
 * 而是一条命令 + 一个文件 + 一条验收断言，三者绑定。
 *
 * 用法：node engine/stamp.mjs "第一批次：排版内核重写"
 * 效果：往 data/CHANGELOG.md 追加一条 v20260930-152300 的记录
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const LOG = path.join(ROOT, 'data', 'CHANGELOG.md')

/** 精确到秒的版本号 */
export function versionId(d = new Date()) {
  const p = n => String(n).padStart(2, '0')
  return 'v' + d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) +
    '-' + p(d.getHours()) + p(d.getMinutes()) + p(d.getSeconds())
}

export function stamp(what) {
  const now = new Date()
  const id = versionId(now)
  const time = now.toLocaleString('zh-CN', { hour12: false })
  const line = `- \`${id}\`　${time}　${what}\n`

  if (!fs.existsSync(LOG)) {
    fs.writeFileSync(LOG,
      '# 改动记录\n\n> 每次改动由 `node engine/stamp.mjs "说明"` 自动追加，勿手改。\n> ' +
      '版本号精确到秒，同一秒内两次改动会撞号 —— 那种情况请等一秒。\n\n', 'utf8')
  }
  fs.appendFileSync(LOG, line, 'utf8')
  console.log('  ' + id + '　' + what)
  return id
}

// 直接跑的时候才打戳，被 import 时只导出
if (process.argv[1] && /stamp\.mjs$/i.test(process.argv[1])) {
  const what = process.argv.slice(2).join(' ') || '(未说明)'
  stamp(what)
}
