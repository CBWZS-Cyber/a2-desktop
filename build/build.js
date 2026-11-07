// 一键出包：图标（可选）→ 免安装目录 → Inno Setup 安装包 → 打印校验值
// 用法：
//   node build/build.js            常规出包
//   node build/build.js --icons    连图标一起重做（改了 zx_idle.png 才需要）
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const pkg = require(path.join(ROOT, 'package.json'));
const VERSION = pkg.version;

const ISCC_CANDIDATES = [
  path.join(process.env.LOCALAPPDATA || '', 'Programs', 'Inno Setup 6', 'ISCC.exe'),
  'C:\\Program Files (x86)\\Inno Setup 6\\ISCC.exe',
  'C:\\Program Files\\Inno Setup 6\\ISCC.exe',
];

function findISCC() {
  for (const p of ISCC_CANDIDATES) {
    if (p && fs.existsSync(p)) return p;
  }
  throw new Error('找不到 ISCC.exe，请确认已安装 Inno Setup 6');
}

function run(cmd, args, label) {
  process.stdout.write(`\n=== ${label} ===\n`);
  execFileSync(cmd, args, { cwd: ROOT, stdio: 'inherit' });
}

function md5(file) {
  return crypto.createHash('md5').update(fs.readFileSync(file)).digest('hex');
}

function main() {
  const t0 = Date.now();
  console.log(`A2 兴海智学 桌面端 · v${VERSION}`);

  if (process.argv.includes('--icons')) {
    run('python', [path.join('build', 'make_icons.py')], '1/3 生成图标');
  } else {
    console.log('\n=== 1/3 图标：跳过（加 --icons 可重做）===');
    if (!fs.existsSync(path.join(ROOT, 'build', 'icon.ico'))) {
      throw new Error('缺 build/icon.ico，请先跑 node build/build.js --icons');
    }
  }

  run(process.execPath, [path.join('build', 'make-shell.js')], '2/3 组装免安装目录');

  const iscc = findISCC();
  run(iscc, [path.join('installer.iss'), `/DMyAppVersion=${VERSION}`], '3/3 编译安装包');

  const out = path.join(ROOT, 'dist', `A2兴海智学_安装版_${VERSION}.exe`);
  if (!fs.existsSync(out)) throw new Error('编译结束但没找到产物：' + out);

  const sizeMB = (fs.statSync(out).size / 1024 / 1024).toFixed(1);
  console.log('\n──────── 出包完成 ────────');
  console.log('文件：' + out);
  console.log('体积：' + sizeMB + ' MB');
  console.log('MD5 ：' + md5(out));
  console.log('耗时：' + ((Date.now() - t0) / 1000).toFixed(0) + ' s');
}

try {
  main();
} catch (err) {
  console.error('\n[x] 出包失败：' + (err && err.message ? err.message : err));
  process.exit(1);
}
