// @modern/dsh-media-workbench · host 工具函数：HTTP、文件、安全校验
import { createReadStream } from 'node:fs'
import { mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises'
import { extname, join, normalize, sep } from 'node:path'

export const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.avif': 'image/avif',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.mov': 'video/quicktime',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
}

export function json(res, status, body) {
  const payload = JSON.stringify(body)
  res.statusCode = status
  res.setHeader('content-type', 'application/json; charset=utf-8')
  res.setHeader('cache-control', 'no-store')
  res.setHeader('x-content-type-options', 'nosniff')
  res.end(payload)
}

export function fail(message, status = 400) {
  const err = new Error(message)
  err.status = status
  return err
}

export async function readBuffer(req, limit = 8_000_000) {
  const chunks = []
  let size = 0
  for await (const chunk of req) {
    size += chunk.length
    if (size > limit) throw fail('内容太大', 413)
    chunks.push(chunk)
  }
  return Buffer.concat(chunks)
}

export async function readJson(req, limit = 2_000_000) {
  const raw = await readBuffer(req, limit)
  if (!raw.length) return {}
  try {
    return JSON.parse(raw.toString('utf8'))
  } catch {
    throw fail('请求不是有效的 JSON', 400)
  }
}

/** 支持 Range，视频才能拖动和循环 */
export async function sendFile(req, res, file, { cache = 'private, max-age=3600' } = {}) {
  const type = MIME[extname(file).toLowerCase()]
  if (!type) return json(res, 404, { error: '不支持的文件类型' })
  let info
  try {
    info = await stat(file)
  } catch {
    return json(res, 404, { error: '文件不存在' })
  }
  if (!info.isFile()) return json(res, 404, { error: '文件不存在' })
  res.setHeader('content-type', type)
  res.setHeader('accept-ranges', 'bytes')
  res.setHeader('cache-control', cache)
  res.setHeader('x-content-type-options', 'nosniff')
  const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range || '')
  if (range && (range[1] || range[2])) {
    const start = range[1] ? Number(range[1]) : Math.max(0, info.size - Number(range[2]))
    const end = range[1] && range[2] ? Math.min(Number(range[2]), info.size - 1) : info.size - 1
    if (start >= info.size || start > end) {
      res.statusCode = 416
      res.setHeader('content-range', `bytes */${info.size}`)
      return res.end()
    }
    res.statusCode = 206
    res.setHeader('content-range', `bytes ${start}-${end}/${info.size}`)
    res.setHeader('content-length', end - start + 1)
    return createReadStream(file, { start, end }).pipe(res)
  }
  res.statusCode = 200
  res.setHeader('content-length', info.size)
  if (req.method === 'HEAD') return res.end()
  return createReadStream(file).pipe(res)
}

export function newId(prefix = 'x') {
  return `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`
}

export function sleep(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(signal.reason ?? new Error('aborted'))
    const timer = setTimeout(resolve, ms)
    signal?.addEventListener('abort', () => {
      clearTimeout(timer)
      reject(signal.reason ?? new Error('aborted'))
    }, { once: true })
  })
}

/** 从图片字节里读出宽高，用于画廊布局 */
export function imageSize(buffer) {
  try {
    if (buffer.length >= 24 && buffer[0] === 0x89 && buffer[1] === 0x50) {
      return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) }
    }
    if (buffer.length > 4 && buffer[0] === 0xff && buffer[1] === 0xd8) {
      let offset = 2
      while (offset + 9 < buffer.length) {
        if (buffer[offset] !== 0xff) { offset++; continue }
        const marker = buffer[offset + 1]
        const length = buffer.readUInt16BE(offset + 2)
        if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
          return { width: buffer.readUInt16BE(offset + 7), height: buffer.readUInt16BE(offset + 5) }
        }
        offset += 2 + length
      }
    }
    if (buffer.length > 30 && buffer.toString('latin1', 0, 4) === 'RIFF' && buffer.toString('latin1', 8, 12) === 'WEBP') {
      const kind = buffer.toString('latin1', 12, 16)
      if (kind === 'VP8X') return { width: 1 + buffer.readUIntLE(24, 3), height: 1 + buffer.readUIntLE(27, 3) }
      if (kind === 'VP8 ') return { width: buffer.readUInt16LE(26) & 0x3fff, height: buffer.readUInt16LE(28) & 0x3fff }
      if (kind === 'VP8L') {
        const bits = buffer.readUInt32LE(21)
        return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 }
      }
    }
  } catch { /* 尺寸只是展示增强 */ }
  return null
}

