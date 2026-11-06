// 写作动作 → 提示词
const LENGTH = { short: 400, medium: 900, long: 1600, micro: 140 }
const LENGTH_LABEL = { short: '约 400 字', medium: '约 900 字', long: '约 1600 字', micro: '约 100 字' }

const TONES = ['自然叙述', '克制冷静', '热烈', '幽默', '诗意', '硬朗']
const POVS = ['第一人称', '第三人称', '全知视角']

const ACTIONS = {
  continue: '续写',
  polish: '润色',
  expand: '扩写',
  rewrite: '改写',
  outline: '大纲',
  title: '起标题',
  custom: '按指令写',
  graph: '星图写作',
}

export { ACTIONS, TONES, POVS, LENGTH }

function clip(text, max) {
  const value = String(text ?? '')
  return value.length > max ? value.slice(-max) : value
}

function englishLine(action, lang, length) {
  return lang === 'en'
    ? `\n\nWrite in natural, fluent English. The length target is ${length} words or fewer. Output only the text the author can paste into the manuscript, with no preamble, no explanation, and no markdown fences.`
    : ''
}

function buildSystem(body) {
  const tone = TONES.includes(body.tone) ? body.tone : '自然叙述'
  const pov = POVS.includes(body.pov) ? body.pov : '第三人称'
  return [
    '你是一位可靠的中文写作搭档，正在「摩登-媒体工作室」里和作者一起改稿。',
    '你只输出可以直接放进正文的文字：不要解释你在做什么，不要写“好的”“以下是”，不要加代码块，不要用“---”分隔。',
    `文风：${tone}。叙述人称：${pov}。保持作者已有的用词习惯和节奏，不擅自改人物名、数字和设定。`,
    '不要为了凑字数重复已经写过的意思；没把握的地方宁可写得具体，也不要写空泛的总结。',
    englishLine(body.action, body.lang, body.length),
  ].filter(Boolean).join('\n')
}

function manuscriptBlock(body) {
  const title = String(body.title ?? '').trim()
  const content = clip(body.content ?? '', 8000)
  const selection = String(body.selection ?? '').trim()
  const parts = []
  if (title) parts.push(`作品标题：${title}`)
  if (content) parts.push(`<正文>\n${content}\n</正文>`)
  if (selection) parts.push(`<选中的片段>\n${selection}\n</选中的片段>\n只处理这个片段。`)
  if (body.outline) parts.push(`<大纲>\n${String(body.outline).slice(0, 2000)}\n</大纲>`)
  return parts.join('\n\n')
}

export function writingPrompts(body) {
  const action = ACTIONS[body.action] ? body.action : 'custom'
  const length = LENGTH[body.length] ? body.length : 'medium'
  const target = LENGTH_LABEL[length]
  const instruction = String(body.instruction ?? '').trim().slice(0, 600)
  const material = manuscriptBlock(body)
  const system = buildSystem({ ...body, action })
  let task = ''

  switch (action) {
    case 'continue':
      task = `从正文结束的地方继续往下写，${target}。承接最后一句的语气和场景，不要复述已经写过的内容。只输出新写的那部分。`
      break
    case 'polish':
      task = `润色${body.selection ? '选中的片段' : '正文'}：保留原意、信息和人物口吻，改善节奏、用词和标点，删掉多余的解释。只输出润色后的文字。`
      break
    case 'expand':
      task = `把${body.selection ? '选中的片段' : '正文'}扩写到${target}：补充具体的动作、感官细节和环境，不要新增与上下文冲突的情节。只输出扩写后的文字。`
      break
    case 'rewrite':
      task = `按这个要求重写${body.selection ? '选中的片段' : '正文'}：${instruction || '换一种更自然、更有画面感的写法'}。保留事实和人物关系，只输出重写后的文字。`
      break
    case 'outline':
      task = `为这个作品整理一份可执行的大纲。输出三到五节，每节一行，格式是「## 小节名：这一节发生什么、情绪怎么走」。不要写正文。`
      break
    case 'title':
      task = '给这个作品起 6 个标题。每行一个，只写标题，不编号、不解释。标题要具体、有画面感，不要浮夸的营销腔。'
      break
    case 'graph':
      task = instruction || '根据素材写一段有画面感的文字，控制在 120 字以内。'
      break
    default:
      task = instruction || '根据素材继续写。'
  }

  const user = [
    material || '（还没有正文，按指令从零写。）',
    '',
    `任务：${task}`,
    body.action === 'continue' ? `篇幅：${target}。` : '',
  ].filter(Boolean).join('\n')

  return { system, user, action, length }
}

/** 洗掉模型偶尔带出来的前缀和代码围栏 */
export function cleanOutput(text, action) {
  let out = String(text ?? '').trim()
  out = out.replace(/```(?:markdown|md|text)?\s*/gi, '').trim()
  if (action !== 'outline' && action !== 'title') {
    out = out.replace(/^(好的|当然|没问题)[，,。!！]\s*/u, '')
    out = out.replace(/^(这是|以下是)?\s*(续写|润色|扩写|改写|正文|草稿)[:：]\s*/u, '')
  }
  return out.trim()
}

export const WRITING_SYSTEM_HINT = '写作使用 DSH 当前默认模型；密钥由 DSH 管理，插件不保存。'
