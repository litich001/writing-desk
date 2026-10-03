/**
 * 正文抽取的离线单元测试
 *
 * 为什么用固定样本而不是打真网站：
 *   真网站会反爬、会改版，测出来的失败分不清是代码错了还是对方拦了。
 *   离线样本能精确定位「是哪条规则写错了」。
 *   实网抽样验证另有一个脚本（engine/probe-peek.mjs），两件事分开看。
 */
import { extractArticle, stripChrome, isNoiseLine, looksLikeCode, dropNavRuns, looksLikeNavItem } from './extract.mjs'

/* 标记用 ASCII（PASS/FAIL），不用 ✓/✗：
   Windows 控制台会把这些字符编码成 ?，失败项在输出里就找不出来了。 */
let bad = 0
const fails = []
const ok = (n, c, e) => {
  console.log('  ' + (c ? 'PASS  ' : 'FAIL  ') + n + (e ? '   ' + e : ''))
  if (!c) { bad++; fails.push(n) }
}

console.log('\n  正文抽取单测')
console.log('  ' + '-'.repeat(64))

/* ---------- 样本 1：新浪财经式（顶部一排导航 + 正文 + 推荐位 + 页脚）---------- */
const SINA = `<!DOCTYPE html><html><head><title>金价暴跌后企稳 - 新浪财经</title>
<script>var a=1;</script></head><body>
<header class="topbar"><a href="/">新浪首页</a><a>新闻</a><a>体育</a><a>财经</a><a>娱乐</a><a>科技</a><a>博客</a><a>专栏</a><a>汽车</a></header>
<div class="nav-list"><ul><li>要闻</li><li>视频</li><li>图集</li><li>专题</li><li>排行</li></ul></div>
<div class="article-content">
  <h1>金价暴跌后企稳，交易者权衡美联储政策前景与中东地缘风险</h1>
  <p>纽约商品交易所黄金期货价格在连续三个交易日下跌后，于当地时间周二收盘小幅企稳。分析人士指出，本轮回调的直接诱因是美联储官员释放出的降息节奏放缓信号。</p>
  <p>从资金流向看，此前拥挤的多头仓位出现了明显的减仓迹象。数据显示，全球黄金 ETF 单日净流出规模达到约十一亿美元，为近六周最高水平。</p>
  <p>地缘因素仍是市场不愿忽视的变量。中东局势的不确定性使得避险需求并未完全消退，只是阶段性让位于利率预期的变化。分析师指出，如果通胀数据持续超预期，黄金的中期支撑位可能在每盎司两千九百美元附近。</p>
  <p>本页编辑：某某&nbsp;&nbsp;&nbsp;责任编辑：李某</p>
</div>
<div class="related"><h3>相关推荐</h3><ul><li>其他黄金新闻一</li><li>其他黄金新闻二</li></ul></div>
<div id="comment-area"><p>评论</p><p>登录后可评论</p></div>
<footer><p>京ICP证030173号</p><p>© 2026 新浪网 版权所有</p><p>举报 投诉 纠错</p></footer>
</body></html>`

const r1 = extractArticle(SINA, 'https://finance.sina.com.cn/x/123')
ok('新浪式：抓到正文', r1.strategy === 'content-class', '策略=' + r1.strategy)
ok('新浪式：拿到了第一段正文', r1.text.includes('纽约商品交易所黄金期货价格'), '')
ok('新浪式：拿到了第三段（跨多段）', r1.text.includes('地缘因素仍是市场不愿忽视的变量'), '')
ok('新浪式：标题进来了', r1.text.includes('金价暴跌后企稳'), '')
ok('新浪式：导航被删掉', !r1.text.includes('新浪首页'), '')
ok('新浪式：推荐位被删掉', !r1.text.includes('其他黄金新闻'), '')
ok('新浪式：页脚版权被删掉', !/ICP证|版权所有/.test(r1.text), '')
ok('新浪式：评论框被删掉', !r1.text.includes('登录后可评论'), '')
ok('新浪式：脚本被删掉', !r1.text.includes('var a=1'), '')
ok('新浪式：署名行被删掉', !r1.text.includes('责任编辑'), '')
ok('新浪式：正文占比够高（导航残留<20%）', (() => {
  const navWords = ['新浪首页', '体育', '财经', '娱乐', '科技', '博客', '专栏', '汽车', '要闻', '视频', '图集', '专题', '排行']
  const hit = navWords.filter(w => r1.text.includes(w))
  return hit.length === 0
})(), '')

