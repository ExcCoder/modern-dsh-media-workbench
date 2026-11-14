// 插件设置：接口地址、模型、密钥。密钥只留本机，返回浏览器时永远脱敏。
// 每个板块（生图 / 视频 / 语音 / 写作）都能存多套供应商，扁平字段始终等于当前选中的那条。
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

export const WRITING_PRESETS = [
  { id: 'deepseek', name: 'DeepSeek', baseUrl: 'https://api.deepseek.com/v1', model: 'deepseek-chat', note: 'POST /chat/completions' },
  { id: 'openai', name: 'OpenAI', baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o-mini', note: 'POST /chat/completions' },
  { id: 'siliconflow', name: '硅基流动', baseUrl: 'https://api.siliconflow.cn/v1', model: 'deepseek-ai/DeepSeek-V3', note: 'POST /chat/completions' },
  { id: 'zhipu', name: '智谱 BigModel', baseUrl: 'https://open.bigmodel.cn/api/paas/v4', model: 'glm-4-flash', note: 'POST /chat/completions' },
  { id: 'custom', name: '自定义', baseUrl: '', model: '', note: '任何兼容 /chat/completions 的服务；不配就用 DSH 当前模型' },
]

/** 支持多供应商的板块 */
export const PROVIDER_KINDS = ['image', 'video', 'voice', 'writing']

const DEFAULTS = {
  image: {
    preset: 'openai',
    baseUrl: '',
    model: '',
    apiKey: '',
    size: '1024x1024',
    quality: '',
    extra: '',
    activeId: '',
    providers: [],
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
    activeId: '',
    providers: [],
  },
  voice: {
    preset: 'openai',
    baseUrl: '',
    model: '',
    apiKey: '',
    voice: 'alloy',
    format: 'mp3',
    extra: '',
    activeId: '',
    providers: [],
  },
  // 写作留空就用 DSH 当前模型，填了才走这里配的 /chat/completions
  writing: {
    preset: 'deepseek',
    baseUrl: '',
    model: '',
    apiKey: '',
    extra: '',
    activeId: '',
    providers: [],
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

/** 供应商条目：一条就是一个可切换的服务 */
export function newProviderId() {
  return `p_${Math.random().toString(16).slice(2, 8)}${Date.now().toString(16).slice(-4)}`
}

/** 没起名字时按域名生成一个，别把 /v1 这类路径也带上 */
function defaultProviderName(baseUrl) {
  if (!baseUrl) return '未命名'
  try {
    return new URL(baseUrl).host || baseUrl
  } catch {
    return baseUrl.replace(/^https?:\/\//, '').split('/')[0] || '未命名'
  }
}

function normalizeProvider(raw = {}) {
  const id = typeof raw.id === 'string' && /^[\w-]{1,40}$/.test(raw.id) ? raw.id : newProviderId()
  const baseUrl = normalizeBaseUrl(raw.baseUrl ?? '') ?? ''
  const provider = {
    id,
    name: trim(raw.name, 40) || '',
    preset: trim(raw.preset, 40) || 'custom',
    baseUrl,
    model: trim(raw.model, 200) || '',
    apiKey: typeof raw.apiKey === 'string' ? raw.apiKey.trim().slice(0, 500) : '',
    models: Array.isArray(raw.models)
      ? [...new Set(raw.models.filter(item => typeof item === 'string' && item).map(item => item.slice(0, 200)))].slice(0, 500)
      : [],
    modelsAt: typeof raw.modelsAt === 'string' ? raw.modelsAt : '',
    modelsBase: typeof raw.modelsBase === 'string' ? raw.modelsBase : '',
  }
  if (!provider.name) provider.name = defaultProviderName(provider.baseUrl)
  return provider
}

/** 老版本只存了一条扁平配置，读的时候补成一条供应商 */
function migrateProviders(section) {
  const list = Array.isArray(section.providers) ? section.providers.map(normalizeProvider) : []
  if (list.length) {
    const activeId = list.some(item => item.id === section.activeId) ? section.activeId : list[0].id
    return { providers: list, activeId }
  }
  if (!section.baseUrl && !section.apiKey && !section.model) return { providers: [], activeId: '' }
  const provider = normalizeProvider({
    name: defaultProviderName(section.baseUrl),
    preset: section.preset,
    baseUrl: section.baseUrl,
    model: section.model,
    apiKey: section.apiKey,
  })
  return { providers: [provider], activeId: provider.id }
}

/** 读出供应商列表，并把扁平字段对齐到当前选中的那条 */
function syncSection(section) {
  const { providers, activeId } = migrateProviders(section)
  const active = providers.find(item => item.id === activeId)
  if (!active) return { ...section, providers, activeId }
  return {
    ...section,
    providers,
    activeId,
    preset: active.preset,
    baseUrl: active.baseUrl,
    model: active.model,
    apiKey: active.apiKey,
  }
}

/**
 * 供应商增删改 + 扁平字段，返回整理后的板块。
 * 表单上改的地址/模型/密钥会写回当前那条供应商。
 */
function applySectionPatch(section, patch = {}) {
  let providers = Array.isArray(section.providers) ? section.providers.map(normalizeProvider) : []
  let activeId = typeof section.activeId === 'string' ? section.activeId : ''

  if (patch.provider && typeof patch.provider === 'object' && !Array.isArray(patch.provider)) {
    const raw = patch.provider
    const existing = raw.id ? providers.find(item => item.id === raw.id) : null
    const keepKey = existing?.apiKey ?? ''
    const merged = normalizeProvider({
      ...(existing ?? {}),
      ...raw,
      apiKey: typeof raw.apiKey === 'string' && raw.apiKey.trim()
        ? raw.apiKey.trim().slice(0, 500)
        : (raw.clearKey === true ? '' : keepKey),
    })
    if (existing) providers = providers.map(item => (item.id === existing.id ? merged : item))
    else providers.push(merged)
    activeId = merged.id
  }

  if (typeof patch.removeProvider === 'string' && patch.removeProvider) {
    providers = providers.filter(item => item.id !== patch.removeProvider)
    if (activeId === patch.removeProvider) activeId = providers[0]?.id ?? ''
  }

  if (typeof patch.activeId === 'string' && patch.activeId) activeId = patch.activeId

  if (patch.models && typeof patch.models === 'object' && typeof patch.models.id === 'string' && Array.isArray(patch.models.list)) {
    const target = providers.find(item => item.id === patch.models.id)
    if (target) {
      target.models = [...new Set(patch.models.list.filter(v => typeof v === 'string' && v).map(v => v.slice(0, 200)))].slice(0, 500)
      target.modelsAt = new Date().toISOString()
      target.modelsBase = typeof patch.models.baseUrl === 'string' ? patch.models.baseUrl : target.baseUrl
    }
  }

  let active = providers.find(item => item.id === activeId) ?? providers[0] ?? null
  if (active) activeId = active.id

  const preset = trim(patch.preset, 200)
  const model = trim(patch.model, 200)
  const baseUrl = normalizeBaseUrl(patch.baseUrl)
  let apiKey = active?.apiKey ?? section.apiKey
  if (typeof patch.apiKey === 'string' && patch.apiKey.trim()) apiKey = patch.apiKey.trim().slice(0, 500)
  if (patch.clearKey === true) apiKey = ''

  const flat = {
    preset: preset ?? active?.preset ?? section.preset,
    baseUrl: baseUrl ?? active?.baseUrl ?? section.baseUrl,
    model: model ?? active?.model ?? section.model,
    apiKey: apiKey ?? '',
  }

  if (active) {
    active.preset = flat.preset
    active.baseUrl = flat.baseUrl
    active.model = flat.model
    active.apiKey = flat.apiKey
    if (!active.name) active.name = defaultProviderName(flat.baseUrl)
  } else if (flat.baseUrl || flat.apiKey || flat.model) {
    const created = normalizeProvider({ ...flat, name: defaultProviderName(flat.baseUrl) })
    providers.push(created)
    activeId = created.id
  }

  return { ...section, ...flat, providers, activeId }
}

export class Settings {
  constructor(root) {
    this.file = join(root, 'settings.json')
  }

  async read() {
    try {
      const saved = JSON.parse(await readFile(this.file, 'utf8'))
      const voice = syncSection({ ...DEFAULTS.voice, ...(saved.voice ?? {}) })
      if (/minimax|t2a_v2/i.test(voice.baseUrl)) {
        if (voice.preset === 'openai') voice.preset = 'minimax'
        if (['alloy', 'echo', 'fable', 'onyx', 'nova', 'shimmer', 'coral', 'verse', 'ballad', 'ash', 'sage', 'marin', 'cedar'].includes(voice.voice)) {
          voice.voice = 'male-qn-qingse'
        }
      }
      return {
        ...DEFAULTS,
        ...saved,
        image: syncSection({ ...DEFAULTS.image, ...(saved.image ?? {}) }),
        video: syncSection({ ...DEFAULTS.video, ...(saved.video ?? {}) }),
        voice,
        writing: syncSection({ ...DEFAULTS.writing, ...(saved.writing ?? {}) }),
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

    if (patch.image) {
      const image = patch.image
      const merged = applySectionPatch(next.image, image)
      const size = trim(image.size, 200)
      const quality = trim(image.quality, 200)
      const extra = normalizeExtra(image.extra)
      next.image = {
        ...merged,
        size: size ?? next.image.size,
        quality: quality ?? next.image.quality,
        extra: extra ?? next.image.extra,
      }
    }

    if (patch.video) {
      const video = patch.video
      const merged = applySectionPatch(next.video, video)
      const createPath = normalizePath(video.createPath, '/videos')
      const statusPath = normalizePath(video.statusPath, '/videos/{id}')
      const contentPath = normalizePath(video.contentPath, '/videos/{id}/content')
      const imageField = trim(video.imageField, 200)
      const extra = normalizeExtra(video.extra)
      next.video = {
        ...merged,
        createPath: createPath ?? next.video.createPath,
        statusPath: statusPath ?? next.video.statusPath,
        contentPath: contentPath ?? next.video.contentPath,
        imageField: imageField ?? next.video.imageField,
        extra: extra ?? next.video.extra,
      }
    }

    if (patch.voice) {
      const voicePatch = patch.voice
      const merged = applySectionPatch(next.voice, voicePatch)
      const voiceName = trim(voicePatch.voice, 200)
      const format = trim(voicePatch.format, 200)
      const extra = normalizeExtra(voicePatch.extra)
      next.voice = {
        ...merged,
        voice: voiceName ?? next.voice.voice,
        format: format ?? next.voice.format,
        extra: extra ?? next.voice.extra,
      }
    }

    if (patch.writing) {
      const writing = patch.writing
      const merged = applySectionPatch(next.writing, writing)
      const extra = normalizeExtra(writing.extra)
      next.writing = { ...merged, extra: extra ?? next.writing.extra }
    }

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

export function writingKey(settings) {
  return settings.writing?.apiKey || process.env.MEDIA_WORKBENCH_WRITING_API_KEY || ''
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

/** 写作不配就用 DSH 当前模型，所以没就绪也不算错 */
export function writingReady(settings) {
  const writing = settings.writing ?? {}
  return Boolean(writing.baseUrl && writing.model && writingKey(settings))
}

function publicSection(section, hasKey) {
  const { apiKey, providers, ...rest } = section
  return {
    ...rest,
    providers: (providers ?? []).map(item => {
      const { apiKey: key, ...providerRest } = item
      return { ...providerRest, hasKey: Boolean(key), keyHint: key ? key.slice(-4) : '' }
    }),
    hasKey,
    keyHint: apiKey ? apiKey.slice(-4) : '',
  }
}

export function publicSettings(settings) {
  return {
    ...settings,
    image: publicSection(settings.image, Boolean(imageKey(settings))),
    video: publicSection(settings.video, Boolean(videoKey(settings))),
    voice: publicSection(settings.voice, Boolean(voiceKey(settings))),
    writing: publicSection(settings.writing ?? DEFAULTS.writing, Boolean(writingKey(settings))),
    imageReady: imageReady(settings),
    videoReady: videoReady(settings),
    voiceReady: voiceReady(settings),
    writingReady: writingReady(settings),
  }
}
