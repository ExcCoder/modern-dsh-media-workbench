// 本地预览服务器：不启动 DSH，也能把四个工作台的界面跑起来。
// 用法：node tools/dev-server.mjs  然后打开 http://127.0.0.1:7788/media-workbench-modern/
// 图片和写作都走本地 mock，不花钱、不需要密钥。
import http from 'node:http'
import { mkdirSync, writeFileSync } from 'node:fs'
import { readFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { deflateSync } from 'node:zlib'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const DEV_HOME = join(ROOT, '.dev-home')
const PORT = Number(process.env.PORT || 7788)
const ORIGIN = `http://127.0.0.1:${PORT}`

process.env.DSH_HOME = DEV_HOME
mkdirSync(join(DEV_HOME, 'media-workbench-modern'), { recursive: true })
writeFileSync(join(DEV_HOME, 'media-workbench-modern', 'settings.json'), JSON.stringify({
  image: { preset: 'custom', baseUrl: `${ORIGIN}/mock/v1`, model: 'mock-image', apiKey: 'dev-key', size: '1024x1024', quality: '', extra: '' },
  video: { preset: 'custom', baseUrl: `${ORIGIN}/mock/v1`, model: 'mock-video', apiKey: 'dev-key', createPath: '/videos', statusPath: '/videos/{id}', contentPath: '/videos/{id}/content', imageField: 'image', extra: '' },
  voice: { preset: 'custom', baseUrl: `${ORIGIN}/mock/v1`, model: 'mock-voice', apiKey: 'dev-key', voice: 'alloy', format: 'wav', extra: '' },
  language: 'auto',
}, null, 2))

/* ---------- 一个够好看的 mock PNG ---------- */
const CRC_TABLE = (() => {
  const table = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c >>> 0
  }
  return table
})()

function crc32(buffer) {
  let crc = 0xffffffff
  for (const byte of buffer) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8)
  return (crc ^ 0xffffffff) >>> 0
}

function chunk(type, data) {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const typeBuf = Buffer.from(type, 'latin1')
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])))
  return Buffer.concat([len, typeBuf, data, crc])
}

function hash(text) {
  let value = 2166136261
  for (const char of String(text)) {
    value ^= char.codePointAt(0)
    value = Math.imul(value, 16777619)
  }
  return (value >>> 0) / 4294967295
}

function makePng(width, height, seedText) {
  const seed = hash(seedText)
  const hue = seed * 360
  const raw = Buffer.alloc((width * 4 + 1) * height)
  const p1 = { x: width * (0.25 + seed * 0.2), y: height * (0.3 + seed * 0.1), r: 20 + seed * 18 }
  const p2 = { x: width * (0.7 - seed * 0.15), y: height * 0.68, r: 26 + seed * 22 }
  for (let y = 0; y < height; y++) {
    raw[y * (width * 4 + 1)] = 0
    for (let x = 0; x < width; x++) {
      const t = y / height
      const base = [
        232 - Math.sin((x / width) * Math.PI) * 42 + Math.sin(t * 3 + seed * 6) * 8,
        210 - t * 70 + Math.cos((x / width) * 4 + seed * 5) * 10,
        190 - t * 60 + Math.sin((x / width) * 2 + 1) * 14,
      ]
      let r = base[0]
      let g = base[1]
      let b = base[2]
      // 两个柔光圆
      for (const p of [p1, p2]) {
        const d = Math.hypot(x - p.x, y - p.y) / p.r
        if (d < 1.2) {
          const a = Math.max(0, 1 - d) ** 2 * 0.5
          r = r * (1 - a) + (245 - seed * 15) * a
          g = g * (1 - a) + (168 + seed * 40) * a
          b = b * (1 - a) + (120 + seed * 60) * a
        }
      }
      // 远山剪影
      const horizon = height * (0.66 + Math.sin(x / width * 3.4 + seed * 8) * 0.03)
      if (y > horizon) {
        const depth = Math.min(1, (y - horizon) / (height * 0.3))
        const shade = 0.72 - depth * 0.32
        r *= shade
        g *= shade
        b *= shade
      }
      // 细雨
      if (((x * 928371 + y * 364479 + Math.floor(seed * 99)) % 977) < 2 && y < horizon) {
        r += 16; g += 16; b += 18
      }
      const offset = y * (width * 4 + 1) + 1 + x * 4
      raw[offset] = Math.max(0, Math.min(255, r))
      raw[offset + 1] = Math.max(0, Math.min(255, g))
      raw[offset + 2] = Math.max(0, Math.min(255, b))
      raw[offset + 3] = 255
    }
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8
  ihdr[9] = 6
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 6 })),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

