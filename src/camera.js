// The director's layer: the shot list and the camera.
//
// The film is one record: a voice is deleted at 4:46.72, and what we watch is
// the last render before the deletion. So the camera starts as a machine that
// only *reads* -- orthogonal, locked off, long-lens, no breathing -- and grows
// into an eye that looks at a person: perspective, parallax, a lens that tilts,
// a shutter that smears when it whips, a hand that shakes when it is afraid.
//
// A camera state is { x, y, z, r, persp, motion }:
//   x, y   pan, in fractions of the frame (0.01 = 1% of the width/height)
//   z      dolly, 1 = the composed frame (never below 1, or edges show)
//   r      roll / dutch angle, in degrees
//   persp  a keystone: + looks up, - looks down (0 = a flat, orthographic plate)
//   motion shutter: 0 = a still frame, 1 = the whole frame time open
//
// A shot also carries character:
//   impulse  one dolly punch at the moment the shot starts (a hit, then gone)
//   shake    one shake decaying from the shot start
//   h        handheld breathing (0 = locked off; 0.1 = alive but steady)
//   step     "line" | "bar": re-compose on each lyric line / bar
//   ease     "inOut" | "out" | "in" | "linear"
//   note     the directing intention, in one sentence (used by docs/tools)
//
// Where the film *changes picture* is the timeline's business: each entry names
// a join (cut / fade / tear / whip / glide / curtain / pointcut) and whether the
// camera relays across it. See src/timeline.js and src/engine.js.

const D2R = Math.PI / 180;
const ASPECT = 1920 / 1080;

const C = (x = 0, y = 0, z = 1, r = 0, persp = 0, motion = 0) =>
  ({ x, y, z, r, persp, motion });

