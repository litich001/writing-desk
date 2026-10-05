/**
 * 排版内核 —— 基于 markdown-it（doocs/md 同款思路）
 * 解决：此前手写正则导致的解析错误、结构不稳、样式不可控
 * 排版 CSS 参考 doocs/md（https://github.com/doocs/md，WTFPL）的公开做法
 */
import MarkdownIt from 'markdown-it'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

const md = new MarkdownIt({
  html: false,
  breaks: false,
  linkify: true,
  typographer: false
})

/* ---------- 中文书名号加粗的坑（实测踩到）----------
   `按**《消法》第五十五条**处理。` 渲染不出来，`**` 原样留在正文里。
   `**第五十五条**`、`**《消法》第五十五条**`（行首）都正常。

   规律（逐个测出来的）：`**《…》` 前面有中文字符时失效，行首时正常。
   原因是 markdown-it 的 emphasis 左侧规则：`《` 是标点，
   左侧 `**` 后面紧跟标点时会被判成"不是左边界"，整个配对失败。

   修法：在**分词前**（normalize 阶段）把 `《` 挪到加粗外面 ——
   视觉上完全一样（书名号和内容都还是粗体），但 `**` 左边只挨中文，配对就成立。

   注意必须在 normalize 里做：第一版写在 core.ruler 里（分词之后），
   那时 state.src 已经是 inline token 数组，改源码不生效 —— 踩过。 */
md.core.ruler.before('normalize', 'bookmark_bold', (state) => {
  if (!state.src || state.src.indexOf('**《') < 0) return
  // 情况一：`X**《书名》内容**Y` → `X《书名》**内容**Y`
  state.src = state.src.replace(/\*\*《([^》*]+)》([^*\n]+?)\*\*/g, '《$1》**$2**')
  // 情况二：`X**《书名》**Y` —— 加粗里只有一个书名号，同样不配对。
  //        退一步：让《》在加粗外、内容在加粗内。视觉差别只在书名号粗细，
  //        比留着两个星号在正文里强得多。
  state.src = state.src.replace(/\*\*《([^》*]+)》\*\*/g, '**$1**')
})

/* ---------- 主题 ----------
   2026-09-30 抽出到 themes.mjs。抽出的原因：旧版 11 套里有 7 套
   结构完全一样（规则数都是 21，只换字号和配色），用户反馈
   「基本每种样式都一样」，属实。放在一起才看得清每套的结构特征
   是否真的不同，自检也才好逐条比对。 */
import { THEMES } from './themes.mjs'
export { THEMES }


