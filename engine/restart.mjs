/* 重启服务并确认端口活着 —— PowerShell 编码出问题时用这个 */
import { spawn, execSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import net from 'node:net'

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')

function portAlive(port = 8848) {
  return new Promise(res => {
    const s = net.connect({ host: '127.0.0.1', port })
    s.on('connect', () => { s.destroy(); res(true) })
    s.on('error', () => res(false))
    setTimeout(() => { s.destroy(); res(false) }, 1500)
  })
}

const alive = await portAlive()
if (alive) {
  try { execSync(`taskkill /F /IM node.exe /FI "WINDOWTITLE eq *server.mjs*"`, { stdio: 'ignore' }) } catch {}
  try {
    const out = execSync('netstat -ano | findstr :8848', { encoding: 'utf8' })
    const pids = [...new Set(out.split('\n').map(l => l.trim().split(/\s+/).pop()).filter(x => /^\d+$/.test(x)))]
    for (const p of pids) { try { execSync(`taskkill /F /PID ${p}`, { stdio: 'ignore' }) } catch {} }
  } catch {}
  await new Promise(r => setTimeout(r, 800))
}

spawn('node', ['server.mjs'], { cwd: ROOT, detached: true, stdio: 'ignore', windowsHide: true }).unref()
for (let i = 0; i < 20; i++) {
  await new Promise(r => setTimeout(r, 500))
  if (await portAlive()) { console.log('服务已就绪 8848'); process.exit(0) }
}
console.error('服务启动失败')
process.exit(1)