export function extensionOf(buffer) {
  if (buffer.length > 8 && buffer[0] === 0x89 && buffer[1] === 0x50) return '.png'
  if (buffer.length > 3 && buffer[0] === 0xff && buffer[1] === 0xd8) return '.jpg'
  if (buffer.length > 12 && buffer.toString('latin1', 0, 4) === 'RIFF' && buffer.toString('latin1', 8, 12) === 'WEBP') return '.webp'
  if (buffer.length > 6 && buffer.toString('latin1', 0, 3) === 'GIF') return '.gif'
  if (buffer.length > 12 && buffer.toString('latin1', 4, 12) === 'ftypavif') return '.avif'
  return null
}

export function videoExtensionOf(buffer) {
  if (buffer.length > 12 && buffer.toString('latin1', 4, 8) === 'ftyp') return '.mp4'
  if (buffer.length > 4 && buffer[0] === 0x1a && buffer[1] === 0x45 && buffer[2] === 0xdf && buffer[3] === 0xa3) return '.webm'
  return '.mp4'
}

export async function writeAtomic(file, data, mode) {
  const tmp = `${file}.${process.pid}.${Math.random().toString(36).slice(2, 6)}.tmp`
  await writeFile(tmp, data, mode ? { mode } : undefined)
  await rename(tmp, file)
}

export async function ensureDir(dir) {
  await mkdir(dir, { recursive: true })
}

/** 静态目录内取文件：拒绝穿越与点文件 */
export function safeJoin(root, rel) {
  const clean = normalize(rel).replace(/^([/\\])+/, '')
  if (!clean || clean.split(/[\\/]/).some(part => part.startsWith('.'))) return null
  const base = normalize(root)
  const file = normalize(join(base, clean))
  return file.startsWith(base + sep) ? file : null
}

export async function readJsonFile(file, fallback) {
  try {
    return JSON.parse(await readFile(file, 'utf8'))
  } catch (err) {
    if (err.code === 'ENOENT') return fallback
    throw err
  }
}

/** 只允许公网 http(s)：挡住本机、内网和云元数据地址 */
export function assertRemoteUrl(input) {
  let url
  try {
    url = new URL(String(input))
  } catch {
    throw fail('图片地址无效', 400)
  }
  if (!/^https?:$/.test(url.protocol)) throw fail('只支持 http/https 地址', 400)
  const host = url.hostname.toLowerCase()
  const blocked = /^(localhost|127\.|0\.|10\.|192\.168\.|169\.254\.|::1|\[::1\])/.test(host)
  if (blocked) throw fail('出于安全考虑，不能访问本机或内网地址', 400)
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host)
  if (m) {
    const [a, b] = [Number(m[1]), Number(m[2])]
    if (a === 127 || a === 10 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168)) {
      throw fail('出于安全考虑，不能访问本机或内网地址', 400)
    }
  }
  return url
}

export function clampInt(value, min, max, fallback) {
  const n = Number(value)
  return Number.isFinite(n) ? Math.min(max, Math.max(min, Math.round(n))) : fallback
}

export function redact(text, secret) {
  const clean = String(text ?? '').slice(0, 400)
  return secret ? clean.split(secret).join('***') : clean
}
