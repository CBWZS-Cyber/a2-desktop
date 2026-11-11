// 账号中心里的「桌面端」设置块：显示桌面小张 + 关闭窗口时的行为。
// 只改本窗 DOM —— 服务端渲染的弹窗不受影响，浏览器里也看不到这一块。
// 由 main.js 在每次导航后注入（preload 暴露 window.a2desktop）。
(function () {
  if (window.__a2PetSwitch) return;
  window.__a2PetSwitch = 1;

  var CLOSE_OPS = [
    ['tray', '最小化到托盘'],
    ['quit', '退出程序'],
    ['ask', '每次询问']
  ];

  function ensureStyle() {
    if (document.getElementById('a2-pet-style')) return;
    var st = document.createElement('style');
    st.id = 'a2-pet-style';
    st.textContent = [
      '#a2-pet-row{border-top:1px solid #F1F1F1;font:13px "Microsoft YaHei",sans-serif;color:#424242}',
      '.a2-pet-line{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:9px 2px}',
      '.a2-pet-line+.a2-pet-line{border-top:1px solid #F7F7F7}',
      '.a2-pet-ctl{display:flex;align-items:center;gap:8px;flex:0 0 auto}',
      '#a2-pet-txt{font-size:11.5px;color:#9E9E9E}',
      /* 换钮（不是勾选框）：38x22 轨道 + 16 圆点 */
      '#a2-pet-sw{position:relative;width:38px;height:22px;border:0;border-radius:11px;background:#D6D6D6;cursor:pointer;padding:0;transition:background .18s var(--ease,ease);flex:0 0 auto}',
      '#a2-pet-sw:disabled{opacity:.55;cursor:default}',
      '#a2-pet-sw i{position:absolute;top:3px;left:3px;width:16px;height:16px;border-radius:50%;background:#fff;box-shadow:0 1px 3px rgba(0,0,0,.28);transition:transform .18s var(--ease,ease)}',
      '#a2-pet-sw[aria-checked="true"]{background:#1565C0}',
      '#a2-pet-sw[aria-checked="true"] i{transform:translateX(16px)}',
      '#a2-pet-close{font:13px "Microsoft YaHei",sans-serif;padding:3px 6px;border:1px solid #DDD;border-radius:8px;background:#fff;color:#424242;max-width:132px}',
      '#a2-pet-close:disabled{opacity:.6;background:#FAFAFA}',
      'html[data-theme="dark"] #a2-pet-row{color:#C7D0DB;border-color:#2A3441}',
      'html[data-theme="dark"] .a2-pet-line+.a2-pet-line{border-color:#232B36}',
      'html[data-theme="dark"] #a2-pet-sw{background:#3A4657}',
      'html[data-theme="dark"] #a2-pet-sw[aria-checked="true"]{background:#2E77CB}',
      'html[data-theme="dark"] #a2-pet-close{background:#1B232F;border-color:#313D4D;color:#C7D0DB}',
      'html[data-theme="dark"] #a2-pet-txt{color:#8B96A5}'
    ].join('');
    (document.head || document.documentElement).appendChild(st);
  }

  function build() {
    var modal = document.getElementById('a2-acct-modal');
    var logout = document.getElementById('a2-acct-logout');
    if (!modal || !logout || document.getElementById('a2-pet-row')) return;
    ensureStyle();

    var row = document.createElement('div');
    row.id = 'a2-pet-row';
    var ops = CLOSE_OPS.map(function (p) {
      return '<option value="' + p[0] + '">' + p[1] + '</option>';
    }).join('');
    row.innerHTML =
      '<div class="a2-pet-line">'
      + '<span>显示桌面小张</span>'
      + '<span class="a2-pet-ctl"><span id="a2-pet-txt">—</span>'
      + '<button id="a2-pet-sw" type="button" role="switch" aria-checked="false"><i></i></button></span>'
      + '</div>'
      + '<div class="a2-pet-line">'
      + '<span>关闭窗口时</span><span class="a2-pet-ctl">'
      + '<select id="a2-pet-close">' + ops + '</select></span>'
      + '</div>';
    // 插在「退出登录 / 切换账号」那一行之前
    modal.insertBefore(row, logout.parentNode);

    var sw = row.querySelector('#a2-pet-sw');
    var txt = row.querySelector('#a2-pet-txt');
    var sel = row.querySelector('#a2-pet-close');
    var api = window.a2desktop;
    var last = null; // 唯一可信的状态源：主进程返回的那份

    function paint(st) {
      if (!st) return;
      last = st;
      var on = !!st.petVisible;
      sw.setAttribute('aria-checked', on ? 'true' : 'false');
      sw.title = on ? '点一下收起小张' : '点一下把小张放回桌面';
      txt.textContent = on ? '已显示' : '已收起';
      txt.style.color = on ? '#1565C0' : '#9E9E9E';
      sel.value = st.closeAction || 'ask';
    }

    function fail() {
      txt.textContent = '不可用';
    }

    sw.onclick = function () {
      if (!api) return fail();
      if (sw.disabled) return;
      sw.disabled = true;
      // 不能读 aria-checked：它在 HTML 里写死 false，getSettings 还没回来时
      // 读到的就是"关着"，于是把"收起"做成了"显示"——这就是"点两下才关掉"。
      (last ? Promise.resolve(last) : api.getSettings()).then(function (st) {
        last = st;
        return api.setPetVisible(!st.petVisible);
      }).then(function (st) {
        sw.disabled = false;
        paint(st);
      }).catch(function () {
        sw.disabled = false;
      });
    };

    sel.onchange = function () {
      if (!api) return fail();
      api.setCloseAction(sel.value).then(paint).catch(function () {
        fail();
      });
    };

    if (!api) {
      // 没有桥（浏览器里打开）—— 这一块本来就不该出现，直接撤掉
      row.parentNode && row.parentNode.removeChild(row);
      return;
    }
    var open = document.getElementById('a2-acct-btn');
    if (open) open.addEventListener('click', function () {
      setTimeout(function () {
        api.getSettings().then(paint).catch(function () {});
      }, 0);
    });
    api.getSettings().then(paint).catch(fail);
  }

  build();
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', build);
  } else {
    setTimeout(build, 600);
  }
})();
