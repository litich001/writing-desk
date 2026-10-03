/**
 * 网页正文抽取
 *
 * 为什么单独成模块：这件事很容易「看起来能用其实不能用」。
 * 第一版只做「去标签取文字」，结果抓回来的全是站点导航和页脚：
 *   新浪首页 新闻 体育 财经 娱乐 科技 博客 专栏 汽车 教育 时尚 …
 *   订阅 RSS订阅 收藏 分享 评论 举报 …
 * 用户要的是看文章，不是看菜单。所以正文抽取必须：
 *   1. 先整块删掉「页面框架」（导航/页眉/页脚/侧栏/评论/推荐/广告）
 *   2. 再从剩下的里挑出正文密度最高的块
 *   3. 最后才去标签
 *
 * 纯函数，无 IO —— 这样能拿固定样本做单元测试，
 * 不必每次都去打真网站（打真网站会因反爬/改版时好时坏，测不出代码对错）。
 */

/* 页面框架：这类标签整块丢掉，里面的内容一定不是正文 */
const CHROME_TAGS = [
  'script', 'style', 'noscript', 'iframe', 'form', 'button', 'input', 'select', 'textarea',
  'svg', 'canvas', 'template', 'nav', 'header', 'footer', 'aside'
]

/* 靠 class/id 判断的框架容器。
   只匹配「整个词」或连字符/下划线分隔的词，避免误杀正文里带 search 的段落。 */
const CHROME_CLASS = [
  'nav', 'navbar', 'menu', 'header', 'footer', 'sidebar', 'side-bar', 'aside',
  'breadcrumb', 'crumb', 'comment', 'reply', 'discuss', 'share', 'social',
  'related', 'recommend', 'recommand', 'hot-list', 'rank', 'ranking',
  'advert', 'advertisement', 'ads', 'ad', 'banner', 'promo',
  'copyright', 'beian', 'footer-links', 'login', 'signin', 'subscribe',
  'search', 'searchbar', 'toolbar', 'topbar', 'subnav', 'pagination', 'pager',
  'sidebar-widget', 'widget', 'tags', 'tag-list', 'label', 'breadcrumb-nav',
  'editor-note', 'tips', 'notice-bar', 'popbox', 'float-bar', 'backtop', 'qrcode'
]

/* 明确是正文容器的 class —— 命中就直接用，不参与密度竞争 */
const CONTENT_CLASS = [
  'article', 'article-content', 'article-body', 'art_content', 'articleContent',
  'content', 'content-main', 'main-content', 'post-content', 'post-body',
  'entry-content', 'entry', 'news_txt', 'news-content', 'news_body',
  'text', 'detail', 'detail-content', 'con', 'cnt_bd', 'rich_media_content',
  'main-text', 'topic-content', 'blog-content', 'note-content'
]

/* 分行后要丢掉的噪音行（导航残留、版权、时间戳尾巴） */
const NOISE_LINE = [
  /^(下载|登录|注册|客户端|APP下载|扫一扫|二维码)/,
  /^(首页|下一页|上一页|返回|更多|展开|收起|评论|点赞|收藏|分享|举报)/,
  /^(首页要闻|最新|推荐|热门|排行|榜单|专题|视频|图集|直播)/,
  /(京ICP|沪ICP|粤ICP|苏ICP|浙ICP|渝ICP|皖ICP|鲁ICP|蜀ICP)/i,
  /©|Copyright|All Rights Reserved|版权所有|未经授权|侵权/,
  /(京公网安备|网站标识码|营业执照)/,
  /* 署名/元信息行。
     注意前缀：真站写的是「本页编辑」「责任编辑」「责编」「编辑:」，不是光秃秃的「编辑:」，
     第一版只匹配 `^(编辑|…)` 结果整行漏过去（单元测试抓到的）。 */
  /^.{0,6}(本页编辑|责任编辑|责编|编辑|校对|审核|来源|作者|原标题|发布时间|浏览量|阅读量|文章作者|新闻源)[:：]/,
  /(举报|投诉|纠错|反馈|客服|联系我们|关于我们|加入我们)/,
  /^(关注|订阅|投递|收藏本站|添加到收藏)/,
  /^(上一篇|下一篇|相关阅读|相关推荐|延伸阅读|热门推荐)[:：]/
]

