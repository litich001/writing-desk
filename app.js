/* ============================================================
   写作台 · 前端逻辑
   排版交给 markdown-it（服务端），前端只负责交互与呈现
   ============================================================ */
(() => {
'use strict'

/* ---------- 状态 ---------- */
let S = { project:{}, body:'', images:[], materials:[], facts:[], versions:[], topics:[], queue:[], audit:null, themes:[] }
let connected = false
let bodyDirty = true
let shipOn = false
let shipCache = ''
let shipTimer = null
/* ── 渲染期状态 ──
   ★ 这些必须在任何 render 函数之前声明完。
   页面初始化时 go() 就会调 render，声明在后面的会撞暂时性死区，
   报「Cannot read properties of null」。本项目已栽四次
   （wvTimer / peekAbort / peekHtml / newTitlesPending）。 */
let titlePoolRaw = ""
let fixReqRaw = ""
let newTitlesPending = null



const $ = s => document.querySelector(s)
const $$ = s => [...document.querySelectorAll(s)]
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))
const deb = (f, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => f(...a), ms) } }
const now = () => new Date().toLocaleString('zh-CN', { hour12: false })

/* ---------- 通信 ---------- */
/* 并发闸门。
   浏览器对同一域名最多 6 个并发连接，连点十几个热点条目时
   fetch 会排队等待，await 一直不返回 ——
   表现就是「摘要区一直停在『正在抓取原文…』，什么都不出」。
   实测连点 5 条必挂，服务端单独测却 115ms 就返回。

   这里把并发压到 3，并在队头等一个空位，超时直接放行。 */
const NET_MAX = 3
let netActive = 0
const netWait = []

function netAcquire() {
  if (netActive < NET_MAX) { netActive++; return Promise.resolve() }
  return new Promise(res => netWait.push(res))
}
function netRelease() {
  netActive--
  const next = netWait.shift()
  if (next) { netActive++; next() }
}

async function api(p, d) {
  const o = d ? { method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify(d) } : {}
  await netAcquire()
  try {
    // 客户端自己也要有超时：不能无限等
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), 20000)
    let r
    try {
      r = await fetch('/api' + p, Object.assign({}, o, { signal: ctrl.signal }))
    } finally {
      clearTimeout(timer)
    }
    if (!r.ok) { const t = await r.text().catch(() => ''); throw new Error('HTTP ' + r.status + ' ' + t.slice(0, 80)) }
    return await r.json()
  } finally {
    netRelease()
  }
}
function conn(on) {
  connected = on
  const d = $('#dot')
  if (d) { d.className = 'dot' + (on ? ' on' : ''); d.nextSibling.textContent = on ? '本地服务已连接' : '未连接' }
}

/* ---------- 启动 ---------- */
/* 四步。热点和定题拆成两页 —— 翻榜和定稿是两件不同的事，
   混在一页里，定题框总被热点列表挤到下面去。
   1 找选题（翻热点）→ 2 定题 → 3 成稿（图/标题/核对）→ 4 排版发布 */
const PAGES = [
  { id:'hot',   n:'1', label:'热', full:'热点', desc:'翻实时榜单找选题' },
  { id:'idea',  n:'2', label:'题', full:'定题', desc:'定下这次写什么' },
  { id:'write', n:'3', label:'稿', full:'成稿', desc:'改稿、配图、核对' },
  { id:'ship',  n:'4', label:'发', full:'发布', desc:'换主题，复制成稿' }
]

function shell() {
  $('#app').innerHTML = `
  <nav class="side" aria-label="主导航">
    <div class="brand"><h1>写作台</h1><p>你出题，我成稿</p></div>
    <div class="nav-group">
      <div class="nav-label">流程</div>
      ${PAGES.map(p => `<button class="nav" data-go="${p.id}" title="${p.full} · ${p.desc}">` +
        `<span class="st-row"><span class="st">${p.n}</span>` +
        `<span class="tx">${p.full}</span></span>` +
        `<span class="ds">${p.desc}</span>` +
        `<span class="badge hide"></span></button>`).join('')}
    </div>
    <div class="side-foot">
      <div class="conn"><span class="dot" id="dot"></span><span>连接中</span></div>
    </div>
  </nav>
  <main class="main" aria-label="主工作区">
    <section class="page on" id="p-hot" role="region" aria-label="热点榜"></section>
    <section class="page" id="p-idea" role="region" aria-label="选题"></section>
    <section class="page" id="p-write" role="region" aria-label="成稿"></section>
    <section class="page" id="p-ship" role="region" aria-label="排版发布"></section>
  </main>
  <button class="totop" id="totop" title="回到顶部" aria-label="回到顶部">↑</button>
  <div id="toast"></div>`

  $('#app').addEventListener('click', e => {
    const b = e.target.closest('[data-go]')
    if (b) go(b.dataset.go)
    const a = e.target.closest('[data-act]')
    if (a) act(a.dataset.act, a.dataset.arg, a.dataset.val, a)
  })
  $('#totop').onclick = () => window.scrollTo({ top: 0, behavior: 'smooth' })

  // 长页面：滚动超过一屏才显示回顶。
  window.addEventListener('scroll', () => {
    $('#totop').classList.toggle('on', window.scrollY > window.innerHeight * 0.8)
  }, { passive: true })

  bind()
  poll()
}

const IC = { hot:'◎', idea:'✎', write:'¶', ship:'↗' }

function go(id) {
  curPage = id
  $$('.page').forEach(s => s.classList.toggle('on', s.id === 'p-' + id))
  // 成稿和发布两页内容宽，去掉 .page 的左右 padding，正文吃满
  $$('.page').forEach(s => s.classList.toggle('wide-page', s.id === 'p-write' || s.id === 'p-ship'))
  $$('.nav').forEach(b => b.classList.toggle('on', b.dataset.go === id))
  window.scrollTo({ top: 0, behavior: 'instant' })
  if (id === 'ship') { shipOn = true } else shipOn = false
  if (RENDER[id]) { try { RENDER[id]() } catch (e) { console.error(e) } }
  /* 切页后统一补一次无障碍标注。
     出口统一处理比在每个按钮手写可靠 —— 以后新增按钮自动有标签。 */
  const pg = $('#p-' + id)
  if (pg) a11y(pg)
}

function act(name, arg, el) {
  const A = Actions[name]
  if (A) A(arg, el)
}

/* ---------- 数据同步 ---------- */
let lastStamp = ''

/* 用户是不是正在某个输入框里打字？
   旧实现只认 #body 和 #etitle 两个 id，结果定题页、摘要、角度、选题输入…
   全部每 4 秒被重渲染冲掉一次。这里改成通用判断：只要焦点在可编辑元素上就算。 */
function isTyping() {
  const a = document.activeElement
  if (!a) return false
  if (a.isContentEditable) return true
  const tag = a.tagName
  if (tag === 'TEXTAREA' || tag === 'SELECT') return true
  if (tag !== 'INPUT') return false
  return !['checkbox', 'radio', 'button', 'submit', 'reset', 'range', 'color', 'file'].includes(a.type)
}

/* 记下焦点和光标位置，重渲染后原样放回去 —— 双保险 */
function snapFocus() {
  const a = document.activeElement
  if (!a || !a.id) return null
  const s = { id: a.id, start: null, end: null }
  try { s.start = a.selectionStart; s.end = a.selectionEnd } catch (e) {}
  return s
}
function restoreFocus(s) {
  if (!s) return
  const el = document.getElementById(s.id)
  if (!el) return
  el.focus()
  if (s.start != null) { try { el.setSelectionRange(s.start, s.end) } catch (e) {} }
}

async function poll(silent) {
  try {
    const s = await api('/state')
    const bodyChanged = s.body !== S.body
    const changed = s.stamp !== lastStamp

    /* 有未落盘的改动时，不能用服务端数据覆盖。
       save() 有 900ms 防抖：用户在这 900ms 内改的标题、角度、
       「设为默认」的选项，都还只在前端内存里。
       直接 S = s 会把它们冲回旧值 ——
       实测「设为默认」点完读出来是空的，按钮永远不亮。

       但也不能无脑合并保留前端值：用户正在编辑器里写一半的时候，
       服务端可能刚被 AI 写了新正文，无脑保留会把新正文挡掉。
       所以只在「确实有脏数据」时保护，且只保护本次防抖窗口内改的键。 */
    if (dirtyKeys.size) {
      const merged = Object.assign({}, s)
      for (const k of dirtyKeys) {
        if (k === 'body') merged.body = S.body
        else if (S[k] != null && typeof S[k] === 'object') merged[k] = Object.assign({}, s[k], S[k])
        else merged[k] = S[k]
      }
      S = merged
      dirtyKeys.clear()
    } else {
      S = s
    }
    /* AI 交稿时会把候选标题写进 data/titles.json。
       这里比一下指纹：变了就自动收进候选区，用户不用再粘一次。
       用户原话「不要需要让人再操作第二步了」——
       以前得他自己把 AI 贴在对话里的标题复制回来，再粘进框里。 */
    ingestTitles(s.titles)
    /* 新稿子自动带上「设为默认」的那几项 */
    applyPrefs()
    conn(true)
    if (changed || silent === false) refresh(bodyChanged)
  } catch (e) {
    conn(false)
    if (silent === false) toast('连不上本地服务，请双击「启动.bat」', 'err')
  }
}
setInterval(() => { if (!isTyping()) poll(true) }, 4000)

const RENDER = {}
let curPage = 'hot'

/* 重绘前记下滚动位置，重绘后放回去。

   原来只有 snapFocus() 存焦点 —— 焦点和滚动是两回事，
   只存焦点等于没存阅读位置：AI 一交稿，正在读第八节的人被弹回开头。

   ★ 滚动容器是 <main>，不是 window。
     实测 window.scrollHeight 和 innerHeight 相等（596/596），
     body 的 overflow 是 hidden —— 整个应用是固定视口，
     滚动全靠 <main> 自己的 scrollTop。
     存 window.scrollY 会永远是 0，
     还原时比 0 和 0 相等，看起来「保住了」，其实是假阳性。
     ★ 假阳性比没修更坏：验收说过了，用户还在被弹回顶部。 */
function snapScroll() {
  const m = { els: [], win: window.scrollY || document.documentElement.scrollTop || 0 }
  const main = document.querySelector('main')
  if (main) m.els.push([main, main.scrollTop])
  /* 发布页三栏各自能滚，也要一起存 */
  document.querySelectorAll('.ship-col, .side-pane, .hot-list').forEach(e => {
    m.els.push([e, e.scrollTop])
  })
  return m
}

function restoreScroll(m) {
  if (!m) return
  /* 重绘会重建容器里的一切，旧节点可能已经不在文档里了。
     按 class 找回新节点，找不到就不还原那一个 ——
     宁可漏一个容器，也不要把用户拽回一个不该去的位置。 */
  m.els.forEach(([old, top]) => {
    if (!old || !top) return
    const key = old.className || old.tagName
    const el = key === 'main'
      ? document.querySelector('main')
      : document.querySelector('.' + String(key).trim().split(/\s+/).join('.'))
    if (el && el.isConnected) el.scrollTop = top
  })
  window.scrollTo({ top: m.win, behavior: 'instant' })
}

function refresh(bodyChanged) {
  lastStamp = S.stamp
  syncNav()
  const snap = snapFocus()
  const sc = snapScroll()
  for (const id of Object.keys(RENDER)) {
    // 正在这一页输入 → 绝不动它。数据更新会在失焦后的下一轮 poll 补上。
    if (id === curPage && isTyping()) continue
    // 发布页是只读视图，进去时才渲染。后台重渲染会让预览闪一下「正在生成…」，
    // 而且每次重渲染都会作废预览缓存 —— 白白重跑一次排版。
    if (id === 'ship') continue
    try { RENDER[id]() } catch (e) { console.error('render ' + id, e) }
    /* 重绘后重新补 aria —— poll 会反复重画，必须每次都过 */
    const pg = $('#p-' + id)
    if (pg) a11y(pg)
  }
  if (bodyChanged) {
    bodyDirty = true
    const b = $('#body')
    if (b && document.activeElement !== b) b.value = S.body
  }
  if (bodyDirty) { bodyDirty = false; runAudit() }
  restoreFocus(snap)
  /* 重绘会重建 DOM，滚动位置必须还原，否则被弹回顶部 */
  restoreScroll(sc)
}

function syncNav() {
  const out = [];
  const refs = new Set(bodyImages())
  // 热点：还没定题就提醒去定题
  out.push(['hot', S.project.topic ? 0 : '•'])
  // 定题：有排队中的任务才提示
  out.push(['idea', (S.queue || []).length])
  // 成稿：图没插完 或 有待核事实，都算有活儿（核对已并入此页）
  const todoImg = (S.images || []).filter(x => !refs.has(x.file)).length
  const todoFact = (S.facts || []).some(f => f.verdict === 'wait')
  out.push(['write', (todoImg || todoFact) ? '•' : 0])

  for (const [id, n] of out) {
    const el = $(`.nav[data-go="${id}"] .badge`)
    if (!el) continue
    el.textContent = n
    el.classList.toggle('hide', !n)
    if (n === '•') el.setAttribute('data-dot', '1'); else el.removeAttribute('data-dot')
  }
}

/* ---------- 保存 ---------- */
/* 哪些表有「改了但还没落盘」。
   save() 有 900ms 防抖，这段时间里前端内存里的值比磁盘上的新。
   poll() 每 4 秒从服务端拉一次整个 state 并覆盖 S，
   于是防抖窗口内改的东西会被旧值冲掉。
   实测踩过：点「设为默认」按钮，900ms 内还没落盘就被冲掉，
   prefs 读出来是空的，按钮永远不亮。

   这里记住脏的键名，poll 只保护这些键，其余照常从服务端取 ——
   不能无脑保留前端值，否则 AI 刚写好的新正文会被编辑器里的半成品挡掉。 */
const dirtyKeys = new Set()

/** 标脏。改了任何一个表都要调，否则会被 poll 冲掉。 */
function markDirty(k) {
  dirtyKeys.add(k)
}

const save = deb(async () => {
  try {
    await Promise.all([
      api('/save', { name:'body', data: $('#body').value }),
      api('/save', { name:'project', data: S.project }),
      api('/save', { name:'facts', data: S.facts }),
      api('/save', { name:'materials', data: S.materials })
    ])
    dirtyKeys.clear()
  } catch (e) { /* 静默，避免打断编辑 */ }
}, 900)

/* ---------- 操作 ---------- */
/* 提交锁：点一次就锁住，直到请求回来。
   用户反馈「点 10 次就添加了 10 个任务」—— 根因是没有锁、没有去重。
   这里做前端第一道防线（防连点），服务端 /api/task 还有幂等兜底（防多标签页）。 */
let submitting = false

