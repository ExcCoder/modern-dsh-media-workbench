export const $ = (selector, root = document) => root.querySelector(selector)
export const $$ = (selector, root = document) => [...root.querySelectorAll(selector)]

export function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]))
}

export function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value))
}

/** 中英混排字数：CJK 按字，拉丁按词 */
export function wordCount(text) {
  const value = String(text ?? '')
  const cjk = (value.match(/[\u3400-\u9fff\uf900-\ufaff]/g) ?? []).length
  const latin = (value.replace(/[\u3400-\u9fff\uf900-\ufaff]/g, ' ').match(/[A-Za-z0-9]+(?:['’-][A-Za-z0-9]+)*/g) ?? []).length
  return cjk + latin
}

export function fmtTime(value) {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  const now = new Date()
  const diff = now - date
  if (diff < 60_000) return '刚刚'
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} 分钟前`
  if (date.toDateString() === now.toDateString()) return date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
  if (now - date < 7 * 86_400_000) return `${Math.floor(diff / 86_400_000)} 天前`
  return date.toLocaleDateString('zh-CN', { month: '2-digit', day: '2-digit' })
}

export function fmtDate(value) {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return date.toLocaleDateString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit' })
}

export function debounce(fn, wait = 300) {
  let timer = null
  const wrapped = (...args) => {
    clearTimeout(timer)
    timer = setTimeout(() => fn(...args), wait)
  }
  wrapped.flush = (...args) => {
    clearTimeout(timer)
    fn(...args)
  }
  wrapped.cancel = () => clearTimeout(timer)
  return wrapped
}

export function downloadUrl(url, filename) {
  const a = document.createElement('a')
  a.href = url
  a.download = filename || ''
  a.rel = 'noopener'
  document.body.appendChild(a)
  a.click()
  a.remove()
}

export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    const area = document.createElement('textarea')
    area.value = text
    area.style.position = 'fixed'
    area.style.opacity = '0'
    document.body.appendChild(area)
    area.select()
    const ok = document.execCommand('copy')
    area.remove()
    return ok
  }
}

export function downloadJson(data, filename) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  downloadUrl(url, filename)
  setTimeout(() => URL.revokeObjectURL(url), 3000)
}

export function isMac() {
  return /Mac|iPhone|iPad/.test(navigator.platform || '')
}

export function modKey() {
  return isMac() ? '⌘' : 'Ctrl'
}

export function autoGrow(textarea, max = 320) {
  textarea.style.height = 'auto'
  textarea.style.height = `${Math.min(max, textarea.scrollHeight)}px`
}
