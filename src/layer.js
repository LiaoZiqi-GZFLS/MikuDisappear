// An offscreen 2D canvas that uploads to a GL texture once per frame.

import { updateCanvasTexture } from "./gl.js";

export class Layer2D {
  constructor(gl, w = 1920, h = 1080, { scale = 1, linear = true } = {}) {
    this.gl = gl;
    this.w = w;
    this.h = h;
    this.scale = scale;
    this.canvas = document.createElement("canvas");
    this.canvas.width = Math.round(w * scale);
    this.canvas.height = Math.round(h * scale);
    this.ctx = this.canvas.getContext("2d");
    this.ctx.setTransform(scale, 0, 0, scale, 0, 0);
    this.ctx.textBaseline = "alphabetic";
    this.tex = gl.createTexture();
    const f = linear ? gl.LINEAR : gl.NEAREST;
    gl.bindTexture(gl.TEXTURE_2D, this.tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, f);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, f);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    this.upload();
  }

  clear() {
    const c = this.ctx;
    c.setTransform(this.scale, 0, 0, this.scale, 0, 0);
    c.clearRect(0, 0, this.w, this.h);
  }

  get font() { return this.ctx.font; }
  set font(v) { this.ctx.font = v; }

  upload() {
    updateCanvasTexture(this.gl, this.tex, this.canvas);
    return this.tex;
  }

  dispose() {
    this.gl.deleteTexture(this.tex);
  }
}

// Small helper for scenes that need a second (often lower-res) layer.
export function makeLayer(ctx, w = 1920, h = 1080, opts = {}) {
  return new Layer2D(ctx.gl, w, h, { scale: ctx.scale, ...opts });
}
