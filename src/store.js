// 本机持久化：$DSH_HOME/media-workbench-modern/state.json
import { mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { templateGraph } from './graph.js'

export const STATE_VERSION = 1

export function dshHome(env = process.env) {
  return env.DSH_HOME || join(homedir(), '.dsh')
}

const WELCOME = `写作不是一次成形的。

先把脑子里的画面写下来，不用管顺序；等它有了轮廓，再回头删掉多余的解释。留下动作、声音、光线，和人物没有说出口的那句话。

这一段可以随便改。选中文字，用右侧的「润色」或「改写」；想往下写，就点「续写」。`

function seed() {
  const now = new Date().toISOString()
  return {
    version: STATE_VERSION,
    images: [],
    videos: [],
    voices: [],
    docs: [
      {
        id: 'doc_welcome',
        title: '欢迎来到写作工作台',
        content: WELCOME,
        outline: '',
        wordGoal: 1200,
        createdAt: now,
        updatedAt: now,
      },
    ],
    graphs: [templateGraph('inspiration')],
    blueprints: [],
    preferences: {
      imageStyle: '电影感',
      imageRatio: '16:9',
      imageCount: 1,
      videoMode: 'text',
      videoRatio: '16:9',
      videoDuration: 5,
      writingTone: '自然叙述',
      writingPov: '第三人称',
      writingLength: 'medium',
    },
  }
}

function obj(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {}
}

function list(value, max) {
  return Array.isArray(value) ? value.filter(row => row && obj(row) && typeof row.id === 'string').slice(0, max) : []
}

export function normalizeState(input) {
  const state = obj(input)
  const base = seed()
  const preferences = { ...base.preferences, ...obj(state.preferences) }
  const graphs = list(state.graphs, 40).map(g => ({
    ...g,
    name: typeof g.name === 'string' ? g.name : '未命名星图',
    nodes: Array.isArray(g.nodes) ? g.nodes : [],
    edges: Array.isArray(g.edges) ? g.edges : [],
    updatedAt: g.updatedAt ?? new Date().toISOString(),
  }))
  return {
    version: STATE_VERSION,
    images: list(state.images, 300).map(normalizeImage),
    videos: list(state.videos, 150).map(normalizeVideo),
    voices: list(state.voices, 150).map(normalizeVoice),
    docs: list(state.docs, 200).map(normalizeDoc),
    graphs: graphs.length ? graphs : base.graphs,
    blueprints: Array.isArray(state.blueprints) ? state.blueprints.slice(0, 60) : [],
    preferences,
  }
}

function normalizeImage(row) {
  const status = ['queued', 'running', 'done', 'error'].includes(row.status) ? row.status : 'done'
  const references = (Array.isArray(row.references) ? row.references : row.reference ? [row.reference] : [])
    .filter(name => typeof name === 'string' && name)
    .slice(0, 8)
  return {
    id: row.id,
    prompt: String(row.prompt ?? ''),
    negative: String(row.negative ?? ''),
    style: String(row.style ?? ''),
    model: String(row.model ?? ''),
    provider: String(row.provider ?? ''),
    size: String(row.size ?? ''),
    reference: String(row.reference ?? references[0] ?? ''),
    references,
    source: String(row.source ?? ''),
    mode: row.mode === 'outpaint' ? 'outpaint' : row.mode === 'inpaint' ? 'inpaint' : '',
    file: String(row.file ?? ''),
    width: Number(row.width) || 0,
    height: Number(row.height) || 0,
    status,
    error: String(row.error ?? ''),
    favorite: Boolean(row.favorite),
    createdAt: row.createdAt ?? new Date().toISOString(),
  }
}

function normalizeVideo(row) {
  const status = ['queued', 'running', 'done', 'error'].includes(row.status) ? row.status : 'done'
  return {
    id: row.id,
    prompt: String(row.prompt ?? ''),
    mode: ['text', 'image', 'storyboard'].includes(row.mode) ? row.mode : 'text',
    model: String(row.model ?? ''),
    aspect: String(row.aspect ?? '16:9'),
    duration: Number(row.duration) || 5,
    reference: String(row.reference ?? ''),
    file: String(row.file ?? ''),
    poster: String(row.poster ?? ''),
    frames: Array.isArray(row.frames) ? row.frames.filter(f => typeof f === 'string').slice(0, 8) : [],
    progress: Math.max(0, Math.min(100, Number(row.progress) || 0)),
    status,
    error: String(row.error ?? ''),
    createdAt: row.createdAt ?? new Date().toISOString(),
  }
}

function normalizeVoice(row) {
  const status = ['queued', 'running', 'done', 'error'].includes(row.status) ? row.status : 'done'
  return {
    id: row.id,
    text: String(row.text ?? ''),
    voice: String(row.voice ?? ''),
    model: String(row.model ?? ''),
    format: String(row.format ?? 'mp3'),
    file: String(row.file ?? ''),
    status,
    error: String(row.error ?? ''),
    createdAt: row.createdAt ?? new Date().toISOString(),
  }
}

function normalizeDoc(row) {  return {
    id: row.id,
    title: String(row.title ?? '未命名作品'),
    content: String(row.content ?? ''),
    outline: String(row.outline ?? ''),
    wordGoal: Math.max(0, Number(row.wordGoal) || 0),
    createdAt: row.createdAt ?? new Date().toISOString(),
    updatedAt: row.updatedAt ?? new Date().toISOString(),
  }
}

export class Store {
  constructor(root = join(dshHome(), 'media-workbench-modern')) {
    this.root = root
    this.file = join(root, 'state.json')
    this.filesDir = join(root, 'files')
    this.state = null
    this.mtimeMs = 0
    this.queue = Promise.resolve()
  }

  async useFilesDir(dir) {
    this.filesDir = dir
    await mkdir(dir, { recursive: true })
  }

  async refresh() {
    await mkdir(this.filesDir, { recursive: true })
    let info = null
    try {
      info = await stat(this.file)
    } catch (err) {
      if (err.code !== 'ENOENT') throw err
    }
    if (!info) {
      if (!this.state) {
        this.state = seed()
        await this.persist()
      }
      return
    }
    if (this.state && info.mtimeMs === this.mtimeMs) return
    try {
      this.state = normalizeState(JSON.parse(await readFile(this.file, 'utf8')))
    } catch {
      // 文件坏了不覆盖用户数据：另存一份，再从空状态开始
      const broken = `${this.file}.broken-${Date.now()}`
      await rename(this.file, broken).catch(() => {})
      this.state = seed()
      await this.persist()
      return
    }
    this.mtimeMs = info.mtimeMs
  }

  async persist() {
    const tmp = `${this.file}.${process.pid}.tmp`
    await writeFile(tmp, JSON.stringify(this.state, null, 2))
    await rename(tmp, this.file)
    this.mtimeMs = (await stat(this.file)).mtimeMs
  }

  run(task) {
    const next = this.queue.then(task, task)
    this.queue = next.catch(() => {})
    return next
  }

  read() {
    return this.run(async () => {
      await this.refresh()
      return this.state
    })
  }

  mutate(fn) {
    return this.run(async () => {
      await this.refresh()
      const result = await fn(this.state)
      await this.persist()
      return result
    })
  }

  /** 进程重启后，把没跑完的记录标成中断，避免界面一直转圈 */
  settle() {
    return this.mutate(state => {
      let changed = 0
      for (const row of state.images) {
        if (row.status === 'queued' || row.status === 'running') {
          row.status = 'error'
          row.error = '上次生成被中断，可以重试'
          changed++
        }
      }
      for (const row of state.videos) {
        if (row.status === 'queued' || row.status === 'running') {
          row.status = 'error'
          row.error = '上次生成被中断，可以重试'
          changed++
        }
      }
      for (const row of state.voices) {
        if (row.status === 'queued' || row.status === 'running') {
          row.status = 'error'
          row.error = '上次生成被中断，可以重试'
          changed++
        }
      }
      for (const graph of state.graphs) {
        if (graph.run?.status === 'running' || graph.run?.status === 'queued') {
          graph.run.status = 'error'
          graph.run.error = '上次运行被中断'
          for (const node of graph.nodes) if (node.status === 'running') { node.status = 'error'; node.error = '上次运行被中断' }
          changed++
        }
      }
      return changed
    })
  }
}
