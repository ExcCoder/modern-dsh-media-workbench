import { api, fileUrl } from '../lib/api.js'
import { $, downloadUrl, esc, fmtTime } from '../lib/dom.js'
import { icon } from '../lib/icons.js'
import { app, t } from '../lib/state.js'

const VOICES = ['alloy', 'echo', 'fable', 'onyx', 'nova', 'shimmer', 'coral', 'verse', 'ballad', 'ash', 'sage', 'marin', 'cedar']
const FORMATS = ['mp3', 'wav', 'opus', 'aac', 'flac']

export function mount(root) {
  const settings = app.settings?.voice ?? {}
  let busy = false
  let filter = 'all'

  root.innerHTML = `
    <section class="bench bench-voice">
      <aside class="voice-composer">
        <div class="composer-head">
          <div><span class="eyebrow">${esc(t('文本转语音', 'TEXT TO SPEECH'))}</span><h2>${esc(t('语音工作台', 'Voice Studio'))}</h2></div>
          <button class="icon-btn" data-act="settings" title="${esc(t('设置', 'Settings'))}">${icon('settings', 17)}</button>
        </div>
        <div class="provider-line" id="voice-provider-line"></div>
        <label class="field">
          <span class="field-label">${esc(t('要朗读的文字', 'Text'))} <span id="voice-count">0 / 4096</span></span>
          <textarea id="voice-text" rows="8" maxlength="4096" placeholder="${esc(t('把要读的文字放进来，支持中英文。', 'Paste the text to read, Chinese or English.'))}"></textarea>
        </label>
        <div class="settings-grid">
          <label class="field"><span class="field-label">${esc(t('音色', 'Voice'))}</span>
            <select class="select" id="voice-name">${VOICES.map(name => `<option value="${name}" ${name === (settings.voice || 'alloy') ? 'selected' : ''}>${name}</option>`).join('')}</select>
          </label>
          <label class="field"><span class="field-label">${esc(t('格式', 'Format'))}</span>
            <select class="select" id="voice-format">${FORMATS.map(name => `<option value="${name}" ${name === (settings.format || 'mp3') ? 'selected' : ''}>${name}</option>`).join('')}</select>
          </label>
        </div>
        <button class="btn btn-generate" id="voice-generate">
          <span class="gen-ic">${icon('mic', 17)}</span>
          <span class="gen-label">${esc(t('生成语音', 'Generate voice'))}</span>
        </button>
        <p class="fine">${esc(t('生成后的音频会存进本机作品库，可直接播放或下载。', 'Audio is saved to your local library and can be played or downloaded.'))}</p>
      </aside>
      <section class="voice-pane">
        <header class="pane-head">
          <div class="pane-title"><h2>${esc(t('语音历史', 'Voice history'))}</h2><span class="count-pill" id="voice-count-pill">0</span></div>
        </header>
        <div class="voice-list" id="voice-list"></div>
      </section>
    </section>`

  const textEl = $('#voice-text')
  const listEl = $('#voice-list')

  function paintProvider() {
    const line = $('#voice-provider-line')
    if (app.settings?.voiceReady) {
      line.className = 'provider-line is-ready'
      line.innerHTML = `<i class="dot"></i><span>${esc(app.settings.voice.model || t('已连接', 'Ready'))}</span><em>${esc(app.settings.voice.keyHint ? `•••• ${app.settings.voice.keyHint}` : '')}</em>`
    } else {
      line.className = 'provider-line is-off'
      line.innerHTML = `<span>${esc(t('语音服务还没配置', 'Voice provider is not configured'))}</span><button type="button" class="link-btn" data-act="settings">${esc(t('去设置', 'Set up'))} ${icon('arrowRight', 13)}</button>`
    }
  }

  function currentRows() {
    return app.state?.voices ?? []
  }

  function paintList() {
    const rows = currentRows()
    $('#voice-count-pill').textContent = String(rows.length)
    if (!rows.length) {
      listEl.innerHTML = `<div class="voice-empty"><span class="empty-ic">${icon('mic', 28)}</span><h3>${esc(t('还没有语音', 'No audio yet'))}</h3><p>${esc(t('写一段文字，生成第一段语音。', 'Write something and generate your first clip.'))}</p></div>`
      return
    }
    listEl.innerHTML = rows.map(row => {
      if (row.status === 'running' || row.status === 'queued') {
        return `<article class="voice-card is-busy"><div class="voice-body"><span class="busy-label"><i></i>${esc(t('正在生成…', 'Generating…'))}</span><p>${esc(row.text)}</p></div></article>`
      }
      if (row.status === 'error') {
        return `<article class="voice-card is-error"><div class="voice-body"><p class="voice-error">${esc(row.error || t('生成失败', 'Failed'))}</p><p>${esc(row.text)}</p></div><button class="btn btn-small btn-ghost" data-act="retry" data-id="${row.id}">${esc(t('重试', 'Retry'))}</button></article>`
      }
      return `<article class="voice-card" data-id="${row.id}">
        <div class="voice-body">
          <audio controls preload="none" src="${fileUrl(row.file)}"></audio>
          <p>${esc(row.text)}</p>
          <div class="voice-meta"><span class="tag">${esc(row.voice || '—')}</span><span>${esc(row.format || 'mp3')}</span><time>${esc(fmtTime(row.createdAt))}</time></div>
        </div>
        <div class="voice-actions">
          <button class="icon-btn" data-act="download" data-id="${row.id}" title="${esc(t('下载', 'Download'))}">${icon('download', 15)}</button>
          <button class="icon-btn danger-quiet" data-act="delete" data-id="${row.id}" title="${esc(t('删除', 'Delete'))}">${icon('trash', 15)}</button>
        </div>
      </article>`
    }).join('')
  }

  async function generate() {
    if (busy) return
    const text = textEl.value.trim()
    if (!text) { textEl.focus(); return app.toast(t('先写一段要朗读的文字', 'Write some text first'), 'error') }
    if (!app.settings?.voiceReady) return app.toast(t('先配置语音服务', 'Configure the voice provider first'), 'error')
    busy = true
    const button = $('#voice-generate')
    button.disabled = true
    button.querySelector('.gen-label').textContent = t('正在生成…', 'Generating…')
    try {
      await api('voice/generate', { text, voice: $('#voice-name').value, format: $('#voice-format').value })
      app.toast(t('语音已生成', 'Voice generated'), 'success')
      await app.refresh()
    } catch (err) {
      app.toast(err.message, 'error')
      await app.refresh().catch(() => {})
    } finally {
      busy = false
      button.disabled = false
      button.querySelector('.gen-label').textContent = t('生成语音', 'Generate voice')
    }
  }

  root.addEventListener('click', async event => {
    if (event.target.closest('[data-act="settings"]')) return app.navigate('settings')
    const button = event.target.closest('[data-act]')
    if (!button) return
    const id = button.dataset.id
    const row = currentRows().find(item => item.id === id)
    if (button.dataset.act === 'download' && row) {
      downloadUrl(fileUrl(row.file), `voice-${row.id}.${row.format || 'mp3'}`)
      return
    }
    if (button.dataset.act === 'delete' && row) {
      const ok = await app.confirm({
        title: t('删除这段语音？', 'Delete this audio?'),
        message: t('只删除记录，本机文件会保留。', 'Only the record is removed; the file stays on disk.'),
        confirmText: t('删除', 'Delete'),
        danger: true,
      })
      if (!ok) return
      try { await api('voice/action', { id, action: 'delete' }); await app.refresh() } catch (err) { app.toast(err.message, 'error') }
      return
    }
    if (button.dataset.act === 'retry' && row) {
      textEl.value = row.text
      textEl.dispatchEvent(new Event('input'))
      $('#voice-name').value = row.voice || 'alloy'
      $('#voice-format').value = row.format || 'mp3'
      generate()
    }
  })

  textEl.addEventListener('input', () => {
    $('#voice-count').textContent = `${textEl.value.length} / 4096`
  })
  $('#voice-generate').addEventListener('click', generate)

  paintProvider()
  paintList()

  return {
    update() {
      paintProvider()
      paintList()
    },
  }
}
