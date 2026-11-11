// A2 兴海智学 · 桌面端主进程
// 结构：桌宠窗（透明置顶，常驻桌面，点击进主窗） + 主窗（学习中心） + 托盘
'use strict';

const { app, BrowserWindow, Tray, Menu, ipcMain, screen, nativeImage, shell, dialog, session } = require('electron');
const path = require('path');
const fs = require('fs');
const updater = require('./updater');
const uiprompt = require('./uiprompt');

const SITE_PRIMARY = 'https://learnest.cn/';
const SITE_FALLBACK = 'http://39.96.82.119:8090/';

// 调试用：--url=http://127.0.0.1:8090/ 可以让主窗直接指本地起的服务，
// 改前端不用等部署。正常启动不带这个参数，仍走线上。
const URL_ARG = process.argv.find((a) => a.startsWith('--url='));
const START_URL = URL_ARG ? URL_ARG.slice('--url='.length) : SITE_PRIMARY;

// ── 桌面端专属样式（只注入到 Electron 窗口，线上网页一个字都不改）──
// 网页版首页是「大厅一屏 + 四步流程一屏」，逐屏讲故事，适合手机下滑；
// 桌面窗口 1180×800 是干活的界面，滚两屏才能摸到功能入口不划算。
// 所以：干掉整屏高的四步区块与"向下滑动"提示，大厅压成内容高度，
// 让课程入口在默认窗口里一屏可见。
const DESKTOP_CSS = `
  /* 四步流程整屏、向下滑动提示：桌面端不需要 */
  .flow-block, .lobby-cue { display: none !important; }

  /* 大厅从"整屏海报"压成一条横幅：标题与小张都保留 */
  .lobby {
    min-height: auto !important;
    padding: 20px 24px 6px !important;
  }
  /* 学校署名保留，压小一号省高度 */
  .lobby-eyebrow {
    font-size: 11px !important;
    letter-spacing: .2em !important;
    text-indent: .2em !important;
    margin-bottom: 8px !important;
  }
  /* 小张缩到 170px 宽（原 272px），仍由页面脚本播放入场动画 */
  .lobby-scene { gap: 8px !important; --zx-shift: 108px; }
  .zx {
    width: 170px !important;
    margin-bottom: -40px !important;   /* 视频里角色只占画面 49% 高，下面大半是透明留白，收掉 */
  }
  /* 角色本身放大到接近网页版观感；等比缩放画面，透明留白一起放大，
     且不影响布局高度（transform 不参与排版） */
  .zx-img, .zx-video { transform: scale(1.25); transform-origin: 50% 50%; }

  /* 标题 1180 窗口下原本是 87px 两行，压到单行 34px */
  .lobby-title {
    font-size: 34px !important;
    line-height: 1.2 !important;
    letter-spacing: .04em !important;
  }
  /* 原本靠 <br> 分两行，压成一行后要给后半段补个间隔 */
  .lobby-br + .ch { margin-left: .34em !important; }
  .lobby-br { display: none !important; }
  .lobby-sub {
    margin-top: 10px !important;
    font-size: 12.5px !important;
    letter-spacing: 0 !important;
    max-width: 560px;
  }

  /* 桌面版是装在本机的软件，不是备案网站：不显示 ICP 备案号。
     服务端注入的浮动脚注（#a2-icp）和登录页 .foot 里的那条链接一起藏掉。 */
  #a2-icp,
  a[href*="beian.miit.gov.cn"] { display: none !important; }
`;

// 账号中心里加一行桌面端独有的开关（脚本在 src/acct-pet-switch.js，单独成文件便于测试）
const ACCT_PET_SWITCH_JS = fs.readFileSync(
  path.join(__dirname, 'acct-pet-switch.js'),
  'utf8'
);
const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36 A2Desktop/1.0';

// 桌宠窗口尺寸 = pet.html 里 body 的 200×300 × 缩放系数 0.82（两处必须一起改）
const PET_W = 164;
const PET_H = 246;

// 自检模式：窗口挪到屏幕外，绝不打扰正在用电脑的人
const SMOKE_MODES = ['--smoke', '--smoke-main', '--smoke-flow', '--smoke-desk', '--smoke-quit', '--smoke-update', '--shot'];
const OFFSCREEN = process.argv.some((a) => SMOKE_MODES.includes(a));

// 调试版（--dev）：直接跑源码，改完刷新就生效，不用打包。
// 配置单独存一份，免得把安装版的桌宠位置、开机自启状态覆盖掉。
const IS_DEV = process.argv.includes('--dev');
if (IS_DEV) {
  try {
    app.setPath('userData', path.join(app.getPath('appData'), 'A2兴海智学-dev'));
  } catch (_) {
    /* 设不了就用默认目录，不影响启动 */
  }
}

// 自检/截图一律用临时配置目录：这些模式会把桌宠摆到屏幕外（-20000），
// 一旦写进真实 desktop.json，下次正常启动就会把小张夹到屏幕边缘。
// 这条是补 2026-11-08 的坑：自检把坐标写进了用户配置。
if (OFFSCREEN && !IS_DEV) {
  try {
    app.setPath('userData', path.join(app.getPath('temp'), 'a2-smoke-profile'));
  } catch (_) {
    /* 设不了就退化成默认目录 */
  }
}

// 同一个 profile 被多个自检共用，而 `--smoke-quit` 会把 closeAction 写成 quit 以验证退出。
// 它自己来不及恢复（进程就是要退掉），下一个 `--smoke-flow` 就遭殃：
// w1.close() 直接走退出分支，报告一个字都写不出来，看起来像"自检坏了"。
// 所以在进入任何别的自检前，先把这份共享配置归位。
if (OFFSCREEN && !IS_DEV && !process.argv.includes('--smoke-quit')) {
  try {
    const p = path.join(app.getPath('userData'), 'desktop.json');
    let cfg = {};
    try {
      cfg = JSON.parse(fs.readFileSync(p, 'utf8')) || {};
    } catch (_) {
      cfg = {};
    }
    if (cfg.closeAction && cfg.closeAction !== 'ask') {
      cfg.closeAction = 'tray';
      fs.writeFileSync(p, JSON.stringify(cfg, null, 2) + '\n', 'utf8');
    }
  } catch (_) {
    /* 写不了就按默认走，自检自己会断言出来 */
  }
}

let petWin = null;
let mainWin = null;
let tray = null;
let quitting = false;
let mainHiddenByUser = false; // 用户主动收起的窗口，load 完成不许再弹出来
let dragTimer = null;
let drag = null;

// ── 配置持久化（桌宠位置、自启状态）─────────────────────────────
function cfgPath() {
  return path.join(app.getPath('userData'), 'desktop.json');
}
function loadCfg() {
  try {
    return JSON.parse(fs.readFileSync(cfgPath(), 'utf8')) || {};
  } catch (_) {
    return {};
  }
}
function saveCfg(patch) {
  const next = Object.assign(loadCfg(), patch);
  try {
    fs.mkdirSync(path.dirname(cfgPath()), { recursive: true });
    fs.writeFileSync(cfgPath(), JSON.stringify(next, null, 2), 'utf8');
  } catch (err) {
    console.error('[cfg] 写入失败:', err.message);
  }
  return next;
}

let petIgnore = null;

// 桌宠窗默认整块穿透鼠标，只有落在角色不透明像素上时临时关闭穿透
// （forward:true 让窗口在穿透状态下仍能收到 mousemove，才能判定何时该恢复）
function setPetIgnore(ignore) {
  if (!petWin || petWin.isDestroyed()) return;
  if (petIgnore === ignore) return;
  petIgnore = ignore;
  petWin.setIgnoreMouseEvents(ignore, { forward: true });
}

// ── 桌宠显隐 ──────────────────────────────────────────────────
// 「隐藏」不是把窗口藏起来留个壳，而是直接销毁窗口：桌宠是常驻的，
// 用户不想看见它时不该继续占内存，也不该继续吃 always-on-top 的层级。
// 进程和托盘继续在，从托盘菜单「显示小张」随时重建。
//
// petHidePending：BrowserWindow.close() 是异步的，窗口要过一拍才真的消失。
// 设置面板点完开关立刻要读状态，没有它就会读到「还开着」，界面文字跟着错。
let petHidePending = false;

function petVisible() {
  if (petHidePending) return false;
  return !!(petWin && !petWin.isDestroyed() && petWin.isVisible());
}

function setPetHidden(hidden) {
  const want = !!hidden;
  saveCfg({ petHidden: want });
  if (want) {
    if (petWin && !petWin.isDestroyed()) {
      petHidePending = true;
      petWin.close();
    }
  } else {
    petHidePending = false;
    if (!petWin || petWin.isDestroyed()) {
      createPet();
      if (petWin && !petWin.isDestroyed()) petWin.showInactive();
    } else {
      petWin.show();
    }
  }
  // 小张回到桌面 → 关窗只能是「收起」。否则一点 × 就把小张一起带走了，
  // 用户会以为桌宠自己消失了。设置里那一项跟着自动切过来（见 closeAction()）。
  if (!want) saveCfg({ closeAction: 'tray' });
  refreshTrayMenu();
}