const Actions = {
  async submit() {
    // 1. 连点拦截：无论有没有题，每次都回一句话，不让用户干等
    if (submitting) { toast('正在提交，上一条还没发出去', 'warn'); return }
    const topicEl = $('#topic')
    const topic = topicEl ? topicEl.value.trim() : ''
    if (!topic) { toast('先写一句想写什么', 'warn'); if (topicEl) topicEl.focus(); return }

    submitting = true
    const btn = $('[data-act="submit"]')
    const oldTxt = btn ? btn.textContent : ''
    if (btn) { btn.disabled = true; btn.textContent = '提交中…' }

    const len = $('#len').value, style = $('#style').value, req = $('#req').value.trim()
    const imgN = S.project.imgN || 10
    const styleCn = STYLE_CN[style] || '你判断'
    const full = [
      `【任务】写一篇公众号文章，主题：${topic}`,
      `【字数】约 ${len} 字`,
      `【文风】${style === 'auto' ? '你根据题材自己判断，并在文末说明你选了什么、为什么' : styleCn}`,
      `【读者】中老年人群。要特别感性、有温度，从人性角度剖析，有深度，不预设立场。`,
      '',
      /* ── 以下几条是用户 2026-10-02 逐条点名的，删任何一条都会退回老毛病 ── */
      `【不许提前否定】不要写「先说结论」「免得有人只看标题」「以免有人误解」这类句子。` +
      `没有人会这样写 —— 预先否掉一个没人提出的质疑，是 AI 最典型的预设。整篇不许出现。`,
      `【不许升华收尾】不要「未来可期」「值得深思」「愿每一个人」。收在具体事实上。`,
      `【不许说教】不要「我们应该」「这个故事告诉我们」。有温度不等于要说教。`,
      `【标点】双引号、冒号、破折号都尽量去掉。引号里装抽象词（「体现了」「象征着」）` +
      `是最重的 AI 味，改成直接说。冒号后面多半是一句解释，改成句号断句。破折号改成句号。`,
      `【不许提前下结论】不要在开头替读者把话说完。你是资深记者，不是解说员。`,
      '',
      `【排版】用 markdown-it 渲染，不要自己手写 HTML`,
      `【配图】必须配图，共 ${imgN} 张。写完把图片按 ![说明](文件名) 插进正文合适位置，把图片文件放进 data/images/，在 data/images.json 登记 file/cap/src/risk。`,
      `【强调】正文里该加粗的地方用 ** ** 标出（人名、关键数字、核心判断），不要通篇纯文本。` +
      `但相邻两段别都加粗，隔开一段再强调。`,
      `【正文】直接写正文，不要加「本文参考」「据某某报道」这类来源说明前缀。事实和观点自然融进去。`,
      `【事实】所有数字、时间、人名、引用必须来自公开信息并核实，不确定的宁可不写。写完把文中所有可验证的断言列进 data/facts.json，verdict 先填 wait。`,
      `【数据】写进 data/body.md，并把 project.json 的 title 一起更新。`,
      '',
      `【标题】写完正文，再给 6 个不同方向的完整标题（12~24 字，一行一个，不要用双引号包起来），` +
      `第一个放最能打的。每个后面用括号标一句「为什么是这个角度」。`,
      '',
      req ? `【额外要求】${req}` : `【额外要求】没有额外要求，你自己判断。`
    ].join('\n')

    try {
      S.project.title = S.project.title || topic
      S.project.len = len; S.project.style = style; S.project.imgN = imgN
      markDirty('project')
      await save.flush?.()
      await api('/save', { name:'project', data: S.project })
      const r = await api('/task', { type:'write', requirement: full, ref: topic })

      // 2. 去重命中：明确告诉用户「已经有了」，不装作成功
      if (r && r.duplicate) {
        toast('队列里已经有这个题了，不用重复提交', 'warn')
        if (btn) { btn.disabled = false; btn.textContent = oldTxt }
        submitting = false
        await poll(false)
        return
      }
    } catch (e) {
      toast('提交失败：' + e.message, 'err')
      if (btn) { btn.disabled = false; btn.textContent = oldTxt }
      submitting = false
      return
    }

    const phrase = `写作台　${topic}　${len}字　${style === 'auto' ? '文风你定' : styleCn}`
    let ok = false
    try { await navigator.clipboard.writeText(phrase); ok = true } catch (e) {}
    showSubmit(phrase, ok)
    toast(ok ? '已提交，话术也复制好了' : '已提交（话术没复制成功，手动复制）', 'ok')
    if (btn) { btn.disabled = false; btn.textContent = oldTxt }
    submitting = false
    await poll(false)
  },

  async fix() {
    const f = fixReqRaw.trim()
    if (!f) { toast('先说要改什么', 'warn'); const el = $('#as-fixreq'); if (el) el.focus(); return }
    // 改稿是迭代的：同一个标题下可以连着提多条不同的改稿要求，不去重
    try { await save.flush?.(); await api('/task', { type:'rewrite', requirement: `${f}\n\n【原文】见 data/body.md，保留所有 ![图注](文件名) 图片引用。`, ref: S.project.title, force: true }) }
    catch (e) { toast('提交失败：' + e.message, 'err'); return }
    Actions.keepFixReq('')
    toast('已提交。回对话里跟我说一声')
    await poll(false)
  },

  async stash() {
    try { await api('/commit', { label: S.project.title || '手动存稿', text: $('#body').value }); toast('已存一版'); await poll(false) }
    catch (e) { toast('存稿失败：' + e.message, 'err') }
  },

  /* 配图数量：写稿任务会带上这个数，AI 按数配好 */
  imgN(n) {
    S.project.imgN = Number(n) || 10
    markDirty('project'); save()
    $$('[data-act="imgN"]').forEach(b => b.classList.toggle('on', Number(b.dataset.arg) === S.project.imgN))
    toast('这次配 ' + S.project.imgN + ' 张图', 'ok')
  },

  /* 从定题页打开历史稿 */
  openVer(id) {
    if (!id) return
    go('write')
    setTimeout(() => Actions.restore(id), 300)
  },

  async restore(id) {
    const v = (S.versions || []).find(x => x.id === id)
    if (!v) return
    if (!confirm(`载入「${v.label}」？当前正文会被覆盖。`)) return
    try {
      const r = await api('/version/read', { id })
      $('#body').value = r.text; S.body = r.text; bodyDirty = true; markDirty('body')
      await api('/commit', { label: '载入 ' + v.label, text: r.text })
      await poll(false); toast('已载入')
    } catch (e) { toast('载入失败：' + e.message, 'err') }
  },

  async cancelTask(id) {
    try { await api('/task/del', { id }); await poll(false) } catch (e) { toast(e.message, 'err') }
  },

  async addTopic() {
    const el = $('#topic-in'); const v = el.value.trim()
    if (!v) return
    S.topics.push({ id: Date.now().toString(36), title: v, angle:'', at: now() })
    el.value = ''
    try { await api('/save', { name:'topics', data: S.topics }); toast('已添加'); await poll(false) } catch (e) { toast(e.message, 'err') }
  },

  /* 选中一条选题 = 带去定题页。
     热点和定题已经拆成两页，所以选中后直接跳到下一环节。
     只写 S.project.topic，绝不碰标题 —— 这条踩过两次。 */
  async useTopic(id) {
    const t = (S.topics || []).find(x => x.id === id)
    if (!t) return
    S.project.topic = t.title
    if (t.angle) S.project.req = t.angle
    markDirty('project')
    try {
      await api('/save', { name: 'project', data: S.project })
      go('idea')
      toast('题已带过去，可以直接开写', 'ok')
    } catch (e) { toast(e.message, 'err') }
  },

  async delTopic(id) {
    S.topics = (S.topics || []).filter(x => x.id !== id)
    try { await api('/save', { name:'topics', data: S.topics }); await poll(false) } catch (e) { toast(e.message, 'err') }
  },

  /* 这两个也必须用 Actions.xxx 调，不能用 this.xxx ——
     理由同 hotPick：act() 里是裸调用，this 是 undefined。 */
  taskTitle() {
    if (!String(S.body || '').trim()) return toast('正文是空的，先把稿子写完', 'warn')
    Actions.genTask('title', 'task-title')
  },

  /* 点右侧「我自己有标题」：把焦点送到交付区里的标题粘贴框。
     右侧是主入口，交付区那一份是备用。 */
  /* AI 交了新一批标题，但用户自己粘过一批挡住了。
     存起来给一个「换用 AI 这批」的按钮 ——
     不能悄悄丢掉（用户不知道错过了），也不该硬抢（那是用户的东西）。 */
  takeNewTitles() {
    if (!newTitlesPending || !newTitlesPending.length) return
    titlePool = parseTitlePool(newTitlesPending.join('\n'))
    titlePoolRaw = newTitlesPending.join('\n')
    newTitlesPending = null
    renderWrite()
    toast('已换成 AI 交的这批标题', 'ok')
  },
  focusTitleIn() {
    const el = $('#title-in')
    if (!el) {
      const acc = $('#deliver-acc')
      if (acc) acc.open = true
      toast('已展开交付区，点上面的框粘贴标题', 'warn')
      return
    }
    el.scrollIntoView({ block:'center', behavior:'smooth' })
    el.focus()
  },


  taskAbs() {
    if (!String(S.body || '').trim()) return toast('正文是空的，先把稿子写完', 'warn')
    Actions.genTask('abs', 'task-abs')
  },

  /* 让服务端生成要求文本：它要读正文+事实清单+风格，
     放在服务端可以单独测，前端保持轻。 */
  async genTask(kind, boxId) {
    const btn = $(`[data-act="task${kind === 'abs' ? 'Abs' : 'Title'}"]`)
    const old = btn ? btn.textContent : ''
    if (btn) { btn.disabled = true; btn.textContent = '生成中…' }
    try {
      const r = await api('/task-word', {
        kind,
        body: S.body,
        facts: S.facts || [],
        style: (S.project && S.project.style) || ''
      })
      const d = r.data || r
      if (!d.text) throw new Error(d.error || '没生成出来')
      navigator.clipboard.writeText(d.text)
        .then(() => {
          const box = $('#' + boxId)
          if (box) { box.style.display = 'block'; box.innerHTML = '<pre>' + esc(d.text) + '</pre>' }
          toast('要求已复制 —— 回到 AI 对话工具，粘贴发送')
        })
        .catch(() => {
          const box = $('#' + boxId)
          if (box) { box.style.display = 'block'; box.innerHTML = '<pre>' + esc(d.text) + '</pre>' }
          toast('浏览器不让自动复制。下面的内容已显示，手动全选按 Ctrl+C', 'warn')
        })
    } catch (e) {
      toast(e.message || '生成失败', 'err')
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = old }
    }
  },

  /* ---------- 发布到公众号 ---------- */
  /* 一键改写：把「改写要求 + 原文」拼起来复制出去。
     用户原话「实在不行你加一个什么一键改写，那以防这个人不满意，
     他自己再改写，然后可以把那个粘贴建议粘回对话窗口重新改写就行了」。
     所以这里不提交队列、不生成任务，只复制一段能直接粘的话。 */
  async fix() {
    const req = (fixReqRaw || '').trim()
    const body = String(S.body || '')
    if (!body.trim()) return toast('正文是空的', 'warn')
    const ask = [
      req ? '按下面的要求改写这篇文章。' : '把这篇文章改写得更好。',
      '',
      ...(req ? ['改写要求：', ...req.split('\n').map(l => '  ' + l)] : []),
      '',
      '硬要求：',
      '1. 只改写，不要删掉正文里的事实、数字、人物，也不要新增没依据的事实',
      '2. 改完直接给我改好的全文，不要说改了什么',
      '3. 不要写「改写说明」「调整了以下几处」这类说明文字',
      '4. 保持 markdown 的 **加粗** 和 ![图](文件名) 原样',
      '',
      '─────── 原文（' + body.replace(/\s/g, '').length + ' 字）───────',
      body.trim()
    ].join('\n')
    navigator.clipboard?.writeText(ask)
      .then(() => toast('改写要求已复制 —— 回到 AI 对话工具，粘贴发送'))
      .catch(() => toast('浏览器不让自动复制。手动选中按 Ctrl+C', 'warn'))
  },

  /* 点一个标题候选就换上去 —— 用户要的是「直接一键替换了就好」，
     不用再手动去标题栏里改一遍。 */
  /* 用户自己粘过一批标题时，AI 新交的那批不覆盖、而是存在这里，
     给一个「换用 AI 这批」的按钮 —— 不能悄悄丢掉，也不该硬抢。 */

  useTitle(i) {
    const t = titlePool[Number(i)]
    if (!t) return
    S.project.title = t
    markDirty('project')
    const box = $('#etitle')
    if (box) box.value = t
    api('/save', { name: 'project', data: S.project }).catch(() => {})
    renderWrite()
    toast('标题已换成「' + t + '」', 'ok')
  },

  /* 保存标题候选区 / 改写要求区的输入内容。
     必须存在模块级变量里 —— renderWrite 每次重绘都会重建 DOM，
     存在 DOM 上的 value 会被抹掉，用户打的字就没了。 */
  keepTitlePool(v) {
    titlePoolRaw = String(v || '')
    titlePool = parseTitlePool(titlePoolRaw)
    /* 粘完就出按钮，不要让用户再点一下什么。
       重绘会换掉 textarea，所以重绘前把焦点和光标位置记住再还原，
       否则粘一大段之后光标跳到开头，继续打会插错地方。 */
    deb(() => {
      const el = $('#title-in')
      const active = document.activeElement === el
      const pos = active && el ? el.selectionStart : 0
      renderWrite()
      const el2 = $('#title-in')
      if (active && el2) { el2.focus(); try { el2.setSelectionRange(pos, pos) } catch {} }
    }, 500)()
  },
  keepFixReq(v) { fixReqRaw = String(v || '') },
  copyShip() { copyShip() },
  packImages() { packImages() },
  copyTitle() {
    const t = (S.project.title || $('#etitle')?.value || document.title).trim()
    if (!t) return toast('还没有标题', 'warn')
    navigator.clipboard?.writeText(t).then(() => toast('标题已复制 —— 回到 AI 对话工具，粘贴发送', 'ok')).catch(() => toast('复制失败，浏览器不让复制。手动选中按 Ctrl+C', 'err'))
  },
  copyAbs() {
    const a = (S.project.abstract || $('#abs')?.value || '').trim()
    if (!a) return toast('还没有摘要', 'warn')
    navigator.clipboard?.writeText(a).then(() => toast('摘要已复制 —— 回到 AI 对话工具，粘贴发送', 'ok')).catch(() => toast('复制失败，浏览器不让复制。手动选中按 Ctrl+C', 'err'))
  },

  /* ---------- 版本对比 ---------- */
  diffVer(id) { showVersionDiff(id) },
  closeDiff() { const b = $('#ver-cmp'); if (b) b.innerHTML = '' },

  /* ---------- 事实清单：风险分级 + 批量 ---------- */
  async bulkMark(ids) {
    const list = String(ids || '').split(',').filter(Boolean)
    if (!list.length) return
    if (!confirm(`把 ${list.length} 条标记为「已确认」？\n\n如果里面有错的，改完再点一次状态按钮即可回退。`)) return
    const set = new Set(list)
    S.facts = (S.facts || []).map(f => set.has(f.id) ? { ...f, verdict: 'ok' } : f)
    markDirty('facts')
    try { await api('/save', { name: 'facts', data: S.facts }); await poll(false); toast(`已确认 ${list.length} 条`, 'ok') }
    catch (e) { toast(e.message, 'err') }
  },

  /* ---------- 配图：推荐插入位置 ---------- */
  suggestImg() {
    const box = $('#img-plan')
    if (!box) return
    box.style.display = 'block'
    suggestImages()
    box.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
  },
  applyImgPlan() { applyImagePlan() },

  applyOne(k) { applyOne(k) },
  closePlan() { const b = $('#img-plan'); if (b) b.innerHTML = '' },

  /* ---------- 发布页 ---------- */
  shipWidth(w) { shipWidth = Number(w) || 375; renderShip() },

  /* 排版微调：改的是 CSS 变量，跟着本篇走。
     act() 会传 (arg, val, el)，el 是点到的按钮，用来更新选中态。 */
  tune(arg, val, el) {
    if (!S.project.tune) S.project.tune = {}
    S.project.tune[arg] = arg === 'fs' || arg === 'lh' ? Number(val) : val
    markDirty('project'); save()
    applyTune()
    if (el && el.classList) {
      const row = el.closest('.tune-row')
      if (row) {
        $$('.tune-b, .tune-c', row).forEach(b => b.classList.remove('on'))
        el.classList.add('on')
        const out = row.querySelector('.tune-val')
        if (out && arg === 'fs') out.textContent = val + 'px'
        if (out && arg === 'lh') out.textContent = String(val)
      }
    }
  },
  tuneReset() {
    S.project.tune = {}
    markDirty('project'); save()
    applyTune()
    renderShip()
    toast('已恢复主题默认排版', 'ok')
  },

  /* ---------- 成稿页 ---------- */
  toggleLib() { libOpen = !libOpen; renderWrite() },

  /* 点正文里的第 N 张图：打开图库并高亮它，方便换图。
     不用另开预览窗 —— 用户要的就是在原地改。 */
  imgWhere(i) {
    libOpen = true
    renderWrite()
    setTimeout(() => {
      const items = $$('.lib-item')
      const f = bodyImages()[Number(i)]
      const el = items.find(x => x.dataset.file === f)
      if (el) { el.scrollIntoView({ block: 'center', behavior: 'smooth' }); el.classList.add('flash') }
    }, 60)
  },
  /* 这里原来还有一个旧的 useTitle(t)，它把 data-arg 的下标当标题直接写进标题栏
     —— 对象字面量里后写的会覆盖先写的，所以点候选按钮的结果是标题变成「1」。
     Actions 里同名函数重复定义是个静默的坑：node --check 不报错，
     功能表现为「点了没反应 / 反应错了」，很难联想到是重名。
     正确的那份在 475 行附近，接受下标、查 titlePool、整页重绘。 */

  /* ---------- 选题（热点 + 我的） ---------- */
  ideaTab(t) { ideaTab = t; paintIdeaPane(); },

  /* ---------- 热点 ---------- */
  async reloadHot() { hotLoading = true; paintHot(); await loadHot(true); toast('榜单已刷新', 'ok') },
  hotSrc(id) { hotSrc = id; hotSel = null; peekHtml = {}; paintHot() },
  /* 注意：data-arg 传进来一定是字符串。
     这里必须转成数字 —— 否则 curHotList()["0"] 取不到条目，摘要抓不到，界面上就是一个空框。 */
  hotPick(i) {
    i = Number(i)
    // 换条目就收起预览（否则上一条的正文还挂着，看着像这条的）
    if (hotSel !== i) { hotSelAngle = '' }
    hotSel = i
    $$('.hot-item').forEach((el, k) => el.classList.toggle('sel', k === i))
    paintHotDetail(curHotList())

    // 已经渲染过就别再发一次请求。
    // 用户来回点条目是常事，每次都重抓既慢又把连接占满。
    if (peekHtml[i] != null) return

    // 选中就自动抓摘要 —— 用户要的是「点一下就知道讲了什么」，
    // 让他再点一次「看看原文讲了什么」是多一步，而且他不知道要点。
    //
    // 必须用 Actions.hotPeek(...) 不能用 this.hotPeek(...)：
    // act() 里是 `A(arg, el)` 裸调用，严格模式下 this 是 undefined。
    // catch 里要把错误显示出来，不能空吞 ——
    // 空吞的表现和没调用一模一样：摘要区永远停在「正在抓取原文…」，
    // 完全看不出哪里坏了（第一版就是这么写的，排查了很久）。
    Actions.hotPeek(i).catch(e => {
      console.error('hotPeek 失败', e)
      fillPeek(i, '<div class="peek-err">读取失败：' + esc(e.message || '未知错误') + '</div>')
    })
  },
  async hotSave() {
    const it = curHotList()[hotSel]
    if (!it) return
    S.topics = S.topics || []
    if (S.topics.some(t => t.title === it.title)) return toast('选题库里已经有了', 'warn')
    S.topics.push({ id: Date.now().toString(36), title: it.title, angle: hotSelAngle, from: it.from || [], url: it.url || '', at: now() })
    try { await api('/save', { name: 'topics', data: S.topics }); toast('已存进选题库', 'ok') } catch (e) { toast(e.message, 'err') }
  },
  /* 选中热点 = 带去定题页。只写 topic，不碰标题。 */
  async hotUse() {
    const it = curHotList()[hotSel]
    if (!it) return
    S.project.topic = it.title
    if (hotSelAngle) S.project.req = hotSelAngle
    markDirty('project')
    try {
      await api('/save', { name: 'project', data: S.project })
      go('idea')
      toast('题已带过去，可以直接开写', 'ok')
    } catch (e) { toast(e.message, 'err') }
  },

  /* 素材库的 addMat / insertMat / delMat 已按用户要求删掉 ——
   原话「你那个什么素材啊……都不需要有那些玩意」。
   事实核查（mark / scanFacts / bulkMark）保留：那个不是"检查面板"，
   是防止文章编造数字的底线，见 renderDeliverPane 里的自检区。 */

  /* 热点原文摘要：由服务端代抓（浏览器直连会被跨域挡），只取文字不执行脚本。
     抓到的内容缓存在 peekCache —— 否则每次重绘都要重新打源站。

     force=true 的用途：切换/刷新。
     不传 force 时如果已经抓过就直接渲染缓存，不重复打源站。 */
  /* 「重新抓取」按钮走这个：强制绕开 peekHtml 和 peekCache 重来一遍。
     单独一个动作而不是给 hotPeek 加参数，是因为 data-act 只会传一个字符串 arg，
     塞不进 force —— 之前那个按钮其实一直在走缓存，点「重新抓取」毫无反应。 */
  hotPeekF(i) {
    const idx = Number(i)
    delete peekHtml[idx]
    delete peekCache[curHotList()[idx]?.url]
    Actions.hotPeek(idx, true).catch(e => {
      console.error('hotPeek 失败', e)
      fillPeek(idx, '<div class="peek-err">读取失败：' + esc(e.message || '未知错误') + '</div>')
    })
  },

  async hotPeek(i, force) {
    const idx = Number(i)
    const srcs = HOT ? HOT.sources : []
    const list = hotSrc === 'all' ? hotBag(srcs) : (srcs.find(s => s.id === hotSrc)?.items || [])
    const it = list[idx]
    if (!it) return
    if (!it.url) { fillPeek(idx, '<div class="peek-none">这条只有标题，没有原文链接。</div>'); return }

    const ck = peekCache[it.url]
    if (ck && !force) { fillPeek(idx, renderPeek(ck, it)); return }

    /* 只往界面上写加载态，不要记进 peekHtml。
       记进去就等于宣称「这条已经渲染好了」，
       hotPick 之后会直接 return 不再发请求 —— 于是这一条永远停在
       「正在抓取原文…」，点多少次都没用。
       实测连点 10 条之后回点第 5 条，卡了 13 秒不动，就是这么来的。 */
    fillBox(idx, '<div class="peek-load">正在抓取原文…</div>')

    /* 连点时取消上一条。
       浏览器同域最多 6 个并发连接，连点十几个热点会把连接池占满，
       剩下的请求排队等着，摘要区就永远停在「正在抓取原文…」。
       实测连点 5 条必挂，而服务端单独测 115ms 就返回 —— 说明是客户端排队。
       取消上一条，保证任何时刻只有当前这条在飞。 */
    if (peekAbort) { try { peekAbort.abort() } catch {} }
    const ctrl = new AbortController()
    peekAbort = ctrl

    let done = false
    const finish = html => { if (!done) { done = true; fillPeek(idx, html) } }

    // 兜底计时：请求挂了也不能让界面一直转
    const timer = setTimeout(() => {
      finish('<div class="peek-err">这条读取超时了。<br>可以直接点下面的「读全文」。</div>')
    }, 15000)

    try {
      const r = await fetch('/api/hot/peek', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ url: it.url }),
        signal: ctrl.signal
      }).then(x => x.json())
      const d = r.data || r
      clearTimeout(timer)
      if (peekAbort === ctrl) peekAbort = null

      /* 三种「拿不到」分开说，不能一律当失败 */
      if (d.isSearchPage) {
        finish('<div class="peek-none">这条榜单给的是搜索结果页，没有正文可读。<br>' +
               '下面的「读全文」会直接打开搜索页。</div>')
        return
      }
      if (!d.text || d.text.length < 80) {
        finish('<div class="peek-none">对方站点的正文不在网页里（要运行脚本才出），这里读不到。<br>' +
               '下面的「读全文」会直接打开原页。</div>')
        return
      }
      peekCache[it.url] = d
      finish(renderPeek(d, it))
    } catch (e) {
      clearTimeout(timer)
      if (peekAbort === ctrl) peekAbort = null
      // 被下一条主动取消的，不是错误，界面已经换人了
      if (e && e.name === 'AbortError') return
      finish('<div class="peek-err">抓取失败：' + esc(e.message || '网络问题') +
             '<br>下面的「读全文」可以直接打开原页。</div>')
    }
  },

  async mark(id) {
    const f = (S.facts || []).find(x => x.id === id)
    if (!f) return
    f.verdict = f.verdict === 'wait' ? 'ok' : f.verdict === 'ok' ? 'no' : 'wait'
    try { await api('/save', { name:'facts', data: S.facts }); await poll(false) } catch (e) { toast(e.message, 'err') }
  },

  async delFact(id) {
    S.facts = (S.facts || []).filter(x => x.id !== id)
    markDirty('facts')
    try { await api('/save', { name:'facts', data: S.facts }); await poll(false) } catch (e) { toast(e.message, 'err') }
  },

  /* 查事实、找图：同一篇反复点应该合并成一条，不是每次都加一个任务。
     所以走服务端去重（不传 force），命中重复时给明确提示。 */
  async scanFacts() {
    if (!S.body.trim()) { toast('正文是空的', 'warn'); return }
    try {
      const r = await api('/task', { type:'audit', requirement: '从 data/body.md 抽取所有可验证断言（数字、日期、人名、机构、引用），写入 data/facts.json，verdict 填 wait。保留已有的已确认项。', ref: S.project.title })
      toast(r && r.duplicate ? '队列里已经有这条了' : '已提交。回对话里跟我说一声', r && r.duplicate ? 'warn' : 'ok')
      await poll(false)
    } catch (e) { toast(e.message, 'err') }
  },

  async findImg() {
    try {
      const r = await api('/task', { type:'material', requirement: `为「${S.project.title || '当前文章'}」找配图。抓取可公开访问的图片直链，下载到 data/images/，在 data/images.json 登记 file/cap/src/risk，并在 data/body.md 对应段落插入 ![图注](file)。优先权威媒体（央视、新华、第一财经、澎湃）。`, ref: S.project.title })
      toast(r && r.duplicate ? '队列里已经有找图任务了' : '已提交。回对话里跟我说一声', r && r.duplicate ? 'warn' : 'ok')
      await poll(false)
    } catch (e) { toast(e.message, 'err') }
  },

  async fetchImg() {
    const u = $('#imgurl').value.trim()
    if (!u) { toast('先贴图片直链', 'warn'); return }
    try {
      const r = await api('/fetch-img', { url: u })
      S.images.push({ id: Date.now().toString(36), file: r.file, cap:'', src: u, risk:'未评估', at: now() })
      markDirty('images')
      await api('/save', { name:'images', data: S.images })
      $('#imgurl').value = ''; toast('已抓取'); await poll(false)
    } catch (e) { toast('抓取失败：' + e.message, 'err') }
  },

  async delImg(id) {
    const im = (S.images || []).find(x => x.id === id)
    if (!im) return
    if (!confirm(`删除「${im.cap || im.file}」？正文里的引用也会一并移除。`)) return
    try {
      await api('/image/del/' + encodeURIComponent(im.file))
      S.images = (S.images || []).filter(x => x.id !== id)
    markDirty('images')
      await api('/save', { name:'images', data: S.images })
      await poll(false); toast('已删除')
    } catch (e) { toast(e.message, 'err') }
  },

  async insertImg(id) {
    const im = (S.images || []).find(x => x.id === id)
    if (!im) return
    const ta = $('#body'); const p = ta.selectionStart ?? ta.value.length
    const tag = `\n\n![${im.cap || '图片'}](${im.file})\n`
    ta.value = ta.value.slice(0, p) + tag + ta.value.slice(ta.selectionEnd ?? p)
    S.body = ta.value; bodyDirty = true; markDirty('body'); save(); go('write'); toast('已插入到光标处')
  },

  setImg(k, id, v) {
    const im = (S.images || []).find(x => x.id === id)
    if (!im) return
    im[k] = v
    deb(async () => { try { await api('/save', { name:'images', data: S.images }) } catch (e) {} }, 600)()
  },

  /* 「设为默认」的三个动作。
   用户原话「你的配图、你的文章的写作风格、你的排版都可以选一个默认的，
   你得支持有那个选项」—— 三样都要能设，且新稿子自动带上。 */
  prefStyle() { setPref('style', $('#style') ? $('#style').value : (S.project.style || 'warm')); renderWrite() },
  prefImgN() { setPref('imgN', Number(S.project.imgN) || 10); renderWrite() },
  prefTheme() { setPref('theme', S.project.theme || 'classic'); renderShip() },

  setTheme(id) {
    S.project.theme = id
    markDirty('project')
    shipCache = ''            // 主题变了，缓存必须失效
    // 在飞的预览请求全部作废 —— 它们的输入已经过期了，
    // 让它们回来就是旧主题的预览盖掉新主题的。
    shipSeq++
    api('/save', { name:'project', data: S.project }).catch(() => {})
    $$('.theme').forEach(b => b.classList.toggle('on', b.dataset.arg === id))
    const cb = $('#cmp-box'); if (cb) cb.style.display = 'none'
    shipOn = true
    refreshShip()
  },

  /* 对比：同时看两套主题，判断哪套更适合这篇稿子 */
  async compare(a, b) {
    if (!a || !b || a === b) return toast('先选两套不同的主题', 'warn')
    const box = $('#cmp-box')
    if (!box) return
    box.style.display = 'block'
    box.innerHTML = '<div class="empty"><div class="ico">◫</div>生成中…</div>'
    const [ra, rb] = await Promise.all([a, b].map(id =>
      api('/preview', { text: S.body, theme: id, images: S.images }).catch(() => null)))
    const name = id => (S.themes.find(t => t.id === id) || {}).n || id
    if (!ra || !rb) { box.innerHTML = '<div class="empty">生成失败</div>'; return }
    box.innerHTML = `
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px">
        <div>
          <div style="font-size:12px;font-weight:700;margin-bottom:8px;color:var(--ink-2)">${esc(name(a))}</div>
          <div class="preview-paper" style="background:${ra.theme.colors.bg}">
            <div class="preview-body" style="max-height:420px;overflow:auto;padding:24px 28px">
              <style>${ra.css}</style>${ra.html}
            </div>
          </div>
        </div>
        <div>
          <div style="font-size:12px;font-weight:700;margin-bottom:8px;color:var(--ink-2)">${esc(name(b))}</div>
          <div class="preview-paper" style="background:${rb.theme.colors.bg}">
            <div class="preview-body" style="max-height:420px;overflow:auto;padding:24px 28px">
              <style>${rb.css}</style>${rb.html}
            </div>
          </div>
        </div>
      </div>
      <div class="row end" style="margin-top:12px">
        <button class="btn ghost sm" data-act="setTheme" data-arg="${a}">用 ${esc(name(a))}</button>
        <button class="btn brand sm" data-act="setTheme" data-arg="${b}">用 ${esc(name(b))}</button>
        <button class="btn ghost sm" onclick="document.getElementById('cmp-box').style.display='none'">关闭</button>
      </div>`
    box.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
  },

  cmpWith() {
    const cur = S.project.theme || 'classic'
    const others = (S.themes || []).map(t => t.id).filter(i => i !== cur)
    if (!others.length) return
    const pick = prompt('和哪套主题对比？输入序号 1-' + others.length + '，或直接输入主题名', '1')
    if (pick === null) return
    const n = parseInt(pick, 10)
    const other = n >= 1 && n <= others.length
      ? others[n - 1]
      : (S.themes.find(t => t.n === pick || t.id === pick) || {}).id
    if (!other) return toast('没找到这套主题', 'warn')
    Actions.compare(cur, other)
  },
  async reset() {
    if (!confirm('清空全部数据？正文、选题、素材、图片、版本都会没，无法撤销。')) return
    try { await api('/reset'); await poll(false); toast('已清空') } catch (e) { toast(e.message, 'err') }
  },

  /* 复制后的提示只有一件事要做：告诉用户接下来干什么。
     用户原话：「你就直接告诉我，来到AI对话工具里粘贴就可以了，
     整那些复杂的干啥？」所以不写「已复制到剪贴板」这种废话，
     直接说去哪儿粘贴。 */
  copyBody() {
    navigator.clipboard.writeText($('#body').value)
      .then(() => toast('已复制 —— 回到 AI 对话工具，粘贴发送'))
      .catch(() => toast('复制失败，浏览器不让复制。手动选中正文按 Ctrl+C', 'err'))
  },

  copyPhrase() {
    const t = $('#phrase').textContent
    navigator.clipboard.writeText(t)
      .then(() => toast('已复制 —— 回到 AI 对话工具，粘贴发送'))
      .catch(() => toast('复制失败，浏览器不让复制。手动选中按 Ctrl+C', 'err'))
  },

  pickPreset(t) { $('#topic').value = t; $('#topic').focus() }
}

