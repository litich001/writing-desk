const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126 Safari/537.36'
const u = 'http://www.xinhuanet.com/sports/20250224/332effbaf1cd454d99fb9d32ebed7ddd/c.html'
const r = await fetch(u, { headers: { 'user-agent': UA, referer: u } })
const h = await r.text()
console.log('HTTP', r.status, '长度', h.length)
const all = [...h.matchAll(/<img[^>]*>/gi)].map(m => m[0])
console.log('img 标签', all.length, '个')
all.filter(x => /2025|jpg|jpeg/i.test(x)).slice(0, 6).forEach(x => console.log('  ', x.replace(/\s+/g, ' ').slice(0, 190)))
console.log('--- 含 20250224 的片段 ---')
const i = h.indexOf('20250224332eff')
if (i > 0) console.log(h.slice(i - 260, i + 200).replace(/\s+/g, ' '))
else console.log('没找到该串')
