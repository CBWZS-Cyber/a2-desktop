'use strict';
/**
 * 自动更新（2026-11-11）
 *
 * 设计沿用《战棋》《乱世五方》那套（scripts/net/update_check.gd、lswf/.../auto_update.gd），
 * 四条铁律一字不改：
 *
 *   1. **只拉 1 KB 的清单**，比版本号；安装包等用户点了才下。
 *      检查更新的流量比下载小四个数量级，不能每次启动都去拽 86 MB。
 *   2. **检查失败必须放行**。断网 / 超时 / 404 / JSON 坏了，一律 ok:false，
 *      主流程照常 —— 绝不因为"查不到更新"挡住用户。
 *   3. **任何一步失败都只是"没更新成"**，程序照常能用。
 *   4. 下载走 **OSS 签名直链**（10 年有效），不经过那台小服务器中转。
 *
 * 另外抄了它们两个细节：
 *   · **就绪标记**：已经下好却没重启，下次启动直接提示"重启安装"，不重复下几十 MB。
 *   · **清理上次残留**：半截文件绝不能被当成完整包。
 *
 * 与 Godot 那两边的差别在"怎么装"：它们导出的是单文件 exe，下载 zip 换掉就行；
 * A2 是 Electron 目录树 + Inno Setup，所以下载**安装包**、校验 sha256、直接拉起安装器退出。
 *
 *   ⚠️ 这里**故意不写 .bat**。安装路径是 `C:\Users\<用户>\AppData\Local\Programs\A2兴海智学\`，
 *   含中文；Node 写出的 bat 是 UTF-8 无 BOM，cmd 按 936 代码页读会乱码成 `A2鍏存捣...`，
 *   跟之前快捷方式那个坑是同一个。直接 spawn 安装器则走 CreateProcessW，中文路径没问题
 *   （Inno 自己也是 Unicode 程序）。
 *
 *   ⚠️ 调试版（--dev）**只检查、不下载、不安装**：它跑的是源码目录的 electron.exe，
 *   真装会把安装版盖掉，调试时还可能打断正在改的东西。
 */
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const https = require('node:https');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');
const { app } = require('electron');

const VERSION_URL = 'https://learnest.cn/api/desktop/version';
const CHECK_DELAY_MS = 8000; // 启动后别和首屏抢带宽
const TIMEOUT_MS = 8000;
const MAX_REDIRECTS = 3;
const MIN_BYTES = 8 * 1024 * 1024; // 安装包不可能小于 8 MB，小于这个一定是错误页

// ── 版本号 ────────────────────────────────────────────────────
function parseVer(v) {
  return String(v || '')
    .trim()
    .replace(/^v/i, '')
    .split(/[.\-+]/)
    .map((x) => parseInt(x, 10))
    .map((n) => (Number.isFinite(n) ? n : 0));
}

/** a > b 返回正数，相等 0，a < b 负数。按数字段比，1.1.10 > 1.1.9。 */
function cmpVer(a, b) {
  const A = parseVer(a);
  const B = parseVer(b);
  const n = Math.max(A.length, B.length);
  for (let i = 0; i < n; i++) {
    const d = (A[i] || 0) - (B[i] || 0);
    if (d) return d;
  }
  return 0;
}

// ── 取清单 ────────────────────────────────────────────────────
function httpGetJson(url, redirects = 0) {
  return new Promise((resolve, reject) => {
    let u;
    try {
      u = new URL(url);
    } catch (_) {
      return reject(new Error('清单地址不合法'));
    }
    const mod = u.protocol === 'http:' ? http : https;
    const req = mod.get(
      u,
      {
        timeout: TIMEOUT_MS,
        headers: {
          'User-Agent': `A2Desktop/${app.getVersion()} (${process.platform})`,
          Accept: 'application/json',
          'Cache-Control': 'no-cache',
        },
      },
      (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          res.resume();
          if (redirects >= MAX_REDIRECTS) return reject(new Error('重定向过多'));
          return resolve(httpGetJson(new URL(res.headers.location, u).toString(), redirects + 1));
        }
        if (res.statusCode !== 200) {
          res.resume();
          return reject(new Error(`HTTP ${res.statusCode}`));
        }
        const chunks = [];
        let bytes = 0;
        res.on('data', (c) => {
          bytes += c.length;
          if (bytes > 256 * 1024) {
            req.destroy();
            reject(new Error('清单过大，疑似不是清单'));
            return;
          }
          chunks.push(c);
        });
        res.on('end', () => {
          try {
            resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
          } catch (_) {
            reject(new Error('清单不是合法 JSON'));
          }
        });
      }
    );
    req.on('timeout', () => req.destroy(new Error('请求超时')));
    req.on('error', (e) => reject(e));
  });
}

/**
 * 从指定地址取清单并判定。抽成可传 URL 的版本，测试脚本能指向本地假清单，
 * 不必为了验一段逻辑去改线上文件。
 */
async function checkFrom(url) {
  const current = app.getVersion();
  const out = {
    ok: false,
    hasUpdate: false,
    current,
    latest: '',
    url: '',
    size: '',
    sha256: '',
    notes: [],
    reason: '',
  };
  try {
    const m = await httpGetJson(url || VERSION_URL);
    if (!m || !m.latest) {
      out.reason = '清单里没有 latest 字段';
      return out;
    }
    out.ok = true;
    out.latest = String(m.latest);
    out.url = String((m.downloads && m.downloads.win64) || '');
    out.size = String(m.sizeWin64 || '');
    out.sha256 = String(m.sha256 || '');
    out.notes = Array.isArray(m.notes) ? m.notes.map(String) : [];
    const newer = cmpVer(out.latest, current) > 0;
    out.hasUpdate = newer && !!out.url;
    // 有新版但清单没直链 = 发版没传完整，按"没有更新"处理，别把用户引到空下载
    if (newer && !out.url) out.reason = '清单缺少下载直链';
    return out;
  } catch (e) {
    out.reason = (e && e.message) || String(e);
    return out;
  }
}

