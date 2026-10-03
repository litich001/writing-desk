/* 迁移前的最后一轮探测：搞清楚「项目」和「会话」到底靠什么绑定。
   结论决定迁移能不能安全做。 */
import path from 'node:path'
import os from 'node:os'
import { DatabaseSync } from 'node:sqlite'

const db = new DatabaseSync(path.join(os.homedir(), '.local', 'share', 'opencode', 'opencode.db'), { readOnly: true })

console.log('=== session_v2 结构 ===')
for (const c of db.prepare('PRAGMA table_info(session_v2)').all()) {
  console.log('  ' + c.name.padEnd(22) + c.type)
}

console.log('\n=== 消息是按 session_id 存的，还是按目录？ ===')
const cols = db.prepare('PRAGMA table_info(session_message)').all().map(c => c.name)
console.log('  session_message 列: ' + cols.join(', '))

const s = db.prepare('SELECT id, project_id, directory, title FROM session_v2 LIMIT 1').get()
if (s) {
  const n = db.prepare('SELECT COUNT(*) c FROM session_message WHERE session_id = ?').get(s.id).c
  console.log('  会话 ' + String(s.id).slice(0, 16) + ' 有 ' + n + ' 条消息')
  console.log('  → 消息挂在 session_id 上，与目录路径无关 ⇒ 改 directory 不会丢消息')
}

console.log('\n=== part 表呢？ ===')
const pcols = db.prepare('PRAGMA table_info(part)').all().map(c => c.name)
console.log('  part 列: ' + pcols.join(', '))
if (s) {
  try {
    const n = db.prepare('SELECT COUNT(*) c FROM part WHERE session_id = ?').get(s.id).c
    console.log('  该会话 part 数: ' + n)
  } catch (e) { console.log('  part 按 session_id 查失败: ' + e.message) }
}

console.log('\n=== 有没有别的地方存了绝对路径 ===')
for (const t of ['project_directory', 'workspace', 'worktree', 'session_diff']) {
  try {
    const c = db.prepare(`PRAGMA table_info(${t})`).all().map(x => x.name)
    const n = db.prepare(`SELECT COUNT(*) c FROM ${t}`).get().c
    console.log('  ' + t.padEnd(18) + ' 行数=' + String(n).padEnd(6) + ' 列: ' + c.join(', '))
  } catch (e) { console.log('  ' + t + ': ' + e.message) }
}

try {
  for (const r of db.prepare('SELECT * FROM project_directory').all()) console.log('  project_directory: ' + JSON.stringify(r).slice(0, 200))
} catch {}

console.log('\n=== worktree 表 ===')
try {
  for (const r of db.prepare('SELECT * FROM worktree').all()) console.log('  ' + JSON.stringify(r).slice(0, 200))
} catch (e) { console.log('  ' + e.message) }

db.close()