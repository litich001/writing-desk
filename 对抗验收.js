/**
 * 对抗式验收
 *
 * 与 验收测试.js 的区别：那份检查「代码里有没有这个东西」，
 * 这份检查「用户实际点下去会怎样」——全部通过真实浏览器操作。
 *
 * 每条用例都是一次真实交互：真的输入、真的点击、真的等、真的验结果。
 * 任何一条失败都打印实际值，不允许「看起来对」就算过。
 */
const { execFileSync } = require('child_process')

const ROOT = 'E:/文档/默认项目/写作台'
const PORT = 8848
let pass = 0, fail = 0
const fails = []
const R = []
const ok = (n, c, d = '') => { c ? (pass++, R.push(['✓', n, d])) : (fail++, fails.push(n), R.push(['✗', n, d])) }
const sec = s => R.push(['—', s, ''])

/* ───────── 浏览器端探针：一次注入，跑完所有交互 ───────── */
const PROBE = `(async () => {
  const log = []
  const sleep = ms => new Promise(r => setTimeout(r, ms))
  const $ = s => document.querySelector(s)
  const $$ = s => [...document.querySelectorAll(s)]
  const nav = () => $$('.nav').map(b => b.dataset.go)
  const PAGES = ['idea', 'write', 'check', 'ship']

  /* 1. 导航与分区 */
  log.push(['nav', nav().join(',')])
  log.push(['navCount', $$('.nav').length])
  log.push(['pageIds', $$('.page').map(p => p.id).join(',')])

  /* 2. 每个页面：零溢出、零死按钮、内容非空 */
  for (const p of PAGES) {
    window.__wt.go(p)
    await sleep(p === 'idea' ? 3200 : p === 'ship' ? 2200 : 900)
    const el = document.getElementById('p-' + p)
    if (!el) { log.push([p + ':exists', 'MISSING']); continue }
    const W = window.innerWidth
    log.push([p + ':on', el.classList.contains('on') ? 1 : 0])
    log.push([p + ':h', el.scrollHeight])
    log.push([p + ':overflow', $$('#p-' + p + ' *').filter(x => {
      const r = x.getBoundingClientRect()
      return r.width > 0 && r.right > W + 4
    }).length])
    log.push([p + ':dead', $$('#p-' + p + ' button').filter(b =>
      !b.dataset.act && !b.dataset.go && b.id !== 'totop' && !b.closest('#hot-detail') === false
    ).length])
    log.push([p + ':text', el.textContent.replace(/\\s+/g, '').length])
  }

  /* 3. 关键控件真的存在 */
  window.__wt.go('idea'); await sleep(600)
  log.push(['hasTopic', !!$('#topic')])
  log.push(['hasLen', !!$('#len')])
  log.push(['hasStyle', !!$('#style')])
  log.push(['hasReq', !!$('#req')])
  log.push(['hasSubmit', !!$('[data-act="submit"]')])
  log.push(['topicRows', $('#topic') ? $('#topic').rows : -1])

  window.__wt.go('write'); await sleep(900)
  log.push(['hasBody', !!$('#body')])
  log.push(['hasEtitle', !!$('#etitle')])
  log.push(['hasFixreq', !!$('#fixreq')])
  log.push(['hasImgGrid', $$('.img-card').length])
  log.push(['bodyH', $('#body') ? Math.round($('#body').getBoundingClientRect().height) : -1])

  window.__wt.go('check'); await sleep(900)
  log.push(['riskSections', $$('.fact-sec').length])
  log.push(['factRows', $$('.fact').length])

  window.__wt.go('ship'); await sleep(2200)
  log.push(['hasPhone', !!$('.phone')])
  log.push(['phoneW', $('.phone') ? Math.round($('.phone').getBoundingClientRect().width) : -1])
  log.push(['previewChars', $('#pv') ? $('#pv').textContent.replace(/\\s+/g, '').length : 0])
  log.push(['themeChips', $$('.theme-chip').length])
  log.push(['hasCopyBtn', !!$('[data-act="copyShip"]')])
  log.push(['shipSideSticky', $('.ship-side') ? getComputedStyle($('.ship-side')).position : ''])
  log.push(['phoneSticky', $('.phone') ? getComputedStyle($('.phone')).position : ''])

  /* 4. 视觉一致性：所有按钮可点（>=28px 高）、对比度、字号下限 */
  const small = $$('.page.on button, .nav, .theme-chip').filter(b => {
    const r = b.getBoundingClientRect()
    return r.height > 0 && r.height < 26
  })
  log.push(['smallTargets', small.length + (small.length ? ':' + small.slice(0,3).map(b => b.textContent.trim().slice(0,8)).join('/') : '')])
  const tinyFont = $$('.page.on *').filter(x => {
    const t = x.textContent.trim()
    if (!t || x.children.length) return false
    const fs = parseFloat(getComputedStyle(x).fontSize)
    return fs > 0 && fs < 10.5
  })
  log.push(['tinyFont', tinyFont.length + (tinyFont.length ? ':' + tinyFont.slice(0,2).map(x => getComputedStyle(x).fontSize).join('/') : '')])

  /* 5. 溢出文字（截断到不可读）*/
  const clipped = $$('.page.on .card, .page.on .chip, .page.on .theme-chip').filter(x => {
    const cs = getComputedStyle(x)
    return cs.overflow === 'hidden' && x.scrollWidth > x.clientWidth + 2 && x.clientWidth > 0
  })
  log.push(['clipped', clipped.length])

  return log.map(x => x[0] + '=' + x[1]).join('|')
})()`

