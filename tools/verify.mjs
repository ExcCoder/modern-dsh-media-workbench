// 离线验证：不启动 DSH，不花钱。
// 运行：node --test tools/verify.mjs
import test from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  canConnect, dependencyClosure, normalizeGraph, templateGraph, topoWaves, createNode, NODE_TYPES,
} from '../src/graph.js'
import { normalizeState, Store } from '../src/store.js'
import { imageReady, publicSettings, Settings, videoReady } from '../src/settings.js'
import { styledPrompt } from '../src/image.js'
import { writingPrompts, cleanOutput } from '../src/writing.js'
import { generateVideo } from '../src/video.js'
import { assertRemoteUrl, extensionOf, imageSize } from '../src/util.js'

async function withTemp(fn) {
  const root = await mkdtemp(join(tmpdir(), 'modern-media-verify-'))
  try {
    return await fn(root)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}

test('模板星图是合法 DAG，且能按层并行', () => {
  const graph = templateGraph('inspiration')
  assert.equal(graph.nodes.length, 4)
  assert.equal(graph.edges.length, 3)
  const closure = dependencyClosure(graph, ['n_v1'])
  assert.equal(closure.size, 4)
  const { waves, ok } = topoWaves(graph, closure)
  assert.equal(ok, true)
  assert.equal(waves.length, 4)
  assert.deepEqual(waves[0], ['n_p1'])
})

test('连线拒绝环路、重复和类型不匹配', () => {
  const graph = templateGraph('card')
  const cycle = canConnect(graph, { node: 'n_v1', port: 'media' }, { node: 'n_p1', port: 'text' })
  assert.equal(cycle.ok, false)
  const missing = canConnect(graph, { node: 'n_p1', port: 'text' }, { node: 'n_i1', port: 'reference' })
  assert.equal(missing.ok, false)
  const self = canConnect(graph, { node: 'n_p1', port: 'text' }, { node: 'n_p1', port: 'context' })
  assert.equal(self.ok, false)
})

test('导入星图会修掉悬空、成环与不存在的节点', () => {
  const base = templateGraph('inspiration')
  const dirty = {
    name: '坏星图',
    nodes: [
      ...base.nodes,
      { id: 'n_p1', type: 'prompt', x: 0, y: 0, config: {} },
      { id: 'n_bad', type: 'not-a-type', x: 0, y: 0 },
    ],
    edges: [
      ...base.edges,
      { id: 'e_bad1', from: { node: 'n_v1', port: 'media' }, to: { node: 'n_p1', port: 'text' } },
      { id: 'e_bad2', from: { node: 'ghost', port: 'text' }, to: { node: 'n_w1', port: 'context' } },
      { id: 'e_dup', from: { node: 'n_p1', port: 'text' }, to: { node: 'n_w1', port: 'context' } },
    ],
  }
  const graph = normalizeGraph(dirty)
  assert.equal(graph.name, '坏星图')
  assert.equal(graph.nodes.length, 4)
  assert.equal(graph.nodes.filter(node => node.id === 'n_p1').length, 1)
  assert.equal(graph.edges.length, 3)
  for (const edge of graph.edges) {
    assert.ok(graph.nodes.some(node => node.id === edge.from.node))
    assert.ok(graph.nodes.some(node => node.id === edge.to.node))
  }
})

test('状态归一化会补默认值、清掉坏记录', () => {
  const state = normalizeState({
    images: [{ id: 'a', status: 'weird' }, { nope: true }, null],
    docs: [{ id: 'd1', title: 'x' }],
    graphs: [{ id: 'g', name: 'g', nodes: [], edges: [] }],
    preferences: { imageCount: 9 },
  })
  assert.equal(state.images.length, 1)
  assert.equal(state.images[0].status, 'done')
  assert.equal(state.docs.length, 1)
  assert.equal(state.graphs.length, 1)
  assert.equal(state.preferences.imageCount, 9)
})

test('本机存储可以读写，并把中断的任务标记出来', async () => {
  await withTemp(async root => {
    const store = new Store(root)
    const seeded = await store.read()
    assert.equal(seeded.docs.length, 1)
    await store.mutate(state => {
      state.images.push({ id: 'img_1', prompt: 'x', status: 'running', createdAt: new Date().toISOString() })
    })
    const changed = await store.settle()
    assert.equal(changed, 1)
    const after = await store.read()
    assert.equal(after.images[0].status, 'error')
    assert.match(after.images[0].error, /中断/)
  })
})

test('密钥不会回传给浏览器', async () => {
  await withTemp(async root => {
    const settings = new Settings(root)
    const saved = await settings.update({
      image: { baseUrl: 'https://api.example.com/v1/', model: 'm', apiKey: 'sk-secret-1234' },
      video: { baseUrl: 'https://video.example.com/v1', model: 'v', apiKey: 'vk-secret-9999' },
    })
    assert.equal(saved.image.baseUrl, 'https://api.example.com/v1')
    assert.equal(imageReady(saved), true)
    assert.equal(videoReady(saved), true)
    const pub = publicSettings(saved)
    assert.equal('apiKey' in pub.image, false)
    assert.equal('apiKey' in pub.video, false)
    assert.equal(pub.image.hasKey, true)
    assert.equal(pub.image.keyHint, '1234')
    assert.equal(JSON.stringify(pub).includes('sk-secret'), false)
  })
})

test('设置拒绝坏地址与非对象 JSON', async () => {
  await withTemp(async root => {
    const settings = new Settings(root)
    await assert.rejects(() => settings.update({ image: { baseUrl: 'ftp://x' } }), /http/)
    await assert.rejects(() => settings.update({ image: { extra: '[1,2]' } }), /对象|JSON/)
  })
})

test('风格提示词与写作提示词', () => {
  const prompt = styledPrompt('雨后的天台', '电影感')
  assert.match(prompt, /雨后的天台/)
  assert.match(prompt, /cinematic/)
  const { system, user } = writingPrompts({
    action: 'rewrite',
    title: '测试',
    content: '他推开门。',
    selection: '他推开门。',
    instruction: '改得更克制',
    tone: '克制冷静',
    length: 'short',
    lang: 'zh',
  })
  assert.match(system, /克制冷静/)
  assert.match(user, /选中的片段/)
  assert.match(user, /改得更克制/)
  assert.equal(cleanOutput('好的，这是续写：\n```\n正文\n```', 'continue'), '正文')
})

test('图片/URL 基础校验', () => {
  assert.equal(extensionOf(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0])), '.png')
  assert.equal(extensionOf(Buffer.from('not an image')), null)
  const pngHead = Buffer.alloc(24)
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(pngHead)
  pngHead.writeUInt32BE(13, 8)
  pngHead.writeUInt32BE(1, 16)
  pngHead.writeUInt32BE(2, 20)
  const size = imageSize(pngHead)
  assert.deepEqual(size, { width: 1, height: 2 })
  assert.throws(() => assertRemoteUrl('http://127.0.0.1/a.png'), /内网/)
  assert.throws(() => assertRemoteUrl('file:///etc/passwd'), /http/)
  assert.ok(assertRemoteUrl('https://example.com/a.png'))
})