const frames = new Map()
let frameSeq = 0
let mockVideo = null

// 一段真的 wav，语音卡片才能正常播放
function makeWav(seconds = 1.4, rate = 22050) {
  const samples = Math.floor(rate * seconds)
  const data = Buffer.alloc(samples * 2)
  for (let i = 0; i < samples; i++) {
    const t = i / rate
    const envelope = Math.min(1, t * 8) * Math.min(1, (seconds - t) * 8)
    const value = Math.sin(t * 2 * Math.PI * 220) * 0.35 + Math.sin(t * 2 * Math.PI * 330) * 0.18
    data.writeInt16LE(Math.round(value * envelope * 12000), i * 2)
  }
  const header = Buffer.alloc(44)
  header.write('RIFF', 0)
  header.writeUInt32LE(36 + data.length, 4)
  header.write('WAVE', 8)
  header.write('fmt ', 12)
  header.writeUInt32LE(16, 16)
  header.writeUInt16LE(1, 20)
  header.writeUInt16LE(1, 22)
  header.writeUInt32LE(rate, 24)
  header.writeUInt32LE(rate * 2, 28)
  header.writeUInt16LE(2, 32)
  header.writeUInt16LE(16, 34)
  header.write('data', 36)
  header.writeUInt32LE(data.length, 40)
  return Buffer.concat([header, data])
}
const mockAudio = makeWav()

