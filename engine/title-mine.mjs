/**
 * 读全文 → 出「题材清单」
 *
 * ════════ 为什么要有这一步 ════════
 *
 * 上一版我手写标题，出的六条全是「从某一段里摘一句原话」：
 *   碗柜关不上了            第一节
 *   每天早上煮一锅粥盛两碗   第九节
 *   火塘一停，木头在水汽里泡着 第四节
 *
 * 为什么总是这样？因为写标题的时候，脑子里是「找一个有画面感的句子」，
 * 而有画面感的句子通常就在某一段里。
 *
 * ★ 解法不是「提醒自己要基于全文」——
 *   提醒过三轮了，每一轮都还是摘句。
 *   解法是先把「全文有什么」列出来，再从里面挑。
 *   列表里没有的东西，挑不出来。
 *
 * 这一步只做确定性的事：切小节、抽事实、抽人物、抽金句、算线索。
 * 「哪个角度最能打」交给 AI，但【角度必须挂在一个清单项上】。
 */
import { fileURLToPath } from 'url'
import path from 'path'
import fs from 'fs'

const CN_NUM = '一二三四五六七八九十'
const DIR = path.dirname(fileURLToPath(import.meta.url))

/** 把正文切成小节。
 *  ★ 两件事必须在这里做对，否则后面全错：
 *    一 文末的「来源」表不是小节 ——
 *      它是 --- 分隔线之后的表格，包含竖线，
 *      算进来会污染主题词统计（来源名的字频最高）。
 *    二 小节标题里已经带了自己的编号（「一、事情是这样」），
 *      再加一层序号就变成「一 一、事情是这样」。 */
