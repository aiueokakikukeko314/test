// DOM interface: loading screen, start / pause menu, in-game HUD, film letterbox and touch stick.
const el = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; };

const ICON = {
  film: '<svg viewBox="0 0 24 24"><path d="M4 5h16v14H4zM8 5v14M16 5v14M4 9h4M4 15h4M16 9h4M16 15h4"/></svg>',
  walk: '<svg viewBox="0 0 24 24"><circle cx="13" cy="4.5" r="1.8"/><path d="M9 21l2.5-6-2-3 1.2-4.5 3.3 1L16 12l3 1M10.7 7.5L7.5 9.5 7 13M13 15l2 6"/></svg>',
  sound: '<svg viewBox="0 0 24 24"><path d="M4 9.5v5h3.5L12 18V6L7.5 9.5zM15.5 9a4 4 0 010 6M18 6.5a7.5 7.5 0 010 11"/></svg>',
  mute: '<svg viewBox="0 0 24 24"><path d="M4 9.5v5h3.5L12 18V6L7.5 9.5zM16 9.5l5 5M21 9.5l-5 5"/></svg>',
  menu: '<svg viewBox="0 0 24 24"><path d="M5 7h14M5 12h14M5 17h14"/></svg>',
  next: '<svg viewBox="0 0 24 24"><path d="M6 6l8 6-8 6zM17 6v12"/></svg>',
};

export function createUI(root, { qualityName, touch }) {
  const handlers = {};
  const on = (name, fn) => { handlers[name] = fn; };
  const emit = (name, ...a) => handlers[name] && handlers[name](...a);

  // ---- fade + letterbox
  const fade = el('div', 'fade'); root.append(fade);
  const barTop = el('div', 'bar top'), barBottom = el('div', 'bar bottom'); root.append(barTop, barBottom);

  // ---- loading
  const loading = el('div', 'screen loading', `
    <div class="brand"><p class="kicker">Morning Forest</p><h1>朝の森と川</h1></div>
    <div class="progress"><i></i></div><p class="status">読み込み中…</p>`);
  root.append(loading);
  const progBar = loading.querySelector('.progress i'), progText = loading.querySelector('.status');

  // ---- menu
  const menu = el('div', 'screen menu hidden', `
    <div class="panel">
      <p class="kicker">Morning Forest</p>
      <h1>朝の森と川</h1>
      <p class="lead">木漏れ日の差す朝の渓流。シカ、キツネ、魚、鳥たちが暮らしています。<br>静かに歩けば、近くで観察できます。</p>
      <div class="actions">
        <button class="primary" data-act="explore">${ICON.walk}<span>森を歩く</span></button>
        <button class="primary ghost" data-act="film">${ICON.film}<span>映像で見る</span></button>
      </div>
      <div class="row"><span class="label">画質</span>
        <div class="seg" role="group" aria-label="画質">
          ${[['low', '低'], ['medium', '中'], ['high', '高'], ['ultra', '最高']].map(([k, n]) => `<button data-q="${k}" class="${k === qualityName ? 'on' : ''}">${n}</button>`).join('')}
        </div>
      </div>
      <dl class="help">
        ${touch
    ? '<div><dt>左側ドラッグ</dt><dd>移動(大きく倒すと走る)</dd></div><div><dt>右側ドラッグ</dt><dd>見回す</dd></div>'
    : '<div><dt>W A S D</dt><dd>移動</dd></div><div><dt>マウス</dt><dd>見回す</dd></div><div><dt>Shift</dt><dd>走る(動物は逃げます)</dd></div><div><dt>C</dt><dd>映像 / 探索の切替</dd></div><div><dt>M / H / Esc</dt><dd>音 / 表示を隠す / メニュー</dd></div>'}
      </dl>
      <p class="note">動きが重いときは画質を下げてください。画質を変えると再読み込みします。</p>
    </div>`);
  root.append(menu);
  menu.addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b) return;
    if (b.dataset.act) emit(b.dataset.act);
    if (b.dataset.q && b.dataset.q !== qualityName) emit('quality', b.dataset.q);
  });

  // ---- HUD
  const hud = el('div', 'hud hidden');
  const btn = (key, icon, title) => { const b = el('button', 'icon', icon); b.title = title; b.setAttribute('aria-label', title); b.addEventListener('click', (e) => { e.stopPropagation(); emit(key); }); return b; };
  const bMode = btn('toggleMode', ICON.film, '映像モード (C)');
  const bNext = btn('nextShot', ICON.next, '次のカット (N)');
  const bSound = btn('toggleSound', ICON.sound, '音 (M)');
  const bMenu = btn('menu', ICON.menu, 'メニュー (Esc)');
  const tools = el('div', 'tools'); tools.append(bNext, bMode, bSound, bMenu);
  const hint = el('p', 'hint', '');
  const toast = el('p', 'toast', '');
  hud.append(tools, hint, toast);
  root.append(hud);

  // ---- touch stick
  const stick = el('div', 'stick hidden', '<i></i>'); root.append(stick);

  let toastTimer = 0;
  return {
    on,
    setProgress(p, text) { progBar.style.width = `${Math.round(p * 100)}%`; if (text) progText.textContent = text; },
    showMenu(show, resume) {
      loading.classList.add('hidden');
      menu.classList.toggle('hidden', !show);
      hud.classList.toggle('hidden', show);
      if (show && resume) menu.querySelector('[data-act="explore"] span').textContent = '森を歩く(再開)';
    },
    setMode(mode) {
      const film = mode === 'film';
      document.body.classList.toggle('film', film);
      bMode.innerHTML = film ? ICON.walk : ICON.film;
      bMode.title = film ? '森を歩く (C)' : '映像モード (C)';
      bNext.classList.toggle('hidden', !film);
      hint.textContent = film ? '' : touch ? '左:移動 右:見回す' : 'クリックで視点操作 ・ WASDで移動 ・ Shiftで走る';
    },
    setHint(text) { hint.textContent = text; },
    setSound(onState) { bSound.innerHTML = onState ? ICON.sound : ICON.mute; },
    setFade(v) { fade.style.opacity = v.toFixed(3); },
    toggleHud() { hud.classList.toggle('quiet'); },
    toast(text, ms = 3200) { toast.textContent = text; toast.classList.add('show'); clearTimeout(toastTimer); toastTimer = setTimeout(() => toast.classList.remove('show'), ms); },
    stick(x, y, dx, dy) {
      if (x == null) { stick.classList.add('hidden'); return; }
      stick.classList.remove('hidden');
      stick.style.left = `${x}px`; stick.style.top = `${y}px`;
      stick.firstElementChild.style.transform = `translate(${dx * 34}px, ${dy * 34}px)`;
    },
    error(msg) { loading.classList.remove('hidden'); progText.textContent = msg; loading.classList.add('failed'); },
  };
}
