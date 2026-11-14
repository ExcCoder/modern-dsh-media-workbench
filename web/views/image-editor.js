import { fileUrl } from '../lib/api.js'
import { $, esc } from '../lib/dom.js'
import { icon } from '../lib/icons.js'
import { app, t } from '../lib/state.js'

const MAX_SOURCE = 1536
const ZOOM_STEPS = [0.25, 0.4, 0.6, 0.8, 1, 1.5, 2]

function canvasOf(width, height) {
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(width))
  canvas.height = Math.max(1, Math.round(height))
  return canvas
}

/**
 * 全屏图片画布：涂蒙版、设扩边，应用后把结果交回主表单。
 * @param {object} options
 * @param {{name: string, url: string}} options.source 源图
 * @param {HTMLCanvasElement} [options.mask] 已有蒙版（透明 = 要重绘）
 * @param {object} [options.expand] 已有扩边 {l,r,t,b}
 * @param {(result: {mask: HTMLCanvasElement, expand: object}) => void} options.onApply
 */
export async function openCanvasEditor({ source, mask, expand, onApply }) {
  const bitmap = await fetch(source.url, { credentials: 'same-origin' })
    .then(res => res.blob())
    .then(blob => createImageBitmap(blob))
  const scale = Math.min(1, MAX_SOURCE / Math.max(bitmap.width, bitmap.height))
  const width = Math.round(bitmap.width * scale)
  const height = Math.round(bitmap.height * scale)

  let tool = 'mask'
  let brush = 40
  let zoom = 'fit'
  let strokes = []
  let redo = []
  let pending = null
  let painting = false
  let expandState = { l: 0, r: 0, t: 0, b: 0 }
  let expandDir = 'r'
  let expandPercent = 0

  const base = canvasOf(width, height)
  base.getContext('2d').drawImage(bitmap, 0, 0, width, height)

  const maskCanvas = canvasOf(width, height)
  const maskCtx = maskCanvas.getContext('2d')
  if (mask) maskCtx.drawImage(mask, 0, 0)
  const overlay = canvasOf(width, height)
  const overlayCtx = overlay.getContext('2d')

  function repaintMask() {
    overlayCtx.clearRect(0, 0, overlay.width, overlay.height)
    overlayCtx.drawImage(maskCanvas, 0, 0)
    overlayCtx.globalCompositeOperation = 'source-in'
    overlayCtx.fillStyle = 'rgba(214, 82, 52, 0.85)'
    overlayCtx.fillRect(0, 0, overlay.width, overlay.height)
    overlayCtx.globalCompositeOperation = 'source-over'
  }

  /** 扩边后的画布：原图居中，新区域用边缘拉伸填充 */
  function expandedBase() {
    const out = canvasOf(width + expandState.l + expandState.r, height + expandState.t + expandState.b)
    const ctx = out.getContext('2d')
    ctx.drawImage(base, expandState.l, expandState.t)
    if (expandState.r > 0) ctx.drawImage(base, width - 1, 0, 1, height, expandState.l + width, expandState.t, expandState.r, height)
    if (expandState.l > 0) ctx.drawImage(base, 0, 0, 1, height, 0, expandState.t, expandState.l, height)
    if (expandState.b > 0) ctx.drawImage(base, 0, height - 1, width, 1, expandState.l, expandState.t + height, width, expandState.b)
    if (expandState.t > 0) ctx.drawImage(base, 0, 0, width, 1, expandState.l, 0, width, expandState.t)
    return out
  }

  function expandRect() {
    if (expandState.r > 0) return { x: expandState.l + width, y: expandState.t, w: expandState.r, h: height }
    if (expandState.l > 0) return { x: 0, y: expandState.t, w: expandState.l, h: height }
    if (expandState.b > 0) return { x: expandState.l, y: expandState.t + height, w: width, h: expandState.b }
    if (expandState.t > 0) return { x: expandState.l, y: 0, w: width, h: expandState.t }
    return null
  }

  function paint() {
    const out = expandedBase()
    const ctx = canvas.getContext('2d')
    if (canvas.width !== out.width || canvas.height !== out.height) {
      canvas.width = out.width
      canvas.height = out.height
    }
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    ctx.drawImage(out, 0, 0)
    const rect = expandRect()
    if (rect) {
      ctx.globalAlpha = 0.3
      ctx.fillStyle = '#c96442'
      ctx.fillRect(rect.x, rect.y, rect.w, rect.h)
      ctx.globalAlpha = 1
      ctx.strokeStyle = 'rgba(214, 82, 52, 0.95)'
      ctx.setLineDash([9, 7])
      ctx.lineWidth = 3
      ctx.strokeRect(rect.x, rect.y, rect.w, rect.h)
      ctx.setLineDash([])
    }
    if (tool !== 'view') ctx.drawImage(overlay, expandState.l, expandState.t)
    applyZoom()
  }

  function applyExpand(percent, dir) {
    expandPercent = percent
    expandDir = dir
    expandState = { l: 0, r: 0, t: 0, b: 0 }
    if (percent > 0) {
      if (dir === 'r') expandState.r = Math.round(width * percent)
      if (dir === 'l') expandState.l = Math.round(width * percent)
      if (dir === 'b') expandState.b = Math.round(height * percent)
      if (dir === 't') expandState.t = Math.round(height * percent)
    }
    // 画布尺寸变了，回到适配视图，让新区域整块都能看到
    zoom = 'fit'
    paint()
  }

  const layer = document.createElement('div')
  layer.className = 'canvas-editor'
  layer.innerHTML = `
    <header class="ce-head">
      <div class="ce-title">
        <span class="ce-ic">${icon('edit', 17)}</span>
        <div><b>${esc(t('图片编辑画布', 'Image canvas'))}</b><small>${esc(source.name || '')} · ${width}×${height}</small></div>
      </div>
      <button class="icon-btn" data-act="close" title="${esc(t('关闭', 'Close'))}">${icon('x', 17)}</button>
    </header>
    <div class="ce-toolbar">
      <div class="seg" id="ce-tool">
        <button type="button" data-tool="view">${esc(t('查看', 'View'))}</button>
        <button type="button" data-tool="mask" class="is-on">${esc(t('蒙版', 'Mask'))}</button>
        <button type="button" data-tool="erase">${esc(t('擦除', 'Erase'))}</button>
      </div>
      <label class="ce-brush">${esc(t('笔刷', 'Brush'))}<input type="range" id="ce-brush-size" min="6" max="140" value="${brush}"><b id="ce-brush-value">${brush}</b></label>
      <div class="ce-expand">
        <span>${esc(t('扩边', 'Expand'))}</span>
        <div class="dir-grid" id="ce-dir">
          <button type="button" data-dir="l">${esc(t('左', 'L'))}</button>
          <button type="button" data-dir="r" class="is-on">${esc(t('右', 'R'))}</button>
          <button type="button" data-dir="t">${esc(t('上', 'T'))}</button>
          <button type="button" data-dir="b">${esc(t('下', 'B'))}</button>
        </div>
        <div class="seg" id="ce-expand">
          <button type="button" data-pct="0" class="is-on">${esc(t('无', 'None'))}</button>
          <button type="button" data-pct="10">+10%</button>
          <button type="button" data-pct="25">+25%</button>
          <button type="button" data-pct="50">+50%</button>
        </div>
      </div>
      <div class="ce-tools">
        <button class="icon-btn" data-act="zoom-out" title="${esc(t('缩小', 'Zoom out'))}">${icon('zoomOut', 16)}</button>
        <button class="icon-btn" data-act="zoom-in" title="${esc(t('放大', 'Zoom in'))}">${icon('zoomIn', 16)}</button>
        <button class="icon-btn" data-act="undo" title="${esc(t('撤销', 'Undo'))}">${icon('undo', 16)}</button>
        <button class="icon-btn" data-act="redo" title="${esc(t('重做', 'Redo'))}">${icon('redo', 16)}</button>
      </div>
    </div>
    <div class="ce-stage"><canvas id="ce-canvas"></canvas></div>
    <footer class="ce-foot">
      <span class="fine">${esc(t('红色区域会被模型重绘；扩边会自动生成透明外圈蒙版。', 'Red areas get repainted; expanding adds a transparent outer ring.'))}</span>
      <div class="ce-foot-btns">
        <button class="btn btn-small btn-ghost" data-act="cancel">${esc(t('取消', 'Cancel'))}</button>
        <button class="btn btn-small btn-primary" data-act="apply">${icon('check', 15)}${esc(t('应用到图片编辑', 'Apply to editor'))}</button>
      </div>
    </footer>`

  const canvas = $('#ce-canvas', layer)
  canvas.width = width
  canvas.height = height

  const stage = layer.querySelector('.ce-stage')

  function fitScale() {
    if (!stage || !stage.clientWidth) return 1
    const availW = stage.clientWidth - 36
    const availH = stage.clientHeight - 36
    return Math.min(1, availW / canvas.width, availH / canvas.height)
  }

  function applyZoom() {
    const scale = zoom === 'fit' ? fitScale() : zoom
    canvas.style.width = `${Math.round(canvas.width * scale)}px`
    canvas.style.height = `${Math.round(canvas.height * scale)}px`
  }

  function stepZoom(direction) {
    const current = zoom === 'fit' ? fitScale() : zoom
    if (direction > 0) {
      const next = ZOOM_STEPS.find(step => step > current + 0.001)
      zoom = next ?? ZOOM_STEPS[ZOOM_STEPS.length - 1]
    } else {
      const lower = [...ZOOM_STEPS].reverse().find(step => step < current - 0.001)
      zoom = lower ?? ZOOM_STEPS[0]
    }
    applyZoom()
  }

  function toCanvasPoint(event) {
    const rect = canvas.getBoundingClientRect()
    return [
      (event.clientX - rect.left) * (canvas.width / rect.width),
      (event.clientY - rect.top) * (canvas.height / rect.height),
    ]
  }

  canvas.addEventListener('pointerdown', event => {
    if (tool === 'view') return
    event.preventDefault()
    painting = true
    canvas.setPointerCapture(event.pointerId)
    redo = []
    const point = toCanvasPoint(event)
    const stroke = { size: brush, erase: tool === 'erase', points: [point] }
    strokes.push(stroke)
    pending = stroke
    paintStroke(stroke)
  })
  canvas.addEventListener('pointermove', event => {
    if (!painting || !pending) return
    pending.points.push(toCanvasPoint(event))
    paintStroke(pending)
  })
  const endPaint = () => { painting = false; pending = null }
  canvas.addEventListener('pointerup', endPaint)
  canvas.addEventListener('pointercancel', endPaint)
  canvas.addEventListener('pointerleave', endPaint)

  function paintStroke(stroke) {
    maskCtx.save()
    maskCtx.globalCompositeOperation = stroke.erase ? 'destination-out' : 'source-over'
    maskCtx.strokeStyle = '#fff'
    maskCtx.lineCap = 'round'
    maskCtx.lineJoin = 'round'
    maskCtx.lineWidth = stroke.size
    maskCtx.beginPath()
    const [first] = stroke.points
    maskCtx.moveTo(first[0], first[1])
    for (const [x, y] of stroke.points.slice(1)) maskCtx.lineTo(x, y)
    if (stroke.points.length === 1) maskCtx.lineTo(first[0] + 0.01, first[1])
    maskCtx.stroke()
    maskCtx.restore()
    repaintMask()
    paint()
  }

  layer.querySelectorAll('#ce-tool [data-tool]').forEach(button => {
    button.addEventListener('click', () => {
      tool = button.dataset.tool
      layer.querySelectorAll('#ce-tool [data-tool]').forEach(other => other.classList.toggle('is-on', other === button))
      paint()
    })
  })
  layer.querySelectorAll('#ce-dir [data-dir]').forEach(button => {
    button.addEventListener('click', () => {
      expandDir = button.dataset.dir
      layer.querySelectorAll('#ce-dir [data-dir]').forEach(other => other.classList.toggle('is-on', other === button))
      applyExpand(expandPercent, expandDir)
    })
  })
  layer.querySelectorAll('#ce-expand [data-pct]').forEach(button => {
    button.addEventListener('click', () => {
      layer.querySelectorAll('#ce-expand [data-pct]').forEach(other => other.classList.toggle('is-on', other === button))
      applyExpand(Number(button.dataset.pct) / 100, expandDir)
    })
  })
  $('#ce-brush-size', layer).addEventListener('input', event => {
    brush = Number(event.target.value)
    $('#ce-brush-value', layer).textContent = String(brush)
  })
  layer.querySelector('[data-act="zoom-in"]').addEventListener('click', () => stepZoom(1))
  layer.querySelector('[data-act="zoom-out"]').addEventListener('click', () => stepZoom(-1))
  layer.querySelector('[data-act="undo"]').addEventListener('click', () => {
    const stroke = strokes.pop()
    if (!stroke) return
    redo.push(stroke)
    rebuildMask()
  })
  layer.querySelector('[data-act="redo"]').addEventListener('click', () => {
    const stroke = redo.pop()
    if (!stroke) return
    strokes.push(stroke)
    rebuildMask()
  })

  function rebuildMask() {
    maskCtx.clearRect(0, 0, maskCanvas.width, maskCanvas.height)
    for (const stroke of strokes) paintStroke(stroke)
    repaintMask()
    paint()
  }

  const close = app.showLayer(layer, { className: 'layer-canvas-editor' })
  layer.querySelector('[data-act="close"]').addEventListener('click', () => close())
  layer.querySelector('[data-act="cancel"]').addEventListener('click', () => close())
  layer.querySelector('[data-act="apply"]').addEventListener('click', () => {
    const result = { mask: maskCanvas, expand: { ...expandState } }
    close()
    onApply?.(result)
  })
  document.addEventListener('keydown', function onKey(event) {
    if (event.key === 'Escape') {
      close()
      document.removeEventListener('keydown', onKey)
    }
  })
  applyZoom()
  repaintMask()
  paint()
  requestAnimationFrame(() => { applyZoom(); paint() })
  return layer
}