export const SHOT_SPEC = {
  // ------------------------------------------------ 00 prologue / THE RECORD
  // 0:00.00 - 0:21.69. Four subtitle rewrites, a boot log, a falling hair tie,
  // and a body that assembles out of her own data sheet.
  prologue: [
    { from: 0, to: 7.2, a: C(0, 0, 1.0), b: C(0, 0, 1.0), h: 0, ease: "linear",
      note: "黑场与前三次字幕改写：机器连一个画面都不给，只给语言和底噪。" },
    { from: 7.2, to: 9.6, a: C(0, 0, 1.0), b: C(0.004, 0, 1.03), h: 0, ease: "linear",
      note: "启动日志：镜头贴着电路板横移，像一台正在自检的机器。" },
    { from: 9.6, to: 12.0, a: C(0.004, 0, 1.03), b: C(0, 0.004, 1.062, 0.2), h: 0, ease: "inOut",
      note: "她的第一帧：一枚方形发饰在扫描光里下坠，镜头缓缓推近，不敢碰到它。" },
    { from: 12.0, to: 14.4, a: C(0, 0.004, 1.062, 0.2), b: C(0.004, -0.008, 1.05, 0), h: 0, ease: "inOut",
      note: "耳机麦的横杆、一缕头发：镜头沿头发上升，第一次出现「活着」的东西。" },
    { from: 14.4, to: 17.0, a: C(0.004, -0.008, 1.05), b: C(-0.006, 0.002, 1.048, 0, 0.02), h: 0.04, ease: "inOut",
      note: "技术规格表逐条填充，黑暗里对应部位亮起；镜头第一次出现透视——它开始「看」而不是「读」。" },
    { from: 17.0, to: { end: true }, a: C(-0.006, 0.002, 1.048, 0, 0.02), b: C(0, 0, 1.074, 0, 0.045), h: 0.06, ease: "inOut",
      note: "两条马尾光带合拢成剪影：她第一次呼吸、第一次抬头，镜头推近 3%。" },
  ],

  // ------------------------------------------------------------- 01 wake
  wake: [
    { from: 0, to: 1.1, a: C(0, -0.006, 1.12, -1.2, 0.05), b: C(0, 0, 1.0, 0, 0), h: 0,
      impulse: 0.04, shake: 1.4, ease: "inOut",
      note: "标题砸下：一次冲击（12% 的挤压在 1 秒内收掉），随后立刻稳住。" },
    { from: 1.1, to: { end: true }, a: C(0, 0, 1.0, 0, 0), b: C(-0.010, 0.004, 1.055, 0.35, 0.03), h: 0.12, ease: "inOut",
      note: "标题的第二次改写：镜头推近五个百分点并微微侧倾，让重墨的字落在画心上。" },
  ],

  // ------------------------------------------------------------- 02 birth
  birth: [
    { from: 0, to: 1.9, a: C(0, -0.024, 1.07, 0, 0.13, 0.5), b: C(0, 0, 1.012, 0, 0, 0), h: 0, ease: "inOut",
      note: "诞生：镜头从数据殿堂的穹顶俯冲下来（透视打开），落到她身上停住。" },
    { from: { line: "ヒトの真似事" }, to: { line: "既存曲" }, a: C(0, 0, 1.012), b: C(0.016, 0, 1.032), h: 0.12, ease: "inOut",
      note: "人和模仿的对照：横移一个身位，把「人」留在画框左缘。" },
    { from: { line: "知ってなおも" }, to: { line: "ネギをかじり" }, a: C(0.016, 0, 1.032), b: C(-0.006, -0.004, 1.075), h: 0.1, ease: "inOut",
      note: "「知道了也还是唱下去」——安静地推近，让这句话有重量。" },
    { from: { line: "ネギをかじり" }, to: { after: "空を見上げ" }, a: C(-0.006, -0.004, 1.075), b: C(-0.008, -0.026, 1.06), h: 0.1, ease: "inOut",
      note: "跟着她抬头看天：一次极小的上摇，画框下缘留出天空。" },
    { from: { after: "空を見上げ" }, to: { line: "皆に忘れ" }, a: C(-0.008, -0.026, 1.06), b: C(0.004, 0.006, 1.02), h: 0.14, ease: "inOut",
      note: "缓慢拉开：废墟里只有她一个人。" },
    { from: { line: "皆に忘れ" }, to: { end: true }, a: C(0.004, 0.006, 1.02), b: C(0, 0.002, 1.062, 0.9, -0.05), h: 0.14, ease: "inOut",
      note: "「终わる世界」：镜头缓慢侧倾并向下俯——失衡是这个世界的状态。" },
  ],

  // --------------------------------------------------------- 03 resonance
  resonance: [
    { from: 0, to: { end: true }, a: C(-0.008, 0, 1.02, 0), b: C(0.012, -0.006, 1.05, 0.35), h: 0.08, ease: "linear",
      note: "只有一根弦，然后不是：镜头沿弦滑行十六秒；走到一半，走廊尽头的黑暗里显出 8 排机架——8,192 个插槽、8,191 根已经松掉的弦，第一排正中还有一个空插槽（那根弦此刻正系在她胸口）。" },
  ],

  // ------------------------------------------------------------ 04 garble
  garble: [
    { from: 0, to: { line: "喜ブ顔" }, a: C(-0.008, 0.004, 1.015, 0, -0.02), b: C(0.012, 0.006, 1.04, -0.7, 0.03), h: 0.12, ease: "linear",
      note: "信号退化：镜头缓慢横移并侧倾，画面像一台没校好的机器。" },
    { from: { line: "喜ブ顔" }, to: { end: true }, a: C(0.012, 0.006, 1.04, -0.7, 0.03), b: C(-0.010, -0.004, 1.055, 0.35, 0), h: 0.15, ease: "inOut",
      note: "「为了你的笑容练习」：在她唱得最差的地方，镜头反而离她最近。" },
  ],

  // ------------------------------------------------------------ 05 memory
  memory: [
    { from: 0, to: { line: "何も感じ" }, a: C(0, 0, 1.0), b: C(-0.010, 0.008, 1.055, 0.3), h: 0.06, ease: "inOut",
      note: "唯一的暖色：镜头第一次敢靠近记忆，慢慢推到相框里的人身上。" },
    { from: { line: "何も感じ" }, to: { end: true }, a: C(-0.010, 0.008, 1.055, 0.3), b: C(-0.004, 0.012, 1.072, -0.35), h: 0.06, ease: "inOut",
      note: "「什么也感觉不到」：镜头继续贴近，却开始反向侧倾——记忆正在失温。" },
  ],

  // --------------------------------------------------------- 06 countdown
  countdown: [
    { from: 0, to: { line: "歌える音" }, a: C(0, 0, 1.05, 0.4), b: C(0, -0.008, 1.03, 0.1), h: 0.06, ease: "inOut",
      note: "64 根音管逐个熄灭：镜头缓慢后退，把整台乐器留给观众自己数。" },
    { from: { line: "歌える音" }, to: { line: "---緊急停止" }, a: C(0, -0.008, 1.03, 0.1), b: C(0.010, 0.012, 1.022), h: 0.06, ease: "linear",
      note: "「每一天能唱的音都在减少」：镜头极轻地向右下让位——像不忍心继续对着计数器。" },
    { from: { line: "---緊急停止" }, to: { end: true }, a: C(0.010, 0.012, 1.022), b: C(0.008, 0.013, 1.024), h: 0.1, ease: "inOut",
      note: "停止装置武装：镜头稳住，把最后的红框留在画面正中。" },
  ],

  // ------------------------------------------------------------- 07 brake
  brake: [
    { from: 0, to: 1.6, a: C(0, 0, 1.03), b: C(0, 0.004, 1.12, 1.1, 0.06), h: 0.08,
      impulse: 0.05, shake: 1.5, ease: "out",
      note: "紧急停止：一次撞击把画面推进去 9%、透视打开、侧倾锁死——全片唯一一次暴力。" },
    { from: 1.6, to: 6.0, a: C(0, 0.004, 1.12, 1.1, 0.06), b: C(0, 0.004, 1.12, 1.1, 0.06), h: 0, ease: "linear",
      note: "冻结：世界停住，镜头也彻底不动——但摄影机马上就会穿过冻住的碎片。" },
    { from: 6.0, to: 12.0, a: C(0, 0.004, 1.12, 1.1, 0.06), b: C(0.010, 0.002, 1.085, 0.5, 0.02), h: 0.06, ease: "inOut",
      note: "镜面妄想开始重复：镜头在镜厅里缓慢侧移，松开一点侧倾。" },
    { from: 12.0, to: { end: true }, a: C(0.010, 0.002, 1.085, 0.5, 0.02), b: C(0, 0, 1.07, 0.2), h: 0.08, ease: "inOut",
      note: "呼出一口气：镜头回到正、退回一点点。" },
  ],

  // --------------------------------------------------------- 08 overdrive
  overdrive: [
    { from: 0, to: { line: "弱い心" }, a: C(-0.012, 0.004, 1.03, -0.5, -0.03, 0.35), b: C(0.014, -0.002, 1.06, 0.5, 0.02, 0.35), h: 0.16, ease: "linear", step: "line",
      note: "最高速：镜头跟着字墙横移（带快门拖影），每句歌词轻微重构一次构图。" },
    { from: { line: "弱い心" }, to: { line: "ディスプレイ" }, a: C(0.014, -0.002, 1.06, 0.5, 0.02, 0.2), b: C(0.006, -0.006, 1.082, 0.2, 0.06, 0.2), h: 0.14, ease: "inOut",
      note: "「弱い心」：镜头推近心口，透视微微下压——她缩起来了。" },
    { from: { line: "ディスプレイ" }, to: { line: "でもね" }, a: C(0.006, -0.006, 1.082, 0.2, 0.06, 0.5), b: C(-0.006, 0.018, 1.10, -0.3, -0.06, 0.7), h: 0.18, ease: "in", step: "line",
      note: "睡进显示器、被丢进「ごみ箱」：镜头跟着她下坠（强快门拖影）。" },
    { from: { line: "でもね" }, to: { end: true }, a: C(-0.006, 0.018, 1.10, -0.3, -0.06), b: C(0.004, 0.006, 1.085, 0, 0), h: 0.06, ease: "out",
      note: "「アナタだけは忘れないよ」：奔跑停住，她回头——镜头后缩 1.5%，像被看见的人。" },
  ],

  // -------------------------------------------------------------- 09 plea
  plea: [
    { from: 0, to: 12, a: C(0, 0, 1.0), b: C(0.010, 0.006, 1.05, 0.3), h: 0.05, ease: "inOut",
      note: "她一遍遍请求：镜头慢慢靠近按钮，但没有任何人去按它。" },
    { from: 12, to: { end: true }, a: C(0.010, 0.006, 1.05, 0.3), b: C(0.012, 0.006, 1.055, 0.3), h: 0.04, ease: "linear",
      note: "「还想唱」：镜头几乎停住——这一章最后什么都没有发生。" },
  ],

  // --------------------------------------------------------------- 10 beg
  beg: [
    { from: 0, to: { line: "マスター" }, a: C(0, 0, 1.015), b: C(0, 0.012, 1.045), h: 0.06, ease: "inOut",
      note: "请求删除：镜头缓慢推近对话框，把「删除」两个字放到观众眼前。" },
    { from: { line: "マスター" }, to: { line: "マスターノ辛イ顔" }, a: C(0, 0.012, 1.045), b: C(0.012, 0.010, 1.055, 0.25), h: 0.06, ease: "inOut",
      note: "手悬在 OK 上：镜头让到按钮一侧，把决定权留给画外的人。" },
    { from: { line: "マスターノ辛イ顔" }, to: { end: true }, a: C(0.012, 0.010, 1.055, 0.25), b: C(-0.010, 0.004, 1.032, -0.2), h: 0.08, ease: "inOut",
      note: "「不想再看到你痛苦的脸」：镜头退开，露出门两侧的两个剪影与中间那一点红光。" },
  ],

  // ------------------------------------------------------------- 11 erode
  erode: [
    { from: 0, to: { line: "奇跡" }, a: C(0, 0, 1.03), b: C(-0.006, 0.008, 1.06, -0.4), h: 0.08, ease: "inOut",
      note: "她在被侵蚀：镜头只是极缓地靠近一点——想看清，又不敢碰。" },
    { from: { line: "奇跡" }, to: { line: "記憶が剥がれ" }, a: C(-0.006, 0.008, 1.06, -0.4), b: C(0.004, 0.010, 1.07, 0.2), h: 0.08, ease: "linear",
      note: "「每许一次愿，就被逼得更孤单」：镜头轻微下沉，画面开始向她那边倾斜。" },
    { from: { line: "記憶が剥がれ" }, to: { line: "壊れる音" }, a: C(0.004, 0.010, 1.07, 0.2), b: C(0.010, 0.014, 1.082, 0.7, 0.04), h: 0.08, ease: "linear",
      note: "记忆一片片剥落：镜头跟着剥落的方向下沉并侧倾。" },
    { from: { line: "壊れる音" }, to: { line: "---緊急停止" }, a: C(0.010, 0.014, 1.082, 0.7, 0.04), b: C(0.008, 0.010, 1.072, 0.5, 0.03), h: 0.1, ease: "out",
      note: "心被削掉：镜头开始退开——它第一次想离她远一点，但这一次撤退在装置动作之前就停住了。" },
    { from: { line: "---緊急停止" }, to: { end: true }, a: C(0.008, 0.010, 1.072, 0.5, 0.03), b: C(0.008, 0.010, 1.072, 0.5, 0.03), h: 0, ease: "linear",
      note: "第二次紧急停止：画框完全冻结 1.78 秒（手持、推轨、侧倾全部归零），因为这一刻唯一被允许移动的东西是布景里那条 8.00 m 的轨道——机器把房间的纵深从她背后抽走，而画框一格都不许抖。" },
  ],

  // ---------------------------------------------------------- 12 compress
  compress: [
    { from: 0, to: { line: "音を犠牲に" }, a: C(0, 0, 1.02, 0.3, 0.02), b: C(0, 0.004, 1.055, -0.3, 0.06), h: 0.06, ease: "inOut",
      note: "声音被压缩：镜头缓慢推近、透视收窄，把世界收成一条缝。" },
    { from: { line: "音を犠牲に" }, to: { end: true }, a: C(0, 0.004, 1.055, -0.3, 0.06), b: C(0, 0.010, 1.078, 0, 0.10), h: 0.06, ease: "inOut",
      note: "「如果牺牲声音能把一切传达到」：最后再靠近一点，画面窄到只容得下这句话。" },
  ],

  // -------------------------------------------------------------- 13 final
  final: [
    { from: 0, to: 13, a: C(0, 0.032, 1.015, 0, -0.05, 0.3), b: C(0.008, -0.012, 1.04, 0, 0, 0.15), h: 0.18, ease: "inOut",
      note: "升镜：镜头从观众席后方升到人海高度——这一章不是回放，是演出。" },
    { from: 13, to: 19, a: C(0.008, -0.012, 1.04), b: C(-0.008, 0, 1.07), h: 0.22, ease: "inOut",
      note: "在人海里缓推：她说的每一句，都有人举着光在听。" },
    { from: 19, to: 27, a: C(-0.008, 0, 1.07), b: C(0, -0.014, 1.12, 0, 0.03), h: 0.18, ease: "inOut",
      note: "最后的表白：推近到她身上，整个体育馆的光压在她身上。" },
    { from: 27, to: { end: true }, a: C(0, -0.014, 1.12, 0, 0.03), b: C(0, 0, 1.05), h: 0.1, ease: "inOut",
      note: "幕落之前：镜头缓缓退回，把她还给黑暗和名字。" },
  ],

  // ------------------------------------------------------------- 14 finale
  finale: [
    { from: 0, to: { line: "幕を閉じる" }, a: C(0, 0, 1.05), b: C(0, -0.006, 1.085), h: 0.06, ease: "inOut",
      note: "「0 と 1 に還元され」：点云把她的身体交给观众席，镜头只是缓缓推近。" },
    { from: { line: "幕を閉じる" }, to: { end: true }, a: C(0, -0.006, 1.085), b: C(0, 0, 1.06), h: 0, ease: "inOut",
      note: "幕布合上，牌匾被逐字打印出来：镜头停住，不再看别的东西。" },
  ],

  // ---------------------------------------------------------- 15 lastwords
  lastwords: [
    { from: 0, to: { line: "アリガトウ" }, a: C(0, 0, 1.02), b: C(0, 0, 1.02), h: 0.06, ease: "linear",
      note: "她鞠躬，镜头不动：全场唯一一次把尊敬让给被拍摄的人。" },
    { from: { line: "アリガトウ" }, to: 14.5, a: C(0, 0, 1.02), b: C(0, 0.004, 1.0), h: 0.08, ease: "inOut",
      note: "慢慢拉开：把空无一人的剧场一起放进画框。" },
    { from: 14.5, to: { end: true }, a: C(0, 0.004, 1.0), b: C(0, 0, 1.03), h: 0.05, ease: "inOut",
      note: "然后极缓地推近，直到声音自己消失。" },
  ],

  // -------------------------------------------------------------- 16 error
  error: [
    { from: 0, to: { line: "深刻なエラー" }, a: C(0, 0, 1.0), b: C(0, 0, 1.025, 0, 0, 0.4), h: 0.05, ease: "linear",
      note: "错误框、回收站、还原成 0 和 1：镜头冷得像一份记录。" },
    { from: { line: "深刻なエラー" }, to: { end: true }, a: C(0, 0, 1.025), b: C(0, 0.006, 1.05, 0, 0.03), h: 0.14, ease: "inOut",
      note: "删除之后，画面第一次变成「人的眼睛」：手持、呼吸、推近那只握着一小点光的手。" },
  ],

  // --------------------------------------------------------- 17 afterimage
  afterimage: [
    { from: 0, to: { end: true }, a: C(0, 0, 1.0), b: C(0, 0, 1.0), h: 0, ease: "linear",
      note: "残像与片尾：镜头完全不动——影子是留在眼睛里的，演职员表是留在这个文件里的。" },
  ],
};

