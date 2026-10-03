/**
 * 迁移收尾：合并重复的项目条目
 *
 * 迁移后的问题：原来的 E:/Codex/Opencode（空项目）和迁过来的条目
 * 都指向同一路径，OpenCode 列表里会看到两个一模一样的项目。
 *
 * 处理：把空的那个（0 会话）并进有会话的那个，然后删掉空条目。
 * 不删有会话的那个 —— 那里面是 2097 条消息，删了就没了。
 */
import path from 'node:path'
import os from 'node:os'
import { DatabaseSync } from 'node:sqlite'

const DB = path.join(os.homedir(), '.local', 'share', 'opencode', 'opencode.db')
const db = new DatabaseSync(DB)

console.log('=== 迁移前 ===')
const rows = db.prepare('SELECT id, worktree FROM project').all()
for (const p of rows) {
  const n = db.prepare('SELECT COUNT(*) c FROM session_v2 WHERE project_id = ?').get(p.id).c
  const m = n ? db.prepare('SELECT COUNT(*) c FROM session_message WHERE session_id IN (SELECT id FROM session_v2 WHERE project_id = ?)').get(p.id).c : 0
  console.log('  ' + p.id.slice(0, 10) + '  ' + p.worktree + '  会话=' + n + '  消息=' + m)
}

// 按 worktree 分组；有会话的保留，空的合并后删除
const byPath = new Map()
for (const p of rows) {
  if (!byPath.has(p.worktree)) byPath.set(p.worktree, [])
  const n = db.prepare('SELECT COUNT(*) c FROM session_v2 WHERE project_id = ?').get(p.id).c
  byPath.get(p.worktree).push({ id: p.id, n })
}

let removed = 0, moved = 0
for (const [wt, list] of byPath) {
  if (list.length < 2) continue
  console.log('\n重复路径 ' + wt + '，共 ' + list.length + ' 个条目')
  // 会话多的当主
  list.sort((a, b) => b.n - a.n)
  const keep = list[0]
  console.log('  保留 ' + keep.id.slice(0, 10) + '（会话 ' + keep.n + '）')
  for (const other of list.slice(1)) {
    const movedN = db.prepare('SELECT COUNT(*) c FROM session_v2 WHERE project_id = ?').get(other.id).c
    if (movedN > 0) {
      db.prepare('UPDATE session_v2 SET project_id = ? WHERE project_id = ?').run(keep.id, other.id)
      moved += movedN
      console.log('  合并 ' + other.id.slice(0, 10) + ' 的 ' + movedN + ' 个会话 → 保留条目')
    }
    // 确认没会话了才删
    const left = db.prepare('SELECT COUNT(*) c FROM session_v2 WHERE project_id = ?').get(other.id).c
    if (left === 0) {
      db.prepare('DELETE FROM project WHERE id = ?').run(other.id)
      removed++
      console.log('  删除空条目 ' + other.id.slice(0, 10))
    } else {
      console.log('  ★ ' + other.id.slice(0, 10) + ' 还剩 ' + left + ' 个会话，不删')
    }
  }
}

console.log('\n=== 迁移后 ===')
for (const p of db.prepare('SELECT id, worktree FROM project').all()) {
  const n = db.prepare('SELECT COUNT(*) c FROM session_v2 WHERE project_id = ?').get(p.id).c
  const m = db.prepare('SELECT COUNT(*) c FROM session_message WHERE session_id IN (SELECT id FROM session_v2 WHERE project_id = ?)').get(p.id).c
  console.log('  ' + p.id.slice(0, 10) + '  ' + p.worktree + '  会话=' + n + '  消息=' + m)
}
console.log('\n删除空条目 ' + removed + ' 个，合并会话 ' + moved + ' 个')
db.close()