import path from 'node:path'
import os from 'node:os'
import { DatabaseSync } from 'node:sqlite'

const db = new DatabaseSync(path.join(os.homedir(), '.local', 'share', 'opencode', 'opencode.db'), { readOnly: true })

console.log('=== 全部项目 ===')
for (const p of db.prepare('SELECT id, worktree, name, time_created FROM project').all()) {
  console.log(`  id=${p.id.slice(0, 12)}  worktree=${p.worktree}  name=${p.name || '(空)'}  ${new Date(p.time_created).toLocaleString('zh-CN')}`)
}

console.log('\n=== session_v2（含 project_id 与 directory）===')
for (const s of db.prepare('SELECT id, project_id, directory, path, title, time_created FROM session_v2').all()) {
  console.log(`  id=${String(s.id).slice(0, 14)}  proj=${String(s.project_id).slice(0, 12)}`)
  console.log(`    directory=${s.directory}`)
  console.log(`    title=${s.title || '(无)'}  ${new Date(s.time_created).toLocaleString('zh-CN')}`)
}

console.log('\n=== 有多少会话属于各 project ===')
for (const r of db.prepare(`
  SELECT p.worktree, COUNT(m.id) msgs
  FROM session_message m
  LEFT JOIN session_v2 s ON m.session_id = s.id
  LEFT JOIN project p ON s.project_id = p.id
  GROUP BY p.worktree
`).all()) {
  console.log(`  ${r.worktree || '(未知)'} : ${r.msgs} 条消息`)
}
