// 用 DSH 里已经配好的默认模型写作，不额外存密钥
export const modelStatus = { ok: null, error: null }

export function modelInfo(ctx) {
  try {
    const selection = ctx.get('agentDefaultModel')?.currentSelection()
    if (!ctx.get('llm') || !selection?.provider || !selection?.model) return null
    return { provider: selection.provider, model: selection.model, label: selection.model }
  } catch {
    return null
  }
}

/**
 * 流式调用当前模型。
 * @param {object} ctx
 * @param {{system: string, user: string, maxTokens?: number, signal?: AbortSignal, onDelta?: (t: string) => void}} request
 * @returns {Promise<{text: string, model: string}>}
 */
export async function streamText(ctx, { system, user, maxTokens = 4000, signal, onDelta }) {
  const info = modelInfo(ctx)
  if (!info) throw Object.assign(new Error('当前没有可用的写作模型。先在 DSH 里选择模型（或配置 DeepSeek 账号），再回来试。'), { status: 503 })
  const llm = ctx.get('llm')
  let text = ''
  try {
    const call = await llm.prepareCall({ provider: info.provider, model: info.model, maxTokens }, signal, (controls, model) => {
      const effort = model?.reasoning?.efforts?.[0]?.id
      return effort === undefined ? controls : { ...controls, reasoningEffort: effort }
    })
    for await (const chunk of call.stream({
      ...call.config,
      system,
      messages: [{ role: 'user', content: [{ type: 'text', text: user }], source: { kind: '@exccoder/dsh-media-workbench' } }],
      signal,
    })) {
      if (chunk.type === 'text-delta') {
        text += chunk.text
        onDelta?.(chunk.text)
      } else if (chunk.type === 'finish' && ['error', 'aborted'].includes(chunk.reason?.kind)) {
        throw new Error(chunk.reason.failure?.message || '模型调用中断')
      }
    }
    modelStatus.ok = true
    modelStatus.error = null
    return { text, model: info.label }
  } catch (err) {
    modelStatus.ok = false
    modelStatus.error = err.message
    throw err
  }
}

export function extractJson(text) {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(text)
  const body = fenced ? fenced[1] : text
  const start = body.search(/[{[]/)
  const end = Math.max(body.lastIndexOf('}'), body.lastIndexOf(']'))
  if (start < 0 || end < start) throw new Error('模型没有返回 JSON')
  return JSON.parse(body.slice(start, end + 1))
}