/* 代码行：某些站点（网易、知乎、掘金、今日头条）把内联 JS 和正文放在同一个 div 里，
   stripChrome 删完 <script> 后剩下的还是有代码残留。
   实测踩过：预览网易新闻返回的是 `var hideOuterSearch="0",getReferFrom=function(){...`，
   用户看到一堆代码等于没抓到。 */
const CODE_LINE = [
  /^\s*(var|let|const|function|return|if\s*\(|for\s*\(|window\.|document\.|new\s+[A-Z])/,
  /\bfunction\s*\w*\s*\([^)]*\)\s*\{/,
  /\}\s*\)\s*\(?\s*;?\s*$/,
  /(^|\s)(var|function|prototype|===|!==|=>|;\s*$)/,
  /\b[a-zA-Z_$][\w$]*\s*[:=]\s*["'][^"']*["']\s*[;,]\s*$/,
  /^\s*[{}\[\]();,]\s*$/,
  new RegExp('^' + '\\s*/\\*|^' + '\\s*\\*/|^' + '\\s*//'),
  /\bJSON\.stringify|\.innerHTML|\.querySelector|addEventListener|getElementById/,
  new RegExp('^@|^\\.|^' + '\\s*//')
]

/**
 * 连续导航块检测
 *
 * 单行过滤器抓不住这种：
 *   「网易首页 应用 网易新闻 网易公开课 网易红彩 网易严选 邮箱大师 网易云课堂 快速导航」
 *   「指数 期指 个股 板块 新股 基金 港股 美股 期货 外汇 黄金 自选基金 资金流向 主力排名」
 * 这些行没有「首页：」这种前缀，字数也不算短，但整行/整块都是导航词。
 *
 * 判据：连续 >= NAV_RUN 行，每行都很短（< NAV_LEN 字）、没有句末标点、
 * 且行内汉字占比高（导航是词组，正文是句子）→ 整块丢掉。
 *
 * 为什么能区分：正文的句子有「。」、「，」、数字单位，长度也长；
 * 导航是一串两三个字的词，没有标点。
 */
const NAV_RUN = 4        // 连续几行像导航就丢
const NAV_WORD = 6       // 空格分出的每一段，短于这个字数才算词条
const NAV_MIN_WORDS = 3  // 至少几个词条才算「导航串」

/** 这一行像不像导航条目 */
export function looksLikeNavItem(s) {
  // 有句子标点 → 是正文，直接排除（这一条先判，省得后面的正则白跑）
  if (/[。！？；，,]/.test(s)) return false
  // 含成对括号 → 多半是正文里的补充说明
  if (/[（(][^）)]{2,}[）)]/.test(s)) return false
  // 带冒号的短行是「标题/体例说明」（附：、注：、来源：），不是导航词条。
  // 第一版没这条，把「附：本次调整涉及三个部门」判成导航了（单测抓到的）。
  if (/[：:]/.test(s)) return false

  // 情况一：导航串 —— 一行里堆了好几个短词条（东财「指数 期指 个股 板块 新股 基金」）
  const words = s.split(/\s+/).filter(Boolean)
  if (words.length >= NAV_MIN_WORDS) {
    const short = words.filter(w => w.length <= NAV_WORD).length
    if (short / words.length >= 0.8) return true
  }

  // 情况二：单行短词条（网易「网易公开课」独占一行）。
  // 只看单行会误杀正文短句，靠 dropNavRuns 的「连续 4 行」兜底：
  // 正文不会有连续 4 个都不带标点且短于 6 字的段落。
  if (words.length === 1 && s.length <= 6 && !/[。！？；，,：:、]$/.test(s)) return true

  return false
}

/** 丢掉连续导航块 */
export function dropNavRuns(lines) {
  const out = []
  let run = []
  const flush = () => {
    if (run.length >= NAV_RUN) { /* 整块丢 */ } else out.push(...run)
    run = []
  }
  for (const l of lines) {
    if (looksLikeNavItem(l)) run.push(l)
    else { flush(); out.push(l) }
  }
  flush()
  return out
}

