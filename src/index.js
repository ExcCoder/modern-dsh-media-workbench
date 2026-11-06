// @modern/dsh-media-workbench · host 入口
// 四个工作台共用一套本机存储：生图 / 视频 / 写作 / 星图
import { writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createNode, dependencyClosure, normalizeGraph, RATIOS, templateGraph, topoWaves } from './graph.js'
import { apply as applyTools } from './tools.js'
import { generateImage } from './image.js'
import { modelInfo, streamText } from './llm.js'
import { imageReady, IMAGE_PRESETS, publicSettings, Settings, VIDEO_PRESETS, videoReady } from './settings.js'
import { Store, migrateLegacyData } from './store.js'
import { clampInt, extensionOf, fail, imageSize, json, newId, readBuffer, readJson, safeJoin, sendFile, videoExtensionOf } from './util.js'
import { generateStoryboard, generateVideo } from './video.js'
import { cleanOutput, writingPrompts } from './writing.js'

const ROOT = dirname(fileURLToPath(import.meta.url))
const WEB_DIR = join(ROOT, '..', 'web')
const BASE = '/media-workbench-modern'
const VERSION = '0.1.1'

const STATIC = new Map([
  ['', 'index.html'],
  ['/', 'index.html'],
  ['/index.html', 'index.html'],
  ['/app.js', 'app.js'],
  ['/styles.css', 'styles.css'],
  ['/favicon.svg', 'favicon.svg'],
])

function sameOrigin(req) {
  const site = req.headers['sec-fetch-site']
  if (site && site !== 'same-origin' && site !== 'none') return false
  const origin = req.headers.origin
  if (!origin) return true
  try {
    return new URL(origin).host === req.headers.host
  } catch {
    return false
  }
}

function rejection(ctx, req) {
  const connection = ctx.get('connection')
  if (typeof connection?.requestRejection !== 'function') return 403
  return connection.requestRejection({ headers: req.headers })
}

export const name = '@modern/dsh-media-workbench'
export const inject = ['webServer', 'connection', 'tools']