/* ---------- 样本 2：没有 class 标记（最坏情况），靠密度 ---------- */
const PLAIN = `<html><body>
<div><a>A</a><a>B</a><a>C</a><a>D</a><a>E</a></div>
<div>首页 新闻 体育 财经 娱乐 科技 博客 专栏 汽车 教育 时尚 星座 健康 房产 历史 视频 游戏 旅游 邮箱 导航</div>
<div>
<p>据新华社报道，某地于当地时间九月三十日发布公告，决定对辖区内部分道路实施临时交通管制。公告明确，管制时间为十月一日零时至二十四时，涉及路段共计十四条。</p>
<p>公告称，管制期间所有机动车需绕行，非必要车辆不得进入。交通部门已在主要路口设置引导标志，并安排警力疏导交通。绕行方案已在官方网站公布。</p>
<p>当地交警部门提醒市民提前规划出行路线，避开管制路段。如有疑问可拨打服务热线咨询。热线号码在公告附表中列出，服务时间为每日八时至二十时。</p>
<p>交警表示，将根据实际通行情况动态调整管制措施，确保群众出行畅通有序。请广大市民给予理解和支持，自觉遵守交通管理规定。</p>
</div>
<div>责任编辑：李某 举报 投诉 反馈</div>
</body></html>`

const r2 = extractArticle(PLAIN, 'https://example.com/a')
ok('无 class：靠密度挑出正文', r2.text.includes('据新华社报道'), '策略=' + r2.strategy)
ok('无 class：拿到了中间段', r2.text.includes('公告称，管制期间'), '')
ok('无 class：拿到了最后一段', r2.text.includes('交警表示，将根据实际通行情况'), '')
ok('无 class：导航行没混进来', !r2.text.includes('星座 健康'), '')
ok('无 class：页脚没混进来', !r2.text.includes('举报 投诉'), '')

/* ---------- 样本 3：搜索结果页 → 必须明说抓不到，不要给噪音 ---------- */
const SEARCH = `<html><head><title>xxx - 百度</title></head><body>
<div class="nav"><a>笔记</a><a>视频</a><a>图片</a><a>资讯</a><a>文库</a></div>
<div>综合 笔记 视频 图片 资讯 文档 商品 采购 小说 音乐 问答 排序方式 最新 发布时间 24小时 1周内 1月内</div>
<div>点击即刻体验AI搜索！百度一下，你就知道</div>
<div>京ICP证030173号 © 2026 Baidu 使用百度前请阅读百度协议</div>
</body></html>`

const r3 = extractArticle(SEARCH, 'https://m.baidu.com/s?word=abc')
ok('搜索页：判定为 search-page', r3.strategy === 'search-page', '策略=' + r3.strategy)
ok('搜索页：不返回噪音文本', r3.text === '', '返回 ' + r3.text.length + ' 字')
ok('搜索页：哪怕页面里有长正文也不给（摘要拼接会骗人）', (() => {
  const fake = '<html><head><title>x - 百度</title></head><body>' +
    '<div class="c-result">' + '<p>这是一段看起来很像正文的搜索结果摘要文字，足够长了吧，足够让密度算法选中它了吧。'.repeat(4) + '</p></div>' +
    '</body></html>'
  const r = extractArticle(fake, 'https://m.baidu.com/s?word=x')
  return r.text === '' && r.strategy === 'search-page'
})(), '策略=' + extractArticle('<html><body><p>' + '摘要文字。'.repeat(80) + '</p></body></html>', 'https://m.baidu.com/s?word=x').strategy)

/* ---------- 样本 4：JS 壳页面（今日头条这类）→ 必须返回空而不是假正文 ---------- */
const JSSHELL = `<html><head><title>今日头条</title></head><body>
<div class="wrap">今日头条 您需要允许该网站执行 JavaScript 才能继续</div>
</body></html>`
const r4 = extractArticle(JSSHELL, 'https://www.toutiao.com/x')
ok('JS 壳页：不给假正文', r4.text === '', '返回 ' + r4.text.length + ' 字')

