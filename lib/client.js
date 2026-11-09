// @exccoder/dsh-media-workbench · 浏览器半片
// 在侧栏加一个「摩登-媒体工作室」入口，主区域是插件自己的页面（同源 iframe）。
// 主题和语言从 DSH 服务同步，页面内不再重复判断。
window.__ModuleLoader__.load({
  id: '@exccoder/dsh-media-workbench',
  factory: (require) => {
    const module = { exports: {} }
    const exports = module.exports
    const React = require('react')
    const h = React.createElement
    const PANEL = 'media-workbench-modern'
    const SRC = '/media-workbench-modern/'

    const LABEL = { zh: '摩登-媒体工作室', en: 'Modern-MediaStudio' }
    const TITLE = { zh: '摩登-媒体工作室：生图、写作、星图与视频', en: 'Modern-MediaStudio: image, writing, star map and video' }

    let lang = /^en\b/i.test(navigator.language) ? 'en' : 'zh'
    let scheme = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
    const frames = new Set()

    function post(frame, message) {
      try {
        if (frame && frame.contentWindow) frame.contentWindow.postMessage(message, location.origin)
      } catch { /* iframe 还没加载好 */ }
    }

    function pushTheme(frame) {
      post(frame, { type: 'media-workbench-modern:theme', scheme })
    }

    function pushLocale(frame) {
      post(frame, { type: 'media-workbench-modern:locale', lang })
    }

    function StudioIcon({ size }) {
      const s = size || 18
      return h(
        'svg',
        { width: s, height: s, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.6, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': 'true' },
        h('path', { d: 'M12 3.2 13.7 8.3 18.8 10 13.7 11.7 12 16.8 10.3 11.7 5.2 10 10.3 8.3z' }),
        h('path', { d: 'M18.4 15.2 19.2 17.6 21.6 18.4 19.2 19.2 18.4 21.6 17.6 19.2 15.2 18.4 17.6 17.6z' }),
        h('path', { d: 'M5.6 15.6 6.2 17.2 7.8 17.8 6.2 18.4 5.6 20 5 18.4 3.4 17.8 5 17.2z' }),
      )
    }

    function StudioPanel() {
      const ref = React.useRef(null)
      const [src] = React.useState(() => `${SRC}?lang=${lang}&theme=${scheme}`)
      React.useEffect(() => {
        const host = ref.current
        if (!host) return
        const frame = document.createElement('iframe')
        frame.src = src
        frame.title = TITLE[lang]
        frame.allow = 'clipboard-write; fullscreen'
        frame.style.border = '0'
        frame.style.display = 'block'
        frame.style.background = 'transparent'
        frame.style.position = 'fixed'
        frame.style.zIndex = '1'
        frame.addEventListener('load', () => {
          pushTheme(frame)
          pushLocale(frame)
        })
        document.body.appendChild(frame)
        frames.add(frame)
        const fit = () => {
          const box = host.getBoundingClientRect()
          if (box.width < 200 || box.height < 80) {
            frame.style.display = 'none'
            return
          }
          frame.style.display = 'block'
          frame.style.top = `${box.top}px`
          frame.style.left = `${box.left}px`
          frame.style.width = `${box.width}px`
          frame.style.height = `${Math.max(200, window.innerHeight - box.top)}px`
        }
        requestAnimationFrame(fit)
        const timer = setTimeout(fit, 80)
        const observer = new ResizeObserver(fit)
        observer.observe(host)
        window.addEventListener('resize', fit)
        return () => {
          clearTimeout(timer)
          observer.disconnect()
          window.removeEventListener('resize', fit)
          frames.delete(frame)
          frame.remove()
        }
      }, [])
      return h('div', { ref, style: { width: '100%', height: '100%', minHeight: '100%' } })
    }

    function apply(ctx) {
      // 主题跟随：拿到快照后同步给 iframe，切换时再推一次
      try {
        ctx.inject(['theme'], c => {
          const push = snapshot => {
            const next = snapshot?.active?.colorScheme
            if (next === 'dark' || next === 'light') scheme = next
            frames.forEach(pushTheme)
          }
          push(c.theme.getTheme())
          c.on('theme/change', push)
        })
      } catch { /* 旧版本没有 theme 服务 */ }

      // 语言跟随
      try {
        ctx.inject(['locale'], c => {
          const push = snapshot => {
            const active = snapshot?.active
            const value = typeof active === 'string' ? active : active?.lang ?? active?.id
            if (typeof value === 'string') lang = value.toLowerCase().startsWith('en') ? 'en' : 'zh'
            frames.forEach(pushLocale)
          }
          push(c.locale.getSnapshot())
          c.on('locale/change', push)
        })
      } catch { /* 旧版本没有 locale 服务 */ }

      ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({
        name: 'sidebar.panellist',
        id: PANEL,
        order: 4,
        label: () => LABEL[lang],
      }, StudioIcon))

      ctx.slots.inject('main', () => ctx.slots.register({ name: 'main', key: PANEL }, StudioPanel))
    }

    exports.isPlugin = true
    exports.inject = ['slots']
    exports.apply = apply
    return module.exports
  },
})
