/**
 * 渲染健康检查：抓「看起来像乱码」的渲染问题。
 *
 * 文本层干净 ≠ 页面正常。这几类问题在文件里查不出来，
 * 只能在真实渲染后量：
 *   1. 文字被 nowrap/ellipsis 硬截 → 句子只剩前半截，读着像断了
 *   2. 中文渲染成豆腐块（字体没命中）
 *   3. 元素零宽/零高 → 内容整个消失
 *   4. 文字互相重叠
 *   5. 出屏（横向溢出）
 *
 * 用法：把 PROBE 注入页面执行（由浏览器侧调用）
 */
window.__renderHealth = async function () {
  const sleep = ms => new Promise(r => setTimeout(r, ms))
  const $ = s => document.querySelector(s)
  const $$ = s => [...document.querySelectorAll(s)]
  const PAGES = ['idea', 'write', 'check', 'ship']
  const out = []

  // 字体可用性：中文宽度若与 monospace 相同，说明全落到方框
  const c = document.createElement('canvas').getContext('2d')
  c.font = '40px monospace'
  const mono = c.measureText('中文测试').width
  c.font = '40px ' + getComputedStyle(document.body).fontFamily
  const zh = c.measureText('中文测试').width
  const cjk = Math.abs(zh - mono) < 0.5

  for (const p of PAGES) {
    window.__wt.go(p)
    await sleep(p === 'idea' ? 3200 : p === 'ship' ? 3600 : 1300)
    await sleep(400)
    const root = $('#p-' + p)
    const W = window.innerWidth
    const all = $$('#p-' + p + ' *').filter(e => e.offsetHeight > 0)

    /* 1. 文字被硬截 */
    const clipped = []
    for (const e of all) {
      const cs = getComputedStyle(e)
      if ((cs.overflow === 'hidden' || cs.textOverflow === 'ellipsis') && e.scrollWidth > e.offsetWidth + 2) {
        clipped.push(e.tagName + '.' + (e.className || '') + ' ' + e.scrollWidth + '>' + e.offsetWidth)
      }
    }

    /* 2. 零宽（内容消失）*/
    const zero = all.filter(e => e.offsetWidth === 0 && e.tagName !== 'STYLE' && e.tagName !== 'BR')

    /* 3. 出屏 */
    const over = all.filter(e => e.getBoundingClientRect().right > W + 4)

    out.push([
      p,
      'clipped=' + clipped.length,
      'zero=' + zero.length,
      'over=' + over.length,
      clipped.length ? '(' + clipped.slice(0, 3).join(' ') + ')' : ''
    ].join(' '))
  }

  out.push('cjkFont=' + (cjk ? 'MISSING(豆腐块)' : 'ok'))
  return out.join('|')
}
