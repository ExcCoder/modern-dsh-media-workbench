import { api, streamWrite } from '../lib/api.js'
import { $, $$, debounce, downloadUrl, esc, fmtTime, wordCount } from '../lib/dom.js'
import { icon } from '../lib/icons.js'
import { app, t } from '../lib/state.js'
import { ACTIONS, LENGTHS, POVS, TONES } from '../lib/constants.js'

export function mount(root) {
  const prefs = app.state?.preferences ?? {}
  let activeDocId = sessionStorage.getItem('media-workbench-modern:doc') || null
  let tone = prefs.writingTone ?? '自然叙述'
  let pov = prefs.writingPov ?? '第三人称'
  let length = prefs.writingLength ?? 'medium'
  let action = 'continue'
  let query = ''
  let dirty = false
  let saving = null
  let selection = { start: 0, end: 0, text: '' }
  let streamController = null
  let resultText = ''
  let resultLabel = ''
  let history = []
  let focusMode = false

  root.innerHTML = `
    <section class="bench bench-write" id="write-bench">
      <aside class="docs-pane">
        <header class="docs-head">
          <div><span class="eyebrow">${esc(t('作品库', 'LIBRARY'))}</span><h2>${esc(t('写作工作台', 'Writing Studio'))}</h2></div>
          <button class="icon-btn" id="new-doc" title="${esc(t('新建作品', 'New document'))}">${icon('plus', 17)}</button>
        </header>
        <label class="search search-wide">${icon('search', 15)}<input id="doc-search" type="search" placeholder="${esc(t('搜索标题或正文', 'Search title or text'))}"></label>
        <div class="docs-list" id="docs-list"></div>
        <footer class="docs-foot"><span id="docs-total">0</span> ${esc(t('篇作品 · 自动保存在本机', 'documents, saved locally'))}</footer>
      </aside>

      <section class="editor-pane">
        <div class="editor-top">
          <input id="doc-title" class="title-input" placeholder="${esc(t('未命名作品', 'Untitled'))}" maxlength="120">
          <div class="editor-meta">
            <span id="word-count">0 ${esc(t('字', 'chars'))}</span>
            <span class="dot-sep"></span>
            <span id="save-state">${esc(t('已保存', 'Saved'))}</span>
            <span class="spacer"></span>
            <button class="text-btn" id="export-doc">${icon('download', 14)}${esc(t('导出', 'Export'))}</button>
            <button class="text-btn" id="focus-mode">${icon('eye', 14)}${esc(t('专注', 'Focus'))}</button>
          </div>
        </div>
        <div class="editor-wrap">
          <textarea id="doc-content" spellcheck="false" placeholder="${esc(t('从这里开始写。写到卡住时，看右边。', 'Start here. When you get stuck, look right.'))}"></textarea>
        </div>
        <div class="editor-foot">
          <span id="selection-info">${esc(t('选中文字可以只改这一段', 'Select text to edit just that part'))}</span>
          <span class="editor-hint">${esc(t('自动保存', 'Autosave'))} · ${esc(t('Markdown', 'Markdown'))}</span>
        </div>
      </section>

      <aside class="ai-pane">
        <header class="ai-head">
          <div><span class="eyebrow">${esc(t('写作搭档', 'AI PARTNER'))}</span><h2>${esc(t('接着写', 'Keep writing'))}</h2></div>
          <span class="model-chip" id="ai-model"></span>
        </header>
        <div class="ai-scroll">
          <div class="ai-section">
            <span class="field-label">${esc(t('想做什么', 'Action'))}</span>
            <div class="ai-actions" id="ai-actions">
              ${ACTIONS.map(item => `<button type="button" class="ai-action" data-action="${item.id}"><b>${esc(item.label)}</b><small>${esc(item.hint)}</small></button>`).join('')}
            </div>
          </div>
          <div class="ai-section">
            <span class="field-label">${esc(t('文风', 'Voice'))}</span>
            <div class="chips chips-tight" id="tones">
              ${TONES.map(item => `<button type="button" class="chip" data-tone="${esc(item)}">${esc(item)}</button>`).join('')}
            </div>
            <div class="row-2">
              <select class="select" id="pov">${POVS.map(item => `<option value="${esc(item)}" ${item === pov ? 'selected' : ''}>${esc(item)}</option>`).join('')}</select>
              <select class="select" id="length">${LENGTHS.map(item => `<option value="${item.id}" ${item.id === length ? 'selected' : ''}>${esc(item.label)}</option>`).join('')}</select>
            </div>
          </div>
          <label class="field">
            <span class="field-label">${esc(t('补充指令', 'Note'))}<em>${esc(t('可选', 'optional'))}</em></span>
            <textarea id="instruction" rows="2" maxlength="600" placeholder="${esc(t('例如：把第三段改得更克制；用第一人称重写', 'e.g. make paragraph three colder; rewrite in first person'))}"></textarea>
          </label>
          <label class="check-line"><input type="checkbox" id="use-selection"> <span>${esc(t('只处理选中文字', 'Only the selection'))}</span></label>
          <button class="btn btn-primary btn-block" id="ai-run">${icon('wandSpark', 16)}<span>${esc(t('开始写', 'Write'))}</span></button>

          <div class="ai-result" id="ai-result" hidden>
            <div class="ai-result-head">
              <b id="result-label">${esc(t('草稿', 'Draft'))}</b>
              <span class="spacer"></span>
              <button class="text-btn" id="ai-stop" hidden>${icon('stop', 13)}${esc(t('停止', 'Stop'))}</button>
            </div>
            <div class="ai-result-body" id="result-body"></div>
            <div class="ai-result-actions">
              <button class="btn btn-small btn-primary" data-apply="append">${esc(t('追加到正文', 'Append'))}</button>
              <button class="btn btn-small btn-ghost" data-apply="replace">${esc(t('替换', 'Replace'))}</button>
              <button class="btn btn-small btn-ghost" data-apply="insert">${esc(t('插入光标', 'Insert'))}</button>
              <button class="btn btn-small btn-ghost" data-apply="copy">${esc(t('复制', 'Copy'))}</button>
              <button class="btn btn-small btn-ghost danger-quiet" data-apply="discard">${esc(t('丢弃', 'Discard'))}</button>
            </div>
          </div>

          <div class="ai-history" id="ai-history"></div>
        </div>
      </aside>
    </section>
  `

  const titleEl = $('#doc-title')
  const contentEl = $('#doc-content')
  const listEl = $('#docs-list')

  const saveLater = debounce(() => { void save() }, 900)

  // ---- 初始化当前文档 ----
  function docs() {
    return app.state?.docs ?? []
  }

  function currentDoc() {
    return docs().find(doc => doc.id === activeDocId) ?? null
  }

  function loadDoc(doc, { focus = false } = {}) {
    activeDocId = doc?.id ?? null
    if (doc) sessionStorage.setItem('media-workbench-modern:doc', doc.id)
    titleEl.value = doc?.title ?? ''
    contentEl.value = doc?.content ?? ''
    dirty = false
    paintSave('saved')
    updateCounts()
    updateSelection()
    paintDocs()
    if (focus) titleEl.focus()
  }

  // 首屏：优先上次打开的，其次最新一篇；都没有就留空等用户输入
  const initial = currentDoc() ?? docs()[0] ?? null
  if (!activeDocId && initial) activeDocId = initial.id
  loadDoc(initial)

  titleEl.addEventListener('input', () => { dirty = true; paintSave('dirty'); saveLater() })
  contentEl.addEventListener('input', () => {
    dirty = true
    paintSave('dirty')
    updateCounts()
    saveLater()
  })
  contentEl.addEventListener('select', updateSelection)
  contentEl.addEventListener('keyup', updateSelection)
  contentEl.addEventListener('mouseup', updateSelection)
  contentEl.addEventListener('click', updateSelection)

  titleEl.addEventListener('keydown', event => {
    if (event.key === 'Enter') { event.preventDefault(); contentEl.focus() }
  })

  $('#new-doc').addEventListener('click', async () => {
    await save(true)
    try {
      const data = await api('document/save', { title: t('未命名作品', 'Untitled'), content: '' })
      app.state.docs.unshift(data.doc)
      loadDoc(data.doc, { focus: true })
      paintDocs()
      app.toast(t('新作品已建好', 'New document created'), 'success')
    } catch (err) { app.toast(err.message, 'error') }
  })

  $('#doc-search').addEventListener('input', () => { query = $('#doc-search').value.trim().toLowerCase(); paintDocs() })

  listEl.addEventListener('click', async event => {
    const item = event.target.closest('[data-doc]')
    const act = event.target.closest('[data-doc-act]')
    if (act) {
      event.stopPropagation()
      const id = act.dataset.id
      const kind = act.dataset.docAct
      if (kind === 'delete') {
        const ok = await app.confirm({ title: t('删除这篇作品？', 'Delete this document?'), message: t('删除后无法从工作台恢复。', 'This cannot be undone in the workbench.'), confirmText: t('删除', 'Delete'), danger: true })
        if (!ok) return
        try {
          await api('document/action', { id, action: 'delete' })
          app.state.docs = app.state.docs.filter(doc => doc.id !== id)
          if (activeDocId === id) loadDoc(app.state.docs[0] ?? null)
          paintDocs()
          app.toast(t('已删除', 'Deleted'), 'success')
        } catch (err) { app.toast(err.message, 'error') }
        return
      }
      if (kind === 'duplicate') {
        try {
          const data = await api('document/action', { id, action: 'duplicate' })
          app.state.docs.unshift(data.doc)
          paintDocs()
          app.toast(t('副本已创建', 'Duplicated'), 'success')
        } catch (err) { app.toast(err.message, 'error') }
      }
      return
    }
    if (!item) return
    const id = item.dataset.doc
    if (id === activeDocId) return
    await save(true)
    const doc = docs().find(row => row.id === id)
    if (doc) loadDoc(doc)
  })

  $('#export-doc').addEventListener('click', () => {
    const title = titleEl.value.trim() || t('未命名作品', 'Untitled')
    const body = `# ${title}\n\n${contentEl.value}`
    const blob = new Blob([body], { type: 'text/markdown;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    downloadUrl(url, `${title.replace(/[/\\:*?"<>|]/g, '_')}.md`)
    setTimeout(() => URL.revokeObjectURL(url), 3000)
  })

  $('#focus-mode').addEventListener('click', () => {
    focusMode = !focusMode
    $('#write-bench').classList.toggle('is-focus', focusMode)
    $('#focus-mode').innerHTML = `${icon('eye', 14)}${focusMode ? t('退出专注', 'Exit focus') : t('专注', 'Focus')}`
    contentEl.focus()
  })

  $('#tones').addEventListener('click', event => {
    const btn = event.target.closest('[data-tone]')
    if (!btn) return
    tone = btn.dataset.tone
    paintTone()
  })
  $('#pov').addEventListener('change', () => { pov = $('#pov').value })
  $('#length').addEventListener('change', () => { length = $('#length').value })
  $('#use-selection').addEventListener('change', updateSelection)
  $('#ai-actions').addEventListener('click', event => {
    const btn = event.target.closest('[data-action]')
    if (!btn) return
    action = btn.dataset.action
    paintAction()
    if (!streamController) run()
  })
  $('#ai-run').addEventListener('click', run)
  $('#ai-stop').addEventListener('click', () => { streamController?.abort() })

  $('#ai-result').addEventListener('click', async event => {
    const btn = event.target.closest('[data-apply]')
    if (!btn) return
    const mode = btn.dataset.apply
    if (mode === 'discard') { hideResult(); return }
    if (mode === 'copy') {
      try { await navigator.clipboard.writeText(resultText); app.toast(t('已复制', 'Copied'), 'success') } catch { app.toast(t('复制失败', 'Copy failed'), 'error') }
      return
    }
    if (!resultText) return
    if (mode === 'replace' && !selection.text) {
      const ok = await app.confirm({ title: t('替换整篇正文？', 'Replace the whole manuscript?'), message: t('当前正文会被这段草稿替换。', 'The current text will be replaced by this draft.'), confirmText: t('替换', 'Replace'), danger: true })
      if (!ok) return
    }
    applyText(mode)
    hideResult()
  })

  function paintTone() {
    $$('#tones [data-tone]').forEach(btn => btn.classList.toggle('is-on', btn.dataset.tone === tone))
  }
  paintTone()

  function paintAction() {
    $$('#ai-actions [data-action]').forEach(btn => btn.classList.toggle('is-on', btn.dataset.action === action))
    const hints = {
      rewrite: t('例如：把语气改得更克制，去掉形容词', 'e.g. colder tone, fewer adjectives'),
      custom: t('写下你想怎么改', 'Describe the change'),
      outline: t('可选：想强调什么', 'Optional: what to emphasize'),
      title: t('可选：面向谁、什么平台', 'Optional: audience or platform'),
    }
    $('#instruction').placeholder = hints[action] ?? t('可选：补充你的要求', 'Optional: any extra direction')
  }
  paintAction()

  function updateCounts() {
    const chars = [...contentEl.value].length
    const words = wordCount(contentEl.value)
    $('#word-count').textContent = app.lang === 'en' ? `${words} words` : `${chars} 字`
  }

  function updateSelection() {
    const start = contentEl.selectionStart ?? 0
    const end = contentEl.selectionEnd ?? 0
    selection = { start, end, text: contentEl.value.slice(start, end) }
    const info = $('#selection-info')
    if (selection.text) {
      info.textContent = t(`已选中 ${[...selection.text].length} 字 · 可以只改这一段`, `${[...selection.text].length} chars selected`)
    } else {
      info.textContent = t('选中文字可以只改这一段', 'Select text to edit just that part')
    }
    const checkbox = $('#use-selection')
    if (!selection.text && checkbox.checked) checkbox.checked = false
    if (selection.text && !checkbox.checked && document.activeElement === contentEl) checkbox.checked = false
  }

  function paintSave(mode) {
    const el = $('#save-state')
    if (!el) return
    if (mode === 'saving') { el.textContent = t('正在保存…', 'Saving…'); el.className = 'save-state is-saving' }
    else if (mode === 'dirty') { el.textContent = t('未保存', 'Unsaved'); el.className = 'save-state is-dirty' }
    else if (mode === 'error') { el.textContent = t('保存失败', 'Save failed'); el.className = 'save-state is-error' }
    else { el.textContent = t('已保存', 'Saved'); el.className = 'save-state' }
  }

  function paintDocs() {
    const all = docs()
    const filtered = all.filter(doc => !query || `${doc.title}\n${doc.content}`.toLowerCase().includes(query))
    $('#docs-total').textContent = String(all.length)
    if (!filtered.length) {
      listEl.innerHTML = `<div class="docs-empty">${esc(all.length ? t('没有匹配的作品', 'No matching documents') : t('还没有作品，点右上角新建。', 'No documents yet. Create one above.'))}</div>`
      return
    }
    listEl.innerHTML = filtered.map(doc => {
      const isOn = doc.id === activeDocId
      const excerpt = doc.content.replace(/\s+/g, ' ').slice(0, 46)
      return `<article class="doc-item ${isOn ? 'is-on' : ''}" data-doc="${doc.id}" tabindex="0" role="button">
        <div class="doc-item-top"><b>${esc(doc.title || t('未命名作品', 'Untitled'))}</b><time>${esc(fmtTime(doc.updatedAt))}</time></div>
        <p>${esc(excerpt || t('还没有内容', 'Empty'))}</p>
        <div class="doc-item-actions">
          <button type="button" data-doc-act="duplicate" data-id="${doc.id}" title="${esc(t('创建副本', 'Duplicate'))}">${icon('duplicate', 12)}</button>
          <button type="button" data-doc-act="delete" data-id="${doc.id}" title="${esc(t('删除', 'Delete'))}">${icon('trash', 12)}</button>
        </div>
      </article>`
    }).join('')
  }

  async function save(force = false) {
    if (!force && !dirty) return null
    const title = titleEl.value.trim() || t('未命名作品', 'Untitled')
    const content = contentEl.value
    paintSave('saving')
    try {
      const data = await api('document/save', { id: activeDocId ?? '', title, content })
      activeDocId = data.doc.id
      sessionStorage.setItem('media-workbench-modern:doc', activeDocId)
      const index = app.state.docs.findIndex(doc => doc.id === activeDocId)
      if (index >= 0) app.state.docs[index] = data.doc
      else app.state.docs.unshift(data.doc)
      dirty = false
      paintSave('saved')
      paintDocs()
      return data.doc
    } catch (err) {
      paintSave('error')
      app.toast(err.message, 'error')
      return null
    }
  }

  function applyText(mode) {
    if (mode === 'append') {
      const base = contentEl.value.replace(/\s+$/, '')
      contentEl.value = base ? `${base}\n\n${resultText}` : resultText
    } else if (mode === 'replace') {
      if (selection.text) contentEl.setRangeText(resultText, selection.start, selection.end, 'end')
      else contentEl.value = resultText
    } else if (mode === 'insert') {
      const at = contentEl.selectionStart ?? contentEl.value.length
      contentEl.setRangeText(resultText, at, at, 'end')
    }
    contentEl.dispatchEvent(new Event('input'))
    contentEl.focus()
  }

  function hideResult() {
    resultText = ''
    $('#ai-result').hidden = true
    $('#result-body').textContent = ''
  }

  function paintResultLabel() {
    const item = ACTIONS.find(row => row.id === action)
    $('#result-label').textContent = `${item?.label ?? t('草稿', 'Draft')} · ${fmtTime(new Date().toISOString())}`
  }

  async function run() {
    if (streamController) { app.toast(t('正在写，等这一段落完', 'Still writing — wait for it to finish'), 'info'); return }
    if (!app.model && !app.settings?.writingReady) {
      app.toast(t('当前没有写作模型。先在 DSH 里选一个模型，或者去设置里配一个写作供应商。', 'No writing model. Choose one in DSH, or configure a writing provider in settings.'), 'error')
      return
    }
    if (action === 'rewrite' && !$('#instruction').value.trim() && !selection.text) {
      // 允许直接改写，但给一句默认指令
    }
    const useSelection = $('#use-selection').checked
    if (useSelection && !selection.text) {
      app.toast(t('先选中一段文字', 'Select some text first'), 'error')
      return
    }
    if (!contentEl.value.trim() && action !== 'outline' && action !== 'title' && action !== 'custom') {
      app.toast(t('正文还是空的，先写一句', 'The manuscript is empty — write a line first'), 'error')
      contentEl.focus()
      return
    }
    const controller = new AbortController()
    streamController = controller
    resultText = ''
    const result = $('#ai-result')
    result.hidden = false
    const body = $('#result-body')
    body.textContent = ''
    body.classList.add('is-streaming')
    paintResultLabel()
    $('#ai-stop').hidden = false
    $('#ai-run').disabled = true
    $('#ai-run').querySelector('span').textContent = t('正在写…', 'Writing…')
    try {
      const data = await streamWrite({
        action,
        title: titleEl.value,
        content: contentEl.value,
        selection: useSelection ? selection.text : '',
        instruction: $('#instruction').value.trim(),
        tone,
        pov,
        length,
        lang: app.lang,
      }, {
        signal: controller.signal,
        onDelta: (_delta, full) => {
          resultText = full
          body.textContent = full
          body.scrollTop = body.scrollHeight
        },
      })
      resultText = data.text || resultText
      body.textContent = resultText
      history.unshift({ action, text: resultText, at: new Date().toISOString(), model: data.model })
      history = history.slice(0, 6)
      paintHistory()
      app.toast(t('写完了', 'Draft ready'), 'success')
    } catch (err) {
      if (controller.signal.aborted) {
        app.toast(t('已停止', 'Stopped'), 'info')
      } else {
        body.textContent = err.message
        body.classList.add('is-error')
        app.toast(err.message, 'error')
      }
    } finally {
      streamController = null
      body.classList.remove('is-streaming')
      $('#ai-stop').hidden = true
      $('#ai-run').disabled = false
      $('#ai-run').querySelector('span').textContent = t('开始写', 'Write')
      if (!resultText) result.hidden = true
    }
  }

  function paintHistory() {
    const host = $('#ai-history')
    if (!history.length) { host.innerHTML = ''; return }
    host.innerHTML = `<span class="field-label">${esc(t('刚才的草稿', 'Recent drafts'))}</span>` + history.map((row, index) => {
      const label = ACTIONS.find(item => item.id === row.action)?.label ?? t('草稿', 'Draft')
      return `<button type="button" class="history-row" data-history="${index}"><b>${esc(label)}</b><span>${esc(row.text.replace(/\s+/g, ' ').slice(0, 40))}</span><time>${esc(fmtTime(row.at))}</time></button>`
    }).join('')
    host.querySelectorAll('[data-history]').forEach(btn => btn.addEventListener('click', () => {
      const row = history[Number(btn.dataset.history)]
      if (!row) return
      resultText = row.text
      action = row.action
      paintAction()
      paintResultLabel()
      $('#ai-result').hidden = false
      $('#result-body').textContent = row.text
      $('#result-body').classList.remove('is-error')
    }))
  }

  function paintModel() {
    const chip = $('#ai-model')
    // 配了写作供应商就用它，没配才显示 DSH 当前模型
    const custom = app.settings?.writingReady ? app.settings.writing?.model : ''
    if (custom) {
      chip.textContent = custom
      chip.className = 'model-chip is-ok'
    } else if (app.model) {
      chip.textContent = app.model.label
      chip.className = 'model-chip is-ok'
    } else {
      chip.textContent = t('未连接模型', 'No model')
      chip.className = 'model-chip is-off'
    }
  }

  // 离开页面时尽量保存
  const onBeforeUnload = () => {
    if (!dirty) return
    navigator.sendBeacon?.('/media-workbench-modern/api/document/save', new Blob([JSON.stringify({ id: activeDocId ?? '', title: titleEl.value, content: contentEl.value })], { type: 'application/json' }))
  }
  window.addEventListener('beforeunload', onBeforeUnload)

  function update() {
    paintModel()
    paintDocs()
    // 文档可能被外部修改：只在当前没有输入时同步标题
    if (!dirty && activeDocId) {
      const doc = currentDoc()
      if (doc && document.activeElement !== titleEl && document.activeElement !== contentEl) {
        if (titleEl.value !== doc.title) titleEl.value = doc.title
        if (contentEl.value !== doc.content) { contentEl.value = doc.content; updateCounts() }
      }
    }
  }

  paintModel()
  paintDocs()

  return {
    update,
    unmount() {
      window.removeEventListener('beforeunload', onBeforeUnload)
      if (dirty) { void save(true) }
    },
  }
}
