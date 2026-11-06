export const app = {
  lang: 'zh',
  theme: 'light',
  state: null,
  settings: null,
  imagePresets: [],
  videoPresets: [],
  model: null,
  dataDir: '',
  version: '',
  view: null,
  revision: 0,
  polling: false,
  /** 运行时由 app.js 注入 */
  refresh: async () => {},
  toast: () => {},
  confirm: async () => false,
  showLayer: () => () => {},
  navigate: () => {},
  openSettings: () => { location.hash = '#/settings' },
}

export function t(zh, en) {
  return app.lang === 'en' ? en : zh
}

export function $(selector, root = document) {
  return root.querySelector(selector)
}

export function providerChip(kind) {
  if (kind === 'image') {
    if (!app.settings?.imageReady) return { ok: false, text: t('生图未配置', 'Image not set') }
    return { ok: true, text: app.settings.image.model || t('已连接', 'Ready') }
  }
  if (kind === 'video') {
    if (!app.settings?.videoReady) return { ok: false, text: t('视频未配置', 'Video not set') }
    return { ok: true, text: app.settings.video.model || t('已连接', 'Ready') }
  }
  if (!app.model) return { ok: false, text: t('模型未连接', 'No model') }
  return { ok: true, text: app.model.label }
}