// ── 关闭行为（收起托盘 / 退出 / 每次询问）────────────────────────
// closeAction: 'ask' | 'tray' | 'quit'，缺省 ask
const CLOSE_ACTIONS = ['ask', 'tray', 'quit'];

function closeAction() {
  const a = loadCfg().closeAction;
  return CLOSE_ACTIONS.indexOf(a) >= 0 ? a : 'ask';
}

// 关窗行为只看设置。小张在桌面上时不会把它改回「收起」——
// 「打开小张 → 自动切最小化」只发生在那一下（见 setPetHidden），之后用户
// 手动选「退出程序」就该真的退出，否则这个选项永远不生效。
function effectiveCloseAction() {
  const a = closeAction();
  // 自检/截图模式不弹「询问」对话框：会卡住无人值守的进程。
  // 但 tray/quit 必须原样返回，否则自检验不到「退出程序」是否真的生效。
  if (OFFSCREEN && a === 'ask') return 'tray';
  return a;
}

// 设置面板要的完整状态
function desktopSettings() {
  return {
    petVisible: petVisible(),
    closeAction: closeAction(),
  };
}

function quitApp() {
  quitting = true;
  // 不能在 close 事件里同步调用 app.quit()：此刻当前窗口的 close 正在被
  // preventDefault，quit 流程会把它判成"有窗口拒绝关闭"从而中止 ——
  // 现象就是 before-quit 都触发了、进程却还在。放到下一拍再退。
  setImmediate(() => app.quit());
}

function hideMainToTray() {
  if (!mainWin || mainWin.isDestroyed()) return;
  mainHiddenByUser = true;
  mainWin.hide();
  if (petWin && !petWin.isDestroyed()) petWin.showInactive();
}

let closeAsking = false;
function askCloseAction() {
  if (closeAsking) return; // 连点 × 不叠第二个框
  closeAsking = true;
  dialog.showMessageBox(mainWin, {
    type: 'question',
    title: '关闭 A2 兴海智学',
    message: '要最小化到托盘，还是退出程序？',
    detail: '最小化后程序留在后台，从托盘图标随时能打开。',
    buttons: ['最小化到托盘', '退出程序'],
    defaultId: 0,
    cancelId: 0,
    checkboxLabel: '记住我的选择，以后不再询问',
    checkboxChecked: false,
    noLink: true,
  }).then((r) => {
    closeAsking = false;
    const toTray = r.response === 0;
    if (r.checkboxChecked) saveCfg({ closeAction: toTray ? 'tray' : 'quit' });
    if (toTray) hideMainToTray();
    else quitApp();
  }).catch(() => {
    closeAsking = false;
  });
}

// ── 桌宠窗 ────────────────────────────────────────────────────
function defaultPetPos() {
  let wa = screen.getPrimaryDisplay().workArea;
  // 开机自启/显示器唤醒时，workArea 可能还没算好（宽高全 0），
  // 拿它减 PET_W 会得到负坐标 —— 小张就被甩到左上角、半身出屏。
  // 这里逐级退让：workArea → bounds → 1280×800 兜底。
  if (!wa || wa.width < PET_W * 2 || wa.height < PET_H * 2) {
    const b = screen.getPrimaryDisplay().bounds;
    wa = b && b.width >= PET_W * 2 && b.height >= PET_H * 2
      ? b
      : { x: 0, y: 0, width: 1280, height: 800 };
  }
  return {
    x: Math.round(wa.x + wa.width - PET_W - 24),
    y: Math.round(wa.y + wa.height - PET_H - 24),
  };
}

function clampToWorkArea(x, y) {
  const pt = { x: x + Math.round(PET_W / 2), y: y + Math.round(PET_H / 2) };
  const d = screen.getDisplayNearestPoint(pt);
  let wa = d && d.workArea;
  if (!wa || wa.width < PET_W || wa.height < PET_H) {
    wa = screen.getPrimaryDisplay().workArea;
  }
  // 屏还没就绪：原样返回，别用空矩形把窗口压到负坐标
  if (!wa || wa.width < PET_W || wa.height < PET_H) return { x, y };
  // 整窗落在工作区内：可以贴边，但不许「半身出屏」。
  // 以前左边界放到 wa.x - PET_W + 60，200px 宽的身子有七成在屏幕外，
  // 一旦存下这种坐标，下次启动小张就只剩一条挂在屏幕左边。
  const maxX = Math.max(wa.x, wa.x + wa.width - PET_W);
  const maxY = Math.max(wa.y, wa.y + wa.height - PET_H);
  return {
    x: Math.min(Math.max(x, wa.x), maxX),
    y: Math.min(Math.max(y, wa.y), maxY),
  };
}

// 位置自愈：露出不到一半就认为坐标坏了（多半是启动时屏没就绪算出来的），
// 直接送回右下角。只在启动后跑一次，不跟用户拖动打架。
function healPetPos() {
  if (!petWin || petWin.isDestroyed()) return;
  const b = petWin.getBounds();
  const pt = { x: b.x + Math.round(PET_W / 2), y: b.y + Math.round(PET_H / 2) };
  const d = screen.getDisplayNearestPoint(pt);
  const wa = d && d.workArea;
  if (!wa || wa.width < PET_W || wa.height < PET_H) return;
  const visX = Math.min(b.x + PET_W, wa.x + wa.width) - Math.max(b.x, wa.x);
  const visY = Math.min(b.y + PET_H, wa.y + wa.height) - Math.max(b.y, wa.y);
  if (visX < PET_W * 0.6 || visY < PET_H * 0.6) {
    const p = defaultPetPos();
    petWin.setPosition(p.x, p.y);
    saveCfg({ petX: p.x, petY: p.y });
  }
}

function createPet() {
  const cfg = loadCfg();
  const def = defaultPetPos();
  const saved = clampToWorkArea(
    Number.isFinite(cfg.petX) ? cfg.petX : def.x,
    Number.isFinite(cfg.petY) ? cfg.petY : def.y
  );

  petWin = new BrowserWindow({
    width: PET_W,
    height: PET_H,
    // 自检模式下摆到屏幕外，别在用户桌面上闪一下
    x: OFFSCREEN ? -20000 : saved.x,
    y: OFFSCREEN ? -20000 : saved.y,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    resizable: false,
    movable: false, // 位置由主进程按光标算，避免和系统拖拽打架
    skipTaskbar: true,
    alwaysOnTop: true,
    hasShadow: false,
    maximizable: false,
    minimizable: false,
    fullscreenable: false,
    acceptFirstMouse: true,
    title: '小张',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false,
    },
  });

  petWin.setAlwaysOnTop(true, 'screen-saver');
  petWin.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  petWin.loadFile(path.join(__dirname, 'pet.html'));
  setPetIgnore(true);

  petWin.on('closed', () => {
    petWin = null;
    petIgnore = null;
    petHidePending = false;
    // 拖拽期间被收起也要停掉计时器，否则它会一直对着 null 跑
    if (dragTimer) {
      clearInterval(dragTimer);
      dragTimer = null;
    }
    drag = null;
  });
}

// ── 下载 ──────────────────────────────────────────────────────
// 「下载 Word」是 location.href 触发的，不拦就会把主窗导航成一片空白。
const SITE_HOSTS = /^(learnest\.cn|39\.96\.82\.119|39\.105\.223\.8|127\.0\.0\.1|localhost)$/i;

