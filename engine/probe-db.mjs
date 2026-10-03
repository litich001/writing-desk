/* 用 Node 自带的 sqlite 读 OpenCode 项目库 */
import path from 'node:path'
import os from 'node:os'
import { DatabaseSync } from 'node:sqlite'

const SHARE = path.join(os.homedir(), '.local', 'share', 'opencode')
const db = new DatabaseSync(path.join(SHARE, 'opencode.db'), { readOnly: true })

const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all()
console.log('表:', tables.map(t => t.name).join(', '))

const cols = t => {
  try { return db.prepare(`PRAGMA table_info(${t})`).all().map(c => c.name).join(',') }
  catch { return '(无)' }
}

for (const t of tables.map(x => x.name)) {
  let n = 0
  try { n = db.prepare(`SELECT COUNT(*) c FROM ${t}`).get().c } catch {}
  console.log(`  ${t.padEnd(20)} 列: ${cols(t).padEnd(60)} 行数: ${n}`)
}

try {
  console.log('\n=== project 表全部内容 ===')
  const rows = db.prepare('SELECT * FROM project').all()
  for (const r of rows) {
    console.log(JSON.stringify(r, null, 2).slice(0, 500))
  }
} catch (e) { console.log('读 project 失败:', e.message) }
