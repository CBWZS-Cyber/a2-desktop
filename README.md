# A2 Learnest · Desktop

The desktop companion app for **Learnest** (兴海智学), a study assistant that helps
Chinese university students organise wrong answers, diagnose weak knowledge
points, and practise with course-aligned exercises.

This repository contains **only the desktop shell**: an Electron app that lives
as a small always-on-top character on the desktop and opens the Learnest web
application when clicked. The Learnest service itself (model gateway, textbook
index, account system) is operated separately and is not part of this
repository.

---

## What the app does

| Behaviour | Implementation |
| --- | --- |
| Desktop pet as entry point | Transparent, frameless, always-on-top `BrowserWindow` with a character sprite |
| Click to open | Clicking the character opens the main window (or focuses it if already open) |
| Click-through | The window is click-through by default; only opaque character pixels accept the mouse, using an alpha-mask hit test |
| Drag to move | Dragging moves the pet; the position is persisted and restored on next launch |
| Tray | Tray icon with open / hide / autostart / reset position / quit |
| Start with Windows | Optional `app.setLoginItemSettings` registration |
| Offline fallback | A local page replaces the remote site when the service is unreachable |

## Architecture

```
main process (src/main.js)
├── pet window      transparent · frameless · always on top · alpha hit test
├── main window     https://learnest.cn (falls back to IP, then to offline.html)
├── tray            menu, autostart toggle
└── single instance one process, second launch focuses the existing window

renderer (src/pet.html)
├── zx_idle.png     static idle sprite
├── zx_bounce.webm  transparent-alpha entrance animation
└── alpha mask hit test  → IPC → main process enables/disables click-through
```

The pet window uses per-pixel hit testing rather than a rectangle: the mask is
built from the character's alpha channel (image and video separately, the video
mask refreshed at ~11 Hz), and the main process toggles
`setIgnoreMouseEvents(true, { forward: true })` accordingly. Gaps between the
arms and the body, and the area outside the rounded silhouette, genuinely let
clicks reach the desktop underneath. Solid speech bubbles are deliberately
treated as opaque so a click on them cannot accidentally open a desktop icon
behind the pet.

## Build

Requirements: Node.js 22+, Python 3 with Pillow, Inno Setup 6.

```bash
npm ci
node build/build.js          # installer  → dist/A2兴海智学_安装版_<version>.exe
node build/make-portable.js  # portable   → dist/A2兴海智学_绿色版_<version>.zip
```

`build/make-shell.js` assembles the unpacked runtime and stamps the icon and
version resources; `installer.iss` wraps it into a Simplified Chinese installer.
The version number has a single source of truth in `package.json` and is passed
to the Inno Setup compiler via `/DMyAppVersion`.

The portable build intentionally renames the official Electron executable
without rewriting its PE resources, which preserves the upstream binary hash and
therefore keeps running on machines where Smart App Control blocks freshly
compiled unsigned binaries.

### Headless self-checks

The app ships with four automation modes used by CI and by hand:

```bash
A2兴海智学.exe --smoke          # pet window: sprite/video load, alpha hit test, zero JS errors
A2兴海智学.exe --smoke-main     # main window: site reachable, offline fallback works
A2兴海智学.exe --smoke-flow     # window state machine: single instance, close-to-tray, reopen
A2兴海智学.exe --shot           # render the pet offscreen and dump PNG screenshots
```

Each writes a JSON report to `--smoke-out=<path>` and exits non-zero on failure.

## Releases and code signing

Official releases are built by GitHub Actions on a GitHub-hosted
`windows-latest` runner (`.github/workflows/release.yml`). Tagging `v*` builds
both artifacts and, once the signing secrets are configured, submits them to
**SignPath Foundation** for code signing.

> Signed release builds are code-signed by the
> [SignPath Foundation](https://signpath.org/) free code-signing program for open
> source projects.

## Privacy

See [PRIVACY.md](PRIVACY.md). The desktop shell itself collects nothing and
sends no telemetry; it displays the Learnest web application, whose data
practices are described in that document.

## License

MIT — see [LICENSE](LICENSE). The character artwork in `assets/` is part of the
project and distributed under the same license.

---

## 中文说明

A2 兴海智学桌面端：桌面上一个小张形象常驻，点他进入学习中心。

- 本仓库只包含 **桌面外壳**，不含服务端、模型网关与教材索引。
- 本机构建：`node build/build.js` 出安装包，`node build/make-portable.js` 出绿色版。
- 正式发布由 GitHub Actions 构建；大版本提交 SignPath Foundation 签名。
- 详细操作说明见 [`使用说明.txt`](使用说明.txt)。
