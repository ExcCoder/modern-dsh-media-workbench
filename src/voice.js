// 语音：兼容 OpenAI Audio Speech 和 MiniMax T2A v2
import { voiceKey } from './settings.js'

const MAX_BYTES = 40_000_000
const FORMATS = {
  mp3: { ext: '.mp3', mime: 'audio/mpeg' },
  opus: { ext: '.opus', mime: 'audio/ogg' },
  aac: { ext: '.aac', mime: 'audio/aac' },
  flac: { ext: '.flac', mime: 'audio/flac' },
  wav: { ext: '.wav', mime: 'audio/wav' },
  pcm: { ext: '.pcm', mime: 'audio/L16' },
}
const MINIMAX_FORMATS = new Set(['mp3', 'wav', 'flac', 'pcm', 'opus'])
const OPENAI_VOICES = new Set(['alloy', 'echo', 'fable', 'onyx', 'nova', 'shimmer', 'coral', 'verse', 'ballad', 'ash', 'sage', 'marin', 'cedar'])

function minimaxEndpoint(baseUrl) {
  const base = String(baseUrl).replace(/\/+$/, '')
  if (/\/t2a_v2$/i.test(base)) return base
  if (/\/v1$/i.test(base)) return `${base}/t2a_v2`
  return `${base}/v1/t2a_v2`
}

export async function generateVoice(settings, { text, voice, format }, { signal } = {}) {
  const key = voiceKey(settings)
  if (!key) throw Object.assign(new Error('还没有配置语音服务密钥'), { status: 400 })
  if (!settings.voice.baseUrl || !settings.voice.model) throw Object.assign(new Error('先填好语音接口地址和模型'), { status: 400 })
  const input = String(text ?? '').trim()
  if (!input) throw Object.assign(new Error('先写一段要朗读的文字'), { status: 400 })
  if (input.length > 4096) throw Object.assign(new Error('文字最多 4096 个字符'), { status: 400 })
  const requestedFormat = String(format || settings.voice.format || 'mp3').toLowerCase()
  const selectedFormat = FORMATS[requestedFormat] ? requestedFormat : 'mp3'
  const selectedVoice = String(voice || settings.voice.voice || 'alloy').slice(0, 80)
  let extra = {}
  try {
    const parsed = JSON.parse(settings.voice.extra || '{}')
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) extra = parsed
  } catch { /* ignore invalid extra; settings validation already rejects it */ }

  const isMiniMax = /minimax|t2a_v2/i.test(settings.voice.baseUrl)
  const timeout = AbortSignal.timeout(180_000)
  const combined = signal ? AbortSignal.any([signal, timeout]) : timeout
  let res
  let actualFormat = selectedFormat
  let body

  if (isMiniMax) {
    actualFormat = MINIMAX_FORMATS.has(selectedFormat) ? selectedFormat : 'mp3'
    // OpenAI 的音色名和 MiniMax 的 voice_id 不通用；用户没改时给一个可用的默认音色。
    const voiceId = OPENAI_VOICES.has(selectedVoice) ? 'male-qn-qingse' : selectedVoice
    const { voice_setting: voiceExtra = {}, audio_setting: audioExtra = {}, ...rest } = extra
    body = {
      model: settings.voice.model,
      text: input,
      voice_setting: {
        voice_id: voiceId,
        speed: 1,
        vol: 1,
        pitch: 0,
        ...voiceExtra,
      },
      audio_setting: {
        sample_rate: 32000,
        bitrate: 128000,
        format: actualFormat,
        channel: 1,
        ...audioExtra,
      },
      ...rest,
    }
    res = await fetch(minimaxEndpoint(settings.voice.baseUrl), {
      method: 'POST',
      headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: combined,
    })
  } else {
    body = {
      model: settings.voice.model,
      input,
      voice: selectedVoice,
      response_format: selectedFormat,
      ...extra,
    }
    res = await fetch(`${settings.voice.baseUrl.replace(/\/+$/, '')}/audio/speech`, {
      method: 'POST',
      headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: combined,
    })
  }

  if (!res.ok) {
    const raw = await res.text()
    let detail = raw
    try {
      const parsed = JSON.parse(raw)
      detail = parsed?.error?.message ?? parsed?.message ?? parsed?.base_resp?.status_msg ?? raw
    } catch { /* text */ }
    throw Object.assign(new Error(`语音服务返回 ${res.status}：${String(detail).slice(0, 300)}`), { status: res.status })
  }

  let buffer
  if (isMiniMax) {
    const raw = await res.text()
    let data
    try { data = JSON.parse(raw) } catch { throw new Error('语音服务返回的不是 JSON') }
    if (Number(data?.base_resp?.status_code ?? 0) !== 0) {
      throw new Error(`语音服务返回 ${data?.base_resp?.status_code}：${data?.base_resp?.status_msg || '未知错误'}`)
    }
    const hex = data?.data?.audio
    if (typeof hex !== 'string' || !hex) throw new Error('语音服务没有返回音频数据')
    buffer = Buffer.from(hex, 'hex')
  } else {
    buffer = Buffer.from(await res.arrayBuffer())
  }
  if (!buffer.length) throw new Error('语音服务没有返回音频')
  if (buffer.length > MAX_BYTES) throw new Error('返回的音频太大')
  return { buffer, ...FORMATS[actualFormat] }
}
