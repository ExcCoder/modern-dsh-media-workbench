import { api, fileUrl, upload, uploadForm } from '../lib/api.js'
import { $, $$, autoGrow, copyImage, copyText, downloadUrl, esc, fmtTime, modKey } from '../lib/dom.js'
import { icon } from '../lib/icons.js'
import { app, t } from '../lib/state.js'
import { INSPIRATIONS, RATIOS, STYLE_LABELS_EN, STYLES } from '../lib/constants.js'

export function mount(root) {
  const prefs = app.state?.preferences ?? {}
  let style = prefs.imageStyle ?? '电影感'
  let ratio = RATIOS.some(r => r.id === prefs.imageRatio) ? prefs.imageRatio : '16:9'
  let count = Math.min(4, Math.max(1, Number(prefs.imageCount) || 1))
  let references = []
  let filter = 'all'
  let query = ''
  let busy = false

  const styleName = value => (app.lang === 'en' ? (STYLE_LABELS_EN[value] ?? value) : value)
  const inspoTitle = item => (app.lang === 'en' ? item.titleEn : item.title)
  const inspoPrompt = item => (app.lang === 'en' ? item.promptEn : item.prompt)

  let imageMenu = null
  let imageMenuOff = null

  function closeImageMenu() {
    if (imageMenu) imageMenu.remove()
    imageMenu = null
    imageMenuOff?.()
    imageMenuOff = null
  }

  function showImageMenu(event, row) {
    if (!row?.file) return
    closeImageMenu()
    const menu = document.createElement('div')
    menu.className = 'image-menu'
    menu.setAttribute('role', 'menu')
    menu.innerHTML = `
      <button type="button" role="menuitem" data-image-menu="copy">${icon('copy', 14)}${esc(t('复制图片', 'Copy image'))}</button>
      <button type="button" role="menuitem" data-image-menu="download">${icon('download', 14)}${esc(t('下载原图', 'Download original'))}</button>
      <button type="button" role="menuitem" data-image-menu="reveal">${icon('folder', 14)}${esc(t('打开文件所在目录', 'Open containing folder'))}</button>
      <span class="image-menu-sep"></span>
      <button type="button" role="menuitem" data-image-menu="edit">${icon('wand', 14)}${esc(t('局部重绘 / 扩图', 'Repaint / Outpaint'))}</button>
      <button type="button" role="menuitem" data-image-menu="prompt">${icon('pen', 14)}${esc(t('复制提示词', 'Copy prompt'))}</button>
    `
    document.body.appendChild(menu)
    const box = menu.getBoundingClientRect()
    menu.style.left = `${Math.max(8, Math.min(event.clientX, innerWidth - box.width - 8))}px`
    menu.style.top = `${Math.max(8, Math.min(event.clientY, innerHeight - box.height - 8))}px`
    imageMenu = menu

    const onOutside = next => {
      if (!menu.contains(next.target)) closeImageMenu()
    }
    const onKey = next => { if (next.key === 'Escape') closeImageMenu() }
    const onScroll = () => closeImageMenu()
    window.addEventListener('pointerdown', onOutside, true)
    window.addEventListener('keydown', onKey)
    window.addEventListener('scroll', onScroll, true)
    window.addEventListener('blur', onScroll)
    imageMenuOff = () => {
      window.removeEventListener('pointerdown', onOutside, true)
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('scroll', onScroll, true)
      window.removeEventListener('blur', onScroll)
    }

    menu.querySelectorAll('[data-image-menu]').forEach(button => {
      button.addEventListener('click', async () => {
        const action = button.dataset.imageMenu
        closeImageMenu()
        try {
          if (action === 'copy') {
            await copyImage(fileUrl(row.file))
            app.toast(t('图片已复制到剪贴板', 'Image copied to clipboard'), 'success')
          } else if (action === 'download') {
            downloadUrl(fileUrl(row.file), `modern-media-${row.id}${row.file?.match(/\.\w+$/)?.[0] ?? '.png'}`)
          } else if (action === 'reveal') {
            await api('reveal', { file: row.file })
          } else if (action === 'edit') {
            setCreateMode(createMode === 'generate' ? 'inpaint' : createMode)
            addSource({ name: row.file, url: fileUrl(row.file) })
            app.toast(t('已加入源图，点「编辑当前选中」打开画布', 'Added as source; use Edit selected to open the canvas'), 'success')
          } else if (action === 'prompt') {
            const ok = await copyText(row.prompt)
            app.toast(ok ? t('提示词已复制', 'Prompt copied') : t('复制失败', 'Copy failed'), ok ? 'success' : 'error')
          }
        } catch (err) {
          app.toast(err.message || t('复制失败', 'Copy failed'), 'error')
        }
      })
    })
  }

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
        <div class="field">
          <span class="field-label">${esc(t('创作方式', 'Mode'))}</span>
          <div class="seg seg-mode" id="create-mode">
            <button type="button" data-mode="generate" class="is-on">${esc(t('生成', 'Generate'))}</button>
            <button type="button" data-mode="edit">${esc(t('编辑', 'Edit'))}</button>
            <button type="button" data-mode="outpaint">${esc(t('扩图', 'Outpaint'))}</button>
            <button type="button" data-mode="inpaint">${esc(t('局部重绘', 'Inpaint'))}</button>
          </div>
          <p class="fine" id="mode-hint">${esc(t('从提示词生成新图片，参考图为可选。', 'Generate a new image from a prompt; references are optional.'))}</p>
        </div>
        <div class="source-panel" id="source-panel" hidden>
          <div class="source-panel-head">
            <span class="field-label">${esc(t('源图', 'Source'))}</span>
            <span class="source-badge" id="source-badge">0 ${esc(t('张源图已就绪', 'ready'))}</span>
          </div>
          <div class="source-drop" id="source-drop" tabindex="0" role="button" aria-label="${esc(t('添加源图', 'Add source'))}">
            <div class="source-empty" id="source-empty">
              ${icon('upload', 16)}
              <span>${esc(t('拖入、选择或 Ctrl+V 粘贴', 'Drop, choose or paste (Ctrl+V)'))}</span>
              <small>${esc(t('支持 PNG / JPG / WebP', 'PNG / JPG / WebP'))}</small>
            </div>
            <div class="source-list" id="source-list"></div>
          </div>
          <div class="source-actions">
            <button type="button" class="btn btn-small btn-ghost" id="source-local">${icon('upload', 13)}${esc(t('本地文件', 'Local file'))}</button>
            <button type="button" class="btn btn-small btn-ghost" id="source-library">${icon('image', 13)}${esc(t('从作品库', 'From library'))}</button>
            <button type="button" class="btn btn-small btn-ghost" id="source-canvas">${icon('edit', 13)}${esc(t('编辑当前选中', 'Edit selected'))}</button>
          </div>
          <p class="fine" id="source-hint">${esc(t('每张源图单独提交，各自带自己的蒙版和扩边。', 'Each source is submitted on its own with its own mask and expand.'))}</p>
          <input type="file" id="source-file" accept="image/png,image/jpeg,image/webp" multiple hidden>
        </div>
        <label class="field field-prompt">
          <span class="field-label"><span id="prompt-label">${esc(t('提示词', 'Prompt'))}</span><em id="prompt-count">0</em></span>
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
            <div class="drop ref-drop" id="drop" tabindex="0" role="button" aria-label="${esc(t('上传参考图', 'Upload reference'))}">
              <input type="file" id="ref-input" accept="image/png,image/jpeg,image/webp" multiple hidden>
              <div class="drop-empty" id="ref-empty">${icon('upload', 18)}<span>${esc(t('拖入、选择或 Ctrl+V 粘贴参考图', 'Drop, choose or paste (Ctrl+V) reference images'))}</span><small>${esc(t('最多 8 张，按顺序对应图一、图二', 'Up to 8 images, ordered as figure 1, 2…'))}</small></div>
              <div class="ref-list" id="ref-list"></div>
            </div>
            <label class="field">
              <span class="field-label">${esc(t('反向提示词', 'Negative prompt'))}</span>
              <textarea id="negative" rows="2" maxlength="800" placeholder="${esc(t('不想要的内容，例如：文字、水印、多余的手指', 'Things to avoid, e.g. text, watermark, extra fingers'))}"></textarea>
            </label>
          </div>
        </details>
        <div class="composer-foot">
          <button class="btn btn-generate" id="generate">
            <span class="gen-ic">${icon('spark', 17)}</span>
            <span class="gen-label">${esc(t('开始生成', 'Generate'))}</span>
            <kbd>${modKey()} ↵</kbd>
          </button>
          <p class="fine">${esc(t('图片自动存进本机作品库，不会上传到别处。', 'Images stay on this machine in your local library.'))}</p>
        </div>
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

  // ---- 创作方式与源图 ----
  let createMode = 'generate'
  let sources = []
  let sourceIndex = 0

  const MODE_HINT = {
    generate: ['从提示词生成新图片，参考图为可选。', 'Generate a new image from a prompt; references are optional.'],
    edit: ['修改整张源图，可以加多张源图分别改。', 'Rewrite a whole source image; add several sources to edit them one by one.'],
    outpaint: ['在画布上给源图扩边，扩出来的区域由模型补全。', 'Extend the canvas on a source; the model fills the new border.'],
    inpaint: ['在画布涂红需要修改的区域，再进行精准重绘。', 'Paint red over the area to change, then repaint just that part.'],
  }
  const MODE_LABEL = {
    generate: ['提示词', 'Prompt'],
    edit: ['修改要求', 'Change request'],
    outpaint: ['修改要求', 'Change request'],
    inpaint: ['修改要求', 'Change request'],
  }

  function isEditMode() { return createMode !== 'generate' }

  function renderSources() {
    const list = $('#source-list')
    if (!list) return
    const badge = $('#source-badge')
    if (badge) badge.textContent = `${sources.length} ${t('张源图已就绪', 'ready')}`
    const empty = $('#source-empty')
    if (empty) empty.hidden = sources.length > 0
    list.innerHTML = sources.map((item, index) => `
      <div class="source-item ${index === sourceIndex ? 'is-on' : ''}" data-source-index="${index}">
        <span class="source-no">${esc(t('源图', 'Source'))} ${index + 1}</span>
        <img src="${esc(item.url)}" alt="">
        <span class="source-name">${esc(item.name || '')}</span>
        ${item.hasMask ? `<span class="source-tag">${esc(t('蒙版', 'mask'))}</span>` : ''}
        ${item.expand && (item.expand.l || item.expand.r || item.expand.t || item.expand.b) ? `<span class="source-tag">${esc(t('扩边', 'expand'))}</span>` : ''}
        <button type="button" class="mini-x" data-source-remove="${index}" aria-label="${esc(t('移除', 'Remove'))}">${icon('x', 11)}</button>
      </div>`).join('')
  }

  function addSource(item) {
    sources.push({ ...item, hasMask: false, expand: null })
    sourceIndex = sources.length - 1
    renderSources()
  }

  /** 从剪贴板、拖拽或文件选择拿到的一组图片，逐个上传成源图 */
  async function addSourceFiles(files) {
    const images = [...(files ?? [])].filter(file => file?.type?.startsWith('image/'))
    if (!images.length) return
    let added = 0
    for (const file of images) {
      try {
        const result = await upload(file)
        addSource({ name: file.name || `paste-${Date.now()}.png`, url: result.url })
        added++
      } catch (err) {
        app.toast(err.message, 'error')
      }
    }
    if (added) app.toast(t(`已加入 ${added} 张源图`, `Added ${added} source(s)`), 'success')
  }

  function pickSourceFiles() {
    const input = $('#source-file')
    if (input) input.click()
  }

  function setCreateMode(next) {
    createMode = next
    $$('#create-mode [data-mode]').forEach(btn => btn.classList.toggle('is-on', btn.dataset.mode === createMode))
    $('#source-panel').hidden = !isEditMode()
    const hint = MODE_HINT[createMode]
    $('#mode-hint').textContent = t(hint[0], hint[1])
    const label = MODE_LABEL[createMode]
    $('#prompt-label').textContent = t(label[0], label[1])
    const genLabel = {
      generate: t('开始生成', 'Generate'),
      edit: t('开始编辑', 'Edit'),
      outpaint: t('开始扩图', 'Outpaint'),
      inpaint: t('开始局部重绘', 'Inpaint'),
    }[createMode]
    $('#generate .gen-label').textContent = genLabel
    promptEl.placeholder = isEditMode()
      ? t('想怎么改这张图？例如把白盒改成可交互的游戏平台', 'How should this image change? For example, make the white box interactive')
      : t('描述主体、构图、光线、材质，以及不想出现的东西…', 'Describe subject, composition, light, material — and what to avoid…')
  }

  $('#create-mode').addEventListener('click', event => {
    const btn = event.target.closest('[data-mode]')
    if (!btn) return
    setCreateMode(btn.dataset.mode)
  })

  $('#source-list').addEventListener('click', event => {
    const remove = event.target.closest('[data-source-remove]')
    if (remove) {
      const index = Number(remove.dataset.sourceRemove)
      sources.splice(index, 1)
      if (sourceIndex >= sources.length) sourceIndex = Math.max(0, sources.length - 1)
      renderSources()
      return
    }
    const item = event.target.closest('[data-source-index]')
    if (!item) return
    sourceIndex = Number(item.dataset.sourceIndex)
    renderSources()
  })

  const sourceDrop = $('#source-drop')
  sourceDrop.addEventListener('click', event => {
    if (event.target.closest('.source-item')) return
    pickSourceFiles()
  })
  sourceDrop.addEventListener('keydown', event => {
    if (event.target.closest('.source-item')) return
    if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); pickSourceFiles() }
  })
  for (const type of ['dragenter', 'dragover']) {
    sourceDrop.addEventListener(type, event => { event.preventDefault(); sourceDrop.classList.add('is-over') })
  }
  for (const type of ['dragleave', 'drop']) {
    sourceDrop.addEventListener(type, event => { event.preventDefault(); sourceDrop.classList.remove('is-over') })
  }
  sourceDrop.addEventListener('drop', event => {
    addSourceFiles(event.dataTransfer?.files)
  })

  $('#source-local').addEventListener('click', pickSourceFiles)
  $('#source-library').addEventListener('click', async () => {
    const picked = await pickFromLibrary()
    if (picked) addSource(picked)
  })
  $('#source-file').addEventListener('change', async event => {
    await addSourceFiles(event.target.files)
    event.target.value = ''
  })
  $('#source-canvas').addEventListener('click', async () => {
    const source = sources[sourceIndex]
    if (!source) return app.toast(t('先添加一张源图', 'Add a source image first'), 'error')
    try {
      const { openCanvasEditor } = await import('./image-editor.js')
      await openCanvasEditor({
        source: { name: source.name, url: source.url },
        mask: source.mask ?? null,
        expand: source.expand ?? null,
        onApply: result => {
          source.mask = result.mask
          source.expand = result.expand
          source.hasMask = true
          renderSources()
          app.toast(t('已应用蒙版和扩边', 'Mask and expand applied'), 'success')
        },
      })
    } catch (err) {
      app.toast(err.message, 'error')
    }
  })

  /** 从作品库里挑一张图当源图 */
  function pickFromLibrary() {
    return new Promise(resolve => {
      const rows = (app.state?.images ?? []).filter(row => row.file && row.status === 'done')
      if (!rows.length) {
        app.toast(t('作品库里还没有图', 'No finished images yet'), 'error')
        resolve(null)
        return
      }
      const card = document.createElement('div')
      card.className = 'dialog dialog-wide'
      card.innerHTML = `
        <h3>${esc(t('选一张源图', 'Pick a source image'))}</h3>
        <div class="picker-grid">${rows.map(row => `<button type="button" data-pick="${row.id}"><img src="${fileUrl(row.file)}" alt=""><span>${esc((row.prompt || t('未命名', 'Untitled')).slice(0, 18))}</span></button>`).join('')}</div>
        <div class="dialog-actions"><button class="btn btn-ghost" data-act="cancel">${esc(t('取消', 'Cancel'))}</button></div>`
      let close = () => {}
      card.querySelectorAll('[data-pick]').forEach(btn => {
        btn.addEventListener('click', () => {
          const row = rows.find(item => item.id === btn.dataset.pick)
          close()
          resolve(row ? { name: row.file, url: fileUrl(row.file), row } : null)
        })
      })
      card.querySelector('[data-act="cancel"]').addEventListener('click', () => { close(); resolve(null) })
      close = app.showLayer(card, { className: 'layer-dialog' })
    })
  }

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

  // 参考图队列：最多 8 张，可粘贴、拖入、排序
  const refInput = $('#ref-input')
  const drop = $('#drop')
  const refList = $('#ref-list')
  const refEmpty = $('#ref-empty')
  const pickRef = () => refInput.click()

  function renderReferences() {
    const label = index => app.lang === 'en' ? `Fig. ${index + 1}` : `图${'一二三四五六七八'[index] ?? index + 1}`
    refEmpty.hidden = references.length > 0
    refList.innerHTML = references.map((ref, index) => `
      <figure class="ref-item" data-ref-index="${index}">
        <img src="${esc(ref.url)}" alt="${esc(label(index))}">
        <span class="ref-badge">${esc(label(index))}</span>
        <span class="ref-tools">
          <button type="button" data-ref-act="up" title="${esc(t('上移', 'Move up'))}" ${index === 0 ? 'disabled' : ''}>↑</button>
          <button type="button" data-ref-act="down" title="${esc(t('下移', 'Move down'))}" ${index === references.length - 1 ? 'disabled' : ''}>↓</button>
          <button type="button" data-ref-act="remove" title="${esc(t('移除', 'Remove'))}">${icon('x', 11)}</button>
        </span>
      </figure>`).join('')
  }

  async function addReferences(files) {
    const images = [...files].filter(file => file?.type?.startsWith('image/'))
    if (!images.length) return
    const room = 8 - references.length
    if (room <= 0) return app.toast(t('最多 8 张参考图', 'Up to 8 references'), 'error')
    for (const file of images.slice(0, room)) {
      try {
        const result = await upload(file)
        references.push(result)
        renderReferences()
      } catch (err) {
        app.toast(err.message, 'error')
      }
    }
    if (images.length > room) app.toast(t('最多 8 张参考图，多出的已忽略', 'Up to 8 references; extras ignored'), 'error')
  }

  renderReferences()
  drop.addEventListener('click', event => {
    if (event.target.closest('.ref-item')) return
    pickRef()
  })
  drop.addEventListener('keydown', event => {
    if (event.target.closest('.ref-item')) return
    if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); pickRef() }
  })
  refInput.addEventListener('change', async () => {
    await addReferences([...(refInput.files ?? [])])
    refInput.value = ''
  })
  for (const type of ['dragenter', 'dragover']) {
    drop.addEventListener(type, event => { event.preventDefault(); drop.classList.add('is-over') })
  }
  for (const type of ['dragleave', 'drop']) {
    drop.addEventListener(type, event => { event.preventDefault(); drop.classList.remove('is-over') })
  }
  drop.addEventListener('drop', event => {
    addReferences([...(event.dataTransfer?.files ?? [])])
  })
  refList.addEventListener('click', event => {
    const button = event.target.closest('[data-ref-act]')
    if (!button) return
    event.stopPropagation()
    const index = Number(button.closest('.ref-item')?.dataset.refIndex)
    if (!Number.isInteger(index) || !references[index]) return
    if (button.dataset.refAct === 'remove') references.splice(index, 1)
    if (button.dataset.refAct === 'up' && index > 0) {
      [references[index - 1], references[index]] = [references[index], references[index - 1]]
    }
    if (button.dataset.refAct === 'down' && index < references.length - 1) {
      [references[index + 1], references[index]] = [references[index], references[index + 1]]
    }
    renderReferences()
  })

  function onPaste(event) {
    if (!drop.isConnected) {
      document.removeEventListener('paste', onPaste)
      return
    }
    const files = [...(event.clipboardData?.items ?? [])]
      .filter(item => item.type.startsWith('image/'))
      .map(item => item.getAsFile())
      .filter(Boolean)
    if (!files.length) return
    event.preventDefault()
    // 编辑类模式粘贴进源图，生成模式粘贴进参考图
    if (isEditMode()) addSourceFiles(files)
    else addReferences(files)
  }
  document.addEventListener('paste', onPaste)

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
          <button type="button" data-act="edit" data-id="${row.id}">${icon('wand', 13)}${esc(t('重绘', 'Repaint'))}</button>
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

  async function reuseImage(row) {
    const original = (Array.isArray(row.references) && row.references.length ? row.references : row.reference ? [row.reference] : [])
      .filter(name => typeof name === 'string' && name)
      .slice(0, 8)
    let usedReferences = false
    if (original.length) {
      const useReferences = await app.confirm({
        title: t('这张图带了参考图', 'This image has references'),
        message: t(
          `这张图用了 ${original.length} 张参考图。要一起复用吗？选「覆盖参考图」会替换当前队列；选「只用提示词」会保留当前参考图。`,
          `This image used ${original.length} reference image(s). Reuse them too? Choose "Use references" to replace the current queue, or "Prompt only" to keep what you have.`,
        ),
        confirmText: t('覆盖参考图', 'Use references'),
        cancelText: t('只用提示词', 'Prompt only'),
      })
      if (useReferences) {
        references = original.map(name => ({ name, url: fileUrl(name) }))
        renderReferences()
        usedReferences = true
      }
    } else {
      references = []
      renderReferences()
    }
    promptEl.value = row.prompt
    promptEl.dispatchEvent(new Event('input'))
    if (row.style && STYLES.includes(row.style)) style = row.style
    if (row.size?.includes('x')) {
      const match = RATIOS.find(item => item.hint.replaceAll(' × ', 'x') === row.size)
      if (match) ratio = match.id
    }
    paintChoices()
    promptEl.focus()
    app.toast(
      usedReferences ? t('已复用提示词和参考图', 'Prompt and references loaded') : t('已复用提示词', 'Prompt loaded'),
      'success',
    )
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
      await reuseImage(row)
      return
    }
    if (act === 'edit') {
      try {
        setCreateMode(createMode === 'generate' ? 'inpaint' : createMode)
        addSource({ name: row.file, url: fileUrl(row.file) })
        document.querySelector('.composer')?.scrollTo({ top: 9999, behavior: 'smooth' })
        app.toast(t('已加入源图，点「编辑当前选中」打开画布', 'Added as source; use Edit selected to open the canvas'), 'success')
      } catch (err) { app.toast(err.message, 'error') }
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

  galleryEl.addEventListener('contextmenu', event => {
    const media = event.target.closest('.shot-media')
    const image = event.target.closest('.shot-media img')
    if (!media || !image) return
    const row = (app.state?.images ?? []).find(item => item.id === media.closest('.shot')?.dataset.id)
    if (!row) return
    event.preventDefault()
    showImageMenu(event, row)
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
            <button class="btn btn-ghost" data-lb="edit">${icon('wand', 15)}${esc(t('重绘 / 扩图', 'Repaint / Outpaint'))}</button>
            <button class="btn btn-ghost" data-lb="copy-image">${icon('copy', 15)}${esc(t('复制图片', 'Copy image'))}</button>
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
          if (act === 'copy-image') {
            try {
              await copyImage(fileUrl(row.file))
              app.toast(t('图片已复制到剪贴板', 'Image copied to clipboard'), 'success')
            } catch (err) { app.toast(err.message || t('复制失败', 'Copy failed'), 'error') }
            return
          }
          if (act === 'edit') {
            try {
              closeRef.fn()
              await openEditor(row)
            } catch (err) { app.toast(err.message, 'error') }
            return
          }
          if (act === 'copy') { await copyText(row.prompt); app.toast(t('已复制', 'Copied'), 'success'); return }
          if (act === 'reuse') {
            await reuseImage(row)
            closeRef.fn()
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
      cardEl.querySelector('.lb-figure img')?.addEventListener('contextmenu', event => {
        event.preventDefault()
        showImageMenu(event, list[index])
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

  /** 把一张源图按当前模式送去做编辑，返回合成后的图片 blob */
  async function runSourceEdit(source, prompt) {
    const bitmap = await createImageBitmap(await (await fetch(source.url, { credentials: 'same-origin' })).blob())
    const scale = Math.min(1, 1536 / Math.max(bitmap.width, bitmap.height))
    const width = Math.round(bitmap.width * scale)
    const height = Math.round(bitmap.height * scale)
    const original = document.createElement('canvas')
    original.width = width
    original.height = height
    original.getContext('2d').drawImage(bitmap, 0, 0, width, height)
    bitmap.close?.()

    const expand = source.expand ?? { l: 0, r: 0, t: 0, b: 0 }
    const hasExpand = Boolean(expand.l || expand.r || expand.t || expand.b)
    const mask = source.mask ?? null

    // 编辑模式：整张图重写
    if (createMode === 'edit') {
      const form = new FormData()
      form.set('prompt', prompt)
      form.set('style', style || '')
      form.set('image', await toBlob(original), 'image.png')
      const response = await fetch('/media-workbench-modern/api/image/edit', { method: 'POST', body: form })
      if (!response.ok) throw new Error(await readError(response))
      return { blob: await response.blob(), width, height }
    }

    // 扩图：先把画布撑大，新区域交给模型
    let base = original
    let region = null
    let offsetX = 0
    let offsetY = 0
    if (hasExpand) {
      base = document.createElement('canvas')
      base.width = width + expand.l + expand.r
      base.height = height + expand.t + expand.b
      const ctx = base.getContext('2d')
      ctx.drawImage(original, expand.l, expand.t)
      if (expand.r > 0) ctx.drawImage(original, width - 1, 0, 1, height, expand.l + width, expand.t, expand.r, height)
      if (expand.l > 0) ctx.drawImage(original, 0, 0, 1, height, 0, expand.t, expand.l, height)
      if (expand.b > 0) ctx.drawImage(original, 0, height - 1, width, 1, expand.l, expand.t + height, width, expand.b)
      if (expand.t > 0) ctx.drawImage(original, 0, 0, width, 1, expand.l, 0, width, expand.t)
      offsetX = expand.l
      offsetY = expand.t
      if (expand.r > 0) region = { x: expand.l + width, y: expand.t, w: expand.r, h: height }
      else if (expand.l > 0) region = { x: 0, y: expand.t, w: expand.l, h: height }
      else if (expand.b > 0) region = { x: expand.l, y: expand.t + height, w: width, h: expand.b }
      else region = { x: expand.l, y: 0, w: width, h: expand.t }
    }

    // 局部重绘：按蒙版范围裁一块送去生成，再贴回来
    let crop = base
    let cropRect = { x: 0, y: 0, w: base.width, h: base.height }
    let maskCrop = null
    if (createMode === 'inpaint' && mask) {
      const box = maskBounds(mask)
      if (!box) throw new Error(t('先在画布上涂出要修改的区域', 'Paint the area to change first'))
      const marginX = Math.round(box.w * 0.75)
      const marginY = Math.round(box.h * 0.75)
      const x = Math.max(0, box.x - marginX)
      const y = Math.max(0, box.y - marginY)
      const w = Math.min(base.width - x, box.w + marginX * 2)
      const h = Math.min(base.height - y, box.h + marginY * 2)
      crop = document.createElement('canvas')
      crop.width = w
      crop.height = h
      crop.getContext('2d').drawImage(base, x, y, w, h, 0, 0, w, h)
      cropRect = { x, y, w, h }
      maskCrop = document.createElement('canvas')
      maskCrop.width = w
      maskCrop.height = h
      maskCrop.getContext('2d').drawImage(mask, offsetX + x, offsetY + y, w, h, 0, 0, w, h)
    }

    const form = new FormData()
    form.set('prompt', prompt)
    form.set('style', style || '')
    form.set('image', await toBlob(crop), 'crop.png')
    const response = await fetch('/media-workbench-modern/api/image/edit', { method: 'POST', body: form })
    if (!response.ok) throw new Error(await readError(response))
    const generated = await createImageBitmap(await response.blob())

    // 把生成结果缩放回裁剪区，只在蒙版范围内替换
    const scaled = document.createElement('canvas')
    scaled.width = cropRect.w
    scaled.height = cropRect.h
    scaled.getContext('2d').drawImage(generated, 0, 0, cropRect.w, cropRect.h)
    generated.close?.()

    const finalCanvas = document.createElement('canvas')
    finalCanvas.width = base.width
    finalCanvas.height = base.height
    const finalCtx = finalCanvas.getContext('2d')
    finalCtx.drawImage(base, 0, 0)

    if (maskCrop) {
      const soft = document.createElement('canvas')
      soft.width = cropRect.w
      soft.height = cropRect.h
      const softCtx = soft.getContext('2d')
      softCtx.filter = 'blur(3px)'
      softCtx.drawImage(maskCrop, 0, 0)
      softCtx.filter = 'none'
      const patch = document.createElement('canvas')
      patch.width = cropRect.w
      patch.height = cropRect.h
      const patchCtx = patch.getContext('2d')
      patchCtx.drawImage(scaled, 0, 0)
      patchCtx.globalCompositeOperation = 'destination-in'
      patchCtx.drawImage(soft, 0, 0)
      finalCtx.drawImage(patch, cropRect.x, cropRect.y)
    } else if (region) {
      const patch = document.createElement('canvas')
      patch.width = region.w
      patch.height = region.h
      patch.getContext('2d').drawImage(scaled, region.x - cropRect.x, region.y - cropRect.y, region.w, region.h, 0, 0, region.w, region.h)
      finalCtx.drawImage(patch, region.x, region.y)
    } else {
      finalCtx.drawImage(scaled, 0, 0)
    }
    return { blob: await toBlob(finalCanvas), width: finalCanvas.width, height: finalCanvas.height }
  }

  async function readError(response) {
    try {
      const data = await response.json()
      return data.error || `请求失败（${response.status}）`
    } catch {
      return `请求失败（${response.status}）`
    }
  }

  function toBlob(canvas) {
    return new Promise((resolve, reject) => {
      canvas.toBlob(blob => (blob ? resolve(blob) : reject(new Error('导出失败'))), 'image/png')
    })
  }

  function maskBounds(mask) {
    const ctx = mask.getContext('2d')
    const { width, height } = mask
    const data = ctx.getImageData(0, 0, width, height).data
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        if (data[(y * width + x) * 4 + 3] <= 8) continue
        if (x < minX) minX = x
        if (x > maxX) maxX = x
        if (y < minY) minY = y
        if (y > maxY) maxY = y
      }
    }
    if (minX === Infinity) return null
    return { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 }
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
    if (isEditMode() && !sources.length) {
      return app.toast(t('先添加一张源图', 'Add a source image first'), 'error')
    }
    busy = true
    const btn = $('#generate')
    btn.classList.add('is-busy')
    btn.querySelector('.gen-label').textContent = t('正在提交…', 'Sending…')
    try {
      if (isEditMode()) {
        let done = 0
        for (const source of sources) {
          const result = await runSourceEdit(source, prompt)
          const form = new FormData()
          form.set('file', result.blob, 'edited.png')
          form.set('prompt', prompt)
          form.set('style', style || '')
          form.set('mode', createMode)
          form.set('source', source.name || '')
          form.set('width', String(result.width))
          form.set('height', String(result.height))
          await uploadForm('image/save', form)
          done++
        }
        app.toast(t(`已提交 ${done} 张`, `Submitted ${done} image(s)`), 'success')
      } else {
        await api('image/generate', {
          prompt,
          style: style || '',
          ratio,
          count,
          quality: $('#quality').value,
          negative: $('#negative').value.trim(),
          references: references.map(item => item.name),
        })
        api('preferences', { imageStyle: style, imageRatio: ratio, imageCount: count }).catch(() => {})
        app.toast(t(`已提交 ${count} 张，稍等片刻`, `Queued ${count} image(s)`), 'success')
      }
      await app.refresh()
    } catch (err) {
      app.toast(err.message, 'error')
    } finally {
      busy = false
      btn.classList.remove('is-busy')
      btn.querySelector('.gen-label').textContent = {
        generate: t('开始生成', 'Generate'),
        edit: t('开始编辑', 'Edit'),
        outpaint: t('开始扩图', 'Outpaint'),
        inpaint: t('开始局部重绘', 'Inpaint'),
      }[createMode]
    }
  }

  function update() {
    renderProvider()
    renderGallery()
    renderSources()
  }

  update()

  return {
    update,
    unmount() {
      /* 事件都挂在将被替换的节点上 */
    },
  }
}
