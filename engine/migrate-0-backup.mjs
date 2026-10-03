/* 迁移前体检 —— 动 opencode.db 之前必须做的事：
   1. 完整备份 db + storage
   2. 列清楚每个 project / session 挂在哪个目录
   3. 搞清楚「迁到哪」

   为什么要小心：project 表以 worktree（绝对路径）为主键式标识，
   session_v2.directory 也存绝对路径。路径一改，对不上就「打不开」。
*/
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { DatabaseSync } from 'node:sqlite'

const SHARE = path.join(os.homedir(), '.local', 'share', 'opencode')
const BACKUP = path.join(os.homedir(), 'opencode-backup-before-migration')
const STAMP = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14)

console.log('=== 1. 备份 ===')
fs.mkdirSync(BACKUP, { recursive: true })
const items = ['opencode.db', 'opencode.db-wal', 'opencode.db-shm', 'storage']
for (const it of items) {
  const src = path.join(SHARE, it)
  if (!fs.existsSync(src)) { console.log(`  跳过 ${it}（不存在）`); continue }
  const dst = path.join(BACKUP, `${it}.${STAMP}`)
  fs.cpSync(src, dst, { recursive: true })
  const sz = fs.statSync(src).size
  console.log(`  ✓ ${it} (${(sz / 1024 / 1024).toFixed(1)}MB) → ${path.basename(dst)}`)
}
fs.writeFileSync(path.join(BACKUP, 'README.txt'),
  `迁移前完整备份，时间 ${new Date().toLocaleString('zh-CN')}\n原位置: ${SHARE}\n回滚方法见对话记录。\n`, 'utf8')
console.log(`  备份目录: ${BACKUP}`)

console.log('\n=== 2. 现有项目与会话 ===')
const db = new DatabaseSync(path.join(SHARE, 'opencode.db'), { readOnly: true })
const projects = db.prepare('SELECT id, worktree, name FROM project').all()
const sessions = db.prepare('SELECT id, project_id, directory, title FROM session_v2').all()
for (const p of projects) {
  const n = sessions.filter(s => s.project_id === p.id).length
  console.log(`  项目 ${p.id.slice(0, 10)}  ${p.worktree}  会话 ${n}`)
}
console.log('\n  会话明细:')
for (const s of sessions) {
  console.log(`    ${String(s.id).slice(0, 16)}  dir=${s.directory}  title=${s.title || '(无)'}`)
}

console.log('\n=== 3. 磁盘实况 ===')
for (const p of projects) {
  const ok = fs.existsSync(p.worktree)
  console.log(`  ${ok ? '✓' : '✗'} ${p.worktree}${ok ? '' : '  ← 目录已不存在！'}`)
}
db.close()
