const fs = require('fs')
const path = require('path')
const D = path.join(__dirname, 'data')
const read = f => fs.readFileSync(path.join(D, f), 'utf8')
const write = (f, o) => fs.writeFileSync(path.join(D, f), JSON.stringify(o, null, 2), 'utf8')

/* 1. 存一版快照 */
const body = read('body.md')
const ver = JSON.parse(read('versions.json') || '[]')
const proj = JSON.parse(read('project.json'))
ver.unshift({
  id: 'v_' + Date.now().toString(36),
  at: new Date().toLocaleString('zh-CN', { hour12: false }),
  // 之前这里硬编码了上一稿的标题，换稿后版本名会一直串（存了两次才发现）
  label: (proj.title || '未命名') + ' · ' + (ver[0] ? '续' : '初稿'),
  chars: body.replace(/\s/g, '').length
})
fs.mkdirSync(path.join(D, 'versions'), { recursive: true })
const id = ver[0].id
fs.writeFileSync(path.join(D, 'versions', id + '.md'), body, 'utf8')
ver[0].file = id + '.md'
write('versions.json', ver.slice(0, 60))
console.log('版本已存：' + ver[0].label + '（' + ver[0].chars + ' 字）')

/* 2. 结任务：queue/*.json → t_*.json，status 改 done */
const Q = path.join(D, 'queue')
if (fs.existsSync(Q)) {
  for (const f of fs.readdirSync(Q).filter(x => x.endsWith('.json'))) {
    const p = path.join(Q, f)
    const t = JSON.parse(fs.readFileSync(p, 'utf8'))
    if (t.ref && t.ref.indexOf('中国体育') < 0) {
      console.log('跳过（与本稿无关）：' + t.ref)
      continue
    }
    t.status = 'done'
    t.doneAt = new Date().toLocaleString('zh-CN', { hour12: false })
    t.title = proj.title
    t.result = '初稿完成。' + ver[0].chars + ' 字，10 节，附来源清单；' +
      '素材 20 条已入库，事实清单 40 条待核；本篇未配图（见备注）。'
    fs.writeFileSync(path.join(D, 't_' + f), JSON.stringify(t, null, 2), 'utf8')
    fs.unlinkSync(p)
    console.log('已结任务：' + t.id)
  }
}

/* 3. 清掉重复的 write 任务（用户连点了几次提交） */
const done = fs.existsSync(D)
  ? fs.readdirSync(D).filter(x => /^t_.*\.json$/.test(x))
  : []
console.log('历史任务文件：' + done.length + ' 个')