/* ---------- 第 1 页 · 选题定题 ----------
   选题和定题本来就是一件事的两个动作：从哪来（热点/灵感）→ 这次写什么。
   合成一页。选定后直接进输入框，「角度」是可选项，不填也能写。 */
/* ---------- 第 1 页 · 热点 ----------
   只管一件事：从榜单里翻出值得写的题。
   选中的题只写进 S.project.topic，然后跳去定题页 —— 绝不碰标题。 */
function renderHot() {
  const p = $('#p-hot')
  if (!p) return
  const saved = S.topics || []
  p.innerHTML = `
  <div class="container">
    <div class="page-head">
      <h2>翻热点</h2>
      <p>看到能写的，点一下带去定题。选中的只填进题框，不会动你的标题。</p>
    </div>

    <div class="seg">
      <button class="seg-b ${ideaTab==='hot'?'on':''}" data-act="ideaTab" data-arg="hot">实时热点</button>
      <button class="seg-b ${ideaTab==='mine'?'on':''}" data-act="ideaTab" data-arg="mine">我的选题${saved.length?' · '+saved.length:''}</button>
    </div>
    <div class="quickadd">
      <input class="input" id="topic-in" placeholder="想到什么先扔进来，回车即可" style="flex:1">
      <button class="btn ghost sm" data-act="addTopic">存为选题</button>
    </div>
    <div id="idea-pane"></div>
  </div>`
  paintIdeaPane()
}

/* ---------- 第 2 页 · 定题 ----------
   只管一件事：把题定下来。热点在这一页不再出现，避免和榜单混在一起。 */
/* ---------- 第 2 页 · 定题 ----------
   这一页只回答一个问题：这次写什么、写多长、什么调、配几张图。
   热点在上一页，翻篇历史在这一页下方，两者概念必须分开：
     · 队列 = 已经发出去、等着 AI 写的任务
     · 历史 = 以前写过的稿子，点一下就能回到那一版
   之前这两件事挤在一张卡片里、标题只写「排队中」，用户分不清。 */
/* 配图张数。用户原话「配图能不能默认就是多一些啊」——
   所以档位整体上移，默认落在 10 张。 */
const IMG_N = [4, 6, 8, 10, 12]

function renderIdea() {
  const p = $('#p-idea')
  if (!p) return
  const q = S.queue || []
  const vers = S.versions || []
  const imgN = Number(S.project.imgN) || 10

  p.innerHTML = `
  <div class="container narrow">
    <div class="page-head">
      <h2>这次写什么</h2>
      <p>一句话就行。不填角度、不填要求，直接点开始写。</p>
    </div>

    <div class="composer">
      <textarea id="topic" rows="3" placeholder="例：光伏亏了 11 个季度，反内卷这两味药为什么下晚期">${esc(S.project.topic || '')}</textarea>
      <div class="composer-foot">
        <span class="tip">${S.project.topic ? '题已填好，可以直接开写' : '题还没填'}</span>
        <span class="sp"></span>
        <button class="btn ghost" data-go="hot">← 翻热点</button>
        <button class="btn brand lg" data-act="submit">开始写</button>
      </div>
    </div>

    <div class="opts">
      <div class="opt">
        <label>字数</label>
        <select id="len">
          <option value="1500" ${S.project.len==='1500'?'selected':''}>1500 · 短评</option>
          <option value="2500" ${S.project.len==='2500'?'selected':''}>2500 · 中篇</option>
          <option value="3500" ${S.project.len==='3500'?'selected':''}>3500 · 长文</option>
          <option value="5000" ${S.project.len==='5000'||!S.project.len?'selected':''}>5000 · 深度稿</option>
        </select>
      </div>
      <div class="opt">
        <label>文风 ${prefs().style === (S.project.style || 'warm')
          ? '<em style="color:var(--brand)">默认</em>' : ''}</label>
        <select id="style">
          ${STYLE_LIST
            .map(([v,n]) => `<option value="${v}" ${(S.project.style||'warm')===v?'selected':''}>${n}</option>`).join('')}
        </select>
        <button class="pref-btn ${prefs().style === (S.project.style || 'warm') ? 'on' : ''}"
          data-act="prefStyle" title="把这个文风设为以后新稿子的默认">设为默认</button>
      </div>
      <div class="opt grow">
        <label>补充要求 <em>选填</em></label>
        <input class="input" id="req" placeholder="例：开头别介绍背景，直接进场景；结尾不要升华" value="${esc(S.project.req || '')}">
      </div>
    </div>

    <!-- 配图数量：写稿时 AI 就按这个数配好，不需要写完再手动插 -->
    <div class="field" style="margin-top:20px">
      <label>配几张图</label>
      <div class="seg">
        ${IMG_N.map(n => `<button class="seg-b ${imgN===n?'on':''}" data-act="imgN" data-arg="${n}">${n} 张</button>`).join('')}
        <button class="pref-btn ${prefs().imgN === imgN ? 'on' : ''}" data-act="prefImgN"
          title="把这个数量设为以后新稿子的默认">设为默认</button>
      </div>
      <div class="hint-line">写稿时会按这个数量自动配好并插进正文，不用事后再挑。</div>
    </div>

    <!-- ① 队列：已提交、等着 AI 处理 -->
    <div class="card" style="margin-top:26px">
      <div class="card-head">
        <h3>队列</h3><span class="sp"></span>
        <span class="hint">${q.length ? q.length + ' 条待处理' : '空'}</span>
      </div>
      <div class="card-body flush">
        ${q.length ? q.map(t => `<div class="task">
          <span class="badge-type">${esc({write:'写稿',rewrite:'改稿',audit:'核事实',material:'找素材',topic:'找选题'}[t.type] || t.type)}</span>
          <div class="c">
            <div class="t">${esc(t.ref || '未命名')}</div>
            <div class="d">${esc(t.at)}</div>
          </div>
          <button class="btn ghost sm" data-act="cancelTask" data-arg="${t.id}">取消</button>
        </div>`).join('') : `<div class="empty">队列是空的。题填好点「开始写」，任务会落在这里等 AI 处理。</div>`}
      </div>
    </div>

    <!-- ② 历史：以前写过的稿子，点一下回到那一版 -->
    <div class="card" style="margin-top:18px">
      <div class="card-head">
        <h3>历史稿</h3><span class="sp"></span>
        <span class="hint">${vers.length ? vers.length + ' 个版本' : '空'}</span>
      </div>
      <div class="card-body flush">
        ${vers.length ? `<div class="item-list">` + vers.slice(0, 12).map(v => `
          <button class="item ver-item" data-act="openVer" data-arg="${v.id}">
            <div class="c">
              <div class="t">${esc(v.label || '未命名')}</div>
              <div class="m">${esc(v.at || '')}　${v.chars || 0} 字</div>
            </div>
            <span class="go">打开 →</span>
          </button>`).join('') + `</div>` : `<div class="empty">还没有历史稿。写完第一篇后会存进来，点一下就能回到那一版。</div>`}
      </div>
    </div>
  </div>`
}

function paintIdeaPane() {
  const pane = $('#idea-pane')
  if (!pane) return
  if (ideaTab === 'hot') {
    if (!HOT) { pane.innerHTML = skeletonHot(); if (!hotLoading) loadHot(); return }
    paintHot()
  } else pane.innerHTML = topicsMineHTML()
}

function topicsMineHTML() {
  const t = S.topics || []
  if (!t.length) return `<div class="card"><div class="empty"><div class="ico">☰</div>还没有存选题<br>切到「实时热点」翻一圈，或用上面的输入框先扔一条</div></div>`
  return t.map(x => `
    <div class="pick" data-act="useTopic" data-arg="${x.id}">
      <div class="pick-t">${esc(x.title)}</div>
      ${x.angle ? `<div class="pick-a">切入：${esc(x.angle)}</div>` : ''}
      ${x.from && x.from.length ? `<div class="pick-f">${esc(x.from.join('、'))}</div>` : ''}
      <button class="btn ghost sm pick-x" data-act="delTopic" data-arg="${x.id}" title="删除">×</button>
    </div>`).join('')
}

function showSubmit(phrase, copied) {
  const old = $('#submitbox')
  if (old) old.remove()
  const box = document.createElement('div')
  box.className = 'card'
  box.id = 'submitbox'
  box.style.marginTop = '20px'
  box.innerHTML = `
  <div class="card-body">
    <div class="note ok" style="margin-bottom:14px">已提交。${copied ? '<b>回到 AI 对话工具，粘贴发送。</b>' : '回到 AI 对话工具，说一声就行。'}</div>
    <div id="phrase">${esc(phrase)}</div>
    <div class="row" style="margin-top:12px">
      <button class="btn ghost sm" data-act="copyPhrase">再复制一次</button>
      <button class="btn ghost sm" data-go="write">去看成稿 →</button>
    </div>
  </div>`
  const c = $('.composer')
  if (c) c.after(box); else $('.opts').after(box)
}


/* ---------- 第 3 页 · 成稿 ----------
   只有一个可编辑的文框。原来的「阅读/编辑」两套视图已删 ——
   用户反馈「搞得有点复杂」，其实一个 textarea 就够了，
   排版效果去第 4 页「发布」看。
   图库默认收起：要换图/加图才打开，平时不占地方。 */
/* 交付面板是唯一的侧栏，不再有 tab 切换 */
let libOpen = false


