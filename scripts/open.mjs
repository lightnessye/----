import fs from 'node:fs'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const PORT = Number(process.env.PORT ?? 8787)
const entry = path.join(root, 'dist', 'server', 'index.js')

const probe = (timeout = 700) =>
  new Promise((resolve) => {
    const sock = net.connect(PORT, '127.0.0.1')
    const timer = setTimeout(() => finish(false), timeout)
    const finish = (ok) => {
      clearTimeout(timer)
      sock.destroy()
      resolve(ok)
    }
    sock.once('connect', () => finish(true))
    sock.once('error', () => finish(false))
  })

const lanUrls = () =>
  Object.values(os.networkInterfaces())
    .flat()
    .filter((n) => n && n.family === 'IPv4' && !n.internal)
    .map((n) => `http://${n.address}:${PORT}`)

const openBrowser = (url) => {
  if (process.env.NO_BROWSER) return
  const [cmd, args] =
    process.platform === 'win32' ? ['cmd', ['/c', 'start', '', url]] : ['xdg-open', [url]]
  spawn(cmd, args, { stdio: 'ignore', detached: true }).unref()
}

/** 整条命令作为字符串交给 shell，Windows 下才能找到 npm.cmd，也避开 DEP0190 警告 */
const npm = (args) =>
  new Promise((resolve, reject) => {
    const p = spawn(`npm ${args.join(' ')}`, { cwd: root, stdio: 'inherit', shell: true })
    p.on('error', reject)
    p.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`npm ${args[0]} 失败，退出码 ${code}`))))
  })

const ensureDeps = async () => {
  // tsc / vite / esbuild 都在 node_modules/.bin 里，没有依赖包就一定构建失败
  if (fs.existsSync(path.join(root, 'node_modules', '.bin'))) return
  console.log('首次运行，正在安装依赖（大约 1~3 分钟，请保持网络畅通）...')
  // 缓存放在项目内，避免 %LocalAppData% 被安全软件锁住时报 EPERM
  await npm(['install', '--cache', '.npm-cache', '--no-audit', '--no-fund'])
}

const waitForUp = async (ms) => {
  const deadline = Date.now() + ms
  while (Date.now() < deadline) {
    if (await probe(300)) return true
    await new Promise((r) => setTimeout(r, 400))
  }
  return false
}

const local = `http://localhost:${PORT}`

if (await probe()) {
  console.log(`\n服务已经在运行，无需重复启动。\n  本机      ${local}\n`)
  lanUrls().forEach((u) => console.log(`  聚会访问  ${u}`))
  openBrowser(local)
  process.exit(0)
}

await ensureDeps()

if (!fs.existsSync(entry)) {
  console.log('首次运行，正在构建（大约一分钟）...')
  await npm(['run', 'build'])
}

console.log('正在启动服务...')
const server = spawn(process.execPath, [entry], { cwd: root, env: process.env, stdio: 'inherit' })
server.on('exit', (code) => {
  if (code) console.error(`\n服务异常退出，退出码 ${code}`)
  process.exit(code ?? 0)
})

if (!(await waitForUp(20000))) {
  console.error('服务没能启动，请把上面的报错发给我。')
  server.kill()
  process.exit(1)
}

console.log('\n已启动。手机和电脑需要连同一个 WiFi 才能互相访问：')
console.log(`  本机      ${local}`)
lanUrls().forEach((u) => console.log(`  聚会访问  ${u}`))
console.log('\n这个窗口保持开着，服务就在跑；关掉窗口或按 Ctrl+C 即停止。\n')
openBrowser(local)