test('节点类型与端口契约完整', () => {
  for (const [type, def] of Object.entries(NODE_TYPES)) {
    assert.ok(def.label)
    assert.ok(Array.isArray(def.inputs))
    assert.ok(Array.isArray(def.outputs))
    const node = createNode(type, 0, 0)
    assert.equal(node.type, type)
    assert.ok(node.id.startsWith('n_'))
  }
})

test('视频下载遇到 401 时会带 Bearer 重试', async () => {
  const realFetch = globalThis.fetch
  let downloads = 0
  globalThis.fetch = async (url, init = {}) => {
    if (init.method === 'POST') {
      return new Response(JSON.stringify({
        id: 'task_1',
        status: 'completed',
        url: 'https://example.com/video.mp4',
      }), { status: 200, headers: { 'content-type': 'application/json' } })
    }
    if (String(url) === 'https://example.com/video.mp4') {
      downloads += 1
      if (init.headers?.authorization === 'Bearer test-key') {
        return new Response('fake-mp4', { status: 200 })
      }
      return new Response('unauthorized', { status: 401 })
    }
    return new Response('not found', { status: 404 })
  }
  const settings = {
    video: {
      apiKey: 'test-key',
      baseUrl: 'https://example.com',
      model: 'test-model',
      createPath: '/videos',
      statusPath: '/videos/{id}',
      contentPath: '/videos/{id}/content',
      imageField: 'image',
      extra: '',
    },
  }
  try {
    const result = await generateVideo(settings, {
      prompt: 'test', aspect: '16:9', duration: 5, reference: '',
    })
    assert.equal(downloads, 2)
    assert.equal(result.buffer.toString(), 'fake-mp4')
  } finally {
    globalThis.fetch = realFetch
  }
})