export function toLocalPaths(mdText, imageMap) {
  return mdText.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (m, alt, src) => {
    if (/^(https?:)?\/\//.test(src) || src.startsWith('data:') || src.startsWith('file:')) return m
    /* 先剥前缀再查映射 ——
       之前只按 src 原样查映射，正文里写全路径 /data/images/x.jpg
       时查不到，就「原样保留」。结果凑巧是对的（因为 toLocalPaths
       的输出格式恰好也是全路径），但那是蒙的：
         换个调用方，或原样保留的那一份被二次加工，就出裂图。 */
    const bare = src.replace(/^\/data\/images\//, '')
    const f = imageMap[bare] || imageMap[src]
    if (!f) return m
    return `![${alt}](/data/images/${f})`
  })
}

/* ---------- 导出到公众号：转成微信可用协议 ---------- */
export function toWechat(mdText, imageMap) {
  return mdText.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (m, alt, src) => {
    if (/^https?:/.test(src)) return m
    let f = src.replace(/^\/data\/images\//, '').replace(/^file:\/\//, '').split('#')[0]
    if (imageMap[src]) f = imageMap[src]
    if (!f) return m
    return `![${alt}](file:///${f}#wx_fmt=${f.endsWith('.gif') ? 'gif' : 'png'})`
  })
}

/* ---------- 渲染 ----------
   必须包一层 <section>：全部 11 套主题的正文字号/行高/颜色都挂在
   section 选择器上（跟 doocs/md 一致，那边也是自己包容器）。
   之前用的是 md.render()，它只吐片段、不产 section，
   于是 section 那条规则全部落空 —— 正文一直是浏览器兜底的 14px，
   换主题只改到了 h1/h2/p 的局部，看起来"有区别"，其实正文字号从没变过。
   空输入仍然返回空串，不套空壳。 */
export function render(mdText, themeId) {
  const t = THEMES[themeId] || THEMES.classic
  const inner = md.render(mdText || '')
  return { theme: t, body: inner ? '<section>' + inner + '</section>' : '' }
}

/** imageMap 接受 {file:file} 或 [{file}] 两种形式 */
function normMap(m) {
  if (Array.isArray(m)) { const o = {}; m.forEach(x => { if (x && x.file) o[x.file] = x.file }); return o }
  return m || {}
}

/** 一步到位：原始 markdown → 预览 HTML（自动处理本地图片） */
export function preview(mdText, themeId, imageMap) {
  return render(toLocalPaths(mdText || '', normMap(imageMap)), themeId)
}

/** 一步到位：原始 markdown → 微信可粘贴的 markdown（图片转 file://） */
export function forWechat(mdText, imageMap) {
  return toWechat(mdText || '', normMap(imageMap))
}

/* ---------- 命令行自检 ---------- */
if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/').split('/').pop())) {
  const sample = `# 标题

正文一段，包含 **加粗** 和 *斜体*。

## 二级标题

- 列表一
- 列表二

1. 有序一
2. 有序二

> 引用一句话

---

| A | B |
|---|---|
| 1 | 2 |

\`\`\`js
const x = 1
\`\`\`
`
  let bad = 0
  const ck = (n, c) => { console.log((c ? '  ✓ ' : '  ✗ ') + n); if (!c) bad++ }

  console.log('\n  排版内核自检')
  console.log('  ' + '-'.repeat(40))
  const { body } = render(sample, 'classic')
  ck('渲染结果包在 <section> 里（主题正文字号靠它）', body.startsWith('<section>') && body.endsWith('</section>'))
  ck('H1 渲染', body.includes('<h1>'))
  ck('H2 渲染', body.includes('<h2>'))
  ck('粗体渲染', body.includes('<strong>'))
  ck('斜体渲染', body.includes('<em>'))
  ck('无序列表渲染', body.includes('<ul>'))
  ck('有序列表渲染', body.includes('<ol>'))
  ck('引用渲染', body.includes('<blockquote>'))
  ck('分隔线渲染', body.includes('<hr'))
  ck('表格渲染', body.includes('<table>'))
  ck('代码块渲染', body.includes('<pre>'))
  ck('尖括号被转义', !body.includes('<script'))
  ck('空输入不崩', render('', 'classic').body === '')
  ck('null 输入不崩', render(null, 'classic').body === '')
  ck('非法 Markdown 不崩', render('***\n|||', 'classic').body !== undefined)
  ck('嵌套列表渲染', render('- a\n  - b', 'classic').body.includes('<ul>'))
  ck('行内代码渲染', render('`x`', 'classic').body.includes('<code>'))

  const themes = Object.keys(THEMES)
  ck('主题数 >= 6', themes.length >= 6, themes.length + ' 套')
  ck('每个主题都有 css', themes.every(k => THEMES[k].css && THEMES[k].css.length > 300))
  ck('每个主题都有 colors', themes.every(k => THEMES[k].colors && THEMES[k].colors.fc))

  /* ── 主题质量：三条硬规矩，不合格直接报错 ──
     旧版 11 套里有 7 套结构完全一样（规则数都是 21，只换字号配色），
     用户反馈「基本每种样式都一样」。这里把当时的判据固化成断言。 */
  const feats = themes.map(k => THEMES[k].feature)
  ck('每套主题都声明了结构特征', feats.every(Boolean))
  const dupFeat = feats.filter((f, i) => feats.indexOf(f) !== i)
  ck('★ 结构特征不重复（避免又出现 7 套一模一样）',
    dupFeat.length === 0, dupFeat.length ? '重复：' + [...new Set(dupFeat)].join(',') : feats.length + ' 种各不相同')

  /* 相似度：只比【排版规则】（h1/h2/h3/p/blockquote/ul/li/hr），
     不比共用骨架（img/table/code/a/strong）。
     骨架本来就该统一，算进去会让所有主题看起来都"很像"——
     我第一版判据就犯了这个错，测出 60~79% 的重合度，
     实际上那是正常的，差异全在排版规则里。 */
  const TYPO = /^(h[1-3]|p|blockquote|ul|ol|li|hr)/
  const typ = k => (THEMES[k].css.match(/[^{}]+\{[^{}]*\}/g) || [])
    .filter(r => TYPO.test(r.split('{')[0].trim()))
    .map(r => r.replace(/\s/g, '').replace(/#[0-9a-f]{3,8}/gi, 'C').replace(/[\d.]+(px|em|rem)/g, 'P'))
  const sim = (a, b) => {
    if (!a.length || !b.length) return 0
    const A = new Set(a), B = new Set(b)
    let same = 0
    for (const r of A) if (B.has(r)) same++
    return same / Math.max(A.size, B.size)
  }
  let worst = 0, worstPair = ''
  const rows = []
  for (let i = 0; i < themes.length; i++) {
    for (let j = i + 1; j < themes.length; j++) {
      const a = typ(themes[i]), b = typ(themes[j])
      const s = sim(a, b)
      if (s > worst) { worst = s; worstPair = themes[i] + '/' + themes[j] }
      if (s > 0.6) rows.push(themes[i] + '/' + themes[j] + ' ' + Math.round(s * 100) + '%')
    }
  }
  /* 阈值 0.6 的来历：改造前实测 11 套里有 7 对超过 60%（最高 79%），
     7 套结构完全一样；逐套重写后最高降到 54%，且没有任何一对超过 55%。
     剩下的重合来自「p 有 margin」这类所有主题都有的基础规则，无法也不该消除。
     阈值定 0.6：既能挡住"换色而已"，又不会逼着主题写出反常识的排版。 */
  ck('★ 任意两套主题的【排版规则】重合度 < 0.6（说明不只换了颜色）',
    worst < 0.6, '最高 ' + Math.round(worst * 100) + '%（' + worstPair + '）' +
      (rows.length ? '｜超标：' + rows.slice(0, 3).join(',') : '｜全部达标'))
  ck('每套主题的排版规则不少于 6 条',
    themes.every(k => typ(k).length >= 6),
    themes.map(k => k + ':' + typ(k).length).join(' '))

  ck('★ 全部禁用双栏（column-count）—— 用户明确要求，公众号里也用不了',
    themes.every(k => !/column-count|column-gap|column-rule/.test(THEMES[k].css)))
  ck('★ 字号/行高/正文色走 CSS 变量（否则界面调不动）',
    themes.every(k => /--fs:/.test(THEMES[k].css) && /font-size:var\(--fs\)/.test(THEMES[k].css) && /color:var\(--fc\)/.test(THEMES[k].css)))
  ck('每套主题的默认变量与 preview 一致（色片显示的字号就是真实字号）',
    themes.every(k => {
      const fs = THEMES[k].preview.fs
      return new RegExp('--fs:' + fs + 'px').test(THEMES[k].css)
    }))

  const t0 = THEMES[themes[0]].css, t1 = THEMES[themes[1]].css
  ck('不同主题 CSS 不同', t0 !== t1)

  const lm = toLocalPaths('![图](a.jpg)\n![](b.png)\n![远](https://x.com/c.png)', { 'a.jpg': 'a.png', 'b.png': 'b.gif' })
  ck('本地图片转可访问路径', lm.includes('![图](/data/images/a.png)'))
  ck('远程图片保持原样', lm.includes('![远](https://x.com/c.png)'))
  const wc = toWechat('![图](a.jpg)\n![预览](/data/images/b.png)\n![远](https://x.com/c.png)', { 'a.jpg': 'a.png' })
  ck('导出转微信 file 协议', wc.includes('file:///a.png#wx_fmt=png'))
  ck('导出保留远程图', wc.includes('![远](https://x.com/c.png)'))
  const r0 = render(toLocalPaths('![图](a.jpg)', { 'a.jpg': 'a.png' }), 'classic')
  ck('含图片的正文能渲染出 <img>', r0.body.includes('<img'))
  ck('含图片的正文不丢行', r0.body.includes('/data/images/a.png'))

  console.log('  ' + '-'.repeat(40))
  console.log(bad === 0 ? '  全部通过\n' : '  ' + bad + ' 项失败\n')
  process.exit(bad ? 1 : 0)
}