function renderWrite() {
  const el = $('#p-write')
  if (!el) return
  const b = S.body || ''
  const chars = b.replace(/\s/g, '').length
  const imgs = bodyImages().length
  const heads = (b.match(/^#{1,6}\s+\S/gm) || []).length
  const a = S.audit
  const facts = S.facts || []
  const un = facts.filter(f => f.verdict === 'wait').length
  const unHi = facts.filter(f => f.verdict === 'wait' && factRisk(f).lv === 'hi').length
  const bank = S.images || []
  const refs = new Set(bodyImages())
  const usedN = bank.filter(x => refs.has(x.file)).length
  const orphan = [...refs].filter(f => !bank.some(x => x.file === f))
  /* 标题建议已移到 AI 那边（见 engine/tasks.mjs）。
     本地再拼模板只会出碎片和无关文案 —— 用户原话「这太差劲了」。
     这里只保留：当前标题 + 一个「复制起标题要求」的按钮。 */

  el.innerHTML = `
  <div class="container full">
    <div class="write-grid">
    <div class="write-main">

      <!-- ── 概要条：标题 + 概要 + 关键指标 + 自检状态 ──
           全部常驻在首屏。用户不用往下翻就知道这篇文章什么状态。 -->
      <div class="brief" id="brief">
        <div class="brief-row">
          <input id="etitle" class="brief-title" placeholder="文章标题（还没有就点右边「起标题」）" value="${esc(S.project.title || '')}">
          <div class="brief-metrics">${renderBriefMetrics(chars, heads, imgs, bank, usedN, facts, un, unHi)}</div>
          <div class="brief-badges">${renderBriefBadges()}</div>
        </div>
        <div class="brief-row brief-row2">
          <span class="bs-l">概要</span>
          <textarea id="abs" class="bs-t" rows="1" placeholder="一句话说清这篇讲什么（公众号列表页会显示）">${esc(S.project.abstract || '')}</textarea>
        </div>
      </div>

      <!-- ── 正文编辑区 ── -->
      <div class="editor-shell">
        <textarea class="editor" id="body" placeholder="正文。AI 写好会自动落进来。&#10;&#10;加粗写 **文字**，图片写 ![图注](文件名)">${esc(S.body || '')}</textarea>

        ${imgs ? `<div class="img-where">
          <div class="iw-h">正文里的图<span>${imgs} 张 · 点缩略图可换</span></div>
          <div class="iw-row">
            ${bodyImages().map((f, i) => `<button class="iw-item" data-act="imgWhere" data-arg="${i}"
              title="${esc(f)}">
              <img src="${imgSrc(f)}" alt="" loading="lazy">
              <span class="n">${i + 1}</span>
            </button>`).join('')}
          </div>
        </div>` : ''}

        <!-- 操作栏：常驻，不跟着正文滚走 -->
        <div class="editor-bar">
          <button class="btn ghost sm" data-act="stash">存一版</button>
          <button class="btn ghost sm" data-act="copyBody">复制全文</button>
          <button class="btn ghost sm" data-act="toggleLib">${libOpen ? '收起图库' : '打开图库'}</button>
          <span class="sp"></span>
          <span class="bar-hint" id="bar-hint"></span>
          <button class="btn brand sm" data-go="ship">下一步 · 排版发布</button>
        </div>

        ${libOpen ? `<div class="lib">
          <div class="lib-h">图库<span>${bank.length} 张 · 已用 ${usedN}</span></div>
          <div class="lib-actions">
            <button class="btn brand sm" data-act="findImg">让 AI 找图</button>
            <button class="btn ghost sm" data-act="suggestImg">推荐插入位置</button>
            <input class="input xs" id="imgurl" placeholder="或贴图片直链" style="flex:1">
            <button class="btn ghost sm" data-act="fetchImg">抓取</button>
            <span class="drop-hint" id="drop">拖图 / Ctrl+V 贴图</span>
          </div>
          <div class="lib-row">
            ${bank.map(im => `<div class="lib-item ${refs.has(im.file) ? 'used' : ''}" data-file="${esc(im.file)}">
              <div class="pic" data-act="insertImg" data-arg="${im.id}" title="插入正文">
                <img src="${esc(imgSrc(im.url || im.file))}" alt="" loading="lazy">
                ${refs.has(im.file) ? '<span class="ok">已用</span>' : ''}
              </div>
              <input class="input xs" value="${esc(im.cap || '')}" placeholder="图注" oninput="Actions.setImg(${im.id}, this.value)">
            </div>`).join('')}
          </div>
        </div>` : ''}
      </div>

      ${orphan.length ? `<div class="note warn" style="margin-top:var(--s3)">正文引用了 ${orphan.length}
        ${orphan.map(f => `<code>${esc(f)}</code>`).join('、')}，但图库里没有这几个文件</div>` : ''}

      <div id="img-plan" style="display:none;margin-top:12px"></div>
      <div id="ver-cmp"></div>

      <!-- ── 交付区：默认折叠 ──
           自检 12 项 / 标题候选 / 一键改写都在里面。
           默认收起是为了首屏 —— 概要条上已有徽章说明状态。 -->
      <details class="acc deliver-acc" id="deliver-acc">
        <summary>
          <span>交付 · 自检 / 标题 / 改写</span>
          <span class="ds-n" id="deliver-sum"></span>
        </summary>
${renderDeliverPane(a, facts)}
      </details>
    </div>
    <!-- 右侧：备选标题 + 一键改写
         原来这里是文章预览，但发布页也有文章预览 —— 同一个功能放两遍，
         这个位置就浪费了。改成写稿时真正需要的两件工具。 -->
    <aside class="write-side write-aside">

      <!-- 备选标题：AI 交稿时把标题写进 data/titles.json，这里自动收下。
           ★ 用户原话「不要让我再操作第二步」——
             所以这里没有「复制『起标题』的要求」这个按钮。
             自动收标题的功能本来就有，是那个按钮把它变成了主入口。
             手工粘贴收进折叠区，只在 AI 漏交时才用。 -->
      <section class="aside-sec">
        <div class="as-h">
          <span class="as-t">备选标题</span>
          <span class="as-n" id="as-title-n"></span>
        </div>
        ${titlePool.length ? `<div class="tp-list tp-list-aside">
          ${titlePool.map((t, i) => `<button class="tp ${t === ((S.project || {}).title || '') ? 'on' : ''}" data-act="useTitle" data-arg="${i}">
            <span class="tp-i">${i + 1}</span>
            <span class="tp-t">${esc(t)}</span>
          </button>`).join('')}
        </div>`
        : `<div class="as-empty">
            <div class="as-hint">正文写完，标题会跟着一起出现在这儿。<br>
              AI 漏交了，下面的折叠区里可以自己粘。</div>
            ${(newTitlesPending || []).length ? `<div class="note warn" style="margin-top:8px">
              AI 又交了 ${newTitlesPending.length} 个标题，你自己粘的那批没被覆盖。
              <button class="pref-btn" data-act="takeNewTitles">换用 AI 这批</button>
            </div>` : ''}
          </div>`}
        <details class="acc acc-flat as-paste">
          <summary>万一 AI 没给标题，我自己粘</summary>
          <div class="in">
            <textarea class="input" id="title-in" rows="4"
              placeholder="一行一个，粘进来就变成可点的按钮">${esc(titlePoolRaw || '')}</textarea>
            <button class="btn ghost sm block" data-act="taskTitle">复制「起标题」的要求</button>
          </div>
        </details>
      </section>

      <!-- 一键改写：复制「要求 + 原文」出去，粘回 AI 对话窗口改 -->
      <section class="aside-sec">
        <div class="as-h">
          <span class="as-t">一键改写</span>
          <span class="as-n">不满意就让它重写</span>
        </div>
        <textarea class="input as-req" id="as-fixreq" rows="4"
          placeholder="例：第二段太软，换成具体数字&#10;结尾不要升华&#10;开头别铺垫，直接进场景">${esc(fixReqRaw || '')}</textarea>
        <button class="btn brand block" data-act="fix">复制「按要求改写」的要求</button>
        <div class="as-hint">复制完回到 AI 对话窗口粘贴，改好的全文再放回正文框</div>
      </section>

      <!-- 自检摘要：只放结论，明细去交付区看 -->
      <section class="aside-sec aside-chk">
        ${renderAsideCheck()}</section>
    </aside>
    </div>
  </div>`
  /* 成稿页只有一个可编辑的 textarea。
     「阅读视图」已按用户要求删掉：拆成两套太怪，排版效果去「发布」页看就行。
     原来这里的 renderDraft() 一并移除。

     右侧的文章预览。调用必须放在函数体内 ——
     之前插到了收尾的 } 外面，变成顶层语句，
     只有脚本加载时跑一次，之后每次进来都是空的「正在排版…」。 */
}

/* ══════════════ 交付面板 ══════════════
   用户原话拆开是三件事：
     「你写完之后能不能有个程序去自己验收一下呀」        → 自检要自动跑
     「标题得多几种，不要需要让人再操作第二步」        → 标题候选一键替换
     「实在不行你加一个什么一键改写」                  → 一键改写
   以及一条否定：
     「你那个什么素材啊，还有那个什么检查，那都不需要有那些玩意」
   —— 所以原来的「核对」「素材」两个 tab 已经删掉了，
   自检从「一个要点的 tab」变成「一直显示在面板最上面的结果」。 */

/* 标题候选。
   来源是用户从 AI 对话工具粘回来的整段文字，一行一个。
   本地不拼模板 —— 拼出来的是碎片和无关文案，用户原话「这太差劲了」。
   粘回来之后每个标题自动配一个「用这个」，点一下就替换。 */
let titlePool = []

function parseTitlePool(text) {
  return String(text || '')
    .split('\n')
    .map(s => s.trim())
    .map(s => s.replace(/^\s*(?:\d{1,2}\s*[.、)）]|[·•\-*]\s*|第[一二三四五六七八九十]+[个条]\s*[、,，]?)\s*/, ''))
    .map(s => s.replace(/^[「『"“]\s*/, '').replace(/\s*[」』"”]\s*$/, '').trim())
    /* 丢掉 AI 附的解释性文字：「1. 这个角度好在...」「（为什么选它）」 */
    .filter(s => s.length >= 4 && s.length <= 40)
    .filter(s => !/^(为什么|角度|说明|方向|理由|点评|批注)/.test(s))
    .filter(s => !/：.{3,}$/.test(s) && !/^[（(【\[]/.test(s))
    /* 挡掉提前否定那类短语。
       用户点名的第一号 AI 味，AI 交稿时可能顺手混进候选里
       （实测「不要误解」四个字长度刚好 4，混过了前面所有过滤）。
       标题里出现「先说结论」「免得有人」这种，说明那份标题本身不合格。 */
    .filter(s => !/(先说结论|免得有人|以免有人|不要误解|需要澄清|这里要说明|有读者会|可能会有人|并不是说)/.test(s))
    /* 太短的多半是残句（「可以观察」这种），不是完整标题。
       门槛 6 字，不是 8 —— 「退休前夕查出癌」是 7 字，是好标题，
       按 8 卡会误删。 */
    .filter(s => s.length >= 6)
    .slice(0, 12)
}

/* 自检：一次跑完，全在本地，不依赖任何外部服务。
   用户要的是「自己检查一遍」，所以必须是打开面板就能看到结果，
   不是要点一个按钮才有。 */
function selfCheck() {
  const body = String(S.body || '')
  const wc = body.replace(/\s/g, '').length
  if (!wc) return { empty: true }

  /* 每次都现算，绝不用 S.audit。
     原来写的是 `S.audit || scan(body)`，只在没有缓存时才扫 ——
     而 runAudit() 只在 refresh() 里跑，refresh() 在 stamp 没变时会跳过，
     于是改了正文之后 S.audit 还是上一次的结果。
     实测后果：注入一句「先说结论，免得有人只看标题」，
     自检照样报 AI 100 分通过 —— 检查等于没有。
     现在每次现算，正文多长就扫多长，没有缓存可 stale。 */
  const a = scan(body)
  const len100 = Math.max(1, wc / 100)
  const cnt = re => (body.match(re) || []).length

  /* 冒号：排除三种有功能的用法 ——
     图注「出处：」、表格「来源：」、引语前「她说的是：」。
     这三处的冒号去掉会把话弄断，罚它们是误报。 */
  const colonLines = body.split('\n')
    .filter(l => !/^\s*!\[/.test(l) && !/^\s*\|/.test(l))
    .filter(l => /：/.test(l))
    .filter(l => !/「|」|"|"|\*\*.*\*\*/.test(l.slice(l.indexOf('：'))))
    .join('\n')

  /* 标题是否与正文相符 —— 用正文里的实词做重合度。
     这是本地能做到的最实的一步：标题里的名词在正文里找不到，
     那就是标题飘了。之前出过「标题写游本昌、正文写王英」的错。 */
  const title = String((S.project && S.project.title) || '')
  const titleOk = { has: title.length > 0, cover: 0, miss: [] }
  if (title) {
    /* 中文标题没有空格，按空格切词只能切出整句，
       「她花十五万去南极」当成一个词去正文里找，当然找不到 ——
       第一版就是这么写的，结果永远报「只重合 0%」，是假警报。

       改成按 2~4 字的滑窗切：中文的实词几乎都在这个长度里，
       「十五万」「南极」「肿瘤」「退休」都能切出来。
       只在正文里出现过的片段才算命中。 */
    /* 标题里每一段（按标点切开）在正文中的最长公共子串。
       标题是几个短句用标点连起来的，整体找 LCS 会被标点两侧卡住 ——
       「她花十五万去南极」和「回来肿瘤小了」之间有个逗号，
       合起来算最长子串就找不到。必须分段找再取最长的那一段。 */
    function lcsIn(s) {
      let best = ''
      for (let i = 0; i < s.length; i++) {
        for (let j = s.length; j > i + best.length; j--) {
          const sub = s.slice(i, j)
          if (body.includes(sub)) { best = sub; break }
          if (j - i <= best.length) break
        }
      }
      return best
    }
    const parts = title.split(/[，。！？、：；「」“”\s]+/).map(s => s.replace(/[^一-龥A-Za-z0-9]/g, '')).filter(Boolean)
    /* 覆盖率 = 每一段各自在正文里能找到的比例，按长度加权平均。
       不能只取「最长的那一段」当分子 ——
       标题有三段时，后面两段没进分母，
       一段对得上就满分，剩下两段写错了也照样通过。
       实测踩过：标题和正文首行几乎一字不差，却只报 35%。 */
    let num = 0, den = 0
    const weak = []
    parts.forEach(p => {
      const b = lcsIn(p)
      num += b.length; den += p.length
      if (b.length / p.length < 0.5) weak.push(p)
    })
    titleOk.best = lcsIn(parts.sort((a, b) => b.length - a.length)[0] || '')
    titleOk.cover = den ? Math.round(num / den * 100) : 0
    /* 只有覆盖率明显偏低才算标题与正文对不上。
       中文标题常用虚词和动词改写（「花了」vs「花」），
       硬要求每个字都对上会一直误报，所以阈值放到 60%。 */
    titleOk.miss = titleOk.cover >= 60 ? [] : weak.slice(0, 2)
  }

  return {
    empty: false, wc,
    ai: a.ai,
    hits: (a.hits || []),
    /* 用户点名要压的三样，密度按千字算 */
    quote: cnt(/[“”][^“”]{0,30}[“”]/g),
    colon: (colonLines.match(/：/g) || []).length,
    dash: cnt(/——/g),
    per1k: Math.round(wc / 1000 * 10) / 10,
    bold: cnt(/\*\*[^*]+\*\*/g),
    imgs: bodyImages().length,
    heads: (body.match(/^#{1,6}\s+\S/gm) || []).length,
    /* 来源前缀：行首的「来源：」+ 正文里的转述框架。
       只查行首那种是不够的，实测漏了九处。 */
    srcs: cnt(/^来源[:：]|^资料来源|据.{0,10}(报道|通报)/gm) +
          cnt(/(据|根据|按照)[^。，\n]{0,8}(报道|通报|文献|研究|数据|统计|说法)/g) +
          cnt(/[^\n]{0,12}(期刊|论文|文章|文献|研究|报道)[^。，\n]{0,4}(上|里|中)?[^。，\n]{0,4}(写|说|表明|显示|发现|估算|提到|指出)/g) +
          cnt(/(作者|专家|学者|研究人员|笔者|记者)[^。，\n]{0,8}(说|指出|认为|表示|提到|写道|介绍)/g) +
          cnt(/(调查|研究)[^。，\n]{0,4}(显示|表明|发现|估算|证明)/g),
    titleOk,
    len100
  }
}

/* 一条自检项。通过 / 有问题 / 没话说，三种状态要分清，
   混成「0 处」会让人以为查过了而其实没查。 */
function chk(ok, label, detail) {
  return `<div class="chk ${ok ? 'ok' : 'no'}">
    <span class="mk">${ok ? '✓' : '!'}</span>
    <span class="lb">${esc(label)}</span>
    ${detail ? `<span class="dt">${detail}</span>` : ''}
  </div>`
}
/* ---------- 标点自检取数 ----------
   三处自检视图（12 项明细 / 右侧摘要）都从这里取数。
   收成一处是因为文案里的「有没有」和「几处」必须用同一个判据，
   否则会出现「判据说不合格、文案说 0 处」这种自相矛盾的显示。
   ★ 这类不一致比没有检查更糟：用户会以为过了。 */
function punctOf(hits) {
  const pick = (...names) => (hits || []).filter(h => names.includes(h.n))
  return {
    hit: (...ns) => pick(...ns).length > 0,
    count: (...ns) => pick(...ns).reduce((a, h) => a + (h.n_hit || 0), 0)
  }
}


function renderSelfCheck() {
  const c = selfCheck()
  if (c.empty) return `<div class="side-note">正文还是空的，写完自动检查。</div>`
  const body = String(S.body || '')

  const k = c.per1k || 1
  const hi = c.hits.filter(h => h.lv === 'hi')
  const rows = []
  const p3 = punctOf(c.hits)

  rows.push(chk(!hi.length, 'AI 味（高危项）',
    hi.length ? hi.slice(0, 3).map(h => esc(h.n)).join('、') : `${c.ai} 分`))

  rows.push(chk(c.titleOk.has, '标题已填', c.titleOk.has ? '' : '还没起标题'))
  if (c.titleOk.has) {
    rows.push(chk(c.titleOk.cover >= 60, '标题与正文相符',
      c.titleOk.cover >= 60
        ? `重合 ${c.titleOk.cover}%`
        : `只重合 ${c.titleOk.cover}%，正文里对不上「${c.titleOk.miss.map(esc).join('」「')}」`))
  }

  /* 标点三条已从「按密度」改成硬禁（2026-10-03）。
     文案必须同步改 —— 显示「每千字 0.7 个」会让人以为
     「没超阈值所以过了」，实际一个都不许有。 */
  rows.push(chk(!p3.hit('弯引号') && !p3.hit('ASCII 引号'), '双引号（硬禁）',
    p3.hit('弯引号', 'ASCII 引号')
      ? `${p3.count('弯引号', 'ASCII 引号')} 处，改用直角引号「」`
      : '没有，全篇用的直角引号'))
  rows.push(chk(!p3.hit('冒号'), '冒号（硬禁）',
    p3.hit('冒号')
      ? `${p3.count('冒号')} 处，正文里一个都不许有`
      : '没有（图注出处和引语前的已自动放行）'))
  rows.push(chk(!p3.hit('破折号'), '破折号（硬禁）',
    p3.hit('破折号')
      ? `${p3.count('破折号')} 处，改成句号`
      : '没有（分隔线和表格不算）'))
  rows.push(chk(c.imgs > 0, '配图', c.imgs ? `${c.imgs} 张` : '一张都没有'))
  /* 加粗密度阈值定 5/千字。
       手册里写的是 8~12，但那是在没有「隔开一段」的约束下定的，
       实际写下来连续两三段各加一处会成片高亮，读者反而找不到重点。
       用户要的是「该加粗的地方有」，不是「加得越多越好」。 */
  rows.push(chk(c.bold / k >= 5, '加粗', `每千字 ${(c.bold / k).toFixed(1)} 处`))
  rows.push(chk(!c.srcs, '来源前缀',
    c.srcs ? '正文开头有「据某某报道」这类前缀' : '没有'))

  /* 人性处境 / 人生视角。
     用户原话：「你应该特别感性，从人性的角度出发……特别写的东西特别有温度，
     你要有深度地去剖析人性角度这些光芒点，然后还有整个人生的角度那些大的哲理。」

     这两条之前只写在风格判据里，界面上看不到 ——
     用户看自检全绿，以为「有温度」已经被检查过了，其实没查。
     现在放进来：有温度不该只是一条禁令（有的话更糟），
     得看得见「你这篇到底写没写人的难处、到底有没有放到一辈子去看」。 */
  const condHit = /(不容易|难的是|难在|舍不得|放不下|将心比心|换位|退一步|心里明白|懂的人|亏了|不值|多想一步|替别人想)/.test(body)
  const lifeHit = /(一辈子|半辈子|这样的年纪|到头来|活了大半辈子|一辈子一回|年轻时|老了|临了|这辈子)/.test(body)
  rows.push(chk(condHit, '写出了人的处境',
    condHit ? '有' : '只写了事，没写难在哪／亏在哪／舍不得什么'))
  rows.push(chk(lifeHit, '有人生视角',
    lifeHit ? '有' : '停在就事论事，没放到「一辈子」的长度里看'))

  /* 事实待核。
     原来的「核对」tab 是用户明说不要的「检查面板」，
     但事实核对本身不能删 —— 那是防止文章里出现编造数字的最后一道闸。
     所以降级成自检区里的一条，而不是一个单独的页面。 */
  const facts = S.facts || []
  const wait = facts.filter(f => f.verdict !== 'ok')
  const waitHi = wait.filter(f => factRisk(f).lv === 'hi')
  rows.push(chk(!waitHi.length, '高危事实已核',
    waitHi.length ? `${waitHi.length} 条没核` : (wait.length ? `${wait.length} 条待核（无高危）` : '无待核')))

  /* 备选标题。
     用户原话「你最后给出标题都得几种，不要需要让人再操作第二步了」——
     这句话栽过两次：功能建好了，titles.json 一直是空的，
     用户每次点开看到的都是空候选区。
     写进手册会被淹掉，写进自检跑不掉。 */
  rows.push(chk(titlePool.length > 0, '备选标题',
    titlePool.length
      ? `${titlePool.length} 个，点一下就换上去`
      : '还没交。写完正文必须一并给 6 个完整标题，不该让用户再追问'))

  const bad = rows.filter(r => r.includes('class="chk no"')).length
  return `
    <div class="self-chk">
      <div class="self-chk-hd ${bad ? 'bad' : 'good'}">
        ${bad ? `自检：${bad} 项要改` : '自检：全部通过'}
      </div>
      ${rows.join('\n      ')}
    </div>`
}

/* ══════════════ 概要条 ══════════════
   用户原话：「文章概要要能看到，标题要一并给出！」
   以及「主要功能要一屏就看到」。

   原来标题是个裸输入框挂在最上面，概要（project.abstract）只存在于发布页，
   自检在页面下方 999px 处 —— 首屏 700px 完全看不见。
   实测：主要功能首屏可见度 2/5。

   现在把「这篇文章是什么状态」压成两个函数：
     renderBriefBadges()   结论：自检过没过、标题配不配套、概要写没写
     renderBriefMetrics()  数字：字数/小节/图/AI味/加粗/待核事实
   概要条整块约 80px，剩下的高度全给编辑器和预览。 */

function renderBriefBadges() {
  const c = selfCheck()
  if (c.empty) return `<span class="bd bd-mute">还没写正文</span>`
  const out = []

  const bad = c.hits.filter(h => h.lv === `'hi'`)
  if (bad.length) {
    out.push(`<span class="bd bd-bad" title="${esc(bad.map(h => h.n).join('、'))}">` + `AI 味 ${bad.length} 处要改</span>`)
  } else {
    out.push(`<span class="bd bd-ok">自检 ${c.ai} 分</span>`)
  }

  /* 标题配套。用户明确要求标题要一并给出，
     所以「标题对不对正文」这件事必须在首屏看得见，不能等翻到交付区 */
  /* 「还没标题」原来给的是按钮「点我去起」——
     点了要复制一段要求，粘到 AI 对话窗口，再把标题粘回来。
     那就是第二步，用户明说不要。

     标题要通读全文才起得来，本地任何按钮都起不出来，
     所以这里只报状态、给出路，不给假动作。
     出路是右侧标题区那个「万一 AI 没给标题，我自己粘」。 */
  if (!c.titleOk.has) {
    out.push(`<span class="bd bd-warn" title="标题要通读全文才起得来，写完正文时一起交给 AI">` +
      `还没标题 · 写完正文时一起交</span>`)
  } else if (c.titleOk.cover < 60) {
    out.push(`<span class="bd bd-warn" title="标题里这些词正文里没出现">` + `标题与正文只重合 ${c.titleOk.cover}%</span>`)
  } else {
    out.push(`<span class="bd bd-ok">标题配套</span>`)
  }

  const abs = String((S.project && S.project.abstract) || '').trim()
  out.push(abs
    ? `<span class="bd bd-ok" title="${esc(abs)}">概要已写</span>`
    : `<button class="bd bd-warn" data-act="taskAbs">补概要</button>`)

  return out.join('')
}

function renderBriefMetrics(chars, heads, imgs, bank, usedN, facts, un, unHi) {
  const c = selfCheck()
  const ai = c.empty ? null : c.ai
  const k = Math.max(1, chars / 1000)
  const m = []

  /* sec=true 的是次要指标，窄屏下由 CSS 隐藏（.mt-sec），
     鼠标悬停的 title 里还能看到。
     实测 5 项全显示会把标题输入框挤到只剩 120px ——
     标题是这篇文章的名字，优先级高于「小节 16」这种信息。 */
  const add = (label, value, cls, title, sec) =>
    m.push(`<span class="mt ${sec ? 'mt-sec' : ''} ${cls || ''}"${title ? ` title="${esc(title)}"` : ''}>${label}<b>${esc(String(value))}</b></span>`)

  add(`字`, chars)
  add(`小节`, heads, '', '', true)
  add(`图`, imgs + '/' + (bank || []).length,
    usedN < (bank || []).length ? `mt-warn` : '',
    `正文用了 ${usedN} 张，图库共 ${bank.length} 张`, true)
  if (ai !== null) add(`AI 味`, ai,
    ai >= 75 ? `mt-ok` : ai >= 55 ? `mt-warn` : `mt-bad`,
    `越高越没有AI味`)
  add(`加粗`, (c.bold / k).toFixed(1), '',
    `每千字加粗处数，5~10合适`, true)
  if (unHi) m.push(`<span class="mt mt-bad" title="精确数字/引语/因果，错了会被当场抓出来">` + `高危事实<b>${unHi}</b></span>`)
  else if (un) m.push(`<span class="mt mt-warn">` + `待核<b>${un}</b></span>`)

  return m.join('')
}
/* ---------- 右侧：自检摘要 ----------
   只放结论，不放 12 项明细 —— 明细在下面的交付区。
   右边这块要在「一屏内」用完，所以每项必须一行说完。 */
function renderAsideCheck() {
  const c = selfCheck()
  if (c.empty) return '<div class="as-empty">正文还是空的，写完自动检查</div>'

  const k = Math.max(1, c.wc / 100)
  const rows = []
  const line = (ok, label, detail) =>
    rows.push(`<div class="achk ${ok ? 'ok' : 'no'}"><span class="mk">${ok ? '✓' : '!'}</span>` +
      `<span class="lb">${esc(label)}</span><span class="dt">${esc(String(detail))}</span></div>`)

  /* 备选标题放第一条 —— 它是用户最想要的东西，
     缺了整篇就白交。
     用户原话「你最后给出标题都得几种，不要需要让人再操作第二步了」，
     这句话栽过两次：功能建好了 titles.json 一直是空的。
     写进手册会被淹掉，写进自检跑不掉。 */
  line(titlePool.length > 0, '备选标题', titlePool.length ? titlePool.length + ' 个' : '还没交')

  const hi = c.hits.filter(h => h.lv === 'hi')
  line(!hi.length, 'AI 味', hi.length ? hi.length + ' 处' : c.ai + ' 分')
  line(c.titleOk.has, '标题', !c.titleOk.has ? '未填' : '配套 ' + c.titleOk.cover + '%')
  /* 标点三条：硬禁，不是密度 */
  const p3 = punctOf(c.hits)
  line(!p3.hit('弯引号', 'ASCII 引号'), '双引号',
    p3.hit('弯引号', 'ASCII 引号') ? p3.count('弯引号', 'ASCII 引号') + ' 处' : '直角引号')
  line(!p3.hit('冒号'), '冒号',
    p3.hit('冒号') ? p3.count('冒号') + ' 处' : '无')
  line(!p3.hit('破折号'), '破折号',
    p3.hit('破折号') ? p3.count('破折号') + ' 处' : '无')

  const bad = rows.filter(r => r.indexOf('class="achk no"') >= 0).length
  return `<div class="achk-sum ${bad ? 'bad' : 'good'}">${bad ? bad + ' 项要改' : '全部通过'}</div>` +
    '<div class="achk-list">' + rows.join('') + '</div>'
}

function renderDeliverPane(a, facts) {
  const body = String(S.body || '')
  const c = selfCheck()
  const others = c.hits.filter(h => h.lv !== 'hi')

  return `
  <div class="deliver">
    <div class="deliver-h">
      <span class="dh-t">交付</span>
      <span class="dh-n">自检 · 标题 · 改写</span>
    </div>
    <div class="deliver-grid deliver-grid-2">
    <div class="dc dc-chk">

    <div class="side-h">自检<span>正文一改就自动重跑</span></div>
    ${renderSelfCheck()}
    ${(S.facts || []).length ? `
      <details class="acc" style="margin-top:8px">
        <summary>待核事实清单<span>${(S.facts || []).filter(f => f.verdict !== 'ok').length} 条待核</span></summary>
        <div class="in fact-scroll">
          ${(S.facts || []).map(f => {
            const r = factRisk(f)
            return `<div class="fact">
              <button class="v ${f.verdict === 'ok' ? 'ok' : f.verdict === 'no' ? 'no' : 'wait'}" data-act="mark" data-arg="${f.id}">
                ${f.verdict === 'ok' ? '确认' : f.verdict === 'no' ? '有误' : '待核'}</button>
              <div class="c"><div class="rk ${r.lv}">${esc(r.n)}</div><em>${esc(f.value)}</em></div>
            </div>`
          }).join('')}
        </div>
      </details>` : ''}
    ${others.length ? `
      <details class="acc" style="margin-top:8px">
        <summary><span class="lv md">中</span>其余 ${others.length} 处可以看看</summary>
        <div class="in">${others.slice(0, 8).map(h => `${esc(h.n)} ×${h.n_hit}`).join('<br>')}</div>
      </details>` : ''}

    </div>
    <div class="dc dc-title">
    <div class="side-h">标题<span>给几种，挑一个就换上去</span></div>
    <div class="side-note">
      正文写完，标题跟着正文一起交，写进 <b>data/titles.json</b>，
      这边自动收下，点一下就换上去。<br>
      标题要通读全文才起得来，所以这一块没有「一键生成」——
      本地拼出来的都是碎片。
    </div>
    ${titlePool.length ? `
      <div class="tp-list">
        ${titlePool.map((t, i) => `
          <button class="tp ${t === ((S.project || {}).title || '') ? 'on' : ''}" data-act="useTitle" data-arg="${i}">
            ${esc(t)}
          </button>`).join('')}
      </div>` : `<div class="side-empty">AI 交稿时会把标题写进 data/titles.json，这里自动出现</div>`}
    ${newTitlesPending ? `
      <div class="note warn" style="margin-top:var(--s2)">
        AI 又交了 ${newTitlesPending.length} 个标题，
        你自己粘的那批不会被覆盖。<button class="pref-btn" data-act="takeNewTitles">换用 AI 这批</button>
      </div>` : ''}
    <details class="acc acc-flat">
      <summary>万一 AI 没给标题，我自己粘</summary>
      <div class="in">
        <button class="btn ghost sm block" data-act="taskTitle">复制「起标题」的要求</button>
        <div class="task-out" id="task-title" style="display:none"></div>
        <textarea class="input" id="title-in-del" rows="4"
          placeholder="一行一个，粘进来就变成可点的按钮">${esc(titlePoolRaw || '')}</textarea>
      </div>
    </details>

    </div>
  </div>
  </div>`
}

/* 自动收录 AI 交稿时给的候选标题。
   AI 按手册要求把 6 个标题写进 data/titles.json，这里检测到变化就收下。

   为什么要做这个：用户原话「你最后给出标题都得几种，不要需要让人再操作第二步了」。
   以前 AI 把标题贴在对话里，用户得手动复制回来粘进框 ——
   那就是第二步。现在 AI 写进文件，界面自己收到。

   只在「指纹变了」时才动手，否则每 4 秒的轮询都会清掉用户正在看的东西。
   用户在框里手改过（titlePoolRaw 非空）时不覆盖 —— 那是用户自己的东西。 */
let titlesSeen = ''

function ingestTitles(list) {
  const arr = Array.isArray(list) ? list : []
  const key = JSON.stringify(arr)
  if (key === titlesSeen) return
  titlesSeen = key
  if (!arr.length) return
  /* 用户已经自己粘过就别抢 —— 但要告诉他「有新的了」，
     否则他不知道自己错过了 AI 刚交的一批。 */
  if (titlePoolRaw && titlePoolRaw.trim()) {
    if (!newTitlesPending) {
      newTitlesPending = arr.slice()
      if (curPage === 'write') renderWrite()
      toast('AI 又给了一批标题，粘贴区右侧有个按钮可以换过去', 'warn')
    }
    return
  }
  const pool = parseTitlePool(arr.join('\n'))
  if (!pool.length) return
  titlePool = pool
  titlePoolRaw = arr.join('\n')
  newTitlesPending = null
  if (curPage === 'write') renderWrite()
  if (pool.length) toast('AI 给了 ' + pool.length + ' 个候选标题，点一下就能换', 'ok')
}


/* ---------- 主题 CSS 加作用域 ----------
   排版主题给的是裸选择器（p{...} h2{...}），直接插进 <style> 会漏到
   应用自己的 UI 上 —— 实测过：切到发布页再回热点页，应用页头的
   margin 从 0 变成 32px 16px，p 的下边距多出 18px。
   所以每条规则都加上预览容器的类名前缀。

   ★ 坑：变量默认值写在 :root 里。加前缀会变成 `.paper-shell :root`，
   而 :root 指的是 <html>，section 并不是它的后代 —— 一条都匹配不上，
   变量等于没定义，font-size:var(--fs) 就退回浏览器兜底。
   修法：把 :root 直接换成预览容器本身，变量挂到 section 的父节点上。 */
function scopeCss(css, scope) {
  let out = String(css || '')
  // 先把 :root{--fs:...;--fc:...} 整块摘出来，转成容器自身的规则。
  // 不这么做的话，正则会把变量声明当普通规则加前缀，变量等于没定义。
  const rootVars = []
  out = out.replace(/:root\s*\{([^}]*)\}/g, (m, body) => {
    rootVars.push(body.trim())
    return ''   // 从正文里移除
  })
  let result = out.replace(/(^|[{};])\s*([^{}@;]+?)\s*\{/g, (mm, brace, sel) => {
    const parts = sel.split(',').map(s => s.trim()).filter(Boolean)
    if (!parts.length) return mm
    return brace + parts.map(s => scope + ' ' + s).join(',') + '{'
  })
  // 变量声明挂在容器上（section 的父节点，能被继承到）
  if (rootVars.length) result = `${scope}{${rootVars.join(';')}}\n` + result
  return result
}

/* 预览宽度三档。选 375/600/760 时，1000px 视口下后两档会被夹成同一个宽度，
   等于两个废选项。改成 375/480/640：三档在常见窗口里都排得下、也看得出差别。 */
let shipWidth = 375

const WIDTHS = [
  { w: 375, n: '手机' },
  { w: 480, n: '窄屏' },
  { w: 640, n: '宽屏' }
]

/* ---------- 第 4 页 · 排版发布 ----------
   左边是排版工具（主题、宽度、摘要、发布动作），右边是预览。
   预览不再套手机壳：公众号正文本来就是白底纸，
   之前那圈近黑色的外框在页面顶部顶出一条黑边，看着像刘海，
   实际是 430×13890 的装饰框，纯装饰且误导。 */
/* ---------- 排版微调（P0-4：字号颜色可调）----------
   之前 11 套主题的字号/颜色是写死在各自 CSS 里的，界面只能换整套主题，
   调不了单篇。2026-09-30 把它们全改成 CSS 变量（--fs/--lh/--fc/--ac），
   控件改这几个变量就能生效。
   这些值存在 project.tune 里，跟着稿件走，不跟主题走。 */
/* 微调默认值。字号 17 / 行距 2.0 是按中老年读者定的 ——
   用户原话「你文字可以适当大一号或者半号左右」。
   15px 是给年轻人看的默认，17px 才是给读者的默认。 */
/* 「设为默认」：用户原话「你的配图、你的文章的写作风格、你的排版
   都可以选一个默认的，你得支持有那个选项」。
   存在 project.prefs 里，下次开新稿子就带着走。
   写进 project.json 同一个文件，不新增文件 —— 服务端只认那几张表。 */
const PREFS_KEY = 'prefs'

function prefs() {
  return (S.project && S.project[PREFS_KEY]) || {}
}

/* 用偏好里的默认值填上当前表单（只在用户没手动改过这一稿时） */
function applyPrefs() {
  const p = prefs()
  if (!Object.keys(p).length) return
  if (p.style && !S.project.style) S.project.style = p.style
  if (p.theme && !S.project.theme) S.project.theme = p.theme
  if (p.imgN && !S.project.imgN) S.project.imgN = p.imgN
}

/* 设默认必须【立刻】落盘，不能走 save()。
   save() 有 900ms 防抖，而 poll() 每 4 秒从服务端拉一次 state
   并整个覆盖 S —— 防抖期内改的值还没进磁盘，就被服务端的旧值冲掉了。
   实测：点「设为默认」之后 prefs 读出来是空的，按钮永远显示未选中。 */
function setPref(k, v) {
  S.project[PREFS_KEY] = { ...prefs(), [k]: v }
  markDirty('project')
  api('/save', { name: 'project', data: S.project })
    .then(() => toast('已设为默认，新稿子会自动带着走', 'ok'))
    .catch(e => toast('没能存上：' + (e.message || '未知错误'), 'err'))
}

/* 风格清单。
   之前 app.js 里有三份手抄的风格名（风格下拉、任务词、验收测试），
   加新风格要改三处，漏一处就出现「下拉里有、任务词里没有」这种对不上的 bug。
   收成一处，服务端 styles.mjs 是另一份 —— 那份是判据，必须独立存在，
   但名字要靠 styleNames() 断言对齐。 */
const STYLE_LIST = [
  ['warm', '有温度（默认）· 感性 · 从人性看'],
  ['auto', '你判断 · 我按稿子自己定'],
  ['person', '人物特稿 · 贴着一个人写'],
  ['story', '故事叙事 · 有场景有转折'],
  ['talk', '口语闲谈 · 像跟人聊天'],
  ['sharp', '犀利时评 · 有立场有锋芒'],
  ['crit', '批评评论 · 对事不对人'],
  ['explain', '硬核拆解 · 把机制讲透'],
  ['biz', '商业观察 · 看钱和激励'],
  ['news', '新闻快评 · 事实为主'],
  ['cold', '冷静收束 · 只呈现不下判断']
]
const STYLE_CN = Object.fromEntries(STYLE_LIST)

const TUNE_DEF = { fs: 17, lh: 2, fsb: 10, fc: '#111111', ac: '#c0392b', bg: '#ffffff' }
function tune() {
  const t = (S.project && S.project.tune) || {}
  return { ...TUNE_DEF, ...t }
}
/* 只把用户真调过的项写进 CSS，未调的沿用主题默认 */
function tuneVars() {
  const t = (S.project && S.project.tune) || {}
  const out = []
  if (t.fs) out.push('--fs:' + Number(t.fs) + 'px')
  if (t.lh) out.push('--lh:' + Number(t.lh))
  if (t.fsb != null) out.push('--fsb:' + Number(t.fsb) + 'px')
  if (t.fc) out.push('--fc:' + t.fc)
  if (t.ac) out.push('--ac:' + t.ac)
  if (t.bg) out.push('--paper:' + t.bg)   // 不能叫 --bg，会和应用自己的 --bg 撞
  return out.join(';')
}
/* 字号档位。读者是中老年人，原来的 13~22 里 13/14 实际看不清，
   下限从 15 起。默认给到 17（一号半）—— 用户原话
   「你文字可以适当大一号或者半号左右」。 */
const FS_STEPS = [15, 16, 17, 18, 19, 20, 21, 22, 24]
/* 行距。老年人行距要松，1.5 太挤，下限提到 1.75。 */
const LH_STEPS = [1.75, 1.9, 2, 2.1, 2.25, 2.4]
/* 段间距。用户明说「所有排版都应该没有那个段前空行」，
   所以给 0 在最前面，让「不要空行」是一档就能选到的默认附近。 */
const FSB_STEPS = [0, 6, 10, 14, 20, 28]

function renderTunePanel() {
  const t = tune()
  const cur = S.themes.find(x => x.id === (S.project.theme || 'classic')) || {}
  const isFs = FS_STEPS.includes(Number(t.fs))
  const isLh = LH_STEPS.includes(Number(t.lh))
  return `
  <div class="tune-grid">
    <div class="tune-row">
      <label>正文字号</label>
      <div class="tune-btns">
        ${FS_STEPS.map(v => `<button class="tune-b ${String(v) === String(t.fs) ? 'on' : ''}"
          data-act="tune" data-arg="fs" data-val="${v}" title="${v}px">${v}</button>`).join('')}
      </div>
      <span class="tune-val">${isFs ? t.fs + 'px' : t.fs + 'px（自定义）'}</span>
    </div>
    <div class="tune-row">
      <label>行距</label>
      <div class="tune-btns">
        ${LH_STEPS.map(v => `<button class="tune-b ${String(v) === String(t.lh) ? 'on' : ''}"
          data-act="tune" data-arg="lh" data-val="${v}">${v}</button>`).join('')}
      </div>
      <span class="tune-val">${isLh ? t.lh : t.lh + '（自定义）'}</span>
    </div>
    <div class="tune-row">
      <label>段间距</label>
      <div class="tune-btns">
        ${FSB_STEPS.map(v => `<button class="tune-b ${String(v) === String(t.fsb) ? 'on' : ''}"
          data-act="tune" data-arg="fsb" data-val="${v}">${v}</button>`).join('')}
      </div>
      <span class="tune-val">${t.fsb}px</span>
    </div>
    <div class="tune-row">
      <label>文字颜色</label>
      <div class="tune-colors">
        ${['#000000','#333333','#1a1a1a','#4a4a4a','#5f5f5f','#8c2f2f'].map(c =>
          `<button class="tune-c ${t.fc === c ? 'on' : ''}" style="background:${c}"
            data-act="tune" data-arg="fc" data-val="${c}" title="${c}"></button>`).join('')}
        <input type="color" value="${t.fc}" data-act="tuneInput" data-arg="fc" class="tune-pick">
      </div>
    </div>
    <div class="tune-row">
      <label>强调色</label>
      <div class="tune-colors">
        ${['#07c160','#1c4ed8','#8c2f2f','#b8860b','#0f766e','#3b5bdb'].map(c =>
          `<button class="tune-c ${t.ac === c ? 'on' : ''}" style="background:${c}"
            data-act="tune" data-arg="ac" data-val="${c}" title="${c}"></button>`).join('')}
        <input type="color" value="${t.ac}" data-act="tuneInput" data-arg="ac" class="tune-pick">
      </div>
    </div>
    <div class="tune-row">
      <label>纸底色</label>
      <div class="tune-colors">
        ${['#ffffff','#fffdf9','#f7f3ec','#f2ede3','#fafafa','#1c1a17'].map(c =>
          `<button class="tune-c ${t.bg === c ? 'on' : ''}" style="background:${c}"
            data-act="tune" data-arg="bg" data-val="${c}" title="${c}"></button>`).join('')}
        <input type="color" value="${t.bg}" data-act="tuneInput" data-arg="bg" class="tune-pick">
      </div>
    </div>
    <button class="btn ghost sm block" data-act="tuneReset">恢复这套主题的默认排版</button>
    <div class="tune-note">${esc(cur.tag || '')}</div>
  </div>`
}


async function renderShip() {
  const themes = S.themes || []
  const cur = S.project.theme || 'classic'
  const el = $('#p-ship')
  if (!el) return
  el.innerHTML = `
  <div class="ship-wrap">
    <!-- 第一栏：选哪一套排版 -->
    <aside class="ship-col ship-ctl">
      <div class="ship-sec">
        <div class="ship-sec-h">排版主题<span>${themes.length} 套</span></div>
        <div class="theme-list">
          ${themes.map(t => `<button class="theme-row ${t.id===cur?'on':''}" data-act="setTheme" data-arg="${t.id}">
            <i class="sw" style="background:${t.preview.bg};border-color:${t.preview.ac}"></i>
            <span class="tn">
              <b>${esc(t.n)}</b>
              <em>${esc(t.tag)}</em>
            </span>
          </button>`).join('')}
        </div>
        <button class="btn ghost sm block" style="margin-top:8px" data-act="cmpWith">并排对比两套</button>
        <button class="pref-btn ${prefs().theme === cur ? 'on' : ''}" data-act="prefTheme"
          title="把这套排版设为以后新稿子的默认">
          ${prefs().theme === cur ? '✓ 已设为默认排版' : '把这套设为默认排版'}
        </button>
      </div>

      <div class="ship-sec">
        <div class="ship-sec-h">预览宽度<span id="w-readout"></span></div>
        <div class="seg seg-sm">
          ${WIDTHS.map(x => `<button class="seg-b ${shipWidth===x.w?'on':''}" data-act="shipWidth" data-arg="${x.w}">${x.n}</button>`).join('')}
        </div>
      </div>

      <div class="ship-sec">
        <div class="ship-sec-h">文章信息</div>
        <div class="field">
          <label>公众号摘要 <span class="opt">列表页显示</span></label>
          <textarea id="abs" rows="2" placeholder="一句话说清讲什么">${esc(S.project.abstract || '')}</textarea>
        </div>
        <div class="field">
          <label>文末备注</label>
          <input class="input" id="foot" value="${esc(S.project.foot || '')}" placeholder="例：数据据公开报道整理">
        </div>
      </div>

      <div class="ship-sec">
        <div class="ship-sec-h">发布</div>
        ${renderShipAssist()}
      </div>
    </aside>

    <!-- 第二栏：微调。独立成栏是为了「改一处，右边立刻变」 -->
    <aside class="ship-col ship-tune">
      <div class="ship-sec">
        <div class="ship-sec-h">排版微调<span>改单篇，不改主题</span></div>
        ${renderTunePanel()}
      </div>
    </aside>

    <div class="ship-main">
      <div class="paper-shell" style="width:${shipWidth}px;max-width:100%" id="paper">
        <div class="preview-paper">
          <div class="preview-body" id="pv"><div class="empty"><div class="ico">▤</div>正在生成预览…</div></div>
        </div>
      </div>
    </div>

    <div id="cmp-box" style="display:none"></div>
  </div>`
  refreshShip()
  measurePaper()
}

/* 把微调值注入预览。走 CSS 变量，不重排版内核 ——
   改字号/颜色不该触发一次 markdown 重新渲染，代价大且会闪。
   主题默认值已经由 scopeCss 挂到 .paper-shell 上，这里只覆盖用户调过的项。 */
function applyTune() {
  const vars = tuneVars()
  let st = document.querySelector('style[data-for="tune"]')
  if (!vars) { if (st) st.remove(); return }
  if (!st) { st = document.createElement('style'); st.dataset.for = 'tune'; document.head.appendChild(st) }
  // 挂在 .paper-shell 上（和主题默认同一处），后面的规则覆盖前面的
  st.textContent = `.paper-shell{${vars}}`
}

/* 纸面宽度会被可用空间夹住：选 760 但窗口只有 431 的位置时，
   实际就是 431。必须把真实宽度写出来，否则「点了没反应」。 */
function measurePaper() {
  const paper = $('#paper'), out = $('#w-readout')
  if (!paper || !out) return
  const real = Math.round(paper.getBoundingClientRect().width)
  out.textContent = real < shipWidth ? `实际 ${real}px（放不下 ${shipWidth}）` : `实际 ${real}px`
  if (window.__shipRO) window.__shipRO.disconnect()
  window.__shipRO = new ResizeObserver(() => {
    const r = Math.round(paper.getBoundingClientRect().width)
    out.textContent = r < shipWidth ? `实际 ${r}px（放不下 ${shipWidth}）` : `实际 ${r}px`
  })
  window.__shipRO.observe(paper)
}

/* 预览请求的序号。
   用户报「预览显示的是上一篇文章」，真因在这里：
   refreshShip 是异步的，而请求发出时并没有任何东西记录
   「这是第几次请求」。用户连着改正文、换主题，就会有两个请求在飞；
   网络上先发的可能后到，一回来就把新内容覆盖成旧内容。

   现在每次发请求先领一个号，回来先核对号对不对，
   对不上就整份丢掉，绝不写进 DOM。
   附带好处：正文在请求期间又变了，这次结果也是过期的，一并作废。 */
let shipSeq = 0

function refreshShip(force) {
  if (!shipOn) return
  clearTimeout(shipTimer)
  shipTimer = setTimeout(async () => {
    const pv = $('#pv')
    // DOM 还没渲染出来（刚切页/刚换主题），缓存一律作废
    const empty = !pv || pv.querySelector('.empty')
    const key = JSON.stringify([S.body, S.project.theme, S.project.abstract, S.project.foot, S.images])
    if (!force && !empty && key === shipCache) return

    /* 领号，并把这一次的输入快照下来。
       回来时两样都要核对 —— 序号对得上但正文已经又变了，也得作废。 */
    const seq = ++shipSeq
    const snapKey = key

    try {
      const r = await api('/preview', { text: S.body, theme: S.project.theme, images: S.images })

      // 过期响应：直接丢掉，绝不碰 DOM
      if (seq !== shipSeq) return
      const keyNow = JSON.stringify([S.body, S.project.theme, S.project.abstract, S.project.foot, S.images])
      if (keyNow !== snapKey) { refreshShip(); return }

      shipCache = snapKey

      const pv2 = $('#pv')
      if (!pv2) return
      // 换主题时把上一次的 <style> 撤掉，否则越积越多
      $$('style[data-for="ship"]').forEach(n => n.remove())
      const st = document.createElement('style')
      st.dataset.for = 'ship'
      st.textContent = scopeCss(r.css, '.paper-shell')
      document.head.appendChild(st)
      pv2.innerHTML = (S.project.abstract ? `<p class="pv-abs" style="font-size:13.5px;line-height:1.85;color:#999;margin:0 0 28px;padding-bottom:14px;border-bottom:1px solid #eee">${esc(S.project.abstract)}</p>` : '') + r.html
      const paper = pv2.closest('.preview-paper')
      if (paper) paper.setAttribute('data-theme', S.project.theme || 'classic')
      // 换主题会重建 style，微调值要重新盖上去
      applyTune()
    } catch (e) {
      if (seq !== shipSeq) return
      const pv3 = $('#pv')
      if (pv3) pv3.innerHTML = `<div class="empty"><div class="ico">⚠</div>预览失败：${esc(e.message)}</div>`
    }
  }, 260)
}

/* ---------- 事实清单：按「写错了会怎样」分级 ----------
   判据只看一件事：这条错了，读者会不会当场发现，或整篇跟着塌。
   高危 = 精确数字 / 直接引语 / 因果归因（错了会被抓出来）
   中等 = 日期 / 量级 / 机构名（错了读者难察觉，但会累积成硬伤）
   低危 = 人名 / 泛指（错了影响小） */
function factRisk(f) {
  const v = String(f.value || '')
  const k = String(f.kind || '')
  const ctx = String(f.ctx || '')
  if (/[「"]/.test(ctx) || /说|表示|称|回应|辟谣/.test(ctx)) return { lv: 'hi', n: '直接引语' }
  if (/\d+\.\d+/.test(v)) return { lv: 'hi', n: '精确小数' }
  if (/(亿|万条|万个|万人|万家|万|亿|%|倍|元|吨)/.test(v)) return { lv: 'hi', n: '精确数字' }
  if (/(因为|所以|导致|因此|正是由于|根源)/.test(ctx)) return { lv: 'hi', n: '因果归因' }
  if (/^\d{4}\s*年|^\d{1,2}\s*月|^\d{1,2}\s*日/.test(v) || k === 'date') return { lv: 'md', n: '日期' }
  if (/(协会|委员会|中心|部|局|通报|条例|办法|规定)/.test(v + ctx)) return { lv: 'md', n: '机构/文件' }
  if (k === 'name') return { lv: 'lo', n: '人名' }
  if (k === 'org') return { lv: 'lo', n: '机构' }
  return { lv: 'lo', n: '一般陈述' }
}
/* ================= 版本对比 =================
   解决「改东边坏西边」：改之前先看清到底动了哪几段。
   做法是段落级 LCS，逐段标出 增 / 删 / 改，并做字数与配图守恒检查。 */

function splitParas(md) {
  return String(md || '').split(/\n{2,}/).map(s => s.trim()).filter(Boolean)
}

/** 极简 LCS：返回对齐后的 [旧,新] 行对数组 */
function lcsPairs(a, b) {
  const n = a.length, m = b.length
  // 段落数可能上百，用滚动数组控制内存
  const dp = Array.from({ length: n + 1 }, () => new Int32Array(m + 1))
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1])
    }
  }
  const out = []
  let i = 0, j = 0
  while (i < n && j < m) {
    if (a[i] === b[j]) { out.push(['=', a[i], b[j]]); i++; j++ }
    else if (dp[i + 1][j] >= dp[i][j + 1]) { out.push(['-', a[i], '']); i++ }
    else { out.push(['+', '', b[j]]); j++ }
  }
  while (i < n) out.push(['-', a[i], '']), i++
  while (j < m) out.push(['+', '', b[j]]), j++
  return out
}

const imgCount = t => (String(t).match(/!\[[^\]]*\]\([^)]+\)/g) || []).length
const charCount = t => String(t).replace(/!\[[^\]]*\]\([^)]+\)/g, '').replace(/\s+/g, '').length