function isDownloadUrl(url) {
  try {
    const u = new URL(url);
    if (!SITE_HOSTS.test(u.hostname)) return false;
    if (/^\/api\/download\//i.test(u.pathname)) return true;
    return /\.(docx?|xlsx?|pptx?|pdf|zip)$/i.test(u.pathname);
  } catch (_) {
    return false;
  }
}

// ── 主窗 ──────────────────────────────────────────────────────
function createMain() {
  if (mainWin && !mainWin.isDestroyed()) {
    if (mainWin.isMinimized()) mainWin.restore();
    mainHiddenByUser = false;
    mainWin.show();
    mainWin.focus();
    return mainWin;
  }

  mainWin = new BrowserWindow({
    width: 1180,
    height: 800,
    minWidth: 940,
    minHeight: 640,
    // 立刻显示，不等页面加载完。之前是 show:false + did-finish-load 才 show，
    // 双击到窗口出现要 2 秒，中间屏幕上什么都没有，用户以为没启动，于是点第二下
    // ——第二下走 second-instance 把窗口顶出来，感觉就是"要双击两遍才开"。
    // 底色已设深色，先出空窗不会白闪。
    show: !OFFSCREEN,
    x: OFFSCREEN ? -20000 : undefined,
    y: OFFSCREEN ? -20000 : undefined,
    skipTaskbar: OFFSCREEN,
    title: 'A2 兴海智学',
    backgroundColor: '#0d1220',
    autoHideMenuBar: true,
    icon: path.join(__dirname, '..', 'assets', 'app.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      spellcheck: false,
    },
  });

  let triedFallback = false;

  // 每次导航都重新注入（insertCSS 只对当前文档有效，SPA 内部跳转不用管）
  mainWin.webContents.on('dom-ready', () => {
    mainWin.webContents.insertCSS(DESKTOP_CSS).catch(() => {});
  });

  mainWin.loadURL(START_URL, { userAgent: USER_AGENT }).catch(() => {});

  mainWin.webContents.on('did-fail-load', (_e, code, desc, url, isMainFrame) => {
    if (!isMainFrame || code === -3) return; // -3 = 主动中断
    if (!triedFallback) {
      triedFallback = true;
      console.warn(`[main] 主站失败(${code} ${desc})，回退 IP：${SITE_FALLBACK}`);
      mainWin.loadURL(SITE_FALLBACK, { userAgent: USER_AGENT }).catch(() => {});
    } else {
      const html = path.join(__dirname, 'offline.html');
      if (fs.existsSync(html)) mainWin.loadFile(html);
    }
  });

  mainWin.webContents.on('did-finish-load', () => {
    if (!mainHiddenByUser && !mainWin.isVisible()) mainWin.show();
    // 账号中心里塞一个桌面端独有的「显示桌面小张」开关（服务端不参与，只改本窗 DOM）
    mainWin.webContents.executeJavaScript(ACCT_PET_SWITCH_JS).catch(() => {});
  });

  // 下载类链接（「下载 Word」用的是 location.href）不要在主窗里导航 ——
  // 那样整个窗口会变成一片空白，用户以为程序死了。拦下来走真正的下载。
  mainWin.webContents.on('will-navigate', (e, url) => {
    if (isDownloadUrl(url)) {
      e.preventDefault();
      mainWin.webContents.downloadURL(url);
    }
  });

  // 网页端改完部署后，桌面端不会自动更新（窗口是复用的，点小张只是 show）。
  // 自己接管刷新键，不依赖 Electron 默认菜单是否还在：
  //   Ctrl+R / F5        普通刷新
  //   Ctrl+Shift+R       ｜强制刷新，绕过缓存（改完前端就按这个）
  mainWin.webContents.on('before-input-event', (e, input) => {
    if (input.type !== 'keyDown') return;
    const ctrl = input.control || input.meta;
    const isR = typeof input.key === 'string' && input.key.toLowerCase() === 'r';
    const isF5 = input.key === 'F5';
    if (!isF5 && !(ctrl && isR)) return;
    e.preventDefault();
    if (input.shift) mainWin.webContents.reloadIgnoringCache();
    else mainWin.webContents.reload();
  });

  // 外链交给系统浏览器，站内跳转留在窗口里（含 --url 指向的本地服务）
  mainWin.webContents.setWindowOpenHandler(({ url }) => {
    // window.open(下载地址) 同样不能开新窗，否则又是一个空白窗口
    if (isDownloadUrl(url)) {
      mainWin.webContents.downloadURL(url);
      return { action: 'deny' };
    }
    if (/^https?:\/\/(learnest\.cn|39\.96\.82\.119|39\.105\.223\.8|127\.0\.0\.1|localhost)([:/]|$)/i.test(url)) {
      return { action: 'allow', overrideBrowserWindowOptions: { autoHideMenuBar: true } };
    }
    shell.openExternal(url);
    return { action: 'deny' };
  });

  // 关窗：小张在 → 直接收起；否则按设置（收起 / 退出 / 每次问）
  mainWin.on('close', (e) => {
    if (quitting) return;
    e.preventDefault();
    const act = effectiveCloseAction();
    if (act === 'tray') hideMainToTray();
    else if (act === 'quit') quitApp();
    else askCloseAction();
  });

  mainWin.on('closed', () => {
    mainWin = null;
  });

  return mainWin;
}

// ── 托盘 ──────────────────────────────────────────────────────
function iconPath(name) {
  return path.join(__dirname, '..', 'assets', name);
}

function buildTrayMenu() {
  const autoStart = autoStartEnabled();
  const visible = petVisible();
  return Menu.buildFromTemplate([
    { label: '打开学习中心', click: () => createMain() },
    {
      // 同一项按当前状态切换文案：看得见就给"隐藏"，看不见就给"显示"
      label: visible ? '隐藏小张' : '显示小张',
      click: () => setPetHidden(visible),
    },
    { type: 'separator' },
    {
      label: '开机自动启动',
      type: 'checkbox',
      checked: autoStart,
      click: (item) => setAutoStart(item.checked),
    },
    {
      label: '桌宠归位（右下角）',
      click: () => {
        if (!petWin || petWin.isDestroyed()) return;
        const p = defaultPetPos();
        petWin.setPosition(p.x, p.y);
        saveCfg({ petX: p.x, petY: p.y });
      },
    },
    { type: 'separator' },
    { label: '检查更新', click: () => checkUpdates({ silent: false }) },
    { label: '关于 A2 兴海智学', click: showAbout },
    {
      label: '退出',
      click: () => {
        quitting = true;
        app.quit();
      },
    },
  ]);
}

function trayTooltip() {
  const tag = IS_DEV ? '（调试版）' : '';
  return petVisible() ? `A2 兴海智学${tag} · 小张在的` : `A2 兴海智学${tag} · 小张已收起`;
}

function createTray() {
  const p = iconPath('tray.png');
  const img = fs.existsSync(p) ? nativeImage.createFromPath(p) : nativeImage.createEmpty();
  tray = new Tray(img);
  tray.setToolTip(trayTooltip());
  tray.setContextMenu(buildTrayMenu());
  tray.on('click', () => createMain());
  tray.on('double-click', () => createMain());
}

function refreshTrayMenu() {
  if (!tray) return;
  tray.setContextMenu(buildTrayMenu());
  tray.setToolTip(trayTooltip());
}

function showAbout() {
  dialog.showMessageBox({
    type: 'info',
    title: '关于 A2 兴海智学',
    message: `A2 兴海智学 · 桌面助手  v${app.getVersion()}`,
    detail:
      '小张常驻桌面右下角，点他一下就能进学习中心。\n\n' +
      '· 拖动小张可换位置（松手即记住）\n' +
      '· 右键小张：打开 / 隐藏小张 / 开机自启 / 退出\n' +
      '· 不想看见他就选「隐藏小张」，程序留在托盘里，下次启动也不会自己冒出来\n' +
      '· 要叫回来：右键托盘图标 → 显示小张\n' +
      '· 关掉主窗只是收起，小张还在',
    buttons: ['好'],
    noLink: true,
  });
}

// ── 自动更新 ──────────────────────────────────────────────────
// 检查只拉约 1 KB 的清单，失败一律放行 —— 断网不该挡住用户用软件。
// 装法：下安装包 → sha256 校验 → 拉起 Inno 静默覆盖安装 → 本进程退出 → 装完自启。
// 清单来自 https://learnest.cn/api/desktop/version，安装包在 OSS（签名直链，OSS 上只留最新一份）。
let updateBusy = false;

function askBox(options) {
  const owner = mainWin && !mainWin.isDestroyed() ? mainWin : null;
  return owner ? dialog.showMessageBox(owner, options) : dialog.showMessageBox(options);
}

/**
 * 更新相关的提示一律走窗内 HTML 提示层。
 * 原生对话框是系统窗口：不能截图、无头点不到、进程会挂在那儿等。
 * 主窗不存在（开机自启那一路）时退回原生，功能不丢。
 */
async function askUpdate(options) {
  if (mainWin && !mainWin.isDestroyed()) {
    try {
      if (!mainWin.isVisible()) mainWin.show();
      mainWin.focus();
      const r = await uiprompt.ask(mainWin, options);
      return { response: r };
    } catch (_) {
      /* 页面还没就绪之类，退回原生对话框 */
    }
  }
  return askBox(options);
}

function setTaskbarProgress(ratio) {
  if (!mainWin || mainWin.isDestroyed()) return;
  try {
    mainWin.setProgressBar(ratio);
  } catch (_) {
    /* 没有任务栏图标就算了，不影响更新 */
  }
}

function notesText(list) {
  if (!list || !list.length) return '';
  return '\n\n更新内容：\n' + list.map((n) => '· ' + n).join('\n');
}

/** 下载并安装。info 来自 updater.check()。 */
async function downloadAndInstall(info) {
  setTaskbarProgress(0);
  let setupPath = '';
  try {
    setupPath = await updater.fetchUpdate(info, (r) => setTaskbarProgress(r));
  } catch (e) {
    setTaskbarProgress(-1);
    await askUpdate({
      type: 'error',
      title: '更新下载失败',
      message: '没能下载更新包',
      detail: `${(e && e.message) || e}\n\n程序可以继续用，稍后再试即可。`,
      buttons: ['好'],
      noLink: true,
    });
    return;
  }
  setTaskbarProgress(-1);

  const confirm = await askUpdate({
    type: 'question',
    title: '更新已就绪',
    message: `新版本 ${info.latest} 已下载完成`,
    detail:
      `安装包 ${info.size || ''} 已校验通过。\n\n` +
      '点「现在安装」后：程序会先关闭，静默覆盖安装，装完自动重新打开。\n' +
      '没做完的编辑请先保存到本地文件（网页里的内容不受影响，登录态也保留）。',
    buttons: ['现在安装', '稍后'],
    defaultId: 0,
    cancelId: 1,
    noLink: true,
  });
  if (confirm.response !== 0) {
    // 保留 ready.json：下次启动会提示"已下载好，重启即可安装"
    console.log(`[update] ${info.latest} 已下载，用户选择稍后安装`);
    return;
  }

  updater.runInstaller(setupPath, () => {
    quitting = true;
    app.quit();
  });
}

/**
 * @param {{silent?: boolean}} opts  silent=true 用于启动后自动检查：没事发生就完全不打扰。
 */
async function checkUpdates(opts) {
  const silent = !!(opts && opts.silent);
  if (updateBusy) return;
  updateBusy = true;
  try {
    const prepared = updater.preparedVersion();
    const info = await updater.check();

    if (!info.ok) {
      // 铁律：检查失败不打扰、不挡路
      console.log(`[update] 检查失败：${info.reason}`);
      if (!silent) {
        await askUpdate({
          type: 'warning',
          title: '检查更新失败',
          message: '暂时连不上更新服务',
          detail: `${info.reason || '未知原因'}\n\n程序可以正常使用，稍后再试即可。`,
          buttons: ['好'],
          noLink: true,
        });
      }
      return;
    }

    if (!info.hasUpdate) {
      // 远端已不是那个版本了，清掉过期残留
      if (prepared && prepared !== info.latest) updater.clearPrepared();
      if (!silent) {
        await askUpdate({
          type: 'info',
          title: '检查更新',
          message: `已是最新版本 v${info.current}`,
          detail: info.latest ? `服务端最新：v${info.latest}` : '',
          buttons: ['好'],
          noLink: true,
        });
      }
      return;
    }

    // ── 有新版 ──
    // 用户点过「跳过这个版本」就不再提；但手动点「检查更新」要照常告诉他，
    // 否则他会以为检查功能坏了。
    const skipped = String(loadCfg().skipVersion || '');
    if (silent && skipped && skipped === info.latest) {
      console.log(`[update] v${info.latest} 已被跳过，不打扰`);
      return;
    }

    if (IS_DEV) {
      // 调试版跑的是源码目录的 electron.exe，装了会把安装版盖掉，所以只提示不动手
      const r = await askUpdate({
        type: 'info',
        title: '发现新版本',
        message: `v${info.latest} 已发布`,
        detail:
          `当前 v${info.current} · 安装包 ${info.size || ''}` +
          notesText(info.notes) +
          '\n\n这是调试版，不会自动安装。要用新版本请装正式安装包。',
        buttons: ['去下载页', '以后再说'],
        defaultId: 0,
        cancelId: 1,
        noLink: true,
      });
      if (r.response === 0 && info.url) shell.openExternal(info.url);
      return;
    }

    if (prepared === info.latest) {
      const r = await askUpdate({
        type: 'question',
        title: '更新已就绪',
        message: `v${info.latest} 已经下载好了`,
        detail: '上次没来得及安装。现在重启安装吗？',
        buttons: ['现在安装', '稍后'],
        defaultId: 0,
        cancelId: 1,
        noLink: true,
      });
      if (r.response === 0) {
        updater.runInstaller(path.join(updater.updateDir(), `A2-Setup-${info.latest}.exe`), () => {
          quitting = true;
          app.quit();
        });
      }
      return;
    }

    const ans = await askUpdate({
      type: 'question',
      title: '发现新版本',
      message: `A2 兴海智学 v${info.latest}`,
      detail:
        `当前 v${info.current} · 安装包 ${info.size || ''}` +
        notesText(info.notes) +
        '\n\n更新会关闭并重新打开程序，登录状态和设置都保留。' +
        '\n「跳过这个版本」只是不再主动提醒，之后手动点「检查更新」仍会看到它。',
      buttons: ['立即更新', '以后再说', '跳过这个版本'],
      defaultId: 0,
      cancelId: 1,
      noLink: true,
    });
    if (ans.response === 2) {
      saveCfg({ skipVersion: info.latest });
      console.log(`[update] 已跳过 v${info.latest}`);
      return;
    }
    if (ans.response !== 0) return;
    await downloadAndInstall(info);
  } finally {
    updateBusy = false;
  }
}

// ── 开机自启 ──────────────────────────────────────────────────
// 坑：写入时带了 --autostart，读取必须带同样 args，否则永远读成 false
const AUTOSTART_ARGS = ['--autostart'];

function autoStartEnabled() {
  try {
    const s = app.getLoginItemSettings({
      path: process.execPath,
      args: AUTOSTART_ARGS,
    });
    return !!s.openAtLogin;
  } catch (_) {
    return false;
  }
}

function setAutoStart(on) {
  try {
    app.setLoginItemSettings({
      openAtLogin: !!on,
      path: process.execPath,
      args: AUTOSTART_ARGS,
    });
    saveCfg({ autoStart: !!on });
  } catch (err) {
    console.error('[autostart] 设置失败:', err.message);
  }
  refreshTrayMenu();
}

// ── 冒烟自检（无可见窗口）：node 脚本或 exe --smoke 调用 ─────────
function runSmoke() {
  const report = { ok: false, image: null, bubble: null, errors: [] };
  const win = new BrowserWindow({
    width: PET_W,
    height: PET_H,
    show: false,
    frame: false,
    transparent: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false,
    },
  });

  win.webContents.on('console-message', (_e, level, message) => {
    if (level >= 2) report.errors.push(message);
  });
  win.webContents.on('preload-error', (_e, p, err) => report.errors.push('preload: ' + err.message));

  win.loadFile(path.join(__dirname, 'pet.html'));

  win.webContents.once('did-finish-load', async () => {
    await new Promise((r) => setTimeout(r, 4200)); // 等入场蹦跳结束、气泡说出第一句
    try {
      const info = await win.webContents.executeJavaScript(`(() => {
        const p = (window.__petInfo ? window.__petInfo() : {});
        const b = document.getElementById('bubble');
        return Object.assign(p, {
          bubbleShown: b.classList.contains('show'),
          bubbleText: b.textContent,
          bridge: typeof window.pet,
        });
      })()`);
      report.image = info.natural;
      report.video = info.video;
      report.videoOk = info.videoOk;
      report.readyState = info.readyState;
      report.boxImg = info.boxImg || null;
      report.boxVid = info.boxVid || null;
      if (info.frame && info.frame.startsWith('data:image/png;base64,')) {
        try {
          const png = Buffer.from(info.frame.split(',')[1], 'base64');
          const fPath = path.join(path.dirname(writeSmokePath()), 'frame.png');
          fs.writeFileSync(fPath, png);
          report.framePng = fPath;
        } catch (_) {}
      }
      delete info.frame;

      // 穿透判定自检：角色身上要命中，窗口空白处要透过去
      try {
        report.hit = await win.webContents.executeJavaScript(`({
          body: window.__hitTest(100, 190),
          corner: window.__hitTest(3, 3),
          leftSide: window.__hitTest(6, 150),
          bubble: window.__hitTest(100, 40),
          gear: window.__hitTest(window.innerWidth - 20, 20),
          gearShown: (function(){ var g = document.getElementById('gear'); return !!g && !g.classList.contains('show'); })()
        })`);
      } catch (err) {
        report.hitError = String(err && err.message ? err.message : err);
      }
      try {
        report.hitDebug = await win.webContents.executeJavaScript('window.__hitDebug()');
      } catch (err) {
        report.hitDebugError = String(err && err.message ? err.message : err);
      }

      if (process.argv.includes('--smoke-boxes')) {
        try {
          report.boxes = await win.webContents.executeJavaScript(
            'window.__probeBoxes([0, 0.5, 1.0, 1.5, 2.0, 2.5, 3.0])'
          );
        } catch (err) {
          report.boxesError = String(err && err.message ? err.message : err);
        }
      }
      report.bubble = info.bubbleShown ? info.bubbleText : '(未显示)';
      report.bridge = info.bridge;
      report.ok =
        /^360x514$/.test(info.natural) &&
        info.bridge === 'object' &&
        info.bubbleShown === true &&
        report.errors.length === 0 &&
        !!report.hit &&
        report.hit.body === true &&
        report.hit.corner === false &&
        report.hit.leftSide === false &&
        report.hit.bubble === true &&
        report.hit.gear === true &&
        report.hit.gearShown === true;
    } catch (err) {
      report.errors.push('eval: ' + err.message);
    }
    console.log('SMOKE ' + JSON.stringify(report));
    writeSmoke(report);
    quitting = true;
    app.exit(report.ok ? 0 : 1);
  });
}