export function sections(body) {
  const text = String(body || '')
  /* 文末的来源表：从 --- 或者「### 来源」开始，全部不算正文 */
  const cut = text.search(/^---$/m)
  const mainBody = cut > 0 ? text.slice(0, cut) : text

  const out = []
  const lines = mainBody.split(/\r?\n/)
  let cur = null
  lines.forEach(l => {
    const m = l.match(/^##\s*(.+)$/)
    if (m) {
      cur = { raw: m[1].trim(), text: '' }
      out.push(cur)
      return
    }
    if (cur) cur.text += l + '\n'
  })
  if (!out.length) out.push({ raw: '', text: mainBody })

  return out.map((s, i) => {
    /* 标题里已经有的编号不要再加 */
    let t = s.raw
    t = t.replace(/^[（(]?[一二三四五六七八九十\d]+[）)、.．]?\s*[、.]?\s*/, '')
    const plain = s.text.replace(/[*_`>#]/g, '').replace(/\s+/g, ' ').trim()
    return {
      no: CN_NUM[i] || String(i + 1),
      title: t || ('第' + (i + 1) + '节'),
      raw: s.raw,
      plain,
      chars: s.text.replace(/\s/g, '').length
    }
  })
}

/** 抽正文里出现过的事实 */
export function facts(body) {
  const clean = String(body || '').replace(/[*_`>#]/g, '')
  const out = []
  const seen = new Set()

  /* ★ 上一版把「一 / 二 / 三十」这类也算成事实 ——
     因为 {1,2} 量词那条正则里 [一二三四五六七八九十百千两半\d]+ 能匹配单个「一」，
     而正文里到处都是「一会儿」「一下」。
     数字事实至少要两位汉字或者一个阿拉伯数字。 */
  const NUM = [
    { re: /([一二三四五六七八九十百千两半]{2,}|\d{1,4})\s*(年|天|次|遍|人|家|块|层|道|条|岁|米)/g, k: '量' },
    { re: /(\d+\s*(?:年|次|个|人|倍|成|米|厘米|毫米|度|天|块))/g, k: '数' },
    { re: /([一二三四五六七八九十]分之[一二三四五六七八九十]+|\d+%|\d+\s*次)/g, k: '比' }
  ]
  NUM.forEach(({ re, k }) => {
    let m
    while ((m = re.exec(clean))) {
      const t = m[1] + (m[2] || '')
      if (seen.has(t)) continue
      seen.add(t)
      out.push({ kind: k, text: t })
    }
  })

  const PLACE = /(云南|昆明|大摆衣村|四川|阿坝|藏族|日本|英国|欧洲)/g
  let m
  while ((m = PLACE.exec(clean))) {
    const t = m[1]
    if (seen.has(t)) continue
    seen.add(t)
    out.push({ kind: '地', text: t })
  }

  return out
}

/** 抽人物 */
export function people(body) {
  const clean = String(body || '').replace(/[*_`>#]/g, '')
  const roles = []
  const seen = new Set()
  const ROLE = /(老人|邻居|儿子|女儿|老伴|母亲|父亲|师傅|徒弟|记者|村民|孩子|主人)/g
  let m
  while ((m = ROLE.exec(clean))) {
    if (seen.has(m[1])) continue
    seen.add(m[1])
    roles.push(m[1])
  }

  const actions = []
  const ACT = /[^。！？\n]{0,12}(他|她|老人|邻居|儿子|女儿|母亲|父亲|老伴|师傅|徒弟)[^。！？\n]{4,40}/g
  while ((m = ACT.exec(clean))) {
    const s = m[0].trim()
    if (s.length >= 10 && s.length <= 46) actions.push(s)
  }

  return { roles, actions: [...new Set(actions)].slice(0, 14) }
}

/** 抽加粗句 —— 作者自己标出来的重点 */
export function boldLines(body) {
  const out = []
  const re = /\*\*([^*\n]{6,80})\*\*/g
  let m
  while ((m = re.exec(String(body || '')))) out.push(m[1].trim())
  return out
}

/** 抽有画面感的短句 */
export function vividLines(body) {
  const out = []
  String(body || '')
    .split(/[。！？\n]/)
    .forEach(s => {
      s = s.replace(/[*_`>#]/g, '').replace(/^#+\s*/, '').trim()
      if (s.length < 8 || s.length > 22) return
      if (/(不是|没有|而是|只有|因为|所以)/.test(s)) return
      if (!/[一-龥]{3}/.test(s)) return
      out.push(s)
    })
  return [...new Set(out)]
}

/**
 * 找「两线交叉处」—— 全文真正的主题所在
 *
 * ★ 这是「基于全文」的核心。
 *   逐节看，每一节都是单线的；
 *   只在某一节里找素材，必然摘到单线的东西。
 *   真正的标题在【至少两个小节都出现的主题】上。
 *
 * ★ 上一版吐出来几乎只有「到头」，因为它靠「按标点切词块」——
 *   切出来的块大多是「有人住，就有人修」这种半句，
 *   或者「三十年」这种数字，不是主题。
 *
 * ★ 再一版（滑窗 2 字组）吐出来是「子，一」「关不上了」这种跨标点碎片。
 *
 *   根因：中文没有空格，切词本身就是件难事，
 *   靠正则切出来的一定不准。
 *
 *   换判据：不用词，用【单字】。
 *   单字不会切错 —— 「人」就是「人」。
 *   一个字出现在 5 个以上小节里，那一定是贯穿全文的主题。
 *   这一版实测：人 8 节 / 房 8 节 / 一 9 节 / 了 10 节 …
 *   排掉高频虚词之后剩下「人」「房」「年」这几个真主题。
 */
const STOP = new Set('的了在是和就不人都有一上也很到说要去你会着没看好自己这那'.split(''))

export function crossings(secs) {
  const charSecs = new Map()
  secs.forEach(s => {
    const c = s.plain.replace(/[^一-龥]/g, '')
    new Set(c).forEach(ch => {
      if (STOP.has(ch)) return
      if (!charSecs.has(ch)) charSecs.set(ch, new Set())
      charSecs.get(ch).add(s.no)
    })
  })

  /* 一个字主题 → 找出它在正文里最常见的搭配（2~4 字）
     ★ 必须【按标点分句之后再滑窗】——
       直接在拼起来的全文上滑窗，切口会跨过句号逗号，
       于是「一」匹配出「一年一次。空了几个月」这种跨句碎片。
       实测踩过：输出里全是「一年一」「的是厨」这种没意义的组。 */
  const pieces = []
  secs.forEach(s => {
    s.plain.split(/[，。！？、；：""''（）()《》…—\-\s,.!?;:]/).forEach(x => {
      if (x) pieces.push(x)
    })
  })

  const phraseOf = ch => {
    for (let L = 4; L >= 2; L--) {
      const cands = new Map()
      pieces.forEach(p => {
        const c = p.replace(/[^一-龥]/g, '')
        for (let i = 0; i + L <= c.length; i++) {
          const t = c.slice(i, i + L)
          if (t.indexOf(ch) < 0) continue
          cands.set(t, (cands.get(t) || 0) + 1)
        }
      })
      if (cands.size) {
        const best = [...cands.entries()].sort((a, b) => b[1] - a[1])[0]
        return best[0]
      }
    }
    return ch
  }

  /* ★ 这函数最终只输出「哪些字贯穿全文」，不输出词组。
     中间试过输出词组（「房 → 的是厨房」「住 → 住了三十」），
     全是任意 4 字窗口，不是词：
       中文没有空格，从字符流里滑出 4 个字，
       十有八九横跨了词边界，「的是厨房」根本不是一个词组。

     而「哪些字贯穿 10 个小节」本身就是最有价值的信息 ——
     它直接告诉 AI：这篇稿子的主题是这几个字，
     标题应该围绕这几个字组织，而不是从某一段里摘句子。

     实测这篇稿子贯穿全文的字：年 房 住 老 屋 水 人 ……
     一眼看过去就知道主线是「房子和时间」，这是任何单段都看不出来的。 */
  return [...charSecs.entries()]
    .filter(([, set]) => set.size >= 3)
    .sort((a, b) => b[1].size - a[1].size)
    .slice(0, 16)
    .map(([ch, set]) => ({
      char: ch,
      sections: set.size,
      /* 顺带给一个最常见搭配，AI 可以参考 —— 但不保证是词 */
      phrase: phraseOf(ch)
    }))
}

/** 一次性列全 */
export function outline(body) {
  const secs = sections(body)
  const p = people(body)
  return {
    chars: String(body || '').replace(/\s/g, '').length,
    sections: secs.map(s => ({ no: s.no, title: s.title, chars: s.chars })),
    facts: facts(body).slice(0, 18),
    roles: [...new Set(p.roles)],
    actions: p.actions,
    bold: boldLines(body).slice(0, 15),
    vivid: vividLines(body).slice(0, 22),
    crossings: crossings(secs)
  }
}

/* ════════════════════════════════════════════════════════════
   命令行：直接看这份稿子能出什么料
   node engine\title-mine.mjs
   ════════════════════════════════════════════════════════════ */
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  const f = process.argv[2] || path.join(DIR, '..', 'data', 'body.md')
  const body = fs.readFileSync(f, 'utf8')
  const o = outline(body)

  console.log('═'.repeat(64))
  console.log(' 标题素材清单 · ' + path.basename(f) + ' · ' + o.chars + ' 字')
  console.log('═'.repeat(64))
  console.log('')
  console.log('【一】小节')
  o.sections.forEach(s => console.log('  ' + s.no + '、' + s.title + '  ' + s.chars + ' 字'))
  console.log('')
  console.log('【二】贯穿全文的字（★ 这几个字是这篇稿子的主线 —— 标题要围着它们组织）')
  console.log('  ' + o.crossings.map(c => c.char).join(' ') +
    '     （' + o.crossings.map(c => c.char + '跨' + c.sections + '节').join('  ') + '）')
  console.log('')
  console.log('【三】事实')
  console.log('  ' + o.facts.map(f => f.text).join('　'))
  console.log('')
  console.log('【四】人物')
  console.log('  身份：' + (o.roles.join('　') || '无'))
  console.log('  动作：')
  o.actions.forEach(a => console.log('    ' + a))
  console.log('')
  console.log('【五】加粗句（作者标出来的重点）')
  o.bold.forEach(b => console.log('  ' + b))
  console.log('')
  console.log('【六】有画面的短句')
  o.vivid.forEach(v => console.log('  ' + v))
  console.log('')
  console.log('★ 标题必须同时用到【二】里的交叉点 + 【三】或【四】的料。')
  console.log('  只用【六】里的短句，那是摘句，不是标题。')
}