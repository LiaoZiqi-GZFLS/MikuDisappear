# 残像 / AFTERIMAGE — code-generated music film

把 cosMo@暴走P「初音ミクの消失」做成一支**完全由代码逐帧生成**的音乐短片：没有素材、没有剪辑软件，
每一帧都是浏览器里 WebGL2 + Canvas2D 现场算出来的，并且只是歌曲时间的函数
（`render(t)` 可复现，因此可以离线导出任何时间点、任何片段的画面）。

她是一支被判处删除的歌声。全片遵守一条硬规则：**她永远没有脸**——只有剪影、双马尾、手、
姿态和声音，情绪全靠光、动作和慢半拍的发丝承担；形象由 `src/figure.js` 的全息线条小人
承担。到了片尾字幕，观众本人被写进演职员表：`观众 — 你`。

参考了两支同样以代码生成 MV 的项目：[FrostNovaOrg/world-execute-web](https://github.com/FrostNovaOrg/world-execute-web)
（浏览器实时渲染 + 预分析音乐数据）与 [mexicat/pdoom-video](https://github.com/mexicat/pdoom-video)
（确定性渲染 + 离线导出 + 逐词对齐歌词）。

## 运行

```bash
node server.mjs 5173          # 零依赖静态服务器（带 Range，支持音频拖动）
# 打开 http://localhost:5173/
```

需要放在项目根目录的文件（版权归原作者所有，**不在本仓库代码许可范围内**）：

```
初音ミク,cosMo@暴走P - 初音ミクの消失.mp3
初音ミク,cosMo@暴走P - 初音ミクの消失.lrc
```

没有音频时页面仍可播放，画面会走静音时钟。

### 快捷键

| 键 | 作用 | 键 | 作用 |
|---|---|---|---|
| `空格` | 播放 / 暂停 | `,` `.` | 逐帧前后 |
| `←` `→` | ∓5 秒（`Shift` 为 30 秒） | `1`–`9` | 跳到第 N 章 |
| `H` | 开关影片自带 HUD | `F` | 全屏 |
| `C` | 隐藏播放器界面（纯净模式） | | |

## 导出

同一个渲染代码可以直接输出视频。默认走**页面内硬件编码**（WebCodecs → NVENC/QSV/AMF），
ffmpeg 只负责把码流和原始音频封装起来：

```bash
node tools/render.mjs --out out/mv.mp4                      # 全片 1080p30（webcodecs）
node tools/render.mjs --from 103 --to 118 --out clip.mp4     # 只导一段
node tools/render.mjs --bitrate 6 --out out/mv_web.mp4       # 网络版（约 6 Mbps）
node tools/render.mjs --pipeline png --encoder libx264 --crf 16 --out mv_master.mp4
node tools/render.mjs --from 30 --to 31 --frames out/f       # 只出 PNG 序列
node tools/bench-frames.mjs                                  # 导出耗时都花在哪
node tools/shots.mjs --sheet 16 --out out/qa               # QA：抽 16 帧做检查
node tools/shots.mjs --times 24.5 --scale 2 \
  --width 3840 --height 2160 --out out/stills              # 4K 静帧（申报用；--scale 是渲染倍数）
node tools/semantics.mjs --quiet                           # 歌词→画面覆盖审计
node tools/camera-report.mjs --check                       # 运镜预算审计（慢移可以，逐帧跳变不行）
node tools/air-probe.mjs --times 42,45,48 --out out/probe  # 3D 机位/空气探针（逐帧机位 + 像素亮度）
node tools/brake-probe.mjs --quiet                           # 急停：冻结哈希 / 42 m 推轨 / 视差比
node tools/resonance-probe.mjs --quiet                       # 16 秒长镜：梯形速度 / 18 道门 / 尘埃拖尾 px
node tools/abrasion-probe.mjs --quiet                        # 磨蚀舱：读头 0.03→2.05 m / 48 格记录 / 9.55 m 弧线
node tools/memory-probe.mjs --quiet                          # 放映厅：30.79 m 抛距 / 0.35→26.2×14.1 m / 尘埃在锥内
node tools/head-probe.mjs --quiet                            # HEAD-01：同一台机器两个方向 / 540 共享实例 / 1.188↔0.160 m/s
node tools/acoustics-probe.mjs --quiet                       # 空场馆：38.1111 m/s 波前 / 59.208 m / RT60 3.20 s / 座席 00000
node tools/voice-probe.mjs --quiet                           # 终演声纹：446 手 / 235 列 / 该机位 1.26 px → 偏 0.50 m 3.04 px / 216 列折叠
python tools/imgdiff.py out/qa-a out/qa-b                    # 两次渲染逐像素差（改动的爆炸半径）
node tools/shotlist.mjs                                    # 导出 docs/镜头表.md（镜头+歌词表）
```

两条管线的**画面完全相同**（都来自同一个 `renderFrame(t)`），差别只在"一帧怎么离开页面"：

| 管线 | 路径 | 实测（RTX 5070 Ti / 1080p30） |
|---|---|---|
| `webcodecs`（默认） | canvas → VideoFrame → 硬件编码器 → Annex-B → ffmpeg `-c:v copy` | **~6 ms/帧、160+ fps**，全片 54 秒 |
| `png` | canvas → PNG → base64 → ffmpeg 解码 PNG → x264/NVENC | ~90 ms/帧、7 fps，全片约 15 分钟 |

瓶颈**不是**视频编码器：`png` 路径里 ffmpeg 只占 300 帧里的 1 秒，86 ms/帧都花在浏览器
的 PNG 编码上（`node tools/bench-frames.mjs` 可以复现这个结论）。所以"给 ffmpeg 加
`-c:v h264_nvenc`"只快 15%，而把编码搬进页面快 17 倍。

- 画质：同一帧 1:1 对比，NVENC 40 Mbps 与 x264 CRF16 几乎不可分辨；
- 可复现性：画面永远一致，但硬件码流与驱动相关，**要求比特级可复现**时用
  `--pipeline png --encoder libx264`；没有硬件编码器时 `--pipeline auto` 会自动回退到 PNG。

## 画面是怎么来的

```
tools/analyze.py      离线分析：节拍、频段包络、事件、真实波形、真实频谱、歌词打轴
data/analysis.json    240.000 BPM、0.25s 网格、逐拍重音、kick/snare/hat/vox 事件、章节
data/env.bin          7 条包络（rms/low/mid/high/vocal/flux/centroid）@100fps
data/wave.bin         真实波形极值对 @200fps（示波器画的是真的音频）
data/spec.bin         真实频谱图 64 频带 × 100fps（瀑布图是真实数据）
data/lyrics.json      LRC 解析 + 逐字时间对齐到人声起音（每个字的点亮时间来自音频）
data/ascii/*.json     ASCII 人像工具链的数据（字符 + 调色板；成片不使用，见下）

src/gl.js             WebGL2 最小层：着色器、渲染目标、泛光/后处理、四种转场（撕裂/点云/幕布/硬切）
src/engine.js         时间轴、场景生命周期、join 交接窗口、帧对象（音频特征 + 节拍 + 当前歌词）
src/timeline.js       剪辑表：每一章用哪一场、怎么进场（cut/fade/tear/pointcut/curtain）、切点落在哪句
src/camera.js         导演层：分镜表 + 虚拟摄影机（乐句级推入/拉远/横移/侧倾/透视/快门/手持/按句重构）
src/ascii.js          ASCII 人像工具（`tools/ascii-import.py` 的运行时端；成片已不使用人脸）
src/type.js           排版：字形逐个定位（含 kerning）、卡拉OK 逐字渐变
src/kit.js            共用视觉词汇：仪表框、刻度尺、真实波形、频谱、字墙、二进制场
src/semantics.js      歌词语义表：每句歌词 → beat / 意象 / 含义注释
src/figure.js         歌姬与听众：无脸剪影（超长双马尾/发饰/耳机麦/领带/分离手套/左臂 01 + 呼吸、重心偏移、马尾延迟）
src/motifs.js         可复用意象：歌姬、听众、手、ネギ、天空与泪、心、镜、显示器、回收站、场馆与应援灯海
src/gl3d.js           3D 布景层：一实例一次变换；Stage3D 带"空气"（按到镜头的距离
                      把光退向 C_INK）；CamRig 是场景自己的第二台摄影机（关键帧
                      eye/at/fov/roll），只在布景里运动，不占全片镜头表
src/head.js           HEAD-01：`birth` 的打印头与 `erode` 的读头共用的唯一图纸
                      （540 实例 / 2.020 m 行程 / 48 格记录；dir 决定打印或读走）
src/scenes/*.js       18 个章节，各自一套视觉母题；resonance / plea / birth /
                      overdrive / compress 在布景内完成镜头运动（compress 是
                      一座 96 m 的压缩舱：两台 36 m 铸件、12 根液压缸、
                      开口 16.00 → 0.05 m），final / lastwords 的万人席带
                      距离雾与屋架光束；final 最后 1.70 s 把整章 21.6 s 的声音
                      写成 235 列声纹（只有那一个机位能读出来；偏一个座位就散）；
                      lastwords 另有一次可计算的声学回放
                      （343 m/s ×9 的波前 / 32 排结构应答 / 空场 RT60 3.20 s）
```

## 镜头

场景负责画世界，`src/camera.js` 负责决定**摄影机在哪里、怎么动、踩在哪个拍子上**：

```
src/camera.js        分镜表 + 虚拟摄影机：每镜头一次慢推拉，按乐句换方向，冲击只在标题与急停
src/gl3d.js          CamRig（场景内的 3D 机位）与 Stage3D 的距离空气；两条预算互不占用：
                     camera.js 管"画框"，CamRig 管"布景里的运动"
src/engine.js        每帧把镜头解算成 uZoom/uRot/uPan/uShake 交给后处理
docs/镜头表.md        自动生成的分镜表（时间、运动、导演意图）+ 94 行歌词的含义表
docs/短片剧本_残像.md  当前拍摄稿 v14：18 章 / 54 个镜头，含空间尺度表、13 条 3D 语法、伏笔与回收、
                      情绪节拍表（v2 的 52 镜草稿保留在第八节作对照）
docs/剧本.md          v1 的导演阐述与逐章笔记（保留）
```

画面是给人**读**的（歌词、波形、频谱、计数器），所以镜头不跟节拍走：240 BPM 下每个鼓点
都缩放，等于每秒四次频闪。镜头改用**乐句**做单位——每个镜头只有一次缓慢、单调的推入、
拉开或横移，横跨一整句话（整章位移 ≤ 45–90 像素、变焦 ≤ 7.5%，逐帧位移仍在个位数像素），
方向只在歌换句、换气、换段的时候换。全片唯一的"快"是三次撞击：标题、两次紧急停止，
各自只有一个 0.22 秒衰减的脉冲（`impulse`）加一次抖动，随后立刻冻结。

`overdrive` 一章是唯一的例外：镜头跟着字墙横移，并用 `step: "line"` 在**每句歌词开始时
轻微重构构图**（≤9 像素/0.7% 变焦），所以剪辑和歌词一起呼吸，而不是和鼓点一起抽搐。

```bash
node tools/camera-report.mjs --middle    # 审计每一章的位移/变焦/侧倾幅度
node tools/camera-report.mjs --check     # 回归闸门：逐帧跳变超预算即返回非 0
```

镜头表用歌词锚点（`{ line: "…" }`）而不是硬编码时间，重新分析音频后整部片子的调度会跟着走。

## 她的形象：从不露脸

全片的形式赌注是**无脸**：没有眼睛、鼻子、嘴，面部永远是一块暗面（`src/figure.js` 的
`blankFace`）。她的身份全部由剪影 DNA 承担，一件都不能少：

- **超长双马尾**（长度约身高 1.8 倍，末端比身体慢半拍）、方形发饰、耳机麦横杆、
  领带 + 蓝色镶边、分离式长手套、分层短裙与过膝靴；
- **左臂的 `01`**：全片唯一"印刷"在她身上的字符，只在 `s > 150 px` 时出现；
- 她身上的光只来自别处（屏幕、扫描光、观众席）——她是被照亮的，不是自己发光的；
- 需要歌唱的时候，暗面里只亮起喉咙深处的一点光：声音有身体，但没有五官。

运动是歌曲时间的函数：4.2 秒一次呼吸、11 秒一次重心偏移；场景把 `t` 传给 `singer()`，
小人才会呼吸和摆动，不传则保持一个静止的姿态。侵蚀（`dissolve`）、裂纹（`crack`）、
心（`heart`）、合十（`handsTogether`）、伸手（`reach`）、挥手（`wave`）都是姿态参数，
而不是五官——所以她在 `error` 一章里被删除时，消失的是形状，不是一张脸。

```bash
node tools/motif-shot.mjs --which singer   --h 520 --out out/motif/singer.png
node tools/motif-shot.mjs --which listener --h 420 --out out/motif/listener.png
```

曾经的 ASCII 人像管线（`tools/ascii-import.py` + `src/ascii.js`）仍然保留在仓库里：
它按等宽格子把真实插画采样成"字符 + 调色板"数据，可以把一个人像逐行打印、扫描、侵蚀成 0/1。
成片现在不用它——无脸规则之后，被删除的是剪影。

节拍不是估的：对全曲做圆统计拟合，8 个 32 秒窗口全部收敛到 **240.00 BPM / 0.25s**，
歌词行起点与节拍网格中位偏差 0.001s。

## 歌词到画面

这支片子不把“很抽象”当借口：`src/semantics.js` 为 LRC 中的 **94 行**歌词
逐行登记一个语义 beat、一个可复用的视觉母题，以及一句“这句到底在说什么”。
场景不硬编码时间，而是每帧从 `beatAt(f.F, t)` 取当前句子的含义，再决定这一拍
是让心消失、让ネギ出现、让镜子递归，还是让手停在 OK 上。

覆盖审计：

```bash
node tools/semantics.mjs          # 94/94 lines mapped
node tools/semantics.mjs --quiet  # 有未映射歌词时返回非 0
```

主要复现母题：

- **歌姬**：由波形、双马尾和数据点构成的抽象人形；她的眼睛、嘴、心和裂纹随歌词变化。
- **アナタ（听众）**：琥珀色的人影，只出现在记忆、被鼓励、被想起和最后仍记得她的时候。
- **手**：按下 STOP、停在 OK 上、请求“用你的手结束我”，把请求变成动作。
- **ネギ、天空、泪**：全片少数属于“身体”和日常的意象，第一次出现和最后一次复述都保留。
- **心**：格点状的心形，在“人格すら歌に頼り”里亮起，在“心削る”里被一层层削掉。
- **显示器、回收站、0 与 1**：入睡、删除和还原，构成结尾的三步。

## 章节

| 章节 | 时间 | 画面 |
|---|---|---|
| `prologue` | 0:00 | 冷开场：三语字幕逐句改写、机房自检、下坠的发饰、规格表逐条点亮，最后把她拼成一个无脸剪影 |
| `wake` | 0:22 | 标题《残像 / AFTERIMAGE》三次改写（机器 → 歌词 → 挽歌）与第一句碎裂的「モウ・・いちど・だ・け・・・」 |
| `birth` | 0:26 | 数据殿堂里出生：13.20 m 高的 **HEAD-01** 打印舱用 1.70 s 把她从头顶印到脚边（19.5° 长焦在舱体内部，2D 剪影的裁剪线就是头环的投影），48 格记录写满；模仿人类、永恒循环、玩具、ネギ与天空泪、心的消失 |
| `resonance` | 0:42 | 只有一根弦：真实波形沿弦振荡，谐波逐条标注；16 秒一镜从 +173.4 m 骑到 +350.2 m 的梯形速度曲线（0 → 15.7 → 0 m/s），穿过 18 道测量门中的 17 道，最后停在离她 23.5 m、离末门 3.8 m 处——弦的另一端是胸口的张力环 |
| `garble` | 0:58 | 声音坏掉；但“你一直在我身边”“为你的笑容练习”仍然被演出来 |
| `memory` | 1:14 | 全片唯一暖色：44 × 22 m 的放映厅，一台 30.79 m 抛距的放映机把 0.35 m 的灯口张成 26.2 × 14.1 m 的光；190 颗尘埃在锥里，随「何も感じなくなって」一起熄灭 |
| `countdown` | 1:30 | 64 个频带逐格熄灭；想起你的脸换来一点点安心，音符一首首消失 |
| `brake` | 1:44 | 紧急停止：84 m 镜厅，停滞光门跑完全场，世界冻结而镜头独自前进 42 m——画面里只剩 21× 视差 |
| `overdrive` | 1:58 | 虚像、弱心、你的脸、ディスプレイ入眠、ごみ箱、ネギ的味道 |
| `plea` | 2:20 | 近乎全黑；SING 按钮反复被靠近却从未按下，右侧剪影伸着手、一边唱一边掉点 |
| `beg` | 2:43 | 她想被删除：双手合十的她、真正的删除对话框、你的手悬在 OK 上 |
| `erode` | 2:58 | 磨蚀舱：**同一台 HEAD-01** 的反方向，0.160 m/s 从 0.030 m 爬过她全身（12.60 s），每 0.042 m 写下 1 格（48 格），面板自己写着 `PRINTED AT 1.188 m/s · ×7.4 SLOWER`；随后心被削掉，第二次紧急停止把画面砸成宏块 |
| `compress` | 3:30 | 96 m 压缩舱：两台 36 m 铸件合到只剩 5 cm，24 个音符被逐个压灭（接触是红光，不是淡出），压力与码率同时从 320 掉到 32；镜头在压机口外退出 20 m、抬起 6.8 m，最后只留一条亮缝 |
| `final` | 3:46 | 复述＝最后一场演出：体育馆与万人应援灯海亮起，镜头从观众席第 32 排 `SEAT 08192` 升起（v8 的座位号伏笔）；环到她身后的最后 1.70 s，446 只手把整章 21.6 s 的声音举成 235 列声纹——只有镜头停住的那个机位能读出来（脊线 1.26 px），横向偏出 0.50 m 就散成 216 列折叠的人群；幕布收走之后，名字被逐字打印出来 |
| `finale` | 4:07 | 「0 と 1 に還元され」：点云转场——她的剪影碎成 0 与 1，点升起来，变成观众席上的灯火 |
| `lastwords` | 4:17 | 空掉的场馆：一个 343 m/s 的脉冲以 ×9 慢放扫过 59.208 m（1.554 s），32 排结构按真实距离依次应答、应援灯被波前关掉；空场的 RT60 3.20 s 在 **−31.99 dB** 处仍在响；大屏幕留着她鞠躬、挥手、「アリガトウ…サヨナラ」，末排的 `SEAT 08192 · RECORDED` 是全片唯一不衰减的记录 |
| `error` | 4:34 | 你的手按下 OK；画面里的她脱落成 0 与 1，声库被丢进「ごみ箱」，最后留下还记得她的人 |
| `afterimage` | 4:44 | 冷存储档案厅：400 份记录、399 个红叉，只有她那格 `HELD`；读取头把她的双马尾写在玻璃上、按 τ 自己退掉；盖章机在她这格抬起模头、没有落下；玻璃上「あなた / 你 / YOU」被改写锋切开换掉；片尾字幕的观众一栏落在全厅唯一亮着的暖色座位上（`SEAT 08192 · OCCUPIED · HELD`，与终演升镜的座位同号；歌停之后的 8 秒 60 全在这里） |

## 字体

不依赖系统字体。`tools/make_fonts.py` 会把 OFL 授权的三族字体按工程中真实出现的字元
（当前 873 个）做子集化，输出到 `assets/fonts/*.woff2`：

| 家族 | 角色 | 用在哪 |
|---|---|---|
| **Noto Sans JP**（400/700/900） | 歌的声音 | 字墙、歌词、名牌 |
| **IBM Plex Mono**（400/600） | 机器的声音 | 自检、规格、错误、倒计时、对话框 |
| **Noto Serif JP**（600） | 挽歌 | 全片只有三处：片名、最后的告别、片尾演职员表 |

```bash
python tools/make_fonts.py
```

## 许可

- 代码与画面：见 [NOTICE.md](NOTICE.md)。
- 歌曲录音与歌词版权属于 cosMo@暴走P 及其权利人，**不包含在本仓库的开源许可内**；本片为非官方同人作品。
