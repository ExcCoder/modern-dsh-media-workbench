import { api } from './lib/api.js'
import { $, copyText, esc, modKey } from './lib/dom.js'
import { icon, brandMark } from './lib/icons.js'
import { app, t } from './lib/state.js'
import * as imageView from './views/image.js'
import * as videoView from './views/video.js'
import * as voiceView from './views/voice.js'
import * as writeView from './views/write.js'
import * as constellationView from './views/constellation.js'
import * as settingsView from './views/settings.js'

const ROUTES = {
  image: { mod: imageView, title: ['生图工作台', 'Image Studio'], eyebrow: ['TEXT TO IMAGE', 'TEXT TO IMAGE'], desc: ['一句话，一张画。', 'One line, one image.'] },
  write: { mod: writeView, title: ['写作工作台', 'Writing Studio'], eyebrow: ['LONG FORM', 'LONG FORM'], desc: ['从灵感到成稿，留得住每一版。', 'From spark to manuscript, every draft kept.'] },
  constellation: { mod: constellationView, title: ['星图工作台', 'Star Map'], eyebrow: ['NODE GRAPH', 'NODE GRAPH'], desc: ['把提示词、写作、画面与视频连成一条线。', 'Wire prompts, writing, image and video into one flow.'] },
  video: { mod: videoView, title: ['视频工作台', 'Video Studio'], eyebrow: ['MOTION', 'MOTION'], desc: ['给画面一点时间。', 'Give the frame some time.'] },
  voice: { mod: voiceView, title: ['语音工作台', 'Voice Studio'], eyebrow: ['TEXT TO SPEECH', 'TEXT TO SPEECH'], desc: ['把文字读出来。', 'Turn text into a voice.'] },
  settings: { mod: settingsView, title: ['设置', 'Settings'], eyebrow: ['WORKBENCH', 'WORKBENCH'], desc: ['接口、模型与本机数据。', 'Providers, models and local data.'] },
}

const params = new URLSearchParams(location.search)
app.lang = params.get('lang') === 'en' ? 'en' : 'zh'
const storedTheme = localStorage.getItem('media-workbench-modern:theme')
const theme = storedTheme === 'dark' || storedTheme === 'light' ? storedTheme : params.get('theme') === 'dark' ? 'dark' : 'light'

function applyTheme(next) {
  app.theme = next
  document.documentElement.dataset.theme = next
  const btn = $('#theme-toggle')
  if (btn) btn.innerHTML = icon(next === 'dark' ? 'sun' : 'moon', 17)
  const meta = document.querySelector('meta[name="theme-color"]')
  if (meta) meta.content = next === 'dark' ? '#141210' : '#f6f3ee'
}

function renderChrome() {
  const shell = document.createElement('div')
  shell.className = 'app-shell'
  shell.innerHTML = `
    <aside class="rail">
      <div class="rail-brand" title="摩登-媒体工作室">${brandMark(24)}<span>MODERN</span></div>
      <nav class="rail-nav" aria-label="${esc(t('工作台', 'Workbenches'))}">
        <button class="rail-btn" data-route="image">${icon('image', 20)}<span>${esc(t('生图', 'Image'))}</span></button>
        <button class="rail-btn" data-route="write">${icon('pen', 20)}<span>${esc(t('写作', 'Write'))}</span></button>
        <button class="rail-btn" data-route="constellation">${icon('star', 20)}<span>${esc(t('星图', 'Map'))}</span></button>
        <button class="rail-btn" data-route="video">${icon('film', 20)}<span>${esc(t('视频', 'Video'))}</span></button>
        <button class="rail-btn" data-route="voice">${icon('mic', 20)}<span>${esc(t('语音', 'Voice'))}</span></button>
      </nav>
      <div class="rail-foot">
        <a class="rail-btn rail-link" href="https://github.com/ExcCoder/modern-dsh-media-workbench" target="_blank" rel="noopener" title="GitHub">${icon('external', 19)}<span>GitHub</span></a>
        <button class="rail-btn" data-route="settings">${icon('settings', 19)}<span>${esc(t('设置', 'Setup'))}</span></button>
        <button class="rail-btn rail-theme" id="theme-toggle" title="${esc(t('切换明暗', 'Toggle theme'))}">${icon(theme === 'dark' ? 'sun' : 'moon', 17)}</button>
      </div>
    </aside>
    <div class="workspace">
      <header class="topbar">
        <div class="topbar-copy">
          <span class="eyebrow" id="top-eyebrow"></span>
          <h1 id="top-title"></h1>
          <p class="topbar-desc" id="top-desc"></p>
        </div>
        <div class="topbar-side">
          <a class="qq-chip" href="https://qm.qq.com/q/qAkGlBo0HC" target="_blank" rel="noopener" title="${esc(t('加入 QQ 交流群', 'Join the QQ group'))}">
            ${icon('link', 14)}<span>${esc(t('QQ 群', 'QQ group'))}</span><b>741979677</b>
          </a>
          <button class="icon-btn qq-copy" id="qq-copy" title="${esc(t('复制群号', 'Copy group number'))}">${icon('copy', 14)}</button>
          <button class="status-chip" id="model-chip" title="${esc(t('DSH 当前模型', 'Current DSH model'))}"></button>
          <button class="status-chip" id="image-chip" title="${esc(t('打开设置', 'Open settings'))}"></button>
          <button class="icon-btn" id="refresh-btn" title="${esc(t('刷新', 'Refresh'))}">${icon('refresh', 16)}</button>
        </div>
      </header>
      <main class="view" id="view"><div class="boot"><span class="boot-mark">${brandMark(28)}</span><p>${esc(t('正在打开工作台…', 'Opening the studio…'))}</p></div></main>
    </div>
    <div id="layer-root"></div>
    <div id="toasts" aria-live="polite"></div>
  `
  document.body.replaceChildren(shell)
  document.documentElement.lang = app.lang === 'en' ? 'en' : 'zh-CN'
}

