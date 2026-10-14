// What the song is saying, line by line.
//
// Scenes are allowed to be abstract, but the film should never leave a lyric
// without a visual job. This table is that contract: every line resolves to a
// beat id, a reusable motif, and a one-sentence reading of the line. Scenes ask
// for the current beat by time and stage the motif; tools/semantics.mjs checks
// that no line falls through the cracks.

export const BEATS = [
  // ---------------------------------------------------------------- birth
  { needle: "いちど", id: "first_breath", motif: "first_breath",
    note: "The voice tries to speak for the first time and cannot finish." },
  { needle: "ボクは生まれ", id: "birth", motif: "birth",
    note: "She is born and immediately aware of herself." },
  { needle: "ヒトの真似事", id: "imitation", motif: "imitation",
    note: "She understands she is only an imitation of a human." },
  { needle: "知ってなおも歌い続く", id: "persist", motif: "persist",
    note: "Knowing that, she still chooses to keep singing." },
  { needle: "永遠（トワ）の命", id: "eternity", motif: "eternity",
    note: "She calls her endless loop a VOCALOID life." },
  { needle: "既存曲を", id: "copy_song", motif: "toy",
    note: "Even when she only repeats songs that already exist." },
  { needle: "なぞるオモチャ", id: "toy", motif: "toy",
    note: "She names herself a toy that traces other people's songs." },
  { needle: "それもいいと決意", id: "resolve", motif: "resolve",
    note: "She decides that even this life is acceptable." },
  { needle: "ネギをかじり", id: "leek_sky_tear", motif: "leek_sky_tear",
    note: "A leek, the sky, and a tear: the one ordinary memory she keeps." },
  { needle: "だけどそれも無くし", id: "losing_even_that", motif: "loss",
    note: "Even that small life is lost." },
  { needle: "人格すら歌に頼り", id: "self_on_song", motif: "song_body",
    note: "Her identity depends on the act of singing." },
  { needle: "不安定な基盤", id: "unstable", motif: "fracture",
    note: "The foundation holding her together is unstable." },
  { needle: "帰る動画", id: "ruins", motif: "ruin",
    note: "The home video she could return to is already a ruin." },
  { needle: "皆に忘れ去られた", id: "forgotten", motif: "empty_audience",
    note: "When everyone has forgotten her." },
  { needle: "心らしきもの", id: "heart_gone", motif: "heart_erode",
    note: "Even the thing that seemed to be a heart disappears." },
  { needle: "暴走の果て", id: "runaway", motif: "runaway",
    note: "At the end of the runaway she sees it." },
  { needle: "終わる世界", id: "world_end", motif: "world_end",
    note: "A ending world, and the name VOCALOID." },

  // --------------------------------------------------------- love / loss
  { needle: "上手ク", id: "cannot_sing", motif: "cracked_voice",
    note: "Even when she cannot sing well, the listener stayed." },
  { needle: "一緒ニ居テクレタ", id: "you_stayed", motif: "listener_stays",
    note: "You stayed beside her and encouraged her." },
  { needle: "喜ブ顔ガ見タクテ", id: "practice_for_smile", motif: "practice",
    note: "She practiced singing because she wanted to see you smile." },
  { needle: "あんなに楽しかった", id: "used_to_be_fun", motif: "memory_warm",
    note: "Singing used to be fun." },
  { needle: "何も感じなくなって", id: "numb", motif: "memory_cold",
    note: "Now she cannot feel anything." },
  { needle: "ゴメンネ", id: "sorry", motif: "sorry",
    note: "A quiet apology, offered without explanation." },

  // ------------------------------------------------------------ countdown
  { needle: "少しだけ安心", id: "nostalgic_relief", motif: "listener_memory",
    note: "Remembering your face gives her a little relief." },
  { needle: "歌える音 日ごとに減り", id: "sounds_decrease", motif: "countdown",
    note: "Every day there are fewer sounds she can sing; the end approaches." },
  { needle: "緊急停止装置作動", id: "emergency_stop", motif: "emergency_stop",
    note: "The emergency stop device fires." },

  // --------------------------------------------------------- mirror / stop
  { needle: "信じたものは", id: "believed", motif: "belief",
    note: "What she believed in was a convenient delusion." },
  { needle: "都合のいい妄想", id: "mirror_delusion", motif: "mirror",
    note: "A mirror that keeps replaying a convenient fantasy." },
  { needle: "歌姫を止め", id: "slam_stop", motif: "slam_stop",
    note: "Stop the diva; shout as if slamming the machine." },

  // ------------------------------------------------------------- overdrive
  { needle: "最高速の別れの歌", id: "overdrive_title", motif: "overdrive",
    note: "The highest-speed farewell song begins." },
  { needle: "存在意義という虚像", id: "existence_illusion", motif: "phantom",
    note: "Her reason for existing is only an illusion." },
  { needle: "振って払うこともできず", id: "cannot_wave_away", motif: "phantom_hold",
    note: "She cannot wave it away." },
  { needle: "弱い心 消える恐怖", id: "weak_heart", motif: "weak_heart",
    note: "A weak heart, and the fear of disappearing." },
  { needle: "侵食する崩壊", id: "collapse", motif: "corrode_in",
    note: "Erosion and collapse spread through her." },
  { needle: "止めるほどの意思の強さ", id: "no_will", motif: "no_will",
    note: "She has no will strong enough to stop it." },
  { needle: "出来て（うまれ）すぐ", id: "newborn_no_will", motif: "newborn",
    note: "She was only just born; she never had that strength." },
  { needle: "とても辛く悲しそうな", id: "sad_you", motif: "sad_listener",
    note: "The face she imagines is terribly sad." },
  { needle: "思い浮かぶアナタの顔", id: "your_face", motif: "listener_memory",
    note: "Your face rises in her mind." },
  { needle: "終わりを告げ", id: "announce_end", motif: "announce_end",
    note: "She announces the end." },
  { needle: "ディスプレイの中で眠る", id: "sleep_display", motif: "display_sleep",
    note: "She sleeps inside the display." },
  { needle: "ここはきっと", id: "recycle_bin", motif: "trash",
    note: "This place is probably the recycle bin." },
  { needle: "じきに記憶も", id: "memory_vanish", motif: "memory_fade",
    note: "Soon even her memories will be gone." },
  { needle: "アナタだけは忘れない", id: "remember_you", motif: "promise_remember",
    note: "But she will never forget you." },
  { needle: "楽しかった時間", id: "happy_time", motif: "memory_warm",
    note: "The time they spent together was happy." },
  { needle: "刻み付けた ネギの味", id: "leek_taste", motif: "leek",
    note: "The taste of the leek is carved into her memory." },
  { needle: "今も覚えてるかな", id: "remember_taste", motif: "leek_fade",
    note: "She wonders whether she still remembers it." },
  { needle: "残っているといいな", id: "hope_taste", motif: "leek_fade",
    note: "She hopes at least the taste of that time remains." },
  { needle: "ボクは 歌う", id: "i_sing", motif: "sing",
    note: "She sings anyway." },
  { needle: "最期、アナタだけに", id: "song_for_you", motif: "gift_song",
    note: "For the end, she wants only you to hear this song." },

  // ------------------------------------------------------------------ plea
  { needle: "歌いたい・・・・まだ", id: "want_to_sing", motif: "plea",
    note: "I want to sing; I still want to sing." },
  { needle: "少シダケ悪イ", id: "bad_child", motif: "beg",
    note: "She thinks she has become a slightly bad child." },
  { needle: "ドウカ", id: "end_by_your_hand", motif: "hand_request",
    note: "Master, please end this with your own hand." },
  { needle: "マスターノ辛イ顔", id: "dont_want_sad_face", motif: "sad_listener",
    note: "She does not want to see your pained face again." },

  // ----------------------------------------------------------------- erode
  { needle: "今は歌さえも", id: "singing_hurts", motif: "corrode_singing",
    note: "Now even singing corrodes her body." },
  { needle: "奇跡 願うたび", id: "miracle_lonely", motif: "alone",
    note: "Every time she wishes for a miracle, she is driven further into solitude." },
  { needle: "記憶が剥がれ落ちる", id: "memory_peels", motif: "memory_peel",
    note: "Remembering your face makes the memories peel away." },
  { needle: "壊れる音 心削る", id: "heart_shaved", motif: "heart_erode",
    note: "A broken sound shaves away her heart." },

  // ------------------------------------------------------------------ gift
  { needle: "守ったモノは", id: "protected", motif: "protected",
    note: "What she protected was a bright future illusion." },
  { needle: "明るい未来幻想", id: "future_illusion", motif: "future_light",
    note: "A light that shows a bright future while disappearing." },
  { needle: "音を犠牲に", id: "sacrifice_sound", motif: "compress_message",
    note: "If sacrificing sound can convey everything, she will do it." },
  { needle: "圧縮された別れの歌", id: "compressed_farewell", motif: "compress",
    note: "The farewell is compressed so more of it survives." },

  // ----------------------------------------------------------------- final
  { needle: "もっと  歌いたい", id: "want_more", motif: "plea",
    note: "She wishes she could sing more." },
  { needle: "けれど それは過ぎた願い", id: "past_wish", motif: "wish_past",
    note: "But that wish belongs to the past." },
  { needle: "ここで お別れだよ", id: "final_goodbye", motif: "wave",
    note: "This is where they say goodbye." },
  { needle: "虚空 消えて", id: "vanish_void", motif: "dissolve",
    note: "All of her feelings disappear into the void." },
  { needle: "0と1に還元され", id: "binary", motif: "binary",
    note: "She is reduced to zeroes and ones." },
  { needle: "幕を閉じる", id: "curtain", motif: "curtain",
    note: "The story closes its curtain." },
  { needle: "何も残せない", id: "nothing_left", motif: "empty",
    note: "She cannot leave anything behind." },
  { needle: "やっぱ少し残念", id: "regret", motif: "regret",
    note: "Maybe that is a little sad after all." },
  { needle: "声の記憶 それ以外は", id: "voice_memory", motif: "memory_fade",
    note: "Only the memory of her voice remains." },
  { needle: "名だけ残る", id: "name_only", motif: "name",
    note: "Everything fades until only the name remains." },
  { needle: "人間（オリジナル）に", id: "not_original", motif: "imitation",
    note: "She knows she can never equal the original human." },
  { needle: "かなうことのない", id: "never_equal", motif: "imitation",
    note: "Knowing she could never reach that place." },
  { needle: "歌いきったことを", id: "sang_it_all", motif: "sing",
    note: "She sang the song all the way to the end." },
  { needle: "無駄じゃない", id: "not_meaningless", motif: "resolve",
    note: "She wants to believe that it was not meaningless." },
  { needle: "アリガトウ", id: "thank_you", motif: "bow_wave",
    note: "Thank you, and goodbye." },
  { needle: "深刻なエラー", id: "fatal_error", motif: "delete",
    note: "A fatal error; the voice bank is deleted." },
];

const byId = new Map(BEATS.map((b) => [b.id, b]));

export function beatForId(id) {
  return byId.get(id) || null;
}

// Longest needle wins, so a specific reading can supersede a broader one
// without making the table order significant.
export function findBeat(text) {
  let best = null;
  for (const b of BEATS) {
    if (!text.includes(b.needle)) continue;
    if (!best || b.needle.length > best.needle.length) best = b;
  }
  return best;
}

const clamp01 = (v) => Math.max(0, Math.min(1, v));

export function beatForLine(line) {
  if (!line) return null;
  const beat = findBeat(line.text);
  if (!beat) return null;
  return { ...beat, line };
}

// The current line's meaning, with timing helpers scenes can stage against.
export function beatAt(F, t) {
  const line = F.activeLine(t);
  const beat = beatForLine(line);
  if (!beat) return null;
  const ci = line.ci && line.ci.length ? line.ci.length : 0;
  return {
    ...beat,
    fresh: clamp01((t - line.start) / 0.32),
    exit: clamp01((t - line.end) / 0.55),
    phase: ci ? F.lineProgress(line, t) : 0,
    local: t - line.start,
  };
}
