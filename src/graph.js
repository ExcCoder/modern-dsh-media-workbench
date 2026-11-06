// 星图：节点/端口契约、DAG 校验、拓扑波次、内置蓝图
export const NODE_TYPES = {
  prompt: {
    label: '提示词',
    icon: 'spark',
    color: '#d97757',
    inputs: [],
    outputs: [{ id: 'text', type: 'text' }],
    defaults: { text: '' },
  },
  write: {
    label: '灵感写作',
    icon: 'pen',
    color: '#b4833e',
    inputs: [{ id: 'context', type: 'text', multi: true }],
    outputs: [{ id: 'text', type: 'text' }],
    defaults: { instruction: '根据上面的提示，写一段有画面感的文字', tone: '自然叙述', length: 'short' },
  },
  image: {
    label: '图像生成',
    icon: 'image',
    color: '#8a6fd1',
    inputs: [
      { id: 'prompt', type: 'text', multi: true },
      { id: 'reference', type: 'image' },
    ],
    outputs: [{ id: 'image', type: 'image' }],
    defaults: { style: '电影感', ratio: '16:9', prompt: '' },
  },
  video: {
    label: '视频生成',
    icon: 'film',
    color: '#3f8f92',
    inputs: [
      { id: 'prompt', type: 'text', multi: true },
      { id: 'first', type: 'image' },
    ],
    outputs: [{ id: 'video', type: 'video' }],
    defaults: { duration: 5, ratio: '16:9', mode: 'auto', prompt: '' },
  },
  preview: {
    label: '作品预览',
    icon: 'eye',
    color: '#6b7280',
    inputs: [{ id: 'media', type: 'media', multi: true }],
    outputs: [],
    defaults: {},
  },
  note: {
    label: '便签',
    icon: 'note',
    color: '#a8935b',
    inputs: [],
    outputs: [],
    defaults: { text: '' },
  },
}

export const PORT_LABEL = { text: '文本', image: '图像', video: '视频', media: '作品' }

export const STYLES = {
  电影感: 'cinematic lighting, film still, shallow depth of field, muted color grade, highly detailed',
  插画: 'editorial illustration, refined linework, textured brush strokes, warm limited palette',
  水墨: 'traditional Chinese ink painting, rice paper texture, negative space, elegant brushwork',
  赛博朋克: 'cyberpunk city at night, neon reflections, volumetric fog, cinematic composition',
  胶片: 'analog film photograph, grain, soft halation, natural light, Kodak Portra palette',
  '3D': 'stylized 3D render, soft studio lighting, clay and glass materials, clean composition',
  极简: 'minimalist composition, generous negative space, calm geometry, subtle gradients',
  浮世绘: 'ukiyo-e woodblock print, flat color fields, bold outlines, patterned waves',
  概念艺术: 'concept art, matte painting, epic scale, atmospheric perspective, production design',
}

export const RATIOS = {
  '1:1': { size: '1024x1024', w: 1, h: 1 },
  '4:3': { size: '1152x864', w: 4, h: 3 },
  '3:2': { size: '1216x832', w: 3, h: 2 },
  '16:9': { size: '1344x768', w: 16, h: 9 },
  '9:16': { size: '768x1344', w: 9, h: 16 },
  '2:3': { size: '832x1216', w: 2, h: 3 },
}

export function nodeDef(type) {
  return NODE_TYPES[type] ?? null
}

export function portType(node, portId, direction) {
  const def = nodeDef(node?.type)
  if (!def) return null
  const list = direction === 'in' ? def.inputs : def.outputs
  return list.find(p => p.id === portId) ?? null
}

export function emptyGraph(name = '未命名星图') {
  return { id: `g_${Date.now().toString(36)}`, name, nodes: [], edges: [], updatedAt: new Date().toISOString() }
}

