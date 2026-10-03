/**
 * 交给 AI 的活：构造任务词
 *
 * 分工原则（本项目最重要的架构决定）
 * ────────────────────────────────────────────
 *   本地代码  →  确定性的事：抓数据、排版、复制、存文件
 *   AI        →  需要理解的事：起标题、写摘要、提角度、核事实
 *
 * 之前标题建议是用字符串模板拼的（`${k(0)}背后…`、`quotes[0].slice(0,16)`），
 * 出来的是碎片和跟文章无关的固定文案 —— 用户原话「这太差劲了」。
 * 原因是模板填空做不到语义理解：它不知道这篇文章在讲什么。
 *
 * 所以这里不拼标题，只做一件事：把「当前正文 + 事实清单 + 风格 + 约束」
 * 整理成一段清楚的指令，让 AI 去做。人只需要复制粘贴。
 */

/** 稿子里的关键句 —— 给 AI 当锚点，不是标题 */
function keyLines(text, limit = 6) {
  return text
    .split(/\n+/)
    .map(s => s.replace(/^#{1,6}\s*/, '').replace(/\*\*/g, '').trim())
    .filter(s => s.length >= 12 && s.length <= 60)
    .filter(s => !/^[|>\-]/.test(s) && !/^!\[/.test(s))
    .filter(s => /[。！？]$/.test(s))
    .slice(0, limit)
}

/** 事实清单：已核实的和待核的分开，AI 才知道哪些能直接用 */
function factBlock(facts, limit = 12) {
  const all = Array.isArray(facts) ? facts : []
  const ok = all.filter(f => f.verdict === 'ok')
  const wait = all.filter(f => f.verdict !== 'ok')
  const pick = arr => arr.slice(0, limit).map(f => {
    const mark = f.verdict === 'ok' ? '已核实' : '待核'
    return `  · [${mark}] ${f.label}：${f.value}${f.ctx ? '（' + f.ctx + '）' : ''}`
  })
  const out = []
  if (ok.length) out.push('已核实的事实（直接用，不要改）：', ...pick(ok))
  if (wait.length) out.push('尚未核实的事实（慎用或避开）：', ...pick(wait))
  return out.length ? out.join('\n') : '（事实清单是空的，正文里的数字你自己判断可信度）'
}

/**
 * 出爆款标题的要求
 * @param {object} ctx {body, facts}
 * @param {object} st  {n, brief}
 */
export function titleTask(ctx, st) {
  const body = String(ctx.body || '')
  const chars = body.replace(/\s/g, '').length
  return [
    '给我这篇稿子起标题。',
    '',
    `文风：${st.n || '你判断'}（${st.brief || '根据这篇稿子自己的调性'}）`,
    '',
    '读者是中老年人群，标题要一眼看懂、口语化，不要文艺。',
    '',
    '硬要求：',
    '1. 每个标题都是不同方向，不要都是同一类',
    '2. 每个标题都必须和这篇稿子的具体内容有关 —— 不要放之四海皆准的万能句',
    '3. 长度 12~24 字，手机上一行能看完',
    '4. 不要出现「本文」「我们来看」「揭秘」这类词',
    '5. 用正文里真实出现的事实、数字、人物，不要编',
    '6. 不要用双引号把整句包起来',
    '7. 不要写「先说结论」「免得有人误解」这类预设 —— 标题也一样',
    '',
    '给我 6 个不同方向的完整标题，按推荐顺序排，最能打的放第一个。',
    '每个后面用括号标一句「为什么是这个角度」，我好挑。',
    '',
    '─────── 正文（' + chars + ' 字）───────',
    body.trim(),
    '',
    '─────── 事实清单 ───────',
    factBlock(ctx.facts),
    '',
    '─────── 稿子里的关键句（供你判断方向，不是让你直接抄）───────',
    keyLines(body).map(s => '  ' + s).join('\n')
  ].join('\n')
}

/** 出摘要（公众号那 120 字）的要求 */
export function abstractTask(ctx) {
  const body = String(ctx.body || '')
  return [
    '给这篇稿子写公众号摘要。',
    '',
    '硬要求：',
    '1. 120 字以内',
    '2. 第一句就要让人想点开，不要写「本文讲述」「最近有这样一个事」这种开场',
    '3. 用具体的数字或事实，不要空泛的形容词',
    '4. 结尾不要升华，不要「值得深思」「引发热议」',
    '5. 只给 3 版，让我挑',
    '',
    '─────── 正文（' + body.replace(/\s/g, '').length + ' 字）───────',
    body.trim(),
    '',
    '─────── 事实清单 ───────',
    factBlock(ctx.facts)
  ].join('\n')
}

/** 提切入角度的要求（热点页用） */
export function angleTask(ctx, title, summary) {
  return [
    `我要写「${title}」这个题，给我 5 个不同的切入角度。`,
    '',
    summary ? '这条的摘要：\n' + summary : '',
    '硬要求：',
    '1. 每个角度是一句话，说清楚「我要从哪个角度切，为什么别人没这么切」',
    '2. 5 个角度必须是不同的方向，不能都是「分析原因」',
    '3. 不要写「可以从以下几个方面」这种废话',
    '4. 其中至少 2 个是反常识的（大部分人以为 A，其实不是 A）',
    '5. 避开会写烂的角度（已经被写烂的那种）',
    '',
    '每个角度后面标一个括号，写清楚「写出来大概是什么样子」。'
  ].filter(Boolean).join('\n')
}