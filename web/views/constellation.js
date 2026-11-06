import { api, fileUrl } from '../lib/api.js'
import { $, $$, clamp, debounce, downloadJson, esc, fmtTime } from '../lib/dom.js'
import { icon } from '../lib/icons.js'
import { app, t } from '../lib/state.js'
import { NODE_TYPES } from './constellation-model.js'

const W = 252
const PORT_TOP = 62
const PORT_GAP = 26

export function mount(root) {
  const graphs = () => app.state?.graphs ?? []
  let graph = null
  let selected = null
  let selectedEdge = null
  let transform = { x: 60, y: 40, k: 1 }
  let dirty = false
  let drag = null
  let pan = null
  let connect = null
  let undoStack = []
  let redoStack = []
  let saveTimer = null
  let mounted = true

  root.innerHTML = `
    <section class="bench bench-graph">
      <aside class="graph-palette">
        <div class="palette-head">
          <span class="eyebrow">${esc(t('节点库', 'NODES'))}</span>
          <p>${esc(t('点一下加到画布', 'Click to add'))}</p>
        </div>
        <div class="palette-list" id="palette">
          ${Object.entries(NODE_TYPES).map(([type, def]) => `<button type="button" class="palette-item" data-add="${type}" style="--c:${def.color}">
            <span class="palette-ic">${icon(def.icon, 17)}</span>
            <span><b>${esc(def.label)}</b><small>${esc(def.hint)}</small></span>
            <span class="palette-plus">${icon('plus', 13)}</span>
          </button>`).join('')}
        </div>
        <div class="palette-foot">
          <span class="field-label">${esc(t('从模板开始', 'START FROM'))}</span>
          <div class="template-list" id="templates">
            <button type="button" data-template="inspiration"><b>${esc(t('灵感成片', 'Spark to frame'))}</b><small>${esc(t('提示词 → 写作 → 画面', 'Prompt → writing → image'))}</small></button>
            <button type="button" data-template="card"><b>${esc(t('图文卡片', 'Postcard'))}</b><small>${esc(t('短句 + 极简配图', 'Line + minimal image'))}</small></button>
            <button type="button" data-template="video"><b>${esc(t('短片分镜', 'Short film'))}</b><small>${esc(t('旁白 → 首帧 → 视频', 'Voice → frame → video'))}</small></button>
          </div>
          <p class="palette-tip">${icon('info', 13)} ${esc(t('星图必须是 DAG，连线时自动检查类型和环路。', 'The graph must stay a DAG; connections check type and cycles.'))}</p>
        </div>
      </aside>

      <section class="graph-main">
        <header class="graph-toolbar">
          <div class="graph-id">
            <details class="menu graph-switch" id="graph-switch">
              <summary class="icon-btn" title="${esc(t('切换或新建星图', 'Switch or create graph'))}">${icon('layers', 15)}</summary>
              <div class="menu-panel menu-graphs" id="graph-menu"></div>
            </details>
            <input id="graph-name" class="graph-name" maxlength="40" aria-label="${esc(t('星图名称', 'Graph name'))}">
          </div>
          <div class="graph-actions">
            <span class="graph-status" id="graph-status"></span>
            <button class="btn btn-small btn-primary" id="run">${icon('play', 13)}${esc(t('运行', 'Run'))}</button>
            <button class="btn btn-small btn-ghost" id="stop" hidden>${icon('stop', 13)}${esc(t('停止', 'Stop'))}</button>
            <span class="tool-sep"></span>
            <button class="icon-btn" id="undo" title="${esc(t('撤销', 'Undo'))}">${icon('undo', 15)}</button>
            <button class="icon-btn" id="redo" title="${esc(t('重做', 'Redo'))}">${icon('redo', 15)}</button>
            <button class="icon-btn inspector-toggle" id="toggle-inspector" title="${esc(t('节点参数', 'Node settings'))}">${icon('settings', 15)}</button>
            <button class="icon-btn" id="fit" title="${esc(t('适应画布 (F)', 'Fit (F)'))}">${icon('fit', 15)}</button>
            <details class="menu" id="more-menu">
              <summary class="icon-btn" title="${esc(t('更多', 'More'))}">${icon('more', 16)}</summary>
              <div class="menu-panel">
                <button type="button" data-menu="new">${icon('plus', 14)}${esc(t('新建空白星图', 'New blank graph'))}</button>
                <button type="button" data-menu="save-blueprint">${icon('layers', 14)}${esc(t('保存为蓝图', 'Save as blueprint'))}</button>
                <span class="menu-label">${esc(t('我的蓝图', 'MY BLUEPRINTS'))}</span>
                <div id="blueprint-list" class="menu-blueprints"></div>
                <div class="menu-sep"></div>
                <button type="button" data-menu="import">${icon('upload', 14)}${esc(t('导入 JSON', 'Import JSON'))}</button>
                <button type="button" data-menu="export">${icon('download', 14)}${esc(t('导出 JSON', 'Export JSON'))}</button>
                <div class="menu-sep"></div>
                <button type="button" data-menu="delete" class="danger-quiet">${icon('trash', 14)}${esc(t('删除这张星图', 'Delete graph'))}</button>
              </div>
            </details>
          </div>
        </header>

        <div class="graph-canvas" id="canvas">
          <div class="world" id="world">
            <svg class="edge-layer" id="edges" width="12000" height="12000" aria-hidden="true"></svg>
            <div class="node-layer" id="nodes"></div>
          </div>
          <div class="canvas-empty" id="canvas-empty">
            <div class="empty-art">${icon('star', 30)}</div>
            <h3>${esc(t('把一句话，接成一条线', 'Wire a line into a flow'))}</h3>
            <p>${esc(t('从左边加节点，或选一个模板。从节点右侧的圆点拖到另一个节点，就连起来了。', 'Add nodes from the left, or pick a template. Drag from a dot on the right edge to connect.'))}</p>
          </div>
          <div class="canvas-hints">
            <span>${esc(t('滚轮缩放', 'Wheel to zoom'))}</span><span>${esc(t('拖动画布', 'Drag to pan'))}</span><span>${esc(t('双击加提示词', 'Double-click for a prompt'))}</span>
          </div>
          <div class="zoom-tools">
            <button class="icon-btn" id="zoom-in" title="+">${icon('zoomIn', 15)}</button>
            <span id="zoom-label">100%</span>
            <button class="icon-btn" id="zoom-out" title="-">${icon('zoomOut', 15)}</button>
          </div>
          <input type="file" id="import-file" accept="application/json,.json" hidden>
        </div>
      </section>

      <aside class="graph-inspector" id="inspector"></aside>
    </section>
  `

  const canvas = $('#canvas')
  const world = $('#world')
  const nodesEl = $('#nodes')
  const edgesEl = $('#edges')

  // 选择初始星图
  const savedId = sessionStorage.getItem('media-workbench-modern:graph')
  graph = graphs().find(row => row.id === savedId) ?? graphs()[0] ?? null
  if (graph) {
    graph = clone(graph)
    sessionStorage.setItem('media-workbench-modern:graph', graph.id)
  }

  function clone(value) {
    return JSON.parse(JSON.stringify(value))
  }

  function activeGraph() {
    return graph
  }

  function bound() {
    return { width: canvas.clientWidth, height: canvas.clientHeight }
  }

  function applyTransform() {
    world.style.transform = `translate(${transform.x}px, ${transform.y}px) scale(${transform.k})`
    $('#zoom-label').textContent = `${Math.round(transform.k * 100)}%`
  }

  function screenToWorld(clientX, clientY) {
    const rect = canvas.getBoundingClientRect()
    return {
      x: (clientX - rect.left - transform.x) / transform.k,
      y: (clientY - rect.top - transform.y) / transform.k,
    }
  }

  // ---------- 渲染 ----------
  function nodeHtml(node) {
    const def = NODE_TYPES[node.type]
    const status = node.status ?? 'idle'
    const isSelected = selected === node.id
    const inputs = def.inputs.map((port, index) => `
      <span class="port port-in" data-node="${node.id}" data-port="${port.id}" data-dir="in" style="top:${PORT_TOP + index * PORT_GAP}px" title="${esc(port.type)}">
        <i></i><em>${esc(portLabel(port.type))}</em>
      </span>`).join('')
    const outputs = def.outputs.map((port, index) => `
      <span class="port port-out" data-node="${node.id}" data-port="${port.id}" data-dir="out" style="top:${PORT_TOP + index * PORT_GAP}px" title="${esc(port.type)}">
        <em>${esc(portLabel(port.type))}</em><i></i>
      </span>`).join('')
    return `<article class="gnode ${isSelected ? 'is-selected' : ''}" data-node-id="${node.id}" data-type="${node.type}" data-status="${status}" style="left:${node.x}px;top:${node.y}px;width:${W}px;--c:${def.color}">
      <header class="gnode-head" data-drag="1">
        <span class="gnode-ic">${icon(def.icon, 14)}</span>
        <span class="gnode-title">${esc(def.label)}</span>
        <span class="gnode-status" title="${esc(status)}"></span>
      </header>
      <div class="gnode-body">${bodyHtml(node)}</div>
      <div class="gnode-foot"><span>${esc(footText(node))}</span>${node.output?.kind === 'text' ? `<button class="gnode-open" data-open-text="${node.id}">${esc(t('看全文', 'Open'))}</button>` : ''}</div>
      ${inputs}${outputs}
    </article>`
  }

  function portLabel(type) {
    return { text: t('文本', 'text'), image: t('图像', 'image'), video: t('视频', 'video'), media: t('作品', 'media') }[type] ?? type
  }

  function bodyHtml(node) {
    const config = node.config ?? {}
    if (node.status === 'running') return `<div class="node-running"><i></i><span>${esc(t('正在运行…', 'Running…'))}</span></div>`
    if (node.status === 'error') return `<p class="node-error">${esc(node.error || t('运行失败', 'Failed'))}</p>`
    if (node.type === 'prompt' || node.type === 'note') {
      return `<p class="node-text">${esc(config.text || (node.type === 'prompt' ? t('双击写一句提示…', 'Write a prompt…') : t('写点备注…', 'A note…')))}</p>`
    }
    if (node.type === 'write') {
      const out = node.output?.text
      return `<p class="node-text">${esc(out || config.instruction || '')}</p><div class="node-tags"><span>${esc(config.tone || '自然叙述')}</span><span>${esc(lengthLabel(config.length))}</span></div>`
    }
    if (node.type === 'image') {
      if (node.output?.file) return `<div class="node-media"><img src="${fileUrl(node.output.file)}" alt="" loading="lazy"></div>`
      return `<div class="node-placeholder">${icon('image', 18)}<span>${esc(config.style || '电影感')} · ${esc(config.ratio || '16:9')}</span></div>${config.prompt ? `<p class="node-text">${esc(config.prompt)}</p>` : ''}`
    }
    if (node.type === 'video') {
      if (node.output?.file) return `<div class="node-media"><video src="${fileUrl(node.output.file)}" muted preload="metadata" playsinline></video><span class="media-badge">${icon('film', 12)}</span></div>`
      if (node.output?.frames?.length) return `<div class="node-strip">${node.output.frames.slice(0, 4).map(file => `<img src="${fileUrl(file)}" alt="">`).join('')}</div>`
      return `<div class="node-placeholder">${icon('film', 18)}<span>${esc(config.duration || 5)}s · ${esc(config.ratio || '16:9')} · ${esc(modeLabel(config.mode))}</span></div>`
    }
    if (node.type === 'preview') {
      const out = node.output
      if (out?.kind === 'image') return `<div class="node-media"><img src="${fileUrl(out.file)}" alt=""></div>`
      if (out?.kind === 'video') {
        if (out.file) return `<div class="node-media"><video src="${fileUrl(out.file)}" muted preload="metadata" playsinline controls></video></div>`
        if (out.frames?.length) return `<div class="node-strip">${out.frames.slice(0, 4).map(file => `<img src="${fileUrl(file)}" alt="">`).join('')}</div>`
      }
      if (out?.kind === 'text') return `<p class="node-text">${esc(out.text)}</p>`
      return `<div class="node-placeholder">${icon('eye', 18)}<span>${esc(t('运行后在这里看作品', 'Output appears here'))}</span></div>`
    }
    return ''
  }

  function lengthLabel(value) {
    return { short: '短', medium: '中', long: '长' }[value] ?? '中'
  }

  function modeLabel(value) {
    return { auto: t('自动', 'auto'), text: t('文生', 'text'), storyboard: t('分镜', 'storyboard'), image: t('图生', 'image') }[value] ?? t('自动', 'auto')
  }

  function footText(node) {
    if (node.status === 'running') return t('进行中', 'Running')
    if (node.status === 'error') return t('失败', 'Error')
    if (node.output) return t('已完成', 'Done') + (node.output.kind === 'image' ? ' · image' : node.output.kind === 'video' ? ' · video' : '')
    const def = NODE_TYPES[node.type]
    return def?.hint ?? ''
  }

  function nodePortY(node, portId, dir) {
    const def = NODE_TYPES[node.type]
    const index = (dir === 'in' ? def.inputs : def.outputs).findIndex(port => port.id === portId)
    return node.y + PORT_TOP + Math.max(0, index) * PORT_GAP
  }

  function edgePath(edge) {
    const from = graph.nodes.find(node => node.id === edge.from.node)
    const to = graph.nodes.find(node => node.id === edge.to.node)
    if (!from || !to) return ''
    const x1 = from.x + W
    const y1 = nodePortY(from, edge.from.port, 'out')
    const x2 = to.x
    const y2 = nodePortY(to, edge.to.port, 'in')
    const dx = Math.max(36, Math.abs(x2 - x1) * 0.45)
    return `M ${x1} ${y1} C ${x1 + dx} ${y1}, ${x2 - dx} ${y2}, ${x2} ${y2}`
  }

  function renderEdges() {
    if (!graph) { edgesEl.innerHTML = ''; return }
    const defs = `<defs><marker id="edge-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path class="edge-arrow" d="M 0 0 L 10 5 L 0 10 z"></path></marker></defs>`
    edgesEl.innerHTML = defs + graph.edges.map(edge => {
      const path = edgePath(edge)
      if (!path) return ''
      return `<g class="edge ${selectedEdge === edge.id ? 'is-selected' : ''}" data-edge-id="${edge.id}">
        <path class="edge-hit" d="${path}"></path>
        <path class="edge-line" d="${path}" marker-end="url(#edge-arrow)"></path>
      </g>`
    }).join('') + (connect?.temp ? `<path class="edge-temp" d="${connect.temp}"></path>` : '')
  }

  function renderNodes() {
    if (!graph) { nodesEl.innerHTML = ''; return }
    nodesEl.innerHTML = graph.nodes.map(nodeHtml).join('')
    renderEdges()
    $('#canvas-empty').hidden = graph.nodes.length > 0
    const nameEl = $('#graph-name')
    if (nameEl && document.activeElement !== nameEl) nameEl.value = graph.name ?? ''
    paintGraphSelect()
    paintStatus()
    renderInspector()
  }

  function paintGraphSelect() {
    const menu = $('#graph-menu')
    if (!menu) return
    menu.innerHTML = graphs().map(row => `<button type="button" data-graph="${row.id}" class="${row.id === graph?.id ? 'is-current' : ''}">${icon(row.id === graph?.id ? 'check' : 'layers', 13)}<span>${esc(row.name)}</span></button>`).join('')
      + `<div class="menu-sep"></div><button type="button" data-new-graph>${icon('plus', 13)}${esc(t('新建空白星图', 'New blank graph'))}</button>`
    const blueprints = app.state?.blueprints ?? []
    const list = $('#blueprint-list')
    if (list) {
      list.innerHTML = blueprints.length
        ? blueprints.slice(0, 8).map(row => `<button type="button" data-blueprint="${row.id}">${icon('layers', 13)}<span>${esc(row.name || '蓝图')}</span></button>`).join('')
        : `<p class="menu-empty">${esc(t('还没有保存过蓝图', 'No blueprints yet'))}</p>`
    }
  }

  function paintStatus() {
    const el = $('#graph-status')
    if (!graph) { el.textContent = ''; return }
    const run = graph.run
    if (run?.status === 'running') {
      el.className = 'graph-status is-running'
      el.innerHTML = `<i></i>${esc(t('运行中', 'Running'))} ${run.wave ?? 1}/${run.waves ?? 1}`
    } else if (run?.status === 'done') {
      el.className = 'graph-status is-done'
      el.innerHTML = `${icon('check', 12)}${esc(t('运行完成', 'Finished'))}`
    } else if (run?.status === 'error') {
      el.className = 'graph-status is-error'
      el.innerHTML = `${icon('alert', 12)}${esc(run.error || t('有节点失败', 'Some nodes failed'))}`
    } else if (run?.status === 'stopped') {
      el.className = 'graph-status'
      el.textContent = t('已停止', 'Stopped')
    } else if (dirty) {
      el.className = 'graph-status is-saving'
      el.textContent = t('保存中…', 'Saving…')
    } else {
      el.className = 'graph-status'
      el.textContent = ''
    }
    const running = run?.status === 'running'
    $('#run').disabled = running
    $('#stop').hidden = !running
    $('#graph-name').disabled = running
  }

  // ---------- 检查器 ----------
  function renderInspector() {
    const host = $('#inspector')
    if (selectedEdge) {
      host.innerHTML = `<div class="inspect-head"><span class="eyebrow">${esc(t('连线', 'EDGE'))}</span><button class="icon-btn" data-inspect-close>${icon('x', 15)}</button></div>
        <p class="inspect-help">${esc(t('这条线把上游的输出接到下游的输入。按 Delete 删除。', 'This edge feeds an upstream output into a downstream input. Press Delete to remove.'))}</p>
        <button class="btn btn-small btn-ghost danger-quiet" data-delete-edge>${icon('trash', 13)}${esc(t('删除连线', 'Delete edge'))}</button>`
      host.querySelector('[data-inspect-close]').addEventListener('click', () => {
        selectedEdge = null
        document.querySelector('.bench-graph')?.classList.remove('is-inspector-open')
        renderNodes()
      })
      host.querySelector('[data-delete-edge]').addEventListener('click', () => deleteEdge(selectedEdge))
      return
    }
    const node = graph?.nodes.find(item => item.id === selected)
    if (!node) {
      host.innerHTML = `<div class="inspect-empty"><span class="inspect-art">${icon('star', 24)}</span>
        <h3>${esc(t('选中一个节点', 'Select a node'))}</h3>
        <p>${esc(t('在画布上点节点，这里会出现参数；点空白处取消选择。', 'Click a node to edit its settings. Click empty space to deselect.'))}</p>
        <div class="inspect-legend">
          <span><i style="background:#d97757"></i>${esc(t('提示词', 'Prompt'))}</span>
          <span><i style="background:#b4833e"></i>${esc(t('写作', 'Writing'))}</span>
          <span><i style="background:#8a6fd1"></i>${esc(t('图像', 'Image'))}</span>
          <span><i style="background:#3f8f92"></i>${esc(t('视频', 'Video'))}</span>
        </div></div>`
      return
    }
    const def = NODE_TYPES[node.type]
    host.innerHTML = `<div class="inspect-head">
        <div><span class="eyebrow">${esc(def.label)}</span><h3>${esc(t('节点参数', 'Node settings'))}</h3></div>
        <button class="icon-btn" data-inspect-close>${icon('x', 15)}</button>
      </div>
      <div class="inspect-fields" id="inspect-fields">${fieldsHtml(node)}</div>
      ${node.error ? `<p class="inspect-error">${esc(node.error)}</p>` : ''}
      ${outputHtml(node)}
      <div class="inspect-actions">
        <button class="btn btn-small btn-primary" data-run-node>${icon('play', 13)}${esc(t('运行到这里', 'Run to here'))}</button>
        <button class="btn btn-small btn-ghost" data-dup-node>${icon('duplicate', 13)}${esc(t('复制', 'Duplicate'))}</button>
        <button class="btn btn-small btn-ghost danger-quiet" data-del-node>${icon('trash', 13)}</button>
      </div>`
    host.querySelector('[data-inspect-close]').addEventListener('click', () => {
      selected = null
      document.querySelector('.bench-graph')?.classList.remove('is-inspector-open')
      renderNodes()
    })
    host.querySelector('[data-run-node]').addEventListener('click', () => run([node.id]))
    host.querySelector('[data-dup-node]').addEventListener('click', () => duplicateNode(node.id))
    host.querySelector('[data-del-node]').addEventListener('click', () => deleteNode(node.id))
    bindFields(node)
    const open = host.querySelector('[data-open-output]')
    if (open) open.addEventListener('click', () => openOutput(node))
  }

  function fieldsHtml(node) {
    const c = node.config ?? {}
    if (node.type === 'prompt') {
      return `<label class="field"><span class="field-label">${esc(t('提示词', 'Prompt'))}</span>
        <textarea rows="5" data-field="text">${esc(c.text ?? '')}</textarea></label>
        <p class="inspect-help">${esc(t('这是流程的起点。把一句话写清楚，下游的写作和画面都会读到它。', 'The start of the flow. One clear line feeds everything downstream.'))}</p>`
    }
    if (node.type === 'note') {
      return `<label class="field"><span class="field-label">${esc(t('便签', 'Note'))}</span><textarea rows="4" data-field="text">${esc(c.text ?? '')}</textarea></label>`
    }
    if (node.type === 'write') {
      return `<label class="field"><span class="field-label">${esc(t('写作指令', 'Instruction'))}</span>
          <textarea rows="4" data-field="instruction">${esc(c.instruction ?? '')}</textarea></label>
        <div class="field-row">
          <label class="field"><span class="field-label">${esc(t('文风', 'Voice'))}</span>
            <select class="select" data-field="tone">${['自然叙述', '克制冷静', '热烈', '幽默', '诗意', '硬朗'].map(v => `<option ${v === c.tone ? 'selected' : ''}>${v}</option>`).join('')}</select></label>
          <label class="field"><span class="field-label">${esc(t('篇幅', 'Length'))}</span>
            <select class="select" data-field="length">${[['short', '短 · 400 字'], ['medium', '中 · 900 字'], ['long', '长 · 1600 字']].map(([v, label]) => `<option value="${v}" ${v === c.length ? 'selected' : ''}>${label}</option>`).join('')}</select></label>
        </div>
        <p class="inspect-help">${esc(t('会读取所有接进来的文本，再按指令写。', 'Reads every incoming text connection, then writes to the instruction.'))}</p>`
    }
    if (node.type === 'image') {
      return `<label class="field"><span class="field-label">${esc(t('补充画面描述', 'Extra prompt'))}</span>
          <textarea rows="3" data-field="prompt" placeholder="${esc(t('可选：补充上游没有说到的细节', 'Optional details to add'))}">${esc(c.prompt ?? '')}</textarea></label>
        <div class="field-row">
          <label class="field"><span class="field-label">${esc(t('风格', 'Style'))}</span>
            <select class="select" data-field="style">${['电影感', '插画', '水墨', '赛博朋克', '胶片', '3D', '极简', '浮世绘', '概念艺术'].map(v => `<option ${v === c.style ? 'selected' : ''}>${v}</option>`).join('')}</select></label>
          <label class="field"><span class="field-label">${esc(t('画幅', 'Aspect'))}</span>
            <select class="select" data-field="ratio">${['1:1', '4:3', '3:2', '16:9', '9:16', '2:3'].map(v => `<option ${v === c.ratio ? 'selected' : ''}>${v}</option>`).join('')}</select></label>
        </div>
        <p class="inspect-help">${esc(t('上游的文本会作为提示词，上游的图像会作为参考图。', 'Incoming text becomes the prompt; an incoming image becomes the reference.'))}</p>`
    }
    if (node.type === 'video') {
      return `<label class="field"><span class="field-label">${esc(t('补充描述', 'Extra prompt'))}</span>
          <textarea rows="3" data-field="prompt">${esc(c.prompt ?? '')}</textarea></label>
        <div class="field-row">
          <label class="field"><span class="field-label">${esc(t('时长', 'Seconds'))}</span>
            <select class="select" data-field="duration">${[5, 8, 10, 15].map(v => `<option value="${v}" ${Number(c.duration) === v ? 'selected' : ''}>${v}s</option>`).join('')}</select></label>
          <label class="field"><span class="field-label">${esc(t('画幅', 'Aspect'))}</span>
            <select class="select" data-field="ratio">${['1:1', '4:3', '3:2', '16:9', '9:16', '2:3'].map(v => `<option ${v === c.ratio ? 'selected' : ''}>${v}</option>`).join('')}</select></label>
        </div>
        <label class="field"><span class="field-label">${esc(t('模式', 'Mode'))}</span>
          <select class="select" data-field="mode">
            <option value="auto" ${c.mode === 'auto' ? 'selected' : ''}>${esc(t('自动（有首帧就走图生）', 'Auto'))}</option>
            <option value="text" ${c.mode === 'text' ? 'selected' : ''}>${esc(t('文生视频', 'Text to video'))}</option>
            <option value="storyboard" ${c.mode === 'storyboard' ? 'selected' : ''}>${esc(t('分镜短片（用生图）', 'Storyboard (image provider)'))}</option>
          </select></label>`
    }
    if (node.type === 'preview') {
      return `<p class="inspect-help">${esc(t('把接进来的作品显示出来。可以同时接图像、视频和文本。', 'Shows whatever is connected: image, video or text.'))}</p>`
    }
    return ''
  }

  function outputHtml(node) {
    if (!node.output) return ''
    const out = node.output
    if (out.kind === 'image') {
      return `<div class="inspect-output"><span class="field-label">${esc(t('产出', 'Output'))}</span><img src="${fileUrl(out.file)}" alt=""><button class="text-btn" data-open-output>${esc(t('查看 / 下载', 'Open / download'))}</button></div>`
    }
    if (out.kind === 'video') {
      return `<div class="inspect-output"><span class="field-label">${esc(t('产出', 'Output'))}</span>${out.file ? `<video src="${fileUrl(out.file)}" controls preload="metadata" playsinline></video>` : `<div class="node-strip">${(out.frames ?? []).map(file => `<img src="${fileUrl(file)}" alt="">`).join('')}</div>`}<button class="text-btn" data-open-output>${esc(t('查看 / 下载', 'Open / download'))}</button></div>`
    }
    if (out.kind === 'text') {
      return `<div class="inspect-output"><span class="field-label">${esc(t('产出', 'Output'))}</span><p class="inspect-text">${esc(out.text)}</p></div>`
    }
    return ''
  }

  function bindFields(node) {
    $('#inspect-fields')?.querySelectorAll('[data-field]').forEach(el => {
      const field = el.dataset.field
      const handler = () => {
        if (!node.config) node.config = {}
        node.config[field] = el.type === 'number' ? Number(el.value) : el.value
        dirty = true
        paintStatus()
        scheduleSave()
        // 只更新该节点的预览，避免输入框失焦
        const nodeEl = nodesEl.querySelector(`[data-node-id="${node.id}"] .gnode-body`)
        if (nodeEl) nodeEl.innerHTML = bodyHtml(node)
        const foot = nodesEl.querySelector(`[data-node-id="${node.id}"] .gnode-foot span`)
        if (foot) foot.textContent = footText(node)
      }
      el.addEventListener(el.tagName === 'SELECT' ? 'change' : 'input', handler)
    })
  }

  function openOutput(node) {
    const out = node.output
    if (!out) return
    if (out.kind === 'image') {
      const layer = document.createElement('div')
      layer.className = 'output-lightbox'
      layer.innerHTML = `<img src="${fileUrl(out.file)}" alt=""><div class="output-bar"><span>${out.width ? `${out.width} × ${out.height}` : ''}</span><a class="btn btn-small btn-ghost" href="${fileUrl(out.file)}" download>${icon('download', 13)}${esc(t('下载', 'Download'))}</a></div>`
      app.showLayer(layer, { className: 'layer-lightbox' })
    } else if (out.kind === 'video') {
      window.open(fileUrl(out.file), '_blank', 'noopener')
    }
  }

  // ---------- 图操作 ----------
  function addNode(type, x, y) {
    if (!graph) return
    const def = NODE_TYPES[type]
    const node = {
      id: `n_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`,
      type,
      x: Math.round(x),
      y: Math.round(y),
      config: { ...def.defaults },
      status: 'idle',
      output: null,
      error: '',
    }
    pushHistory()
    graph.nodes.push(node)
    selected = node.id
    selectedEdge = null
    dirty = true
    renderNodes()
    scheduleSave()
  }

  function deleteNode(id) {
    if (!graph) return
    const node = graph.nodes.find(item => item.id === id)
    if (!node) return
    pushHistory()
    graph.nodes = graph.nodes.filter(item => item.id !== id)
    graph.edges = graph.edges.filter(edge => edge.from.node !== id && edge.to.node !== id)
    if (selected === id) selected = null
    dirty = true
    renderNodes()
    scheduleSave()
  }

  function duplicateNode(id) {
    if (!graph) return
    const source = graph.nodes.find(item => item.id === id)
    if (!source) return
    pushHistory()
    const copy = clone(source)
    copy.id = `n_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`
    copy.x += 36
    copy.y += 36
    copy.status = 'idle'
    copy.output = null
    copy.error = ''
    graph.nodes.push(copy)
    selected = copy.id
    dirty = true
    renderNodes()
    scheduleSave()
  }

  function deleteEdge(id) {
    if (!graph) return
    pushHistory()
    graph.edges = graph.edges.filter(edge => edge.id !== id)
    selectedEdge = null
    dirty = true
    renderNodes()
    scheduleSave()
  }

  function connectPorts(from, to) {
    if (!graph) return
    const check = canConnectLocal(graph, from, to)
    if (!check.ok) {
      app.toast(check.reason, 'error')
      return
    }
    pushHistory()
    graph.edges.push({
      id: `e_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`,
      from,
      to,
    })
    dirty = true
    renderNodes()
    scheduleSave()
  }

  function canConnectLocal(g, from, to) {
    if (!from || !to) return { ok: false, reason: '连接不完整' }
    if (from.node === to.node) return { ok: false, reason: t('不能连接自己', 'Cannot connect a node to itself') }
    const source = g.nodes.find(n => n.id === from.node)
    const target = g.nodes.find(n => n.id === to.node)
    if (!source || !target) return { ok: false, reason: t('节点不存在', 'Node missing') }
    const out = (NODE_TYPES[source.type].outputs ?? []).find(p => p.id === from.port)
    const input = (NODE_TYPES[target.type].inputs ?? []).find(p => p.id === to.port)
    if (!out || !input) return { ok: false, reason: t('端口不存在', 'Port missing') }
    if (out.type !== input.type && input.type !== 'media') return { ok: false, reason: t('端口类型不匹配', 'Port types do not match') }
    if (g.edges.some(e => e.from.node === from.node && e.from.port === from.port && e.to.node === to.node && e.to.port === to.port)) return { ok: false, reason: t('已经连过了', 'Already connected') }
    if (!input.multi && g.edges.some(e => e.to.node === to.node && e.to.port === to.port)) return { ok: false, reason: t('这个输入只能接一条线', 'This input takes one connection') }
    if (createsCycle(g, from.node, to.node)) return { ok: false, reason: t('会形成环路', 'This would create a cycle') }
    return { ok: true }
  }

  function createsCycle(g, fromNode, toNode) {
    const adj = new Map()
    for (const edge of g.edges) {
      if (!adj.has(edge.from.node)) adj.set(edge.from.node, [])
      adj.get(edge.from.node).push(edge.to.node)
    }
    if (!adj.has(fromNode)) adj.set(fromNode, [])
    adj.get(fromNode).push(toNode)
    const seen = new Set()
    const stack = [toNode]
    while (stack.length) {
      const cur = stack.pop()
      if (cur === fromNode) return true
      if (seen.has(cur)) continue
      seen.add(cur)
      for (const next of adj.get(cur) ?? []) stack.push(next)
    }
    return false
  }

  // ---------- 撤销 ----------
  function snapshot() {
    return JSON.stringify({ nodes: graph.nodes, edges: graph.edges })
  }

  function pushHistory() {
    if (!graph) return
    undoStack.push(snapshot())
    if (undoStack.length > 60) undoStack.shift()
    redoStack = []
    paintHistoryButtons()
  }

  function restore(json) {
    const data = JSON.parse(json)
    graph.nodes = data.nodes
    graph.edges = data.edges
    selected = null
    selectedEdge = null
    dirty = true
    renderNodes()
    scheduleSave()
  }

  function undo() {
    if (!undoStack.length) return
    redoStack.push(snapshot())
    restore(undoStack.pop())
    paintHistoryButtons()
  }

  function redo() {
    if (!redoStack.length) return
    undoStack.push(snapshot())
    restore(redoStack.pop())
    paintHistoryButtons()
  }

  function paintHistoryButtons() {
    $('#undo').disabled = !undoStack.length
    $('#redo').disabled = !redoStack.length
  }
  paintHistoryButtons()

  // ---------- 保存与切换 ----------
  const scheduleSave = debounce(() => { void saveNow() }, 700)

  async function saveNow() {
    if (!graph) return
    paintStatus()
    try {
      const payload = {
        id: graph.id,
        name: graph.name,
        nodes: graph.nodes.map(node => ({ id: node.id, type: node.type, x: node.x, y: node.y, config: node.config })),
        edges: graph.edges.map(edge => ({ id: edge.id, from: edge.from, to: edge.to })),
      }
      const data = await api('graph/save', { graph: payload })
      graph.updatedAt = data.graph.updatedAt
      const index = app.state.graphs.findIndex(row => row.id === graph.id)
      if (index >= 0) app.state.graphs[index] = { ...app.state.graphs[index], ...data.graph, nodes: app.state.graphs[index].nodes }
      dirty = false
      paintStatus()
    } catch (err) {
      app.toast(err.message, 'error')
    }
  }

  async function switchGraph(id, { force = false } = {}) {
    if (!force && id === graph?.id) return
    if (dirty) await saveNow()
    const next = graphs().find(row => row.id === id)
    if (!next) return
    graph = clone(next)
    selected = null
    selectedEdge = null
    undoStack = []
    redoStack = []
    paintHistoryButtons()
    sessionStorage.setItem('media-workbench-modern:graph', graph.id)
    fitView(false)
    renderNodes()
    updateRunTimer()
  }

  $('#graph-menu').addEventListener('click', event => {
    const item = event.target.closest('[data-graph]')
    if (item) {
      $('#graph-switch').removeAttribute('open')
      switchGraph(item.dataset.graph)
      return
    }
    if (event.target.closest('[data-new-graph]')) {
      $('#graph-switch').removeAttribute('open')
      createGraph({})
    }
  })
  $('#graph-name').addEventListener('input', () => {
    if (!graph) return
    graph.name = $('#graph-name').value.slice(0, 40) || '未命名星图'
    dirty = true
    paintStatus()
    scheduleSave()
    paintGraphSelect()
  })

  $('#palette').addEventListener('click', event => {
    const btn = event.target.closest('[data-add]')
    if (!btn) return
    const rect = canvas.getBoundingClientRect()
    const point = screenToWorld(rect.left + rect.width / 2, rect.top + rect.height / 2)
    addNode(btn.dataset.add, point.x - W / 2 + (Math.random() * 60 - 30), point.y - 80 + (Math.random() * 60 - 30))
  })

  $('#templates').addEventListener('click', async event => {
    const btn = event.target.closest('[data-template]')
    if (!btn) return
    await createGraph({ template: btn.dataset.template })
  })

  $('#more-menu').addEventListener('click', async event => {
    const blueprint = event.target.closest('[data-blueprint]')
    if (blueprint) {
      $('#more-menu').removeAttribute('open')
      try {
        const data = await api('blueprint/use', { id: blueprint.dataset.blueprint })
        await app.refresh()
        await switchGraph(data.graph.id, { force: true })
        app.toast(t('蓝图已展开成新的星图', 'Blueprint opened as a new graph'), 'success')
      } catch (err) { app.toast(err.message, 'error') }
      return
    }
    const btn = event.target.closest('[data-menu]')
    if (!btn) return
    $('#more-menu').removeAttribute('open')
    const action = btn.dataset.menu
    if (action === 'new') await createGraph({})
    if (action === 'export') {
      if (!graph) return
      downloadJson({ schemaVersion: 1, name: graph.name, nodes: graph.nodes, edges: graph.edges }, `${graph.name || 'modern-media'}-star-map.json`)
    }
    if (action === 'import') $('#import-file').click()
    if (action === 'save-blueprint') {
      if (!graph) return
      try {
        await saveNow()
        await api('blueprint/save', { graph: { name: graph.name, nodes: graph.nodes, edges: graph.edges } })
        await app.refresh()
        app.toast(t('已保存为蓝图，下次可以整张复用', 'Saved as a blueprint'), 'success')
      } catch (err) { app.toast(err.message, 'error') }
    }
    if (action === 'delete') {
      if (!graph) return
      const ok = await app.confirm({ title: t('删除这张星图？', 'Delete this star map?'), message: t('画布和运行结果都会被移除。', 'The graph and its run results will be removed.'), confirmText: t('删除', 'Delete'), danger: true })
      if (!ok) return
      try {
        await api('graph/action', { id: graph.id, action: 'delete' })
        await app.refresh()
        const next = graphs()[0] ?? null
        if (next) { graph = clone(next); renderNodes(); fitView(false) } else { graph = null; renderNodes() }
      } catch (err) { app.toast(err.message, 'error') }
    }
  })

  $('#import-file').addEventListener('change', async () => {
    const file = $('#import-file').files?.[0]
    if (!file) return
    try {
      const text = await file.text()
      const payload = JSON.parse(text)
      const data = await api('graph/import', { payload })
      await app.refresh()
      await switchGraph(data.graph.id, { force: true })
      app.toast(t('星图已导入', 'Graph imported'), 'success')
    } catch (err) { app.toast(t('导入失败：', 'Import failed: ') + err.message, 'error') }
    $('#import-file').value = ''
  })

  async function createGraph(options) {
    try {
      if (dirty) await saveNow()
      const data = await api('graph/create', options)
      await app.refresh()
      await switchGraph(data.graph.id, { force: true })
      app.toast(t('星图已创建', 'Graph created'), 'success')
    } catch (err) { app.toast(err.message, 'error') }
  }

  // ---------- 运行 ----------
  let runTimer = null

  async function run(targets = []) {
    if (!graph) return
    if (!graph.nodes.length) {
      app.toast(t('先加几个节点', 'Add some nodes first'), 'error')
      return
    }
    try {
      await api('graph/run', { id: graph.id, targetIds: targets })
      graph.run = { status: 'running', wave: 0, waves: 1, targets }
      for (const node of graph.nodes) if (!targets.length || targets.includes(node.id)) { node.status = 'idle'; node.output = null; node.error = '' }
      selected = null
      renderNodes()
      paintStatus()
      app.toast(targets.length ? t('正在运行到选中的节点', 'Running to the selected node') : t('星图开始运行', 'Star map started'), 'success')
      updateRunTimer()
    } catch (err) { app.toast(err.message, 'error') }
  }

  function updateRunTimer() {
    if (runTimer) { clearInterval(runTimer); runTimer = null }
    if (graph?.run?.status !== 'running') return
    runTimer = setInterval(() => {
      if (!mounted) return
      if (document.hidden) return
      app.refresh().catch(() => {})
    }, 2000)
  }

  $('#run').addEventListener('click', () => run())
  $('#stop').addEventListener('click', async () => {
    try { await api('graph/stop', { id: graph.id }); app.toast(t('已停止', 'Stopped'), 'success') } catch (err) { app.toast(err.message, 'error') }
  })
  $('#undo').addEventListener('click', undo)
  $('#redo').addEventListener('click', redo)
  $('#fit').addEventListener('click', () => fitView(true))
  $('#toggle-inspector').addEventListener('click', () => {
    document.querySelector('.bench-graph')?.classList.toggle('is-inspector-open')
  })
  $('#zoom-in').addEventListener('click', () => zoomBy(1.2))
  $('#zoom-out').addEventListener('click', () => zoomBy(1 / 1.2))

  function zoomBy(factor) {
    const rect = canvas.getBoundingClientRect()
    zoomAt(rect.left + rect.width / 2, rect.top + rect.height / 2, factor)
  }

  function zoomAt(clientX, clientY, factor) {
    const next = clamp(transform.k * factor, 0.35, 2)
    const rect = canvas.getBoundingClientRect()
    const px = clientX - rect.left
    const py = clientY - rect.top
    const wx = (px - transform.x) / transform.k
    const wy = (py - transform.y) / transform.k
    transform = { x: px - wx * next, y: py - wy * next, k: next }
    applyTransform()
  }

  function fitView(animate = true) {
    if (!graph || !graph.nodes.length) {
      transform = { x: 60, y: 40, k: 1 }
      applyTransform()
      return
    }
    const minX = Math.min(...graph.nodes.map(n => n.x)) - 28
    const minY = Math.min(...graph.nodes.map(n => n.y)) - 64
    const maxX = Math.max(...graph.nodes.map(n => n.x + W)) + 28
    const maxY = Math.max(...graph.nodes.map(n => n.y + 230)) + 36
    const bw = maxX - minX
    const bh = maxY - minY
    const { width, height } = bound()
    let k = Math.min((width - 44) / bw, (height - 80) / bh)
    k = clamp(k, 0.42, 1.1)
    // 小图别缩得太小；但必须先保证放得下，宁可小一点也不要裁掉两端
    if (graph.nodes.length <= 4) {
      const ceiling = Math.min((width - 24) / bw, (height - 40) / bh, 0.66)
      k = Math.max(k, ceiling)
    }
    let x = (width - bw * k) / 2 - minX * k
    const leftLimit = 8 - minX * k
    const rightLimit = width - 8 - (minX + bw) * k
    if (rightLimit >= leftLimit) x = Math.max(leftLimit, Math.min(x, rightLimit))
    transform = { x, y: (height - bh * k) / 2 - minY * k, k }
    if (animate) world.classList.add('is-animating')
    applyTransform()
    if (animate) setTimeout(() => world.classList.remove('is-animating'), 420)
  }

  // ---------- 画布交互 ----------
  canvas.addEventListener('wheel', event => {
    if (event.target.closest('.graph-inspector')) return
    event.preventDefault()
    const factor = Math.exp(-event.deltaY * 0.0012)
    zoomAt(event.clientX, event.clientY, factor)
  }, { passive: false })

  canvas.addEventListener('dblclick', event => {
    if (event.target.closest('.gnode')) return
    const point = screenToWorld(event.clientX, event.clientY)
    addNode('prompt', point.x - W / 2, point.y - 60)
  })

  canvas.addEventListener('pointerdown', event => {
    const port = event.target.closest('.port-out')
    if (port) {
      event.preventDefault()
      event.stopPropagation()
      selected = port.dataset.node
      selectedEdge = null
      renderInspector()
      connect = { from: { node: port.dataset.node, port: port.dataset.port }, temp: '', pointer: { x: event.clientX, y: event.clientY } }
      world.classList.add('is-connecting')
      canvas.setPointerCapture?.(event.pointerId)
      return
    }
    const head = event.target.closest('.gnode-head')
    if (head) {
      const nodeEl = head.closest('.gnode')
      const node = graph?.nodes.find(item => item.id === nodeEl?.dataset.nodeId)
      if (!node) return
      event.preventDefault()
      selected = node.id
      selectedEdge = null
      nodesEl.querySelectorAll('.gnode').forEach(el => el.classList.toggle('is-selected', el.dataset.nodeId === node.id))
      if (window.innerWidth <= 1200) document.querySelector('.bench-graph')?.classList.add('is-inspector-open')
      renderInspector()
      pushHistory()
      const point = screenToWorld(event.clientX, event.clientY)
      drag = { id: node.id, dx: point.x - node.x, dy: point.y - node.y, moved: false }
      world.classList.add('is-dragging')
      canvas.setPointerCapture?.(event.pointerId)
      return
    }
    const nodeEl = event.target.closest('.gnode')
    if (nodeEl) {
      selected = nodeEl.dataset.nodeId
      selectedEdge = null
      if (window.innerWidth <= 1200) document.querySelector('.bench-graph')?.classList.add('is-inspector-open')
      renderNodes()
      return
    }
    const edge = event.target.closest('.edge')
    if (edge) {
      selectedEdge = edge.dataset.edgeId
      selected = null
      renderNodes()
      return
    }
    // 空白：平移；顺带取消选择
    if (event.button === 0) {
      selected = null
      selectedEdge = null
      renderNodes()
    }
    pan = { x: event.clientX, y: event.clientY, tx: transform.x, ty: transform.y, moved: false }
    world.classList.add('is-panning')
    canvas.setPointerCapture?.(event.pointerId)
  })

  function onPointerMove(event) {
    if (connect) {
      const point = screenToWorld(event.clientX, event.clientY)
      const from = graph.nodes.find(node => node.id === connect.from.node)
      if (!from) return
      const x1 = from.x + W
      const y1 = nodePortY(from, connect.from.port, 'out')
      const x2 = point.x
      const y2 = point.y
      const dx = Math.max(36, Math.abs(x2 - x1) * 0.45)
      connect.temp = `M ${x1} ${y1} C ${x1 + dx} ${y1}, ${x2 - dx} ${y2}, ${x2} ${y2}`
      renderEdges()
      return
    }
    if (drag) {
      const point = screenToWorld(event.clientX, event.clientY)
      const node = graph.nodes.find(item => item.id === drag.id)
      if (!node) return
      node.x = Math.max(-200, Math.round(point.x - drag.dx))
      node.y = Math.max(-200, Math.round(point.y - drag.dy))
      const el = nodesEl.querySelector(`[data-node-id="${node.id}"]`)
      if (el) { el.style.left = `${node.x}px`; el.style.top = `${node.y}px` }
      drag.moved = true
      renderEdges()
      return
    }
    if (pan) {
      transform.x = pan.tx + (event.clientX - pan.x)
      transform.y = pan.ty + (event.clientY - pan.y)
      pan.moved = true
      applyTransform()
    }
  }

  function onPointerUp(event) {
    if (connect) {
      const target = document.elementFromPoint(event.clientX, event.clientY)?.closest('.port-in')
      const from = connect.from
      connect = null
      world.classList.remove('is-connecting')
      if (target && target.dataset.node) {
        connectPorts(from, { node: target.dataset.node, port: target.dataset.port })
      } else {
        renderEdges()
      }
      return
    }
    if (drag) {
      const moved = drag.moved
      drag = null
      world.classList.remove('is-dragging')
      if (moved) {
        dirty = true
        scheduleSave()
        paintStatus()
      }
      return
    }
    if (pan) {
      const moved = pan.moved
      pan = null
      world.classList.remove('is-panning')
      if (moved) {
        // 平移不写回文档
      }
    }
  }

  window.addEventListener('pointermove', onPointerMove)
  window.addEventListener('pointerup', onPointerUp)
  window.addEventListener('pointercancel', onPointerUp)

  canvas.addEventListener('click', event => {
    const openText = event.target.closest('[data-open-text]')
    if (openText) {
      const node = graph.nodes.find(item => item.id === openText.dataset.openText)
      const text = node?.output?.text ?? ''
      const layer = document.createElement('div')
      layer.className = 'text-layer'
      layer.innerHTML = `<div class="text-layer-head"><span class="eyebrow">${esc(t('节点全文', 'NODE TEXT'))}</span><button class="icon-btn" data-close>${icon('x', 15)}</button></div><pre>${esc(text)}</pre>`
      const close = app.showLayer(layer, { className: 'layer-text' })
      layer.querySelector('[data-close]').addEventListener('click', close)
      return
    }
    const nodeEl = event.target.closest('.gnode')
    if (nodeEl && selected !== nodeEl.dataset.nodeId) {
      selected = nodeEl.dataset.nodeId
      selectedEdge = null
      if (window.innerWidth <= 1200) document.querySelector('.bench-graph')?.classList.add('is-inspector-open')
      renderNodes()
    }
  })

  function onKey(event) {
    const tag = event.target.tagName
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return
    if (event.key === 'Delete' || event.key === 'Backspace') {
      if (selected) { event.preventDefault(); deleteNode(selected) }
      else if (selectedEdge) { event.preventDefault(); deleteEdge(selectedEdge) }
    }
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'z') {
      event.preventDefault()
      event.shiftKey ? redo() : undo()
    }
    if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') { event.preventDefault(); run() }
    if (event.key.toLowerCase() === 'f' && !event.metaKey && !event.ctrlKey) { event.preventDefault(); fitView(true) }
    if (event.key === 'Escape') {
      if (connect) { connect = null; world.classList.remove('is-connecting'); renderEdges() }
      else { selected = null; selectedEdge = null; renderNodes() }
    }
  }
  window.addEventListener('keydown', onKey)

  // ---------- 与全局状态同步 ----------
  function update() {
    if (!mounted) return
    const server = graphs().find(row => row.id === graph?.id)
    if (!server) return
    // 运行态同步：状态、产出、进度
    const runChanged = JSON.stringify(server.run ?? null) !== JSON.stringify(graph.run ?? null)
    let nodesChanged = false
    for (const node of graph.nodes) {
      const remote = server.nodes.find(item => item.id === node.id)
      if (!remote) continue
      if (node.status !== remote.status || (remote.output && JSON.stringify(node.output) !== JSON.stringify(remote.output)) || node.error !== remote.error) {
        node.status = remote.status
        node.output = remote.output ?? null
        node.error = remote.error ?? ''
        nodesChanged = true
      }
    }
    if (runChanged) { graph.run = server.run ?? null; paintStatus(); updateRunTimer() }
    const editingInspector = Boolean(document.activeElement?.closest?.('#inspector'))
    if (nodesChanged && !drag && !editingInspector) {
      const scroller = nodesEl.scrollTop
      renderNodes()
      nodesEl.scrollTop = scroller
    } else if (runChanged && !editingInspector) {
      renderNodes()
    }
    if (!dirty) paintGraphSelect()
    if (server.updatedAt && !dirty && server.updatedAt !== graph.updatedAt) {
      // 其他窗口改过这张图：只在当前没有本地修改时接管
      if (JSON.stringify(server.nodes.map(n => n.id)) === JSON.stringify(graph.nodes.map(n => n.id))) {
        graph.updatedAt = server.updatedAt
      }
    }
  }

  // ---------- 初始化 ----------
  if (!graph) {
    $('#canvas-empty').hidden = false
    $('#inspector').innerHTML = `<div class="inspect-empty"><p>${esc(t('还没有星图', 'No star map yet'))}</p><button class="btn btn-small btn-primary" id="first-graph">${esc(t('新建一张', 'Create one'))}</button></div>`
    $('#first-graph')?.addEventListener('click', () => createGraph({}))
  } else {
    fitView(false)
    renderNodes()
    updateRunTimer()
  }
  applyTransform()

  return {
    update,
    unmount() {
      mounted = false
      if (runTimer) clearInterval(runTimer)
      window.removeEventListener('pointermove', onPointerMove)
      window.removeEventListener('pointerup', onPointerUp)
      window.removeEventListener('pointercancel', onPointerUp)
      window.removeEventListener('keydown', onKey)
      if (dirty) saveNow().catch(() => {})
    },
  }
}