/** 渲染某版本与当前正文的差异 */
async function showVersionDiff(id) {
  const box = $('#ver-cmp')
  if (!box) return
  const v = (S.versions || []).find(x => x.id === id)
  if (!v) return
  box.innerHTML = `<div class="card" style="margin-top:16px"><div class="card-body"><div class="empty"><div class="ico">▤</div>读取中…</div></div></div>`
  let old
  try {
    const r = await api('/version/read', { id })
    old = r.text || r.body || ''
  } catch (e) {
    box.innerHTML = `<div class="card" style="margin-top:16px"><div class="card-body"><div class="empty"><div class="ico">⚠</div>读取失败：${esc(e.message)}</div></div></div>`
    return
  }
  const A = splitParas(old), B = splitParas(S.body)
  const pairs = lcsPairs(A, B)
  const added = pairs.filter(p => p[0] === '+').length
  const removed = pairs.filter(p => p[0] === '-').length
  const kept = pairs.filter(p => p[0] === '=').length
  const changed = pairs.filter(p => p[0] === '=' && p[1] !== p[2]).length

  // 守恒检查：配图和字数有没有被改坏
  const checks = [
    { n: '配图', a: imgCount(old), b: imgCount(S.body) },
    { n: '字数', a: charCount(old), b: charCount(S.body) },
    { n: '段落', a: A.length, b: B.length }
  ]
  const lostImg = imgCount(old) > imgCount(S.body)

  box.innerHTML = `
  <div class="card" style="margin-top:16px">
    <div class="card-head"><h3>对比：${esc(v.label)} → 当前</h3><span class="sp"></span>
      <span class="hint">${esc(v.at)}</span></div>
    <div class="card-body">
      <div class="stats" style="margin-bottom:16px">
        <div class="stat good"><div class="v">${kept - changed}</div><div class="l">未动段落</div></div>
        <div class="stat warn"><div class="v">${changed}</div><div class="l">被修改</div></div>
        <div class="stat ${added ? '' : 'good'}"><div class="v">${added}</div><div class="l">新增</div></div>
        <div class="stat ${removed ? 'bad' : 'good'}"><div class="v">${removed}</div><div class="l">删除</div></div>
      </div>

      ${lostImg ? `<div class="note warn" style="margin:0 0 14px">
        <b>这一版图片更多（${imgCount(old)} 张 vs 现在 ${imgCount(S.body)} 张）。</b>
        载入旧版会找回这些图。如果你没打算删图，说明中间某次改稿把图弄丢了。
      </div>` : ''}

      <div class="row wrap" style="gap:8px;margin-bottom:14px">
        ${checks.map(c => `<span class="chip ${c.a === c.b ? '' : 'warn'}">${c.n} ${c.a} → ${c.b}</span>`).join('')}
        <span class="sp" style="flex:1"></span>
        <button class="btn ghost sm" data-act="closeDiff">收起</button>
        <button class="btn brand sm" data-act="restore" data-arg="${v.id}">回滚到这一版</button>
      </div>

      <div class="diff">
        ${pairs.map(p => {
          if (p[0] === '=') return p[1] === p[2]
            ? `<div class="d-same">${esc(p[2].slice(0, 120))}${p[2].length > 120 ? '…' : ''}</div>`
            : `<div class="d-mod"><div class="d-old">${esc(p[1])}</div><div class="d-new">${esc(p[2])}</div></div>`
          if (p[0] === '-') return `<div class="d-del">${esc(p[1])}</div>`
          return `<div class="d-add">${esc(p[2])}</div>`
        }).join('')}
      </div>
    </div>
  </div>`
  box.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
}

