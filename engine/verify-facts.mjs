/* 事实核实：把只有自媒体出处的那些逐条去查
 *
 * 为什么要查：这一稿的两个支点（77 个龙套、90% 收视率）
 * 目前只有网易号一个来源。用自媒体当唯一出处写进 5000 字的稿子，
 * 是把风险全押在一个人身上。
 *
 * 输出：每条给出「查到了 / 没查到 / 出处不够」三档，
 * 不够的那条要给出降级写法 —— 宁可弱化表述，不能硬写。
 */
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36'

async function get(url) {
  const r = await fetch(url, {
    headers: { 'user-agent': UA, 'accept-language': 'zh-CN,zh;q=0.9' },
    signal: AbortSignal.timeout(15000)
  })
  if (!r.ok) throw new Error('HTTP ' + r.status)
  return r.text()
}

/* 各条待查内容 + 检索入口 */
const CHECKS = [
  { key: '77个龙套', what: '游本昌 1956-1985 年演了多少角色、多少是龙套' },
  { key: '90%收视率', what: '1985 年《济公》首播收视率' },
  { key: '19个译本', what: '为演《大雷雨》农奴翻遍多少个译本' },
  { key: '卖房年份', what: '游本昌卖房买弘一话剧版权是哪一年' },
  { key: '白玉兰申报', what: '2024 年游本昌主动放弃白玉兰申报' },
  { key: '21页申请书', what: '92 岁入党申请书多少页' },
  { key: '金鹰奖年份', what: '凭《济公》拿金鹰奖是哪一年' },
  { key: '妻子病情', what: '杨慧华哪年确诊癌症' }
]

const ENGINES = [
  q => 'https://www.bing.com/search?q=' + encodeURIComponent(q),
  q => 'https://search.marcia.com/search?q=' + encodeURIComponent(q),
  q => 'https://www.sogou.com/web?query=' + encodeURIComponent(q)
]

function strip(h) {
  return h
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{2,}/g, '\n')
}

const results = []
for (const c of CHECKS) {
  const q = c.what
  let found = false, snippets = []
  for (const mk of ENGINES) {
    if (found) break
    try {
      const h = strip(await get(mk(q)))
      // 找出含关键数字或关键词的片段
      const lines = h.split('\n').map(s => s.trim()).filter(s => s.length > 30 && s.length < 200)
      const re = new RegExp(c.key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')
      const hit = lines.filter(l => re.test(l))
      if (hit.length) {
        found = true
        snippets = hit.slice(0, 3)
      }
    } catch (e) { /* 换下一个引擎 */ }
  }
  results.push({ ...c, found, snippets })
  console.log((found ? '[查到] ' : '[没查] ') + c.key + '  —  ' + c.what)
  snippets.forEach(s => console.log('        ' + s.slice(0, 140)))
}

const got = results.filter(r => r.found).length
console.log('\n查到 ' + got + ' / ' + results.length + ' 条')
console.log('\n（检索引擎对中文新闻的覆盖有限，查不到不代表事实错，')
console.log('  但足以说明「只有自媒体一个出处」这件事必须写进稿子的风险里）')