/** 从一行文字判断是不是噪音 */
export function isNoiseLine(s) {
  if (NOISE_LINE.some(r => r.test(s))) return true
  if (CODE_LINE.some(r => r.test(s))) return true
  return looksLikeCode(s)
}

/**
 * 行级代码判定（治本的那条）
 *
 * 靠正则列代码特征永远列不全 —— 实测三个版本都漏：
 *   var hideOuterSearch=...   网易（能被 var 规则抓到）
 *   jQuery.ajaxSettings.cache = true   网易（漏）
 *   bdms: { aid: 2608, paths: [...]   掘金（漏）
 *   suds_init(3465,100.0000,1015,2);   新浪（漏）
 *
 * 换个思路：中文正文的行，汉字占比很高；代码的行几乎没有汉字。
 * 所以判据是「汉字占比低 + 含代码符号」，不靠枚举关键字。
 * 英文文章会误判 —— 所以只对含中文的行做这个判定，
 * 且汉字占比要低到 0.25 以下才算，正常中文行（哪怕有括号数字）都过。
 */
export function looksLikeCode(s) {
  if (!/[\u4e00-\u9fa5]/.test(s)) return CODE_SYM.test(s)   // 纯代码行
  const cjk = (s.match(/[\u4e00-\u9fa5]/g) || []).length
  if (cjk / s.length > 0.25) return false                    // 有足够汉字，是正文
  return CODE_SYM.test(s)
}