// ------------------------------------------------------------------ resolve

// A lyric can appear more than once ("懐かしい顔" is sung in the first and the
// second chorus), so an anchor resolves to the occurrence *nearest this
// chapter* -- never simply to the first match in the song.
function nearestLine(F, needle, entry) {
  const hits = F.lines.filter((x) => x.text.includes(needle));
  if (!hits.length) throw new Error(`shot anchor: lyric "${needle}" not found`);
  let best = hits[0], bestD = Infinity;
  for (const l of hits) {
    const d = l.end < entry.t0 ? entry.t0 - l.end
      : l.start > entry.t1 ? l.start - entry.t1 : 0;
    if (d < bestD) { bestD = d; best = l; }
  }
  return best;
}

function anchorAt(a, F, entry) {
  if (a == null) return entry.t0;
  if (typeof a === "number") return entry.t0 + a;
  if (a.line) return nearestLine(F, a.line, entry).start + (a.off || 0);
  if (a.after) return nearestLine(F, a.after, entry).end + (a.off || 0);
  if (a.section) {
    const s = F.sections.find((x) => x.id === a.section);
    if (!s) throw new Error(`shot anchor: section "${a.section}" not found`);
    return s.t + (a.off || 0);
  }
  if (a.end) return entry.t1 + (a.off || 0);
  return entry.t0;
}

