// 生图：OpenAI Images 兼容接口（generations / edits），也接受 images[0] 这种国内常见返回
import { readFile } from 'node:fs/promises'
import { extname, join } from 'node:path'
import { STYLES } from './graph.js'
import { imageKey } from './settings.js'
import { assertRemoteUrl, extensionOf, imageSize, redact } from './util.js'

const TIMEOUT_MS = 300_000
const MAX_BYTES = 40_000_000

function explain(status, detail) {
  if (status === 401 || status === 403) return `密钥无效或没有该模型的权限（${status}）`
  if (status === 404) return '接口地址或模型不存在（404），检查设置里的地址要不要加 /v1'
  if (status === 429) return '请求太频繁或额度不足（429）'
  if (status === 400 && /size|resolution|dimension/i.test(detail)) return `这个模型不支持当前尺寸：${detail}`
  return detail ? `生图服务返回 ${status}：${detail}` : `生图服务返回 ${status}`
}

function styledPrompt(prompt, style) {
  const text = String(prompt ?? '').trim()
  const suffix = STYLES[style] ?? (typeof style === 'string' && style.trim() ? style.trim() : '')
  return suffix ? `${text}${text ? '。' : ''}${suffix}` : text
}

async function postJson(url, key, body, signal) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
    body: JSON.stringify(body),
    signal,
  })
  const raw = await res.text()
  let data = null
  try { data = JSON.parse(raw) } catch { /* 网关偶尔返回 HTML */ }
  if (!res.ok) {
    const message = data?.error?.message ?? data?.message ?? raw ?? ''
    const err = new Error(explain(res.status, redact(message, key)))
    err.status = res.status
    throw err
  }
  return data
}

async function readEntry(entry, key, signal) {
  if (entry?.b64_json) return { buffer: Buffer.from(entry.b64_json, 'base64'), revisedPrompt: entry.revised_prompt }
  if (entry?.url) {
    const url = assertRemoteUrl(entry.url)
    const download = await fetch(url, { signal })
    if (!download.ok) throw new Error(`下载生成的图片失败（${download.status}）`)
    return { buffer: Buffer.from(await download.arrayBuffer()), revisedPrompt: entry.revised_prompt }
  }
  const err = new Error('生图服务没有返回图片')
  err.status = 502
  throw err
}

function extraOf(settings) {
  try {
    const parsed = JSON.parse(settings.image.extra || '{}')
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

/**
 * 生成一张图。
 * @param {object} settings 插件设置
 * @param {object} request {prompt, style, negative, size, quality, reference, references, model}
 * @param {{signal?: AbortSignal, filesDir?: string}} options
 * @returns {Promise<{buffer: Buffer, ext: string, width: number, height: number, revisedPrompt?: string}>}
 */
export async function generateImage(settings, request, { signal, filesDir } = {}) {
  const key = imageKey(settings)
  if (!key) throw Object.assign(new Error('还没有配置生图密钥，去「设置 → 生图服务」填一个'), { status: 400 })
  if (!settings.image.baseUrl || !settings.image.model) throw Object.assign(new Error('先填好生图接口地址和模型'), { status: 400 })
  const prompt = styledPrompt(request.prompt, request.style)
  if (!prompt) throw Object.assign(new Error('提示词为空'), { status: 400 })
  const extra = { ...extraOf(settings), ...(request.extra && typeof request.extra === 'object' ? request.extra : {}) }
  if (request.negative) extra.negative_prompt = request.negative
  const model = request.model || settings.image.model
  const timeout = AbortSignal.timeout(TIMEOUT_MS)
  const combined = signal ? AbortSignal.any([signal, timeout]) : timeout
  let result

  const references = (Array.isArray(request.references) ? request.references : request.reference ? [request.reference] : [])
    .map(name => String(name ?? '').replace(/[^\w.-]/g, ''))
    .filter(Boolean)
    .slice(0, 8)

  if (references.length && filesDir) {
    const images = []
    for (const name of references) {
      const file = join(filesDir, name)
      let buffer
      try {
        buffer = await readFile(file)
      } catch {
        throw Object.assign(new Error(`参考图不存在：${name}，重新上传一次`), { status: 400 })
      }
      const type = extname(file).toLowerCase() === '.jpg' ? 'image/jpeg' : extname(file).toLowerCase() === '.webp' ? 'image/webp' : 'image/png'
      images.push({ buffer, type, ext: extname(file) || '.png', name })
    }
    const form = new FormData()
    form.set('model', model)
    form.set('prompt', prompt)
    form.set('n', '1')
    if (request.size) form.set('size', request.size)
    if (request.quality) form.set('quality', request.quality)
    for (const [k, v] of Object.entries(extra)) form.set(k, typeof v === 'string' ? v : JSON.stringify(v))
    if (images.length === 1) {
      form.set('image', new Blob([images[0].buffer], { type: images[0].type }), `reference${images[0].ext}`)
    } else {
      images.forEach((image, index) => form.append('image[]', new Blob([image.buffer], { type: image.type }), `reference-${index + 1}${image.ext}`))
    }
    const res = await fetch(`${settings.image.baseUrl}/images/edits`, {
      method: 'POST',
      headers: { authorization: `Bearer ${key}` },
      body: form,
      signal: combined,
    })
    const raw = await res.text()
    let data = null
    try { data = JSON.parse(raw) } catch { /* ignore */ }
    if (!res.ok) throw Object.assign(new Error(explain(res.status, redact(data?.error?.message ?? data?.message ?? raw, key))), { status: res.status })
    const entry = data?.data?.[0] ?? data?.images?.[0]
    result = await readEntry(entry, key, combined)
  } else {
    const body = {
      model,
      prompt,
      n: 1,
      ...(request.size ? { size: request.size } : {}),
      ...(request.quality ? { quality: request.quality } : {}),
      ...extra,
    }
    const data = await postJson(`${settings.image.baseUrl}/images/generations`, key, body, combined)
    const entry = data?.data?.[0] ?? data?.images?.[0]
    result = await readEntry(entry, key, combined)
  }

  const { buffer } = result
  if (buffer.length > MAX_BYTES) throw new Error('返回的图片太大')
  const ext = extensionOf(buffer)
  if (!ext) throw new Error('接口返回的内容不是图片')
  const size = imageSize(buffer) ?? { width: 0, height: 0 }
  return { buffer, ext, width: size.width, height: size.height, revisedPrompt: result.revisedPrompt }
}

export { styledPrompt }
