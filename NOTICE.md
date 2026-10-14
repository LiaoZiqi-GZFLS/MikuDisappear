# Notice

## 歌曲

「初音ミクの消失」— 作词 / 作曲 / 编曲：cosMo@暴走P。

本仓库**不包含**该曲的录音与歌词文本的任何授权。运行时从项目根目录读取用户自备的
`初音ミク,cosMo@暴走P - 初音ミクの消失.mp3` 与同名 `.lrc`，分析结果
（`data/*.json`、`data/*.bin`：节拍、包络、波形极值、频谱、逐字时间）由这些文件派生，
仅用于本机渲染与歌词对齐，其版权同样属于原作者及其权利人。

本片为非官方同人影像作品，与 VOCALOID / Crypton Future Media / cosMo@暴走P 无隶属关系。

## 代码与画面

- 渲染代码、着色器、场景、排版与播放器：本项目原创（`src/`、`tools/`、`index.html`、
  `server.mjs`）。
- 视觉母题均为原创图形：波形、频谱瀑布、二进制场、镜面、压缩宏块、错误对话框等，
  其余母题（歌姬、听众、ネギ、天空、心、场馆、应援灯海）均为代码绘制。
- **ASCII 人像**是一组保留的工具链（`tools/ascii-import.py` + `src/ascii.js`）：把参考图
  采样成字符网格，运行时只读取 `data/ascii/*.json` 中的字符与调色板数据，用工程自带的字体
  逐字重排。**当前成片不使用它**——片中的她始终是无脸剪影，ASCII 管线留给后续肖像实验。

### ASCII 人像的参考图

| 文件 | 用途 | 来源与授权 |
|---|---|---|
| `assets/ref/miku_luogu.png` | `data/ascii/miku-face.json` / `data/ascii/miku-bust.json`（工具链示例，成片不使用） | 由本工程的使用者提供的初音未来同人插画（1920×1080 PNG）。授权状态由提供者负责；如需公开分发，请先确认该图的授权，或改换为你拥有权利的图片后用同一条管线重新生成。 |

重新生成人像数据：

```bash
# 任意一张你拥有权利的图片都可以：裁切 → 采样 → 输出字符+调色板数据
python tools/ascii-import.py assets/ref/miku_luogu.png data/ascii/miku-face.json \
    --crop 0.336,0.020,0.556,0.460 --cols 150 --background auto --gamma 0.78
```

角色"初音ミク"的著作权属于 Crypton Future Media，本片为同人作品，与官方无隶属关系。

## 字体

`assets/fonts/*.woff2` 是从以下 OFL 1.1 授权字体子集化得到的（仅保留工程中出现的字元）：

| 字体 | 用途 | 授权 |
|---|---|---|
| Noto Sans JP（Google / Adobe） | 歌词与标题排版（400 / 700 / 900） | `assets/fonts/src/NotoSansJP-OFL.txt` |
| IBM Plex Mono（IBM） | 机器读数、时间码、标签（400 / 600） | `assets/fonts/src/IBMPlexMono-OFL.txt` |
| Noto Serif JP（Google / Adobe） | 挽歌：片名、最后的告别、片尾演职员表（600） | `assets/fonts/src/NotoSerifJP-OFL.txt` |

子集字体同样按 SIL Open Font License 1.1 分发；`assets/fonts/src/` 保留了上游 TTF 与授权原文，
可用 `python tools/make_fonts.py` 重新生成子集。

## 工具链

- 分析脚本依赖 numpy / scipy，解码由 ffmpeg 完成（`tools/analyze.py`）。
- 离线导出依赖 ffmpeg 与 `playwright-core`（驱动本机 Chromium 内核浏览器，`tools/render.mjs`）。
  默认管线在页面内用 WebCodecs 调用本机硬件编码器（NVIDIA NVENC / Intel QSV / AMD AMF），
  ffmpeg 只做封装；`--pipeline png` 是纯 CPU 的备用路径，两者画面相同。
- 运行与渲染本身无第三方运行时依赖（原生 WebGL2 + Canvas2D + ES modules）。