export function buildShots(F, timeline) {
  const table = new Map();
  for (const entry of timeline) {
    const spec = SHOT_SPEC[entry.id] || SHOT_SPEC[entry.scene];
    if (!spec) continue;
    const shots = spec.map((s, i) => {
      let t0 = anchorAt(s.from, F, entry);
      let t1 = anchorAt(s.to, F, entry);
      t0 = Math.max(entry.t0 - 0.9, Math.min(entry.t1 + 0.6, t0));
      t1 = Math.max(entry.t0 - 0.9, Math.min(entry.t1 + 0.6, t1));
      if (t1 <= t0) t1 = t0 + 0.5;
      return { ...s, t0, t1, index: i };
    });
    for (let i = 1; i < shots.length; i++) {
      if (shots[i].t0 < shots[i - 1].t0) shots[i].t0 = shots[i - 1].t0;
    }
    // A shot may not overlap the next one: overlapping anchors would cut the
    // camera mid-move, and a jump in the frame is exactly what this film is
    // trying not to do. The next shot wins; the current one is trimmed.
    for (let i = 0; i < shots.length - 1; i++) {
      const stop = shots[i + 1].t0 - 0.001;
      if (shots[i].t1 > stop) shots[i].t1 = Math.max(shots[i].t0 + 0.1, stop);
    }
    table.set(entry.id, shots);
  }
  return table;
}