function updateChips() {
  const modelChip = $('#model-chip')
  const imageChip = $('#image-chip')
  if (modelChip) {
    const ok = Boolean(app.model)
    modelChip.className = `status-chip ${ok ? 'is-ok' : 'is-off'}`
    modelChip.innerHTML = `<i class="dot"></i><span>${esc(ok ? t('写作', 'Write') + ' · ' + app.model.label : t('模型未连接', 'No model'))}</span>`
  }
  if (imageChip) {
    const ok = Boolean(app.settings?.imageReady)
    imageChip.className = `status-chip ${ok ? 'is-ok' : 'is-off'}`
    imageChip.innerHTML = `<i class="dot"></i><span>${esc(ok ? t('生图已连接', 'Image ready') : t('生图未配置', 'Image not set'))}</span>`
  }
}

function paintRoute() {
  const route = (location.hash.replace(/^#\/?/, '') || 'image').split('?')[0]
  const name = ROUTES[route] ? route : 'image'
  const conf = ROUTES[name]
  for (const btn of document.querySelectorAll('.rail-btn[data-route]')) {
    btn.classList.toggle('is-on', btn.dataset.route === name)
    btn.setAttribute('aria-current', btn.dataset.route === name ? 'page' : 'false')
  }
  $('#top-eyebrow').textContent = 'MODERN MEDIA STUDIO'
  $('#top-title').textContent = t('摩登-媒体工作室', 'Modern-MediaStudio')
  $('#top-desc').textContent = t(conf.desc[0], conf.desc[1])
  document.title = `${t(conf.title[0], conf.title[1])} · ${t('摩登-媒体工作室', 'Modern-MediaStudio')}`
  const view = $('#view')
  if (app.view?.unmount) {
    try { app.view.unmount() } catch (err) { console.warn('[modern-media] unmount', err) }
  }
  view.replaceChildren()
  app.view = conf.mod.mount(view, app) || null
  app.viewName = name
  updateChips()
}

async function refresh() {
  const data = await api('bootstrap')
  app.state = data.state
  app.settings = data.settings
  app.imagePresets = data.imagePresets ?? []
  app.videoPresets = data.videoPresets ?? []
  app.model = data.model
  app.dataDir = data.dataDir
  app.version = data.version
  app.revision += 1
  updateChips()
  try { app.view?.update?.(app.state) } catch (err) { console.warn('[modern-media] update', err) }
  return data
}

app.refresh = refresh

function bootToast(message, kind = 'info') {
  const host = $('#toasts')
  if (!host) return
  const node = document.createElement('div')
  node.className = `toast toast-${kind}`
  node.innerHTML = `<span class="toast-ic">${icon(kind === 'error' ? 'alert' : kind === 'success' ? 'check' : 'info', 16)}</span><p>${esc(message)}</p><button class="toast-x" aria-label="关闭">${icon('x', 13)}</button>`
  const close = () => {
    node.classList.add('is-out')
    setTimeout(() => node.remove(), 220)
  }
  node.querySelector('.toast-x').addEventListener('click', close)
  host.appendChild(node)
  setTimeout(close, kind === 'error' ? 6200 : 3600)
}

app.toast = bootToast

app.showLayer = (content, { className = '', onClose } = {}) => {
  const root = $('#layer-root')
  const overlay = document.createElement('div')
  overlay.className = `layer ${className}`.trim()
  overlay.appendChild(content)
  const close = () => {
    overlay.classList.add('is-out')
    document.removeEventListener('keydown', onKey)
    setTimeout(() => {
      overlay.remove()
      onClose?.()
    }, 180)
  }
  const onKey = event => { if (event.key === 'Escape') { event.stopPropagation(); close() } }
  overlay.addEventListener('pointerdown', event => { if (event.target === overlay) close() })
  document.addEventListener('keydown', onKey)
  root.appendChild(overlay)
  requestAnimationFrame(() => overlay.classList.add('is-in'))
  return close
}

app.confirm = ({ title, message, confirmText = '确定', cancelText = '取消', danger = false }) => new Promise(resolve => {
  const card = document.createElement('div')
  card.className = 'dialog'
  card.innerHTML = `
    <h3>${esc(title)}</h3>
    <p>${esc(message)}</p>
    <div class="dialog-actions">
      <button class="btn btn-ghost" data-act="cancel">${esc(cancelText)}</button>
      <button class="btn ${danger ? 'btn-danger' : 'btn-primary'}" data-act="ok">${esc(confirmText)}</button>
    </div>`
  let close = () => {}
  const finish = value => { close(); resolve(value) }
  card.querySelector('[data-act="cancel"]').addEventListener('click', () => finish(false))
  card.querySelector('[data-act="ok"]').addEventListener('click', () => finish(true))
  close = app.showLayer(card, { className: 'layer-dialog', onClose: () => resolve(false) })
  card.querySelector('[data-act="ok"]').focus()
})

app.navigate = route => { location.hash = `#/${route}` }

function wire() {
  document.addEventListener('click', event => {
    const nav = event.target.closest('.rail-btn[data-route]')
    if (nav) {
      app.navigate(nav.dataset.route)
      return
    }
    if (event.target.closest('#qq-copy')) {
      copyText('741979677').then(ok => bootToast(ok ? t('群号已复制', 'Group number copied') : t('复制失败', 'Copy failed'), ok ? 'success' : 'error'))
      return
    }
    if (event.target.closest('#refresh-btn')) {
      refresh().then(() => bootToast(t('已刷新', 'Refreshed'), 'success')).catch(err => bootToast(err.message, 'error'))
      return
    }
    if (event.target.closest('#image-chip')) {
      app.navigate('settings')
      return
    }
    if (event.target.closest('#model-chip')) {
      app.openSettings()
      return
    }
    if (event.target.closest('#theme-toggle')) {
      const next = app.theme === 'dark' ? 'light' : 'dark'
      localStorage.setItem('media-workbench-modern:theme', next)
      applyTheme(next)
    }
  })

  window.addEventListener('hashchange', () => {
    if (!app.state) return
    paintRoute()
    app.view?.update?.(app.state)
  })

  window.addEventListener('message', event => {
    if (event.origin !== location.origin) return
    const data = event.data
    if (!data || typeof data !== 'object') return
    if (data.type === 'media-workbench-modern:theme' && (data.scheme === 'dark' || data.scheme === 'light')) {
      if (!localStorage.getItem('media-workbench-modern:theme')) applyTheme(data.scheme)
    }
    if (data.type === 'media-workbench-modern:locale' && data.lang !== app.lang && (data.lang === 'zh' || data.lang === 'en')) {
      app.lang = data.lang
      document.documentElement.lang = app.lang === 'en' ? 'en' : 'zh-CN'
      renderChrome()
      paintRoute()
      app.view?.update?.(app.state)
    }
  })

  document.addEventListener('keydown', event => {
    if ((event.metaKey || event.ctrlKey) && event.key === ',') {
      event.preventDefault()
      app.navigate('settings')
    }
  })

  // 轮询只用来推进异步任务；页面隐藏时暂停
  setInterval(() => {
    if (document.hidden || !app.state || app.polling) return
    const hasRunning = (app.state.images ?? []).some(row => row.status === 'queued' || row.status === 'running')
      || (app.state.videos ?? []).some(row => row.status === 'queued' || row.status === 'running')
      || (app.state.graphs ?? []).some(graph => graph.run?.status === 'running')
    if (!hasRunning) return
    app.polling = true
    refresh().catch(() => {}).finally(() => { app.polling = false })
  }, 2200)
}

async function boot() {
  renderChrome()
  applyTheme(theme)
  wire()
  $('#refresh-btn').title = `${t('刷新', 'Refresh')} (${modKey()}+R)`
  try {
    await refresh()
  } catch (err) {
    $('#view').innerHTML = `<div class="fatal"><h2>${esc(t('工作台没有启动', 'Studio failed to start'))}</h2><p>${esc(err.message)}</p><p class="fine">${esc(t('确认插件已启用，然后刷新页面。', 'Check the plugin is enabled, then reload.'))}</p></div>`
    return
  }
  paintRoute()
  app.view?.update?.(app.state)
}

boot()

export { refresh }
