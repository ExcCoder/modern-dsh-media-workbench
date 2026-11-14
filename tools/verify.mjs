// 离线验证：不启动 DSH，不花钱。
// 运行：node --test tools/verify.mjs
import test from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdtemp, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  canConnect, dependencyClosure, normalizeGraph, templateGraph, topoWaves, createNode, NODE_TYPES,
} from '../src/graph.js'
import { normalizeState, Store } from '../src/store.js'
import { imageReady, publicSettings, Settings, videoReady, voiceReady, writingReady } from '../src/settings.js'
import { streamChat } from '../src/chat.js'
import { listModels, parseModels } from '../src/models.js'
import { styledPrompt, generateImage, editImage } from '../src/image.js'
import { writingPrompts, cleanOutput } from '../src/writing.js'
import { generateVideo } from '../src/video.js'
import { generateVoice } from '../src/voice.js'
import { assertRemoteUrl, editModeOf, extensionOf, imageSize } from '../src/util.js'

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
    images: [{ id: 'a', status: 'weird', references: ['r1.png', 'r2.png'] }, { nope: true }, null],
    voices: [{ id: 'v1', text: 'hello', status: 'weird' }],
    docs: [{ id: 'd1', title: 'x' }],
    graphs: [{ id: 'g', name: 'g', nodes: [], edges: [] }],
    preferences: { imageCount: 9 },
  })
  assert.equal(state.images.length, 1)
  assert.equal(state.images[0].status, 'done')
  assert.deepEqual(state.images[0].references, ['r1.png', 'r2.png'])
  assert.equal(state.voices.length, 1)
  assert.equal(state.voices[0].status, 'done')
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

test('产物目录会创建、保存并拒绝相对路径', async () => {
  await withTemp(async root => {
    const settings = new Settings(root)
    const dir = join(root, 'output')
    const saved = await settings.update({ storage: { outputDir: dir } })
    assert.equal(saved.storage.outputDir, dir)
    assert.equal((await stat(dir)).isDirectory(), true)
    await assert.rejects(() => settings.update({ storage: { outputDir: 'relative/path' } }), /绝对路径/)
    const cleared = await settings.update({ storage: { outputDir: '' } })
    assert.equal(cleared.storage.outputDir, '')
  })
})

test('多张参考图会按顺序走 image[] 字段', async () => {
  await withTemp(async dir => {
    const png = Buffer.alloc(24)
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(png)
    png.writeUInt32BE(1, 16)
    png.writeUInt32BE(1, 20)
    for (const name of ['a.png', 'b.png', 'c.png']) await writeFile(join(dir, name), png)
    const settings = {
      image: { baseUrl: 'https://example.com', model: 'test-image', apiKey: 'key', extra: '', size: '', quality: '' },
    }
    const realFetch = globalThis.fetch
    let count = 0
    globalThis.fetch = async (url, init = {}) => {
      if (String(url).endsWith('/images/edits')) {
        count = init.body.getAll('image[]').length
        return new Response(JSON.stringify({ data: [{ b64_json: png.toString('base64') }] }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })
      }
      return new Response('not found', { status: 404 })
    }
    try {
      const result = await generateImage(settings, {
        prompt: '三个参考图按顺序融合',
        references: ['a.png', 'b.png', 'c.png'],
      }, { filesDir: dir })
      assert.equal(count, 3)
      assert.equal(result.ext, '.png')
    } finally {
      globalThis.fetch = realFetch
    }
  })
})

test('图片编辑方式会原样保留 edit / outpaint / inpaint', () => {
  assert.equal(editModeOf('edit'), 'edit')
  assert.equal(editModeOf('outpaint'), 'outpaint')
  assert.equal(editModeOf('inpaint'), 'inpaint')
  assert.equal(editModeOf(''), 'inpaint')
  assert.equal(editModeOf(undefined), 'inpaint')
  assert.equal(editModeOf('generate'), 'inpaint')
})

