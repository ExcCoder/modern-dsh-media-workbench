// OpenAI 兼容的 /chat/completions 流式调用，给写作的多供应商用。
import { assertRemoteUrl, redact } from './util.js'

const TIMEOUT_MS = 180_000

function explain(status, body) {
  if (status === 401 || status === 403) return '密钥被拒绝，检查这个写作供应商的 API Key'
  if (status === 404) return '这个地址没有 /chat/completions，检查接口地址'
  if (status === 429) return '请求太频繁或额度用完了'
  const snippet = String(body ?? '').replace(/\s+/g, ' ').slice(0, 160)
  return `接口返回 ${status}${snippet ? `：${snippet}` : ''}`
}

/**
 * 流式对话。
 * @param {{baseUrl: string, model: string, apiKey: string, extra?: string}} provider
 * @param {{system: string, user: string, maxTokens?: number, signal?: AbortSignal, onDelta?: (t: string) => void}} request
 * @returns {Promise<{text: string, model: string}>}
 */
export async function streamChat(provider, { system, user, maxTokens = 4000, signal, onDelta, fetchImpl }) {
  const baseUrl = String(provider.baseUrl ?? '').replace(/\/+$/, '')
  if (!baseUrl) {
    const err = new Error('先填写作接口地址')
    err.status = 400
    throw err
  }
  assertRemoteUrl(baseUrl)
  if (!provider.model) {
    const err = new Error('先选一个写作模型')
    err.status = 400
    throw err
  }
  const key = String(provider.apiKey ?? '')
  let extra = {}
  if (provider.extra) {
    try {
      const parsed = JSON.parse(provider.extra)
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) extra = parsed
    } catch { /* 附加参数坏了就忽略 */ }
  }
  const timeout = AbortSignal.timeout(TIMEOUT_MS)
  const combined = signal ? AbortSignal.any([signal, timeout]) : timeout
  const body = {
    model: provider.model,
    stream: true,
    max_tokens: maxTokens,
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ],
    ...extra,
  }
  let res
  const doFetch = fetchImpl ?? fetch
  try {
    res = await doFetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(key ? { authorization: `Bearer ${key}` } : {}),
      },
      body: JSON.stringify(body),
      signal: combined,
    })
  } catch (err) {
    if (err?.name === 'TimeoutError') throw new Error('写作接口超时')
    throw new Error(`连不上写作接口：${err?.message ?? '网络错误'}`)
  }
  if (!res.ok) {
    const raw = await res.text()
    const err = new Error(explain(res.status, redact(raw, key)))
    err.status = res.status
    throw err
  }

  // 有些网关忽略 stream:true 直接回整段 JSON，这里两种都兜住
  const contentType = String(res.headers.get('content-type') ?? '')
  if (!contentType.includes('event-stream') && contentType.includes('application/json')) {
    let payload = null
    try {
      payload = JSON.parse(await res.text())
    } catch {
      throw new Error('写作接口返回的不是可解析的 JSON')
    }
    const text = payload?.choices?.[0]?.message?.content ?? ''
    if (!text) throw new Error('写作接口没有返回正文')
    onDelta?.(text)
    return { text, model: payload?.model || provider.model }
  }

  let text = ''
  let model = provider.model
  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  while (true) {
    const { value, done } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split('\n')
    buffer = lines.pop() ?? ''
    for (const line of lines) {
      const trimmed = line.trim()
      if (!trimmed || !trimmed.startsWith('data:')) continue
      const payloadText = trimmed.slice(5).trim()
      if (!payloadText || payloadText === '[DONE]') continue
      let chunk = null
      try {
        chunk = JSON.parse(payloadText)
      } catch {
        continue
      }
      if (chunk.model) model = chunk.model
      const delta = chunk?.choices?.[0]?.delta?.content
      if (typeof delta === 'string' && delta) {
        text += delta
        onDelta?.(delta)
      }
      const finish = chunk?.choices?.[0]?.finish_reason
      if (finish && finish !== 'stop' && finish !== 'length') {
        throw new Error(`模型提前结束：${finish}`)
      }
    }
  }
  if (!text.trim()) throw new Error('写作接口没有返回正文')
  return { text, model }
}
