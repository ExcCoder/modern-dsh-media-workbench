// 拉取供应商提供的模型列表：GET {baseUrl}/models。
import { assertRemoteUrl, redact } from './util.js'

const TIMEOUT_MS = 20_000

/** 从各家五花八门的返回里抠出模型 id */
export function parseModels(payload) {
  const found = new Set()
  const push = value => {
    if (typeof value === 'string' && value.trim()) found.add(value.trim().slice(0, 200))
  }
  const pushEntry = entry => {
    if (typeof entry === 'string') return push(entry)
    if (!entry || typeof entry !== 'object') return
    push(entry.id)
    push(entry.model)
    push(entry.name)
    push(entry.model_name)
  }
  const walk = node => {
    if (!node) return
    if (Array.isArray(node)) {
      for (const item of node) pushEntry(item)
      return
    }
    if (typeof node !== 'object') return
    for (const key of ['data', 'models', 'result', 'list', 'items']) {
      if (key in node) walk(node[key])
    }
  }
  walk(payload)
  return [...found].sort((a, b) => a.localeCompare(b))
}

function explain(status, body) {
  if (status === 401 || status === 403) return '密钥被拒绝，检查这个供应商的 API Key'
  if (status === 404) return '这个地址没有 /models 接口，手动填模型名就行'
  if (status === 429) return '请求太频繁，稍后再试'
  const snippet = String(body ?? '').replace(/\s+/g, ' ').slice(0, 160)
  return `接口返回 ${status}${snippet ? `：${snippet}` : ''}`
}

/**
 * 请求供应商的模型列表。
 * @param {{baseUrl: string, apiKey: string}} provider
 * @param {{signal?: AbortSignal, fetchImpl?: typeof fetch}} options
 * @returns {Promise<{models: string[]}>}
 */
export async function listModels(provider, { signal, fetchImpl } = {}) {
  const baseUrl = String(provider.baseUrl ?? '').replace(/\/+$/, '')
  if (!baseUrl) {
    const err = new Error('先填接口地址')
    err.status = 400
    throw err
  }
  assertRemoteUrl(baseUrl)
  const key = String(provider.apiKey ?? '')
  const doFetch = fetchImpl ?? fetch
  const timeout = AbortSignal.timeout(TIMEOUT_MS)
  const combined = signal ? AbortSignal.any([signal, timeout]) : timeout
  let res
  try {
    res = await doFetch(`${baseUrl}/models`, {
      method: 'GET',
      headers: key ? { authorization: `Bearer ${key}` } : {},
      signal: combined,
    })
  } catch (err) {
    if (err?.name === 'TimeoutError') throw new Error('读取模型列表超时，检查网络或接口地址')
    throw new Error(`连不上这个接口：${err?.message ?? '网络错误'}`)
  }
  const raw = await res.text()
  if (!res.ok) {
    const err = new Error(explain(res.status, redact(raw, key)))
    err.status = res.status
    throw err
  }
  let payload = null
  try {
    payload = JSON.parse(raw)
  } catch {
    const err = new Error('接口没有返回 JSON，可能不是 OpenAI 兼容地址')
    err.status = 502
    throw err
  }
  const models = parseModels(payload)
  if (!models.length) {
    const err = new Error('接口通了，但没解析出模型名')
    err.status = 502
    throw err
  }
  return { models }
}
