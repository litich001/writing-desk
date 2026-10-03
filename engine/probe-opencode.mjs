/* 读 OpenCode 的项目库，看它怎么记项目 ——
   迁移要动这里，位置搞错会打不开之前的会话 */
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { execFileSync } from 'node:child_process'

const SHARE = path.join(os.homedir(), '.local', 'share', 'opencode')
const db = path.join(SHARE, 'opencode.db')
console.log('db 存在:', fs.existsSync(db), db)
console.log('大小:', (fs.statSync(db).size / 1024).toFixed(0), 'KB')

// 找 sqlite3 可执行文件
const cands = ['sqlite3', 'C:/Program Files/Git/usr/bin/sqlite3.exe']
let found = null
for (const c of cands) {
  try { execFileSync(c, ['-version'], { stdio: 'ignore' }); found = c; break } catch {}
}
console.log('sqlite3:', found || '不可用')

if (found) {
  const out = execFileSync(found, [db, '.tables'], { encoding: 'utf8' })
  console.log('表:', out.trim())
  const rows = execFileSync(found, [db, 'SELECT id, worktree FROM project'], { encoding: 'utf8' })
  console.log('\n项目表 project:')
  console.log(rows)
}