export function apply(ctx) {
  const store = new Store()
  const settings = new Settings(store.root)
  const jobs = new Map()
  const graphJobs = new Map()
  let settled = false

  // 第一次改名后，把旧目录的数据复制一次；不阻塞页面静态资源
  const ready = migrateLegacyData(store.root).catch(err => {
    console.warn('[media-workbench-modern] legacy data migration failed:', err.message)
    return false
  })

  const settleOnce = async () => {
    await ready
    if (settled) return
    settled = true
    await store.settle().catch(() => {})
  }

  const saveImageBuffer = async (id, result) => {
    const file = `${id}${result.ext}`
    await writeFile(join(store.filesDir, file), result.buffer)
    return file
  }

  const updateImage = (id, patch) => store.mutate(state => {
    const row = state.images.find(item => item.id === id)
    if (!row) return null
    Object.assign(row, patch)
    return row
  })

  async function runImage(id, request) {
    const current = await settings.read()
    const controller = new AbortController()
    jobs.set(id, controller)
    await updateImage(id, { status: 'running', error: '' })
    try {
      const result = await generateImage(current, request, { signal: controller.signal, filesDir: store.filesDir })
      const file = await saveImageBuffer(id, result)
      await updateImage(id, {
        status: 'done',
        file,
        width: result.width,
        height: result.height,
        model: request.model || current.image.model,
        error: '',
      })
      return { file }
    } catch (err) {
      await updateImage(id, { status: 'error', error: controller.signal.aborted ? '已停止' : err.message })
      throw err
    } finally {
      jobs.delete(id)
    }
  }

  async function createImages(body) {
    const current = await settings.read()
    if (!imageReady(current)) throw fail('还没有配置生图服务。打开「设置 → 生图服务」，填接口地址、模型和密钥。', 400)
    const prompt = String(body.prompt ?? '').trim()
    if (!prompt) throw fail('先写一句提示词', 400)
    const count = clampInt(body.count, 1, 4, 1)
    const ratio = RATIOS[body.ratio]
    const size = String(body.size ?? '').trim() || ratio?.size || current.image.size
    const reference = typeof body.reference === 'string' ? body.reference.replace(/[^\w.-]/g, '') : ''
    const records = []
    for (let i = 0; i < count; i++) {
      records.push({
        id: newId('img'),
        prompt: prompt.slice(0, 3000),
        negative: String(body.negative ?? '').slice(0, 1000),
        style: String(body.style ?? '').slice(0, 40),
        model: String(body.model ?? current.image.model).slice(0, 120),
        size,
        reference,
        file: '',
        width: 0,
        height: 0,
        status: 'queued',
        error: '',
        favorite: false,
        createdAt: new Date().toISOString(),
      })
    }
    await store.mutate(state => { state.images.unshift(...records); state.images = state.images.slice(0, 300) })
    void Promise.all(records.map(row => runImage(row.id, row).catch(() => {})))
    return records
  }

  async function createVideo(body) {
    const current = await settings.read()
    const mode = ['text', 'image', 'storyboard'].includes(body.mode) ? body.mode : 'text'
    const prompt = String(body.prompt ?? '').trim()
    if (!prompt) throw fail('先写一句画面描述', 400)
    if (mode === 'storyboard') {
      if (!imageReady(current)) throw fail('分镜短片需要先生图服务。也可以配好视频服务后改成文生视频。', 400)
    } else if (!videoReady(current)) {
      throw fail('还没有配置视频服务。可以先切到「分镜短片」，用生图服务拼出动态预览。', 400)
    }
    const ratio = RATIOS[body.ratio] ? String(body.ratio) : '16:9'
    const record = {
      id: newId('vid'),
      prompt: prompt.slice(0, 3000),
      mode,
      model: String(body.model ?? current.video.model).slice(0, 120),
      aspect: ratio,
      duration: clampInt(body.duration, 2, 20, 5),
      reference: typeof body.reference === 'string' ? body.reference.replace(/[^\w.-]/g, '') : '',
      file: '',
      poster: '',
      frames: [],
      progress: 0,
      status: 'queued',
      error: '',
      createdAt: new Date().toISOString(),
    }
    await store.mutate(state => { state.videos.unshift(record); state.videos = state.videos.slice(0, 150) })
    void runVideoRecord(record.id)
    return record
  }

  async function runVideoRecord(id) {
    const state = await store.read()
    const row = state.videos.find(item => item.id === id)
    if (!row) return
    const current = await settings.read()
    const controller = new AbortController()
    jobs.set(id, controller)
    const patch = value => store.mutate(draft => {
      const target = draft.videos.find(item => item.id === id)
      if (target) Object.assign(target, value)
    })
    await patch({ status: 'running', progress: 3, error: '' })
    try {
      if (row.mode === 'storyboard') {
        const result = await generateStoryboard(current, row, {
          signal: controller.signal,
          filesDir: store.filesDir,
          onProgress: progress => { void patch({ progress }) },
        })
        const frames = []
        for (const [index, frame] of result.frames.entries()) {
          const name = `vid_${id}_${index + 1}${frame.ext}`
          await writeFile(join(store.filesDir, name), frame.buffer)
          frames.push(name)
        }
        await patch({
          status: 'done',
          progress: 100,
          frames,
          poster: frames[0] ?? '',
          error: result.errors.length ? `部分分镜失败：${result.errors[0]}` : '',
        })
      } else {
        const result = await generateVideo(current, row, {
          signal: controller.signal,
          filesDir: store.filesDir,
          onProgress: progress => { void patch({ progress }) },
        })
        const name = `vid_${id}${result.ext || videoExtensionOf(result.buffer)}`
        await writeFile(join(store.filesDir, name), result.buffer)
        await patch({ status: 'done', progress: 100, file: name })
      }
    } catch (err) {
      await patch({ status: 'error', error: controller.signal.aborted ? '已停止' : err.message })
    } finally {
      jobs.delete(id)
    }
  }

  async function saveDocument(body) {
    const title = String(body.title ?? '').trim().slice(0, 120) || '未命名作品'
    const content = String(body.content ?? '').slice(0, 400_000)
    const outline = String(body.outline ?? '').slice(0, 20_000)
    return store.mutate(state => {
      const id = typeof body.id === 'string' ? body.id : ''
      let doc = id ? state.docs.find(item => item.id === id) : null
      if (!doc) {
        doc = { id: newId('doc'), title, content, outline, wordGoal: Number(body.wordGoal) || 0, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }
        state.docs.unshift(doc)
        state.docs = state.docs.slice(0, 200)
      } else {
        doc.title = title
        doc.content = content
        doc.outline = outline
        if (body.wordGoal !== undefined) doc.wordGoal = Number(body.wordGoal) || 0
        doc.updatedAt = new Date().toISOString()
      }
      return doc
    })
  }

  async function updateGraph(graphId, fn) {
    return store.mutate(state => {
      const graph = state.graphs.find(item => item.id === graphId)
      if (!graph) return null
      return fn(graph)
    })
  }

  async function saveGraph(body) {
    const incoming = body.graph && typeof body.graph === 'object' ? body.graph : body
    const normalized = normalizeGraph(incoming, { name: incoming?.name })
    return store.mutate(state => {
      const id = typeof incoming.id === 'string' ? incoming.id : ''
      const existing = id ? state.graphs.find(item => item.id === id) : null
      if (existing) {
        existing.name = normalized.name
        // 保存布局和参数时保留已有运行结果，避免一次自动保存把产出抹掉
        existing.nodes = normalized.nodes.map(node => {
          const old = existing.nodes.find(item => item.id === node.id)
          return old ? { ...node, status: old.status, output: old.output, error: old.error } : node
        })
        existing.edges = normalized.edges
        existing.updatedAt = new Date().toISOString()
        return existing
      }
      state.graphs.unshift(normalized)
      state.graphs = state.graphs.slice(0, 40)
      return normalized
    })
  }

  async function runGraph(graphId, targetIds) {
    const state = await store.read()
    const graph = state.graphs.find(item => item.id === graphId)
    if (!graph) throw fail('星图不存在', 404)
    if (graphJobs.has(graphId)) throw fail('这张星图正在运行', 409)
    if (!graph.nodes.length) throw fail('星图还是空的，先加几个节点', 400)
    const targets = Array.isArray(targetIds) && targetIds.length
      ? targetIds.filter(id => graph.nodes.some(node => node.id === id))
      : graph.nodes.filter(node => !graph.edges.some(edge => edge.from.node === node.id)).map(node => node.id)
    if (!targets.length) throw fail('没有可运行的目标节点', 400)
    const subset = dependencyClosure(graph, targets)
    const { waves, ok } = topoWaves(graph, subset)
    if (!ok) throw fail('星图里有环路，先修好再运行', 400)
    const controller = new AbortController()
    graphJobs.set(graphId, controller)
    await updateGraph(graphId, draft => {
      draft.run = { status: 'running', startedAt: new Date().toISOString(), wave: 0, waves: waves.length, targets, error: '' }
      for (const node of draft.nodes) {
        if (subset.has(node.id)) {
          node.status = 'idle'
          node.output = null
          node.error = ''
        }
      }
    })
    void executeGraph(graphId, waves, subset, controller).catch(() => {})
    return { waves: waves.length, targets }
  }

  async function executeGraph(graphId, waves, subset, controller) {
    const appSettings = await settings.read()
    const failed = new Set()
    try {
      for (const [index, wave] of waves.entries()) {
        if (controller.signal.aborted) throw new Error('已停止')
        await updateGraph(graphId, draft => { if (draft.run) draft.run.wave = index + 1 })
        await Promise.all(wave.map(async nodeId => {
          if (controller.signal.aborted) return
          const state = await store.read()
          const graph = state.graphs.find(item => item.id === graphId)
          const node = graph?.nodes.find(item => item.id === nodeId)
          if (!node) return
          const incoming = graph.edges.filter(edge => edge.to.node === nodeId)
          if (incoming.some(edge => failed.has(edge.from.node))) {
            failed.add(nodeId)
            await updateGraph(graphId, draft => {
              const target = draft.nodes.find(item => item.id === nodeId)
              if (target) { target.status = 'error'; target.error = '上游节点失败，已跳过' }
            })
            return
          }
          await updateGraph(graphId, draft => {
            const target = draft.nodes.find(item => item.id === nodeId)
            if (target) { target.status = 'running'; target.error = '' }
          })
          try {
            const output = await executeNode(graph, node, { appSettings, controller })
            await updateGraph(graphId, draft => {
              const target = draft.nodes.find(item => item.id === nodeId)
              if (target) { target.status = 'done'; target.output = output }
            })
          } catch (err) {
            failed.add(nodeId)
            await updateGraph(graphId, draft => {
              const target = draft.nodes.find(item => item.id === nodeId)
              if (target) { target.status = 'error'; target.error = controller.signal.aborted ? '已停止' : err.message }
            })
          }
        }))
      }
      await updateGraph(graphId, draft => {
        if (draft.run) {
          draft.run.status = failed.size ? 'error' : 'done'
          draft.run.finishedAt = new Date().toISOString()
          if (failed.size) draft.run.error = `${failed.size} 个节点失败`
        }
      })
    } catch (err) {
      await updateGraph(graphId, draft => {
        if (draft.run) {
          draft.run.status = controller.signal.aborted ? 'stopped' : 'error'
          draft.run.error = controller.signal.aborted ? '已停止' : err.message
          draft.run.finishedAt = new Date().toISOString()
        }
        for (const node of draft.nodes) {
          if (node.status === 'running') {
            node.status = 'error'
            node.error = controller.signal.aborted ? '已停止' : '运行中断'
          }
        }
      })
    } finally {
      graphJobs.delete(graphId)
    }
  }

  function upstreamText(graph, nodeId, port) {
    const parts = []
    for (const edge of graph.edges) {
      if (edge.to.node !== nodeId) continue
      if (port && edge.to.port !== port) continue
      const source = graph.nodes.find(node => node.id === edge.from.node)
      const output = source?.output
      if (output?.kind === 'text' && output.text) parts.push(output.text)
      else if (typeof output?.text === 'string') parts.push(output.text)
    }
    return parts.join('\n\n').trim()
  }

  function upstreamMedia(graph, nodeId, port) {
    for (const edge of graph.edges) {
      if (edge.to.node !== nodeId) continue
      if (port && edge.to.port !== port) continue
      const source = graph.nodes.find(node => node.id === edge.from.node)
      if (source?.output) return source.output
    }
    return null
  }

  async function executeNode(graph, node, { appSettings, controller }) {
    const config = node.config ?? {}
    if (node.type === 'note') return null
    if (node.type === 'prompt') return { kind: 'text', text: String(config.text ?? '').trim() }
    if (node.type === 'preview') return upstreamMedia(graph, node.id)
    if (node.type === 'write') {
      const prompts = writingPrompts({
        action: 'graph',
        title: config.title ?? '',
        content: upstreamText(graph, node.id, 'context'),
        instruction: String(config.instruction ?? ''),
        tone: config.tone,
        length: config.length,
        lang: 'zh',
      })
      const { text, model } = await streamText(ctx, { system: prompts.system, user: prompts.user, maxTokens: 1400, signal: controller.signal })
      return { kind: 'text', text: cleanOutput(text, 'graph'), model }
    }
    if (node.type === 'image') {
      if (!imageReady(appSettings)) throw new Error('未配置生图服务')
      const prompt = [upstreamText(graph, node.id, 'prompt'), config.prompt].filter(Boolean).join('\n')
      if (!prompt.trim()) throw new Error('没有提示词')
      const ratio = RATIOS[config.ratio] ?? RATIOS['16:9']
      const reference = upstreamMedia(graph, node.id, 'reference')
      const result = await generateImage(appSettings, {
        prompt,
        style: config.style,
        size: ratio.size,
        reference: reference?.kind === 'image' ? reference.file : undefined,
      }, { signal: controller.signal, filesDir: store.filesDir })
      const name = `node_${node.id}_${Date.now().toString(36)}${result.ext}`
      await writeFile(join(store.filesDir, name), result.buffer)
      return { kind: 'image', file: name, width: result.width, height: result.height }
    }
    if (node.type === 'video') {
      const prompt = [upstreamText(graph, node.id, 'prompt'), config.prompt].filter(Boolean).join('\n').trim()
      if (!prompt) throw new Error('没有画面描述')
      const first = upstreamMedia(graph, node.id, 'first')
      const mode = config.mode === 'storyboard' ? 'storyboard' : first?.kind === 'image' ? 'image' : 'text'
      const ratio = RATIOS[config.ratio] ? config.ratio : '16:9'
      const record = {
        id: newId('gv'),
        prompt,
        mode,
        aspect: ratio,
        duration: clampInt(config.duration, 2, 20, 5),
        reference: first?.kind === 'image' ? first.file : '',
      }
      if (mode === 'storyboard') {
        if (!imageReady(appSettings)) throw new Error('分镜模式需要生图服务')
        const result = await generateStoryboard(appSettings, record, { signal: controller.signal, filesDir: store.filesDir })
        const frames = []
        for (const [index, frame] of result.frames.entries()) {
          const name = `node_${node.id}_${index + 1}${frame.ext}`
          await writeFile(join(store.filesDir, name), frame.buffer)
          frames.push(name)
        }
        return { kind: 'video', file: '', frames, poster: frames[0] ?? '', storyboard: true }
      }
      if (!videoReady(appSettings)) throw new Error('未配置视频服务，可把节点模式改成「分镜」')
      const result = await generateVideo(appSettings, record, { signal: controller.signal, filesDir: store.filesDir })
      const name = `node_${node.id}_${Date.now().toString(36)}${result.ext || videoExtensionOf(result.buffer)}`
      await writeFile(join(store.filesDir, name), result.buffer)
      return { kind: 'video', file: name }
    }
    throw new Error(`不支持的节点类型：${node.type}`)
  }

  async function streamWriting(req, res, body) {
    const prompts = writingPrompts({ ...body, lang: body.lang === 'en' ? 'en' : 'zh' })
    res.statusCode = 200
    res.setHeader('content-type', 'application/x-ndjson; charset=utf-8')
    res.setHeader('cache-control', 'no-store')
    res.setHeader('x-accel-buffering', 'no')
    const controller = new AbortController()
    req.on('close', () => { if (!res.writableEnded) controller.abort() })
    const send = payload => { if (!res.writableEnded) res.write(`${JSON.stringify(payload)}\n`) }
    try {
      const { text, model } = await streamText(ctx, {
        system: prompts.system,
        user: prompts.user,
        maxTokens: 4000,
        signal: controller.signal,
        onDelta: delta => send({ type: 'delta', text: delta }),
      })
      send({ type: 'done', text: cleanOutput(text, prompts.action), model })
    } catch (err) {
      send({ type: 'error', message: controller.signal.aborted ? '已停止' : err.message })
    } finally {
      res.end()
    }
  }

  async function handleUpload(req, res) {
    const type = String(req.headers['content-type'] || '').split(';')[0].trim().toLowerCase()
    const ext = { 'image/png': '.png', 'image/jpeg': '.jpg', 'image/webp': '.webp', 'image/gif': '.gif' }[type]
    if (!ext) return json(res, 415, { error: '只支持 PNG / JPG / WebP / GIF' })
    const buffer = await readBuffer(req, 25_000_000)
    if (!buffer.length) return json(res, 400, { error: '文件是空的' })
    const sniffed = extensionOf(buffer)
    if (!sniffed) return json(res, 400, { error: '这个文件不是图片' })
    const name = `ref_${newId('f')}${sniffed}`
    await writeFile(join(store.filesDir, name), buffer)
    const size = imageSize(buffer)
    return json(res, 200, { name, url: `${BASE}/files/${name}`, width: size?.width ?? 0, height: size?.height ?? 0 })
  }

  async function route(req, res) {
    if (req.method === 'POST' && !sameOrigin(req)) return json(res, 403, { error: '拒绝跨站请求' })
    const url = new URL(req.url || '/', 'http://local')
    let path
    try {
      path = decodeURIComponent(url.pathname)
    } catch {
      return json(res, 400, { error: '路径无效' })
    }
    if (path === BASE) path = `${BASE}/`
    if (!path.startsWith(BASE)) return json(res, 404, { error: '接口不存在' })
    const rel = path.slice(BASE.length)

    if (req.method === 'GET' || req.method === 'HEAD') {
      const mapped = STATIC.get(rel)
      if (mapped) return sendFile(req, res, join(WEB_DIR, mapped), { cache: 'no-cache' })
      if (rel.startsWith('/views/') || rel.startsWith('/lib/') || rel.startsWith('/assets/')) {
        const file = safeJoin(WEB_DIR, rel)
        if (!file) return json(res, 404, { error: '文件不存在' })
        return sendFile(req, res, file, { cache: 'no-cache' })
      }
      if (rel.startsWith('/files/')) {
        const name = rel.slice('/files/'.length)
        if (!/^[\w.-]+$/.test(name)) return json(res, 400, { error: '路径无效' })
        await settleOnce()
        return sendFile(req, res, join(store.filesDir, name))
      }
    }

    if (!rel.startsWith('/api/')) return json(res, 404, { error: '接口不存在' })
    await settleOnce()
    const api = rel.slice('/api/'.length)
    const method = req.method || 'GET'

    if (method === 'GET') {
      if (api === 'bootstrap' || api === 'state') {
        const [state, config] = await Promise.all([store.read(), settings.read()])
        return json(res, 200, {
          state,
          settings: publicSettings(config),
          imagePresets: IMAGE_PRESETS,
          videoPresets: VIDEO_PRESETS,
          model: modelInfo(ctx),
          version: VERSION,
          dataDir: store.root,
        })
      }
      if (api === 'export') {
        const state = await store.read()
        res.setHeader('content-disposition', `attachment; filename="media-workbench-modern-${Date.now()}.json"`)
        return json(res, 200, state)
      }
      return json(res, 404, { error: '接口不存在' })
    }

    if (method !== 'POST') return json(res, 405, { error: '不支持的方法' })
    if (api === 'upload') return handleUpload(req, res)

    const body = await readJson(req)

    if (api === 'settings') {
      const next = await settings.update(body)
      return json(res, 200, { settings: publicSettings(next) })
    }
    if (api === 'settings/test-image') {
      const current = await settings.read()
      if (!imageReady(current)) return json(res, 400, { error: '先填好生图服务' })
      const id = newId('test')
      const result = await generateImage(current, {
        prompt: 'A single paper boat on calm warm-grey water, soft morning light, minimalist editorial photograph, no text',
        style: '',
        size: RATIOS['1:1'].size,
      }, { filesDir: store.filesDir })
      const file = await saveImageBuffer(id, result)
      return json(res, 200, { file, url: `${BASE}/files/${file}`, width: result.width, height: result.height })
    }
    if (api === 'image/generate') {
      const records = await createImages(body)
      return json(res, 200, { items: records })
    }
    if (api === 'image/action') {
      const id = String(body.id ?? '')
      if (body.action === 'favorite') {
        const row = await store.mutate(state => {
          const target = state.images.find(item => item.id === id)
          if (target) target.favorite = !target.favorite
          return target
        })
        return json(res, 200, { item: row })
      }
      if (body.action === 'delete' || body.action === 'retry') {
        const state = await store.read()
        const record = state.images.find(item => item.id === id)
        if (!record) return json(res, 404, { error: '记录不存在' })
        if (body.action === 'delete') {
          await store.mutate(draft => { draft.images = draft.images.filter(item => item.id !== id) })
          return json(res, 200, { ok: true })
        }
        await store.mutate(draft => {
          const target = draft.images.find(item => item.id === id)
          if (target) { target.status = 'queued'; target.error = '' }
        })
        void runImage(id, record).catch(() => {})
        return json(res, 200, { ok: true })
      }
      return json(res, 400, { error: '未知操作' })
    }
    if (api === 'video/generate') {
      const record = await createVideo(body)
      return json(res, 200, { item: record })
    }
    if (api === 'video/cancel') {
      jobs.get(String(body.id ?? ''))?.abort()
      return json(res, 200, { ok: true })
    }
    if (api === 'video/action') {
      const id = String(body.id ?? '')
      if (body.action === 'delete') {
        await store.mutate(draft => { draft.videos = draft.videos.filter(item => item.id !== id) })
        return json(res, 200, { ok: true })
      }
      if (body.action === 'retry') {
        const state = await store.read()
        if (!state.videos.some(item => item.id === id)) return json(res, 404, { error: '记录不存在' })
        await store.mutate(draft => {
          const target = draft.videos.find(item => item.id === id)
          if (target) { target.status = 'queued'; target.progress = 0; target.error = ''; target.file = ''; target.frames = [] }
        })
        void runVideoRecord(id)
        return json(res, 200, { ok: true })
      }
      return json(res, 400, { error: '未知操作' })
    }
    if (api === 'document/save') {
      const doc = await saveDocument(body)
      return json(res, 200, { doc })
    }
    if (api === 'document/action') {
      const id = String(body.id ?? '')
      if (body.action === 'delete') {
        await store.mutate(draft => { draft.docs = draft.docs.filter(item => item.id !== id) })
        return json(res, 200, { ok: true })
      }
      if (body.action === 'duplicate') {
        const doc = await store.mutate(draft => {
          const source = draft.docs.find(item => item.id === id)
          if (!source) return null
          const copy = { ...source, id: newId('doc'), title: `${source.title} 副本`, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }
          draft.docs.unshift(copy)
          return copy
        })
        return doc ? json(res, 200, { doc }) : json(res, 404, { error: '作品不存在' })
      }
      return json(res, 400, { error: '未知操作' })
    }
    if (api === 'write/stream') return streamWriting(req, res, body)
    if (api === 'graph/save') {
      const graph = await saveGraph(body)
      return json(res, 200, { graph })
    }
    if (api === 'graph/create') {
      const graph = body.template ? templateGraph(String(body.template)) : normalizeGraph({ name: body.name ?? '空白星图' })
      if (!body.template && body.name) graph.name = String(body.name).slice(0, 40)
      await store.mutate(state => { state.graphs.unshift(graph); state.graphs = state.graphs.slice(0, 40) })
      return json(res, 200, { graph })
    }
    if (api === 'graph/action') {
      const id = String(body.id ?? '')
      if (body.action === 'delete') {
        await store.mutate(state => { state.graphs = state.graphs.filter(item => item.id !== id) })
        return json(res, 200, { ok: true })
      }
      if (body.action === 'duplicate') {
        const graph = await store.mutate(state => {
          const source = state.graphs.find(item => item.id === id)
          if (!source) return null
          const copy = normalizeGraph({ ...source, name: `${source.name} 副本` })
          state.graphs.unshift(copy)
          return copy
        })
        return graph ? json(res, 200, { graph }) : json(res, 404, { error: '星图不存在' })
      }
      return json(res, 400, { error: '未知操作' })
    }
    if (api === 'graph/run') {
      const result = await runGraph(String(body.id ?? ''), body.targetIds)
      return json(res, 200, result)
    }
    if (api === 'graph/stop') {
      graphJobs.get(String(body.id ?? ''))?.abort()
      return json(res, 200, { ok: true })
    }
    if (api === 'graph/import') {
      const graph = normalizeGraph(body.payload ?? body.graph ?? body)
      await store.mutate(state => { state.graphs.unshift(graph); state.graphs = state.graphs.slice(0, 40) })
      return json(res, 200, { graph })
    }
    if (api === 'blueprint/save') {
      const graph = body.graph
      if (!graph) return json(res, 400, { error: '缺少星图数据' })
      const blueprint = normalizeGraph(graph, { name: graph.name })
      for (const node of blueprint.nodes) { node.output = null; node.status = 'idle'; node.error = '' }
      delete blueprint.run
      await store.mutate(state => {
        state.blueprints.unshift({ ...blueprint, id: newId('bp'), savedAt: new Date().toISOString() })
        state.blueprints = state.blueprints.slice(0, 60)
      })
      return json(res, 200, { blueprint })
    }
    if (api === 'blueprint/use') {
      const state = await store.read()
      const blueprint = state.blueprints.find(item => item.id === body.id)
      if (!blueprint) return json(res, 404, { error: '蓝图不存在' })
      const graph = normalizeGraph({ ...blueprint, name: blueprint.name })
      const idMap = new Map(graph.nodes.map(node => [node.id, createNode(node.type, node.x, node.y, node.config).id]))
      for (const node of graph.nodes) node.id = idMap.get(node.id)
      for (const edge of graph.edges) {
        edge.from.node = idMap.get(edge.from.node)
        edge.to.node = idMap.get(edge.to.node)
      }
      await store.mutate(draft => { draft.graphs.unshift(graph); draft.graphs = draft.graphs.slice(0, 40) })
      return json(res, 200, { graph })
    }
    if (api === 'preferences') {
      const preferences = await store.mutate(state => {
        for (const key of ['imageStyle', 'imageRatio', 'imageCount', 'videoMode', 'videoRatio', 'videoDuration', 'writingTone', 'writingPov', 'writingLength']) {
          if (body[key] !== undefined) state.preferences[key] = body[key]
        }
        return state.preferences
      })
      return json(res, 200, { preferences })
    }
    if (api === 'clear') {
      const scope = String(body.scope ?? '')
      if (!['images', 'videos', 'all'].includes(scope)) return json(res, 400, { error: '未知范围' })
      await store.mutate(state => {
        if (scope === 'images' || scope === 'all') state.images = []
        if (scope === 'videos' || scope === 'all') state.videos = []
      })
      return json(res, 200, { ok: true })
    }
    return json(res, 404, { error: '接口不存在' })
  }

  ctx.effect(() => ctx.webServer.register({
    kind: 'prefix',
    path: BASE,
    handler: async (req, res) => {
      try {
        const deny = rejection(ctx, req)
        if (deny) return json(res, deny, { error: '未授权' })
        await route(req, res)
      } catch (err) {
        if (res.headersSent) return res.end()
        json(res, err.status || 500, { error: err.message })
      }
    },
  }), '@modern/dsh-media-workbench: routes')

  ctx.effect(() => () => {
    for (const controller of jobs.values()) controller.abort()
    for (const controller of graphJobs.values()) controller.abort()
  }, '@modern/dsh-media-workbench: abort jobs')

  applyTools(ctx, { store, settings, saveImageBuffer, createVideo, runGraph, saveDocument, templateGraph, BASE, ready })
}

export { BASE }
