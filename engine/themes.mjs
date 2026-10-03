/**
 * 排版主题 —— 2026-09-30 重写
 *
 * 为什么要重写：旧版 11 套主题里有 7 套结构完全一样（实测：
 * 规则数都是 21，结构标记都只有「居中」），只是字号和配色不同。
 * 用户反馈「基本每种样式都一样」，属实。
 *
 * 重写的三条硬规矩：
 *
 * 1. 每套主题必须有【唯一的结构特征】，不能只换颜色。
 *    结构特征 = 标题形态 / 正文缩进 / 引语形态 / 列表形态 / 分隔符
 *    自检会检查这条，不合格直接报错。
 *
 * 2. 字号、行高、正文色、强调色全部走 CSS 变量（--fs / --lh / --fc / --ac），
 *    界面上才能真正调得动。写死的话控件就是摆设。
 *
 * 3. 禁用双栏（column-count）。报纸双栏在手机上会挤成两列细缝，
 *    公众号里也不能用 —— 用户明确要求去掉。
 */

/* ---------- 共用骨架 ---------- */
/* 每个主题都从这里取基础规则，避免重复；主题只声明自己的差异 */
const BASE = `
a{color:var(--ac);text-decoration:none;border-bottom:1px solid var(--ac-bd,rgba(0,0,0,.12))}
strong{font-weight:700;color:var(--strong,var(--fc))}
em{font-style:italic}
hr{border:0}
img{max-width:100%;display:block;margin:0 auto 10px;border-radius:var(--img-r,3px)}
figure{margin:0 0 22px}
figcaption{font-size:calc(var(--fs) * .82);color:var(--cap,var(--fc-o));text-align:center;margin:0 0 20px}
table{border-collapse:collapse;width:100%;margin:0 0 20px;font-size:calc(var(--fs) * .94)}
th,td{border:1px solid var(--td-bd,rgba(0,0,0,.14));padding:9px 12px;text-align:left}
code{background:var(--code-bg,#f6f6f6);padding:2px 5px;border-radius:3px;font-size:calc(var(--fs) * .94)}
pre{background:var(--code-bg,#f6f6f6);padding:14px;border-radius:5px;overflow-x:auto;margin:0 0 20px;line-height:1.6}
pre code{background:none;padding:0}
blockquote{margin:0 0 var(--fsb,10px)}
ul,ol{margin:0 0 var(--fsb,10px)}
li{margin:0 0 7px}
`

/* 组装一个主题：变量默认值 + 差异 CSS */
function T(name, tag, v, diff) {
  const vars = [
    `--fs:${v.fs}px`, `--lh:${v.lh}`, `--fc:${v.fc}`,
    /* 段间距。刻意给小 —— 段落之间留大片空白是老排版习惯，
       在手机上看着松散，读者要重新对行。行距负责可读性。 */
    `--fsb:${v.fsb != null ? v.fsb : 10}px`,
    v.ac ? `--ac:${v.ac}` : '',
    v.strong ? `--strong:${v.strong}` : '',
    v.cap ? `--cap:${v.cap}` : '',
    v.codebg ? `--code-bg:${v.codebg}` : '',
    v.tdbd ? `--td-bd:${v.tdbd}` : '',
    v.imgR != null ? `--img-r:${v.imgR}px` : ''
  ].filter(Boolean).join(';')

  // --bg 是纸底色默认值，界面上「纸底色」控件会覆盖它
  const head = `section{font-size:var(--fs);line-height:var(--lh);color:var(--fc);word-break:break-word;background:var(--paper,${v.bg});${v.extra || ''}}`
  return {
    name, tag,
    preview: { bg: v.bg, fs: v.fs, lh: v.lh, fc: v.fc, ac: v.ac || v.fc },
    colors: { bg: v.bg, fc: v.fc, ac: v.ac || v.fc },
    feature: v.feature,          // 结构特征，自检要用
    css: `:root{${vars}}\n${head}\n${BASE}\n${diff || ''}`
  }
}

