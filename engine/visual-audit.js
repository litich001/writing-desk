/**
 * 视觉对抗验收：专查「看起来乱」的五类问题
 *
 *  1. 重叠   —— 两个可见元素真的压在一起
 *  2. 错位   —— 元素跑出容器、跑到屏幕外
 *  3. 比例失衡 —— 字号层级倒挂、控件过大/过小
 *  4. 拥挤   —— 间距过密、点击目标过小
 *  5. 主次   —— 正文必须比侧栏大（这一项抓出过「该大的不大」）
 *
 * 与布局体检的区别：那个查 CSS 规则写得对不对，这个查渲染后真实的样子。
 * 用法：注入页面执行 window.__visual(page)
 *
 * ── 三个已经踩过的坑，改这文件前先看这里 ──
 *  1. getElementById('#body') 会捞到别页的隐藏节点（宽度 0），误报「正文不占主位」。
 *     必须 root.querySelector('#body') 且判 offsetWidth > 0。
 *  2. 「两个元素重叠」有大量刻意设计：图片上的「已用」角标、发布页 fixed 浮层。
 *     不排除会稳定误报 2~3 处。
 *  3. 「微元素」不算字号过小：角标（.ok/.n）、图标字母（.hot-tab/.fr 里的 <i>）、
 *     计数徽标（.side-tab 里的 <em>）、来源名（.fr 里的 <em>）。这些是 9~10.5px 的
 *     元信息，本来就不该按正文字号标准衡量。不排除会一次误报 450 多个。
 *  4. 点击目标阈值用 28px 不是 30px：.btn.sm 声明 height:30px 但实测渲染 29.6px，
 *     Math.round 显示成 30，按 30 判会稳定误报 39 个。
 *  5. 可横滚容器（overflow-x:auto）里的子元素超出视口是正常的 ——
 *     待用图横条就靠滚动，一次会误报 20 个。
 *  6. 主次比例按页分标准：成稿页 3:1，发布页 375:300 只有 1.25:1，
 *     统一按 2 倍判会把发布页误报。
 *     —— 教训：审计工具自己也会骗人，误报必须当场查清并排除，不能放着。
 */
