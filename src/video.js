// 视频：兼容异步任务式视频接口；没有视频密钥时可以用「分镜短片」把画面串起来
import { readFile } from 'node:fs/promises'
import { extname, join } from 'node:path'
import { RATIOS } from './graph.js'
import { generateImage } from './image.js'
import { imageReady, videoKey } from './settings.js'
import { assertRemoteUrl, sleep, videoExtensionOf } from './util.js'

const POLL_MS = 4_000
const MAX_WAIT_MS = 20 * 60_000

function extraOf(settings) {
  try {
    const parsed = JSON.parse(settings.video.extra || '{}')
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

function statusOf(data) {
  const raw = data?.status ?? data?.state ?? data?.data?.status ?? data?.data?.state ?? ''
  return String(raw).toLowerCase()
}

function isFailed(status) {
  return ['failed', 'error', 'cancelled', 'canceled', 'expired'].includes(status)
}

function isDone(status) {
  return ['completed', 'succeeded', 'success', 'done', 'finished'].includes(status)
}

function findUrl(data) {
  if (!data) return ''
  const candidates = [
    data.url,
    data.video_url,
    data.videoUrl,
    data.output_url,
    data.result_url,
    data.output?.url,
    data.output?.video_url,
    Array.isArray(data.output) ? data.output[0]?.url ?? data.output[0] : '',
    data.data?.url,
    data.data?.video_url,
    data.data?.output?.url,
    data.result?.url,
    data.result?.video_url,
    Array.isArray(data.data) ? data.data[0]?.url : '',
  ]
  return candidates.find(v => typeof v === 'string' && /^https?:\/\//.test(v)) ?? ''
}

function findId(data) {
  return String(data?.id ?? data?.task_id ?? data?.taskId ?? data?.data?.id ?? data?.data?.task_id ?? data?.result?.id ?? '')
}

function progressOf(data) {
  const raw = data?.progress ?? data?.percent ?? data?.data?.progress
  if (raw === undefined) return null
  const n = Number(raw)
  if (!Number.isFinite(n)) return null
  return Math.max(0, Math.min(100, n <= 1 ? Math.round(n * 100) : Math.round(n)))
}

async function fetchVideoContent(settings, key, id, signal) {
  const path = settings.video.contentPath.replace('{id}', encodeURIComponent(id))
  const res = await fetch(`${settings.video.baseUrl}${path}`, { headers: { authorization: `Bearer ${key}` }, signal })
  if (!res.ok) throw new Error(`下载视频失败（${res.status}）`)
  return Buffer.from(await res.arrayBuffer())
}

/**
 * 走异步接口生成视频，返回视频字节。
 */
export async function generateVideo(settings, record, { signal, filesDir, onProgress } = {}) {
  const key = videoKey(settings)
  if (!key) throw Object.assign(new Error('还没有配置视频密钥。也可以把模式换成「分镜短片」，用图片拼出动态预览'), { status: 400 })
  if (!settings.video.baseUrl || !settings.video.model) throw Object.assign(new Error('先填好视频接口地址和模型'), { status: 400 })
  const timeout = AbortSignal.timeout(MAX_WAIT_MS)
  const combined = signal ? AbortSignal.any([signal, timeout]) : timeout
  const ratio = RATIOS[record.aspect] ?? RATIOS['16:9']

  const body = {
    model: settings.video.model,
    prompt: record.prompt,
    seconds: String(record.duration),
    size: ratio.size,
    ...extraOf(settings),
  }

  if (record.reference && filesDir) {
    try {
      const buffer = await readFile(join(filesDir, record.reference.replace(/[^\w.-]/g, '')))
      const type = extname(record.reference).toLowerCase() === '.jpg' ? 'image/jpeg' : extname(record.reference).toLowerCase() === '.webp' ? 'image/webp' : 'image/png'
      body[settings.video.imageField || 'image'] = `data:${type};base64,${buffer.toString('base64')}`
    } catch {
      throw Object.assign(new Error('首帧图片不存在，重新上传一次'), { status: 400 })
    }
  }

  let create
  try {
    const res = await fetch(`${settings.video.baseUrl}${settings.video.createPath}`, {
      method: 'POST',
      headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: combined,
    })
    const raw = await res.text()
    try { create = JSON.parse(raw) } catch { create = null }
    if (!res.ok) {
      const detail = create?.error?.message ?? create?.message ?? raw.slice(0, 300)
      throw Object.assign(new Error(`视频服务返回 ${res.status}：${detail}`), { status: res.status })
    }
  } catch (err) {
    if (err.name === 'TimeoutError') throw new Error('视频接口响应超时')
    throw err
  }

  const id = findId(create)
  let status = statusOf(create)
  let final = create
  onProgress?.(10)
  if (id && !isDone(status)) {
    const statusPath = settings.video.statusPath.replace('{id}', encodeURIComponent(id))
    const started = Date.now()
    let lastProgress = 10
    for (;;) {
      if (Date.now() - started > MAX_WAIT_MS) throw new Error('视频生成超时（20 分钟），可以稍后到服务商后台查看')
      await sleep(POLL_MS, combined)
      let res
      try {
        res = await fetch(`${settings.video.baseUrl}${statusPath}`, { headers: { authorization: `Bearer ${key}` }, signal: combined })
      } catch (err) {
        if (err.name === 'TimeoutError' || combined.aborted) throw err
        continue
      }
      if (!res.ok) {
        if (res.status === 404 && Date.now() - started < 30_000) continue
        throw new Error(`查询视频进度失败（${res.status}）`)
      }
      const raw = await res.text()
      try { final = JSON.parse(raw) } catch { final = null }
      status = statusOf(final) || status
      const progress = progressOf(final)
      if (progress !== null && progress > lastProgress) {
        lastProgress = progress
        onProgress?.(Math.min(96, progress))
      } else {
        const guess = Math.min(90, lastProgress + 2)
        if (guess > lastProgress) { lastProgress = guess; onProgress?.(lastProgress) }
      }
      if (isFailed(status)) {
        const message = final?.error?.message ?? final?.message ?? final?.data?.error?.message ?? '视频生成失败'
        throw new Error(String(message).slice(0, 300))
      }
      if (isDone(status)) break
    }
  }

  let buffer
  const url = findUrl(final)
  if (url) {
    const remote = assertRemoteUrl(url)
    const download = await fetch(remote, { signal: combined })
    if (!download.ok) throw new Error(`下载视频失败（${download.status}）`)
    buffer = Buffer.from(await download.arrayBuffer())
  } else if (id && settings.video.contentPath) {
    buffer = await fetchVideoContent(settings, key, id, combined)
  }
  if (!buffer?.length) throw new Error('视频服务没有返回视频文件')
  onProgress?.(100)
  return { buffer, ext: videoExtensionOf(buffer) }
}

const BEATS = [
  'establishing wide shot, the whole scene visible, atmospheric depth',
  'medium shot, the subject in motion, natural framing',
  'close-up detail, texture and light, shallow depth of field',
  'final wide shot, quiet aftermath, cinematic negative space',
]

async function makeFrame(settings, record, beat, index, { signal, filesDir }) {
  const ratio = RATIOS[record.aspect] ?? RATIOS['16:9']
  const prompt = `${record.prompt}。${beat}`
  const result = await generateImage(settings, {
    prompt,
    style: '电影感',
    size: ratio.size,
    reference: record.reference || undefined,
  }, { signal, filesDir })
  return result
}

/**
 * 分镜短片：用生图服务生成 4 个关键帧，前端用交叉淡入播放。
 */
export async function generateStoryboard(settings, record, { signal, filesDir, onProgress } = {}) {
  if (!imageReady(settings)) throw Object.assign(new Error('分镜短片需要先配好生图服务'), { status: 400 })
  const frames = []
  const errors = []
  for (let i = 0; i < 4; i++) {
    if (signal?.aborted) throw new Error('已停止')
    try {
      frames.push(await makeFrame(settings, record, BEATS[i], i, { signal, filesDir }))
      onProgress?.(Math.round(((i + 1) / 4) * 90))
    } catch (err) {
      errors.push(err.message)
      if (i === 0) throw err
    }
  }
  if (!frames.length) throw new Error(errors[0] ?? '分镜生成失败')
  onProgress?.(100)
  return { frames, errors }
}

export { findUrl, findId, progressOf, statusOf }