/* 代码符号特征：成对的括号花括号、连续分号赋值、箭头函数、访问器链 */
const CODE_SYM = /[{};]|\)\s*[;,]?\s*$|\([^)]*\)\s*\{|\w+\s*[:=]\s*["'`\[{]|\.[a-z]\w*\s*=|=>|;\s*\w+\s*=/

/**
 * 删掉页面框架。
 * @param {string} html
 * @returns {string}
 */
export function stripChrome(html) {
  let s = html
  // 0. script 先单独处理两轮：
  //    第一轮吃掉标准 <script>…</script>；
  //    第二轮吃掉没闭合的残留（网易、掘金这种把 JS 塞进 <div> 的，
  //    或者 <script src> 后面正文里还有裸代码的情况）。
  for (let i = 0; i < 2; i++) {
    s = s.replace(/<script\b[\s\S]*?<\/script\s*>/gi, ' ')
    s = s.replace(/<script\b[^>]*>[\s\S]*?(?=<(?:div|p|article|section|h[1-6])\b|<\/body)/gi, ' ')
  }
  // 1. 明确不要的标签：整块删（含内容）
  for (const tag of CHROME_TAGS) {
    s = s.replace(new RegExp(`<${tag}\\b[\\s\\S]*?</${tag}\\s*>`, 'gi'), ' ')
    s = s.replace(new RegExp(`<${tag}\\b[^>]*/?>`, 'gi'), ' ')
  }
  // 2. 带框架 class/id 的容器：整块删
  const clsAlt = CHROME_CLASS.join('|')
  // <div class="...nav..."> ... </div> —— div 不嵌套，所以非贪婪匹配到第一个 </div> 就行
  s = s.replace(
    new RegExp(`<(\\w+)[^>]*\\b(?:class|id)\\s*=\\s*["'][^"']*(?:\\b|-|_)(?:${clsAlt})(?:-|_|\\b)[^"']*["'][^>]*>[\\s\\S]*?</\\1>`, 'gi'),
    ' ')
  // 3. 剩下没闭合的单标签
  s = s.replace(/<\/(p|div|br|h[1-6]|li|tr|section|article)>/gi, '\n')
  return s
}

/** 把一段 HTML 变成纯文字行数组 */
function toLines(html) {
  const lines = html
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    /* 数字实体也要解：标题里满是 &#8211;（en dash）、&#8220;/&#8221;（中文引号）。
       只解具名实体的话，这些会原样出现在正文里，看着像乱码。 */
    .replace(/&#x([0-9a-f]+);/gi, (m, h) => { try { return String.fromCodePoint(parseInt(h, 16)) } catch { return '' } })
    .replace(/&#(\d+);/g, (m, d) => { try { return String.fromCodePoint(+d) } catch { return '' } })
    .replace(/&[a-z]+;/gi, '')
    .replace(/[ \t　]+/g, ' ')
    .split('\n')
    .map(s => s.trim())
    .filter(s => s.length > 1)
    .filter(s => !isNoiseLine(s))
  // 最后再丢连续导航块（单行过滤器抓不住「网易首页 应用 网易新闻 …」这种）
  return dropNavRuns(lines)
}

/**
 * 抽取正文。
 *
 * 策略（按可靠性从高到低）：
 *   A. 命中已知正文容器 → 直接取那个容器
 *   B. 否则按「文本密度」打分选块：
 *      一块 HTML 的价值 = 里面的文字里，中文占比高的行越多、越长、越少标签，越像正文。
 *      导航栏是「很多很短的行」，正文是「少量很长的行」。
 *   C. 全都不理想 → 返回空，调用方应明确告知「抓不到正文」而不是给一堆噪音。
 *
 * @param {string} html 原始 HTML
 * @param {string} [url] 用于判断是否搜索结果页
 * @returns {{ text: string, chars: number, strategy: string }}
 */
export function extractArticle(html, url = '') {
  const isSearchPage = /m\.baidu\.com|www\.baidu\.com|\/s\?wd=|bing\.com\/search|sogou\.com\/web/.test(url)

  /* 搜索结果页要短路返回，不能交给密度算法。
     实测踩过：百度热搜的链接是 m.baidu.com 搜索页，页面上确实有
     「上升热点 11小时前 新华社……」这类摘要文字，密度打分把它当正文选中了 ——
     用户看到 1323 字就以为读到了原文，其实那是搜索结果的摘要拼接。
     明确说「这是搜索页」比给一段似是而非的文字有用。 */
  if (isSearchPage) {
    const raw = (html.match(/<title[^>]*>([\s\S]{0,200}?)<\/title>/i) || [])[1] || ''
    const t = raw.replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').trim()
    return { text: '', chars: 0, strategy: 'search-page', title: t.slice(0, 120) }
  }

  // A. 已知正文容器
  const clsAlt = CONTENT_CLASS.join('|')
  const m = html.match(
    new RegExp(`<(\\w+)[^>]*\\b(?:class|id)\\s*=\\s*["'][^"']*\\b(?:${clsAlt})\\b[^"']*["'][^>]*>([\\s\\S]*?)<\\/\\1>`, 'i'))
  if (m) {
    const lines = toLines(stripChrome(m[2]))
    if (lines.join('').length > 200) {
      return { text: lines.join('\n'), chars: lines.join('').length, strategy: 'content-class' }
    }
  }

  // B. 密度打分：把页面切成 <div>/<p>/<section> 块，逐块评估
  const stripped = stripChrome(html)
  const blocks = stripped
    .split(/<\/(?:div|p|section|article|ul|td)>/i)
    .filter(b => b.length > 60)
  let best = null, bestScore = 0
  for (const b of blocks) {
    const lines = toLines(b)
    if (lines.length < 2) continue
    const lens = lines.map(l => l.length)
    const total = lens.reduce((a, x) => a + x, 0)
    const cjk = (b.match(/[\u4e00-\u9fa5]/g) || []).length
    // 汉字占文字的比例：导航里有大量英文/短词，正文几乎全是汉字
    const cjkRatio = total > 0 ? cjk / total : 0
    // 平均行长：正文长，导航短
    const avg = total / lines.length
    // 标签密度：标签越少越像已经剥干净的正文
    const tagRatio = b.length > 0 ? (b.match(/</g) || []).length / b.length : 1
    const score = (cjkRatio * 100) * Math.min(1, avg / 60) * (1 - Math.min(0.9, tagRatio * 4))
    if (score > bestScore) { bestScore = score; best = lines }
  }
  if (best && best.join('').length > 200) {
    return { text: best.join('\n'), chars: best.join('').length, strategy: 'density' }
  }

  // C. 兜底：全部行去噪后给出去掉导航行剩下的
  const all = toLines(html)
  const text = all.join('\n')
  return {
    text: text.length > 200 ? text : '',
    chars: text.length,
    strategy: 'fallback'
  }
}