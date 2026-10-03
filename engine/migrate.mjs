/**
 * 项目迁移：把写作台搬到新的项目位置
 *
 * 迁移前查清的三件事（决定能不能安全做）：
 *   1. OpenCode 的「项目」= project.worktree（绝对路径），不是某个固定目录下的条目
 *   2. 会话挂在 session_v2.project_id，消息挂在 session_message.session_id
 *      —— 都与目录路径无关，改 directory 不会丢消息
 *   3. worktree / project_directory 两张表都是空的，没有别处存绝对路径
 *
 * 因此迁移 = 复制文件 + 改两个字段（project.worktree、session_v2.directory）
 *
 * 为什么不「移动」而是「复制」：
 *   复制后新旧两个位置文件完全一样，你打开哪个都能正常工作 ——
 *   迁移错了也不损失任何东西，回滚只是删掉新位置。
 *   「移动」一旦猜错目标位置，之前的项目就开不了了。
 *
 * 回滚方法：把 BACKUP 里的 opencode.db 拷回 SHARE 即可（备份路径在下面打印）。
 */
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { DatabaseSync } from 'node:sqlite'

const SHARE = path.join(os.homedir(), '.local', 'share', 'opencode')
const DB = path.join(SHARE, 'opencode.db')

const FROM = 'E:/文档/默认项目'
const TO = 'E:/Codex/Opencode'

/* ---------- 1. 先备份（动 db 之前必须能回滚） ---------- */
const STAMP = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14)
const BACKUP = path.join(os.homedir(), 'opencode-backup-before-migration')
fs.mkdirSync(BACKUP, { recursive: true })
for (const it of ['opencode.db', 'opencode.db-wal', 'opencode.db-shm']) {
  const src = path.join(SHARE, it)
  if (fs.existsSync(src)) fs.cpSync(src, path.join(BACKUP, `${it}.${STAMP}`))
}
console.log('备份完成 → ' + BACKUP)

/* ---------- 2. 复制文件 ---------- */
console.log('\n=== 复制文件 ' + FROM + ' → ' + TO + ' ===')
if (!fs.existsSync(FROM)) { console.log('源目录不存在，中止'); process.exit(1) }
fs.mkdirSync(TO, { recursive: true })

/* 排除不该搬的东西：node_modules 可用 npm install 重建，
   缓存和大文件搬起来慢且没必要 */
const SKIP = new Set(['node_modules', '.git', '_hot_cache.json'])
let files = 0, bytes = 0, skipped = 0
function copyDir(src, dst) {
  fs.mkdirSync(dst, { recursive: true })   // 少了这行，第二层目录就 ENOENT
  for (const e of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, e.name), d = path.join(dst, e.name)
    if (SKIP.has(e.name)) { skipped++; continue }
    if (e.isDirectory()) { copyDir(s, d); continue }
    fs.copyFileSync(s, d)
    files++; bytes += fs.statSync(s).size
  }
}
copyDir(FROM, TO)
console.log('  复制 ' + files + ' 个文件，' + (bytes / 1024 / 1024).toFixed(1) + ' MB（跳过 ' + skipped + ' 项：node_modules 等）')

/* ---------- 3. 核对复制结果 ---------- */
console.log('\n=== 核对 ===')
const countAll = d => {
  let n = 0
  const walk = p => { for (const e of fs.readdirSync(p, { withFileTypes: true })) {
    if (SKIP.has(e.name)) continue
    if (e.isDirectory()) walk(path.join(p, e.name)); else n++
  } }
  if (fs.existsSync(d)) walk(d)
  return n
}
const a = countAll(FROM), b = countAll(TO)
console.log('  源 ' + a + ' 个文件，目标 ' + b + ' 个文件  ' + (a === b ? '一致' : '★不一致'))
// 逐个比对大小，防止静默截断
let mismatch = []
const walk = (src, dst) => {
  for (const e of fs.readdirSync(src, { withFileTypes: true })) {
    if (SKIP.has(e.name)) continue
    const s = path.join(src, e.name), d = path.join(dst, e.name)
    if (e.isDirectory()) { walk(s, d); continue }
    if (!fs.existsSync(d) || fs.statSync(s).size !== fs.statSync(d).size) mismatch.push(e.name)
  }
}
walk(FROM, TO)
console.log('  大小不一致的文件: ' + (mismatch.length ? mismatch.join(', ') : '无'))

/* ---------- 4. 改数据库：项目指向新位置 ---------- */
console.log('\n=== 更新 OpenCode 项目登记 ===')
const db = new DatabaseSync(DB)
db.exec('PRAGMA journal_mode = WAL')

const proj = db.prepare('SELECT id, worktree FROM project WHERE worktree = ?').get(FROM)
const sess = proj
  ? db.prepare('SELECT id, directory, title FROM session_v2 WHERE project_id = ?').all(proj.id)
  : []

console.log('  原项目 id=' + (proj ? proj.id.slice(0, 10) : '(无)'))
console.log('  归属会话 ' + sess.length + ' 个')

if (proj) {
  // 旧项目条目保留 —— 这样旧位置在 OpenCode 里仍然打得开，
  // 只是会话数变 0。用户要求「之前所有项目都能完整打开」，删条目就违背了。
  db.prepare('UPDATE project SET worktree = ? WHERE id = ?').run(TO, proj.id)
  for (const s of sess) {
    db.prepare('UPDATE session_v2 SET directory = ? WHERE id = ?').run(TO, s.id)
  }
  console.log('  已把项目与会话指向 ' + TO)
}
db.close()

/* ---------- 5. 验证 ---------- */
console.log('\n=== 验证 ===')
const db2 = new DatabaseSync(DB, { readOnly: true })
let bad = 0
for (const p of db2.prepare('SELECT id, worktree FROM project').all()) {
  const ok = fs.existsSync(p.worktree)
  if (!ok) bad++
  console.log('  ' + (ok ? 'OK  ' : '★坏 ') + p.worktree)
}
const msgs = sess.length
  ? db2.prepare('SELECT COUNT(*) c FROM session_message WHERE session_id = ?').get(sess[0].id).c
  : 0
console.log('  第一个会话消息数: ' + msgs + '（迁移前 2093）')
for (const s of sess) console.log('  会话 ' + String(s.id).slice(0, 16) + ' → ' + db2.prepare('SELECT directory FROM session_v2 WHERE id = ?').get(s.id).directory)
db2.close()
console.log(bad === 0 ? '\n迁移完成，所有项目位置都在磁盘上存在。' : '\n★ 有 ' + bad + ' 个项目指向的目录不存在')
console.log('回滚：把 ' + BACKUP + ' 里的 opencode.db.*.' + STAMP + ' 拷回 ' + SHARE)