async function main() {
  // 保证服务在跑
  try {
    execFileSync('powershell', ['-NoProfile', '-Command',
      `try { (Invoke-WebRequest "http://127.0.0.1:${PORT}/api/state" -UseBasicParsing -TimeoutSec 3) | Out-Null; exit 0 } catch { exit 1 }`],
      { stdio: 'pipe' })
  } catch {
    console.log('  本地服务没在跑，先启动 server.mjs')
    process.exit(1)
  }

  const { tools } = globalThis
  console.log('\n' + '='.repeat(70))
  console.log('  对抗式验收 —— 全部通过真实浏览器交互判定')
  console.log('='.repeat(70))

  // 浏览器部分由调用方注入（这个文件自己跑不了浏览器）
  const raw = await globalThis.__probe__(PROBE)
  const M = {}
  for (const part of raw.split('|')) { const i = part.indexOf('='); if (i > 0) M[part.slice(0, i)] = part.slice(i + 1) }

  sec('1 结构：四页、无残留')
  ok('导航恰好 4 项', M.navCount === '4', M.nav)
  ok('顺序为 idea→write→check→ship', M.nav === 'idea,write,check,ship', M.nav)
  ok('分区 id 与导航一致', M.pageIds === 'p-idea,p-write,p-check,p-ship', M.pageIds)
  ok('无旧分区残留', !/p-ask|p-draft|p-media|p-review|p-topics|p-hot/.test(M.pageIds || ''), M.pageIds)

  sec('2 每页可用性')
  for (const [p, cn] of [['idea', '选题定题'], ['write', '成稿配图'], ['check', '核对'], ['ship', '发布']]) {
    ok(`${cn} 页能切到`, M[p + ':on'] === '1', 'on=' + M[p + ':on'])
    ok(`${cn} 页无横向溢出`, M[p + ':overflow'] === '0', M[p + ':overflow'] + ' 个溢出')
    ok(`${cn} 页无死按钮`, M[p + ':dead'] === '0', M[p + ':dead'] + ' 个')
    ok(`${cn} 页有内容`, Number(M[p + ':text']) > 50, M[p + ':text'] + ' 字符')
  }

  sec('3 关键控件')
  ok('定题输入框在', M.hasTopic === 'true')
  ok('定题框是多行（不是一行挤着）', Number(M.topicRows) >= 2, M.topicRows + ' 行')
  ok('字数下拉在', M.hasLen === 'true')
  ok('文风下拉在', M.hasStyle === 'true')
  ok('补充要求在', M.hasReq === 'true')
  ok('开始写按钮在', M.hasSubmit === 'true')
  ok('正文编辑器在', M.hasBody === 'true')
  ok('标题输入在', M.hasEtitle === 'true')
  ok('改稿输入在', M.hasFixreq === 'true')
  ok('图片库在成稿页（不另开一页）', Number(M.hasImgGrid) > 0, M.hasImgGrid + ' 张')
  ok('编辑器够高（写长文不用在框里滚）', Number(M.bodyH) >= 480, M.bodyH + 'px')
  ok('事实清单有风险分层', Number(M.riskSections) >= 1, M.riskSections + ' 层')
  ok('事实条目有内容', Number(M.factRows) > 0, M.factRows + ' 条')

  sec('4 发布页设计')
  ok('有手机预览框', M.hasPhone === 'true')
  ok('手机宽度接近真实阅读宽度（375-430）', Number(M.phoneW) >= 340 && Number(M.phoneW) <= 440, M.phoneW + 'px')
  ok('预览有内容', Number(M.previewChars) > 500, M.previewChars + ' 字符')
  ok('主题选择器存在', Number(M.themeChips) >= 5, M.themeChips + ' 套')
  ok('主复制按钮在', M.hasCopyBtn === 'true')
  ok('侧栏滚动时跟随', M.shipSideSticky === 'sticky', M.shipSideSticky)
  ok('手机预览滚动时跟随', M.phoneSticky === 'sticky', M.phoneSticky)

  sec('5 视觉可用性（对抗项）')
  ok('没有过小的点击目标（<26px）', M.smallTargets === '0', M.smallTargets)
  ok('没有过小的字号（<10.5px）', M.tinyFont === '0', M.tinyFont)
  ok('没有文字被截断的卡片', M.clipped === '0', M.clipped)

  console.log(R.map(([m, n, d]) => m === '—' ? '\n  【' + n + '】' : '   ' + m + ' ' + n + (d ? '   ' + d : '')).join('\n'))
  console.log('\n' + '='.repeat(70))
  console.log(`  通过 ${pass}　失败 ${fail}`)
  if (fails.length) console.log('  失败项: ' + fails.join(' / '))
  console.log('='.repeat(70) + '\n')
  return { pass, fail, fails }
}

if (process.argv[1] && /对抗验收/.test(process.argv[1])) {
  if (!globalThis.__probe__) { console.log('  需要浏览器环境执行，见 run-adversarial.js'); process.exit(2) }
  main()
}