/* ---------- 样本 5：噪声行过滤本身 ---------- */
ok('噪声行：识别版权', isNoiseLine('© 2026 新浪网 版权所有'))
ok('噪声行：识别 ICP', isNoiseLine('京ICP证030173号'))
ok('噪声行：识别「相关阅读」', isNoiseLine('相关阅读：更多新闻'))
ok('噪声行：正文句不会被误杀', !isNoiseLine('交警表示，将根据实际通行情况动态调整管制措施。'))
ok('噪声行：正文含「版权」二字也不误杀', !isNoiseLine('这张照片的版权归摄影师所有，已获授权使用。'))

/* ---------- 样本 6：stripChrome 不破坏正文 ---------- */
const sc = stripChrome('<div class="nav"><a>x</a></div><p>这是一段正文。</p>')
ok('stripChrome 删导航留正文', !sc.includes('>x<') && sc.includes('这是一段正文'), '')

/* ---------- 样本 6b：内联 JS 混进正文块（网易/知乎/掘金实网踩到过）----------
   实测：抓网易新闻返回的是 `var hideOuterSearch="0",getReferFrom=function(){...`，
   用户看到一堆代码，等于没抓到。这条必须钉死。 */
const WITH_JS = `<html><body>
<div class="post_body">
  <script>var hideOuterSearch="0";</script>
  <div>window._cfg = {aid:1, url:"/x"}; function getReferFrom(t){var a=/163\\.com/.test(t);return a?"a":"b"} (function(w,d){var s=d.getElementsByTagName("s")[0];d.getElementById("x").innerHTML=s.src})(window,document);</div>
  <p>杭州一位女孩每天乘坐高铁往返通勤，单程约三小时，往返合计六小时，月通勤成本约两千余元。她说这份工作在北京，单位愿意承担大部分费用，自己承担一部分交通和租房成本，算下来每月结余并不比在杭州少多少。</p>
  <p>她把这笔账算得很细：高铁二等座单程约八十元，往返一百六十元，一个月二十二个工作日就是三千五百二十元；租房每月一千八百元，合计五千三百多元，比在杭州的房租一千二百元高出四千多元。</p>
  <p>同事算过另一笔账：如果把每周三天的通勤换成在杭州远程办公，每月能省下约一千五百元，但岗位晋升机会明显少了一截。她最终还是选择留在北京，理由是行业机会集中在北京，而高铁把通勤成本压到了可以承受的范围。</p>
  <p>这不是一个孤立的案例。多地高铁商务座和通勤票的推出，正在把「住在高铁沿线城市、去中心城市上班」从设想变成可选项。代价是每天六小时在路上，以及几乎放弃了下班后的时间。</p>
</div>
</body></html>`

const r6b = extractArticle(WITH_JS, 'https://www.163.com/news/a')
ok('JS 污染：抓到正文', r6b.text.includes('杭州一位女孩每天乘坐高铁'), '策略=' + r6b.strategy)
ok('JS 污染：拿到了中段', r6b.text.includes('她把这笔账算得很细'), '')
ok('JS 污染：拿到了末段', r6b.text.includes('这不是一个孤立的案例'), '')
ok('JS 污染：没有 var/function 残留', !/\b(var|function)\s/.test(r6b.text), '')
ok('JS 污染：没有 window/document 残留', !/(window\.|document\.|innerHTML)/.test(r6b.text), '')
ok('JS 污染：正文里汉字占比 > 85%', (() => {
  const t = r6b.text.replace(/\s/g, '')
  const cjk = (r6b.text.match(/[\u4e00-\u9fa5]/g) || []).length
  return t.length > 0 && cjk / t.length > 0.85
})(), '汉字占比 ' + ((r6b.text.match(/[\u4e00-\u9fa5]/g) || []).length / (r6b.text.length || 1)).toFixed(2))

/* ---------- 样本 8：靠正则永远抓不到的代码行 ----------
   实网三个版本都漏过的：
     jQuery.ajaxSettings.cache = true          网易
     bdms: { aid: 2608, paths: [ '/x', ... ]   掘金
     suds_init(3465,100.0000,1015,2);         新浪
   这次靠「汉字占比低 + 含代码符号」抓，不靠关键字枚举。 */