// 用系统 ffmpeg 做一段真的 mp4，视频卡片才能正常播放
try {
  const poster = join(DEV_HOME, 'mock-poster.png')
  const video = join(DEV_HOME, 'mock-video.mp4')
  writeFileSync(poster, makePng(1280, 720, 'a quiet coastal road at dawn'))
  execFileSync(process.env.FFMPEG || 'ffmpeg', ['-y', '-loop', '1', '-i', poster, '-t', '4', '-vf', 'scale=1280:720', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', video], { stdio: 'ignore' })
  mockVideo = readFileSync(video)
} catch (err) {
  console.warn('[dev] ffmpeg mock video unavailable:', err.message)
}

function mockVideoFrame(prompt, index) {
  const key = `${prompt}:${index}`
  if (!frames.has(key)) frames.set(key, makePng(1280, 720, key).toString('base64'))
  return frames.get(key)
}

/* ---------- mock LLM ---------- */
const SAMPLE = [
  '雨停在傍晚六点。天台的水还没干，积水里有一小块橘色的天。',
  '他把耳机摘下来，挂在领口。城市的声音一下子涌进来：远处的车流、楼下卷帘门落下的响动、有人在喊一个名字。',
  '他没有回头。风从楼与楼之间穿过去，把晾着的白衬衫吹得鼓起来，又慢慢落回去。',
  '有些决定不是在某一个瞬间做出的，是在这样的傍晚，被城市一点一点推着，走到了那里。',
]

const llm = {
  async prepareCall(config) {
    return {
      config,
      async *stream() {
        for (const line of SAMPLE) {
          for (let i = 0; i < line.length; i += 6) {
            yield { type: 'text-delta', text: line.slice(i, i + 6) }
            await new Promise(resolve => setTimeout(resolve, 28))
          }
          yield { type: 'text-delta', text: '\n\n' }
        }
        await new Promise(resolve => setTimeout(resolve, 120))
        yield { type: 'finish', reason: { kind: 'stop' } }
      },
    }
  },
}

/* ---------- 插件 host ---------- */
const routes = []
const tools = []
const webServer = { register(route) { routes.push(route); return () => {} } }
const ctx = {
  webServer,
  connection: { requestRejection: () => undefined },
  tools: { register(tool) { tools.push(tool); return () => {} } },
  get(name) {
    if (name === 'connection') return ctx.connection
    if (name === 'webServer') return webServer
    if (name === 'agentDefaultModel') return { currentSelection: () => ({ provider: 'mock', model: 'deepseek-chat' }) }
    if (name === 'llm') return llm
    return undefined
  },
  effect(fn) { return fn() },
}

const plugin = await import('../src/index.js')
plugin.apply(ctx)

/* ---------- 视频 mock：create / status / content ---------- */
const videoTasks = new Map()

async function handleMock(req, res, url) {
  const send = (status, body, type = 'application/json; charset=utf-8') => {
    res.statusCode = status
    res.setHeader('content-type', type)
    res.setHeader('cache-control', 'no-store')
    res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body))
  }
  const chunks = []
  for await (const chunk of req) chunks.push(chunk)
  const raw = Buffer.concat(chunks)
  const contentType = req.headers['content-type'] || ''
  let body = {}
  if (/^multipart\/form-data/i.test(contentType)) {
    try {
      const request = new Request('http://local/', { method: 'POST', headers: { 'content-type': contentType }, body: raw })
      const form = await request.formData()
      body = { prompt: String(form.get('prompt') ?? ''), model: String(form.get('model') ?? '') }
    } catch { body = {} }
  } else {
    body = (() => { try { return JSON.parse(raw.toString('utf8') || '{}') } catch { return {} } })()
  }

  if (url.pathname === '/mock/v1/images/generations' && req.method === 'POST') {
    const prompt = String(body.prompt || 'untitled')
    const size = String(body.size || '1024x1024')
    const [w, h] = size.split('x').map(Number)
    const png = makePng(Math.max(256, Math.min(1536, w || 1024)), Math.max(256, Math.min(1536, h || 1024)), prompt + Math.random())
    return send(200, { data: [{ b64_json: png.toString('base64'), revised_prompt: prompt }] })
  }

  if (url.pathname === '/mock/v1/audio/speech' && req.method === 'POST') {
    return send(200, mockAudio, 'audio/wav')
  }

  if (url.pathname === '/mock/v1/images/edits' && req.method === 'POST') {
    const prompt = String(body.prompt || 'untitled')
    return send(200, { data: [{ b64_json: makePng(1024, 1024, prompt + Math.random()).toString('base64') }] })
  }

  if (url.pathname === '/mock/v1/videos' && req.method === 'POST') {
    const id = `vidmock_${++frameSeq}`
    videoTasks.set(id, { created: Date.now(), prompt: body.prompt, status: 'queued' })
    return send(200, { id, status: 'queued' })
  }

  const statusMatch = /^\/mock\/v1\/videos\/([\w-]+)$/.exec(url.pathname)
  if (statusMatch && req.method === 'GET') {
    const id = statusMatch[1]
    const task = videoTasks.get(id)
    if (!task) return send(404, { error: 'not found' })
    const elapsed = Date.now() - task.created
    if (elapsed < 2500) return send(200, { id, status: 'queued', progress: Math.min(30, elapsed / 100) })
    if (elapsed < 6500) return send(200, { id, status: 'in_progress', progress: 30 + Math.min(60, (elapsed - 2500) / 60) })
    return send(200, { id, status: 'completed', progress: 100 })
  }

  const contentMatch = /^\/mock\/v1\/videos\/([\w-]+)\/content$/.exec(url.pathname)
  if (contentMatch && req.method === 'GET') {
    if (!mockVideo) return send(503, { error: 'mock video not generated' })
    res.statusCode = 200
    res.setHeader('content-type', 'video/mp4')
    res.setHeader('content-length', mockVideo.length)
    res.end(mockVideo)
    return
  }

  const videoFile = /^\/mock\/video\/([\w-]+)\.mp4$/.exec(url.pathname)
  if (videoFile && req.method === 'GET') {
    if (!mockVideo) return send(503, { error: 'mock video not generated' })
    res.statusCode = 200
    res.setHeader('content-type', 'video/mp4')
    res.setHeader('content-length', mockVideo.length)
    res.setHeader('accept-ranges', 'bytes')
    res.end(mockVideo)
    return
  }

  return send(404, { error: 'mock: not found' })
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url || '/', ORIGIN)
  if (url.pathname.startsWith('/mock/')) {
    try { return await handleMock(req, res, url) } catch (err) { res.statusCode = 500; return res.end(String(err)) }
  }
  const route = routes.find(item => url.pathname.startsWith(item.path))
  if (!route) { res.statusCode = 404; return res.end('not found') }
  return route.handler(req, res)
})

server.listen(PORT, '127.0.0.1', () => {
  console.log(`\n  摩登-媒体工作室 dev server`)
  console.log(`  http://127.0.0.1:${PORT}/media-workbench-modern/\n`)
  console.log(`  DSH_HOME = ${DEV_HOME}`)
  console.log(`  tools: ${tools.map(tool => tool.name).join(', ')}\n`)
})