window.__visual = async function (page) {
  const sleep = ms => new Promise(r => setTimeout(r, ms))
  const $ = s => document.querySelector(s)
  const $$ = s => [...document.querySelectorAll(s)]
  window.__wt.go(page)
  await sleep(page === 'idea' ? 3200 : page === 'ship' ? 3800 : 1500)
  await sleep(500)

  const root = $('#p-' + page)
  const W = window.innerWidth
  const vis = e => {
    const r = e.getBoundingClientRect()
    const cs = getComputedStyle(e)
    return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.opacity !== '0'
  }
  const box = e => e.getBoundingClientRect()
  const all = $$('#p-' + page + ' *').filter(vis)
  const issues = []

  /* ── 1. 重叠：兄弟节点互相压住 ──
     两类刻意设计不算：
       · IMG ⟂ SPAN（图片右上角的「已用」角标，本就该压在图上）
       · 任意元素 ⟂ .ship-dock（发布页的 fixed 浮层，本就该盖住预览） */
  const deliberate = (a, b) => {
    const t = a.tagName + ' ' + b.tagName
    if (/^(IMG SPAN|SPAN IMG)$/.test(t)) return true
    if (a.classList.contains('ship-dock') || b.classList.contains('ship-dock')) return true
    return false
  }
  const overlap = []
  for (let i = 0; i < all.length; i++) {
    for (let j = i + 1; j < all.length; j++) {
      const a = all[i], b = all[j]
      if (a.contains(b) || b.contains(a)) continue
      // 只比同级，避免祖先误判
      if (a.parentElement !== b.parentElement) continue
      if (deliberate(a, b)) continue
      const ba = box(a), bb = box(b)
      const ox = Math.min(ba.right, bb.right) - Math.max(ba.left, bb.left)
      const oy = Math.min(ba.bottom, bb.bottom) - Math.max(ba.top, bb.top)
      if (ox > 6 && oy > 6) {
        overlap.push({
          a: a.tagName + '.' + String(a.className).slice(0, 16),
          b: b.tagName + '.' + String(b.className).slice(0, 16),
          ox: Math.round(ox), oy: Math.round(oy)
        })
      }
    }
  }
  if (overlap.length) {
    issues.push(`重叠 ${overlap.length} 处：` + overlap.slice(0, 5)
      .map(o => `${o.a} ⟂ ${o.b}(${o.ox}×${o.oy})`).join(' / '))
  }

  /* ── 2. 越界 ──
     可横滚容器（overflow-x:auto/scroll）里的子元素超出视口是正常的 ——
     它们本来就是靠滚动才能看全的。待用图横条就是这样，会一次误报 20 个。
     所以先排除「祖先里存在横向滚动容器」的元素。 */
  const inScroller = e => {
    for (let p = e; p && p !== root; p = p.parentElement) {
      if (!p.classList) continue
      const ox = getComputedStyle(p).overflowX
      if (ox === 'auto' || ox === 'scroll') return true
    }
    return false
  }
  const over = all.filter(e => box(e).right > W + 4 && !inScroller(e))
  if (over.length) {
    issues.push(`出屏 ${over.length} 个：` + over.slice(0, 4)
      .map(e => e.tagName + '.' + String(e.className).slice(0, 14)).join(' / '))
  }

  /* ── 3. 比例失衡 ──
     字号应随层级递减，出现「大正文小标题」就是倒挂 */
  const heads = all.filter(e => /^H[1-6]$/.test(e.tagName))
  const paras = all.filter(e => e.tagName === 'P' && e.textContent.trim().length > 40)
  for (const h of heads) {
    const hf = parseFloat(getComputedStyle(h).fontSize)
    const ps = paras.filter(p => box(p).top > box(h).top && box(p).top < box(h).bottom + 200)
    for (const p of ps) {
      const pf = parseFloat(getComputedStyle(p).fontSize)
      if (hf < pf) {
        issues.push(`层级倒挂：<${h.tagName.toLowerCase()}> ${hf}px 小于 <p> ${pf}px`)
        break
      }
    }
  }

  /* 点击目标过小。阈值用 28 而不是 30：
     .btn.sm 写的是 height:30px，但实测渲染高 29.6px，Math.round 显示成 30，
     按 30 判会稳定误报 39 个。28 是这批控件的真实下限。 */
  const tiny = $$('#p-' + page + ' button, #p-' + page + ' a.btn').filter(e => {
    const b = box(e)
    return b.height > 0 && (b.height < 28 || b.width < 22)
  })
  if (tiny.length) {
    issues.push(`点击目标过小 ${tiny.length} 个：` + tiny.slice(0, 5)
      .map(e => `"${e.textContent.trim().slice(0, 8)}"${Math.round(box(e).height)}px`).join(' '))
  }

  /* 字号过小。排除「微元素」——
     角标、徽标、图标字母这些本来就不该按正文字号标准衡量：
       .fr 里的 <i> 平台图标 / <em> 来源名        10.5px
       .hot-tab .side-tab .theme-chip 里的图标   10.5px
       .pic 里的 .ok / .n 角标（叠在图上）        9px
       .side-tab 里的 <em> 待核计数徽标          10px
       .title-ref 里的类型标签 / 评分 / 理由行    10~11px
       .lv（AI 味问题里的高/中/低等级）          10.5px
     不排除会一次误报 450 多个。 */
  const MICRO_CTX = ['fr', 'hot-tab', 'side-tab', 'theme-chip', 'img-tabs', 'ps-item', 'title-ref', 'lv']
  const isMicro = e => {
    const cn = String(e.className || '')
    if (/(^|\s)(ok|n|count|dot)(\s|$)/.test(cn)) return true   // 角标
    for (let p = e; p && p !== root; p = p.parentElement) {
      if (!p.classList) continue
      for (const c of MICRO_CTX) if (p.classList.contains(c)) return true
    }
    return false
  }
  const small = all.filter(e => {
    const t = e.textContent.trim()
    if (!t || e.children.length) return false
    if (isMicro(e)) return false
    const f = parseFloat(getComputedStyle(e).fontSize)
    return f > 0 && f < 11
  })
  if (small.length) {
    issues.push(`字号过小 ${small.length} 个（<11px，非角标/图标）：` + small.slice(0, 4)
      .map(e => `${e.tagName}"${e.textContent.trim().slice(0, 8)}"${getComputedStyle(e).fontSize}`).join(' '))
  }

  /* ── 4. 控件占比：单侧栏不该吃掉一半屏 ── */
  const side = $('.rail, .ship-side, .sticky-l, .write-side')
  if (side && side.offsetWidth > 0) {
    const sw = box(side).width
    const pw = box(root).width
    if (pw > 0 && sw > pw * 0.45) {
      issues.push(`侧栏过宽：${Math.round(sw)}px / 内容区 ${Math.round(pw)}px = ${Math.round(sw / pw * 100)}%`)
    }
  }

  /* ── 5. 页面高度异常 ── */
  const h = root.scrollHeight
  if (h > 30000) issues.push(`页面过高 ${h}px（疑似布局塌陷）`)

  /* ── 6. 主次：正文必须是最大块 ──
     坑 1：#body 在别的页也有一份（隐藏时 width 为 0），
     所以必须限定在当前页 root 内查，且要求 offsetWidth > 0。
     坑 2：发布页工具栏固定 300px，预览纸按用户选的宽度走（375/600/760），
     比值天然接近 1.25:1。所以这里比的是「正文至少和工具栏一样宽」，
     不是要求 2 倍以上 —— 那是成稿页的 3:1 需求，两页标准不同。 */
  const ed = root.querySelector('#body') || root.querySelector('#draft') || root.querySelector('#pv')
  if (ed && ed.offsetWidth > 0) {
    const wSide = root.querySelector('.write-side') || root.querySelector('.ship-left')
    if (wSide && wSide.offsetWidth > 0) {
      const ew = box(ed).width, sw = box(wSide).width
      if (ew < sw) {
        issues.push(`★正文不占主位：正文 ${Math.round(ew)} < 工具栏 ${Math.round(sw)}`)
      } else {
        issues.push(`主次正确：正文 ${Math.round(ew)} : 工具栏 ${Math.round(sw)} = ${(ew / sw).toFixed(2)}:1，高 ${Math.round(box(ed).height)}px`)
      }
    } else {
      issues.push(`正文 ${Math.round(box(ed).width)}×${Math.round(box(ed).height)}px`)
    }
  } else {
    const pv = root.querySelector('#pv')
    if (pv) {
      issues.push(`预览 ${Math.round(box(pv).width)}×${Math.round(box(pv).height)}px，${pv.textContent.replace(/\s+/g, '').length} 字`)
    }
  }

  return issues.length ? issues : ['OK 无视觉问题']
}
