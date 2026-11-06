import { api, fileUrl, upload } from '../lib/api.js'
import { $, $$, autoGrow, copyText, downloadUrl, esc, fmtTime, modKey } from '../lib/dom.js'
import { icon } from '../lib/icons.js'
import { app, t } from '../lib/state.js'
import { INSPIRATIONS, RATIOS, STYLE_LABELS_EN, STYLES } from '../lib/constants.js'

export function mount(root) {
  const prefs = app.state?.preferences ?? {}
  let style = prefs.imageStyle ?? '电影感'
  let ratio = RATIOS.some(r => r.id === prefs.imageRatio) ? prefs.imageRatio : '16:9'
  let count = Math.min(4, Math.max(1, Number(prefs.imageCount) || 1))
  let reference = null
  let filter = 'all'
  let query = ''
  let busy = false

  const styleName = value => (app.lang === 'en' ? (STYLE_LABELS_EN[value] ?? value) : value)
  const inspoTitle = item => (app.lang === 'en' ? item.titleEn : item.title)
  const inspoPrompt = item => (app.lang === 'en' ? item.promptEn : item.prompt)

  root.innerHTML = `
    <section class="bench bench-image">
      <aside class="composer" id="composer">
        <div class="composer-head">
          <div>
            <span class="eyebrow">${esc(t('画面', 'FRAME'))}</span>
            <h2>${esc(t('生图工作台', 'Image Studio'))}</h2>
          </div>
          <button class="icon-btn" data-act="settings" title="${esc(t('生图设置', 'Image settings'))}">${icon('settings', 16)}</button>
        </div>
        <div class="provider-line" id="provider-line"></div>
        <label class="field field-prompt">
          <span class="field-label">${esc(t('提示词', 'Prompt'))}<em id="prompt-count">0</em></span>
          <textarea id="prompt" rows="5" maxlength="2000" placeholder="${esc(t('描述主体、构图、光线、材质，以及不想出现的东西…', 'Describe subject, composition, light, material — and what to avoid…'))}"></textarea>
        </label>
        <div class="field">
          <span class="field-label">${esc(t('风格', 'Style'))}</span>
          <div class="chips" id="styles">
            <button type="button" class="chip" data-style="">${esc(t('无', 'None'))}</button>
            ${STYLES.map(name => `<button type="button" class="chip" data-style="${esc(name)}">${esc(styleName(name))}</button>`).join('')}
          </div>
        </div>
        <div class="field">
          <span class="field-label">${esc(t('画幅', 'Aspect'))}</span>
          <div class="chips chips-ratio" id="ratios">
            ${RATIOS.map(item => `<button type="button" class="chip chip-ratio" data-ratio="${item.id}" title="${item.hint}"><i class="ratio-shape" style="aspect-ratio:${item.id.replace(':', '/')}"></i>${item.label}</button>`).join('')}
          </div>
        </div>
        <div class="field-row">
          <div class="field">
            <span class="field-label">${esc(t('数量', 'Count'))}</span>
            <div class="stepper" id="count">
              <button type="button" data-step="-1" aria-label="减少">${icon('minus', 14)}</button>
              <b id="count-value">${count}</b>
              <button type="button" data-step="1" aria-label="增加">${icon('plus', 14)}</button>
            </div>
          </div>
          <div class="field">
            <span class="field-label">${esc(t('质量', 'Quality'))}</span>
            <select id="quality" class="select">
              <option value="">${esc(t('自动', 'Auto'))}</option>
              <option value="high">high</option>
              <option value="medium">medium</option>
              <option value="low">low</option>
            </select>
          </div>
        </div>
        <details class="advanced" id="advanced">
          <summary>${icon('layers', 14)}<span>${esc(t('参考图与高级参数', 'Reference & advanced'))}</span>${icon('chevron', 14)}</summary>
          <div class="advanced-body">
            <div class="drop" id="drop" tabindex="0" role="button" aria-label="${esc(t('上传参考图', 'Upload reference'))}">
              <input type="file" id="ref-input" accept="image/png,image/jpeg,image/webp" hidden>
              <div class="drop-empty">${icon('upload', 18)}<span>${esc(t('拖入或选择一张参考图', 'Drop or choose a reference image'))}</span><small>${esc(t('会走图生图 / 编辑接口', 'Uses the image edit endpoint'))}</small></div>
              <div class="drop-preview" id="drop-preview" hidden><img id="ref-img" alt=""><button type="button" class="mini-x" id="ref-clear" aria-label="移除">${icon('x', 12)}</button></div>
            </div>
            <label class="field">
              <span class="field-label">${esc(t('反向提示词', 'Negative prompt'))}</span>
              <textarea id="negative" rows="2" maxlength="800" placeholder="${esc(t('不想要的内容，例如：文字、水印、多余的手指', 'Things to avoid, e.g. text, watermark, extra fingers'))}"></textarea>
            </label>
          </div>
        </details>
        <button class="btn btn-generate" id="generate">
          <span class="gen-ic">${icon('spark', 17)}</span>
          <span class="gen-label">${esc(t('开始生成', 'Generate'))}</span>
          <kbd>${modKey()} ↵</kbd>
        </button>
        <p class="fine">${esc(t('图片自动存进本机作品库，不会上传到别处。', 'Images stay on this machine in your local library.'))}</p>
      </aside>

      <section class="gallery-pane">
        <header class="pane-head">
          <div class="pane-title">
            <h2>${esc(t('创作历史', 'Library'))}</h2>
            <span class="count-pill" id="gallery-count">0</span>
          </div>
          <div class="gallery-tools">
            <div class="seg" id="filter">
              <button type="button" data-f="all" class="is-on">${esc(t('全部', 'All'))}</button>
              <button type="button" data-f="fav">${esc(t('收藏', 'Saved'))}</button>
            </div>
            <label class="search">${icon('search', 15)}<input id="search" type="search" placeholder="${esc(t('搜提示词、风格、模型', 'Search prompts, styles, models'))}"></label>
          </div>
        </header>
        <div id="gallery" class="gallery"></div>
      </section>
    </section>
  `

  const promptEl = $('#prompt')
  const galleryEl = $('#gallery')

  // ---- 初始化 ----
  promptEl.addEventListener('input', () => {
    $('#prompt-count').textContent = String(promptEl.value.length)
    autoGrow(promptEl, 260)
  })
  autoGrow(promptEl, 260)

  $('#styles').addEventListener('click', event => {
    const btn = event.target.closest('[data-style]')
    if (!btn) return
    style = btn.dataset.style
    paintChoices()
  })
  $('#ratios').addEventListener('click', event => {
    const btn = event.target.closest('[data-ratio]')
    if (!btn) return
    ratio = btn.dataset.ratio
    paintChoices()
  })
  $('#count').addEventListener('click', event => {
    const btn = event.target.closest('[data-step]')
    if (!btn) return
    count = Math.min(4, Math.max(1, count + Number(btn.dataset.step)))
    $('#count-value').textContent = String(count)
  })
  $('#filter').addEventListener('click', event => {
    const btn = event.target.closest('[data-f]')
    if (!btn) return
    filter = btn.dataset.f
    $$('#filter button').forEach(b => b.classList.toggle('is-on', b === btn))
    renderGallery()
  })
  $('#search').addEventListener('input', () => {
    query = $('#search').value.trim().toLowerCase()
    renderGallery()
  })
  $('#generate').addEventListener('click', generate)
  promptEl.addEventListener('keydown', event => {
    if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') { event.preventDefault(); generate() }
  })
  root.addEventListener('click', event => {
    if (event.target.closest('[data-act="settings"]')) app.navigate('settings')
  })

  // 参考图
  const refInput = $('#ref-input')
  const drop = $('#drop')
  const pickRef = () => refInput.click()
  drop.addEventListener('click', event => { if (!event.target.closest('#ref-clear')) pickRef() })
  drop.addEventListener('keydown', event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); pickRef() } })
  refInput.addEventListener('change', async () => {
    const file = refInput.files?.[0]
    if (!file) return
    await handleReference(file)
    refInput.value = ''
  })
  for (const type of ['dragenter', 'dragover']) {
    drop.addEventListener(type, event => { event.preventDefault(); drop.classList.add('is-over') })
  }
  for (const type of ['dragleave', 'drop']) {
    drop.addEventListener(type, event => { event.preventDefault(); drop.classList.remove('is-over') })
  }
  drop.addEventListener('drop', event => {
    const file = [...(event.dataTransfer?.files ?? [])].find(f => f.type.startsWith('image/'))
    if (file) handleReference(file)
  })
  $('#ref-clear').addEventListener('click', event => {
    event.stopPropagation()
    reference = null
    $('#drop-preview').hidden = true
    $('#drop').querySelector('.drop-empty').hidden = false
  })

  async function handleReference(file) {
    if (!file.type.startsWith('image/')) return app.toast(t('请选图片文件', 'Choose an image file'), 'error')
    try {
      const result = await upload(file)
      reference = result
      const img = $('#ref-img')
      img.src = result.url
      $('#drop-preview').hidden = false
      $('#drop').querySelector('.drop-empty').hidden = true
      app.toast(t('参考图已加入', 'Reference added'), 'success')
    } catch (err) {
      app.toast(err.message, 'error')
    }
  }

  function paintChoices() {
    $$('#styles [data-style]').forEach(btn => btn.classList.toggle('is-on', btn.dataset.style === style))
    $$('#ratios [data-ratio]').forEach(btn => btn.classList.toggle('is-on', btn.dataset.ratio === ratio))
  }
  paintChoices()

  function renderProvider() {
    const line = $('#provider-line')
    if (!line) return
    if (app.settings?.imageReady) {
      line.className = 'provider-line is-ready'
      line.innerHTML = `<i class="dot"></i><span>${esc(app.settings.image.model || t('已连接', 'Ready'))}</span><em>${esc(app.settings.image.keyHint ? `•••• ${app.settings.image.keyHint}` : '')}</em>`
    } else {
      line.className = 'provider-line is-off'
      line.innerHTML = `<span>${esc(t('生图服务还没配置', 'Image provider is not configured'))}</span><button type="button" class="link-btn" data-act="settings">${esc(t('去设置', 'Set up'))} ${icon('arrowRight', 13)}</button>`
    }
  }

  function currentList() {
    const images = app.state?.images ?? []
    return images.filter(row => {
      if (filter === 'fav' && !row.favorite) return false
      if (!query) return true
      return `${row.prompt} ${row.style} ${row.model}`.toLowerCase().includes(query)
    })
  }

  function card(row) {
    const ratioValue = row.width && row.height ? `${row.width} / ${row.height}` : (row.size?.includes('x') ? row.size.replace('x', ' / ') : '16 / 9')
    if (row.status === 'queued' || row.status === 'running') {
      return `<article class="shot is-busy" data-id="${row.id}">
        <div class="shot-media shimmer" style="aspect-ratio:${ratioValue}"><span class="busy-label"><i></i>${esc(t('正在生成…', 'Generating…'))}</span></div>
        <div class="shot-body">
          <p class="shot-prompt">${esc(row.prompt)}</p>
          <div class="shot-meta"><span class="tag">${esc(styleName(row.style) || t('无风格', 'No style'))}</span><span>${esc(row.model || '')}</span><time>${esc(fmtTime(row.createdAt))}</time></div>
        </div>
      </article>`
    }
    if (row.status === 'error') {
      return `<article class="shot is-error" data-id="${row.id}">
        <div class="shot-media error-media" style="aspect-ratio:${ratioValue}">
          <span>${icon('alert', 20)}</span>
          <p>${esc(row.error || t('生成失败', 'Failed'))}</p>
          <button type="button" class="btn btn-small btn-ghost" data-act="retry" data-id="${row.id}">${esc(t('重试', 'Retry'))}</button>
        </div>
        <div class="shot-body">
          <p class="shot-prompt">${esc(row.prompt)}</p>
          <div class="shot-meta"><span class="tag tag-error">${esc(t('失败', 'Failed'))}</span><time>${esc(fmtTime(row.createdAt))}</time></div>
        </div>
      </article>`
    }
    return `<article class="shot" data-id="${row.id}">
      <div class="shot-media" data-act="open" data-id="${row.id}" style="aspect-ratio:${ratioValue}" role="button" tabindex="0" aria-label="${esc(t('查看大图', 'Open image'))}">
        <img src="${fileUrl(row.file)}" alt="${esc(row.prompt.slice(0, 80))}" loading="lazy">
        <div class="shot-top">
          <button type="button" class="mini-btn ${row.favorite ? 'is-on' : ''}" data-act="fav" data-id="${row.id}" title="${esc(t('收藏', 'Save'))}">${icon('heart', 14)}</button>
          <button type="button" class="mini-btn" data-act="download" data-id="${row.id}" title="${esc(t('下载', 'Download'))}">${icon('download', 14)}</button>
        </div>
      </div>
      <div class="shot-body">
        <p class="shot-prompt">${esc(row.prompt)}</p>
        <div class="shot-meta"><span class="tag">${esc(styleName(row.style) || t('无风格', 'No style'))}</span><span class="ellipsis">${esc(row.model || '')}</span><time>${esc(fmtTime(row.createdAt))}</time></div>
        <div class="shot-actions">
          <button type="button" data-act="reuse" data-id="${row.id}">${icon('refresh', 13)}${esc(t('复用', 'Reuse'))}</button>
          <button type="button" data-act="copy" data-id="${row.id}">${icon('copy', 13)}${esc(t('复制', 'Copy'))}</button>
          <button type="button" data-act="delete" data-id="${row.id}" class="danger-quiet">${icon('trash', 13)}</button>
        </div>
      </div>
    </article>`
  }

  function renderGallery() {
    const list = currentList()
    const total = app.state?.images?.length ?? 0
    const countEl = $('#gallery-count')
    if (countEl) countEl.textContent = String(total)
    if (!list.length) {
      if (!total && !query && filter === 'all') {
        galleryEl.innerHTML = `<div class="empty-gallery">
          <div class="empty-art">${icon('image', 30)}</div>
          <h3>${esc(t('第一张画，从一句话开始', 'The first frame starts with a line'))}</h3>
          <p>${esc(t('随便挑一个开头，或者在上面的提示词框里写你脑子里的画面。', 'Pick a starting point, or describe the picture in your head.'))}</p>
          <div class="inspirations">
            ${INSPIRATIONS.map((item, index) => `<button type="button" class="inspo" data-inspo="${index}">
              <span class="inspo-index">0${index + 1}</span>
              <b>${esc(inspoTitle(item))}</b>
              <small>${esc(inspoPrompt(item))}</small>
            </button>`).join('')}
          </div>
        </div>`
      } else {
        galleryEl.innerHTML = `<div class="empty-gallery compact"><p>${esc(t('没有找到符合条件的作品。', 'No images match this filter.'))}</p></div>`
      }
      return
    }
    galleryEl.innerHTML = list.map(card).join('')
  }

  galleryEl.addEventListener('click', async event => {
    const btn = event.target.closest('[data-act]')
    if (!btn) return
    const id = btn.dataset.id
    const row = (app.state?.images ?? []).find(item => item.id === id)
    if (!row) return
    const act = btn.dataset.act
    if (act === 'open') return openLightbox(id)
    if (act === 'fav') {
      try { await api('image/action', { id, action: 'favorite' }); await app.refresh() } catch (err) { app.toast(err.message, 'error') }
      return
    }
    if (act === 'download') {
      downloadUrl(fileUrl(row.file), `modern-media-${row.id}${row.file?.match(/\.\w+$/)?.[0] ?? '.png'}`)
      return
    }
    if (act === 'copy') {
      const ok = await copyText(row.prompt)
      app.toast(ok ? t('提示词已复制', 'Prompt copied') : t('复制失败', 'Copy failed'), ok ? 'success' : 'error')
      return
    }
    if (act === 'reuse') {
      promptEl.value = row.prompt
      promptEl.dispatchEvent(new Event('input'))
      if (row.style && STYLES.includes(row.style)) style = row.style
      if (row.size?.includes('x')) {
        const match = RATIOS.find(item => item.hint.replaceAll(' × ', 'x') === row.size)
        if (match) ratio = match.id
      }
      paintChoices()
      promptEl.focus()
      app.toast(t('已填入提示词', 'Prompt loaded'), 'success')
      return
    }
    if (act === 'retry') {
      try { await api('image/action', { id, action: 'retry' }); await app.refresh() } catch (err) { app.toast(err.message, 'error') }
      return
    }
    if (act === 'delete') {
      const ok = await app.confirm({
        title: t('删除这张图？', 'Delete this image?'),
        message: t('只删除工作台里的记录，本机文件不会立刻清理。', 'This removes the record from the workbench.'),
        confirmText: t('删除', 'Delete'),
        danger: true,
      })
      if (!ok) return
      try { await api('image/action', { id, action: 'delete' }); await app.refresh(); app.toast(t('已删除', 'Deleted'), 'success') } catch (err) { app.toast(err.message, 'error') }
    }
  })

  galleryEl.addEventListener('keydown', event => {
    if (event.key !== 'Enter' && event.key !== ' ') return
    const media = event.target.closest('[data-act="open"]')
    if (!media) return
    event.preventDefault()
    openLightbox(media.dataset.id)
  })

  galleryEl.addEventListener('click', event => {
    const inspo = event.target.closest('[data-inspo]')
    if (!inspo) return
    const item = INSPIRATIONS[Number(inspo.dataset.inspo)]
    promptEl.value = inspoPrompt(item)
    promptEl.dispatchEvent(new Event('input'))
    style = item.style
    ratio = item.ratio
    paintChoices()
    promptEl.focus()
  })

  function openLightbox(id) {
    const list = currentList()
    let index = list.findIndex(row => row.id === id)
    if (index < 0) return
    const cardEl = document.createElement('div')
    cardEl.className = 'lightbox'
    const closeRef = { fn: () => {} }
    const paint = () => {
      const row = list[index]
      cardEl.innerHTML = `
        <button class="lb-close" data-lb="close" aria-label="关闭">${icon('x', 18)}</button>
        <button class="lb-nav lb-prev" data-lb="prev" aria-label="上一张">${icon('chevronLeft', 22)}</button>
        <button class="lb-nav lb-next" data-lb="next" aria-label="下一张">${icon('chevronRight', 22)}</button>
        <figure class="lb-figure"><img src="${fileUrl(row.file)}" alt="${esc(row.prompt)}"></figure>
        <aside class="lb-side">
          <span class="eyebrow">${esc(t('作品详情', 'DETAILS'))}</span>
          <h3>${esc(styleName(row.style) || t('未命名', 'Untitled'))}</h3>
          <p class="lb-prompt">${esc(row.prompt)}</p>
          <div class="lb-meta">
            <div><span>${esc(t('模型', 'Model'))}</span><b>${esc(row.model || '—')}</b></div>
            <div><span>${esc(t('尺寸', 'Size'))}</span><b>${row.width ? `${row.width} × ${row.height}` : esc(row.size || '—')}</b></div>
            <div><span>${esc(t('时间', 'Time'))}</span><b>${esc(fmtTime(row.createdAt))}</b></div>
          </div>
          <div class="lb-actions">
            <button class="btn btn-primary" data-lb="download">${icon('download', 15)}${esc(t('下载', 'Download'))}</button>
            <button class="btn btn-ghost" data-lb="fav">${icon('heart', 15)}${row.favorite ? t('取消收藏', 'Unsave') : t('收藏', 'Save')}</button>
            <button class="btn btn-ghost" data-lb="copy">${icon('copy', 15)}${esc(t('复制提示词', 'Copy prompt'))}</button>
            <button class="btn btn-ghost" data-lb="reuse">${icon('refresh', 15)}${esc(t('用它再画', 'Use again'))}</button>
          </div>
          <p class="fine">${esc(`${index + 1} / ${list.length}`)}</p>
        </aside>`
      cardEl.querySelectorAll('[data-lb]').forEach(btn => {
        btn.addEventListener('click', async () => {
          const act = btn.dataset.lb
          if (act === 'close') return closeRef.fn()
          if (act === 'prev') { index = (index - 1 + list.length) % list.length; paint(); return }
          if (act === 'next') { index = (index + 1) % list.length; paint(); return }
          if (act === 'download') { downloadUrl(fileUrl(row.file), `modern-media-${row.id}.png`); return }
          if (act === 'copy') { await copyText(row.prompt); app.toast(t('已复制', 'Copied'), 'success'); return }
          if (act === 'reuse') {
            promptEl.value = row.prompt
            promptEl.dispatchEvent(new Event('input'))
            if (row.style && STYLES.includes(row.style)) style = row.style
            paintChoices()
            closeRef.fn()
            promptEl.focus()
            return
          }
          if (act === 'fav') {
            try {
              await api('image/action', { id: row.id, action: 'favorite' })
              await app.refresh()
              const fresh = (app.state.images ?? []).find(item => item.id === row.id)
              if (fresh) list[index] = fresh
              paint()
            } catch (err) { app.toast(err.message, 'error') }
          }
        })
      })
    }
    paint()
    const onKey = event => {
      if (event.key === 'Escape') closeRef.fn()
      if (event.key === 'ArrowLeft') { index = (index - 1 + list.length) % list.length; paint() }
      if (event.key === 'ArrowRight') { index = (index + 1) % list.length; paint() }
    }
    document.addEventListener('keydown', onKey)
    closeRef.fn = app.showLayer(cardEl, { className: 'layer-lightbox', onClose: () => document.removeEventListener('keydown', onKey) })
  }

  async function generate() {
    if (busy) return
    const prompt = promptEl.value.trim()
    if (!prompt) {
      promptEl.focus()
      return app.toast(t('先写一句提示词', 'Write a prompt first'), 'error')
    }
    if (!app.settings?.imageReady) {
      app.toast(t('先配置生图服务', 'Configure an image provider first'), 'error')
      return app.navigate('settings')
    }
    busy = true
    const btn = $('#generate')
    btn.classList.add('is-busy')
    btn.querySelector('.gen-label').textContent = t('正在提交…', 'Sending…')
    try {
      await api('image/generate', {
        prompt,
        style: style || '',
        ratio,
        count,
        quality: $('#quality').value,
        negative: $('#negative').value.trim(),
        reference: reference?.name ?? '',
      })
      api('preferences', { imageStyle: style, imageRatio: ratio, imageCount: count }).catch(() => {})
      app.toast(t(`已提交 ${count} 张，稍等片刻`, `Queued ${count} image(s)`), 'success')
      await app.refresh()
    } catch (err) {
      app.toast(err.message, 'error')
    } finally {
      busy = false
      btn.classList.remove('is-busy')
      btn.querySelector('.gen-label').textContent = t('开始生成', 'Generate')
    }
  }

  function update() {
    renderProvider()
    renderGallery()
  }

  update()

  return {
    update,
    unmount() {
      /* 事件都挂在将被替换的节点上 */
    },
  }
}
