'use strict';
/**
 * 窗口内提示层（替代 window 原生对话框）。
 *
 * 为什么不用 dialog.showMessageBox：
 *   1. 它是 Windows 原生窗口，不在渲染树里，capturePage() 永远抓不到；
 *   2. 无头自检点不了它，进程会一直挂在那里等；
 *   3. 外观是系统灰底小方框，跟软件不是一个风格。
 *
 * 这里就是一个注入到页面里的 div：能被截图、能被脚本点、能跟随深浅主题。
 * 只在"主窗存在"时可用；主窗不在（开机自启）时调用方自己回退到原生对话框。
 */

const STYLE_ID = 'a2-up-style';

const CSS = `
#a2-up-mask{position:fixed;inset:0;z-index:2147483000;display:flex;align-items:center;justify-content:center;
  background:rgba(8,12,18,.44);-webkit-backdrop-filter:blur(2px);backdrop-filter:blur(2px);
  font-family:"Microsoft YaHei","PingFang SC",system-ui,sans-serif;animation:a2up-fade .15s ease-out}
#a2-up-mask .a2up-card{width:400px;max-width:calc(100vw - 56px);box-sizing:border-box;
  border-radius:16px;padding:22px 22px 16px;animation:a2up-pop .2s cubic-bezier(.2,.9,.3,1.08)}
#a2-up-mask[data-a2up-dark="0"] .a2up-card{background:#fff;border:1px solid #E7EAEE;
  box-shadow:0 20px 52px rgba(16,24,40,.22)}
#a2-up-mask[data-a2up-dark="1"] .a2up-card{background:#1B222B;border:1px solid #2A3441;
  box-shadow:0 20px 52px rgba(0,0,0,.5)}
#a2-up-mask .a2up-title{font-size:11.5px;letter-spacing:.06em;font-weight:600;margin-bottom:8px}
#a2-up-mask[data-a2up-dark="0"] .a2up-title{color:#1565C0}
#a2-up-mask[data-a2up-dark="1"] .a2up-title{color:#79ABF0}
#a2-up-mask .a2up-msg{font-size:16px;line-height:1.45;font-weight:600;margin-bottom:10px}
#a2-up-mask[data-a2up-dark="0"] .a2up-msg{color:#1A1F26}
#a2-up-mask[data-a2up-dark="1"] .a2up-msg{color:#E6EDF5}
#a2-up-mask .a2up-detail{font-size:12.5px;line-height:1.75;white-space:pre-wrap;
  max-height:38vh;overflow:auto;margin-bottom:18px;padding-right:2px}
#a2-up-mask[data-a2up-dark="0"] .a2up-detail{color:#5E6B7A}
#a2-up-mask[data-a2up-dark="1"] .a2up-detail{color:#9BA8B8}
#a2-up-mask .a2up-row{display:flex;justify-content:flex-end;gap:10px;flex-wrap:wrap}
#a2-up-mask .a2up-btn{appearance:none;border-radius:9px;padding:8px 16px;font-size:13px;line-height:1.3;
  cursor:pointer;font-family:inherit;transition:background .12s ease,border-color .12s ease,transform .06s ease}
#a2-up-mask .a2up-btn:active{transform:translateY(1px)}
#a2-up-mask[data-a2up-dark="0"] .a2up-btn{background:#fff;border:1px solid #DCE1E7;color:#414B57}
#a2-up-mask[data-a2up-dark="0"] .a2up-btn:hover{background:#F4F6F9;border-color:#C7D0DA}
#a2-up-mask[data-a2up-dark="1"] .a2up-btn{background:#232B36;border:1px solid #35404F;color:#C3CEDA}
#a2-up-mask[data-a2up-dark="1"] .a2up-btn:hover{background:#2A3341;border-color:#415065}
#a2-up-mask .a2up-btn.is-primary{font-weight:600;border-color:transparent;color:#fff;background:#1565C0}
#a2-up-mask .a2up-btn.is-primary:hover{background:#1158A8}
#a2-up-mask[data-a2up-dark="1"] .a2up-btn.is-primary{background:#2C7BE5}
#a2-up-mask[data-a2up-dark="1"] .a2up-btn.is-primary:hover{background:#3A88EE}
@keyframes a2up-fade{from{opacity:0}to{opacity:1}}
@keyframes a2up-pop{from{opacity:0;transform:translateY(10px) scale(.97)}to{opacity:1;transform:none}}
/* 无头截图时用：隐藏窗口会节流动画，抓到的就是半透明中间帧 */
#a2-up-mask[data-a2up-noanim="1"],#a2-up-mask[data-a2up-noanim="1"] .a2up-card{animation:none!important}
@media (prefers-reduced-motion: reduce){
  #a2-up-mask,#a2-up-mask .a2up-card{animation:none}
}
`;

function normalize(options) {
  const o = options || {};
  const buttons = Array.isArray(o.buttons) && o.buttons.length ? o.buttons.slice() : ['好'];
  const def = Number.isInteger(o.defaultId) ? o.defaultId : 0;
  const cancel = Number.isInteger(o.cancelId) ? o.cancelId : buttons.length - 1;
  return {
    title: String(o.title || ''),
    message: String(o.message || ''),
    detail: String(o.detail || ''),
    buttons: buttons.map(String),
    defaultId: def >= 0 && def < buttons.length ? def : 0,
    cancelId: cancel >= 0 && cancel < buttons.length ? cancel : -1,
  };
}

/**
 * 注入到渲染进程的代码。
 * awaitIt=true  → 返回 Promise<点击的按钮序号>，executeJavaScript 会等它。
 * awaitIt=false → 只渲染，立即返回，供截图/后续脚本点击。
 */
