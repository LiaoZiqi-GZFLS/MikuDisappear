// One palette for the whole film. The voice is always miku-teal, the machine
// speaks in bone white, the emergency system in hazard red, and memory is the
// only warm colour allowed in the picture.

const HEX = {
  ink: "#05070a",      // near-black ground
  ink2: "#0b0f14",     // panels
  slate: "#161d23",
  dim: "#6b7a82",      // unsung type, hairline rules
  ash: "#9dabb1",
  bone: "#eef1ec",     // machine voice
  miku: "#39c5bb",     // the voice (Hatsune Miku)
  mikuHi: "#9ff4e8",
  tealDeep: "#0d3d40",
  red: "#ff2f3c",      // emergency stop / error
  redDeep: "#6d0c16",
  amber: "#f0a94e",    // memory only
  leek: "#8ed14a",     // one beat, the leek
};

function hexToRgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => v / 255);
}

function toLinear(c) {
  return c.map((v) => (v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)));
}

export const PALETTE = HEX;

// linear-light values, used by shaders and by the compositor tints
export const LIN = Object.fromEntries(
  Object.entries(HEX).map(([k, v]) => [k, toLinear(hexToRgb(v))]),
);

export function css(name, alpha = 1) {
  const [r, g, b] = hexToRgb(HEX[name]).map((v) => Math.round(v * 255));
  return alpha >= 1 ? `rgb(${r},${g},${b})` : `rgba(${r},${g},${b},${alpha})`;
}

export function mix(a, b, t) {
  const ca = hexToRgb(HEX[a]);
  const cb = hexToRgb(HEX[b]);
  const out = ca.map((v, i) => v + (cb[i] - v) * t).map((v) => Math.round(v * 255));
  return `rgb(${out[0]},${out[1]},${out[2]})`;
}

function glslVec(name, hex) {
  const v = toLinear(hexToRgb(hex));
  return `const vec3 ${name} = vec3(${v.map((x) => x.toFixed(5)).join(", ")});`;
}

export const GLSL_PALETTE = `
${glslVec("C_INK", HEX.ink)}
${glslVec("C_INK2", HEX.ink2)}
${glslVec("C_SLATE", HEX.slate)}
${glslVec("C_DIM", HEX.dim)}
${glslVec("C_ASH", HEX.ash)}
${glslVec("C_BONE", HEX.bone)}
${glslVec("C_MIKU", HEX.miku)}
${glslVec("C_MIKU_HI", HEX.mikuHi)}
${glslVec("C_TEAL_DEEP", HEX.tealDeep)}
${glslVec("C_RED", HEX.red)}
${glslVec("C_RED_DEEP", HEX.redDeep)}
${glslVec("C_AMBER", HEX.amber)}
${glslVec("C_LEEK", HEX.leek)}
`;
