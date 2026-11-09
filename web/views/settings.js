import { api } from '../lib/api.js'
import { $, esc } from '../lib/dom.js'
import { icon } from '../lib/icons.js'
import { app, t } from '../lib/state.js'

export function mount(root) {
  const settings = app.settings ?? {}
  const image = settings.image ?? {}
  const video = settings.video ?? {}
  const voice = settings.voice ?? {}
  const voicePresets = app.voicePresets?.length ? app.voicePresets : [
    { id: 'openai', name: 'OpenAI TTS', baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o-mini-tts' },
    { id: 'minimax', name: 'MiniMax Speech', baseUrl: 'https://api.minimax.cn/v1/t2a_v2', model: 'speech-2.8-hd' },
    { id: 'custom', name: '自定义', baseUrl: '', model: '' },
  ]
  let testImage = ''
  let busy = false

  root.innerHTML = `
    <section class="bench bench-settings">
      <div class="settings-scroll">
        <header class="settings-hero">
          <span class="eyebrow">${esc(t('工作台设置', 'WORKBENCH SETTINGS'))}</span>
          <h2>${esc(t('把接口接上，其余都在本机', 'Connect providers. Everything else stays local.'))}</h2>
          <p>${esc(t('写作走 DSH 当前模型，不需要在这里填密钥；生图和视频各自填写自己的接口。密钥只保存在本机 settings.json（权限 600），不会回传给浏览器。', 'Writing uses the current DSH model. Image and video providers each have their own endpoint. Keys stay in a local settings.json (mode 600) and are never sent back to the browser.'))}</p>
        </header>

        <section class="settings-card" id="image-card">
          <header class="settings-head">
            <div class="settings-title"><span class="settings-ic" style="--c:#8a6fd1">${icon('image', 18)}</span><div><h3>${esc(t('生图服务', 'Image provider'))}</h3><p>${esc(t('兼容 OpenAI Images API：POST /images/generations，参考图走 /images/edits。', 'OpenAI Images compatible: POST /images/generations, edits at /images/edits.'))}</p></div></div>
            <span class="ready-pill ${settings.imageReady ? 'is-ok' : 'is-off'}" id="image-ready"><i></i>${settings.imageReady ? t('已就绪', 'Ready') : t('未配置', 'Not set')}</span>
          </header>
          <div class="settings-grid">
            <label class="field"><span class="field-label">${esc(t('服务预设', 'Preset'))}</span>
              <select class="select" id="image-preset">${(app.imagePresets ?? []).map(p => `<option value="${p.id}" ${p.id === image.preset ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}</select>
            </label>
            <label class="field"><span class="field-label">${esc(t('接口地址', 'Base URL'))}</span>
              <input class="input" id="image-base" value="${esc(image.baseUrl ?? '')}" placeholder="https://api.openai.com/v1" spellcheck="false">
            </label>
            <label class="field"><span class="field-label">${esc(t('模型', 'Model'))}</span>
              <input class="input" id="image-model" value="${esc(image.model ?? '')}" placeholder="gpt-image-1" spellcheck="false">
            </label>
            <label class="field"><span class="field-label">${esc(t('密钥', 'API key'))}</span>
              <input class="input" id="image-key" type="password" autocomplete="off" placeholder="${image.hasKey ? esc(t('已保存（尾号 ', 'Saved (ends ') + esc(image.keyHint ?? '') + '）') : 'sk-…'}">
            </label>
            <label class="field"><span class="field-label">${esc(t('默认尺寸', 'Default size'))}</span>
              <input class="input" id="image-size" value="${esc(image.size ?? '')}" placeholder="1024x1024" spellcheck="false">
            </label>
            <label class="field"><span class="field-label">${esc(t('质量', 'Quality'))}</span>
              <input class="input" id="image-quality" value="${esc(image.quality ?? '')}" placeholder="auto / high" spellcheck="false">
            </label>
            <label class="field field-wide"><span class="field-label">${esc(t('附加参数 JSON', 'Extra JSON'))}</span>
              <textarea id="image-extra" rows="2" spellcheck="false" placeholder='{"response_format":"b64_json"}'>${esc(image.extra ?? '')}</textarea>
            </label>
          </div>
          <footer class="settings-actions">
            <span class="fine">${image.hasKey ? esc(t('密钥已存在，留空表示不修改。', 'A key exists; leave blank to keep it.')) : esc(t('还没有密钥。', 'No key yet.'))}</span>
            <span class="spacer"></span>
            ${image.hasKey ? `<button class="text-btn danger-quiet" id="image-clear-key">${esc(t('清除密钥', 'Clear key'))}</button>` : ''}
            <button class="btn btn-small btn-ghost" id="image-test">${esc(t('试画一张', 'Test image'))}</button>
            <button class="btn btn-small btn-primary" id="image-save">${esc(t('保存', 'Save'))}</button>
          </footer>
          <div class="test-result" id="test-result" hidden><img id="test-img" alt=""><span>${esc(t('接口通了。', 'The provider works.'))}</span></div>
        </section>

        <section class="settings-card" id="video-card">
          <header class="settings-head">
            <div class="settings-title"><span class="settings-ic" style="--c:#3f8f92">${icon('film', 18)}</span><div><h3>${esc(t('视频服务', 'Video provider'))}</h3><p>${esc(t('异步任务接口：POST 创建任务，轮询状态，完成后下载。', 'Async task API: POST to create, poll status, download when done.'))}</p></div></div>
            <span class="ready-pill ${settings.videoReady ? 'is-ok' : 'is-off'}" id="video-ready"><i></i>${settings.videoReady ? t('已就绪', 'Ready') : t('未配置', 'Not set')}</span>
          </header>
          <div class="settings-grid">
            <label class="field"><span class="field-label">${esc(t('服务预设', 'Preset'))}</span>
              <select class="select" id="video-preset">${(app.videoPresets ?? []).map(p => `<option value="${p.id}" ${p.id === video.preset ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}</select>
            </label>
            <label class="field"><span class="field-label">${esc(t('接口地址', 'Base URL'))}</span>
              <input class="input" id="video-base" value="${esc(video.baseUrl ?? '')}" placeholder="https://api.openai.com/v1" spellcheck="false">
            </label>
            <label class="field"><span class="field-label">${esc(t('模型', 'Model'))}</span>
              <input class="input" id="video-model" value="${esc(video.model ?? '')}" placeholder="sora-2" spellcheck="false">
            </label>
            <label class="field"><span class="field-label">${esc(t('密钥', 'API key'))}</span>
              <input class="input" id="video-key" type="password" autocomplete="off" placeholder="${video.hasKey ? esc(t('已保存（尾号 ', 'Saved (ends ') + esc(video.keyHint ?? '') + '）') : 'sk-…'}">
            </label>
            <label class="field"><span class="field-label">${esc(t('创建路径', 'Create path'))}</span><input class="input" id="video-create" value="${esc(video.createPath ?? '/videos')}" spellcheck="false"></label>
            <label class="field"><span class="field-label">${esc(t('状态路径', 'Status path'))}</span><input class="input" id="video-status" value="${esc(video.statusPath ?? '/videos/{id}')}" spellcheck="false"></label>
            <label class="field"><span class="field-label">${esc(t('内容路径', 'Content path'))}</span><input class="input" id="video-content" value="${esc(video.contentPath ?? '/videos/{id}/content')}" spellcheck="false"></label>
            <label class="field"><span class="field-label">${esc(t('首帧字段名', 'Image field'))}</span><input class="input" id="video-field" value="${esc(video.imageField ?? 'image')}" spellcheck="false"></label>
            <label class="field field-wide"><span class="field-label">${esc(t('附加参数 JSON', 'Extra JSON'))}</span><textarea id="video-extra" rows="2" spellcheck="false" placeholder='{"resolution":"1080p"}'>${esc(video.extra ?? '')}</textarea></label>
          </div>
          <footer class="settings-actions">
            <span class="fine">${esc(t('没有视频服务时，视频工作台仍可用「分镜短片」模式。', 'Without a video provider, storyboard mode still works.'))}</span>
            <span class="spacer"></span>
            ${video.hasKey ? `<button class="text-btn danger-quiet" id="video-clear-key">${esc(t('清除密钥', 'Clear key'))}</button>` : ''}
            <button class="btn btn-small btn-primary" id="video-save">${esc(t('保存', 'Save'))}</button>
          </footer>
        </section>

        <section class="settings-card" id="voice-card">
          <header class="settings-head">
            <div class="settings-title"><span class="settings-ic" style="--c:#b4833e">${icon('mic', 18)}</span><div><h3>${esc(t('语音服务', 'Voice provider'))}</h3><p>${esc(t('兼容 OpenAI Audio Speech：POST /audio/speech，返回音频文件。语音工作台需要单独配置。', 'OpenAI Audio Speech compatible: POST /audio/speech. The Voice Studio uses this separate provider.'))}</p></div></div>
            <span class="ready-pill ${settings.voiceReady ? 'is-ok' : 'is-off'}" id="voice-ready"><i></i>${settings.voiceReady ? t('已就绪', 'Ready') : t('未配置', 'Not set')}</span>
          </header>
          <div class="settings-grid">
            <label class="field"><span class="field-label">${esc(t('服务预设', 'Preset'))}</span>
              <select class="select" id="voice-preset">${voicePresets.map(p => `<option value="${p.id}" ${p.id === voice.preset ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}</select>
            </label>
            <label class="field"><span class="field-label">${esc(t('接口地址', 'Base URL'))}</span>
              <input class="input" id="voice-base" value="${esc(voice.baseUrl ?? '')}" placeholder="https://api.openai.com/v1" spellcheck="false">
            </label>
            <label class="field"><span class="field-label">${esc(t('模型', 'Model'))}</span>
              <input class="input" id="voice-model" value="${esc(voice.model ?? 'gpt-4o-mini-tts')}" placeholder="gpt-4o-mini-tts" spellcheck="false">
            </label>
            <label class="field"><span class="field-label">${esc(t('密钥', 'API key'))}</span>
              <input class="input" id="voice-key" type="password" autocomplete="off" placeholder="${voice.hasKey ? esc(t('已保存（尾号 ', 'Saved (ends ') + esc(voice.keyHint ?? '') + '）') : 'sk-…'}">
            </label>
            <label class="field"><span class="field-label">${esc(t('默认音色', 'Default voice'))}</span>
              <input class="input" id="voice-name" value="${esc(voice.voice ?? 'alloy')}" placeholder="alloy" spellcheck="false">
            </label>
            <label class="field"><span class="field-label">${esc(t('输出格式', 'Format'))}</span>
              <select class="select" id="voice-format">${['mp3', 'wav', 'opus', 'aac', 'flac'].map(f => `<option value="${f}" ${f === (voice.format ?? 'mp3') ? 'selected' : ''}>${f}</option>`).join('')}</select>
            </label>
            <label class="field field-wide"><span class="field-label">${esc(t('附加参数 JSON', 'Extra JSON'))}</span>
              <textarea id="voice-extra" rows="2" spellcheck="false" placeholder='{"speed":1}'>${esc(voice.extra ?? '')}</textarea>
            </label>
          </div>
          <footer class="settings-actions">
            <span class="fine">${voice.hasKey ? esc(t('密钥已存在，留空表示不修改。', 'A key exists; leave blank to keep it.')) : esc(t('语音服务是可选的，不配置不影响另外三个工作台。', 'Optional; the other workbenches work without it.'))}</span>
            <span class="spacer"></span>
            ${voice.hasKey ? `<button class="text-btn danger-quiet" id="voice-clear-key">${esc(t('清除密钥', 'Clear key'))}</button>` : ''}
            <button class="btn btn-small btn-primary" id="voice-save">${esc(t('保存', 'Save'))}</button>
          </footer>
        </section>

        <section class="settings-card">
          <header class="settings-head">
            <div class="settings-title"><span class="settings-ic" style="--c:#b4833e">${icon('pen', 18)}</span><div><h3>${esc(t('写作模型', 'Writing model'))}</h3><p>${esc(t('使用 DSH 当前默认模型；在 DSH 的模型选择里切换。', 'Uses the current DSH default model; switch it in DSH.'))}</p></div></div>
            <span class="ready-pill ${app.model ? 'is-ok' : 'is-off'}"><i></i>${app.model ? esc(app.model.label) : t('未连接', 'Not connected')}</span>
          </header>
        </section>

        <section class="settings-card">
          <header class="settings-head">
            <div class="settings-title"><span class="settings-ic" style="--c:#6b7280">${icon('settings', 18)}</span><div><h3>${esc(t('维护', 'Maintenance'))}</h3><p>${esc(t('导出工作台记录，或者清空列表。这里只动记录，不会删除作品文件目录里的图片和视频。', 'Export workbench records or clear the lists. This only touches records; files in the Library folder are left alone.'))}</p></div></div>
          </header>
          <div class="settings-actions wrap">
            <button class="btn btn-small btn-ghost" id="export-all">${icon('download', 14)}${esc(t('导出记录 JSON', 'Export records JSON'))}</button>
            <button class="btn btn-small btn-ghost" id="check-update">${icon('refresh', 14)}${esc(t('检查更新', 'Check for updates'))}</button>
            <span class="fine" id="update-result"></span>
            <button class="btn btn-small btn-ghost" id="clear-images">${esc(t('清空图片记录', 'Clear images'))}</button>
            <button class="btn btn-small btn-ghost" id="clear-videos">${esc(t('清空视频记录', 'Clear videos'))}</button>
            <button class="btn btn-small btn-ghost danger-quiet" id="clear-all">${esc(t('清空全部记录', 'Clear everything'))}</button>
          </div>
        </section>

        <section class="settings-card">
          <header class="settings-head">
            <div class="settings-title"><span class="settings-ic" style="--c:#c96442">${icon('download', 18)}</span><div><h3>${esc(t('作品文件目录', 'Library folder'))}</h3><p>${esc(t('图片、视频的实际文件主目录。换到其他盘时会把已有文件迁移过去，释放 C 盘；状态和设置文件仍留在系统盘。留空恢复默认目录。', 'The actual storage folder for images and videos. Changing it migrates existing files and frees the system drive; state and settings stay on the system drive. Leave blank to use the default.'))}</p></div></div>
          </header>
          <label class="field"><span class="field-label">${esc(t('目录绝对路径', 'Absolute folder path'))}</span>
            <input class="input" id="output-dir" value="${esc(settings.storage?.outputDir ?? '')}" placeholder="D:\\AI作品" spellcheck="false">
          </label>
          <div class="settings-actions">
            <span class="fine" id="output-dir-hint">${esc(t('建议选空目录；保存时会创建目录并迁移现有文件，目标里有同名文件会拒绝迁移。', 'Prefer an empty folder. It is created and existing files are migrated; same-name files cause the move to be rejected.'))}</span>
            <span class="spacer"></span>
            <button class="btn btn-small btn-ghost" id="output-dir-clear">${esc(t('恢复默认目录', 'Use default'))}</button>
            <button class="btn btn-small btn-primary" id="output-dir-save">${esc(t('保存目录', 'Save folder'))}</button>
          </div>
        </section>

        <section class="settings-card about-card">
          <div class="about-mark">${icon('spark', 22)}</div>
          <div>
            <h3>${esc(t('摩登-媒体工作室', 'Modern-MediaStudio'))} <span class="version">v${esc(app.version)}</span></h3>
            <p>${esc(t('一个 DSH 插件：生图、写作、星图、视频四个工作台，作品留在本机。按 ', 'A DSH plugin with four benches: image, writing, star map and video. Press '))}<kbd>${navigator.platform.includes('Mac') ? '⌘' : 'Ctrl'}</kbd> + <kbd>,</kbd> ${esc(t('打开设置。', 'to open settings.'))}</p>
          </div>
        </section>
      </div>
    </section>
  `

  const field = id => $('#' + id)

  // 预设联动
  field('image-preset').addEventListener('change', () => {
    const preset = (app.imagePresets ?? []).find(p => p.id === field('image-preset').value)
    if (preset?.baseUrl) field('image-base').value = preset.baseUrl
    if (preset?.model) field('image-model').value = preset.model
  })
  field('video-preset').addEventListener('change', () => {
    const preset = (app.videoPresets ?? []).find(p => p.id === field('video-preset').value)
    if (preset?.baseUrl) field('video-base').value = preset.baseUrl
    if (preset?.model) field('video-model').value = preset.model
  })
  field('voice-preset').addEventListener('change', () => {
    const preset = voicePresets.find(p => p.id === field('voice-preset').value)
    if (preset?.baseUrl) field('voice-base').value = preset.baseUrl
    if (preset?.model) field('voice-model').value = preset.model
    if (preset?.id === 'minimax' && field('voice-name').value === 'alloy') field('voice-name').value = 'male-qn-qingse'
    if (preset?.id === 'openai' && field('voice-name').value === 'male-qn-qingse') field('voice-name').value = 'alloy'
  })

  async function saveImage() {
    if (busy) return
    busy = true
    try {
      const data = await api('settings', {
        image: {
          preset: field('image-preset').value,
          baseUrl: field('image-base').value,
          model: field('image-model').value,
          size: field('image-size').value,
          quality: field('image-quality').value,
          extra: field('image-extra').value,
          apiKey: field('image-key').value,
        },
      })
      app.settings = data.settings
      field('image-key').value = ''
      app.toast(t('生图设置已保存', 'Image settings saved'), 'success')
      await app.refresh()
    } catch (err) { app.toast(err.message, 'error') }
    finally { busy = false }
  }

  async function saveVideo() {
    if (busy) return
    busy = true
    try {
      const data = await api('settings', {
        video: {
          preset: field('video-preset').value,
          baseUrl: field('video-base').value,
          model: field('video-model').value,
          createPath: field('video-create').value,
          statusPath: field('video-status').value,
          contentPath: field('video-content').value,
          imageField: field('video-field').value,
          extra: field('video-extra').value,
          apiKey: field('video-key').value,
        },
      })
      app.settings = data.settings
      field('video-key').value = ''
      app.toast(t('视频设置已保存', 'Video settings saved'), 'success')
      await app.refresh()
    } catch (err) { app.toast(err.message, 'error') }
    finally { busy = false }
  }

  async function saveVoice() {
    if (busy) return
    busy = true
    try {
      const data = await api('settings', {
        voice: {
          preset: field('voice-preset').value,
          baseUrl: field('voice-base').value,
          model: field('voice-model').value,
          voice: field('voice-name').value,
          format: field('voice-format').value,
          extra: field('voice-extra').value,
          apiKey: field('voice-key').value,
        },
      })
      app.settings = data.settings
      field('voice-key').value = ''
      app.toast(t('语音设置已保存', 'Voice settings saved'), 'success')
      await app.refresh()
    } catch (err) { app.toast(err.message, 'error') }
    finally { busy = false }
  }

  field('image-save').addEventListener('click', saveImage)
  field('video-save').addEventListener('click', saveVideo)
  field('voice-save').addEventListener('click', saveVoice)

  async function saveOutputDir(value) {
    if (busy) return
    busy = true
    try {
      const data = await api('settings', { storage: { outputDir: value } })
      app.settings = data.settings
      field('output-dir').value = data.settings?.storage?.outputDir ?? ''
      app.toast(value ? t('作品目录已迁移', 'Library folder moved') : t('已恢复默认目录', 'Default folder restored'), 'success')
      await app.refresh()
    } catch (err) { app.toast(err.message, 'error') }
    finally { busy = false }
  }
  field('output-dir-save').addEventListener('click', () => saveOutputDir(field('output-dir').value))
  field('output-dir-clear').addEventListener('click', () => { field('output-dir').value = ''; saveOutputDir('') })

  field('image-clear-key')?.addEventListener('click', async () => {
    try {
      const data = await api('settings', { image: { clearKey: true } })
      app.settings = data.settings
      app.toast(t('已清除生图密钥', 'Image key cleared'), 'success')
      await app.refresh()
    } catch (err) { app.toast(err.message, 'error') }
  })
  field('video-clear-key')?.addEventListener('click', async () => {
    try {
      const data = await api('settings', { video: { clearKey: true } })
      app.settings = data.settings
      app.toast(t('已清除视频密钥', 'Video key cleared'), 'success')
      await app.refresh()
    } catch (err) { app.toast(err.message, 'error') }
  })
  field('voice-clear-key')?.addEventListener('click', async () => {
    try {
      const data = await api('settings', { voice: { clearKey: true } })
      app.settings = data.settings
      app.toast(t('已清除语音密钥', 'Voice key cleared'), 'success')
      await app.refresh()
    } catch (err) { app.toast(err.message, 'error') }
  })

  field('image-test').addEventListener('click', async () => {
    if (busy) return
    if (!field('image-key').value && !app.settings?.image?.hasKey) return app.toast(t('先填密钥并保存', 'Add a key and save first'), 'error')
    busy = true
    const btn = field('image-test')
    btn.textContent = t('正在画…', 'Drawing…')
    try {
      const data = await api('settings/test-image', {})
      testImage = data.url
      field('test-result').hidden = false
      field('test-img').src = testImage
      app.toast(t('接口通了', 'Provider works'), 'success')
    } catch (err) { app.toast(err.message, 'error') }
    finally { busy = false; btn.textContent = t('试画一张', 'Test image') }
  })

  field('export-all').addEventListener('click', () => { location.href = '/media-workbench-modern/api/export' })
  field('check-update').addEventListener('click', async () => {
    const button = field('check-update')
    const result = field('update-result')
    button.disabled = true
    result.textContent = t('检查中…', 'Checking…')
    try {
      const data = await api('update')
      if (data.updateAvailable) {
        result.innerHTML = `${esc(t('有新版本 ', 'New version '))}<a href="${esc(data.url)}" target="_blank" rel="noopener">${esc(data.latest)}</a>`
        app.toast(t(`发现新版本 ${data.latest}`, `Version ${data.latest} available`), 'success')
      } else {
        result.textContent = t(`已是最新 ${data.current}`, `Up to date (${data.current})`)
        app.toast(t('已经是最新版本', 'Already up to date'), 'success')
      }
    } catch (err) {
      result.textContent = ''
      app.toast(err.message, 'error')
    } finally { button.disabled = false }
  })

  async function clearScope(scope) {
    const label = { images: t('图片记录', 'image records'), videos: t('视频记录', 'video records'), all: t('全部记录', 'all records') }[scope]
    const ok = await app.confirm({ title: t('清空', 'Clear ') + label + '？', message: t('文件会留在本机目录，但工作台里不再显示。', 'Files stay on disk; the workbench stops listing them.'), confirmText: t('清空', 'Clear'), danger: true })
    if (!ok) return
    try {
      await api('clear', { scope })
      await app.refresh()
      app.toast(t('已清空', 'Cleared'), 'success')
    } catch (err) { app.toast(err.message, 'error') }
  }
  field('clear-images').addEventListener('click', () => clearScope('images'))
  field('clear-videos').addEventListener('click', () => clearScope('videos'))
  field('clear-all').addEventListener('click', () => clearScope('all'))

  return {
    update() { /* 设置页不跟随轮询刷新，避免覆盖正在编辑的值 */ },
  }
}