function writeSmokePath() {
  const outArg = process.argv.find((a) => a.startsWith('--smoke-out='));
  return outArg
    ? outArg.slice('--smoke-out='.length)
    : path.join(app.getPath('temp'), 'a2_smoke.json');
}

function writeSmoke(report) {
  const outPath = writeSmokePath();
  try {
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, JSON.stringify(report, null, 2), 'utf8');
  } catch (err) {
    // 写不进去时留一份现场，否则只剩一个静默的非零退出码
    try {
      fs.writeFileSync(
        path.join(__dirname, '..', 'build', '_smoke_error.txt'),
        outPath + '\n' + String((err && err.stack) || err),
        'utf8'
      );
    } catch (_) {}
  }
}

// 主窗冒烟：验证「点开能进学习中心」；带 --smoke-url= 时可验证失败回退页
function runSmokeMain() {
  const urlArg = process.argv.find((a) => a.startsWith('--smoke-url='));
  const target = urlArg ? urlArg.slice('--smoke-url='.length) : START_URL;
  const report = { ok: false, target };
  const t0 = Date.now();
  let done = false;
  let phase = 'site';

  const finish = (extra) => {
    if (done) return;
    done = true;
    Object.assign(report, extra, { ms: Date.now() - t0 });
    writeSmoke(report);
    quitting = true;
    app.exit(report.ok ? 0 : 1);
  };

  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    show: false,
    x: -20000,
    y: -20000,
    skipTaskbar: true,
    webPreferences: { contextIsolation: true, nodeIntegration: false },
  });

  win.webContents.on('did-fail-load', (_e, code, desc, url, isMainFrame) => {
    if (!isMainFrame || code === -3) return;
    if (phase === 'site') {
      report.loadError = { code, desc, url };
      phase = 'offline';
      win.loadFile(path.join(__dirname, 'offline.html')).catch(() => {});
      return;
    }
    finish({ ok: false, code, desc, url });
  });

  win.webContents.on('did-finish-load', async () => {
    let title = '';
    let bodyLen = 0;
    try {
      title = win.webContents.getTitle();
      bodyLen = await win.webContents.executeJavaScript('document.body.innerText.length');
    } catch (_) {}
    if (phase === 'site') {
      finish({ ok: bodyLen > 0, url: win.webContents.getURL(), title, bodyLen });
    } else {
      finish({
        ok: bodyLen > 0,
        offlineShown: true,
        url: win.webContents.getURL(),
        title,
        bodyLen,
      });
    }
  });

  win.loadURL(target, { userAgent: USER_AGENT }).catch((err) => {
    // 主站失败已由 did-fail-load 接管并切到离线页；这里只处理真正的未知失败
    if (phase !== 'site') return;
    finish({ ok: false, err: String(err && err.message ? err.message : err) });
  });
  setTimeout(() => finish({ ok: false, err: 'timeout 25s' }), 25000);
}