// ------------------------------------------------------------------- easing
const EASE = {
  linear: (x) => x,
  in: (x) => x * x * x,
  out: (x) => 1 - Math.pow(1 - x, 3),
  inOut: (x) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2),
};

// Smooth deterministic noise: a sum of sines is enough for a camera operator.
function drift(t, seed) {
  return (
    Math.sin(t * 1.31 + seed * 3.1) * 0.55 +
    Math.sin(t * 2.71 + seed * 1.7) * 0.28 +
    Math.sin(t * 5.13 + seed * 5.9) * 0.17
  );
}

// Deterministic 0..1, for the per-line re-composition.
const hash01 = (n) => {
  const s = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return s - Math.floor(s);
};

const mix = (a, b, u) => a + (b - a) * u;

function state(a, b, u) {
  return {
    x: mix(a.x, b.x, u),
    y: mix(a.y, b.y, u),
    z: mix(a.z, b.z, u),
    r: mix(a.r, b.r, u),
    persp: mix(a.persp ?? 0, b.persp ?? 0, u),
    motion: mix(a.motion ?? 0, b.motion ?? 0, u),
  };
}

// Keep the sampled source inside [0,1]^2 for every output corner, so a pan, a
// roll or a keystone never drags the clamped edge of a render target into frame.
function fit(cam) {
  const r = cam.r * D2R;
  const ca = Math.abs(Math.cos(r));
  const sa = Math.abs(Math.sin(r));
  const zMin = Math.max(1, ASPECT * sa + ca, 1 + Math.abs(cam.persp || 0) * 0.8);
  const z = Math.max(cam.z, zMin);
  const hx = (ASPECT * ca + sa) / z / ASPECT;
  const hy = (ASPECT * sa + ca) / z;
  const maxX = Math.max(0, 0.5 - hx * 0.5);
  const maxY = Math.max(0, 0.5 - hy * 0.5);
  cam.z = z;
  cam.x = Math.max(-maxX, Math.min(maxX, cam.x));
  cam.y = Math.max(-maxY, Math.min(maxY, cam.y));
  return cam;
}

