/**
 * 界面速写：把页面按「真实几何」导出成文字。
 * 目的是替代截图 —— 截图需要可见窗口，我拿不到；
 * 但「谁在什么位置、多宽多高、和谁重叠」这些能查出来，
 * 布局乱、字挤成一团、元素重叠都能看明白。
 *
 * 用法：粘贴进浏览器 console，或由 run-layout-sketch.js 注入
 */
window.__sketch = async function (page) {
  const sleep = ms => new Promise(r => setTimeout(r, ms))
  const $ = s => document.querySelector(s)
  const $$ = s => [...document.querySelectorAll(s)]
  window.__wt.go(page)
  await sleep(page === 'idea' ? 3200 : page === 'ship' ? 3600 : 1300)
  await sleep(400)
  const root = $('#p-' + page)
  const W = window.innerWidth
  const out = []
  const box = e => {
    const r = e.getBoundingClientRect()
    return { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height), r: Math.round(r.right) }
  }

  /* 只看叶子节点（有文字或图片的），避免输出上百个容器 */
  const leaves = $$('#p-' + page + ' *').filter(e => {
    const hasText = [...e.childNodes].some(n => n.nodeType === 3 && n.textContent.trim())
    const isImg = e.tagName === 'IMG'
    const isBtn = e.tagName === 'BUTTON'
    const b = box(e)
    return (hasText || isImg || isBtn) && b.w > 0 && b.h > 0
  })

  out.push(`页面 ${page}　视口 ${W}×${window.innerHeight}　可渲染元素 ${leaves.length}`)

  /* 按纵向位置排序，读起来就是从上往下的样子 */
  leaves.sort((a, b) => box(a).y - box(b).y || box(a).x - box(b).x)

  const WIDTH = 96
  for (const e of leaves) {
    const b = box(e)
    if (b.y > 4000) continue
    const cs = getComputedStyle(e)
    let label = e.tagName === 'IMG' ? '[图]' : e.tagName === 'BUTTON' ? '[钮]' : ''
    if (!label) label = e.textContent.replace(/\s+/g, ' ').trim()
    if (label.length > WIDTH - 20) label = label.slice(0, WIDTH - 21) + '…'

    const flags = []
    if (b.w < 8) flags.push('★零宽')
    if (b.h < 8) flags.push('★零高')
    if (b.r > W + 2) flags.push('★出屏')
    const fs = parseFloat(cs.fontSize)
    if (fs && fs < 10.5) flags.push('★字' + fs)
    if (cs.letterSpacing && parseFloat(cs.letterSpacing) < -0.5) flags.push('★字挤')
    if (cs.whiteSpace === 'nowrap' && e.scrollWidth > b.w + 2) flags.push('★截断')
    if (cs.overflow === 'hidden' && e.scrollWidth > b.w + 2) flags.push('★溢出裁剪')
    if (parseFloat(cs.lineHeight) < parseFloat(cs.fontSize) * 1.15) flags.push('★行距过小')

    const bar = '  '.repeat(Math.min(10, Math.floor(b.x / (W / 12))))
    out.push(`${String(b.y).padStart(5)} x${String(b.x).padStart(4)} ${String(b.w).padStart(4)}×${String(b.h).padStart(4)} ${bar}${label} ${flags.join(' ')}`)
  }

  /* 文字重叠检测：同一区域被多个可见文字元素压住 */
  const overlaps = []
  for (let i = 0; i < leaves.length; i++) {
    for (let j = i + 1; j < Math.min(leaves.length, i + 40); j++) {
      const a = leaves[i], b = leaves[j]
      if (a.contains(b) || b.contains(a)) continue
      const ba = box(a), bb = box(b)
      const ox = Math.min(ba.r, bb.r) - Math.max(ba.x, bb.x)
      const oy = Math.min(ba.y + ba.h, bb.y + bb.h) - Math.max(ba.y, bb.y)
      if (ox > 12 && oy > 8) {
        overlaps.push(`  重叠 ${ox}×${oy}px：「${a.textContent.replace(/\s+/g, ' ').trim().slice(0, 18)}」 ←→ 「${b.textContent.replace(/\s+/g, ' ').trim().slice(0, 18)}」`)
      }
    }
  }
  if (overlaps.length) { out.push('—— 文字重叠 ——'); out.push(...overlaps.slice(0, 12)) }

  return out.join('\n')
}