export function createNode(type, x, y, config = {}) {
  const def = nodeDef(type)
  if (!def) throw new Error(`未知节点类型：${type}`)
  return {
    id: `n_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
    type,
    x: Math.round(x),
    y: Math.round(y),
    config: { ...def.defaults, ...config },
    status: 'idle',
    output: null,
    error: '',
  }
}

export function edgeId() {
  return `e_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`
}

/** 连接是否合法：端口存在、类型兼容、单输入不重复、不成环 */
export function canConnect(graph, from, to) {
  if (!from || !to) return { ok: false, reason: '连接不完整' }
  if (from.node === to.node) return { ok: false, reason: '不能连接自己' }
  const source = graph.nodes.find(n => n.id === from.node)
  const target = graph.nodes.find(n => n.id === to.node)
  if (!source || !target) return { ok: false, reason: '节点不存在' }
  const out = portType(source, from.port, 'out')
  const input = portType(target, to.port, 'in')
  if (!out || !input) return { ok: false, reason: '端口不存在' }
  if (out.type !== input.type && input.type !== 'media') return { ok: false, reason: `端口类型不匹配：${PORT_LABEL[out.type]} → ${PORT_LABEL[input.type]}` }
  if (graph.edges.some(e => e.from.node === from.node && e.from.port === from.port && e.to.node === to.node && e.to.port === to.port)) {
    return { ok: false, reason: '这两个端口已经连过了' }
  }
  if (!input.multi && graph.edges.some(e => e.to.node === to.node && e.to.port === to.port)) {
    return { ok: false, reason: '这个输入只能接一条线' }
  }
  if (wouldCycle(graph, from.node, to.node)) return { ok: false, reason: '会形成环路，星图必须是 DAG' }
  return { ok: true }
}

export function wouldCycle(graph, fromNode, toNode) {
  // 加边 fromNode -> toNode 后是否成环：从 toNode 能否回到 fromNode
  const adj = new Map()
  for (const e of graph.edges) {
    if (!adj.has(e.from.node)) adj.set(e.from.node, [])
    adj.get(e.from.node).push(e.to.node)
  }
  if (!adj.has(fromNode)) adj.set(fromNode, [])
  adj.get(fromNode).push(toNode)
  const seen = new Set()
  const stack = [toNode]
  while (stack.length) {
    const cur = stack.pop()
    if (cur === fromNode) return true
    if (seen.has(cur)) continue
    seen.add(cur)
    for (const next of adj.get(cur) ?? []) stack.push(next)
  }
  return false
}

/** 目标节点及其全部祖先 */
export function dependencyClosure(graph, targets) {
  const keep = new Set()
  const byId = new Map(graph.nodes.map(n => [n.id, n]))
  const incoming = new Map()
  for (const e of graph.edges) {
    if (!incoming.has(e.to.node)) incoming.set(e.to.node, [])
    incoming.get(e.to.node).push(e.from.node)
  }
  const walk = id => {
    if (keep.has(id) || !byId.has(id)) return
    keep.add(id)
    for (const parent of incoming.get(id) ?? []) walk(parent)
  }
  for (const id of targets) walk(id)
  return keep
}

/** Kahn 拓扑排序，返回并行波次 */
export function topoWaves(graph, subset) {
  const ids = new Set(subset ?? graph.nodes.map(n => n.id))
  const nodes = graph.nodes.filter(n => ids.has(n.id))
  const indeg = new Map(nodes.map(n => [n.id, 0]))
  const out = new Map(nodes.map(n => [n.id, []]))
  for (const e of graph.edges) {
    if (!ids.has(e.from.node) || !ids.has(e.to.node)) continue
    indeg.set(e.to.node, (indeg.get(e.to.node) ?? 0) + 1)
    if (!out.has(e.from.node)) out.set(e.from.node, [])
    out.get(e.from.node).push(e.to.node)
  }
  const waves = []
  let ready = nodes.filter(n => indeg.get(n.id) === 0).map(n => n.id)
  const done = new Set()
  while (ready.length) {
    waves.push([...ready])
    const next = []
    for (const id of ready) {
      done.add(id)
      for (const child of out.get(id) ?? []) {
        indeg.set(child, indeg.get(child) - 1)
        if (indeg.get(child) === 0) next.push(child)
      }
    }
    ready = next
  }
  return { waves, ok: done.size === nodes.length }
}

/** 校验一张外部导入的星图，修复可修复的，丢弃危险连线 */
export function normalizeGraph(input, { name } = {}) {
  const graph = emptyGraph(name ?? '导入的星图')
  if (!input || typeof input !== 'object') return graph
  const rawNodes = Array.isArray(input.nodes) ? input.nodes.slice(0, 80) : []
  const seen = new Set()
  for (const raw of rawNodes) {
    if (!raw || typeof raw !== 'object') continue
    const def = nodeDef(raw.type)
    if (!def) continue
    let id = typeof raw.id === 'string' ? raw.id.slice(0, 64) : ''
    if (!id) id = createNode(raw.type, 0, 0).id
    if (seen.has(id)) continue
    seen.add(id)
    graph.nodes.push({
      id,
      type: raw.type,
      x: Number.isFinite(Number(raw.x)) ? Math.max(-4000, Math.min(8000, Math.round(Number(raw.x)))) : 80,
      y: Number.isFinite(Number(raw.y)) ? Math.max(-4000, Math.min(8000, Math.round(Number(raw.y)))) : 80,
      config: typeof raw.config === 'object' && raw.config ? { ...def.defaults, ...raw.config } : { ...def.defaults },
      status: 'idle',
      output: null,
      error: '',
    })
  }
  const ids = new Set(graph.nodes.map(n => n.id))
  const edgeKeys = new Set()
  for (const raw of Array.isArray(input.edges) ? input.edges.slice(0, 160) : []) {
    if (!raw || typeof raw !== 'object') continue
    const from = raw.from ?? {}
    const to = raw.to ?? {}
    if (!ids.has(from.node) || !ids.has(to.node)) continue
    const candidate = graph
    const check = canConnect(candidate, from, to)
    if (!check.ok) continue
    const key = `${from.node}:${from.port}>${to.node}:${to.port}`
    if (edgeKeys.has(key)) continue
    edgeKeys.add(key)
    graph.edges.push({ id: edgeId(), from: { node: from.node, port: from.port }, to: { node: to.node, port: to.port } })
  }
  graph.name = typeof input.name === 'string' && input.name.trim() ? input.name.trim().slice(0, 40) : graph.name
  return graph
}

const N = (type, id, x, y, config) => ({ id: `n_${id}`, type, x, y, config, status: 'idle', output: null, error: '' })
const E = (id, from, fromPort, to, toPort) => ({ id: `e_${id}`, from: { node: `n_${from}`, port: fromPort }, to: { node: `n_${to}`, port: toPort } })

export function templateGraph(key) {
  if (key === 'inspiration') {
    return {
      id: `g_${Date.now().toString(36)}`,
      name: '灵感成片',
      nodes: [
        N('prompt', 'p1', 60, 170, { text: '雨停后的城市天台，一个人把耳机摘下，听见远处的车流。' }),
        N('write', 'w1', 372, 120, { instruction: '把提示扩写成一段 80 字以内的旁白，克制、有画面感，不要解释。', tone: '克制冷静', length: 'short' }),
        N('image', 'i1', 684, 80, { style: '电影感', ratio: '16:9', prompt: '' }),
        N('preview', 'v1', 996, 145, {}),
      ],
      edges: [E('1', 'p1', 'text', 'w1', 'context'), E('2', 'w1', 'text', 'i1', 'prompt'), E('3', 'i1', 'image', 'v1', 'media')],
      updatedAt: new Date().toISOString(),
    }
  }
  if (key === 'video') {
    return {
      id: `g_${Date.now().toString(36)}`,
      name: '短片分镜',
      nodes: [
        N('prompt', 'p1', 50, 170, { text: '清晨的海边公路，一辆旧巴士驶过，车窗里有人望向海面。' }),
        N('write', 'w1', 362, 120, { instruction: '写一段适合做短片旁白的文字，三句话，有起承转合。', tone: '自然叙述', length: 'short' }),
        N('image', 'i1', 674, 70, { style: '胶片', ratio: '16:9', prompt: '' }),
        N('video', 'm1', 986, 60, { duration: 5, ratio: '16:9', mode: 'image', prompt: '' }),
        N('preview', 'v1', 1298, 125, {}),
      ],
      edges: [E('1', 'p1', 'text', 'w1', 'context'), E('2', 'w1', 'text', 'i1', 'prompt'), E('3', 'w1', 'text', 'm1', 'prompt'), E('4', 'i1', 'image', 'm1', 'first'), E('5', 'm1', 'video', 'v1', 'media')],
      updatedAt: new Date().toISOString(),
    }
  }
  if (key === 'card') {
    return {
      id: `g_${Date.now().toString(36)}`,
      name: '图文卡片',
      nodes: [
        N('prompt', 'p1', 70, 175, { text: '写一句关于「慢下来」的短句，像卡片上印的那样。' }),
        N('write', 'w1', 382, 130, { instruction: '扩写成 60 字以内的短文，适合放在图片下方。', tone: '诗意', length: 'short' }),
        N('image', 'i1', 694, 80, { style: '极简', ratio: '4:3', prompt: '' }),
        N('preview', 'v1', 1006, 150, {}),
      ],
      edges: [E('1', 'p1', 'text', 'w1', 'context'), E('2', 'w1', 'text', 'i1', 'prompt'), E('3', 'i1', 'image', 'v1', 'media')],
      updatedAt: new Date().toISOString(),
    }
  }
  return emptyGraph('空白星图')
}

export const TEMPLATES = [
  { key: 'inspiration', name: '灵感成片', desc: '一句灵感 → 写作 → 画面' },
  { key: 'card', name: '图文卡片', desc: '短句 + 极简配图' },
  { key: 'video', name: '短片分镜', desc: '旁白 → 首帧 → 视频' },
]
