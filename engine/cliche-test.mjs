import fs from 'fs'
import { checkStyle, checkCliche, STYLES } from './styles.mjs'

/* 每种文风都有它自己那套 AI 套话。
   通用禁令（标点/否定式/预设）抓的是所有风格共有的毛病，
   但「赋能」「闭环」「抓手」这类词只会出现在商业稿里，
   「令人」「画卷」「定格」只会出现在人物稿里。

   拿真实套话喂一遍，看现在抓不抓得到。 */

const CLICHE = {
  biz: '这个模式的底层逻辑是闭环，通过赋能提升颗粒度，在生态里形成护城河，最终抢占用户心智，形成护城河效应。',
  sharp: '这波操作属实是把韭菜当韭菜割，平台方收割的镰刀从未停止，资本正在疯狂收割。',
  explain: '本质上这背后是一套底层逻辑，拆开来看是三层闭环，从颗粒度上讲其实是生态位的问题。',
  person: '他的一生是一幅画卷，这个瞬间被定格，成为他人生的注脚，这段话令人动容，也镌刻在时光里。',
  news: '据悉，该事件已引发广泛关注。记者获悉，多位业内人士表示，此事或将带来深远影响，未来可期。',
  warm: '他的笑容温暖了那个冬天，这一刻，时间仿佛静止了，愿每一个人都能被温柔以待，未来可期。',
  talk: '说真的，这事儿吧，怎么说呢，真的是绝了，只能说一个字：服。真的太真实了，姐妹们冲。',
  crit: '这种做法不是没有问题，究其根源，是相关方责任缺位，形式主义盛行，乱象频出，令人忧虑。',
  story: '多年以后他才明白，那年冬天的雪，那个夜晚的灯，还有母亲那句话，都成了他一生的转折，后来他再也没有回去过。',
  cold: '据悉，该事件引发广泛关注。记者获悉，业内人士表示，未来可期。此事或将带来深远影响。'
}

console.log('=== 各风格的 AI 套话现在抓得到吗 ===')
let miss = 0
for (const [id, text] of Object.entries(CLICHE)) {
  const r = checkStyle(text, id)
  const bad = r.aiHits.length + r.forbids.length
  if (!bad) miss++
  console.log('  ' + (bad ? '抓到了' : '★ 放行') + '  ' + STYLES[id].n.padEnd(6) +
    (bad ? '  ' + [...r.aiHits.map(h => h.n), ...r.forbids.map(f => f.n)].slice(0, 4).join('，') : ''))
}
console.log('')
console.log(miss ? miss + ' 种风格的套话完全没被抓到' : '全部抓到')
console.log('')
console.log('')
console.log('=== 干净的稿子不该被任何风格误伤 ===')
/* 用真实的合格稿子（王英南极稿）当对照。
   它是 warm 风格写的，只该被 warm 的判据接住，
   拿去考其他九种风格时，通用禁令不该乱响。 */
const CLEAN = fs.readFileSync(new URL('../data/body.md', import.meta.url), 'utf8')
let falseFire = 0
for (const id of Object.keys(STYLES)) {
  if (id === 'warm') continue
  const r = checkCliche(CLEAN, id)
  if (r.length) {
    falseFire++
    console.log('  ★ 误伤 ' + STYLES[id].n + ': ' + r.map(x => x.n + '(' + x.sample + ')').join('，'))
  }
}
console.log(falseFire ? '  ' + falseFire + ' 种风格误伤了合格稿' : '  没有误伤')
console.log('')
console.log(miss ? miss + ' 种风格的套话完全没被抓到' : '十种风格的套话全部抓到')
process.exit(miss || falseFire ? 1 : 0)