// 窗口状态机自检：开两次只一个窗、关窗只收起、再开还是同一个
function runSmokeFlow() {
  const report = { ok: false, steps: [] };
  const t0 = Date.now();
  const done = (extra) => {
    Object.assign(report, extra, { ms: Date.now() - t0 });
    writeSmoke(report);
    quitting = true;
    app.exit(report.ok ? 0 : 1);
  };

  const w1 = createMain();
  w1.show();
  const s = {};
  s.open = { id: w1.id, visible: w1.isVisible() };

  const w2 = createMain();
  s.openAgain = {
    sameInstance: w1.id === w2.id,
    windows: BrowserWindow.getAllWindows().filter((x) => !x.isDestroyed()).length,
  };

  w1.close(); // 触发 close 事件：应 preventDefault + hide
  setTimeout(() => {
    s.closeHides = { alive: !w1.isDestroyed(), hidden: !w1.isVisible() };

    const w3 = createMain();
    setTimeout(() => {
      s.reopen = { sameInstance: w1.id === w3.id, visible: w3.isVisible() };

      // 收起小张：窗口销毁、配置记住、主窗和进程都不受影响
      setPetHidden(true);
      setTimeout(() => {
        s.hidePet = {
          gone: !petWin || petWin.isDestroyed(),
          cfgHidden: loadCfg().petHidden === true,
          mainStillAlive: !w1.isDestroyed(),
          menuLabel: buildTrayMenu().items.map((i) => i.label).indexOf('显示小张') >= 0,
        };

        // 叫回来：重建窗口且可见
        setPetHidden(false);
        setTimeout(() => {
          s.showPet = {
            rebuilt: !!petWin && !petWin.isDestroyed(),
            visible: !!petWin && !petWin.isDestroyed() && petWin.isVisible(),
            cfgHidden: loadCfg().petHidden === false,
            menuLabel: buildTrayMenu().items.map((i) => i.label).indexOf('隐藏小张') >= 0,
          };
          report.steps = Object.keys(s).map((k) => Object.assign({ step: k }, s[k]));
          report.ok =
            s.openAgain.sameInstance &&
            s.openAgain.windows === 1 &&
            s.closeHides.alive &&
            s.closeHides.hidden &&
            s.reopen.sameInstance &&
            s.reopen.visible &&
            s.hidePet.gone &&
            s.hidePet.cfgHidden &&
            s.hidePet.mainStillAlive &&
            s.hidePet.menuLabel &&
            s.showPet.rebuilt &&
            s.showPet.visible &&
            s.showPet.cfgHidden &&
            s.showPet.menuLabel;
          saveCfg({ petHidden: false }); // 自检不留痕
          done();
        }, 1200);
      }, 800);
    }, 700);
  }, 700);
}

// 自检用：搭一个和真账号中心同构的宿主（线上未登录时页面上没有这个弹窗）
const SMOKE_ACCT_HOST = `(function () {
  if (document.getElementById('a2-acct-modal')) return;
  var modal = document.createElement('div');
  modal.id = 'a2-acct-modal';
  modal.style.cssText = 'position:fixed;left:0;top:0;width:340px;background:#fff;padding:16px;z-index:9000';
  modal.innerHTML = '<div id="a2-acct-msg"></div>'
    + '<div style="display:flex;gap:10px;margin-top:12px;border-top:1px solid #F1F1F1;padding-top:12px">'
    + '<button id="a2-acct-logout" type="button">退出登录</button>'
    + '<button id="a2-acct-switch" type="button">切换账号</button></div>';
  document.body.appendChild(modal);
  var b = document.createElement('button');
  b.id = 'a2-acct-btn';
  document.body.appendChild(b);
})();`;

// 退出链路自检：设置「关闭窗口时：退出程序」后关窗，进程必须真的退出。
// 判据：走到 before-quit 才算成功；2 秒后还活着就写 ok:false。
function runSmokeQuit() {
  const report = { ok: false, steps: [] };
  const t0 = Date.now();
  saveCfg({ petHidden: true, closeAction: 'quit' });
  createTray(); // 真实场景有托盘常驻，必须一起验
  const w = createMain();

  app.on('before-quit', () => {
    report.ok = true;
    report.steps.push({ step: 'before-quit', ms: Date.now() - t0 });
    writeSmoke(report);
  });

  w.webContents.once('did-finish-load', () => {
    setTimeout(() => {
      report.steps.push({
        step: 'close',
        action: effectiveCloseAction(),
        visible: w.isVisible(),
      });
      setTimeout(() => {
        // 真的退出了就走不到这里
        report.ok = false;
        report.steps.push({ step: 'stillAlive', pid: process.pid, ms: Date.now() - t0 });
        writeSmoke(report);
        app.exit(1);
      }, 2000);
      w.close();
    }, 800);
  });
}

