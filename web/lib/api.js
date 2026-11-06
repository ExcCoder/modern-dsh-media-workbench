const BASE = '/media-workbench-modern/api/'

async function parse(res) {
  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    const err = new Error(data.error || `请求失败（${res.status}）`)
    err.status = res.status
    throw err
  }
  return data
}

export async function api(path, body) {
  const res = await fetch(BASE + path, body === undefined ? {} : {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  return parse(res)
}

export async function upload(file) {
  const res = await fetch(BASE + 'upload', {
    method: 'POST',
    headers: { 'content-type': file.type || 'application/octet-stream' },
    body: file,
  })
  return parse(res)
}

/**
 * 写作流：NDJSON，每行一个 {type:'delta'|'done'|'error'}。
 */
export async function streamWrite(body, { onDelta, signal } = {}) {
  const res = await fetch(BASE + 'write/stream', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
    signal,
  })
  if (!res.ok) {
    const data = await res.json().catch(() => ({}))
    throw new Error(data.error || `请求失败（${res.status}）`)
  }
  if (!res.body) throw new Error('浏览器不支持流式读取')
  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let full = ''
  let error = null
  for (;;) {
    const { value, done } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    let index
    while ((index = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, index).trim()
      buffer = buffer.slice(index + 1)
      if (!line) continue
      let payload
      try { payload = JSON.parse(line) } catch { continue }
      if (payload.type === 'delta') {
        full += payload.text
        onDelta?.(payload.text, full)
      } else if (payload.type === 'done') {
        if (typeof payload.text === 'string') full = payload.text
        return { text: full, model: payload.model }
      } else if (payload.type === 'error') {
        error = new Error(payload.message || '生成失败')
      }
    }
  }
  if (error) throw error
  return { text: full }
}

export function fileUrl(name) {
  return `/media-workbench-modern/files/${encodeURIComponent(name)}`
}