export const THEMES = {
  /* ── 1. 结构特征：首行缩进 2em（传统报刊，唯一用缩进的现代主题） ── */
  classic: T('经典', '首行缩进 · 报刊感', {
    feature: '首行缩进2em', bg: '#fff', fs: 16.5, lh: 1.8, fc: '#333', ac: '#07c160', imgR: 2
  }, `
/* 唯一保留首行缩进 2em 的主题 —— 报纸正文就是这么排的 */
p{margin:0 0 var(--fsb);text-indent:2em}
h1{font-size:calc(var(--fs) * 1.45);font-weight:700;margin:0 0 26px;padding-bottom:12px;border-bottom:2px solid var(--fc);line-height:1.4;text-indent:0}
h2{font-size:calc(var(--fs) * 1.24);font-weight:700;margin:32px 0 14px;padding-bottom:8px;border-bottom:1px solid var(--ac);line-height:1.45;text-indent:0}
h3{font-size:calc(var(--fs) * 1.1);font-weight:700;margin:24px 0 10px;text-indent:0}
blockquote{padding:14px 18px;background:#f7f7f7;border-left:3px solid #d0d0d0;color:#5f5f5f;font-size:calc(var(--fs) * .96)}
blockquote p{text-indent:0}
hr{margin:28px auto;width:60px;height:2px;background:var(--ac)}
`),

  /* ── 2. 结构特征：居中大题 + 首段字母间距（杂志） ── */
  elegant: T('优雅', '居中大题 · 杂志感', {
    feature: '居中大题+疏排', bg: '#fffdf9', fs: 17.5, lh: 2, fc: '#3a352e', ac: '#b8860b', strong: '#1a1613', cap: '#a09684', codebg: '#f8f4ea', tdbd: '#e5ddcc'
  }, `
/* 杂志感的两根支柱：标题居中大留白 + 首段拉开字距。
   首段疏排是这一套独有的，其他主题都没有。 */
p{margin:0 0 var(--fsb)}
p:first-of-type{letter-spacing:.14em;color:#4a443c}
h1{font-size:calc(var(--fs) * 1.5);font-weight:700;margin:0 0 40px;line-height:1.55;text-align:center;letter-spacing:3px}
h1::after{content:'';display:block;width:32px;height:1px;background:var(--ac);margin:20px auto 0}
h2{font-size:calc(var(--fs) * 1.2);font-weight:700;margin:48px 0 20px;line-height:1.7;text-align:center;
  color:var(--ac);letter-spacing:2px;position:relative}
h3{font-size:calc(var(--fs) * 1.08);font-weight:700;margin:32px 0 14px;text-align:center;letter-spacing:1px;color:#5a5140}
blockquote{padding:22px 26px;background:#f8f4ea;border:none;color:#5a5140;font-style:italic;
  border-top:1px solid var(--ac);border-bottom:1px solid var(--ac);text-align:center;letter-spacing:.05em}
hr{margin:44px auto;width:36px;height:1px;background:var(--ac)}
`),

  /* ── 3. 结构特征：小标题前置方块 + 零段距（密排工具文） ── */
  compact: T('紧凑', '零段距 · 长文友好', {
    feature: '零段距+方块小标题', bg: '#fff', fs: 17.5, lh: 1.95, fsb: 0, fc: '#4a4a4a', ac: '#2f6b8f', strong: '#2f6b8f'
  }, `
/* 唯一把段间距压到 0 的：靠缩进层级而非留白分段，长文省一半高度 */
p{margin:0;text-indent:2em;padding:2px 0}
h1{font-size:calc(var(--fs) * 1.4);font-weight:700;margin:0 0 16px;padding-bottom:10px;border-bottom:2px solid var(--ac);line-height:1.4}
h2{font-size:calc(var(--fs) * 1.15);font-weight:700;margin:20px 0 8px;line-height:1.45;
  display:flex;align-items:center;gap:8px;padding-left:10px;background:#f2f6f9}
h2::before{content:'';width:4px;height:1.05em;background:var(--ac);flex:0 0 auto}
h3{font-size:calc(var(--fs) * 1.04);font-weight:700;margin:16px 0 6px;color:var(--ac);padding-left:10px}
blockquote{padding:8px 12px;border-left:2px solid var(--ac);color:#666;font-size:calc(var(--fs) * .95);background:none;margin:0 0 12px}
hr{margin:18px 0;height:1px;background:rgba(0,0,0,.1)}
`),

  /* ── 4. 结构特征：暗底 + 发光标题 + 无缩进（终端感，与 paper 的悬挂缩进区分） ── */
  dark: T('暗色', '深底发光 · 无缩进', {
    feature: '深底发光+无缩进', bg: '#1c1a17', fs: 16.5, lh: 1.85, fc: '#c9c2b4', ac: '#7fc4a0', strong: '#e8e2d6', cap: '#8d8579', codebg: '#2a2723', tdbd: '#3a3630', imgR: 6
  }, `
section{background:var(--paper,#1c1a17);padding:34px 26px;border-radius:8px;box-shadow:inset 0 0 60px rgba(0,0,0,.4)}
p{margin:0 0 var(--fsb)}
h1{font-size:calc(var(--fs) * 1.45);font-weight:700;margin:0 0 26px;line-height:1.4;
  letter-spacing:.04em;text-shadow:0 0 18px rgba(127,196,160,.35)}
h2{font-size:calc(var(--fs) * 1.2);font-weight:700;margin:34px 0 16px;line-height:1.45;
  color:var(--ac);letter-spacing:.06em;position:relative;padding-left:18px}
h2::before{content:'';position:absolute;left:0;top:.42em;width:8px;height:8px;
  background:var(--ac);border-radius:50%;box-shadow:0 0 10px var(--ac)}
h3{font-size:calc(var(--fs) * 1.08);font-weight:600;margin:26px 0 12px;color:#e8e2d6;letter-spacing:.03em}
blockquote{padding:16px 20px;background:#2a2723;border:none;border-left:2px solid #4a9e78;color:#b3aca0}
hr{margin:32px 0;height:1px;background:linear-gradient(90deg,transparent,#3a3630,transparent)}
`),

  /* ── 5. 结构特征：小节序号 + 悬挂缩进（替代原「纸刊」双栏） ── */
  paper: T('纸刊', '序号小节 · 暖纸感', {
    feature: '序号小节+悬挂缩进', bg: '#f2ede3', fs: 16.5, lh: 1.9, fc: '#4a4438', ac: '#7a6242', strong: '#2d2921', cap: '#948974', codebg: '#e8e1d2', tdbd: '#d8cbb2', imgR: 4
  }, `
section{background:var(--paper,#f2ede3);padding:32px 24px;border-radius:6px}
/* 和别的暖底主题不同：小节标题自带序号，正文悬挂缩进对齐 */
section{counter-reset:sec}
p{margin:0 0 var(--fsb);padding-left:1.6em;text-indent:-1.6em}
h1{font-size:calc(var(--fs) * 1.42);font-weight:700;margin:0 0 28px;line-height:1.4;letter-spacing:1px;padding-left:1.6em;text-indent:-1.6em}
h2{font-size:calc(var(--fs) * 1.18);font-weight:700;margin:36px 0 16px;line-height:1.5;
  counter-increment:sec;padding-left:1.6em;text-indent:-1.6em}
h2::before{content:'第 ' counter(sec,decimal-leading-zero) ' 节';display:inline-block;
  margin-right:.7em;font-size:.72em;font-weight:600;color:var(--ac);vertical-align:.15em;letter-spacing:.1em}
h3{font-size:calc(var(--fs) * 1.06);font-weight:700;margin:26px 0 12px;padding-left:1.6em;text-indent:-1.6em}
blockquote{padding:16px 20px;background:#e8e1d2;border:none;border-top:1px solid var(--ac);border-bottom:1px solid var(--ac);color:#5c5445;font-style:italic}
hr{margin:30px auto;width:40px;height:1px;background:#c9b896}
`),

  /* ── 7. 结构特征：左轴线 + 小标题加圆点（手记体，与 elegant 的居中大标题区分） ── */
  night: T('夜读', '左轴线 · 手记体', {
    feature: '左轴线+圆点', bg: '#f7f3ec', fs: 17.5, lh: 1.95, fc: '#4a4438', ac: '#8a6a3d', strong: '#2d2921', cap: '#9a9080', codebg: '#ece5d8', tdbd: '#ded3c0'
  }, `
section{background:var(--paper,#f7f3ec);padding:34px 26px;border-radius:8px;border-left:3px solid var(--ac)}
p{margin:0 0 var(--fsb)}
h1{font-size:calc(var(--fs) * 1.4);font-weight:700;margin:0 0 30px;line-height:1.45;
  padding-bottom:14px;border-bottom:1px dashed #cbbfa6}
h2{font-size:calc(var(--fs) * 1.16);font-weight:700;margin:38px 0 16px;line-height:1.55;
  color:#6b5838;display:flex;align-items:baseline;gap:10px}
h2::before{content:'';width:7px;height:7px;border-radius:50%;background:var(--ac);flex:0 0 auto;transform:translateY(-.2em)}
h3{font-size:calc(var(--fs) * 1.05);font-weight:600;margin:28px 0 12px;color:#6b5838;padding-left:1em}
blockquote{padding:18px 22px;background:#ece5d8;border-radius:0 10px 10px 0;color:#5a5244;border-left:3px solid #c3ac85}
hr{margin:34px 0;height:1px;background:repeating-linear-gradient(90deg,#cbbfa6 0 8px,transparent 8px 16px)}
`),

  /* ── 8. 结构特征：首字下沉（特稿） ── */
  dropcap: T('首字', '首字下沉 · 特稿感', {
    feature: '首字下沉', bg: '#fff', fs: 17.5, lh: 1.9, fc: '#2f2f2f', ac: '#8c2f2f', strong: '#8c2f2f', cap: '#a08d86', codebg: '#faf0ec', tdbd: '#eadfda'
  }, `
p{margin:0 0 var(--fsb)}
p:first-of-type::first-letter{
  float:left;font-size:calc(var(--fs) * 3.6);line-height:.9;font-weight:700;
  margin:6px 12px 0 0;color:var(--ac);
}
h1{font-size:calc(var(--fs) * 1.55);font-weight:800;margin:0 0 24px;line-height:1.35;letter-spacing:-.5px}
h2{font-size:calc(var(--fs) * 1.25);font-weight:700;margin:36px 0 16px;line-height:1.4;position:relative;padding-left:14px}
h2::before{content:'';position:absolute;left:0;top:50%;transform:translateY(-50%);
  width:4px;height:1em;background:var(--ac);border-radius:2px}
h3{font-size:calc(var(--fs) * 1.08);font-weight:700;margin:26px 0 12px}
blockquote{padding:16px 20px;background:#faf6f2;border-left:3px solid var(--ac);color:#5a4a44;font-style:italic}
hr{margin:34px auto;width:44px;height:2px;background:var(--ac)}
`),

  /* ── 9. 结构特征：无框极简（几乎不装饰） ── */
  plain: T('极简', '无框 · 只靠留白', {
    feature: '无框留白', bg: '#fff', fs: 17.5, lh: 2.05, fc: '#1a1a1a', ac: '#1a1a1a', strong: '#1a1a1a', cap: '#999', tdbd: '#e5e5e5'
  }, `
p{margin:0 0 30px}
h1{font-size:calc(var(--fs) * 1.35);font-weight:600;margin:0 0 36px;line-height:1.6;text-align:center}
h2{font-size:calc(var(--fs) * 1.12);font-weight:600;margin:52px 0 22px;line-height:1.7;text-align:center;color:#555}
h3{font-size:calc(var(--fs) * 1.02);font-weight:600;margin:34px 0 14px;color:#555}
blockquote{padding:0 0 0 18px;border-left:2px solid #ddd;color:#666;font-size:calc(var(--fs) * .97)}
hr{margin:50px auto;width:24px;height:1px;background:#ddd}
`),

  /* ── 10. 结构特征：引语通栏大字 + 标题渐变条（评论/观点） ── */
  voice: T('观点', '通栏大字 · 适合评论', {
    feature: '通栏大字引语', bg: '#fff', fs: 17.5, lh: 1.85, fc: '#26282b', ac: '#1c4ed8', strong: '#1c4ed8', cap: '#94a3b8', codebg: '#f5f7ff', tdbd: '#e2e8f5'
  }, `
p{margin:0 0 var(--fsb)}
h1{font-size:calc(var(--fs) * 1.55);font-weight:900;margin:0 0 26px;line-height:1.35;letter-spacing:-.5px}
h2{font-size:calc(var(--fs) * 1.22);font-weight:800;margin:36px 0 16px;line-height:1.45;
  padding:14px 18px;background:linear-gradient(100deg,#1c4ed8,#3b82f6);color:#fff;
  border-radius:6px;letter-spacing:.02em}
h3{font-size:calc(var(--fs) * 1.1);font-weight:800;margin:26px 0 12px;color:var(--ac)}
/* 引语占满整行、字号明显放大 —— 和 list 的编号卡片是两回事 */
blockquote{margin:0 0 30px;padding:26px 4px;border-top:2px solid var(--ac);border-bottom:2px solid var(--ac);background:none}
blockquote p{font-size:calc(var(--fs) * 1.18);line-height:1.7;color:#1e2a4a;margin:0 0 12px;font-weight:600;letter-spacing:.01em}
blockquote p:last-child{margin:0}
hr{margin:36px auto;width:8px;height:8px;background:var(--ac);border-radius:50%}
`),

  /* ── 11. 结构特征：编号卡片列表（盘点/清单） ── */
  list: T('清单', '编号列表 · 适合盘点', {
    feature: '编号列表', bg: '#fff', fs: 16.5, lh: 1.8, fc: '#333', ac: '#0f766e', strong: '#0f766e', cap: '#8aa0a0', codebg: '#f0fdfa', tdbd: '#e8edf0'
  }, `
section{counter-reset:sec n}
p{margin:0 0 var(--fsb)}
h1{font-size:calc(var(--fs) * 1.5);font-weight:800;margin:0 0 24px;line-height:1.4;
  padding-bottom:14px;border-bottom:3px double var(--ac)}
h2{font-size:calc(var(--fs) * 1.22);font-weight:700;margin:32px 0 16px;line-height:1.4;
  counter-increment:sec;display:flex;align-items:center;gap:10px}
h2::before{content:counter(sec,decimal-leading-zero);background:var(--ac);color:#fff;
  font-size:.68em;font-weight:700;padding:2px 7px;border-radius:4px;letter-spacing:.05em;flex:0 0 auto}
h3{font-size:calc(var(--fs) * 1.08);font-weight:700;margin:24px 0 12px}
blockquote{padding:14px 18px;background:#f0fdfa;border-left:3px solid var(--ac);color:#3f5f5b}
ul,ol{margin:0 0 22px;padding:0;list-style:none;counter-reset:n}
li{counter-increment:n;position:relative;margin:0 0 10px;padding:14px 16px 14px 46px;
  background:#f8fafc;border:1px solid #e8edf0;border-radius:8px}
li::before{content:counter(n,decimal-leading-zero);position:absolute;left:14px;top:13px;
  font-size:12px;font-weight:700;color:var(--ac);font-variant-numeric:tabular-nums}
hr{margin:30px 0;height:1px;background:#e8edf0}
`),

  /* ── 12. 结构特征：彩底标题块 + 隔行变色（大字 · 高对比 · 花花绿绿）
     用户原话「可以有一个花花绿绿的一个什么版本，就是因为给老年人看的嘛」。

     这套的设计依据是老年读者的实际困难，不是审美偏好：
     视力衰退最怕两件事 —— 字小、和颜色对比不够。
     所以正文 19px（其他主题 15~17.5）、纯黑字、段距放到 2 倍；
     「花花绿绿」落在标题和小节色块上，正文仍是黑字 ——
     正文上色会适得其反，越花越读不动。
     隔行浅底是为了让眼睛不容易串行，老花眼看长段落最费劲。 */
  vivid: T('大字版', '大字 · 高对比 · 彩色块', {
    feature: '彩色标题块+隔行底色', bg: '#fffdf6', fs: 19, lh: 2, fc: '#111111', ac: '#c0392b', strong: '#b8860b', cap: '#7a6a55', codebg: '#fff4d6', tdbd: '#d9c9a8'
  }, `
/* 正文大、段距松、纯黑字 —— 这三样是不可让的 */
p{margin:0 0 calc(var(--fsb) * 1.6);padding:14px 10px;border-radius:8px}
/* 隔行变色：老花眼看长段落最容易串行，一行一个底色能压住 */
p:nth-of-type(even){background:#fff8e8}
p:nth-of-type(odd){background:#fffdf6}
h1{font-size:calc(var(--fs) * 1.45);font-weight:900;margin:0 0 30px;line-height:1.4;
  padding:18px 20px;background:linear-gradient(180deg,#fff1e8,#ffe0cc);
  border:3px solid var(--ac);border-radius:10px;text-indent:0;color:#8c2f1f}
h2{font-size:calc(var(--fs) * 1.22);font-weight:900;margin:38px 0 18px;line-height:1.45;text-indent:0;
  padding:12px 18px;background:#ffe9a8;border-left:8px solid var(--ac);border-radius:0 8px 8px 0;color:#6b4423}
h3{font-size:calc(var(--fs) * 1.1);font-weight:800;margin:30px 0 14px;text-indent:0;color:#1a6b4a}
blockquote{padding:20px 22px;background:#e8f4ff;border:3px solid #2c6fb5;border-radius:10px;color:#123a63;font-weight:600}
blockquote p{text-indent:0;padding:0;background:none}
strong{color:#a8320f}
/* 醒目色块：每个分隔点都告诉你「这里换个话题」 */
hr{margin:40px auto;width:100%;height:0;border-top:4px dashed #e0b23c}
`)
}

export default THEMES