/* ================= 复制到公众号：图片与样式都要活着 =================
   三个必须解决的问题：
   1. 公众号粘贴会丢弃 <style> 标签 → 主题样式必须全部转成内联 style 属性
   2. 公众号拒绝外链图片（file:// 和 http 都会被剥掉）→ 图片内联成 base64
   3. base64 太大剪贴板会拒收 → 加体积闸门 + 打包兜底
   ================================================================ */

/* ================= 配图：推荐插入位置 + 批量插入 =================
   现实问题：图片库有 20 张，正文只用了 4 张。手动插是体力活。
   这里按段落语义与位置分布排出候选位置，你一键采纳。 */

let imgPlan = []

/** 给每个正文段落打分，看它适不适合插图 */
function scorePara(text, idx, total) {
  const t = String(text || '')
  if (!t) return -1
  if (/^!\[/.test(t.trim())) return -1                           // 已有图
  if (/^#{1,6}\s/.test(t.trim())) return idx <= 1 ? 40 : -1      // 大标题之后适合放图
  let s = 0
  const rel = idx / Math.max(1, total)
  if (rel < 0.08 || rel > 0.94) s -= 25                          // 开头结尾别塞图
  const len = t.replace(/\s/g, '').length
  if (len < 40) s -= 20
  else if (len > 320) s += 12
  else s += 18
  // 出现具体名词/场景的段落最需要图
  if (/(公司|工厂|车间|发布会|现场|照片|截图|图表|数据|报告|大楼|总部|产线|工地|办公室|展会|芯片|电池|光伏|电站|机型|门店)/.test(t)) s += 20
  if (/^(我们认为|需要指出|换句话说|问题在于|总的来说)/.test(t.trim())) s -= 18
  if (/\d{2,}/.test(t)) s += 6
  return s
}

function buildImgPlan() {
  const imgs = S.images || []
  const refs = new Set(bodyImages())
  const unused = imgs.filter(x => !refs.has(x.file))
  if (!unused.length) return []
  const paras = splitParas(S.body)
  const scored = paras
    .map((p, i) => ({ i, text: p, s: scorePara(p, i, paras.length) }))
    .filter(x => x.s > 0)
    .sort((a, b) => b.s - a.s)
  const chosen = []
  for (const c of scored) {
    if (chosen.length >= unused.length) break
    if (chosen.some(x => Math.abs(x.i - c.i) < 2)) continue   // 避免图扎堆
    chosen.push(c)
  }
  return chosen.slice(0, Math.min(8, unused.length)).map((c, k) => ({
    img: unused[k], at: c.i, text: c.text, score: c.s
  }))
}

function suggestImages() {
  imgPlan = buildImgPlan()
  const box = $('#img-plan')
  if (!box) return
  if (!imgPlan.length) {
    box.innerHTML = `<div class="note" style="margin:0">没有待插入的图片，或正文太短、找不到合适位置。</div>`
    return
  }
  box.innerHTML = `
    <div class="card-head"><h3>推荐插入位置</h3><span class="sp"></span>
      <span class="hint">${imgPlan.length} 处建议　·　按段落语义与位置分布排的</span></div>
    <div class="card-body">
      ${imgPlan.map((p, k) => `
        <div class="plan">
          <img src="${esc(imgSrc(p.img.url || p.img.file))}" alt="" loading="lazy">
          <div class="pt">
            <div class="pl">插到第 <b>${p.at + 1}</b> 段之后</div>
            <div class="px">…${esc(p.text.slice(-46))}</div>
            <div class="pn">${esc(p.img.cap || p.img.file)}</div>
          </div>
          <button class="btn ghost sm" data-act="applyOne" data-arg="${k}">只插这张</button>
        </div>`).join('')}
      <div class="row wrap" style="margin-top:14px;gap:8px">
        <button class="btn brand" data-act="applyImgPlan">全部插入（${imgPlan.length} 张）</button>
        <button class="btn ghost" data-act="closePlan">先不改</button>
      </div>
    </div>`
}

function insertPlan(p) {
  const paras = splitParas(S.body)
  const at = Math.min(p.at + 1, paras.length)
  const line = p.img.cap ? `![${p.img.cap}](${p.img.file})` : `![](${p.img.file})`
  paras.splice(at, 0, line)
  S.body = paras.join('\n\n')
  markDirty('body')
}

async function applyImagePlan() {
  if (!imgPlan.length) return
  const n = imgPlan.length
  for (const p of imgPlan) insertPlan(p)
  await saveBody()
  toast(`已插入 ${n} 张图`, 'ok')
  const b = $('#img-plan')
  if (b) b.innerHTML = `<div class="note ok" style="margin:0">已插入 ${n} 张。去「发布」页复制时图片会自动带上。</div>`
}

async function applyOne(k) {
  const p = imgPlan[k]
  if (!p) return
  insertPlan(p)
  await saveBody()
  imgPlan.splice(k, 1)
  toast('已插入 1 张', 'ok')
  suggestImages()
}

async function saveBody() {
  bodyDirty = true
  try {
    await api('/save', { name: 'body', data: S.body })
    await poll(false)
  } catch (e) { toast(e.message, 'err') }
}

const INLINE_PROPS = [
  'font-size', 'font-weight', 'font-style', 'font-family', 'line-height',
  'letter-spacing', 'word-spacing', 'text-align', 'text-indent', 'text-decoration',
  'color', 'background-color',
  'margin-top', 'margin-right', 'margin-bottom', 'margin-left',
  'padding-top', 'padding-right', 'padding-bottom', 'padding-left',
  'border-top', 'border-right', 'border-bottom', 'border-left',
  'border-radius', 'border-collapse', 'width', 'max-width', 'height'
]

/** 把预览区的计算样式「烧」进克隆节点的 style 属性 */
function inlineComputed(src, dst) {
  const s = [...src.querySelectorAll('*')]
  const d = [...dst.querySelectorAll('*')]
  const n = Math.min(s.length, d.length)
  for (let i = 0; i < n; i++) {
    const cs = getComputedStyle(s[i])
    if (!cs) continue
    let css = ''
    for (const p of INLINE_PROPS) {
      const v = cs.getPropertyValue(p)
      // 注意：不能过滤 0px。主题 CSS 常常显式写 margin:0，
      // 丢掉之后浏览器默认样式会重新生效（段落间距全乱）。
      if (v && v !== 'normal' && v !== 'none' && v !== 'auto') {
        css += p.replace(/[A-Z]/g, c => '-' + c.toLowerCase()) + ':' + v + ';'
      }
    }
    // 保留已有的内联样式（摘要那段本来就有）
    const inline = d[i].getAttribute('style')
    if (inline) css += inline.replace(/;\s*$/, '') + ';'
    if (css) d[i].setAttribute('style', css)
  }
  return dst
}

/* 图片 src 的唯一拼法。
   ★ 为什么要有这个函数：
     正文里写的是裸文件名（app.js 386 行给 AI 的提示、
     1284 行输入框的 placeholder 都是这个写法），
     而渲染时要补成 /data/images/<file>。

     之前是 1291 行裸拼 "/data/images/" + encodeURIComponent(f)。
     碰上正文里已经写了全路径的，就拼成
     /data/images/%2Fdata%2Fimages%2Fxxx.jpg → 裂图。

     ★ 更要紧的是它掩盖了一个约定：
       约定只写在提示词里，没写在任何断言里，
       所以写错了要等到图裂了才知道。
       现在既有这个函数，也有验收断言。 */
function imgSrc(f) {
  const s = String(f || '')
  if (/^(https?:)?\/\//.test(s) || s.startsWith('data:')) return s
  return '/data/images/' + encodeURIComponent(s.replace(/^\/data\/images\//, ''))
}

function bodyImages() {
  return [...new Set((S.body || '').match(/^!\[.*\]\(([^)]+)\)$/gm)?.map(l => l.replace(/^!\[.*\]\((.*)\)$/, '$1')) || [])]
}

/** 构建「可直接粘进公众号」的 HTML：样式内联 + 图片 base64 */
async function buildWechatHtml(onProgress) {
  const pv = $('#pv')
  if (!pv) throw new Error('预览还没生成')

  const files = bodyImages()
  // 先量体积，超闸就提前拦下，别等剪贴板拒收
  let bytes = 0
  onProgress && onProgress('正在读取图片…', 0)
  const dataUris = {}
  for (let i = 0; i < files.length; i++) {
    const f = files[i]
    if (/^https?:/i.test(f)) { dataUris[f] = f; continue }   // 远程图原样保留（用户自己处理）
    const r = await api('/img-b64', { file: f })
    dataUris[f] = r.dataUri
    bytes += r.kb * 1024
    onProgress && onProgress(`图片 ${i + 1}/${files.length}`, (i + 1) / files.length)
  }
  return { files, dataUris, bytes }
}

async function copyShip() {
  const pv = $('#pv')
  if (!pv) return
  if (!S.body || !S.body.trim()) return toast('正文是空的', 'warn')

  // 复制时按钮要给反馈，但它是 async 的，禁用 + 改文案最直观
  const btn = $('[data-act="copyShip"]')
  const old = btn ? btn.textContent : ''
  const setTxt = t => { if (btn) { btn.textContent = t; btn.disabled = true } }

  try {
    setTxt('正在准备…')
    const { files, dataUris, bytes } = await buildWechatHtml((msg, pct) => {
      setTxt(pct > 0 ? `内联图片 ${Math.round(pct * 100)}%` : msg)
    })

    const LIMIT = 12 * 1024 * 1024
    if (bytes > LIMIT) {
      if (btn) { btn.textContent = old; btn.disabled = false }
      return showTooBig(bytes, LIMIT, files)
    }

    // 样式内联
    const clone = pv.cloneNode(true)
    clone.querySelectorAll('style').forEach(s => s.remove())
    inlineComputed(pv, clone)

    // 图片换 base64
    let done = 0
    for (const im of clone.querySelectorAll('img')) {
      const src = im.getAttribute('src') || ''
      const file = decodeURIComponent(src.split('/').pop().split('?')[0].split('#')[0])
      if (dataUris[file]) { im.setAttribute('src', dataUris[file]); done++ }
    }

    const html = clone.innerHTML
    const text = clone.textContent || S.body
    await writeClipboard(html, text)

    if (btn) { btn.textContent = old; btn.disabled = false }
    publishLog(files.length, done, bytes, 'clipboard')
    /* 提示只说一件事：现在该去哪。
       技术细节（几张图内联、样式转内联）放在 publishLog 里，不塞进 toast ——
       用户要的是「粘到哪」，不是「我怎么处理的」。 */
    toast('已复制 —— 回到 AI 对话工具，粘贴发送', 'ok')
  } catch (e) {
    if (btn) { btn.textContent = old; btn.disabled = false }
    toast('复制失败：' + e.message, 'err')
  }
}

/** 富文本写剪贴板；Clipboard API 不可用时退回 execCommand */
async function writeClipboard(html, text) {
  if (window.ClipboardItem && navigator.clipboard?.write) {
    try {
      await navigator.clipboard.write([new ClipboardItem({
        'text/html': new Blob([html], { type: 'text/html' }),
        'text/plain': new Blob([text], { type: 'text/plain' })
      })])
      return
    } catch (e) { /* 体积或权限问题，走兜底 */ }
  }
  const box = document.createElement('div')
  box.contentEditable = 'true'
  box.style.cssText = 'position:fixed;left:-99999px;top:0;opacity:0'
  box.innerHTML = html
  document.body.appendChild(box)
  const r = document.createRange(); r.selectNodeContents(box)
  const s = getSelection(); s.removeAllRanges(); s.addRange(r)
  let ok = false
  try { ok = document.execCommand('copy') } catch (e) {}
  s.removeAllRanges()
  box.remove()
  if (!ok) throw new Error('浏览器拒绝了剪贴板写入，请用「下载图片包」方案')
}

/** 体积超闸：给出明确出路，不能只说一句"太大了" */
function showTooBig(bytes, limit, files) {
  const mb = (bytes / 1048576).toFixed(1)
  toast(`图片共 ${mb}MB，超过剪贴板 ${(limit / 1048576).toFixed(0)}MB 上限。已改用打包方案。`, 'warn')
  const box = $('#ship-assist')
  if (box) box.scrollIntoView({ behavior: 'smooth', block: 'center' })
  packImages()
}

/** 一键打包：编号图 + 插图位置清单，发布时照着放 */
async function packImages() {
  const files = bodyImages().filter(f => !/^https?:/i.test(f))
  if (!files.length) return toast('正文里没有本地图片', 'warn')
  const title = (S.project.title || '文章').slice(0, 30)
  const lines = [`《${title}》插图位置清单`, `共 ${files.length} 张，按正文出现顺序编号。`, `复制正文后，按编号在公众号后台对应位置插入图片。`, '']
  // 找出每张图前面的上文，作为定位线索
  const blocks = (S.body || '').split(/\n{2,}/)
  let idx = 0
  for (const b of blocks) {
    const m = b.match(/^!\[([^\]]*)\]\(([^)]+)\)$/m)
    if (!m) continue
    const f = m[2]
    if (/^https?:/i.test(f)) continue
    const cap = m[1] || '（无图注）'
    const ctx = b.replace(/^!\[.*\]\(.*\)$/gm, '').trim().slice(-40)
    lines.push(`${String(++idx).padStart(2, '0')}. ${files.indexOf(f) >= 0 ? files.indexOf(f) + 1 : idx} 号图` +
      `\n    图注：${cap}` + (ctx ? `\n    位置：紧接在「…${ctx}」之后` : ''))
  }
  lines.push('', '—— 粘贴时如果图片丢了，说明公众号吞了外链图，按本清单手动上传即可。')
  try {
    const r = await fetch('/api/pack', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ files, manifest: lines.join('\n') })
    })
    if (!r.ok) throw new Error('HTTP ' + r.status)
    const blob = await r.blob()
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = title + '-图片包.zip'
    document.body.appendChild(a); a.click(); a.remove()
    setTimeout(() => URL.revokeObjectURL(a.href), 8000)
    publishLog(files.length, 0, 0, 'pack')
    toast(`图片包已下载：${files.length} 张，带插图位置清单`, 'ok')
  } catch (e) {
    toast('打包失败：' + e.message, 'err')
  }
}

