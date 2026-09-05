(function () {
  var wrap = document.querySelector('.site-share');
  if (!wrap) return;
  var btn = wrap.querySelector('.site-share__btn');
  var pop = wrap.querySelector('.site-share__popover');
  var canvas = wrap.querySelector('.site-share__qr');
  var urlEl = wrap.querySelector('.site-share__url');
  var copy = wrap.querySelector('.site-share__copy');
  var libPromise = null;
  var url = '';

  function canonical() {
    var link = document.querySelector('link[rel="canonical"]');
    if (link && link.href) return link.href;
    return location.origin + location.pathname;
  }

  function loadLib() {
    if (!libPromise) {
      libPromise = new Promise(function (resolve, reject) {
        var s = document.createElement('script');
        s.src = '/assets/js/vendor/qrcode.js' + (window.__deuteriumAssetVersion ? '?v=' + window.__deuteriumAssetVersion : '');
        s.onload = resolve;
        s.onerror = reject;
        document.head.appendChild(s);
      });
    }
    return libPromise;
  }

  function draw() {
    var qr = window.qrcode(0, 'M');
    qr.addData(url);
    qr.make();
    var count = qr.getModuleCount();
    var quiet = 4;
    var cells = count + quiet * 2;
    var scale = 12;
    var px = cells * scale;
    canvas.width = px;
    canvas.height = px;
    var ctx = canvas.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, px, px);
    ctx.fillStyle = '#000000';
    for (var r = 0; r < count; r++) {
      for (var c = 0; c < count; c++) {
        if (qr.isDark(r, c)) {
          ctx.fillRect((c + quiet) * scale, (r + quiet) * scale, scale, scale);
        }
      }
    }
  }

  function close() {
    pop.hidden = true;
    btn.setAttribute('aria-expanded', 'false');
  }

  function open() {
    url = canonical();
    urlEl.textContent = url;
    pop.hidden = false;
    btn.setAttribute('aria-expanded', 'true');
    loadLib().then(draw, function () {
      urlEl.textContent = url + ' (QR unavailable)';
    });
  }

  btn.addEventListener('click', function () {
    if (pop.hidden) open(); else close();
  });

  copy.addEventListener('click', function () {
    var done = function () {
      copy.textContent = 'Copied';
      setTimeout(function () { copy.textContent = 'Copy link'; }, 1400);
    };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(url).then(done, done);
    } else {
      done();
    }
  });

  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && !pop.hidden) {
      close();
      btn.focus();
    }
  });

  document.addEventListener('click', function (e) {
    if (!pop.hidden && !wrap.contains(e.target)) close();
  });
})();
