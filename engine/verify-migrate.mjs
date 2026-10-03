/* 迁移后完整性验证：走服务端 API，不依赖浏览器。
   浏览器会话在迁移时断了，但数据完整性不该依赖浏览器。 */
const BASE = 'http://127.0.0.1:8848'
const post = (p, b) => fetch(BASE + p, {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b)
}).then(r => r.json())
const get = p => fetch(BASE + p).then(r => r.json())

let bad = 0
const ck = (n, c, e) => { console.log('  ' + (c ? 'PASS  ' : 'FAIL  ') + n + (e ? '   ' + e : '')); if (!c) bad++ }

console.log('\n  迁移后完整性验证  (' + process.cwd() + ')')
console.log('  ' + '-'.repeat(62))

const st = await get('/api/state')   // /api/state 直接返回对象，没有 data 包装层

ck('正文完整', st.body && st.body.replace(/\s/g, '').length > 4000, (st.body || '').replace(/\s/g, '').length + ' 字')
ck('图片清单完整', st.images.length >= 4, st.images.length + ' 张')
ck('正文里配了图', (st.body.match(/!\[[^\]]*\]\(/g) || []).length >= 4, (st.body.match(/!\[[^\]]*\]\(/g) || []).length + ' 处')
ck('素材清单完整', st.materials.length > 15, st.materials.length + ' 条')
ck('历史版本完整', st.versions.length >= 6, st.versions.length + ' 版')
ck('排版主题 11 套', st.themes.length === 11, st.themes.length + ' 套')
ck('当前项目设置已存', !!(st.project && st.project.theme), '主题=' + (st.project && st.project.theme))

// 排版内核真能渲染
const pv = await post('/api/preview', { text: st.body, theme: st.project.theme, images: st.images })
ck('排版预览能渲染', !!(pv.html && pv.html.length > 3000), (pv.html || '').length + ' 字 HTML')
ck('排版 CSS 有内容', !!(pv.css && pv.css.length > 300), (pv.css || '').length + ' 字')

// 加粗渲染：正文里有没有 ** 是稿子的事，排版内核能不能渲染是内核的事 —— 分开验
const boldSample = '这是**关键判断**和**关键数字**。'
const pv2 = await post('/api/preview', { text: boldSample, theme: 'classic', images: [] })
ck('★ 排版内核能渲染 ** 加粗', /<strong>/.test(pv2.html), (pv2.html.match(/<strong>/g) || []).length + ' 处')
ck('当前正文用了加粗（用户明确要求）', (st.body.match(/\*\*/g) || []).length >= 8,
  (st.body.match(/\*\*/g) || []).length / 2 + ' 处加粗')

// 热点 CLI 独立可用
const hot = await get('/api/hot')
const srcs = hot.sources || []
const ok = srcs.filter(s => s.ok).length
ck('热点源可用', ok >= 10, ok + '/' + srcs.length + ' 个')

/* 原文预览：JS 壳站（头条/知乎/抖音）本来就抓不到，那是正确行为不是 bug。
   所以样本必须跳过它们 —— 拿头条当样本会误判成「预览坏了」。
   实测过的 JS 壳站：toutiao.com / zhihu.com / douyin.com / kuaishou.com */
const SHELL_HOST = /toutiao\.com|zhihu\.com|douyin\.com|kuaishou\.com|hupu\.com|baidu\.com|douban\.com/
const sample = srcs.filter(s => s.ok && s.items.length && s.items.some(it => it.url && !SHELL_HOST.test(it.url)))[0]
if (sample) {
  const item = sample.items.find(it => it.url && !SHELL_HOST.test(it.url))
  const pk = await post('/api/hot/peek', { url: item.url })
  const t = pk.text || ''
  const jsLeak = /jQuery\.|\bdms\s*:\s*\{|suds_init|function\s+\w+\s*\(/.test(t)
  ck('原文预览能抓到正文', t.length > 150, sample.name + ' ' + t.length + ' 字')
  ck('★ 预览无 JS 残留', !jsLeak)
  ck('★ 预览正文汉字占比 > 40%', (t.match(/[\u4e00-\u9fa5]/g) || []).length / (t.length || 1) > 0.4)
} else {
  ck('有可用于预览测试的非 JS 壳样本', false, '所有源的链接都是壳页或被过滤')
}

// JS 壳站必须明说抓不到，而不是给一堆噪音
const shellItem = srcs.flatMap(s => (s.items || []).map(it => ({ ...it, src: s.name }))).find(it => it.url && SHELL_HOST.test(it.url))
if (shellItem) {
  const pk = await post('/api/hot/peek', { url: shellItem.url })
  const t = (pk.text || '').trim()
  ck('★ 壳页/搜索页不给假正文', t === '' || pk.isSearchPage, shellItem.src + ' 返回 ' + t.length + ' 字' + (pk.isSearchPage ? '（已标搜索页）' : ''))
}

console.log('  ' + '-'.repeat(62))
console.log(bad === 0 ? '  全部通过' : '  ' + bad + ' 项失败')
console.log('')
process.exit(bad ? 1 : 0)