test('图片编辑把裁剪图和提示词发给 /images/edits', async () => {
  const png = Buffer.alloc(24)
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(png)
  png.writeUInt32BE(2, 16)
  png.writeUInt32BE(3, 20)
  const settings = {
    image: { baseUrl: 'https://example.com', model: 'test-image', apiKey: 'key', extra: '', size: '', quality: '' },
  }
  const realFetch = globalThis.fetch
  let called = null
  globalThis.fetch = async (url, init = {}) => {
    if (String(url).endsWith('/images/edits')) {
      called = { url: String(url), form: init.body }
      return new Response(JSON.stringify({ data: [{ b64_json: png.toString('base64') }] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    }
    return new Response('not found', { status: 404 })
  }
  try {
    const result = await editImage(settings, {
      prompt: '换成红苹果',
      style: '电影感',
      image: png,
      imageType: 'image/png',
      imageSize: { width: 2, height: 3 },
    })
    assert.equal(called.url, 'https://example.com/images/edits')
    assert.match(called.form.get('prompt'), /换成红苹果。cinematic/)
    assert.equal(called.form.get('size'), '2x3')
    assert.ok(called.form.get('image'))
    assert.equal(result.ext, '.png')
    assert.equal(result.width, 2)
    assert.equal(result.height, 3)
  } finally {
    globalThis.fetch = realFetch
  }
})

test('供应商可保存多条并同步到扁平字段', async () => {
  await withTemp(async dir => {
    const settings = new Settings(dir)
    const first = await settings.update({
      image: { provider: { name: '主力', baseUrl: 'https://a.example.com/v1', model: 'm-a', apiKey: 'key-a' } },
    })
    assert.equal(first.image.providers.length, 1)
    assert.equal(first.image.baseUrl, 'https://a.example.com/v1')
    assert.equal(first.image.model, 'm-a')
    const idA = first.image.providers[0].id

    const second = await settings.update({
      image: { provider: { name: '备用', baseUrl: 'https://b.example.com/v1', model: 'm-b', apiKey: 'key-b' } },
    })
    assert.equal(second.image.providers.length, 2)
    assert.equal(second.image.baseUrl, 'https://b.example.com/v1')
    const idB = second.image.providers[1].id

    // 切回第一条，扁平字段跟着变
    const switched = await settings.update({ image: { activeId: idA } })
    assert.equal(switched.image.model, 'm-a')
    assert.equal(switched.image.baseUrl, 'https://a.example.com/v1')

    // 检测到的模型存到指定供应商
    const saved = await settings.update({ image: { models: { id: idB, list: ['m-b', 'm-b2', 'm-b'] } } })
    const backup = saved.image.providers.find(item => item.id === idB)
    assert.deepEqual(backup.models, ['m-b', 'm-b2'])
    assert.ok(backup.modelsAt)

    // publicSettings 不泄露密钥，但给出提示和模型
    const exposed = publicSettings(saved)
    assert.equal(exposed.image.providers[1].apiKey, undefined)
    assert.equal(exposed.image.providers[1].hasKey, true)
    assert.deepEqual(exposed.image.providers[1].models, ['m-b', 'm-b2'])

    // 删除
    const removed = await settings.update({ image: { removeProvider: idB } })
    assert.equal(removed.image.providers.length, 1)
    assert.equal(removed.image.providers[0].id, idA)
    assert.equal(removed.image.baseUrl, 'https://a.example.com/v1')
  })
})

test('老的扁平配置会迁移成一条供应商', async () => {
  await withTemp(async dir => {
    const settings = new Settings(dir)
    await settings.update({ image: { baseUrl: 'https://old.example.com/v1', model: 'old-model', apiKey: 'old-key' } })
    const read = await settings.read()
    assert.equal(read.image.providers.length, 1)
    assert.equal(read.image.providers[0].baseUrl, 'https://old.example.com/v1')
    assert.equal(read.image.providers[0].model, 'old-model')
    assert.equal(read.image.apiKey, 'old-key')
    assert.equal(read.image.activeId, read.image.providers[0].id)
  })
})

test('模型列表能从各种返回结构里解析出来', () => {
  assert.deepEqual(parseModels({ data: [{ id: 'b' }, { id: 'a' }] }), ['a', 'b'])
  assert.deepEqual(parseModels({ data: ['x', 'y'] }), ['x', 'y'])
  assert.deepEqual(parseModels({ models: [{ name: 'n1' }, { model: 'n2' }] }), ['n1', 'n2'])
  assert.deepEqual(parseModels({ result: { list: [{ id: 'z' }] } }), ['z'])
  assert.deepEqual(parseModels({}), [])
})

test('模型检测按 OpenAI /models 形状请求并带上密钥', async () => {
  const calls = []
  const fakeFetch = async (url, init = {}) => {
    calls.push({ url: String(url), auth: init.headers?.authorization })
    return new Response(JSON.stringify({ data: [{ id: 'gpt-image-2.5' }, { id: 'gpt-image-1' }] }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })
  }
  const { models } = await listModels({ baseUrl: 'https://example.com/v1/', apiKey: 'k-1' }, { fetchImpl: fakeFetch })
  assert.equal(calls[0].url, 'https://example.com/v1/models')
  assert.equal(calls[0].auth, 'Bearer k-1')
  assert.deepEqual(models, ['gpt-image-1', 'gpt-image-2.5'])

  const failing = async () => new Response('nope', { status: 401 })
  await assert.rejects(() => listModels({ baseUrl: 'https://example.com/v1', apiKey: 'k' }, { fetchImpl: failing }), /密钥被拒绝/)
})

test('视频、语音、写作也能存多条供应商', async () => {
  await withTemp(async dir => {
    const settings = new Settings(dir)
    for (const kind of ['video', 'voice', 'writing']) {
      const one = await settings.update({ [kind]: { provider: { name: `${kind}-a`, baseUrl: 'https://a.example.com/v1', model: `${kind}-m1`, apiKey: `${kind}-key` } } })
      assert.equal(one[kind].providers.length, 1, kind)
      assert.equal(one[kind].model, `${kind}-m1`)
      const two = await settings.update({ [kind]: { provider: { name: `${kind}-b`, baseUrl: 'https://b.example.com/v1', model: `${kind}-m2`, apiKey: `${kind}-key2` } } })
      assert.equal(two[kind].providers.length, 2, kind)
      assert.equal(two[kind].baseUrl, 'https://b.example.com/v1')
      // 切回第一条
      const firstId = two[kind].providers[0].id
      const back = await settings.update({ [kind]: { activeId: firstId } })
      assert.equal(back[kind].model, `${kind}-m1`, kind)
      // 密钥不回传给浏览器
      const exposed = publicSettings(back)
      assert.equal(exposed[kind].providers[0].apiKey, undefined)
      assert.equal(exposed[kind].providers[0].hasKey, true)
    }
    const ready = await settings.read()
    assert.equal(writingReady(ready), true)
    assert.equal(videoReady(ready), true)
    assert.equal(voiceReady(ready), true)
  })
})

test('写作没配供应商时不算就绪，仍走 DSH 模型', async () => {
  await withTemp(async dir => {
    const settings = new Settings(dir)
    const config = await settings.read()
    assert.equal(writingReady(config), false)
    assert.equal(config.writing.providers.length, 0)
  })
})

test('写作的 /chat/completions 能解析 SSE 流', async () => {
  const chunks = [
    'data: {"model":"deepseek-chat","choices":[{"delta":{"content":"雨天"}}]}\n\n',
    'data: {"choices":[{"delta":{"content":"的天台"}}]}\n\n',
    'data: [DONE]\n\n',
  ]
  const body = new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(new TextEncoder().encode(chunk))
      controller.close()
    },
  })
  const fakeFetch = async (url, init) => {
    assert.equal(url, 'https://api.deepseek.com/v1/chat/completions')
    const payload = JSON.parse(init.body)
    assert.equal(payload.stream, true)
    assert.equal(payload.messages[0].role, 'system')
    assert.equal(init.headers.authorization, 'Bearer w-key')
    return new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } })
  }
  let streamed = ''
  const result = await streamChat(
    { baseUrl: 'https://api.deepseek.com/v1', model: 'deepseek-chat', apiKey: 'w-key' },
    { system: '你是编辑', user: '写一段', fetchImpl: fakeFetch, onDelta: t => { streamed += t } },
  )
  assert.equal(result.text, '雨天的天台')
  assert.equal(streamed, '雨天的天台')
})