// 桌面设置自检：主窗 preload 桥是否真的可用、桌宠显隐与关闭行为能否落盘。
// 之前「显示桌面小张没反应」是主窗没挂 preload；「点两下才关掉」是读了写死的
// aria-checked —— 这里一律用真桥 + 真注入脚本 + 真的点一下滑钮来验。
// 更新自检：只验"取清单 / 判版本 / 失败放行"，**不下载 82 MB**（那条链路手工验过：
// 实测 32 s 下完、sha256 一致、就绪标记写对）。要验下载就手动跑一次真更新。
// 提示层自检：真的渲染、真的截图、真的点按钮。
// 这条存在的唯一理由：原生对话框截不到、点不了，而窗内 HTML 提示层两样都行。
async function smokePrompt() {
  const out = { ok: false };
  const dir = path.dirname(writeSmokePath());
  const win = new BrowserWindow({
    width: 900,
    height: 620,
    show: false,
    x: -20000,
    y: -20000,
    webPreferences: { contextIsolation: true, nodeIntegration: false, backgroundThrottling: false },
  });
  const opts = {
    title: '发现新版本',
    message: 'A2 兴海智学 v9.9.9',
    detail: `当前 v${app.getVersion()} · 安装包 82.1 MB\n\n更新内容：\n· 新增自动更新：启动后静默检查，发现新版本可一键下载安装\n· 新版装完自动重新打开，登录状态与设置都保留\n· 托盘菜单新增「检查更新」\n\n更新会关闭并重新打开程序，登录状态和设置都保留。`,
    buttons: ['立即更新', '以后再说', '跳过这个版本'],
    defaultId: 0,
    cancelId: 1,
  };
  try {
    await win.loadURL(
      'data:text/html;charset=utf-8,' +
        encodeURIComponent(
          '<html><body style="margin:0;height:100vh;background:linear-gradient(160deg,#F7F9FC 0%,#E6EDF6 100%)"></body></html>'
        )
    );
    // 隐藏窗口会把 CSS 动画节流在起始帧，截出来是半透明的；截图时关掉入场动画
    await win.webContents.executeJavaScript('window.__a2upNoAnim = true', true);

    // 亮色
    const pending = uiprompt.ask(win, opts);
    await new Promise((r) => setTimeout(r, 350));
    out.light = await uiprompt.visible(win);
    out.light.shot = path.join(dir, 'shot_update_prompt.png');
    fs.writeFileSync(out.light.shot, (await win.webContents.capturePage()).toPNG());
    out.light.bytes = fs.statSync(out.light.shot).size;
    out.clicked = await uiprompt.click(win, 1);
    out.answer = await pending;
    out.goneAfterClick = (await uiprompt.visible(win)) === null;

    // 暗色：外观要跟着站点主题走，不能白卡片糊在黑页面上
    await win.webContents.executeJavaScript(
      `document.documentElement.setAttribute('data-theme','dark')`,
      true
    );
    await uiprompt.render(win, opts);
    await new Promise((r) => setTimeout(r, 200));
    out.dark = await uiprompt.visible(win);
    out.dark.shot = path.join(dir, 'shot_update_prompt_dark.png');
    fs.writeFileSync(out.dark.shot, (await win.webContents.capturePage()).toPNG());
    out.dark.bytes = fs.statSync(out.dark.shot).size;
    await uiprompt.click(win, 0);

    out.ok =
      !!out.light &&
      out.light.buttons === 3 &&
      out.light.primary === '立即更新' &&
      out.light.title === '发现新版本' &&
      out.answer === 1 &&
      out.goneAfterClick === true &&
      out.light.bytes > 8000 &&
      !!out.dark &&
      out.dark.dark === '1' &&
      out.dark.bytes > 8000;
  } catch (e) {
    out.error = String((e && e.message) || e);
  } finally {
    if (!win.isDestroyed()) win.destroy();
  }
  return out;
}

/**
 * 真实链路自检：把清单地址指到本地假服务，跑一遍 checkUpdates()，
 * 看提示是不是在真主窗里弹出来、点「以后再说」能不能正常收场。
 * 这条替代了"人工盯着屏幕看弹窗"，也替代了截全屏。
 */
async function smokeUpdateFlow(port) {
  const out = { ok: false };
  try {
    saveCfg({ petHidden: true, skipVersion: '' });
    const w = createMain();
    await new Promise((r) => {
      const t = setTimeout(r, 15000);
      w.webContents.once('did-finish-load', () => {
        clearTimeout(t);
        r();
      });
    });
    await new Promise((r) => setTimeout(r, 300));

    updater.setVersionUrl(`http://127.0.0.1:${port}/v.json`);
    out.before = await uiprompt.visible(w);
    const p = checkUpdates({ silent: true });
    await new Promise((r) => setTimeout(r, 900));
    out.ui = await uiprompt.visible(w);
    // 真站点可能有 CSP：注入的 <style> 被拦掉就会变成裸文字按钮，这里查真实计算样式
    out.style = await w.webContents.executeJavaScript(
      `(function(){ var b = document.querySelector('#a2-up-mask .a2up-btn.is-primary');
        if (!b) return null;
        var cs = getComputedStyle(b);
        var card = document.querySelector('#a2-up-mask .a2up-card');
        return { bg: cs.backgroundColor, color: cs.color, radius: cs.borderTopLeftRadius,
                 cardRadius: card ? getComputedStyle(card).borderTopLeftRadius : '' }; })()`,
      true
    );
    out.shot = path.join(path.dirname(writeSmokePath()), 'shot_update_real.png');
    fs.writeFileSync(out.shot, (await w.webContents.capturePage()).toPNG());
    out.clicked = await uiprompt.click(w, 1); // 以后再说
    await p.catch(() => {});
    out.gone = (await uiprompt.visible(w)) === null;
    out.skipStored = String(loadCfg().skipVersion || '');
    out.ok =
      out.before === null &&
      !!out.ui &&
      out.ui.buttons === 3 &&
      out.ui.msg.indexOf('9.9.9') >= 0 &&
      !!out.style &&
      out.style.bg === 'rgb(21, 101, 192)' &&
      parseFloat(out.style.cardRadius) >= 12 &&
      out.clicked === true &&
      out.gone === true &&
      out.skipStored === '';
    updater.setVersionUrl('');
  } catch (e) {
    out.error = String((e && e.message) || e);
  }
  return out;
}

function runSmokeUpdate() {
  const report = { ok: false, steps: [] };
  const t0 = Date.now();
  const s = {};
  const done = () => {
    report.ms = Date.now() - t0;
    report.steps = [s];
    writeSmoke(report);
    quitting = true;
    app.exit(report.ok ? 0 : 1);
  };
  setTimeout(() => {
    s.timeout = true;
    done();
  }, 30000);

  const http = require('http');
  // 假清单指向 dist/version.json 里的真实签名直链，顺便验证"清单能被解析"
  let realUrl = 'https://example.invalid/x.exe';
  let realSha = '';
  try {
    const m = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'dist', 'version.json'), 'utf8'));
    realUrl = (m.downloads && m.downloads.win64) || realUrl;
    realSha = m.sha256 || '';
  } catch (_) {
    /* 没发过版也能测逻辑 */
  }

  const fake = {
    latest: '9.9.9',
    releasedAt: '2026-01-01',
    downloads: { win64: realUrl },
    sizeWin64: '82.1 MB',
    sha256: realSha,
    notes: ['smoke'],
  };
  const srv = http.createServer((_req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(fake));
  });

  srv.listen(0, '127.0.0.1', async () => {
    const port = srv.address().port;
    try {
      s.current = app.getVersion();

      s.local = await updater.checkFrom(`http://127.0.0.1:${port}/v.json`);
      s.localOk = !!(s.local.ok && s.local.hasUpdate && s.local.latest === '9.9.9');

      // 同一份清单但版本号写得和本机一样 → 不该提示更新
      const sameSrv = http.createServer((_req, res) => {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ...fake, latest: s.current }));
      });
      await new Promise((r) => sameSrv.listen(0, '127.0.0.1', r));
      s.sameVer = await updater.checkFrom(`http://127.0.0.1:${sameSrv.address().port}/v.json`);
      s.sameVerNoUpdate = s.sameVer.ok && s.sameVer.hasUpdate === false;
      sameSrv.close();

      // 连不上必须放行，不许抛
      s.dead = await updater.checkFrom('http://127.0.0.1:1/none.json');
      s.deadFailsSafe = s.dead.ok === false && !!s.dead.reason;

      // 线上清单可达性（只要求 ok，不要求有新版 —— 有没有新版取决于当前发到哪一版）
      s.online = await updater.check();
      s.onlineReachable = s.online.ok === true;

      // 提示层：渲染 → 截图（亮/暗）→ 点按钮 → 断言应答与自动关闭
      s.prompt = await smokePrompt();

      // 真实链路：清单说 9.9.9，跑一遍 checkUpdates，提示得在真主窗里弹出来
      s.flow = await smokeUpdateFlow(port);

      report.ok =
        s.localOk &&
        s.sameVerNoUpdate &&
        s.deadFailsSafe &&
        s.onlineReachable &&
        !!s.prompt.ok &&
        !!s.flow.ok;
    } catch (e) {
      s.error = String((e && e.message) || e);
    } finally {
      srv.close();
      done();
    }
  });
}