function publishLog(n, inlined, bytes, how) {
  const box = $('#ship-log')
  if (!box) return
  const mb = (bytes / 1048576).toFixed(1)
  box.innerHTML = `
    <div class="note ${how === 'clipboard' ? 'ok' : 'brand'}" style="margin-top:12px">
      ${how === 'clipboard'
        ? `剪贴板已就绪　·　<b>${inlined}</b>/${n} 张图已内联${bytes ? '，' + mb + 'MB' : ''}　·　样式已全部转为内联`
        : `图片包已下载　·　<b>${n}</b> 张图带编号，内含插图位置清单`}
    </div>`
}

function renderShipAssist() {
  const files = bodyImages()
  const local = files.filter(f => !/^https?:/i.test(f))
  const remote = files.filter(f => /^https?:/i.test(f))
  return `
  <div id="ship-assist">
    <button class="btn brand block" data-act="copyShip">复制到公众号（含图）</button>
    <div class="row" style="gap:8px;margin-top:8px">
      <button class="btn ghost sm" style="flex:1" data-act="copyTitle">复制标题</button>
      <button class="btn ghost sm" style="flex:1" data-act="copyAbs">复制摘要</button>
    </div>
    <div id="ship-log"></div>
    <details class="acc" style="margin-top:12px">
      <summary>图片丢了怎么办</summary>
      <div class="in">
        <p style="margin:0 0 10px">复制时图片已内联成 base64，多数情况能直接粘进去。
        如果公众号仍然吞掉了图片，下载编号图和位置清单，按位置手动放一次，两分钟内搞定。</p>
        <button class="btn ghost sm block" data-act="packImages">下载图片包 + 位置清单</button>
        ${remote.length ? `<div class="note warn" style="margin:10px 0 0">
          正文里有 <b>${remote.length}</b> 张外链图，公众号一定会剥掉，建议先在成稿页下载到本地。
        </div>` : ''}
        <div style="font-size:var(--fs-meta);color:var(--ink-4);margin-top:10px">
          本地图 ${local.length} 张${remote.length ? ' · 外链图 ' + remote.length + ' 张' : ''}
        </div>
      </div>
    </details>
  </div>`
}

/* ---------- 热点榜（渲染在选题页的「实时热点」tab 里） ---------- */
let HOT = null, hotSrc = 'all', hotSel = null, hotLoading = false

function skeletonHot() {
  return `<div class="card"><div class="card-body"><div class="empty"><div class="ico">♨</div>正在拉取实时榜单，最多等 12 秒…</div></div></div>`
}

async function loadHot(force) {
  hotLoading = true
  try {
    HOT = await api('/hot' + (force ? '?force=1' : ''))
  } catch (e) {
    HOT = { sources: [], total: 0, error: e.message }
  }
  hotLoading = false
  if (ideaTab === 'hot') paintHot()
}

function paintHot() {
  const el = $('#idea-pane')
  if (!el) return
  if (!HOT || HOT.error) {
    el.innerHTML = `<div class="card"><div class="card-body"><div class="empty"><div class="ico">⚠</div>${esc(HOT?.error || '拉取失败')}
      <div style="margin-top:14px"><button class="btn brand sm" data-act="reloadHot">重试</button></div></div></div></div>`
    return
  }
  const srcs = HOT.sources || []
  const live = srcs.filter(s => s.ok)
  const dead = srcs.filter(s => !s.ok)
  // 汇总：跨平台同时出现的排前面（说明是全网热点）
  const all = hotBag(srcs)
  const cross = all.filter(x => x.from.length > 1).length
  const list = hotSrc === 'all' ? all : (live.find(s => s.id === hotSrc)?.items || [])

  el.innerHTML = `
    <div class="hot-bar">
      <div class="hot-stat">
        <b>${live.length}</b><span>个平台在线</span>
      </div>
      <div class="hot-stat">
        <b>${HOT.total}</b><span>条实时热点</span>
      </div>
      <div class="hot-stat">
        <b>${all.length}</b><span>条去重后热点</span>
      </div>
      <div class="hot-stat" title="多个平台同时上榜，通常意味着全网级热点">
        <b style="${cross ? '' : 'color:var(--ink-3)'}">${cross || '—'}</b>
        <span>条跨平台上榜</span>
      </div>
      <span class="sp" style="flex:1"></span>
      <span class="hint">${new Date(HOT.at).toLocaleTimeString('zh-CN', { hour12: false })} 更新</span>
      <button class="btn brand sm" data-act="reloadHot" ${hotLoading ? 'disabled' : ''}>${hotLoading ? '刷新中…' : '刷新榜单'}</button>
    </div>

    ${dead.length ? `<div class="note warn" style="margin-bottom:14px">
      ${dead.length} 个平台当前抓不到（${dead.map(d => esc(d.name)).join('、')}）。
      这些平台有反爬或接口变更，不做绕过 —— 需要时手动去原站看。
    </div>` : ''}

    <!-- 常驻工作栏：平台切换 + 刷新，滚到哪都看得见 -->
    <div class="hot-bar-sticky">
      <div class="hot-tabs">
        <button class="hot-tab ${hotSrc==='all'?'on':''}" data-act="hotSrc" data-arg="all">全部汇总</button>
        ${live.map(s => `<button class="hot-tab ${hotSrc===s.id?'on':''}" data-act="hotSrc" data-arg="${s.id}">
          <i style="background:hsl(${s.hue} 70% 55%)">${esc(s.short)}</i>${esc(s.name)}<em>${s.count}</em>
        </button>`).join('')}
      </div>
      <div class="hot-bar-right">
        <span class="hint">${new Date(HOT.at).toLocaleTimeString('zh-CN', { hour12: false })} 更新</span>
        <button class="btn ghost sm" data-act="reloadHot" ${hotLoading ? 'disabled' : ''}>${hotLoading ? '刷新中…' : '刷新'}</button>
        <button class="btn brand sm" data-go="idea">去定题 →</button>
      </div>
    </div>

    <div class="hot-grid">
      <div class="card">
        <div class="card-head"><h3>${hotSrc==='all'?'跨平台汇总':esc(live.find(s=>s.id===hotSrc)?.name||'')}</h3>
          <span class="sp"></span><span class="hint">${list.length} 条</span></div>
        <div class="card-body" style="padding:0">
          <div class="hot-list" id="hot-list">
            ${list.map((it, i) => `
              <div class="hot-item ${hotSel === i ? 'sel' : ''}" data-act="hotPick" data-arg="${i}">
                <span class="rk ${it.rank<=3?'top':''}">${hotSrc==='all'?(it.from.length+'源'):it.rank}</span>
                <div class="tx">
                  <div class="ti">${esc(it.title)}</div>
                  ${hotSrc==='all'?`<div class="fr">${it.from.map(f=>`<em>${esc(f)}</em>`).join('')}</div>`:
                    (it.extra?`<div class="fr"><em>${esc(it.extra)}</em></div>`:'')}
                </div>
                ${it.heat?`<span class="ht">${fmtHeat(it.heat)}</span>`:''}
              </div>`).join('') || '<div class="empty">这个平台没数据</div>'}
          </div>
        </div>
      </div>

      <div class="card sticky-l">
        <div class="card-head"><h3>细节与操作</h3></div>
        <div class="card-body" id="hot-detail">${hotDetail()}</div>
      </div>
    </div>`
  paintHotDetail(list)
}

/* 跨平台比对：整条标题完全一致太严（同一件事各站措辞不同），
   去掉标点取前 14 字做键，能把「向人民英雄敬献花篮」这类合并掉。 */
function hotKey(t) {
  return String(t).replace(/[^一-龥a-zA-Z0-9]/g, '').slice(0, 14)
}
function hotBag(sources) {
  const bag = new Map()
  for (const s of (sources || []).filter(x => x.ok)) {
    for (const it of s.items) {
      const k = hotKey(it.title)
      if (!k) continue
      if (!bag.has(k)) bag.set(k, { ...it, from: [] })
      const b = bag.get(k)
      b.from.push(s.name)
      if (!b.url && it.url) b.url = it.url
    }
  }
  return [...bag.values()].sort((a, b) => b.from.length - a.from.length || a.rank - b.rank)
}

function hotDetail() {
  if (hotSel === null || hotSel === undefined) return `<div class="empty"><div class="ico">♨</div>点左边任意一条<br>这里会显示这条讲了什么</div>`
  const srcs = HOT.sources
  const list = hotSrc === 'all' ? hotBag(srcs) : (srcs.find(s => s.id === hotSrc)?.items || [])
  const it = list[hotSel]
  if (!it) return `<div class="empty">这条已经不在榜上了</div>`
  const cached = it.url ? peekCache[it.url] : null
  return `
    <div class="hot-d-title">${esc(it.title)}</div>
    <div class="row wrap" style="gap:6px;margin:10px 0 12px">
      ${it.from ? it.from.map(f => `<span class="chip">${esc(f)}</span>`).join('') : `<span class="chip">${esc(hotSrc === 'all' ? '' : (srcs.find(s => s.id === hotSrc)?.name || ''))}</span>`}
      ${it.heat ? `<span class="chip">热度 ${fmtHeat(it.heat)}</span>` : ''}
    </div>

    <!-- 摘要区：点条目就该看到「这条讲了什么」，不该再多点一次
         用户原话：「光看标题我也不知道什么内容啊，应该点击这标题，
         右侧啥地方能看到一个文字摘要才对呀」——所以默认就是展开的。 -->
    <div class="peek">
      <div class="peek-hd">
        <span>这条讲了什么</span>
        ${cached ? `<span class="peek-cnt">${cached.chars || cached.text.length} 字</span>` : ''}
      </div>
      <div class="peek-body" id="peek-box" data-k="${hotSel}"
           style="display:block">${
        /* 渲染顺序：已渲染过的 HTML → 抓到的正文 → 加载态。
           第一项是让重绘幂等的关键，见 peekHtml 的注释。 */
        (peekHtml[hotSel] != null)
          ? peekHtml[hotSel]
          : (cached ? renderPeek(cached, it)
                    : (it.url ? '<div class="peek-load">正在抓取原文…</div>'
                              : '<div class="peek-none">这条没有原文链接（榜单接口只给了标题），看不到摘要。</div>'))
      }</div>
      ${it.url ? `
        <div class="peek-ft">
          <button class="peek-btn" data-act="hotPeekF" data-arg="${hotSel}">
            <span class="lbl">重新抓取原文</span>
          </button>
          <a class="btn ghost sm" href="${esc(it.url)}" target="_blank" rel="noopener">读全文 ↗</a>
        </div>` : ''}
    </div>

    <div class="field" style="margin-top:14px">
      <label>切入角度 <span class="opt">选填</span></label>
      <textarea class="input" id="hot-angle" rows="3" placeholder="例：别复述事件，拆它背后的商业逻辑／站哪一边，为什么">${esc(hotSelAngle || '')}</textarea>
    </div>
    <div class="row wrap" style="gap:8px">
      <button class="btn brand sm" data-act="hotUse">用这个题</button>
      <button class="btn ghost sm" data-act="hotSave">存进我的选题</button>
    </div>
    <div class="note brand" style="margin-top:14px">
      角度<b>不填也能直接写</b>。填了只是多一条约束。
      热点只是<b>入口</b> —— 真正决定能不能写的，是你能给出别人没有的那个角度。
    </div>`
}

let hotSelAngle = ''

function paintHotDetail(list) {
  const box = $('#hot-detail')
  if (box) box.innerHTML = hotDetail()
  const ta = $('#hot-angle')
  if (ta) ta.oninput = deb(e => { hotSelAngle = e.target.value }, 400)
}

function fmtHeat(n) {
  if (n >= 1e8) return (n / 1e8).toFixed(1) + '亿'
  if (n >= 1e4) return (n / 1e4).toFixed(1) + '万'
  return String(n)
}

function curHotList() {
  if (!HOT) return []
  return hotSrc === 'all' ? hotBag(HOT.sources) : (HOT.sources.find(s => s.id === hotSrc)?.items || [])
}

/* 只在真拿到正文时调用。
   搜索页 / 空正文 / 抓取失败三种情况由 hotPeek 分别给不同提示，
   不在这里混着判 —— 之前混在一起，结果用户看到的永远是「正在抓取…」。 */
function renderPeek(d, it) {
  return `
    <div class="peek-title">${esc(d.title || it.title)}</div>
    <div class="peek-text">${esc(d.text)}</div>
    <div class="peek-foot">抓到 ${d.chars || d.text.length} 字${d.chars > 6000 ? '（只取前 6000）' : ''}</div>
    <a class="btn ghost sm block" href="${esc(it.url)}" target="_blank" rel="noopener">读全文 ↗</a>`
}

let ideaTab = 'hot'

/* ---------- 热点原文预览 ----------
   榜单里有大量「搜索结果页」而不是新闻正文（百度热搜点进去就是 m.baidu.com 搜索页），
   抓回来全是「笔记/视频/图片/资讯」这类导航词。抓不到就明说抓不到，
   不拿一堆噪音糊弄用户。
   声明放在文件顶部：Actions.hotPick / hotPeek 都要用，
   放在后面会撞 let 的暂时性死区。 */
let peekCache = {}

/* 已经渲染进摘要区的 HTML，键是条目下标。
   存在的唯一理由是让重绘幂等 —— poll() 每 4 秒触发 refresh()，
   refresh() 会重画整个热点页，摘要区也会跟着重画。
   没有这张表，重画就把刚填好的正文冲回「正在抓取原文…」。 */
let peekHtml = {}
/* 当前在飞的那次抓取。
   连点时用它把上一次取消掉 —— 浏览器同域只有 6 个并发连接，
   不取消的话连点几条就把连接池占满，剩下的永远排队。 */
let peekAbort = null

/** 安全地把内容写进预览框。
    抓取是异步的，这期间用户可能已经选了别的条目 ——
    不校验就会把 A 的正文写进 B 的框里。 */
/* 安全写入：只往当前选中的那一条里填。
   抓取是异步的，这期间用户可能已经选了别的条目 ——
   不校验就会把 A 的正文写进 B 的框里。

   关键：写进去的同时把内容留一份在 peekHtml 里。
   这是本轮最隐蔽的一个 bug 的解药 ——
   poll() 每 4 秒轮询一次，stamp 一变就 refresh()，
   refresh() 会重跑 paintHot()，而 hotDetail() 每次都把摘要区
   重画成「正在抓取原文…」。于是刚填好的正文 4 秒后又被抹掉，
   用户看到的就是「一直转圈，永远不出来」。
   实测单条 fetch 只要 181ms，界面上却 34 秒还在转。

   让重绘幂等：已经渲染过的内容从 peekHtml 恢复，不重发请求。 */
function fillPeek(k, html) {
  peekHtml[String(k)] = html
  fillBox(k, html)
}

/* 只往界面上写，不落 peekHtml。
   加载态必须用这个 —— 见 fillPeek 的注释。 */
function fillBox(k, html) {
  const box = $('#peek-box')
  if (!box) return
  if (box.dataset.k !== String(k)) return
  box.innerHTML = html
}

/* 标点白名单 —— 必须和 engine/styles.mjs 的 PUNCT_OK 完全一致。
   两处判据不一致的后果：界面上过了，服务端判不过，
   用户改到崩溃也找不到原因。这是最坏的体验。

   覆盖的六种合法用法：
     一  图注里的「图：」「照片：」
     二  来源表的「出处：」「来源：」「图注：」「备注：」
     三  表格单元格里的冒号（| 原始报道：xxx |）
     四  直接引语前的「她说的是：」「她的原话是：」「原话：」
     五  加粗引语前的引导语（「她说：**就我一个人在那里坚持**」）
   第六类漏过一次就补不回来了 —— 加新类型前先跑 style-test.mjs 的白名单用例。 */
const PUNCT_OK = /((^|\n)\s*[-*|>]*\s*(出处|来源|图注|备注|题注)[：：][^\n]{0,120}|((图|图表|图片|照片)[：：][^()\n]{0,140})|((原话|她说|他说|原话是)[^\n：:]{0,8}[：：])|(\|[^\n|]{0,24}[：：][^\n|]{0,60}\|)|(\|[^\n]{0,300}[：：][^\n]{0,300}\|[^\n]{0,300}\|))/g

/* 破折号：只管中文标点，不管 markdown 语法。
   --- 是分隔线，|---|---| 是表格分隔行，两者都不是标点。
   负向前后顾能把它们排除掉，又不会漏掉正文里的单破折号。
   （单破折号 -- 在中文正文里也基本是误粘，但为稳妥仍算命中） */
const DASH_RE = /——|(?<!-)--(?!-)/g

/* 掩码：把白名单位置换成等长空格，下标和原文一一对应，
   这样 sample 不会错位、n_hit 不会算多。 */
/* ---------- 各风格特有的 AI 套话 ----------
   实测（engine/cliche-test.mjs）：通用禁令抓不到这些。
     biz / sharp / person / story 四种风格的套话完全放行。
   「每种文风 AI 味浓」的真正原因不是通用规则不够严，
   是风格层根本没有词汇表。

   ★ 这份表必须和 engine/styles.mjs 的 STYLE_CLICHE 一一对应，
     改一处就要改另一处 —— 9d8 那条断言比对两边的键名。 */
const STYLE_CLICHE = {
  biz: [/赋能|闭环|抓手|颗粒度|护城河|心智|生态位|增长飞轮|卡位|破圈|私域|链路打通|顶层设计/, /本质上|底层逻辑|商业闭环|价值重构|模式升级/],
  sharp: [/韭菜|镰刀|收割|吊打|降维打击|降智|吃相难看|打脸现场|子弹飞/, /资本(永远|从来)(贪婪|吃相难看)|资本的原罪|毒瘤/],
  person: [/画卷|定格|注脚|镌刻|岁月静好|定格在时光|成为他人生的/, /那一刻，时间仿佛静止|泪目|破防了/],
  explain: [/本质上|底层逻辑|颗粒度|生态位|闭环了|抽象出来看/, /三个维度|两个层面|一套方法论/],
  news: [/据悉|记者获悉|业内人士表示|引发(了)?(广泛|社会)?关注|或将带来|未来可期|深远影响/, /高度重视|大力推进|扎实开展|积极营造/],
  warm: [/温暖了那个|时间仿佛静止|愿每一个人|愿天下|岁月静好|治愈了你/, /那一刻|仿佛全世界|定格在/],
  talk: [/绝了|太真实了|家人们|yyds|冲冲冲|听我说|真的服了/, /怎么说呢|怎么说吧|懂的都懂/],
  crit: [/乱象|形式主义|责任缺位|亟待|亟需|究其根源|任重道远|久久为功/, /令人忧虑|值得深思|亟需引起/],
  story: [/多年以后他才明白|多年以后.{0,6}才明白|这一切都要从.{0,8}说起|命运的天平/, /多年以后.{0,10}他再也没有|从那以后.{0,8}一切都/],
  cold: [/据悉|记者获悉|业内人士|引发关注|未来可期|深远影响/, /高度重视|大力推进|扎实开展/]
}

/* 各风格的中文名，给提示文案用。 */
const STYLE_CN_HINT = {
  warm: '有温度', sharp: '犀利时评', person: '人物特稿', story: '故事叙事',
  talk: '口语闲谈', crit: '批评评论', explain: '硬核拆解', biz: '商业观察',
  news: '新闻快评', cold: '冷静收束'
}

/* 查当前稿子的风格套话。styleId 从 project.style 来。 */
function scanCliche(text, styleId) {
  const list = STYLE_CLICHE[styleId]
  if (!list) return []
  const cn = STYLE_CN_HINT[styleId] || styleId
  const out = []
  list.forEach((re, i) => {
    const m = String(text || '').match(re)
    if (!m) return
    out.push({
      n: cn + '套话',
      lv: 'md',
      n_hit: m.length,
      sample: m[0],
      tip: '「' + m[0] + '」是' + cn + '这一风格最常见的 AI 套话。换成具体的名词和数字。'
    })
  })
  return out
}

function maskPunct(text) {
  return text.replace(PUNCT_OK, m => ' '.repeat(m.length))
}