test('写作接口返回整段 JSON 时也能用', async () => {
  const fakeFetch = async () => new Response(JSON.stringify({ model: 'glm-4', choices: [{ message: { content: '整段正文' } }] }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })
  const result = await streamChat(
    { baseUrl: 'https://x.example.com/v1', model: 'glm-4', apiKey: 'k' },
    { system: 's', user: 'u', fetchImpl: fakeFetch },
  )
  assert.equal(result.text, '整段正文')
  assert.equal(result.model, 'glm-4')
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

test('语音服务按 OpenAI Audio Speech 形状请求', async () => {  const settings = {
    voice: { baseUrl: 'https://example.com', model: 'tts-test', apiKey: 'key', voice: 'alloy', format: 'mp3', extra: '' },
  }
  const realFetch = globalThis.fetch
  let body = null
  globalThis.fetch = async (url, init = {}) => {
    if (String(url).endsWith('/audio/speech')) {
      body = JSON.parse(init.body)
      return new Response(Buffer.from('ID3fake-audio'), { status: 200, headers: { 'content-type': 'audio/mpeg' } })
    }
    return new Response('not found', { status: 404 })
  }
  try {
    const result = await generateVoice(settings, { text: '你好', voice: 'nova', format: 'mp3' })
    assert.equal(body.input, '你好')
    assert.equal(body.voice, 'nova')
    assert.equal(body.response_format, 'mp3')
    assert.equal(result.ext, '.mp3')
  } finally {
    globalThis.fetch = realFetch
  }
})

test('MiniMax T2A 使用 t2a_v2 接口并解码 hex 音频', async () => {
  const settings = {
    voice: {
      baseUrl: 'https://api.minimax.cn/v1/t2a_v2',
      model: 'speech-2.8-hd',
      apiKey: 'key',
      voice: 'alloy',
      format: 'wav',
      extra: '',
    },
  }
  const realFetch = globalThis.fetch
  let calledUrl = ''
  let body = null
  globalThis.fetch = async (url, init = {}) => {
    calledUrl = String(url)
    body = JSON.parse(init.body)
    return new Response(JSON.stringify({
      base_resp: { status_code: 0, status_msg: 'success' },
      data: { audio: Buffer.from('wave-bytes').toString('hex') },
    }), { status: 200, headers: { 'content-type': 'application/json' } })
  }
  try {
    const result = await generateVoice(settings, { text: '你好', voice: 'alloy', format: 'wav' })
    assert.equal(calledUrl, 'https://api.minimax.cn/v1/t2a_v2')
    assert.equal(body.voice_setting.voice_id, 'male-qn-qingse')
    assert.equal(body.audio_setting.format, 'wav')
    assert.equal(result.ext, '.wav')
    assert.equal(result.buffer.toString(), 'wave-bytes')
  } finally {
    globalThis.fetch = realFetch
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