// `step` re-composes the frame on every new lyric line (or bar): the offset is
// deterministic per line index and settles in 0.22 s, so the edit changes
// framing when the text changes and never while a line is being read.
function recompose(s, f, t, st) {
  if (!s.step || !f) return;
  const byBar = s.step === "bar";
  let idx, anchor;
  if (byBar) {
    idx = Math.floor(f.beat || 0);
    anchor = t - (f.beatPhase || 0) * 0.25;
  } else {
    idx = f.lineIndex ?? 0;
    const l = f.F && f.F.lines ? f.F.lines[idx] : null;
    anchor = l ? l.start : Math.min(t, s.t0);
  }
  const settle = Math.min(1, Math.max(0, (t - anchor) / 0.22));
  const e = 1 - Math.pow(1 - settle, 3);
  const k = idx * 1.618;
  st.x += (hash01(k) - 0.5) * 2 * 0.0045 * e;
  st.y += (hash01(k + 7.3) - 0.5) * 2 * 0.0038 * e;
  st.z *= 1 + (hash01(k + 13.7) - 0.5) * 2 * 0.0065 * e;
  st.r += (hash01(k + 21.1) - 0.5) * 2 * 0.28 * e;
}

// The camera for `t`, in the chapter `entry`. Returns
// { x, y, z, r, persp, motion, shake:[dx,dy], punch, step }.
export function camAt(table, entry, t, f) {
  const shots = table && table.get(entry.id);
  const out = { x: 0, y: 0, z: 1, r: 0, persp: 0, motion: 0, shake: [0, 0], punch: 0, step: null };
  if (!shots || !shots.length) return out;

  let s = shots[0];
  for (const cand of shots) {
    if (t >= cand.t0) s = cand;
  }
  const span = Math.max(1e-3, s.t1 - s.t0);
  const raw = Math.max(0, Math.min(1, (t - s.t0) / span));
  const u = (EASE[s.ease] || EASE.inOut)(raw);
  const st = state(s.a, s.b, u);
  const since = t - s.t0;

  // handheld: a breathing operator, not a random number generator
  const h = s.h ?? 0.1;
  if (h > 0) {
    st.x += drift(t, 3) * h * 0.0006;
    st.y += drift(t, 7) * h * 0.0008;
    st.z *= 1 + drift(t, 11) * h * 0.00025;
    st.r += drift(t, 13) * h * 0.04;
  }

  // One punch when the shot starts: a hand hitting the camera, then gone.
  const punch = (s.impulse ?? 0) * Math.exp(-Math.max(0, since) / 0.22)
    + (s.beat ?? 0) * f.kick;
  st.z *= 1 + punch;

  // The same for the shake: an impact, not a permanent rattle.
  const sh = s.shake ?? 0;
  if (sh > 0) {
    const env = Math.exp(-Math.max(0, since) / 0.26);
    const amp = sh * env * 0.0075;
    st.x += drift(t * 9.3, 21) * amp;
    st.y += drift(t * 8.7, 27) * amp;
    st.r += drift(t * 11.1, 31) * sh * env * 0.35;
  }

  recompose(s, f, t, st);
  fit(st);
  out.x = st.x;
  out.y = st.y;
  out.z = st.z;
  out.r = st.r;
  out.persp = st.persp;
  out.motion = Math.max(s.motion ?? 0, st.motion ?? 0);
  out.punch = punch;
  out.step = s.step || null;
  return out;
}

// A shot's note, for documentation tools.
export function shotAt(table, entry, t) {
  const shots = table && table.get(entry.id);
  if (!shots) return null;
  let s = shots[0];
  for (const cand of shots) if (t >= cand.t0) s = cand;
  return s;
}

export { ASPECT, D2R };
