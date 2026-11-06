import { api, fileUrl, upload } from '../lib/api.js'
import { $, $$, autoGrow, downloadUrl, esc, fmtTime, modKey } from '../lib/dom.js'
import { icon } from '../lib/icons.js'
import { app, t } from '../lib/state.js'
import { RATIOS } from '../lib/constants.js'

const MODES = [
  { id: 'text', label: ['文生视频', 'Text to video'], hint: ['只给描述，让画面动起来', 'Describe it, let it move'] },
  { id: 'image', label: ['图生视频', 'Image to video'], hint: ['用一张首帧，接住构图和光线', 'Start from a first frame'] },
  { id: 'storyboard', label: ['分镜短片', 'Storyboard'], hint: ['用 4 张关键帧拼出动态预览', 'Four keyframes, one moving preview'] },
]

export function mount(root) {
  const prefs = app.state?.preferences ?? {}
  let mode = MODES.some(item => item.id === prefs.videoMode) ? prefs.videoMode : 'text'
  let ratio = RATIOS.some(r => r.id === prefs.videoRatio) ? prefs.videoRatio : '16:9'
  let duration = [5, 8, 10, 15].includes(Number(prefs.videoDuration)) ? Number(prefs.videoDuration) : 5
  let reference = null
  let busy = false

  root.innerHTML = `
    <section class="bench bench-video">
      <aside class="composer">
        <div class="composer-head">
          <div>
            <span class="eyebrow">${esc(t('镜头', 'MOTION'))}</span>
            <h2>${esc(t('视频工作台', 'Video Studio'))}</h2>
          </div>
          <button class="icon-btn" data-act="settings" title="${esc(t('视频设置', 'Video settings'))}">${icon('settings', 16)}</button>
        </div>
        <div class="provider-line" id="provider-line"></div>
        <div class="field">
          <span class="field-label">${esc(t('方式', 'Mode'))}</span>
          <div class="mode-tabs" id="modes">
            ${MODES.map(item => `<button type="button" class="mode-tab" data-mode="${item.id}">
              <b>${esc(t(item.label[0], item.label[1]))}</b>
              <small>${esc(t(item.hint[0], item.hint[1]))}</small>
            </button>`).join('')}
          </div>
        </div>
        <label class="field field-prompt">
          <span class="field-label">${esc(t('画面描述', 'Shot description'))}<em id="prompt-count">0</em></span>
          <textarea id="prompt" rows="5" maxlength="2000" placeholder="${esc(t('镜头怎么运动、人物在做什么、光线和氛围…', 'How the camera moves, what happens, light and mood…'))}"></textarea>
        </label>
        <div class="field" id="ref-field">
          <span class="field-label">${esc(t('首帧 / 参考图', 'First frame'))}</span>
          <div class="drop drop-compact" id="drop" tabindex="0" role="button">
            <input type="file" id="ref-input" accept="image/png,image/jpeg,image/webp" hidden>
            <div class="drop-empty">${icon('upload', 16)}<span>${esc(t('选一张图（可选）', 'Choose an image (optional)'))}</span></div>
            <div class="drop-preview" id="drop-preview" hidden><img id="ref-img" alt=""><button type="button" class="mini-x" id="ref-clear">${icon('x', 12)}</button></div>
          </div>
        </div>
        <div class="field-row">
          <div class="field">
            <span class="field-label">${esc(t('画幅', 'Aspect'))}</span>
            <select class="select" id="ratio">
              ${RATIOS.map(item => `<option value="${item.id}" ${item.id === ratio ? 'selected' : ''}>${item.id}</option>`).join('')}
            </select>
          </div>
          <div class="field">
            <span class="field-label">${esc(t('时长', 'Duration'))}</span>
            <div class="chips chips-tight" id="duration">
              ${[5, 8, 10, 15].map(value => `<button type="button" class="chip" data-duration="${value}">${value}s</button>`).join('')}
            </div>
          </div>
        </div>
        <button class="btn btn-generate" id="generate">
          <span class="gen-ic">${icon('film', 17)}</span>
          <span class="gen-label">${esc(t('生成视频', 'Generate video'))}</span>
          <kbd>${modKey()} ↵</kbd>
        </button>
        <p class="fine" id="mode-fine"></p>
      </aside>

      <section class="gallery-pane">
        <header class="pane-head">
          <div class="pane-title"><h2>${esc(t('视频历史', 'Video library'))}</h2><span class="count-pill" id="gallery-count">0</span></div>
          <div class="gallery-tools">
            <span class="quiet-note">${icon('clock', 14)}${esc(t('视频任务较慢，可以离开这一页', 'Video jobs keep running if you leave'))}</span>
          </div>
        </header>
        <div id="gallery" class="video-list"></div>
      </section>
    </section>
  `

  const promptEl = $('#prompt')
  promptEl.addEventListener('input', () => {
    $('#prompt-count').textContent = String(promptEl.value.length)
    autoGrow(promptEl, 240)
  })
  autoGrow(promptEl, 240)

  $('#modes').addEventListener('click', event => {
    const btn = event.target.closest('[data-mode]')
    if (!btn) return
    mode = btn.dataset.mode
    paintModes()
  })
  $('#duration').addEventListener('click', event => {
    const btn = event.target.closest('[data-duration]')
    if (!btn) return
    duration = Number(btn.dataset.duration)
    paintModes()
  })
  $('#ratio').addEventListener('change', () => { ratio = $('#ratio').value })
  $('#generate').addEventListener('click', generate)
  promptEl.addEventListener('keydown', event => {
    if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') { event.preventDefault(); generate() }
  })
  root.addEventListener('click', event => {
    if (event.target.closest('[data-act="settings"]')) app.navigate('settings')
  })

  const drop = $('#drop')
  const refInput = $('#ref-input')
  drop.addEventListener('click', event => { if (!event.target.closest('#ref-clear')) refInput.click() })
  drop.addEventListener('keydown', event => { if (event.key === 'Enter') { event.preventDefault(); refInput.click() } })
  refInput.addEventListener('change', async () => {
    const file = refInput.files?.[0]
    if (!file) return
    try {
      const result = await upload(file)
      reference = result
      $('#ref-img').src = result.url
      $('#drop-preview').hidden = false
      drop.querySelector('.drop-empty').hidden = true
    } catch (err) { app.toast(err.message, 'error') }
    refInput.value = ''
  })
  $('#ref-clear').addEventListener('click', event => {
    event.stopPropagation()
    reference = null
    $('#drop-preview').hidden = true
    drop.querySelector('.drop-empty').hidden = false
  })

  function paintModes() {
    $$('#modes [data-mode]').forEach(btn => btn.classList.toggle('is-on', btn.dataset.mode === mode))
    $$('#duration [data-duration]').forEach(btn => btn.classList.toggle('is-on', Number(btn.dataset.duration) === duration))
    $('#ref-field').hidden = mode === 'text'
    const fine = $('#mode-fine')
    if (mode === 'storyboard') {
      fine.textContent = t('分镜短片用生图服务生成 4 张关键帧，在浏览器里按节奏播放，不消耗视频额度。', 'Storyboard uses your image provider for four keyframes and plays them in the browser.')
    } else if (!app.settings?.videoReady) {
      fine.textContent = t('还没有配置视频服务。可以先用分镜短片，或去设置里填接口。', 'No video provider yet. Try storyboard, or configure one in settings.')
    } else {
      fine.textContent = t('视频生成通常需要 1–10 分钟，关掉这一页也会继续。', 'Video jobs usually take 1–10 minutes and keep running if you leave.')
    }
    const label = $('#generate .gen-label')
    if (label) label.textContent = mode === 'storyboard' ? t('生成分镜短片', 'Generate storyboard') : t('生成视频', 'Generate video')
  }
  paintModes()

  function renderProvider() {
    const line = $('#provider-line')
    const ready = mode === 'storyboard' ? app.settings?.imageReady : app.settings?.videoReady
    const model = mode === 'storyboard' ? app.settings?.image?.model : app.settings?.video?.model
    if (ready) {
      line.className = 'provider-line is-ready'
      line.innerHTML = `<i class="dot"></i><span>${esc(model || t('已连接', 'Ready'))}</span><em>${esc(mode === 'storyboard' ? t('分镜模式 · 使用生图', 'Storyboard · image provider') : '')}</em>`
    } else {
      line.className = 'provider-line is-off'
      line.innerHTML = `<span>${esc(mode === 'storyboard' ? t('生图服务还没配置', 'Image provider is not configured') : t('视频服务还没配置', 'Video provider is not configured'))}</span><button type="button" class="link-btn" data-act="settings">${esc(t('去设置', 'Set up'))} ${icon('arrowRight', 13)}</button>`
    }
  }

  function videoCard(row) {
    if (row.status === 'queued' || row.status === 'running') {
      return `<article class="vid-card is-busy" data-id="${row.id}">
        <div class="vid-media shimmer"><span class="busy-label"><i></i>${esc(t('正在生成…', 'Rendering…'))}</span></div>
        <div class="vid-body">
          <div class="vid-head"><span class="status-dot is-running"></span><b>${esc(row.mode === 'storyboard' ? t('分镜短片', 'Storyboard') : t('视频', 'Video'))}</b><time>${esc(fmtTime(row.createdAt))}</time></div>
          <p class="vid-prompt">${esc(row.prompt)}</p>
          <div class="progress"><span style="width:${Math.max(4, row.progress || 4)}%"></span></div>
          <div class="vid-actions">
            <span class="fine">${esc(t('进度', 'Progress'))} ${row.progress || 0}%</span>
            <button class="btn btn-small btn-ghost" data-act="cancel" data-id="${row.id}">${icon('stop', 13)}${esc(t('停止', 'Stop'))}</button>
          </div>
        </div>
      </article>`
    }
    if (row.status === 'error') {
      return `<article class="vid-card is-error" data-id="${row.id}">
        <div class="vid-media error-media"><span>${icon('alert', 20)}</span></div>
        <div class="vid-body">
          <div class="vid-head"><span class="status-dot is-error"></span><b>${esc(t('生成失败', 'Failed'))}</b><time>${esc(fmtTime(row.createdAt))}</time></div>
          <p class="vid-error">${esc(row.error || t('未知错误', 'Unknown error'))}</p>
          <p class="vid-prompt">${esc(row.prompt)}</p>
          <div class="vid-actions">
            <button class="btn btn-small btn-ghost" data-act="retry" data-id="${row.id}">${icon('refresh', 13)}${esc(t('重试', 'Retry'))}</button>
            <button class="btn btn-small btn-ghost danger-quiet" data-act="delete" data-id="${row.id}">${icon('trash', 13)}${esc(t('删除', 'Delete'))}</button>
          </div>
        </div>
      </article>`
    }
    const frames = row.frames ?? []
    const media = row.mode === 'storyboard' && frames.length
      ? `<div class="vid-media storyboard-media">${frames.slice(0, 4).map((file, index) => `<img src="${fileUrl(file)}" alt="" style="--i:${index}">`).join('')}
          <button class="play-fab" data-act="play" data-id="${row.id}" aria-label="${esc(t('播放分镜', 'Play storyboard'))}">${icon('play', 18)}</button>
        </div>`
      : `<div class="vid-media">${row.file ? `<video src="${fileUrl(row.file)}" controls preload="metadata" playsinline></video>` : `<span class="muted">${esc(t('没有视频文件', 'No file'))}</span>`}</div>`
    return `<article class="vid-card" data-id="${row.id}">
      ${media}
      <div class="vid-body">
        <div class="vid-head"><span class="status-dot is-done"></span><b>${esc(row.mode === 'storyboard' ? t('分镜短片', 'Storyboard') : t('视频', 'Video'))}</b><span class="tag">${esc(row.aspect)}</span><span class="tag">${row.duration}s</span><time>${esc(fmtTime(row.createdAt))}</time></div>
        <p class="vid-prompt">${esc(row.prompt)}</p>
        <div class="vid-actions">
          ${row.file ? `<button class="btn btn-small btn-ghost" data-act="download" data-id="${row.id}">${icon('download', 13)}${esc(t('下载', 'Download'))}</button>` : ''}
          ${row.mode === 'storyboard' ? `<button class="btn btn-small btn-ghost" data-act="download-frames" data-id="${row.id}">${icon('grid', 13)}${esc(t('下载全部分镜', 'Download frames'))}</button>` : ''}
          <button class="btn btn-small btn-ghost" data-act="retry" data-id="${row.id}">${icon('refresh', 13)}${esc(t('再生成', 'Regenerate'))}</button>
          <button class="btn btn-small btn-ghost danger-quiet" data-act="delete" data-id="${row.id}">${icon('trash', 13)}</button>
        </div>
      </div>
    </article>`
  }

  function renderGallery() {
    const list = app.state?.videos ?? []
    const gallery = $('#gallery')
    $('#gallery-count').textContent = String(list.length)
    if (!list.length) {
      gallery.innerHTML = `<div class="empty-gallery">
        <div class="empty-art">${icon('film', 30)}</div>
        <h3>${esc(t('给画面一点时间', 'Give the frame some time'))}</h3>
        <p>${esc(t('写一个镜头，或者先用分镜短片试一次——不消耗视频额度也能看到运动。', 'Describe a shot, or start with a storyboard — motion without spending video credits.'))}</p>
        <div class="inspirations">
          <button class="inspo" data-inspo="0"><span class="inspo-index">01</span><b>${esc(t('清晨公路', 'Morning road'))}</b><small>${esc(t('清晨的海边公路，一辆旧巴士驶过，车窗里有人望向海面。', 'A coastal road at dawn, an old bus passing, someone watching the sea.'))}</small></button>
          <button class="inspo" data-inspo="1"><span class="inspo-index">02</span><b>${esc(t('雨夜霓虹', 'Neon rain'))}</b><small>${esc(t('雨夜的巷口，霓虹在水面碎成一片，镜头慢慢向前推。', 'A rainy alley, neon broken on the water, camera pushes in slowly.'))}</small></button>
          <button class="inspo" data-inspo="2"><span class="inspo-index">03</span><b>${esc(t('桌面微距', 'Desk macro'))}</b><small>${esc(t('一杯正在冷却的咖啡，热气在晨光里慢慢散开，微距镜头。', 'A cooling cup of coffee, steam drifting in morning light, macro lens.'))}</small></button>
        </div>
      </div>`
      return
    }
    gallery.innerHTML = list.map(videoCard).join('')
  }

  $('#gallery').addEventListener('click', async event => {
    const inspo = event.target.closest('[data-inspo]')
    if (inspo) {
      const prompts = [
        '清晨的海边公路，一辆旧巴士驶过，车窗里有人望向海面。镜头缓慢跟随。',
        '雨夜的巷口，霓虹在水面碎成一片，镜头慢慢向前推，雨丝清晰可见。',
        '一杯正在冷却的咖啡，热气在晨光里慢慢散开，微距镜头，浅景深。',
      ]
      promptEl.value = prompts[Number(inspo.dataset.inspo)] ?? ''
      promptEl.dispatchEvent(new Event('input'))
      promptEl.focus()
      return
    }
    const btn = event.target.closest('[data-act]')
    if (!btn) return
    const id = btn.dataset.id
    const row = (app.state?.videos ?? []).find(item => item.id === id)
    if (!row) return
    const act = btn.dataset.act
    if (act === 'cancel') {
      try { await api('video/cancel', { id }); app.toast(t('已停止', 'Stopped'), 'success'); await app.refresh() } catch (err) { app.toast(err.message, 'error') }
      return
    }
    if (act === 'delete') {
      const ok = await app.confirm({ title: t('删除这条视频？', 'Delete this video?'), message: t('记录会被删除。', 'The record will be removed.'), confirmText: t('删除', 'Delete'), danger: true })
      if (!ok) return
      try { await api('video/action', { id, action: 'delete' }); await app.refresh(); app.toast(t('已删除', 'Deleted'), 'success') } catch (err) { app.toast(err.message, 'error') }
      return
    }
    if (act === 'retry') {
      try { await api('video/action', { id, action: 'retry' }); await app.refresh() } catch (err) { app.toast(err.message, 'error') }
      return
    }
    if (act === 'download') {
      downloadUrl(fileUrl(row.file), `modern-media-${row.id}.mp4`)
      return
    }
    if (act === 'download-frames') {
      for (const [index, file] of (row.frames ?? []).entries()) downloadUrl(fileUrl(file), `modern-media-${row.id}-${index + 1}.png`)
      return
    }
    if (act === 'play') playStoryboard(row)
  })

  function playStoryboard(row) {
    const frames = row.frames ?? []
    if (!frames.length) return
    const card = document.createElement('div')
    card.className = 'story-player'
    card.innerHTML = `
      <button class="lb-close" data-sp="close" aria-label="关闭">${icon('x', 18)}</button>
      <div class="story-stage">
        ${frames.map((file, index) => `<img src="${fileUrl(file)}" alt="" class="${index === 0 ? 'is-on' : ''}" data-frame="${index}">`).join('')}
        <div class="story-caption"><span class="eyebrow">${esc(t('分镜短片', 'STORYBOARD'))}</span><p>${esc(row.prompt)}</p></div>
      </div>
      <div class="story-controls">
        <button class="icon-btn" data-sp="toggle">${icon('pause', 16)}</button>
        <div class="story-dots">${frames.map((_, index) => `<i data-dot="${index}" class="${index === 0 ? 'is-on' : ''}"></i>`).join('')}</div>
        <span class="fine">${frames.length} ${esc(t('个镜头', 'frames'))}</span>
      </div>`
    let index = 0
    let playing = true
    let timer = null
    const imgs = [...card.querySelectorAll('[data-frame]')]
    const dots = [...card.querySelectorAll('[data-dot]')]
    const tick = () => {
      index = (index + 1) % frames.length
      imgs.forEach((img, i) => img.classList.toggle('is-on', i === index))
      dots.forEach((dot, i) => dot.classList.toggle('is-on', i === index))
    }
    const start = () => { stop(); timer = setInterval(tick, 2400) }
    const stop = () => { if (timer) clearInterval(timer); timer = null }
    card.querySelector('[data-sp="toggle"]').addEventListener('click', event => {
      playing = !playing
      event.currentTarget.innerHTML = icon(playing ? 'pause' : 'play', 16)
      playing ? start() : stop()
    })
    let close = () => {}
    card.querySelector('[data-sp="close"]').addEventListener('click', () => close())
    close = app.showLayer(card, { className: 'layer-story', onClose: stop })
    start()
  }

  async function generate() {
    if (busy) return
    const prompt = promptEl.value.trim()
    if (!prompt) { promptEl.focus(); return app.toast(t('先写一个镜头', 'Describe the shot first'), 'error') }
    const ready = mode === 'storyboard' ? app.settings?.imageReady : app.settings?.videoReady
    if (!ready) {
      app.toast(mode === 'storyboard' ? t('分镜需要生图服务', 'Storyboard needs an image provider') : t('先配置视频服务，或改用分镜', 'Configure video, or switch to storyboard'), 'error')
      return app.navigate('settings')
    }
    busy = true
    const btn = $('#generate')
    btn.classList.add('is-busy')
    btn.querySelector('.gen-label').textContent = t('正在提交…', 'Sending…')
    try {
      await api('video/generate', {
        prompt,
        mode,
        ratio,
        duration,
        reference: reference?.name ?? '',
      })
      api('preferences', { videoMode: mode, videoRatio: ratio, videoDuration: duration }).catch(() => {})
      app.toast(mode === 'storyboard' ? t('分镜任务已开始', 'Storyboard started') : t('视频任务已开始', 'Video started'), 'success')
      await app.refresh()
    } catch (err) {
      app.toast(err.message, 'error')
    } finally {
      busy = false
      btn.classList.remove('is-busy')
      paintModes()
    }
  }

  function update() {
    renderProvider()
    paintModes()
    renderGallery()
  }

  update()

  return { update }
}
