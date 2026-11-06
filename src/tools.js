// 注册给模型的四个工具：让 DSH 在对话里也能直接用工作台
import { join } from 'node:path'
import { imageReady, videoReady } from './settings.js'
import { RATIOS, templateGraph } from './graph.js'

const text = value => [{ type: 'text', text: value }]

const str = (description, extra = {}) => ({ type: 'string', description, ...extra })
const num = (description, extra = {}) => ({ type: 'number', description, ...extra })

function check(args, schema) {
  const errors = []
  for (const key of schema.required ?? []) {
    if (args?.[key] === undefined || args[key] === '') errors.push(`缺少 ${key}`)
  }
  for (const key of Object.keys(args ?? {})) {
    if (!schema.properties[key]) errors.push(`未知参数 ${key}`)
  }
  if (errors.length) throw new Error(errors.join('；'))
}

function absolute(filesDir, file) {
  return join(filesDir, file)
}

function wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

async function waitUntil(fn, { timeoutMs = 600_000, interval = 1500 } = {}) {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    const value = await fn()
    if (value) return value
    await wait(interval)
  }
  return null
}

export function apply(ctx, deps) {
  const { store, settings, saveImageBuffer, runImage, createVideo, runVideoRecord, runGraph, saveDocument } = deps

  const imageTool = {
    name: 'modern_media_generate_image',
    description: '在「摩登-媒体工作室 → 生图工作台」里生成图片，结果会自动存进作品历史。用户要做封面、配图、海报、概念图时用。需要用户先在插件设置里配好生图服务。生成后可以用 present 把文件给用户看。',
    parameters: {
      type: 'object',
      additionalProperties: false,
      required: ['prompt'],
      properties: {
        prompt: str('画面描述。写清主体、动作、构图、光线、材质和氛围；不要在画面里放文字。'),
        style: str('风格：电影感 / 插画 / 水墨 / 赛博朋克 / 胶片 / 3D / 极简 / 浮世绘 / 概念艺术，或留空'),
        ratio: str('画幅', { enum: Object.keys(RATIOS) }),
        count: num('生成几张，1 到 2', { minimum: 1, maximum: 2 }),
        reference: str('（可选）参考图文件名，来自工作台上传的图；用它会走图生图/编辑'),
      },
    },
    timeoutMs: 300_000,
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        required: ['files', 'urls', 'prompt'],
        properties: {
          files: { type: 'array', items: { type: 'string' } },
          urls: { type: 'array', items: { type: 'string' } },
          prompt: { type: 'string' },
        },
      },
      render: (_args, value) => text(`已在工作台生成 ${value.files.length} 张图：\n${value.files.map(file => `- ${file}`).join('\n')}`),
    },
    async execute(args) {
      check(args, { ...imageTool.parameters })
      const current = await settings.read()
      if (!imageReady(current)) throw new Error('还没有配置生图服务，请让用户打开「摩登-媒体工作室 → 设置 → 生图服务」。')
      const count = Math.max(1, Math.min(2, Math.round(Number(args.count) || 1)))
      const ratio = RATIOS[args.ratio] ?? RATIOS['1:1']
      const prompt = String(args.prompt).trim()
      const files = []
      const urls = []
      for (let i = 0; i < count; i++) {
        const id = `tool_${Date.now().toString(36)}${i}`
        const result = await runImageDirect(id, {
          prompt,
          style: args.style ?? '',
          size: ratio.size,
          reference: args.reference ?? '',
          model: current.image.model,
        })
        files.push(result.path)
        urls.push(result.url)
      }
      return { files, urls, prompt }
    },
  }

  async function runImageDirect(id, request) {
    const current = await settings.read()
    const { generateImage } = await import('./image.js')
    const result = await generateImage(current, request, { filesDir: store.filesDir })
    const file = await saveImageBuffer(id, result)
    const row = {
      id,
      prompt: request.prompt,
      negative: '',
      style: request.style ?? '',
      model: current.image.model,
      size: request.size,
      reference: request.reference ?? '',
      file,
      width: result.width,
      height: result.height,
      status: 'done',
      error: '',
      favorite: false,
      createdAt: new Date().toISOString(),
    }
    await store.mutate(state => { state.images.unshift(row); state.images = state.images.slice(0, 300) })
    return { path: absolute(store.filesDir, file), url: `${deps.BASE}/files/${file}` }
  }

  const documentTool = {
    name: 'modern_media_save_document',
    description: '把一篇写好的稿子保存进「摩登-媒体工作室 → 写作工作台」，用户可以在那里继续改。适合交付文章、脚本、章节、报告。',
    parameters: {
      type: 'object',
      additionalProperties: false,
      required: ['title', 'content'],
      properties: {
        title: str('作品标题'),
        content: str('完整正文，Markdown 或纯文本'),
        outline: str('（可选）大纲，Markdown'),
      },
    },
    timeoutMs: 30_000,
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        required: ['id', 'title', 'chars'],
        properties: { id: { type: 'string' }, title: { type: 'string' }, chars: { type: 'integer' } },
      },
      render: (_args, value) => text(`已保存到写作工作台：${value.title}（${value.chars} 字）。`),
    },
    async execute(args) {
      check(args, documentTool.parameters)
      const doc = await saveDocument({ title: args.title, content: args.content, outline: args.outline ?? '' })
      return { id: doc.id, title: doc.title, chars: [...String(args.content)].length }
    },
  }

  const videoTool = {
    name: 'modern_media_generate_video',
    description: '在「摩登-媒体工作室 → 视频工作台」里生成视频或分镜短片。没有配置视频服务时，用 mode=storyboard 以 4 张关键帧做出动态分镜。任务较长，默认等到完成（最多 9 分钟）。',
    parameters: {
      type: 'object',
      additionalProperties: false,
      required: ['prompt'],
      properties: {
        prompt: str('画面描述，写清镜头、动作、光线和氛围'),
        mode: str('模式', { enum: ['text', 'image', 'storyboard'] }),
        ratio: str('画幅', { enum: Object.keys(RATIOS) }),
        duration: num('时长（秒），2 到 20', { minimum: 2, maximum: 20 }),
        reference: str('（可选）首帧图片文件名'),
        wait: { type: 'boolean', description: '是否等到完成再返回，默认 true' },
      },
    },
    timeoutMs: 600_000,
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        required: ['id', 'status'],
        properties: {
          id: { type: 'string' },
          status: { type: 'string' },
          file: { type: 'string' },
          frames: { type: 'array', items: { type: 'string' } },
          error: { type: 'string' },
        },
      },
      render: (_args, value) => text(value.status === 'done'
        ? `视频已完成：${value.file || `${value.frames?.length ?? 0} 张分镜`}\n${value.file ?? ''}`
        : `视频任务 ${value.id} 当前状态：${value.status}${value.error ? `（${value.error}）` : ''}`),
    },
    async execute(args) {
      check(args, videoTool.parameters)
      const current = await settings.read()
      const mode = args.mode ?? 'text'
      if (mode !== 'storyboard' && !videoReady(current)) {
        if (mode === 'text' && imageReady(current)) args.mode = 'storyboard'
        else throw new Error('还没有配置视频服务，也没有可用的生图服务。')
      }
      const item = await createVideo({
        prompt: args.prompt,
        mode: args.mode ?? 'text',
        ratio: args.ratio,
        duration: args.duration,
        reference: args.reference,
      })
      if (args.wait === false) return { id: item.id, status: 'queued' }
      const done = await waitUntil(async () => {
        const state = await store.read()
        const row = state.videos.find(v => v.id === item.id)
        if (!row) return { status: 'missing' }
        if (row.status === 'done' || row.status === 'error') return row
        return null
      }, { timeoutMs: 540_000, interval: 2000 })
      if (!done) return { id: item.id, status: 'running' }
      return {
        id: item.id,
        status: done.status,
        ...(done.file ? { file: absolute(store.filesDir, done.file) } : {}),
        ...(done.frames?.length ? { frames: done.frames.map(file => absolute(store.filesDir, file)) } : {}),
        ...(done.error ? { error: done.error } : {}),
      }
    },
  }

  const mapTool = {
    name: 'modern_media_run_star_map',
    description: '运行「摩登-媒体工作室 → 星图工作台」里的一张星图（提示词 → 写作 → 生图 → 视频 → 预览的有向无环图）。可以先用模板 inspiration / card / video 新建一张再运行。返回每个节点产出的文件与文字。',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        graphId: str('要运行的星图 id；不填则用 template 新建一张'),
        template: str('新建星图用的模板', { enum: ['inspiration', 'card', 'video'] }),
        name: str('新建星图的名字'),
      },
    },
    timeoutMs: 900_000,
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        required: ['graphId', 'status', 'outputs'],
        properties: {
          graphId: { type: 'string' },
          status: { type: 'string' },
          outputs: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              required: ['nodeId', 'type', 'status'],
              properties: {
                nodeId: { type: 'string' },
                type: { type: 'string' },
                status: { type: 'string' },
                text: { type: 'string' },
                file: { type: 'string' },
                error: { type: 'string' },
              },
            },
          },
        },
      },
      render: (_args, value) => text(`星图 ${value.graphId}：${value.status}\n${value.outputs.map(row => `- [${row.type}] ${row.status}${row.file ? ` → ${row.file}` : ''}${row.text ? ` → ${row.text.slice(0, 80)}` : ''}`).join('\n')}`),
    },
    async execute(args) {
      check(args, mapTool.parameters)
      let graphId = args.graphId
      if (!graphId) {
        if (!args.template) throw new Error('要么给 graphId，要么给 template')
        const graph = templateGraph(args.template)
        if (args.name) graph.name = String(args.name).slice(0, 40)
        await store.mutate(state => { state.graphs.unshift(graph); state.graphs = state.graphs.slice(0, 40) })
        graphId = graph.id
      }
      await runGraph(graphId, [])
      const done = await waitUntil(async () => {
        const state = await store.read()
        const graph = state.graphs.find(g => g.id === graphId)
        if (graph?.run && ['done', 'error', 'stopped'].includes(graph.run.status)) return graph
        return null
      }, { timeoutMs: 840_000, interval: 2000 })
      const state = await store.read()
      const graph = done ?? state.graphs.find(g => g.id === graphId)
      const outputs = (graph?.nodes ?? []).filter(node => node.type !== 'note').map(node => ({
        nodeId: node.id,
        type: node.type,
        status: node.status ?? 'idle',
        ...(node.output?.kind === 'text' && node.output.text ? { text: node.output.text } : {}),
        ...(node.output?.file ? { file: absolute(store.filesDir, node.output.file) } : {}),
        ...(node.error ? { error: node.error } : {}),
      }))
      return { graphId, status: graph?.run?.status ?? 'unknown', outputs }
    },
  }

  const inspectTool = {
    name: 'modern_media_workspace_overview',
    description: '查看「摩登-媒体工作室」里现有的作品：最近的图片、视频、写作文档和星图。想接着用户的上一件作品做时先用它。',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        kind: str('要看的类型', { enum: ['all', 'images', 'videos', 'documents', 'graphs'] }),
        limit: num('最多返回几条，默认 8', { minimum: 1, maximum: 30 }),
      },
    },
    timeoutMs: 30_000,
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        required: ['summary'],
        properties: { summary: { type: 'string' }, data: { type: 'object' } },
      },
      render: (_args, value) => text(value.summary),
    },
    async execute(args) {
      check(args, inspectTool.parameters)
      const state = await store.read()
      const limit = Math.max(1, Math.min(30, Number(args.limit) || 8))
      const kind = args.kind ?? 'all'
      const data = {}
      const lines = []
      if (kind === 'all' || kind === 'images') {
        data.images = state.images.slice(0, limit).map(row => ({ id: row.id, prompt: row.prompt, style: row.style, file: row.file, favorite: row.favorite }))
        lines.push(`图片 ${state.images.length} 张`)
        for (const row of data.images) lines.push(`- ${row.prompt.slice(0, 50)}${row.file ? `（${row.file}）` : ''}`)
      }
      if (kind === 'all' || kind === 'videos') {
        data.videos = state.videos.slice(0, limit).map(row => ({ id: row.id, prompt: row.prompt, mode: row.mode, status: row.status, file: row.file }))
        lines.push(`视频 ${state.videos.length} 条`)
      }
      if (kind === 'all' || kind === 'documents') {
        data.documents = state.docs.slice(0, limit).map(row => ({ id: row.id, title: row.title, chars: [...row.content].length, updatedAt: row.updatedAt }))
        lines.push(`文档 ${state.docs.length} 篇`)
        for (const row of data.documents) lines.push(`- ${row.title}（${row.chars} 字）`)
      }
      if (kind === 'all' || kind === 'graphs') {
        data.graphs = state.graphs.slice(0, limit).map(row => ({ id: row.id, name: row.name, nodes: row.nodes.length }))
        lines.push(`星图 ${state.graphs.length} 张`)
      }
      return { summary: lines.join('\n'), data }
    },
  }

  for (const tool of [imageTool, documentTool, videoTool, mapTool, inspectTool]) ctx.tools.register(tool)
}

export { text }