function runSmokeDesk() {
  const report = { ok: false, steps: [] };
  const t0 = Date.now();
  const s = {};
  const done = (extra) => {
    Object.assign(report, extra, { ms: Date.now() - t0 });
    writeSmoke(report);
    quitting = true;
    app.exit(report.ok ? 0 : 1);
  };
  setTimeout(() => { report.steps = [s]; done({ timeout: true }); }, 40000);

  saveCfg({ petHidden: false, closeAction: 'ask' }); // 每次从干净状态起跑
  if (!petWin || petWin.isDestroyed()) createPet();
  const w = createMain();
  const js = (code) => w.webContents.executeJavaScript(code, true);
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const readUi = () => js(`(function(){
    var sw = document.getElementById('a2-pet-sw');
    var sel = document.getElementById('a2-pet-close');
    var txt = document.getElementById('a2-pet-txt');
    return { aria: sw && sw.getAttribute('aria-checked'), txt: txt && txt.textContent,
             selVal: sel && sel.value, selDisabled: !!(sel && sel.disabled) };
  })()`);
  const shotDir = path.dirname(writeSmokePath());
  const shots = [];
  const shot = async (tag) => {
    try {
      const img = await w.webContents.capturePage();
      const p = path.join(shotDir, `desk_${tag}.png`);
      fs.writeFileSync(p, img.toPNG());
      shots.push(p);
    } catch (err) {
      shots.push('ERR:' + String(err && err.message ? err.message : err));
    }
  };

  w.webContents.once('did-finish-load', async () => {
    await wait(900);
    try {
      s.api = await js("typeof window.a2desktop === 'object'");
      s.apiKeys = await js("Object.keys(window.a2desktop || {}).sort().join(',')");
      s.settings0 = await js("window.a2desktop.getSettings()");

      await js(SMOKE_ACCT_HOST);
      await js("window.__a2PetSwitch = 0");
      await js(ACCT_PET_SWITCH_JS);
      await wait(500);
      s.ui0 = await readUi();
      s.rowBuilt = await js("!!document.getElementById('a2-pet-row')");
      await shot('on');

      // ★ 第一下就必须收起（旧版这里会变成"显示"）
      await js("document.getElementById('a2-pet-sw').click()");
      await wait(700);
      s.click1 = Object.assign(await readUi(), { gone: !petVisible() });

      // 第二下叫回来
      await js("document.getElementById('a2-pet-sw').click()");
      await wait(900);
      s.click2 = Object.assign(await readUi(), { back: petVisible() });

      // 收起后把「关闭窗口时」改成退出程序
      await js("document.getElementById('a2-pet-sw').click()");
      await wait(700);
      s.uiAfterHide = await readUi();
      await shot('off');
      await js("(function(){var s=document.getElementById('a2-pet-close');s.value='quit';s.onchange();})()");
      await wait(400);
      s.cfgQuit = loadCfg().closeAction;

      // ★ 小张重新显示后：「退出程序」仍然要真的生效（1.1.2 的 bug 就死在这）
      await js("window.a2desktop.setPetVisible(true)");
      await wait(900);
      s.afterShowCfg = loadCfg().closeAction;   // 显示小张那一下会自动切成 tray
      s.showUi = await readUi();                // 下拉不能被禁用
      await js("(function(){var s=document.getElementById('a2-pet-close');s.value='quit';s.onchange();})()");
      await wait(400);
      s.quitWhilePetShown = loadCfg().closeAction;
      s.effQuit = effectiveCloseAction();       // 期望 quit：点 × 会退出
      s.badValue = await js("window.a2desktop.setCloseAction('nope')");
      s.cfgAfterBad = loadCfg().closeAction;

      // 位置夹取：越界坐标必须被拉回「整窗可见」
      const wa = screen.getPrimaryDisplay().workArea;
      s.clampLeft = clampToWorkArea(wa.x - 5000, wa.y - 5000);
      s.clampRight = clampToWorkArea(wa.x + wa.width + 5000, wa.y + wa.height + 5000);
      // 下载链接识别（「下载 Word」白屏那件事的守门员）
      s.dl = {
        api: isDownloadUrl('https://learnest.cn/api/download/abc.docx'),
        file: isDownloadUrl('https://learnest.cn/f/a.docx'),
        page: isDownloadUrl('https://learnest.cn/'),
        ext: isDownloadUrl('https://example.com/a.docx'),
      };
      s.shots = shots;
      const inView = (p, ex, ey) => p.x === ex && p.y === ey;

      report.steps = [s];
      report.ok =
        s.api === true &&
        s.apiKeys === 'getSettings,setCloseAction,setPetVisible' &&
        s.settings0 && s.settings0.petVisible === true && s.settings0.closeAction === 'ask' &&
        s.rowBuilt === true &&
        s.ui0 && s.ui0.aria === 'true' && s.ui0.txt === '已显示' &&
        s.ui0.selVal === 'ask' && s.ui0.selDisabled === false &&
        s.click1 && s.click1.gone === true && s.click1.aria === 'false' &&
        s.click1.txt === '已收起' && s.click1.selDisabled === false &&
        s.click2 && s.click2.back === true && s.click2.aria === 'true' &&
        s.click2.txt === '已显示' && s.click2.selVal === 'tray' &&
        s.cfgQuit === 'quit' &&
        s.afterShowCfg === 'tray' &&
        s.showUi && s.showUi.selDisabled === false &&
        s.quitWhilePetShown === 'quit' &&
        s.effQuit === 'quit' &&
        s.cfgAfterBad === 'quit' &&
        s.dl && s.dl.api === true && s.dl.file === true && s.dl.page === false && s.dl.ext === false &&
        inView(s.clampLeft, wa.x, wa.y) &&
        inView(s.clampRight, wa.x + wa.width - PET_W, wa.y + wa.height - PET_H);
      saveCfg({ petHidden: false, closeAction: 'tray' }); // 自检不留痕
      done();
    } catch (err) {
      report.steps = [s, { error: String(err && err.message ? err.message : err) }];
      done({ error: true });
    }
  });
}

// 截图自检：把桌宠窗在屏幕外渲染出来，抓动画中段与末帧两张图看观感
async function runShot() {
  const dir = path.dirname(writeSmokePath());
  createPet();
  if (!petWin) {
    app.exit(2);
    return;
  }
  petWin.setPosition(-20000, -20000);
  const shots = [];
  const grab = async (tag, wait) => {
    await new Promise((r) => setTimeout(r, wait));
    try {
      const img = await petWin.webContents.capturePage();
      const p = path.join(dir, `shot_${tag}.png`);
      fs.writeFileSync(p, img.toPNG());
      shots.push({ tag, path: p, size: img.getSize() });
    } catch (err) {
      shots.push({ tag, error: String(err && err.message ? err.message : err) });
    }
  };
  await grab('mid', 1200);
  await grab('end', 2600);

  // 齿轮默认是透明的，只有鼠标靠近右上角才浮出来；截图时手动点亮它，
  // 看它会不会压住气泡或角色
  try {
    await petWin.webContents.executeJavaScript(
      "document.getElementById('gear').classList.add('show')"
    );
    await new Promise((r) => setTimeout(r, 320));
    const img = await petWin.webContents.capturePage();
    const gp = path.join(dir, 'shot_gear.png');
    fs.writeFileSync(gp, img.toPNG());
    shots.push({ tag: 'gear', path: gp, size: img.getSize() });
  } catch (err) {
    shots.push({ tag: 'gear', error: String(err && err.message ? err.message : err) });
  }

  writeSmoke({ ok: shots.every((s) => !s.error), shots });
  quitting = true;
  app.exit(0);
}

// 主窗截图自检：按默认窗口尺寸 1180×800 离屏渲染，量首页是否真的一屏放得下
async function runShotMain() {
  const dir = path.dirname(writeSmokePath());
  const win = new BrowserWindow({
    width: 1180,
    height: 800,
    show: false,
    x: -20000,
    y: -20000,
    webPreferences: { contextIsolation: true, nodeIntegration: false },
  });
  win.webContents.on('dom-ready', () => {
    win.webContents.insertCSS(DESKTOP_CSS).catch(() => {});
  });

  let err = null;
  try {
    await win.loadURL(START_URL, { userAgent: USER_AGENT });
  } catch (e) {
    err = String((e && e.message) || e);
  }
  await new Promise((r) => setTimeout(r, 4000)); // 等入场动画落定

  let shot = null;
  const shots = [];
  try {
    for (const [tag, wait] of [['main', 0], ['main_end', 3200]]) {
      if (wait) await new Promise((r) => setTimeout(r, wait));
      const img = await win.webContents.capturePage();
      const p = path.join(dir, `shot_${tag}.png`);
      fs.writeFileSync(p, img.toPNG());
      shots.push(p);
      if (!shot) shot = p;
    }
  } catch (e) {
    err = err || String((e && e.message) || e);
  }

  let metrics = null;
  try {
    metrics = await win.webContents.executeJavaScript(`(() => {
      const de = document.documentElement;
      const vc = document.getElementById('viewCourses');
      const lobby = document.getElementById('lobby');
      const flow = document.querySelector('.flow-block');
      const cue = document.querySelector('.lobby-cue');
      return {
        url: location.href,
        title: document.title,
        innerH: window.innerHeight,
        scrollH: de.scrollHeight,
        needScroll: de.scrollHeight > window.innerHeight + 4,
        coursesVisible: !!vc && getComputedStyle(vc).display !== 'none',
        lobbyH: lobby ? Math.round(lobby.getBoundingClientRect().height) : null,
        /* 首页小张：必须存在、已淡入、且动画视频已接管画面 */
        zxH: (() => { const z = document.querySelector('.zx'); return z ? Math.round(z.getBoundingClientRect().height) : null; })(),
        zxShown: (() => { const z = document.querySelector('.zx'); return z ? getComputedStyle(z).opacity : null; })(),
        zxPlaying: (() => { const v = document.getElementById('zxVideo'); return v ? !v.paused || v.currentTime > 0 : null; })(),
        vcH: vc ? Math.round(vc.getBoundingClientRect().height) : null,
        contentBottom: (() => {
          const last = vc && vc.lastElementChild;
          return last ? Math.round(last.getBoundingClientRect().bottom) : null;
        })(),
        zxVideoOn: (() => { const z = document.querySelector('.zx'); return z ? z.classList.contains('is-video') : null; })(),
        vcH: vc ? Math.round(vc.getBoundingClientRect().height) : null,
        contentBottom: (() => {
          const last = vc && vc.lastElementChild;
          return last ? Math.round(last.getBoundingClientRect().bottom) : null;
        })(),
        flowHidden: flow ? getComputedStyle(flow).display === 'none' : null,
        cueHidden: cue ? getComputedStyle(cue).display === 'none' : null,
      };
    })()`);
  } catch (e) {
    metrics = { error: String((e && e.message) || e) };
  }

  writeSmoke({ ok: !err, shot, shots, metrics });
  quitting = true;
  app.exit(err ? 1 : 0);
}

