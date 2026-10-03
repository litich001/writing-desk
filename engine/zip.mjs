/**
 * 极简 ZIP 打包（store 模式，不压缩）
 * 图片本身已是压缩格式，store 省掉 zlib 完全够用，也不引第三方依赖。
 */

const CRC_TABLE = (() => {
  const t = new Int32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c
  }
  return t
})()

function crc32(buf) {
  let c = -1
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
  return (c ^ -1) >>> 0
}

function dosTime(d = new Date()) {
  const t = ((d.getHours() << 11) | (d.getMinutes() << 5) | (Math.floor(d.getSeconds() / 2)))
  const date = (((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate())
  return { time: t & 0xffff, date: date & 0xffff }
}

/** @param files [{ name, data:Buffer }] @returns Buffer */
export function zip(files) {
  const { time, date } = dosTime()
  const locals = []
  const centrals = []
  let offset = 0

  for (const f of files) {
    const nameBuf = Buffer.from(f.name, 'utf8')
    const crc = crc32(f.data)
    const lh = Buffer.alloc(30)
    lh.writeUInt32LE(0x04034b50, 0)     // 本地文件头签名
    lh.writeUInt16LE(20, 4)              // 解压所需版本
    lh.writeUInt16LE(0x0800, 6)          // 通用标志：文件名为 UTF-8
    lh.writeUInt16LE(0, 8)               // 压缩方式 0 = store
    lh.writeUInt16LE(time, 10)
    lh.writeUInt16LE(date, 12)
    lh.writeUInt32LE(crc, 14)
    lh.writeUInt32LE(f.data.length, 18)
    lh.writeUInt32LE(f.data.length, 22)
    lh.writeUInt16LE(nameBuf.length, 26)
    lh.writeUInt16LE(0, 28)
    locals.push(lh, nameBuf, f.data)

    const ch = Buffer.alloc(46)
    ch.writeUInt32LE(0x02014b50, 0)      // 中央目录签名
    ch.writeUInt16LE(20, 4)
    ch.writeUInt16LE(20, 6)
    ch.writeUInt16LE(0x0800, 8)
    ch.writeUInt16LE(0, 10)
    ch.writeUInt16LE(time, 12)
    ch.writeUInt16LE(date, 14)
    ch.writeUInt32LE(crc, 16)
    ch.writeUInt32LE(f.data.length, 20)
    ch.writeUInt32LE(f.data.length, 24)
    ch.writeUInt16LE(nameBuf.length, 28)
    ch.writeUInt32LE(offset, 42)
    centrals.push(ch, nameBuf)

    offset += lh.length + nameBuf.length + f.data.length
  }

  const localPart = Buffer.concat(locals)
  const centralPart = Buffer.concat(centrals)
  const eocd = Buffer.alloc(22)
  eocd.writeUInt32LE(0x06054b50, 0)
  eocd.writeUInt16LE(files.length, 8)
  eocd.writeUInt16LE(files.length, 10)
  eocd.writeUInt32LE(centralPart.length, 12)
  eocd.writeUInt32LE(localPart.length, 16)

  return Buffer.concat([localPart, centralPart, eocd])
}

/* ─────────── 自检：解包回验 ─────────── */
if (process.argv[1] && /zip\.mjs$/i.test(process.argv[1])) {
  import('node:zlib').then(async ({ gunzipSync, inflateRawSync }) => {
    const assert = (ok, msg) => console.log((ok ? '  ✓ ' : '  ✗ ') + msg)
    console.log('\n  ZIP 自检\n  ' + '-'.repeat(46))

    const files = [
      { name: '01-测试中文名.txt', data: Buffer.from('第一行\n第二行 中文内容\n', 'utf8') },
      { name: '02-image.bin', data: Buffer.from(Array.from({ length: 5000 }, (_, i) => i % 256)) }
    ]
    const buf = zip(files)
    assert(Buffer.isBuffer(buf) && buf.length > 0, '生成 buffer  ' + buf.length + ' 字节')

    // 手写解析器回验：中央目录 + 本地头
    const eocdIdx = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]))
    assert(eocdIdx > 0, 'EOCD 记录找到 @' + eocdIdx)
    const n = buf.readUInt16LE(eocdIdx + 10)
    assert(n === files.length, '条目数 = ' + n)
    const cdSize = buf.readUInt32LE(eocdIdx + 12)
    assert(cdSize > 0, '中央目录大小 ' + cdSize)

    let p = eocdIdx - cdSize
    let checked = 0
    for (let i = 0; i < n; i++) {
      assert(buf.readUInt32LE(p) === 0x02014b50, '中央目录 #' + (i + 1) + ' 签名正确')
      const nameLen = buf.readUInt16LE(p + 28)
      const extraLen = buf.readUInt16LE(p + 30)
      const cmtLen = buf.readUInt16LE(p + 32)
      const lho = buf.readUInt32LE(p + 42)
      const name = buf.slice(p + 46, p + 46 + nameLen).toString('utf8')
      assert(name === files[i].name, '文件名 UTF-8 正确: ' + name)
      assert(buf.readUInt32LE(lho) === 0x04034b50, '本地头签名正确')
      const lNameLen = buf.readUInt16LE(lho + 26)
      const lExtraLen = buf.readUInt16LE(lho + 28)
      const start = lho + 30 + lNameLen + lExtraLen
      const data = buf.slice(start, start + files[i].data.length)
      assert(data.equals(files[i].data), '内容字节完全一致: ' + name)
      assert(crc32(data) === buf.readUInt32LE(p + 16), 'CRC32 校验通过: ' + name)
      checked++
      p += 46 + nameLen + extraLen + cmtLen
    }
    console.log('  ' + '-'.repeat(46) + '\n  回验 ' + checked + '/' + files.length + ' 个条目全部通过\n')
  })
}
