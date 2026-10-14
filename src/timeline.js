// The edit. Times are resolved from the analysis at load (sections come from
// tools/analyze.py, lines from the LRC), so re-analysing the audio moves the
// whole film with it.
//
// `join` says how an entry enters the film:
//   type  "cut" | "fade" | "tear" | "pointcut" | "curtain"
//   dur   the length of the hand-over window (0 = a hard cut)
//   bias  0 = the window starts at the boundary, 0.5 = it straddles it,
//         1 = it ends at the boundary
//   move  "glide" | "whip" — the camera relays from the outgoing shot's
//         framing to this one's during the window (a cut becomes a camera move)
//   motion  shutter strength during the relay (0..1)

// The record outlives the voice. The song ends at 4:46.72 and the last three
// seconds of it are already silent; the picture keeps running for a further
// FILM_TAIL seconds so the credits can be written *after* the audio is gone.
// Nothing is heard under them -- the file is simply still open.
export const FILM_TAIL = 8.6;

export const TIMELINE_SPEC = [
  { id: "prologue", scene: "prologue", from: { section: "boot" }, to: { section: "wake" },
    join: { type: "fade", dur: 1.2, bias: 0.6 } },

  { id: "wake", scene: "wake", from: { section: "wake" }, to: { section: "birth" } },

  // the title's push turns into the cathedral's dive: one camera, two shots
  { id: "birth", scene: "birth", from: { section: "birth" }, to: { section: "resonance" },
    join: { type: "hard", dur: 0.7, bias: 0.5, move: "glide", motion: 0.55 } },

  { id: "resonance", scene: "resonance", from: { section: "resonance" }, to: { section: "garble" } },

  { id: "garble", scene: "garble", from: { section: "garble" }, to: { section: "memory" },
    join: { type: "hard", dur: 0.5, bias: 0.5, move: "whip", motion: 0.9 } },

  // the tear finally opens the frame onto the only warm colour in the film
  { id: "memory", scene: "memory", from: { section: "memory" }, to: { section: "countdown" },
    join: { type: "tear", dur: 0.5, bias: 0.5 } },

  { id: "countdown", scene: "countdown", from: { section: "countdown" }, to: { section: "brake" } },

  { id: "brake", scene: "brake", from: { section: "brake" }, to: { section: "overdrive" } },

  { id: "overdrive", scene: "overdrive", from: { section: "overdrive" }, to: { section: "plea" },
    join: { type: "hard", dur: 0.45, bias: 0.5, move: "whip", motion: 0.95 } },

  { id: "plea", scene: "plea", from: { section: "plea" }, to: { section: "beg" },
    join: { type: "fade", dur: 0.9, bias: 0.5 } },

  { id: "beg", scene: "beg", from: { section: "beg" }, to: { section: "erode" } },

  { id: "erode", scene: "erode", from: { section: "erode" }, to: { section: "compress" } },

  { id: "compress", scene: "compress", from: { section: "compress" }, to: { section: "final" } },

  // the curtain opens on the concert
  { id: "final", scene: "final", from: { section: "final" }, to: { line: "0と1に還元され" },
    join: { type: "curtain", dur: 1.4, bias: 0.8 } },

  // "0 と 1 に還元され": her pixels gather and become the audience's lights
  { id: "finale", scene: "final", from: { line: "0と1に還元され" }, to: { section: "lastwords" },
    // `gate` keeps the dark hall in place: only her silhouette and the
    // penlights come apart, cross the room, and land in the seats.
    // The window opens *on* the line, not a second before it: shot 44 ends on
    // a clean frame of her with the whole house in front of the lens, and the
    // reduction starts exactly when the lyric says it does.
    // `cells` is the mosaic's resolution: at 192x108 a cell is ten pixels, so
    // what leaves the picture reads as her grain, not as a wall of tiles.
    join: { type: "pointcut", dur: 1.2, bias: 0.25, ball: 1.25, gate: 0.02, cells: [192, 108] } },

  // The curtain has already closed inside `final` -- the stage goes dark and
  // the name is printed on it -- so the hand-over to the empty hall is a fade:
  // the plaque holds for a beat, goes to black, and the house comes up empty.
  // A second curtain effect here would read as the show closing twice.
  { id: "lastwords", scene: "lastwords", from: { section: "lastwords" }, to: { section: "error" },
    join: { type: "fade", dur: 1.1, bias: 0.55 } },

  { id: "error", scene: "error", from: { section: "error" }, to: { section: "error", offset: 10 } },

  // the last three seconds: black, and an afterimage that exists only in the eye
  { id: "afterimage", scene: "afterimage", from: { section: "error", offset: 10 },
    tail: FILM_TAIL, join: { type: "fade", dur: 0.8, bias: 0.5 } },
];

// Shown in the player's chapter list.
export const CHAPTER_NAMES = {
  prologue: "\u8bb0\u5f55 / THE RECORD",
  wake: "\u6b8b\u50cf / AFTERIMAGE",
  birth: "\u8a95\u751f / BIRTH",
  resonance: "\u5171\u9e23 / RESONANCE",
  garble: "\u7535\u5b50\u566a\u58f0 / GARBLE",
  memory: "\u8bb0\u5fc6 / MEMORY",
  countdown: "\u6d88\u8017 / COUNTDOWN",
  brake: "\u7d27\u6025\u505c\u6b62 / EMERGENCY STOP",
  overdrive: "\u6700\u9ad8\u901f / OVERDRIVE",
  plea: "\u6073\u6c42 / PLEA",
  beg: "\u8bf7\u6c42\u5220\u9664 / REQUEST",
  erode: "\u8680\u98df / EROSION",
  compress: "\u538b\u7f29 / COMPRESS",
  final: "\u6700\u7ec8\u6b4c / FINAL",
  finale: "0 \u3068 1 / REDUCTION",
  lastwords: "\u544a\u522b / LAST WORDS",
  error: "\u6d88\u5931 / DELETION",
  afterimage: "\u6b8b\u50cf / AFTERIMAGE",
};
