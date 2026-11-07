// 组装免安装目录（build/win-unpacked），再把 exe 改名并写入图标 / 版本信息
// 用法：node build/make-shell.js
'use strict';

const fs = require('fs');
const path = require('path');
const ResEdit = require('resedit');

const ROOT = path.join(__dirname, '..');
const DIST = path.join(ROOT, 'node_modules', 'electron', 'dist');
const OUT = path.join(ROOT, 'build', 'win-unpacked');
const APP_NAME = 'A2兴海智学';
const VERSION = require(path.join(ROOT, 'package.json')).version;

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
function copyFile(from, to) {
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.copyFileSync(from, to);
}

if (!fs.existsSync(DIST)) {
  console.error('[x] 找不到 Electron 运行时：' + DIST);
  console.error('    先跑 npm install');
  process.exit(1);
}

console.log('[1/4] 清理并复制 Electron 运行时 …');
rmrf(OUT);
fs.mkdirSync(OUT, { recursive: true });
copyDir(DIST, OUT);

console.log('[2/4] 放入应用代码 …');
const appDir = path.join(OUT, 'resources', 'app');
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
// 删掉 Electron 自带的默认应用，避免兜底干扰
rmrf(path.join(OUT, 'resources', 'default_app.asar'));

console.log('[3/4] 改名 ' + APP_NAME + '.exe …');
const oldExe = path.join(OUT, 'electron.exe');
const newExe = path.join(OUT, APP_NAME + '.exe');
if (fs.existsSync(newExe)) fs.rmSync(newExe);
fs.renameSync(oldExe, newExe);

console.log('[4/4] 写入图标与版本信息 …');
const icoPath = path.join(ROOT, 'build', 'icon.ico');
const buf = fs.readFileSync(newExe);
const exeFile = ResEdit.NtExecutable.from(buf, { ignoreCert: true });
const res = ResEdit.NtExecutableResource.from(exeFile);

const viList = ResEdit.Resource.VersionInfo.fromEntries(res.entries);
if (viList.length) {
  const vi = viList[0];
  const [a, b, c] = VERSION.split('.').map((n) => parseInt(n, 10) || 0);
  vi.setFileVersion(a, b, c, 0);
  vi.setProductVersion(a, b, c, 0);
  vi.removeAllStringValues({ lang: 1033, codepage: 1200 });
  vi.setStringValues(
    { lang: 1033, codepage: 1200 },
    {
      CompanyName: '哈尔滨工程大学 · A2 团队',
      FileDescription: 'A2 兴海智学 · 桌面助手',
      ProductName: APP_NAME,
      InternalName: 'a2-desktop',
      OriginalFilename: APP_NAME + '.exe',
      LegalCopyright: 'Copyright © 2026 A2 团队',
      FileVersion: VERSION,
      ProductVersion: VERSION,
    }
  );
  vi.outputToResourceEntries(res.entries);
}

const iconFile = ResEdit.Data.IconFile.from(fs.readFileSync(icoPath));
ResEdit.Resource.IconGroupEntry.replaceIconsForResource(
  res.entries,
  1,
  1033,
  iconFile.icons.map((i) => i.data)
);

res.outputResource(exeFile);
fs.writeFileSync(newExe, Buffer.from(exeFile.generate()));

console.log('[ok] 免安装目录：' + OUT);
console.log('[ok] 主程序：' + newExe);