/**
 * 生产路径：读线上清单。
 * 自检要跑完整链路（真的触发一次"发现新版本"），得能把地址指到本地假服务；
 * 只在自检里调用 setVersionUrl，正常运行永远用 VERSION_URL。
 */
let versionUrl = VERSION_URL;
function setVersionUrl(u) {
  const v = String(u || '');
  versionUrl = v || VERSION_URL;
  return versionUrl;
}
function check() {
  return checkFrom(versionUrl);
}

// ── 下载 ──────────────────────────────────────────────────────
function updateDir() {
  return path.join(app.getPath('temp'), 'a2-update');
}

/** 上次已下好却一直没重启 → 返回它的版本号，避免重复下几十 MB。 */
function preparedVersion() {
  try {
    const j = JSON.parse(fs.readFileSync(path.join(updateDir(), 'ready.json'), 'utf8'));
    if (j && j.version && j.file && fs.existsSync(j.file) && fs.statSync(j.file).size >= MIN_BYTES) {
      return String(j.version);
    }
  } catch (_) {
    /* 没有或坏了都当没有 */
  }
  return '';
}

function clearPrepared() {
  try {
    fs.rmSync(updateDir(), { recursive: true, force: true });
  } catch (_) {
    /* 清不掉不影响下次覆盖写 */
  }
}

function download(url, dest, onProgress, redirects = 0) {
  return new Promise((resolve, reject) => {
    let u;
    try {
      u = new URL(url);
    } catch (_) {
      return reject(new Error('下载地址不合法'));
    }
    const mod = u.protocol === 'http:' ? http : https;
    const req = mod.get(u, { timeout: 30000, headers: { 'User-Agent': 'A2Desktop-Updater' } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        if (redirects >= MAX_REDIRECTS) return reject(new Error('重定向过多'));
        return resolve(
          download(new URL(res.headers.location, u).toString(), dest, onProgress, redirects + 1)
        );
      }
      if (res.statusCode !== 200) {
        res.resume();
        return reject(new Error(`下载失败 HTTP ${res.statusCode}`));
      }
      const total = parseInt(res.headers['content-length'] || '0', 10);
      let got = 0;
      const ws = fs.createWriteStream(dest);
      res.on('data', (c) => {
        got += c.length;
        if (total > 0 && onProgress) onProgress(got / total);
      });
      res.pipe(ws);
      ws.on('finish', () => ws.close(() => resolve({ bytes: got, total })));
      ws.on('error', reject);
      res.on('error', reject);
    });
    req.on('timeout', () => req.destroy(new Error('连接超时')));
    req.on('error', reject);
  });
}

function sha256File(file) {
  return new Promise((resolve, reject) => {
    const h = crypto.createHash('sha256');
    const rs = fs.createReadStream(file);
    rs.on('data', (c) => h.update(c));
    rs.on('end', () => resolve(h.digest('hex')));
    rs.on('error', reject);
  });
}

/**
 * 下载并校验。成功返回 setup 路径，失败抛错。
 * 文件名用 ASCII，绝不用中文 —— 少一个编码坑。
 */
async function fetchUpdate(info, onProgress) {
  const dir = updateDir();
  clearPrepared(); // 半截文件绝不能留着被当完整包
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `A2-Setup-${info.latest}.exe`);

  await download(info.url, file, onProgress);

  const size = fs.statSync(file).size;
  if (size < MIN_BYTES) {
    clearPrepared();
    throw new Error(`下载的文件不完整（${(size / 1048576).toFixed(1)} MB）`);
  }
  if (info.sha256) {
    const got = await sha256File(file);
    if (got.toLowerCase() !== info.sha256.toLowerCase()) {
      clearPrepared();
      throw new Error('校验不通过（文件损坏或清单与包不匹配）');
    }
  }
  fs.writeFileSync(
    path.join(dir, 'ready.json'),
    JSON.stringify({ version: info.latest, file, sha256: info.sha256 || '' }, null, 2),
    'utf8'
  );
  return file;
}

/**
 * 拉起安装器并退出本进程。
 *   安装器参数：/VERYSILENT 全程无界面；/NORESTART 不重启系统；
 *              /SUPPRESSMSGBOXES 不弹任何框；/CLOSEAPPLICATIONS 兜底关掉还占文件的实例。
 *   本进程必须**立刻退出**，否则 app 目录里的文件被自己占着，安装器写不进去。
 *   装完自动启动靠 installer.iss 的 [Run]（已去掉 skipifsilent）。
 */
function runInstaller(setupPath, onBeforeQuit) {
  const child = spawn(
    setupPath,
    ['/VERYSILENT', '/NORESTART', '/SUPPRESSMSGBOXES', '/CLOSEAPPLICATIONS'],
    { detached: true, stdio: 'ignore', windowsHide: true }
  );
  child.unref();
  // 给安装器一点启动时间，再把自己退掉（退太快会让安装器拿不到前台权限）
  setTimeout(() => {
    if (typeof onBeforeQuit === 'function') onBeforeQuit();
  }, 300);
}

module.exports = {
  check,
  checkFrom,
  setVersionUrl,
  cmpVer,
  download,
  sha256File,
  fetchUpdate,
  runInstaller,
  preparedVersion,
  clearPrepared,
  updateDir,
  VERSION_URL,
  CHECK_DELAY_MS,
};
