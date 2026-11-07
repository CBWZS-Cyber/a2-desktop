// A2 兴海智学 · 桌面端主进程
// 结构：桌宠窗（透明置顶，常驻桌面，点击进主窗） + 主窗（学习中心） + 托盘
'use strict';

const { app, BrowserWindow, Tray, Menu, ipcMain, screen, nativeImage, shell, dialog } = require('electron');
const path = require('path');
const fs = require('fs');

const SITE_PRIMARY = 'https://learnest.cn/';
const SITE_FALLBACK = 'http://39.96.82.119:8090/';
const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36 A2Desktop/1.0';

const PET_W = 200;
const PET_H = 300;

// 自检模式：窗口挪到屏幕外，绝不打扰正在用电脑的人
const SMOKE_MODES = ['--smoke', '--smoke-main', '--smoke-flow'];
const OFFSCREEN = process.argv.some((a) => SMOKE_MODES.includes(a));

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

// ── 桌宠窗 ────────────────────────────────────────────────────
function defaultPetPos() {
  const wa = screen.getPrimaryDisplay().workArea;
  return {
    x: Math.round(wa.x + wa.width - PET_W - 24),
    y: Math.round(wa.y + wa.height - PET_H - 24),
  };
}

function clampToWorkArea(x, y) {
  const pt = { x: x + Math.round(PET_W / 2), y: y + Math.round(PET_H / 2) };
  const d = screen.getDisplayNearestPoint(pt);
  const wa = d.workArea;
  return {
    x: Math.min(Math.max(x, wa.x - PET_W + 60), wa.x + wa.width - 60),
    y: Math.min(Math.max(y, wa.y), wa.y + wa.height - 60),
  };
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
    x: saved.x,
    y: saved.y,
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
  });
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
    show: false,
    x: OFFSCREEN ? -20000 : undefined,
    y: OFFSCREEN ? -20000 : undefined,
    skipTaskbar: OFFSCREEN,
    title: 'A2 兴海智学',
    backgroundColor: '#0d1220',
    autoHideMenuBar: true,
    icon: path.join(__dirname, '..', 'assets', 'app.png'),
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      spellcheck: false,
    },
  });

  let triedFallback = false;

  mainWin.loadURL(SITE_PRIMARY, { userAgent: USER_AGENT }).catch(() => {});

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
  });

  // 外链交给系统浏览器，站内跳转留在窗口里
  mainWin.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\/(learnest\.cn|39\.96\.82\.119|39\.105\.223\.8)/i.test(url)) {
      return { action: 'allow', overrideBrowserWindowOptions: { autoHideMenuBar: true } };
    }
    shell.openExternal(url);
    return { action: 'deny' };
  });

  // 关窗 = 收回宠物，不退出
  mainWin.on('close', (e) => {
    if (!quitting) {
      e.preventDefault();
      mainHiddenByUser = true;
      mainWin.hide();
      if (petWin && !petWin.isDestroyed()) petWin.showInactive();
    }
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
  return Menu.buildFromTemplate([
    { label: '打开学习中心', click: () => createMain() },
    {
      label: '显示桌宠小张',
      click: () => {
        if (petWin && !petWin.isDestroyed()) petWin.show();
        else createPet();
      },
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

function createTray() {
  const p = iconPath('tray.png');
  const img = fs.existsSync(p) ? nativeImage.createFromPath(p) : nativeImage.createEmpty();
  tray = new Tray(img);
  tray.setToolTip('A2 兴海智学 · 小张在的');
  tray.setContextMenu(buildTrayMenu());
  tray.on('click', () => createMain());
  tray.on('double-click', () => createMain());
}

function refreshTrayMenu() {
  if (tray) tray.setContextMenu(buildTrayMenu());
}

function showAbout() {
  dialog.showMessageBox({
    type: 'info',
    title: '关于 A2 兴海智学',
    message: `A2 兴海智学 · 桌面助手  v${app.getVersion()}`,
    detail:
      '小张常驻桌面右下角，点他一下就能进学习中心。\n\n' +
      '· 拖动小张可换位置（松手即记住）\n' +
      '· 右键小张：打开 / 隐藏 / 开机自启 / 退出\n' +
      '· 关掉主窗只是收起，小张还在',
    buttons: ['好'],
    noLink: true,
  });
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
          bubble: window.__hitTest(100, 40)
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
        report.hit.bubble === true;
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
    /* 写不进去就看退出码 */
  }
}

// 主窗冒烟：验证「点开能进学习中心」；带 --smoke-url= 时可验证失败回退页
function runSmokeMain() {
  const urlArg = process.argv.find((a) => a.startsWith('--smoke-url='));
  const target = urlArg ? urlArg.slice('--smoke-url='.length) : SITE_PRIMARY;
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
  report.steps.push({ step: 'open', id: w1.id, visible: w1.isVisible() });

  const w2 = createMain();
  report.steps.push({
    step: 'open-again',
    sameInstance: w1.id === w2.id,
    windows: BrowserWindow.getAllWindows().filter((x) => !x.isDestroyed()).length,
  });

  w1.close(); // 触发 close 事件：应 preventDefault + hide
  setTimeout(() => {
    const alive = !w1.isDestroyed();
    const hidden = !w1.isVisible();
    report.steps.push({ step: 'close-hides', alive, hidden });

    const w3 = createMain();
    setTimeout(() => {
      report.steps.push({
        step: 'reopen',
        sameInstance: w1.id === w3.id,
        visible: w3.isVisible(),
      });
      report.ok =
        report.steps[1].sameInstance &&
        report.steps[1].windows === 1 &&
        report.steps[2].alive &&
        report.steps[2].hidden &&
        report.steps[3].sameInstance &&
        report.steps[3].visible;
      done();
    }, 700);
  }, 700);
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
  writeSmoke({ ok: shots.every((s) => !s.error), shots });
  quitting = true;
  app.exit(0);
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

    if (process.argv.includes('--shot')) {
      runShot();
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

    createPet();
    createTray();

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

    // 开机自启：只出桌宠，不弹主窗
    const autostart = process.argv.includes('--autostart');
    const cfg = loadCfg();
    if (!autostart && !cfg.firstRunDone) {
      // 第一次装完双击图标：直接把学习中心开出来，避免"以为没打开"
      saveCfg({ firstRunDone: true });
      setTimeout(() => createMain(), 600);
    }
  });

  app.on('window-all-closed', (e) => {
    // 托盘常驻：不因为关窗退出
    e.preventDefault();
  });

  app.on('before-quit', () => {
    quitting = true;
  });
}