ok('代码行：jQuery 赋值被识别', looksLikeCode('jQuery.ajaxSettings.cache = true'))
ok('代码行：对象字面量被识别', looksLikeCode("bdms: { aid: 2608, paths: [ '/growth_api/v1/check_in', '/x' ] }"))
ok('代码行：函数调用被识别', looksLikeCode('suds_init(3465,100.0000,1015,2);'))
ok('代码行：对象键值被识别', looksLikeCode('plugins: { ajax: { ignoreUrls: [\'a\'], monitor: [] } }'))
ok('不误杀：含数字的中文正文', !looksLikeCode('9月29日，国内期货市场收盘价格上涨，其中沪铜涨2.1%。'))
ok('不误杀：含括号的中文正文', !looksLikeCode('当地警方称（含）将展开调查。'))
ok('不误杀：正常英文导航', !looksLikeCode('首页 新闻 体育 财经 娱乐'))

/* ---------- 样本 9：连续导航块（实网踩到）----------
   实测残留：网易「网易首页 应用 网易新闻 网易公开课 网易红彩 网易严选 邮箱大师 网易云课堂 快速导航」
             东财「指数 期指 个股 板块 新股 基金 港股 美股 期货 外汇 黄金 自选基金 资金流向 主力排名」
   单行过滤器抓不住 —— 没有「首页：」前缀，字数也不短。 */
const NAVBLOCK = `<html><body><div class="article-content">
<p>网易首页</p><p>应用</p><p>网易新闻</p><p>网易公开课</p><p>网易红彩</p><p>网易严选</p><p>邮箱大师</p><p>快速导航</p>
<p>这家公司十七年前破格录用了一名机车少年，那年他二十一岁，公司账上现金只够再撑三个月。后来这家企业做成了行业第三，估值最高时超过两百亿元。</p>
<p>负责人回忆，当年的决定并不复杂：厂区通勤单程要换三次车，年轻人每天在路上的时间比上班还长，厂里前后考察了六个人，最终把这个人留了下来。</p>
<p>这名员工后来负责了公司的核心业务线。十七年里他没有跳过级，公司上市时他分到了可观的股份，如今面临是否出让的问题。</p>
<p>有人劝他卖，也有人劝他留。他自己的说法很简单：公司给了他一个不必解释自己的起点，这一点不会因为股价变化而改变。</p>
</div></body></html>`
const r7 = extractArticle(NAVBLOCK, 'https://www.163.com/news/b')
ok('导航块：抓到正文', r7.text.includes('这家公司十七年前破格录用'), '策略=' + r7.strategy)
ok('导航块：拿到了中段', r7.text.includes('负责人回忆'), '')
ok('导航块：拿到了末段', r7.text.includes('有人劝他卖'), '')
ok('导航块：导航行被清掉', !r7.text.includes('网易公开课') && !r7.text.includes('快速导航'), '')

ok('导航行：短词组识别', looksLikeNavItem('网易公开课'))
ok('导航行：识别带分隔的长导航行', looksLikeNavItem('指数 期指 个股 板块 新股 基金'))
ok('不误杀：短句正文', !looksLikeNavItem('他走了。'))
ok('不误杀：带逗号的短句', !looksLikeNavItem('这事儿没那么简单，说到底是钱的问题。'))
ok('不误杀：短标题行', !looksLikeNavItem('附：本次调整涉及三个部门'))

/* ---------- 样本 10：数字实体（标题里满是 en dash 和中文引号）---------- */
const r5 = extractArticle('<div class="article-content"><p>他说&#34;这事儿没那么简单&#34;，然后&nbsp;走了。后面还有很多很多字repeat'.repeat(6) + '</div>', 'https://x.com')
ok('实体解码：数字实体 &#34;', r5.text.includes('"这事儿没那么简单"'), r5.text.slice(0, 26))

console.log('  ' + '-'.repeat(64))
if (bad === 0) console.log('  全部通过')
else {
  console.log('  ' + bad + ' 项失败:')
  fails.forEach(f => console.log('    - ' + f))
}
console.log('')
process.exit(bad ? 1 : 0)