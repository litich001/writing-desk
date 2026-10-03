/**
 * 回归保护基线 —— 任何改动前后都会跑
 * 作用：确保「改 A 不会坏 B」
 * 用法：node 回归基线.js --save   建立基线
 *       node 回归基线.js         对比当前是否破坏基线
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
/* 用 import.meta.url 定位，不再硬编码路径 ——
   硬编码过一次，整个项目挪位置就得回来改一遍。 */
const D = path.join(path.dirname(fileURLToPath(import.meta.url)), 'data')
const SNAP = path.join(D, '_baseline.json')

const save = process.argv.includes('--save')

function snapshot() {
  const read = f => { try { return fs.readFileSync(path.join(D, f), 'utf8') } catch { return null } }
  // 必须剥 BOM：Windows 上任何一次 PowerShell Set-Content -Encoding UTF8
  // 都会写入 BOM，JSON.parse 会直接抛错，被 catch 吞掉后整个对象变成 {}，
  // 于是「标题/模板」这类校验永远显示为空 —— 回归保护静默失效。
  const j = f => {
    const raw = read(f)
    if (raw == null) return null
    try { return JSON.parse(raw.replace(/^\uFEFF/, '')) } catch (e) {
      console.log('  ! ' + f + ' 解析失败：' + e.message)
      return null
    }
  }

  const body = read('body.md') || ''
  const proj = j('project.json') || {}
  const imgs = j('images.json') || []

  return {
    at: new Date().toISOString(),
    // 正文结构指纹：段落数、图片占位数、标题数、字数、正文哈希
    body: {
      chars: body.replace(/\s/g, '').length,
      paragraphs: body.split(/\n\s*\n/).filter(x => x.trim()).length,
      imageRefs: (body.match(/^!\[.*\]\(.*\)$/gm) || []).length,
      headings: (body.match(/^#{1,6}\s+\S/gm) || []).length,
      hash: hash(body)
    },
    project: {
      title: proj.title || '',
      hasAbstract: !!proj.abstract,
      hasFoot: !!proj.foot,
      // 摘要/备注记内容哈希。只记「有没有」的话，内容被清空基线也发现不了 ——
      // 我就是这么把标题、摘要、文末备注弄丢的，基线却只报了 title 为空。
      abstractLen: (proj.abstract || '').length,
      abstractHash: hash(proj.abstract || ''),
      footLen: (proj.foot || '').length,
      footHash: hash(proj.foot || ''),
      tpl: proj.tpl || '',
      optKeys: Object.keys(proj.opts || {}).sort().join(',')
    },
    images: {
      count: imgs.length,
      files: imgs.map(x => x.file).sort().join('|')
    }
  }
}

function hash(s) {
  let h = 5381
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0
  return h.toString(36)
}

const cur = snapshot()

if (save) {
  fs.writeFileSync(SNAP, JSON.stringify(cur, null, 2), 'utf8')
  console.log('基线已保存：正文 ' + cur.body.chars + ' 字 / ' + cur.body.paragraphs + ' 段 / '
    + cur.body.imageRefs + ' 图 / ' + cur.body.headings + ' 标题；图片 ' + cur.images.count + ' 张')
  process.exit(0)
}

if (!fs.existsSync(SNAP)) {
  console.log('没有基线，先跑一次 --save')
  process.exit(0)
}

const base = JSON.parse(fs.readFileSync(SNAP, 'utf8'))
const diffs = []
const cmp = (name, a, b) => { if (String(a) !== String(b)) diffs.push(name + '  ' + b + ' → ' + a) }

cmp('正文字数', cur.body.chars, base.body.chars)
cmp('段落数', cur.body.paragraphs, base.body.paragraphs)
cmp('图片占位数', cur.body.imageRefs, base.body.imageRefs)
cmp('标题数', cur.body.headings, base.body.headings)
cmp('图片库张数', cur.images.count, base.images.count)
cmp('图片文件清单', cur.images.files, base.images.files)
cmp('标题字段', cur.project.title, base.project.title)
cmp('模板', cur.project.tpl, base.project.tpl)
cmp('摘要长度', cur.project.abstractLen, base.project.abstractLen)
cmp('摘要内容', cur.project.abstractHash, base.project.abstractHash)
cmp('文末备注长度', cur.project.footLen, base.project.footLen)
cmp('文末备注内容', cur.project.footHash, base.project.footHash)

console.log('\n' + '='.repeat(56))
console.log('  回归比对')
console.log('='.repeat(56))
if (diffs.length === 0) {
  console.log('  ✓ 与基线一致，无破坏')
} else {
  console.log('  发现 ' + diffs.length + ' 处变化：')
  diffs.forEach(d => console.log('    · ' + d))
  console.log('\n  如果这些变化是有意的，用 --save 更新基线。')
}
console.log('='.repeat(56) + '\n')
process.exit(diffs.length ? 1 : 0)
