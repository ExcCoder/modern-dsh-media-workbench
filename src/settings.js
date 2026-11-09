// 插件设置：接口地址、模型、密钥。密钥只留本机，返回浏览器时永远脱敏。
import { access, chmod, mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises'
import { constants } from 'node:fs'
import { join } from 'node:path'

export const IMAGE_PRESETS = [
  { id: 'openai', name: 'OpenAI', baseUrl: 'https://api.openai.com/v1', model: 'gpt-image-1', note: 'gpt-image-1 / dall-e-3' },
  { id: 'siliconflow', name: '硅基流动', baseUrl: 'https://api.siliconflow.cn/v1', model: 'Kwai-Kolors/Kolors', note: 'Kolors 等图像模型' },
  { id: 'zhipu', name: '智谱 BigModel', baseUrl: 'https://open.bigmodel.cn/api/paas/v4', model: 'cogview-3-flash', note: 'CogView 系列' },
  { id: 'ark', name: '火山方舟', baseUrl: 'https://ark.cn-beijing.volces.com/api/v3', model: 'doubao-seedream-4-0-250828', note: 'Seedream 系列' },
  { id: 'custom', name: '自定义', baseUrl: '', model: '', note: '任何兼容 /images/generations 的服务' },
]

export const VIDEO_PRESETS = [
  { id: 'openai', name: 'OpenAI Sora', baseUrl: 'https://api.openai.com/v1', model: 'sora-2', note: 'POST /videos，轮询 GET /videos/{id}' },
  { id: 'custom', name: '自定义', baseUrl: '', model: '', note: '兼容的异步视频接口，可在高级设置里改路径' },
]

export const VOICE_PRESETS = [
  { id: 'openai', name: 'OpenAI TTS', baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o-mini-tts', note: 'POST /audio/speech' },
  { id: 'minimax', name: 'MiniMax Speech', baseUrl: 'https://api.minimax.cn/v1/t2a_v2', model: 'speech-2.8-hd', note: 'POST /t2a_v2，使用 voice_id' },
  { id: 'custom', name: '自定义', baseUrl: '', model: '', note: 'OpenAI Audio Speech 或 MiniMax T2A 兼容接口' },
]

const DEFAULTS = {
  image: {
    preset: 'openai',
    baseUrl: '',
    model: '',
    apiKey: '',
    size: '1024x1024',
    quality: '',
    extra: '',
  },
  video: {
    preset: 'openai',
    baseUrl: '',
    model: '',
    apiKey: '',
    createPath: '/videos',
    statusPath: '/videos/{id}',
    contentPath: '/videos/{id}/content',
    imageField: 'image',
    extra: '',
  },
  voice: {
    preset: 'openai',
    baseUrl: '',
    model: '',
    apiKey: '',
    voice: 'alloy',
    format: 'mp3',
    extra: '',
  },
  language: 'auto',
  storage: {
    outputDir: '',
  },
}

function trim(value, max = 300) {
  return typeof value === 'string' ? value.trim().slice(0, max) : undefined
}

function normalizeBaseUrl(value) {
  if (typeof value !== 'string') return undefined
  const url = value.trim().replace(/\/+$/, '').replace(/\/(images\/generations|images\/edits|videos)$/, '')
  if (url && !/^https?:\/\/[^\s]+$/i.test(url)) {
    const err = new Error('接口地址要以 http:// 或 https:// 开头')
    err.status = 400
    throw err
  }
  return url
}

function normalizePath(value, fallback, max = 200) {
  const text = trim(value, max)
  if (text === undefined) return undefined
  if (!text) return fallback
  if (!text.startsWith('/')) {
    const err = new Error('接口路径要以 / 开头')
    err.status = 400
    throw err
  }
  return text
}

function normalizeOutputDir(value) {
  if (value === undefined) return undefined
  if (typeof value !== 'string') {
    const err = new Error('产物目录要是文本路径')
    err.status = 400
    throw err
  }
  let dir = value.trim()
  if (/^[a-zA-Z]:[\\/]?$/.test(dir)) {
    dir = `${dir.slice(0, 2)}\\`
  } else {
    dir = dir.replace(/[\\/]+$/, '')
  }
  if (!dir) return ''
  if (!/^(?:[a-zA-Z]:[\\/]|\/)/.test(dir)) {
    const err = new Error('产物目录要填绝对路径，例如 D:\\AI作品')
    err.status = 400
    throw err
  }
  return dir
}

function normalizeExtra(value) {
  if (value === undefined) return undefined
  if (typeof value !== 'string') {
    const err = new Error('附加参数要是 JSON 文本')
    err.status = 400
    throw err
  }
  const text = value.trim()
  if (!text) return ''
  let parsed
  try {
    parsed = JSON.parse(text)
  } catch {
    const err = new Error('附加参数不是有效的 JSON')
    err.status = 400
    throw err
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    const err = new Error('附加参数要是一个 JSON 对象')
    err.status = 400
    throw err
  }
  return text
}

export class Settings {
  constructor(root) {
    this.file = join(root, 'settings.json')
  }

  async read() {
    try {
      const saved = JSON.parse(await readFile(this.file, 'utf8'))
      const voice = { ...DEFAULTS.voice, ...(saved.voice ?? {}) }
      if (/minimax|t2a_v2/i.test(voice.baseUrl)) {
        if (voice.preset === 'openai') voice.preset = 'minimax'
        if (['alloy', 'echo', 'fable', 'onyx', 'nova', 'shimmer', 'coral', 'verse', 'ballad', 'ash', 'sage', 'marin', 'cedar'].includes(voice.voice)) {
          voice.voice = 'male-qn-qingse'
        }
      }
      return {
        ...DEFAULTS,
        ...saved,
        image: { ...DEFAULTS.image, ...(saved.image ?? {}) },
        video: { ...DEFAULTS.video, ...(saved.video ?? {}) },
        voice,
        storage: { ...DEFAULTS.storage, ...(saved.storage ?? {}) },
      }
    } catch (err) {
      if (err.code !== 'ENOENT') throw err
      return structuredClone(DEFAULTS)
    }
  }

  async update(patch = {}) {
    const current = await this.read()
    const next = structuredClone(current)
    const image = patch.image ?? {}
    for (const key of ['preset', 'model', 'size', 'quality']) {
      const value = trim(image[key], 200)
      if (value !== undefined) next.image[key] = value
    }
    const imageUrl = normalizeBaseUrl(image.baseUrl)
    if (imageUrl !== undefined) next.image.baseUrl = imageUrl
    const imageExtra = normalizeExtra(image.extra)
    if (imageExtra !== undefined) next.image.extra = imageExtra
    if (typeof image.apiKey === 'string' && image.apiKey.trim()) next.image.apiKey = image.apiKey.trim().slice(0, 500)
    if (image.clearKey === true) next.image.apiKey = ''

    const video = patch.video ?? {}
    for (const key of ['preset', 'model', 'imageField']) {
      const value = trim(video[key], 200)
      if (value !== undefined) next.video[key] = value
    }
    const videoUrl = normalizeBaseUrl(video.baseUrl)
    if (videoUrl !== undefined) next.video.baseUrl = videoUrl
    const createPath = normalizePath(video.createPath, '/videos')
    if (createPath !== undefined) next.video.createPath = createPath
    const statusPath = normalizePath(video.statusPath, '/videos/{id}')
    if (statusPath !== undefined) next.video.statusPath = statusPath
    const contentPath = normalizePath(video.contentPath, '/videos/{id}/content')
    if (contentPath !== undefined) next.video.contentPath = contentPath
    const videoExtra = normalizeExtra(video.extra)
    if (videoExtra !== undefined) next.video.extra = videoExtra
    if (typeof video.apiKey === 'string' && video.apiKey.trim()) next.video.apiKey = video.apiKey.trim().slice(0, 500)
    if (video.clearKey === true) next.video.apiKey = ''

    const voice = patch.voice ?? {}
    for (const key of ['preset', 'model', 'voice', 'format']) {
      const value = trim(voice[key], 200)
      if (value !== undefined) next.voice[key] = value
    }
    const voiceUrl = normalizeBaseUrl(voice.baseUrl)
    if (voiceUrl !== undefined) next.voice.baseUrl = voiceUrl
    const voiceExtra = normalizeExtra(voice.extra)
    if (voiceExtra !== undefined) next.voice.extra = voiceExtra
    if (typeof voice.apiKey === 'string' && voice.apiKey.trim()) next.voice.apiKey = voice.apiKey.trim().slice(0, 500)
    if (voice.clearKey === true) next.voice.apiKey = ''

    const storage = patch.storage ?? {}
    const outputDir = normalizeOutputDir(storage.outputDir)
    if (outputDir !== undefined) {
      if (outputDir) {
        try {
          await mkdir(outputDir, { recursive: true })
          await access(outputDir, constants.W_OK)
          const probe = join(outputDir, `.media-workbench-write-test-${process.pid}`)
          await writeFile(probe, '')
          await unlink(probe).catch(() => {})
        } catch {
          const err = new Error('产物目录不可写，换一个目录')
          err.status = 400
          throw err
        }
      }
      next.storage.outputDir = outputDir
    }

    if (['auto', 'zh', 'en'].includes(patch.language)) next.language = patch.language

    const tmp = `${this.file}.${process.pid}.tmp`
    await writeFile(tmp, JSON.stringify(next, null, 2), { mode: 0o600 })
    await chmod(tmp, 0o600)
    await rename(tmp, this.file)
    return next
  }
}

export function imageKey(settings) {
  return settings.image.apiKey || process.env.MEDIA_WORKBENCH_IMAGE_API_KEY || ''
}

export function videoKey(settings) {
  return settings.video.apiKey || process.env.MEDIA_WORKBENCH_VIDEO_API_KEY || ''
}

export function voiceKey(settings) {
  return settings.voice.apiKey || process.env.MEDIA_WORKBENCH_VOICE_API_KEY || ''
}

export function imageReady(settings) {
  return Boolean(settings.image.baseUrl && settings.image.model && imageKey(settings))
}

export function videoReady(settings) {
  return Boolean(settings.video.baseUrl && settings.video.model && videoKey(settings))
}

export function voiceReady(settings) {
  return Boolean(settings.voice.baseUrl && settings.voice.model && voiceKey(settings))
}

export function publicSettings(settings) {
  const image = { ...settings.image }
  const video = { ...settings.video }
  const voice = { ...settings.voice }
  const imageHint = image.apiKey ? image.apiKey.slice(-4) : ''
  const videoHint = video.apiKey ? video.apiKey.slice(-4) : ''
  const voiceHint = voice.apiKey ? voice.apiKey.slice(-4) : ''
  delete image.apiKey
  delete video.apiKey
  delete voice.apiKey
  return {
    ...settings,
    image: { ...image, hasKey: Boolean(imageKey(settings)), keyHint: imageHint },
    video: { ...video, hasKey: Boolean(videoKey(settings)), keyHint: videoHint },
    voice: { ...voice, hasKey: Boolean(voiceKey(settings)), keyHint: voiceHint },
    imageReady: imageReady(settings),
    videoReady: videoReady(settings),
    voiceReady: voiceReady(settings),
  }
}
