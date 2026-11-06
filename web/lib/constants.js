export const STYLES = [
  '电影感', '插画', '水墨', '赛博朋克', '胶片', '3D', '极简', '浮世绘', '概念艺术',
]

export const STYLE_HINTS = {
  电影感: 'cinematic lighting, film still',
  插画: 'editorial illustration',
  水墨: 'ink painting',
  赛博朋克: 'cyberpunk neon',
  胶片: 'analog film',
  '3D': 'stylized 3D render',
  极简: 'minimal composition',
  浮世绘: 'ukiyo-e print',
  概念艺术: 'concept art',
}

export const STYLE_LABELS_EN = {
  电影感: 'Cinematic',
  插画: 'Illustration',
  水墨: 'Ink',
  赛博朋克: 'Cyberpunk',
  胶片: 'Film',
  '3D': '3D',
  极简: 'Minimal',
  浮世绘: 'Ukiyo-e',
  概念艺术: 'Concept art',
}

export const RATIOS = [
  { id: '1:1', label: '1:1', hint: '1024 × 1024' },
  { id: '4:3', label: '4:3', hint: '1152 × 864' },
  { id: '3:2', label: '3:2', hint: '1216 × 832' },
  { id: '16:9', label: '16:9', hint: '1344 × 768' },
  { id: '9:16', label: '9:16', hint: '768 × 1344' },
  { id: '2:3', label: '2:3', hint: '832 × 1216' },
]

export const RATIO_VALUE = {
  '1:1': 1,
  '4:3': 4 / 3,
  '3:2': 3 / 2,
  '16:9': 16 / 9,
  '9:16': 9 / 16,
  '2:3': 2 / 3,
}

export const INSPIRATIONS = [
  { title: '雨后的天台', titleEn: 'Rooftop after rain', prompt: '雨停后的城市天台，积水映着晚霞，一个人把耳机摘下来，远处的车流像潮水。', promptEn: 'A city rooftop after the rain, puddles holding the last light, someone taking off their headphones, traffic moving like a tide below.', style: '电影感', ratio: '16:9' },
  { title: '云上的邮局', titleEn: 'Post office above the clouds', prompt: '一座建在云层上的旧邮局，木质柜台，窗外是翻涌的云海，暖黄的吊灯，安静而郑重。', promptEn: 'An old post office built on a sea of clouds, a wooden counter, warm hanging lamps, quiet and ceremonial.', style: '插画', ratio: '4:3' },
  { title: '深夜书店', titleEn: 'Bookshop at 2am', prompt: '凌晨两点的独立书店，只留一盏台灯，猫趴在摊开的书上，玻璃窗外是细雨和霓虹。', promptEn: 'An independent bookshop at two in the morning, one lamp left on, a cat asleep on an open book, drizzle and neon beyond the glass.', style: '胶片', ratio: '3:2' },
  { title: '墨色山谷', titleEn: 'Ink valley', prompt: '极简的水墨山谷，一叶小舟停在雾里，远处只有淡淡的山的轮廓，大量留白。', promptEn: 'A minimalist ink-wash valley, a small boat resting in mist, faint mountain outlines far away, generous empty space.', style: '水墨', ratio: '9:16' },
]

export const ACTIONS = [
  { id: 'continue', label: '续写', hint: '从结尾往下写' },
  { id: 'polish', label: '润色', hint: '保留原意，改善节奏' },
  { id: 'expand', label: '扩写', hint: '补充细节与画面' },
  { id: 'rewrite', label: '改写', hint: '按指令换一种写法' },
  { id: 'outline', label: '大纲', hint: '整理结构' },
  { id: 'title', label: '起标题', hint: '给 6 个候选' },
]

export const TONES = ['自然叙述', '克制冷静', '热烈', '幽默', '诗意', '硬朗']
export const POVS = ['第一人称', '第三人称', '全知视角']
export const LENGTHS = [
  { id: 'short', label: '短 · 400 字' },
  { id: 'medium', label: '中 · 900 字' },
  { id: 'long', label: '长 · 1600 字' },
]