// 桌宠归位：换显示器 / 分辨率变化后把窗口拉回可见工作区
function reclampPet() {
  if (!petWin || petWin.isDestroyed()) return;
  const b = petWin.getBounds();
  const c = clampToWorkArea(b.x, b.y);
  if (c.x !== b.x || c.y !== b.y) {
    petWin.setPosition(c.x, c.y);
    saveCfg({ petX: c.x, petY: c.y });
  }
}

// ── 单实例 ────────────────────────────────────────────────────
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', (_e, argv) => {
    // 卸载/更新时由安装器带 --quit 唤起，让已运行的实例自行退出
    if (argv && argv.includes('--quit')) {
      quitting = true;
      app.quit();
      return;
    }
    createMain();
  });

  app.whenReady().then(() => {
    app.setAppUserModelId('cn.learnest.a2.desktop');

    // 下载统一弹「另存为」：默认路径给下载目录 + 服务端建议的文件名。
    // 全局只绑一次，别放进 createMain（窗口重建会重复绑）。
    session.defaultSession.on('will-download', (_e, item) => {
      const name = item.getFilename() || 'A2整理稿.docx';
      const ext = (path.extname(name) || '.docx').replace('.', '').toLowerCase();
      const owner = mainWin && !mainWin.isDestroyed() ? mainWin : null;
      const target = dialog.showSaveDialogSync(owner, {
        title: '保存文件',
        defaultPath: path.join(app.getPath('downloads'), name),
        filters: [
          { name: ext.toUpperCase() + ' 文件', extensions: [ext] },
          { name: '所有文件', extensions: ['*'] },
        ],
      });
      if (!target) {
        item.cancel();
        return;
      }
      item.setSavePath(target);

      // 下载完去掉「来自网络」标记：Windows 会给下载文件写 Zone.Identifier，
      // Word 见到它就进「受保护的视图」，用户双击只看到一条黄条，以为文件坏了。
      item.once('done', (_evt, state) => {
        if (state !== 'completed') return;
        try {
          fs.unlinkSync(item.getSavePath() + ':Zone.Identifier');
        } catch (_) {
          /* 本来就没有这个流，或已被别处清掉 */
        }
      });
    });

    // 卸载/更新器唤起：本机没在跑时也要立刻退出，不能留下一个桌宠进程
    if (process.argv.includes('--quit')) {
      quitting = true;
      app.exit(0);
      return;
    }

    if (process.argv.includes('--smoke')) {
      runSmoke();
      return;
    }
    if (process.argv.includes('--smoke-main')) {
      runSmokeMain();
      return;
    }
    if (process.argv.includes('--smoke-flow')) {
      runSmokeFlow();
      return;
    }

    if (process.argv.includes('--smoke-quit')) {
      runSmokeQuit();
      return;
    }

    if (process.argv.includes('--smoke-update')) {
      runSmokeUpdate();
      return;
    }

    if (process.argv.includes('--shot')) {
      runShot();
      return;
    }

    if (process.argv.includes('--shot-main')) {
      runShotMain();
      return;
    }

    // 开机自启诊断：读回注册表真实状态，供自动化验收
    const autoArg = process.argv.find((a) => a.startsWith('--set-autostart='));
    if (autoArg) {
      const want = autoArg.slice('--set-autostart='.length) === 'on';
      setAutoStart(want);
      const now = autoStartEnabled();
      writeSmoke({
        ok: now === want,
        requested: want,
        openAtLogin: now,
        execPath: process.execPath,
        args: AUTOSTART_ARGS,
      });
      app.exit(now === want ? 0 : 1);
      return;
    }

    // 上次要是用户自己收起的小张，这次启动就别再冒出来
    if (!loadCfg().petHidden) createPet();
    createTray();
    // 启动 1.5 秒后校一次位置：显示器枚举晚于建窗时，上面算出来的坐标可能是坏的
    setTimeout(healPetPos, 1500);

    // 换显示器 / 改分辨率后，别让小张留在看不见的地方
    screen.on('display-removed', reclampPet);
    screen.on('display-metrics-changed', reclampPet);

    ipcMain.on('pet:open-main', () => createMain());

    // 渲染侧按角色 alpha 判定命中：命中=收鼠标，未命中=继续穿透
    ipcMain.on('pet:hit', (_e, hit) => setPetIgnore(!hit));

    ipcMain.on('pet:drag-start', () => {
      if (!petWin || petWin.isDestroyed()) return;
      setPetIgnore(false); // 拖拽期间必须收鼠标，否则窗口跟不上光标
      drag = {
        cursor: screen.getCursorScreenPoint(),
        bounds: petWin.getBounds(),
      };
      if (dragTimer) clearInterval(dragTimer);
      dragTimer = setInterval(() => {
        if (!drag || !petWin || petWin.isDestroyed()) return;
        const now = screen.getCursorScreenPoint();
        const nx = drag.bounds.x + (now.x - drag.cursor.x);
        const ny = drag.bounds.y + (now.y - drag.cursor.y);
        const c = clampToWorkArea(nx, ny);
        petWin.setPosition(c.x, c.y);
      }, 16);
    });

    ipcMain.on('pet:drag-end', () => {
      if (dragTimer) {
        clearInterval(dragTimer);
        dragTimer = null;
      }
      drag = null;
      if (petWin && !petWin.isDestroyed()) {
        const b = petWin.getBounds();
        saveCfg({ petX: b.x, petY: b.y });
      }
    });

    ipcMain.on('pet:menu', () => {
      buildTrayMenu().popup({ window: petWin });
    });

    ipcMain.on('pet:settled', () => {
      if (petWin && !petWin.isDestroyed()) petWin.showInactive();
    });

    // 主窗设置面板（preload → window.a2desktop），每次返回完整状态供 UI 重绘
    ipcMain.handle('desktop:get-settings', () => desktopSettings());
    ipcMain.handle('desktop:set-pet-visible', (_e, v) => {
      setPetHidden(!v);
      refreshTrayMenu();
      return desktopSettings();
    });
    ipcMain.handle('desktop:set-close-action', (_e, a) => {
      if (CLOSE_ACTIONS.indexOf(a) >= 0) saveCfg({ closeAction: a });
      return desktopSettings();
    });

    // 桌面设置自检要调上面的 IPC，所以放在注册之后
    if (process.argv.includes('--smoke-desk')) {
      runSmokeDesk();
      return;
    }

    // 开机自启：只出桌宠，不弹主窗。
    // 手动双击图标（含托盘「打开学习中心」之外的一切正常启动）一律把学习中心开出来——
    // 以前只在「第一次运行」开，之后双击就只剩托盘图标，用户会以为程序坏了。
    const autostart = process.argv.includes('--autostart');
    const cfg = loadCfg();
    if (!autostart) {
      if (!cfg.firstRunDone) saveCfg({ firstRunDone: true });
      // 不再延迟 600ms：那 600ms 是窗口出现前纯等待的空白期，
      // 双击后屏幕没反应，用户就会去点第二下。桌宠照常同时建，不冲突。
      createMain();
    }

    // 自动更新：延迟几秒再查，别跟首屏抢带宽。没新版就一声不响。
    // 自检/截图模式一律不查 —— 无人值守的进程被弹窗卡住就再也退不出来了。
    if (!OFFSCREEN) setTimeout(() => checkUpdates({ silent: true }), updater.CHECK_DELAY_MS);
  });

  app.on('window-all-closed', (e) => {
    // 托盘常驻：不因为关窗退出
    e.preventDefault();
  });

  app.on('before-quit', () => {
    quitting = true;
  });
}