function buildCode(p, awaitIt) {
  return `(function () {
  var P = ${JSON.stringify(p)};
  var old = document.getElementById('a2-up-mask');
  if (old && old.parentNode) old.parentNode.removeChild(old);
  if (!document.getElementById('${STYLE_ID}')) {
    var st = document.createElement('style');
    st.id = '${STYLE_ID}';
    st.textContent = ${JSON.stringify(CSS)};
    document.head.appendChild(st);
  }
  var dark = String(document.documentElement.getAttribute('data-theme') || '') === 'dark';
  var mask = document.createElement('div');
  mask.id = 'a2-up-mask';
  mask.setAttribute('data-a2up-dark', dark ? '1' : '0');
  if (window.__a2upNoAnim) mask.setAttribute('data-a2up-noanim', '1');
  var card = document.createElement('div');
  card.className = 'a2up-card';
  if (P.title) {
    var t = document.createElement('div');
    t.className = 'a2up-title';
    t.textContent = P.title;
    card.appendChild(t);
  }
  var msg = document.createElement('div');
  msg.className = 'a2up-msg';
  msg.textContent = P.message;
  card.appendChild(msg);
  if (P.detail) {
    var d = document.createElement('div');
    d.className = 'a2up-detail';
    d.textContent = P.detail;
    card.appendChild(d);
  }
  var row = document.createElement('div');
  row.className = 'a2up-row';
  var btns = [];
  P.buttons.forEach(function (label, i) {
    var b = document.createElement('button');
    b.type = 'button';
    b.className = 'a2up-btn' + (i === P.defaultId ? ' is-primary' : '');
    b.textContent = label;
    b.onclick = function () { finish(i); };
    row.appendChild(b);
    btns.push(b);
  });
  card.appendChild(row);
  mask.appendChild(card);

  var settled = false;
  var onKey = null;
  function cleanup() {
    if (onKey) document.removeEventListener('keydown', onKey, true);
    if (mask.parentNode) mask.parentNode.removeChild(mask);
    if (window.__a2upFinish === finish) window.__a2upFinish = null;
  }
  function finish(i) {
    if (settled) return;
    settled = true;
    cleanup();
    if (window.__a2upResolve) {
      var r = window.__a2upResolve;
      window.__a2upResolve = null;
      r(i);
    }
  }
  // 供无头自检点击：window.__a2upFinish(序号)
  window.__a2upFinish = finish;

  document.body.appendChild(mask);
  onKey = function (e) {
    if (settled) return;
    if (e.key === 'Escape' && P.cancelId >= 0) { e.preventDefault(); finish(P.cancelId); }
    else if (e.key === 'Enter') { e.preventDefault(); finish(P.defaultId); }
  };
  document.addEventListener('keydown', onKey, true);
  try { btns[P.defaultId].focus(); } catch (_) {}

  ${awaitIt ? `return new Promise(function (resolve) { window.__a2upResolve = resolve; });` : 'return null;'}
})()`;
}

/**
 * 弹出提示并等用户点。
 * @returns {Promise<number>} 被点击的按钮序号；窗口没了就返回 cancelId
 */
function ask(win, options) {
  const p = normalize(options);
  const fallback = p.cancelId >= 0 ? p.cancelId : p.buttons.length - 1;
  return new Promise((resolve) => {
    let settled = false;
    const onGone = () => finish(null);
    const finish = (v) => {
      if (settled) return;
      settled = true;
      try { win.removeListener('closed', onGone); } catch (_) {}
      try { win.webContents.removeListener('destroyed', onGone); } catch (_) {}
      try { win.webContents.removeListener('did-navigate', onGone); } catch (_) {}
      resolve(typeof v === 'number' && v >= 0 && v < p.buttons.length ? v : fallback);
    };
    try {
      win.webContents.executeJavaScript(buildCode(p, true), true).then(finish, () => finish(null));
    } catch (_) {
      finish(null);
      return;
    }
    // 三种"页面没了"的情形都兜住，否则这个 Promise 永远不 settle，
    // checkUpdates 里 updateBusy 会一直为 true，之后再也检查不了更新。
    try { win.once('closed', onGone); } catch (_) {}
    try { win.webContents.once('destroyed', onGone); } catch (_) {}
    try { win.webContents.once('did-navigate', onGone); } catch (_) {}
  });
}

/** 只渲染不等（截图自检用） */
async function render(win, options) {
  await win.webContents.executeJavaScript(buildCode(normalize(options), false), true);
}

/** 脚本点按钮（无头自检用），返回是否确实有提示层在等 */
async function click(win, index) {
  return win.webContents.executeJavaScript(
    `(function(){ if (typeof window.__a2upFinish !== 'function') return false;
      window.__a2upFinish(${Number(index) || 0}); return true; })()`,
    true
  );
}

/** 提示层是否正在显示（自检断言用） */
async function visible(win) {
  return win.webContents.executeJavaScript(
    `(function(){ var m = document.getElementById('a2-up-mask');
      if (!m) return null;
      var b = m.querySelectorAll('.a2up-btn');
      return { buttons: b.length, primary: (m.querySelector('.a2up-btn.is-primary') || {}).textContent || '',
               title: (m.querySelector('.a2up-title') || {}).textContent || '',
               msg: (m.querySelector('.a2up-msg') || {}).textContent || '',
               dark: m.getAttribute('data-a2up-dark') }; })()`,
    true
  );
}

module.exports = { ask, render, click, visible };
