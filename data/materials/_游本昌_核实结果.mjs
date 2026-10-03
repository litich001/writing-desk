/**
 * 事实核实结果 —— 游本昌稿
 *
 * 核实时间：2026-10-01
 * 核实方式：维基百科（有参考文献）+ DuckDuckGo 检索 + 多家媒体交叉比对
 *
 * ★ 这次核实查出了 4 处原稿错误，其中 2 处是硬错（日期/来源搞错）。
 *   原稿把「有人民日报署名的本人自述」写成「只有网易号自媒体」——
 *   把可靠来源写成了不可靠来源，这是最严重的一类错。
 */

export const FACTS = [
  // ── 原稿正确，且现在有硬出处 ──
  { label: '出生', value: '1933年9月16日', verdict: 'ok', risk: 'high',
    src: '维基百科（引金陵晚报、许晋杭《梦想永远不会太晚》）',
    note: '原稿只写1933年，未写月日' },

  { label: '去世', value: '2026年9月24日，93岁', verdict: 'ok', risk: 'high',
    src: '上观新闻、中国国家话剧院讣告' },

  { label: '告别仪式', value: '2026年9月30日 八宝山', verdict: 'ok', risk: 'high',
    src: '中国国家话剧院微信公号、中新网' },

  { label: '★ 77个龙套', value: '79个角色中77个是龙套', verdict: 'ok', risk: 'high',
    src: '游本昌本人署名文章《演员这一行，没有白费的功夫》，《人民日报》刊发',
    note: '★ 出处比原稿写的强得多。原稿标注为「网易号自媒体」，实际是他本人自述 + 人民日报。' },

  { label: '★ 19本书', value: '为演《大雷雨》无台词农奴，读了19本书', verdict: 'ok', risk: 'high',
    src: '游本昌本人受访；新浪娱乐、网易、百度百科多源引用',
    note: '★ 原稿写「19个译本」不准确。是19本书（俄国农奴制著作+中译本+评论），不是19个译本。' },

  { label: '★ 卖房', value: '2009年，76岁，卖北京唯一住房', verdict: 'ok', risk: 'high',
    src: '网易深度报道、新浪财经；本人回应「卖房子怎么了？这是对的」',
    note: '★ 原稿漏了：他卖过两次房。2006年为拍公益剧《了凡》卖过一处。' },

  { label: '★ 白玉兰', value: '2024年5月申报期主动退出', verdict: 'ok', risk: 'high',
    src: '新浪财经、中华网、搜狐多源',
    note: '★ 原稿写「剧方工作人员后来透露」是错的。是他本人主动联系剧组。原话「让更多年轻人能被观众和行业看到」。第29届。' },

  { label: '★ 21页申请书', value: '21页，手写，不用打印件', verdict: 'ok', risk: 'high',
    src: '央视新闻 cctvnews、新华报业网',
    note: '★ 原稿把三件事混成一件：2024-05-30 提交申请书 / 2025-05 批准为预备党员 / 2025-06-30 宣誓。且漏了「坚持手写不用打印件」——这是比页数更有力的细节。' },

  // ── ★ 原稿错误，已修正 ──
  { label: '★★ 金鹰奖年份', value: '1986年（评1985年度）', verdict: 'ok', risk: 'high',
    src: '维基百科荣誉奖项表、第2届金鹰奖获奖名单',
    note: '★★ 原稿写「1985年凭《济公》获当年金鹰奖」。金鹰奖是1986年颁发，评的是1985年度作品。硬错。' },

  { label: '★ 妻子病情', value: '1991年确诊，1995年好转', verdict: 'ok', risk: 'medium',
    src: '维基百科（引大公报2015）' },

  { label: '★ 济公活佛集数', value: '原定20集，只拍4集', verdict: 'ok', risk: 'medium',
    src: '维基百科演出作品表' },

  { label: '★ 终身成就奖', value: '2024年10月 第32届金鹰奖', verdict: 'ok', risk: 'medium',
    src: '澎湃新闻' },

  // ── 仍只有一个自媒体出处，必须弱化 ──
  { label: '⚠ 90%收视率', value: '首播收视率超90%', verdict: 'wait', risk: 'high',
    src: '仅自媒体；未找到1985年官方统计或同期报道',
    note: '⚠ 没有任何官方或同期来源。1985年没有收视率统计体系，这个数字大概率是后来的估算。建议改写成「当年火到什么程度」，不给具体百分比。' },

  { label: '⚠ 39度/12次挨打', value: '拍济公期间晒脱皮、发烧39度、挨打12次', verdict: 'wait', risk: 'medium',
    src: '未找到可靠出处',
    note: '⚠ 建议删掉。这类「苦情细节」自媒体最爱编，且叙事价值不高。' }
]

/* 汇总 */
const ok = FACTS.filter(f => f.verdict === 'ok')
const wait = FACTS.filter(f => f.verdict === 'wait')
const fixed = FACTS.filter(f => (f.note || '').startsWith('★') || (f.note || '').includes('★'))
const wrong = FACTS.filter(f => (f.note || '').includes('★★'))

console.log('核实结果：')
console.log('  已核实 ' + ok.length + ' 条')
console.log('  仍只有一个自媒体出处 ' + wait.length + ' 条')
console.log('  查出并修正原稿错误 ' + fixed.length + ' 处（其中硬错 ' + wrong.length + ' 处）')
console.log('')
console.log('★ 必须改稿的硬错：')
for (const f of wrong) console.log('  ' + f.label + ' → ' + f.value + '\n     ' + f.note)
console.log('')
console.log('⚠ 必须降级表述的：')
for (const f of wait) console.log('  ' + f.label + '：' + f.note)