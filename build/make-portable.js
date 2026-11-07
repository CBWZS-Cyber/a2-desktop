// 组装「绿色版」：exe 只改名、不改写 PE —— 保住官方 electron.exe 的哈希信誉，
// 让开着「智能应用控制」（SAC）的机器也能直接跑。
// 代价：exe 属性里仍是 Electron 的图标与产品名（窗口图标不受影响）。
// 用法：node build/make-portable.js  →  dist/A2兴海智学_绿色版_<版本>.zip
'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const VERSION = require(path.join(ROOT, 'package.json')).version;
const APP_NAME = 'A2兴海智学';
const DIST = path.join(ROOT, 'node_modules', 'electron', 'dist');
const STAGE = path.join(ROOT, 'build', 'portable', APP_NAME);
const OUT = path.join(ROOT, 'dist', `${APP_NAME}_绿色版_${VERSION}.zip`);

function rmrf(p) {
  fs.rmSync(p, { recursive: true, force: true });
}
function copyDir(from, to) {
  fs.mkdirSync(to, { recursive: true });
  for (const ent of fs.readdirSync(from, { withFileTypes: true })) {
    const s = path.join(from, ent.name);
    const d = path.join(to, ent.name);
    if (ent.isDirectory()) copyDir(s, d);
    else fs.copyFileSync(s, d);
  }
}

if (!fs.existsSync(DIST)) {
  console.error('[x] 找不到 Electron 运行时，先 npm install');
  process.exit(1);
}

console.log('[1/4] 复制 Electron 运行时（保留官方 exe 原样）…');
rmrf(STAGE);
fs.mkdirSync(STAGE, { recursive: true });
copyDir(DIST, STAGE);

console.log('[2/4] 放入应用代码 …');
const appDir = path.join(STAGE, 'resources', 'app');
rmrf(appDir);
fs.mkdirSync(appDir, { recursive: true });
copyDir(path.join(ROOT, 'src'), path.join(appDir, 'src'));
copyDir(path.join(ROOT, 'assets'), path.join(appDir, 'assets'));
fs.writeFileSync(
  path.join(appDir, 'package.json'),
  JSON.stringify(
    {
      name: 'a2-desktop',
      productName: APP_NAME,
      version: VERSION,
      description: 'A2 兴海智学 · 桌面助手',
      main: 'src/main.js',
      author: '曹博文',
    },
    null,
    2
  ),
  'utf8'
);
rmrf(path.join(STAGE, 'resources', 'default_app.asar'));

console.log('[3/4] 只改名，不改写 PE（这一步是 SAC 能放行的关键）…');
const oldExe = path.join(STAGE, 'electron.exe');
const newExe = path.join(STAGE, APP_NAME + '.exe');
if (fs.existsSync(newExe)) fs.rmSync(newExe);
fs.renameSync(oldExe, newExe);

// 使用说明放在包根
fs.copyFileSync(
  path.join(ROOT, '使用说明.txt'),
  path.join(STAGE, '使用说明.txt')
);
fs.writeFileSync(
  path.join(STAGE, '怎么用.txt'),
  [
    `${APP_NAME} ${VERSION} · 绿色版（免安装）`,
    '================================',
    '',
    '一、为什么是压缩包',
    '    这个版本的 exe 没有改写任何资源（图标/版本信息保留 Electron 原样），',
    '    为的是保住官方二进制的系统信誉，让开启了「智能应用控制」的电脑也能直接运行。',
    '',
    '二、怎么用',
    '    1. 把整个文件夹解压到任意位置（不要只把 exe 拖出来，它需要同级文件）。',
    `    2. 双击 ${APP_NAME}.exe。首次启动会打开一次学习中心，之后只在右下角出小张。`,
    '    3. 想要桌面快捷方式：右键 exe → 发送到 → 桌面快捷方式（可自行改名、换图标）。',
    '    4. 想开机自启：右键小张 → 勾选「开机自动启动」。',
    '',
    '三、卸载',
    '    直接删掉整个文件夹即可（自启项请先在右键菜单里取消勾选）。',
    '    本地登录状态在 %APPDATA%\\' + APP_NAME + '，需要的话一并删除。',
    '',
    '                哈尔滨工程大学 · A2 团队',
  ].join('\r\n'),
  'utf8'
);

console.log('[4/4] 打包 zip …');
fs.mkdirSync(path.join(ROOT, 'dist'), { recursive: true });
if (fs.existsSync(OUT)) fs.rmSync(OUT, { force: true });
const ps = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
execFileSync(
  ps,
  [
    '-NoProfile',
    '-NonInteractive',
    '-Command',
    `Compress-Archive -Path '${STAGE}' -DestinationPath '${OUT}' -CompressionLevel Optimal -Force`,
  ],
  { stdio: 'inherit' }
);

const mb = (fs.statSync(OUT).size / 1024 / 1024).toFixed(1);
console.log('\n──────── 绿色版完成 ────────');
console.log('压缩包：' + OUT);
console.log('体积  ：' + mb + ' MB');
console.log('解压后：' + STAGE);
console.log('提示  ：exe 属性里显示的是 Electron（未改写 PE），窗口与托盘图标仍是小张。');
