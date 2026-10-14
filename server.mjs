// Zero-dependency static server with byte-range support (needed for audio
// seeking). `node server.mjs [port]`

import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.argv[2] || 5173);

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".bin": "application/octet-stream",
  ".mp3": "audio/mpeg",
  ".lrc": "text/plain; charset=utf-8",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".txt": "text/plain; charset=utf-8",
  ".md": "text/markdown; charset=utf-8",
};

const server = http.createServer((req, res) => {
  let pathname;
  try {
    pathname = decodeURIComponent(new URL(req.url, "http://localhost").pathname);
  } catch {
    res.writeHead(400).end("bad path");
    return;
  }
  if (pathname.endsWith("/")) pathname += "index.html";
  const file = path.join(ROOT, pathname);
  if (!file.startsWith(ROOT)) {
    res.writeHead(403).end("forbidden");
    return;
  }
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) {
      res.writeHead(404, { "content-type": "text/plain; charset=utf-8" }).end("404 " + pathname);
      return;
    }
    const type = MIME[path.extname(file).toLowerCase()] || "application/octet-stream";
    const headers = {
      "content-type": type,
      "cache-control": "no-cache",
      "accept-ranges": "bytes",
    };
    const range = req.headers.range;
    if (range) {
      const m = /^bytes=(\d*)-(\d*)$/.exec(range.trim());
      if (m) {
        const start = m[1] ? Number(m[1]) : 0;
        const end = m[2] ? Math.min(Number(m[2]), st.size - 1) : st.size - 1;
        if (start <= end) {
          res.writeHead(206, {
            ...headers,
            "content-range": `bytes ${start}-${end}/${st.size}`,
            "content-length": end - start + 1,
          });
          fs.createReadStream(file, { start, end }).pipe(res);
          return;
        }
      }
    }
    res.writeHead(200, { ...headers, "content-length": st.size });
    if (req.method === "HEAD") res.end();
    else fs.createReadStream(file).pipe(res);
  });
});

server.listen(PORT, () => {
  console.log(`MV server: http://localhost:${PORT}/`);
  console.log(`  frame at a time : http://localhost:${PORT}/?t=103.7&ui=0`);
});