/* ---------- 文风检测（本地规则） ---------- */
const RULES = [
  { n:'排比结构', re:/不是[^。]{0,20}，?而是[^。]{0,20}，?而是/g, lv:'hi', tip:'「不是A，而是B，而是C」是最典型的AI句式，删掉后面的而是。' },
  { n:'万能总结', re:/总而言之|综上所述|归根结底|说到底|一言以蔽之/g, lv:'hi', tip:'直接删。总结句是AI的收尾签名。' },
  { n:'空洞拔高', re:/这(让我们)?(看到|感受到|明白|提醒我们)|愿我们|未来可期|值得深思/g, lv:'hi', tip:'结尾升华，删。收在具体事实上。' },
  { n:'模糊归因', re:/业内(人士|认为|普遍)|有观点认为|不少人认为/g, lv:'md', tip:'「业内认为」是最懒的引用，换成具体是谁说的。' },
  { n:'AI 口头禅', re:/首先[，,]|其次[，,]|最后[，,]|再次[，,]|此外[，,]/g, lv:'md', tip:'这些连接词一多就像议论文模板。' },
  { n:'程度副词', re:/非常(重要|深刻|巨大)|极其|十分(重要|感人)|无比/g, lv:'md', tip:'换成具体的事实或数字。' },
  // 加粗不是问题，滥用才是。原来这条规则说「公众号不认 **」——错的，
  // 排版内核会把 ** 渲染成 <strong>（实测 50 处无残留），
  // 而且用户明确要求「有强调的内容，有一些重点，不然通篇下来都是长文」。
  // 真正要提醒的是：连续两三段各加粗一处，就成了一片高亮，读者反而找不到重点。
  { n:'加粗连续', re:/\*\*[^*]+\*\*\s*\n+\s*\*\*[^*]+\*\*/, lv:'md', tip:'相邻两段都加粗会互相抢。隔开一段再强调。' },
  { n:'表情符号', re:/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/gu, lv:'hi', tip:'严肃题材不要用。' },
  { n:'感叹号', re:/！/g, lv:'lo', tip:'正文少用，克制更可信。' },

  /* ── 用户 2026-10-02 点名的一类 AI 味 ──
     原话：「AI 特别常用的句式，比如说提前否定，比如说先说结论，
     免得有人看标题。那就没有人去怀疑啊，你为什么提前要埋一个这样的预设呀？」

     这是 AI 味里最重的一种：替读者预设一个没人提出的质疑。
     人类记者写东西不会预先否掉一个没人说的话，所以这类句子
     在任何风格里都是败笔，归到 hi 级。 */
  { n:'提前否定', re:/先说结论|免得有人|以免有人|有读者会(说|以为|质疑)|可能会(有人|被)(误解|质疑)|这里要说明的是|需要澄清的是|不要误解/g,
    lv:'hi', tip:'预先否掉一个没人提出的质疑，是 AI 最典型的预设。没人会这样写，直接删掉这句。' },
  { n:'预设写作边界', re:/这不是一篇|本文不做|下面只谈|仅从.{0,6}角度|不展开讲/g,
    lv:'hi', tip:'先划定「我不写什么」，读者还没问呢。删掉，直接开写。' },
  { n:'议论文开场', re:/^(众所周知|不可否认|显而易见|客观而言|平心而论|综上)[，,]/gm,
    lv:'md', tip:'议论文套话开头，一上来就露馅。换成具体的时间或场景。' },

  /* ── 标点硬禁（2026-10-03）────────────────────────────
     用户原话「像什么？双引号、冒号、破折号，尽量都给它去掉」，
     这次收紧成硬禁。

     为什么原来按密度判是错的：
     一篇 4000 字的稿子放 40 个破折号，密度才 1/千字，
     per100:1 的规则根本不响 —— 密度判等于放行。
     用户说的是「不许用」，那就按不许用来做。

     双引号改用直角引号「」。中文引号本来就该用直角引号，
     弯引号是 web 排版时代的产物，也是 AI 的默认输出。 */
  /* ── 来源前缀（2026-10-04 补强）──────────────────────
     用户原话「你一直在强调文中什么什么材料里说明。
     那这些东西按理说不应该出现在你的正文中的。」

     原来这条只查行首的「来源：」和「据某某报道」两种，
     查不到正文中间的那九种：
       期刊上一篇文章写砌体结构……
       有研究估算，那套方案能让强度提四分之一
       作者最后写了一句……
       云南那边做田野调查的时候，老人说……
       有位老人跟我说过一件事……

     ★ 判据写窄和没有判据一样糟，它给出「已经检查过了」的错觉。
       抓的是「引出事实的叙述框架」，不是某几个具体词。 */
  { n:'来源前缀', re:/(据|根据|按照)[^。，\n]{0,8}(报道|通报|文献|研究|数据|统计|说法)/g, lv:'hi',
    tip:'「据某某报道」这类不要写进正文。事实直接写进句子，出处放文末的来源表。' },
  { n:'来源前缀', re:/[^\n]{0,12}(期刊|论文|文章|文献|研究|报道)[^。，\n]{0,4}(上|里|中)?[^。，\n]{0,4}(写|说|表明|显示|发现|估算|提到|指出)/g, lv:'hi',
    tip:'「期刊上一篇文章写……」「有研究估算……」是转述，不是写作。直接说那件事。' },
  { n:'来源前缀', re:/(作者|专家|学者|研究人员|笔者|记者)[^。，\n]{0,8}(认为|表示|指出|写道|介绍|说[，,]|写了一[句段篇])/g, lv:'hi',
    tip:'「作者说」「专家表示」把读者挡在事实外面。直接给事实。' },
  { n:'来源前缀', re:/(调查|研究)[^。，\n]{0,4}(显示|表明|发现|估算|证明|提到|指出|介绍|说)/g, lv:'hi',
    tip:'「研究表明」是挡箭牌。结论直接写出来。' },
  /* 泛指的人 + 转述动词。实测漏了四条，全是这个形态：
       作者最后写了一句……
       后来他写了一段话……
       有位老人跟我说过一件事……
       老人在云南做调查的时候提到……
     前一条的主语词表只有（作者|专家|学者|笔者|记者），「老人」「他」不在表里。 */
  /* 泛指的人 + 转述框。
     只保留「跟我说」「跟我讲」「告诉我」「提到」这四个，
     它们明确表示「我在转述别人」，引语不会长这样。
     ★ 曾经把「他说」「她说」「老人说过」也放进来，结果误伤：
         她说走的地方多了就不计较了
         他邻居说他傻
         大摆衣村有位老人说过
       直接引语是写作，不是转述 —— 人物特稿本来就要求「要有原话」。
       代价是漏掉「后来他写了一段话」那一种，值。 */
  { n:'来源前缀', re:/[^\n。，]{0,8}(老人|老人家|老乡|村里人|他|她|对方|受访者|受访人)[^。，\n]{0,6}(跟我说|跟我讲|告诉我|提到了|提到过)(了|过)?/g, lv:'hi',
    tip:'「有位老人跟我说过」「后来他写了一段话」是转述，不是写作。事情直接讲。' },
  { n:'来源前缀', re:/[^\n]{0,10}那边[^。，\n]{0,6}(做|说|提到|提过|的[时候里])/g, lv:'md',
    tip:'「那边说」含糊又像在交代出处。换成具体的人或地方。' },

  { n:'弯引号', re:/[“”]/g, lv:'hi',
    tip:'全篇不许用弯引号。改用直角引号「」。中文引号本来就该用直角引号。' },
  { n:'ASCII 引号', re:/"|'/g, lv:'hi',
    tip:'英文引号是从别处复制来的残留。中文稿子里改用直角引号「」。' },
  { n:'破折号', re:DASH_RE, lv:'hi',
    tip:'AI 味重灾区。改成句号断句，一句说一件事更利落。' },
  /* 冒号要放行三处：
     图注和来源表里的「出处：」「来源：」—— 用户明确要求配图必须标出处
     直接引语前面的「她说的是：」—— 去掉就把引语断了
     所以这一条不能直接 count，要先掩码掉白名单位置（见 scan）。 */
  { n:'冒号', re:/：/g, lv:'hi', punctMask:true,
    tip:'正文里的冒号后面多半是一句解释。改成句号。图注的「出处：」和直接引语前的「她说的是：」已自动放行。' },

  /* ── 否定式（2026-10-03）──────────────────────────────
     用户原话「不允许预设性的、否定性的语句」。

     判据只禁 AI 句型，不禁「不」字本身：
     「她没停下」是叙事，「没有 A，只有 B」是 AI 句型。
     把「不」字一并禁掉，正常中文写作会被全部判死 ——
     那不是去 AI 味，是不让写中文了。 */
  /* 第二半不能只认「而是/只是/更」。实测漏过三句：
     「她不是X，她是Y」「最难受的不是病，是那个Z」
     「第一反应不是「完了」，是「我想去南极」」。
     ★ 规则写窄比没有规则更糟：它给出「已经检查过了」的错觉。 */
  { n:'不是A而是B', re:/不是[^。！？\n]{1,26}[，,]?\s*(而是|只是|更|是|并非|更像是)/g, lv:'hi',
    tip:'AI 的招牌句式。把结论直接说出来，绕这一圈反而弱。' },
  /* 预先否掉没人说的话 —— 提前否定的近亲。 */
  { n:'预先否掉没人说的话', re:/(他|她|它)?没说[^。！？\n]{1,20}[。；]\s*(也)?没(说|提|写)/g, lv:'hi',
    tip:'先否掉一个没人提出的说法，和「先说结论」是同一个毛病。删掉，直接说她说了什么。' },
  /* 否定式收尾：用「跟X没关系」下结论 */
  { n:'否定式收尾', re:/跟[^。！？\n]{1,10}(没关系|一点关系都没有|没有关系)|不是治愈|不是什么/g, lv:'md',
    tip:'「跟治病没关系」是在说「不是什么」。改成「是什么」。' },
  { n:'没有A只有B', re:/没有[^。！？\n]{1,24}[，,]?\s*只有/g, lv:'hi',
    tip:'和「不是A而是B」是同一个模子，换了个词而已。' },
  { n:'既不也不', re:/既不[^。！？\n]{1,20}也不/g, lv:'hi',
    tip:'双重否定的排比句，AI 写穷困、写取舍时最爱用。' },
  { n:'连续否定', re:/不[^。！？\n，。]{1,16}[，,]?\s*也不[^。！？\n]{1,16}/g, lv:'md',
    tip:'「不…也不…」的排比，先抑后扬的老套路。' },
  { n:'双重否定', re:/不能不说|不能不承认|不能不|无不是|无非是|不外乎|不外是/g, lv:'hi',
    tip:'双重否定显得委婉，实则是 AI 在打太极。直接说。' },
  { n:'全称否定', re:/从来不|从来不会|从来没有|从不|绝不|决不/g, lv:'md',
    tip:'全称否定是表态不是叙事。AI 用它给自己壮声势。' },

  /* ── 预设性（2026-10-03）──────────────────────────────
     AI 最爱替读者预设立场、假装共识、预设结论。
     第一层「提前否定」在上面已经有了，
     这里补的是第二层「假装这是共识」。 */
  { n:'假装共识', re:/众所周知|我们都知道|都知道|不难发现|不难看出|不难理解|显而易见|毫无疑问|不言而喻|明摆着/g, lv:'hi',
    tip:'「众所周知」是 AI 假装读者已经同意。读者从没想过要怀疑这个，直接删。' },
  { n:'主观预设', re:/其实|事实上|实际上|客观(来说|而言)|平心而论|公允地说|必须承认/g, lv:'md',
    tip:'这些是 AI 加的转场垫片。删掉直接说结论更利落。' },
  { n:'集体主语', re:/我们(认为|应该|需要|必须|不妨|可以|来看看)/g, lv:'md',
    tip:'「我们认为」把作者和读者捆在一起，AI 最爱的偷懒写法。换成具体是谁说的。' }
]
function scan(text) {
  const hits = []
  const len100 = Math.max(1, text.replace(/\s/g, '').length / 100)
  /* 掩码版正文：白名单位置替换成空格，长度不变，
     这样 match 的下标和原文一一对应，sample 不会错位。 */
  const masked = maskPunct(text)
  RULES.forEach(r => {
    /* punctMask 的规则查掩码版，其余查原文 */
    /* punctMask / dashOnly 的规则查掩码版，其余查原文 */
    const src = (r.punctMask || r.n === '破折号') ? masked : text
    const m = src.match(r.re)
    if (!m || !m.length) return
    /* per100 是密度阈值。留给以后可能加的「允许少量」的规则用，
       现在三条标点都是硬禁，不再走密度。 */
    if (r.per100 && m.length / len100 <= r.per100) return
    hits.push({ ...r, n_hit: m.length, sample: (m[0] || '').slice(0, 30).trim() })
  })
  /* 风格层套话并进 hits。
     接入点选在 scan() 里（而不是每个消费方各自加一遍），
     自检面板、右侧摘要、概要条三处自动一致。 */
  const cl = scanCliche(text, (S.project && S.project.style) || '')
  if (cl.length) hits.push(...cl)
  const paras = text.split(/\n\s*\n/).map(p => p.trim()).filter(p => p.length > 20)
  let sd = null
  if (paras.length >= 5) {
    const l = paras.map(p => p.length), avg = l.reduce((a, b) => a + b, 0) / l.length
    sd = Math.sqrt(l.reduce((a, b) => a + (b - avg) ** 2, 0) / l.length) / avg
    if (sd < 0.22) hits.push({ n:'段落过于均匀', lv:'hi', n_hit: paras.length, tip:'各段长度太整齐，真人写作不会这样。刻意把某两段拉长或压短。' })
  }
  let ai = 100 - hits.filter(h => h.lv === 'hi').length * 14 - hits.filter(h => h.lv === 'md').length * 7 - hits.filter(h => h.lv === 'lo').length * 2
  if (sd !== null && sd < 0.22) ai -= 18
  const wc = text.replace(/\s/g, '').length
  if (wc < 200) ai = Math.min(ai, 60)
  return { ai: Math.max(0, Math.min(100, Math.round(ai))), hits, wc, paras: paras.length, at: now() }
}
function runAudit() {
  if (!S.body || !S.body.trim()) { S.audit = null; return }
  S.audit = scan(S.body)
}

/* ---------- 无障碍 ----------
   评审必查项。两个教训都记在这：

   一、声明位置。原来用后置的 const A11Y_LABEL，
      而 go() 在页面初始化时就调用 —— 撞上 const 的暂时性死区，
      函数直接是 undefined。本项目在 wvTimer / peekAbort 上栽过同样的坑，第三次了。
      所以这个函数不依赖任何后置声明。

   二、不要解析 HTML 字符串。原来的正则对不上图位置按钮
      （内容是 <img> 不是文字），而且 innerHTML 写回会让节点全部重建，
      正在输入的 textarea 会掉焦点、滚动位置会跳。 */
function a11y(root) {
  if (!root || typeof root.querySelectorAll !== 'function') return
  root.querySelectorAll('button:not([aria-label])').forEach(b => {
    const t = (b.textContent || '').trim()
    const img = b.querySelector('img')
    let label = ''
    if (img && /^\d+$/.test(t)) {
      label = `正文第 ${t} 张图`
    } else if (!img && t.length > 0 && t.length <= 3 && !/[\u4e00-\u9fa5]/.test(t)) {
      const MAP = {
        '×': '删除', '▤': '文章预览', '◫': '并排对比',
        '↗': '打开原页', '⚠': '警告', '←': '返回',
        '→': '下一步', '…': '更多', '+': '添加'
      }
      label = MAP[t] || ''
    }
    if (label) b.setAttribute('aria-label', label)
  })
}

/* 区域 landmark 声明（shell() 生成四个 section 时取用） */
const LANDMARK = { 'p-hot': '热点榜', 'p-idea': '选题', 'p-write': '成稿', 'p-ship': '排版发布' }
/* ---------- toast ---------- */
let tt
function toast(msg, kind) {
  const t = $('#toast')
  if (!t) return
  t.textContent = msg
  t.style.background = kind === 'err' ? 'var(--danger)' : kind === 'warn' ? 'var(--warn)' : 'var(--ink)'
  t.classList.add('on')
  clearTimeout(tt)
  tt = setTimeout(() => t.classList.remove('on'), 2600)
}

/* ---------- 事件绑定 ---------- */
function bind() {
  document.addEventListener('keydown', e => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      const p = $('#p-ask')
      if (p && p.classList.contains('on')) { e.preventDefault(); Actions.submit() }
    }
    if (e.key === 'Escape') { const b = $('#submitbox'); if (b) b.remove() }
  })
  document.addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey) {
      if (e.target.id === 'topic-in') { e.preventDefault(); Actions.addTopic() }
    }
  })
  /* 输入保护已由 isTyping() 统一负责（按焦点判断，不按 id 白名单）。
     这里只保留「离开正文/标题时落盘」这类真正的副作用。 */
  document.addEventListener('focusout', e => {
    if (e.target.id === 'body' || e.target.id === 'etitle') save()
  })
  document.addEventListener('input', e => {
    const t = e.target
    if (t.id === 'body') { S.body = t.value; bodyDirty = true; markDirty('body'); save(); refreshShip() }
    else if (t.id === 'etitle') { S.project.title = t.value; markDirty('project'); save() }
    else if (t.id === 'topic') { S.project.topic = t.value; markDirty('project'); save() }
    else if (t.id === 'req') { S.project.req = t.value; markDirty('project'); save() }
    else if (t.id === 'abs') { S.project.abstract = t.value; markDirty('project'); save(); refreshShip() }
    else if (t.id === 'foot') { S.project.foot = t.value; markDirty('project'); save(); refreshShip() }
    /* 交付面板的两个输入框。存模块级变量 + 防抖重绘，
       因为 renderWrite 会重建 DOM，DOM 上的 value 会被抹掉。 */
    else if (t.id === 'title-in' || t.id === 'title-in-del') Actions.keepTitlePool(t.value)
    else if (t.id === 'as-fixreq') Actions.keepFixReq(t.value)
  })
  // 字数 / 文风下拉
  document.addEventListener('change', e => {
    const t = e.target
    if (t.id === 'len') { S.project.len = t.value; markDirty('project'); save() }
    else if (t.id === 'style') { S.project.style = t.value; markDirty('project'); save() }
    // 排版取色器
    else if (t.dataset && t.dataset.act === 'tuneInput') {
      S.project.tune = S.project.tune || {}
      S.project.tune[t.dataset.arg] = t.value
      markDirty('project'); save(); applyTune()
    }
  })
  // 取色器是连续拖动，用 input 事件实时跟手
  document.addEventListener('input', e => {
    const t = e.target
    if (t.dataset && t.dataset.act === 'tuneInput' && t.type === 'color') {
      S.project.tune = S.project.tune || {}
      S.project.tune[t.dataset.arg] = t.value
      /* 取色器拖动是连续事件，每次都防抖保存会互相打断，
         但仍然要标脏 —— 否则松手到下一次 poll 之间取的值会被冲掉。 */
      markDirty('project')
      applyTune()
    }
  })
  // 图片上传
  document.addEventListener('paste', async e => {
    const items = [...(e.clipboardData?.items || [])].filter(i => i.type.startsWith('image/'))
    if (!items.length) return
    for (const it of items) { const f = it.getAsFile(); if (f) await upload(f) }
  })
  document.addEventListener('click', e => {
    if (e.target.id === 'drop') $('#fileinput')?.click()
  })
}
async function upload(f) {
  toast('上传中…')
  try {
    const dataUrl = await new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(f) })
    const r = await api('/upload', { name: f.name, dataUrl })
    S.images.push({ id: Date.now().toString(36), file: r.file, cap: f.name.replace(/\.[^.]*$/, ''), src: '', risk: '未评估', at: now() })
    markDirty('images')
    await api('/save', { name: 'images', data: S.images })
    await poll(false); toast('已上传')
  } catch (e) { toast('上传失败：' + e.message, 'err') }
}
function setupDrop() {
  const d = document.createElement('input')
  d.type = 'file'; d.id = 'fileinput'; d.accept = 'image/*'; d.multiple = true; d.style.display = 'none'
  document.body.appendChild(d)
  d.onchange = () => { [...d.files].forEach(upload); d.value = '' }
  // 拖放区现在是成稿页顶部的 .drop-hint（图库删了，拖放区跟着换了类名）
  const ZONE = '.drop, .drop-hint'
  document.addEventListener('dragover', e => {
    const t = e.target.closest(ZONE)
    if (t) { e.preventDefault(); t.classList.add('hot') }
  })
  document.addEventListener('dragleave', e => { const t = e.target.closest(ZONE); if (t) t.classList.remove('hot') })
  document.addEventListener('drop', e => {
    const t = e.target.closest(ZONE)
    if (!t) return
    e.preventDefault(); t.classList.remove('hot')
    ;[...e.dataTransfer.files].filter(f => f.type.startsWith('image/')).forEach(upload)
  })
}

/* ---------- 启动 ---------- */
/* 渲染表：refresh() 只重渲染这里列出的页。加页必须加这里，否则不会被刷新。 */
Object.assign(RENDER, { hot: renderHot, idea: renderIdea, write: renderWrite, ship: renderShip })

shell()
setupDrop()
go('hot')
poll(false)

/* 暴露给测试 */
/* 暴露给测试。
   selfCheck / renderSelfCheck 必须挂出来 ——
   自检是这个系统的验收依据，不挂出来就只能靠肉眼看 DOM，
   没法写自动化断言。挂出来之后才能问「故意塞一句提前否定，它抓不抓得到」。 */
window.__wt = { get S(){ return S }, get HOT(){ return HOT }, Actions, scan, go, poll, RULES, toast, hotKey, hotBag, isTyping, selfCheck, renderSelfCheck, parseTitlePool }

})()
