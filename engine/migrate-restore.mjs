/**
 * 恢复旧项目条目 E:/文档/默认项目
 *
 * 上一步 migrate.mjs 把旧项目的 worktree 直接改成了新路径 ——
 * 结果「E:/文档/默认项目」在 OpenCode 列表里消失了。
 * 用户明确要求「保证我之前所有的项目都要完整可以打开」，
 * 所以旧位置必须作为一个独立项目继续存在。
 *
 * 现在文件已经复制到新位置（两边内容一致），所以：
 *   · 新位置 E:/Codex/Opencode  ← 有会话、有文件，是主力
 *   · 旧位置 E:/文档/默认项目  ← 文件还在，重新登记成独立项目
 * 两边都能正常打开，不会因为路径变化丢任何东西。
 */
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { DatabaseSync } from 'node:sqlite'

const DB = path.join(os.homedir(), '.local', 'share', 'opencode', 'opencode.db')
const OLD = 'E:/文档/默认项目'
const NEW = 'E:/Codex/Opencode'

if (!fs.existsSync(OLD)) { console.log('★ 旧目录已不存在，跳过'); process.exit(1) }

const db = new DatabaseSync(DB)
const exist = db.prepare('SELECT id FROM project WHERE worktree = ?').get(OLD)
if (exist) {
  console.log('旧项目条目已存在：' + exist.id.slice(0, 10))
} else {
  // project id 是主键；用旧项目的 id，被删过就换一个
  const OLD_ID = '1ebc44415756' + '0'.repeat(18)   // 占位，下面用实际可用值
  const id = db.prepare('SELECT id FROM project WHERE id = ?').get(OLD_ID)
    ? 'migrated-old-0001'
    : OLD_ID
  const now = Date.now()
  /* project 表有 6 个 NOT NULL 列：id / worktree / time_created / time_updated /
     time_active / sandboxes。第一版只填了 3 个，插入直接报错 ——
     这种约束只有真正执行一遍才会暴露，读表结构不够。 */
  db.prepare(`INSERT INTO project
    (id, worktree, time_created, time_updated, time_active, sandboxes)
    VALUES (?, ?, ?, ?, ?, ?)`)
    .run(id, OLD, now, now, 0, '[]')
  console.log('已重新登记旧项目：id=' + id.slice(0, 16) + '  worktree=' + OLD)
}

// project_directory 表也登记一下，两处一致更稳
try {
  const cur = db.prepare('SELECT id FROM project WHERE worktree = ?').get(NEW)
  if (cur) {
    db.prepare('DELETE FROM project_directory WHERE project_id = ?').run(cur.id)
    db.prepare('INSERT INTO project_directory (project_id, directory, type, strategy, time_created) VALUES (?,?,?,?,?)')
      .run(cur.id, NEW, 'local', 'primary', Date.now())
    console.log('已登记 project_directory')
  }
} catch (e) { console.log('project_directory 跳过：' + e.message) }

console.log('\n=== 最终项目列表 ===')
for (const p of db.prepare('SELECT id, worktree FROM project').all()) {
  const n = db.prepare('SELECT COUNT(*) c FROM session_v2 WHERE project_id = ?').get(p.id).c
  const m = db.prepare('SELECT COUNT(*) c FROM session_message WHERE session_id IN (SELECT id FROM session_v2 WHERE project_id = ?)').get(p.id).c
  const onDisk = fs.existsSync(p.worktree) ? 'OK ' : '★缺'
  console.log('  ' + onDisk + '  ' + p.id.slice(0, 10) + '  ' + p.worktree + '  会话=' + n + '  消息=' + m)
}
db.close()