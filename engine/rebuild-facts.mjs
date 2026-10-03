/**
 * 重建待核事实清单
 *
 * facts.json 之前被清空了（所有历史版本里也是 0，不是迁移造成的）。
 * 这里从正文里重新抽取需要核实的数字与日期。
 *
 * 抽取原则：
 *   · 只抽「错了会出事」的 —— 年份、年龄、条数、集数、页数、百分比
 *   · 每条带上下文（ctx），人工核对时一眼能看出在核对什么
 *   · reliability 标「待核」，由人在界面上点确认
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const F = path.join(ROOT, 'data', 'facts.json')

/* 人工列出的待核项。
   这些是稿子的支点 —— 错一个就伤文章的可信度。
   kind: date=日期 num=数字 name=人名 org=机构 */
const FACTS = [
  { kind: 'date', label: '出生年份', value: '1933年', ctx: '游本昌出生年，据此算 2026 年去世为 93 岁', risk: 'high' },
  { kind: 'date', label: '去世日期', value: '2026年9月24日', ctx: '正文开头：9月24日清晨去世，93岁', risk: 'high' },
  { kind: 'date', label: '遗体告别日期', value: '2026年9月30日', ctx: '八宝山殡仪馆遗体告别仪式', risk: 'high' },
  { kind: 'num', label: '毕业年份', value: '1956年', ctx: '从上海戏剧学院毕业，进中央实验话剧院', risk: 'high' },
  { kind: 'num', label: '《济公》首播年', value: '1985年', ctx: '正文：1985年播出，收视率超90%，当年52岁', risk: 'high' },
  { kind: 'num', label: '首播收视率', value: '超90%', ctx: '只有一个出处（自媒体），未找到当年官方统计', risk: 'high' },
  { kind: 'num', label: '龙套角色数', value: '79个角色中77个是龙套', ctx: '只有一个出处（网易号火鱼观点，自媒体号）', risk: 'high' },
  { kind: 'num', label: '译本数量', value: '19个译本', ctx: '为演十几秒无台词角色翻遍19个译本', risk: 'high' },
  { kind: 'num', label: '卖房年龄', value: '76岁', ctx: '2009年卖北京唯一一套房买弘一话剧版权', risk: 'high' },
  { kind: 'num', label: '入党申请书页数', value: '21页', ctx: '2025年6月30日，92岁入党', risk: 'high' },
  { kind: 'num', label: '续集集数', value: '原计划20集，只拍4集', ctx: '1989年《济公活佛》立项，因资金不足砍到4集', risk: 'medium' },
  { kind: 'date', label: '妻子确诊年份', value: '1991年', ctx: '妻子杨慧华确诊癌症，1995年病情好转', risk: 'medium' },
  { kind: 'date', label: '白玉兰放弃申报年份', value: '2024年', ctx: '主动不参与《繁花》爷叔申报，理由让给年轻人', risk: 'high' },
  { kind: 'date', label: '金鹰终身成就奖', value: '2024年10月20日', ctx: '第32届金鹰奖', risk: 'medium' },
  { kind: 'date', label: '《繁花》筹备', value: '2020年', ctx: '王家卫开始筹备，游本昌87岁', risk: 'medium' },
  { kind: 'num', label: '闲的年数', value: '20年', ctx: '1985年爆红后闲置约20年，他自己在2010年访谈中说的', risk: 'high' },
  { kind: 'num', label: '金鹰奖年份', value: '1985年', ctx: '凭《济公》获当年金鹰奖', risk: 'medium' },
  { kind: 'org', label: '央视网访谈', value: '2010年11月18日', ctx: '「济公火了我得罪了一批人 一闲就是20年」出处', risk: 'high' },
  { kind: 'org', label: '央视《鲁豫有约》', value: '2013年12月9日', ctx: '「济公热播上海犯罪率下降」出处', risk: 'high' },
  { kind: 'name', label: '杨慧华', value: '妻子，妇科医生', ctx: '1991年确诊癌症', risk: 'medium' },
  { kind: 'num', label: '女儿最后描述', value: '没有任何病痛，睡着就去了', ctx: '家属转述', risk: 'high' }
]

const now = new Date().toISOString()
const list = FACTS.map((f, i) => ({
  id: 'f' + (i + 1) + '-' + f.label.replace(/[^\w一-龥]/g, '').slice(0, 8),
  kind: f.kind,
  label: f.label,
  value: f.value,
  ctx: f.ctx,
  verdict: 'wait',
  risk: f.risk,
  url: '',
  note: '',
  at: now
}))

const high = list.filter(f => f.risk === 'high').length
console.log('生成待核事实 ' + list.length + ' 条（高危 ' + high + ' 条）')

if (process.argv.includes('--save')) {
  fs.writeFileSync(F, JSON.stringify(list, null, 2), 'utf8')
  console.log('已写回 data/facts.json')
} else {
  console.log('（预览模式，加 --save 才写盘）')
  console.log(JSON.stringify(list.slice(0, 3), null, 2))
}