/* root@localhost: the unlisted 49th skin. Type the sequence. */
(function () {
  'use strict';
  var SEQ = ['Up', 'Up', 'Down', 'Down', 'Left', 'Right', 'Left', 'Right', 'b', 'a'];
  var KEY = 'deuterium-rl';
  var TITLE = 'deuterium@localhost:~';
  var EPOCH = 1555372800000;
  var root = document.documentElement;
  var baseTitle = document.title;
  var def = (window.__deuteriumTheme && window.__deuteriumTheme.defaultSkin) || '';
  var active = false;
  var skin = '';

  function store(on) {
    try { on ? localStorage.setItem(KEY, '1') : localStorage.removeItem(KEY); } catch (e) {}
  }

  function banner() {
    var days = Math.max(0, Math.floor((Date.now() - EPOCH) / 864e5));
    console.log(
      '                           _        ___      _                              _    _                         _\n' +
      ' _ __     ___      ___    | |_     / _ \\    | |    ___      ___     __ _   | |  | |__      ___     ___    | |_\n' +
      "| '__|   / _ \\    / _ \\   | __|   | | | |   | |   / _ \\    / __|   / _ `|  | |  | '_ \\    / _ \\   / __|   | __|\n" +
      '| |     | (_) |  | (_) |  | |_    | |_| |   | |  | (_) |  | (__   | (_| |  | |  | | | |  | (_) |  \\__ \\   | |_\n' +
      '|_|      \\___/    \\___/    \\__|    \\__,_|   |_|   \\___/    \\___|   \\__,_|  |_|  |_| |_|   \\___/   |___/    \\__|\n' +
      'last login: ' + days + ' days ago on tty1\n' +
      'deuterium@localhost:~$ _'
    );
  }

  function engage() {
    active = true;
    skin = root.dataset.skin || '';
    if (skin) delete root.dataset.skin;
    root.classList.add('rl-root');
    document.title = TITLE;
    store(true);
    banner();
  }

  function release() {
    active = false;
    root.classList.remove('rl-root');
    document.title = baseTitle;
    store(false);
    if (skin && skin !== def && !root.dataset.skin) root.dataset.skin = skin;
  }

  var i = 0;
  document.addEventListener('keydown', function (e) {
    var t = e.target;
    if (t && t.closest && (t.closest('input, textarea, select') || t.isContentEditable)) { i = 0; return; }
    var k = e.key || '';
    if (k.indexOf('Arrow') === 0) k = k.slice(5); else k = k.toLowerCase();
    i = k === SEQ[i] ? i + 1 : (k === SEQ[0] ? 1 : 0);
    if (i === SEQ.length) { i = 0; active ? release() : engage(); }
  });

  /* Picking any real theme retires the session. */
  document.addEventListener('change', function (e) {
    if (active && e.target && e.target.id === 'skin-picker') release();
  });
  var dice = document.querySelector('.skin-dice');
  if (dice) dice.addEventListener('click', function () { if (active) release(); });

  /* Restore a persisted session (no banner on re-entry). */
  var saved = null;
  try { saved = localStorage.getItem(KEY); } catch (e) {}
  if (saved) {
    active = true;
    skin = root.dataset.skin || '';
    if (skin) delete root.dataset.skin;
    root.classList.add('rl-root');
    document.title = TITLE;
  }
})();
