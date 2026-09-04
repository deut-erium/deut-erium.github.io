// Name toys: three deterministic outputs from SHA-256 of whatever is typed.
// Loaded only on /names/ through the base layout page.js hook; the guard
// below keeps it a no-op anywhere else. No network, no storage, no random:
// same name in, same tile, melody, and avatar out, every reload.
(() => {
  'use strict';

  const input = document.getElementById('name-input');
  const digestOut = document.getElementById('name-digest');
  const tileCanvas = document.getElementById('names-tile');
  const notesCanvas = document.getElementById('names-notes');
  const waveCanvas = document.getElementById('names-wave');
  const avatarCanvas = document.getElementById('names-avatar');
  const playButton = document.getElementById('names-play');
  if (!input || !digestOut || !tileCanvas || !notesCanvas || !waveCanvas || !avatarCanvas || !playButton) return;

  const TAU = Math.PI * 2;

  /* --------------------------------------------------------------- hash -- */

  const SHA256_K = new Uint32Array([
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
  ]);

  // Sync fallback for contexts where WebCrypto is unavailable (plain http,
  // old engines). Produces the exact FIPS 180-4 digest, so either path gives
  // the same bytes and therefore the same toys.
  function sha256Sync(bytes) {
    const length = bytes.length;
    const bitLength = length * 8;
    const total = Math.ceil((length + 9) / 64) * 64;
    const padded = new Uint8Array(total);
    padded.set(bytes);
    padded[length] = 0x80;
    const view = new DataView(padded.buffer);
    view.setUint32(total - 8, Math.floor(bitLength / 4294967296));
    view.setUint32(total - 4, bitLength % 4294967296);
    const state = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];
    const words = new Uint32Array(64);
    for (let block = 0; block < total; block += 64) {
      for (let i = 0; i < 16; i++) words[i] = view.getUint32(block + i * 4);
      for (let i = 16; i < 64; i++) {
        const x = words[i - 15];
        const y = words[i - 2];
        const s0 = ((x >>> 7) | (x << 25)) ^ ((x >>> 18) | (x << 14)) ^ (x >>> 3);
        const s1 = ((y >>> 17) | (y << 15)) ^ ((y >>> 19) | (y << 13)) ^ (y >>> 10);
        words[i] = (words[i - 16] + s0 + words[i - 7] + s1) >>> 0;
      }
      let a = state[0], b = state[1], c = state[2], d = state[3];
      let e = state[4], f = state[5], g = state[6], h = state[7];
      for (let i = 0; i < 64; i++) {
        const bigS1 = ((e >>> 6) | (e << 26)) ^ ((e >>> 11) | (e << 21)) ^ ((e >>> 25) | (e << 7));
        const choose = (e & f) ^ (~e & g);
        const t1 = (h + bigS1 + choose + SHA256_K[i] + words[i]) >>> 0;
        const bigS0 = ((a >>> 2) | (a << 30)) ^ ((a >>> 13) | (a << 19)) ^ ((a >>> 22) | (a << 10));
        const majority = (a & b) ^ (a & c) ^ (b & c);
        const t2 = (bigS0 + majority) >>> 0;
        h = g; g = f; f = e; e = (d + t1) >>> 0;
        d = c; c = b; b = a; a = (t1 + t2) >>> 0;
      }
      state[0] = (state[0] + a) >>> 0;
      state[1] = (state[1] + b) >>> 0;
      state[2] = (state[2] + c) >>> 0;
      state[3] = (state[3] + d) >>> 0;
      state[4] = (state[4] + e) >>> 0;
      state[5] = (state[5] + f) >>> 0;
      state[6] = (state[6] + g) >>> 0;
      state[7] = (state[7] + h) >>> 0;
    }
    const out = new Uint8Array(32);
    const outView = new DataView(out.buffer);
    state.forEach((value, i) => outView.setUint32(i * 4, value));
    return out;
  }

  function encodeUtf8(text) {
    if (typeof TextEncoder === 'function') return new TextEncoder().encode(text);
    const out = [];
    for (let i = 0; i < text.length; i++) {
      let code = text.charCodeAt(i);
      if (code >= 0xd800 && code <= 0xdbff && i + 1 < text.length) {
        const low = text.charCodeAt(i + 1);
        if (low >= 0xdc00 && low <= 0xdfff) {
          code = 0x10000 + ((code - 0xd800) << 10) + (low - 0xdc00);
          i++;
        }
      }
      if (code < 0x80) out.push(code);
      else if (code < 0x800) out.push(0xc0 | (code >> 6), 0x80 | (code & 63));
      else if (code < 0x10000) out.push(0xe0 | (code >> 12), 0x80 | ((code >> 6) & 63), 0x80 | (code & 63));
      else out.push(0xf0 | (code >> 18), 0x80 | ((code >> 12) & 63), 0x80 | ((code >> 6) & 63), 0x80 | (code & 63));
    }
    return Uint8Array.from(out);
  }

  let requestToken = 0;

  async function digestOf(name) {
    const bytes = encodeUtf8(name);
    const subtle = typeof crypto === 'object' && crypto && crypto.subtle;
    if (subtle) return new Uint8Array(await subtle.digest('SHA-256', bytes));
    return sha256Sync(bytes);
  }

  /* ----------------------------------------------------------- palette -- */

  // Every canvas paints its own ground at ~9% lightness, and the shape bands
  // sit on fixed lightness rungs well above it, so the toys stay readable on
  // any skin or dark mode without reading CSS variables into the canvas.
  function palette(bytes) {
    const hue = (bytes[0] * 360) / 256;
    const secondHue = (hue + 30 + bytes[1] % 91) % 360;
    return {
      hue,
      ground: hsl(hue, 30, 9),
      guide: hsl(hue, 20, 26),
      bandDeep: hsl(hue, 66, 38),
      bandMid: hsl(hue, 60, 56),
      bandHigh: hsl(secondHue, 58, 76),
      gutter: hsl(hue, 24, 92),
      avatarGround: hsl(hue, 44, 90),
      avatarInk: hsl(hue, 60, 33),
      avatarAccent: hsl(secondHue, 58, 54),
    };
  }

  function hsl(hue, saturation, lightness) {
    return 'hsl(' + hue.toFixed(3) + ' ' + saturation + '% ' + lightness + '%)';
  }

  function hex(bytes, count) {
    let out = '';
    for (let i = 0; i < count; i++) out += bytes[i].toString(16).padStart(2, '0');
    return out;
  }

  /* ------------------------------------------------------------- paint -- */

  // Backing store scales with the device pixel ratio (capped at 2) while all
  // drawing math stays in the canvas's declared coordinate space.
  function context2d(canvas) {
    const width = Number(canvas.getAttribute('width'));
    const height = Number(canvas.getAttribute('height'));
    const ratio = Math.min(2, window.devicePixelRatio || 1);
    if (ratio > 1 && !canvas.dataset.scaled) {
      canvas.width = Math.round(width * ratio);
      canvas.height = Math.round(height * ratio);
      canvas.dataset.scaled = '1';
      canvas.style.aspectRatio = width + ' / ' + height;
    }
    const ctx = canvas.getContext('2d');
    ctx.setTransform(canvas.width / width, 0, 0, canvas.height / height, 0, 0);
    return { ctx, width, height };
  }

  function annularSector(ctx, cx, cy, inner, outer, start, end) {
    ctx.beginPath();
    ctx.arc(cx, cy, outer, start, end);
    ctx.arc(cx, cy, inner, end, start, true);
    ctx.closePath();
  }

  function spineTriangle(ctx, cx, cy, baseRadius, angle, apexRadius, halfSpan) {
    ctx.beginPath();
    ctx.moveTo(cx + Math.cos(angle - halfSpan) * baseRadius, cy + Math.sin(angle - halfSpan) * baseRadius);
    ctx.lineTo(cx + Math.cos(angle) * apexRadius, cy + Math.sin(angle) * apexRadius);
    ctx.lineTo(cx + Math.cos(angle + halfSpan) * baseRadius, cy + Math.sin(angle + halfSpan) * baseRadius);
    ctx.closePath();
  }

  // Circle-limit-inspired tile: concentric annular rings of arcs and inward
  // triangles, segment counts growing toward the rim the way figures crowd
  // the boundary circle in Escher's prints. Ring counts are multiples of
  // eight, so a quarter turn (count/4 segments, always even) maps every
  // color, gap, and triangle onto its twin: strict 4-fold symmetry.
  function drawTile(bytes) {
    const { ctx, width } = context2d(tileCanvas);
    const pal = palette(bytes);
    const center = width / 2;
    const maxRadius = width / 2;
    const lineWidth = Math.max(2, width / 200);

    ctx.clearRect(0, 0, width, width);
    ctx.fillStyle = pal.ground;
    ctx.beginPath();
    ctx.arc(center, center, maxRadius, 0, TAU);
    ctx.fill();

    const flip = bytes[2] % 2;
    const rings = [
      { inner: 0.18, outer: 0.40, count: 8 },
      { inner: 0.40, outer: 0.62, count: 16 },
      { inner: 0.62, outer: 0.84, count: 24 },
      { inner: 0.84, outer: 1.00, count: 32 },
    ];
    ctx.lineWidth = lineWidth;
    ctx.lineJoin = 'round';
    rings.forEach((ring, ringIndex) => {
      const inner = ring.inner * maxRadius;
      const outer = ring.outer * maxRadius;
      const segment = TAU / ring.count;
      const gap = segment * 0.045;
      for (let i = 0; i < ring.count; i++) {
        const start = i * segment - Math.PI / 2 + gap;
        const end = (i + 1) * segment - Math.PI / 2 - gap;
        const tone = (i + ringIndex + flip) % 2;
        ctx.fillStyle = tone ? pal.bandMid : pal.bandDeep;
        annularSector(ctx, center, center, inner, outer, start, end);
        ctx.fill();
        ctx.strokeStyle = pal.gutter;
        ctx.stroke();
        if ((i + ringIndex) % 2 === 0 && ring.count >= 16) {
          const middle = (start + end) / 2;
          ctx.fillStyle = tone ? pal.bandDeep : pal.bandHigh;
          spineTriangle(ctx, center, center, outer - lineWidth * 1.5, middle, inner + (outer - inner) * 0.22, segment * 0.28);
          ctx.fill();
          ctx.stroke();
        }
      }
    });

    const motifRadius = 0.18 * maxRadius;
    ctx.fillStyle = pal.bandHigh;
    ctx.lineWidth = lineWidth;
    const motif = bytes[3] % 3;
    if (motif === 0) {
      ctx.beginPath();
      ctx.moveTo(center, center - motifRadius);
      ctx.lineTo(center + motifRadius, center);
      ctx.lineTo(center, center + motifRadius);
      ctx.lineTo(center - motifRadius, center);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    } else if (motif === 1) {
      for (let quarter = 0; quarter < 4; quarter++) {
        const angle = quarter * (TAU / 4) + Math.PI / 4;
        ctx.beginPath();
        ctx.ellipse(
          center + Math.cos(angle) * motifRadius * 0.55,
          center + Math.sin(angle) * motifRadius * 0.55,
          motifRadius * 0.52,
          motifRadius * 0.30,
          angle,
          0,
          TAU,
        );
        ctx.fill();
        ctx.stroke();
      }
    } else {
      [1, 0.55].forEach((scale) => {
        const size = motifRadius * scale;
        ctx.save();
        ctx.translate(center, center);
        ctx.rotate(Math.PI / 4);
        ctx.beginPath();
        ctx.rect(-size, -size, size * 2, size * 2);
        ctx.fill();
        ctx.stroke();
        ctx.restore();
      });
    }

    ctx.beginPath();
    ctx.arc(center, center, maxRadius - lineWidth, 0, TAU);
    ctx.strokeStyle = pal.gutter;
    ctx.stroke();
  }

  /* ------------------------------------------------------------ melody -- */

  const SCALE = [0, 2, 4, 7, 9]; // major pentatonic, semitone offsets
  const NOTE_COUNT = 16;
  const STEP_SECONDS = 0.22;
  const ROOT_FREQUENCY = 220; // A3

  function melody(bytes) {
    const notes = [];
    for (let i = 0; i < NOTE_COUNT; i++) {
      const value = bytes[16 + i];
      const degree = value % SCALE.length;
      const octave = (value >> 3) & 1;
      const semitone = SCALE[degree] + octave * 12;
      notes.push({ degree, octave, semitone, frequency: ROOT_FREQUENCY * Math.pow(2, semitone / 12) });
    }
    return notes;
  }

  function drawNotes(bytes) {
    const { ctx, width, height } = context2d(notesCanvas);
    const pal = palette(bytes);
    const notes = melody(bytes);
    ctx.fillStyle = pal.ground;
    ctx.fillRect(0, 0, width, height);

    const rows = SCALE.length * 2;
    const pad = width / 64;
    const cellWidth = (width - pad * 2) / NOTE_COUNT;
    const cellHeight = (height - pad * 2) / rows;
    ctx.strokeStyle = pal.guide;
    ctx.lineWidth = 1;
    for (let row = 0; row <= rows; row++) {
      const y = pad + row * cellHeight;
      ctx.beginPath();
      ctx.moveTo(pad, y);
      ctx.lineTo(width - pad, y);
      ctx.stroke();
    }
    notes.forEach((note, index) => {
      const row = rows - 1 - (note.octave * SCALE.length + note.degree);
      ctx.fillStyle = note.octave ? pal.bandHigh : pal.bandMid;
      ctx.fillRect(
        pad + index * cellWidth + cellWidth * 0.16,
        pad + row * cellHeight + cellHeight * 0.16,
        cellWidth * 0.68,
        cellHeight * 0.68,
      );
    });
  }

  function drawWave(bytes, samples) {
    const { ctx, width, height } = context2d(waveCanvas);
    const pal = palette(bytes);
    ctx.fillStyle = pal.ground;
    ctx.fillRect(0, 0, width, height);
    const middle = height / 2;
    ctx.strokeStyle = pal.guide;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, middle);
    ctx.lineTo(width, middle);
    ctx.stroke();
    if (!samples) return;
    ctx.strokeStyle = pal.bandHigh;
    ctx.lineWidth = 2;
    ctx.beginPath();
    for (let i = 0; i < samples.length; i++) {
      const x = (i / (samples.length - 1)) * width;
      const y = middle + ((samples[i] - 128) / 128) * (height / 2 - 2);
      if (i) ctx.lineTo(x, y);
      else ctx.moveTo(x, y);
    }
    ctx.stroke();
  }

  /* ------------------------------------------------------------ avatar -- */

  // Five-by-five grid, mirrored left to right like GitHub identicons: only
  // three columns come from the hash, the right two echo the left. Each cell
  // folds two digest bytes so the grid depends on the whole hash (the digest
  // is 32 bytes and 15 cells would otherwise run off the end). Fixed
  // lightness rungs on a light ground keep it legible on any skin.
  function avatarGrid(bytes) {
    const grid = [];
    for (let row = 0; row < 5; row++) {
      const cells = [0, 0, 0, 0, 0];
      for (let column = 0; column < 3; column++) {
        const index = row * 3 + column;
        const value = bytes[index * 2] ^ bytes[index * 2 + 1];
        const state = value % 5 === 0 ? 0 : value % 7 === 0 ? 2 : 1;
        cells[column] = state;
        cells[4 - column] = state;
      }
      grid.push(cells);
    }
    return grid;
  }

  function drawAvatar(bytes) {
    const { ctx, width } = context2d(avatarCanvas);
    const pal = palette(bytes);
    const cell = width / 5;
    ctx.fillStyle = pal.avatarGround;
    ctx.fillRect(0, 0, width, width);
    avatarGrid(bytes).forEach((row, rowIndex) => {
      row.forEach((state, columnIndex) => {
        if (!state) return;
        ctx.fillStyle = state === 2 ? pal.avatarAccent : pal.avatarInk;
        ctx.fillRect(columnIndex * cell, rowIndex * cell, cell, cell);
      });
    });
  }

  /* ------------------------------------------------------------- wiring -- */

  let lastBytes = new Uint8Array(32);

  async function render(name) {
    const token = ++requestToken;
    const bytes = await digestOf(name);
    if (token !== requestToken) return;
    lastBytes = bytes;
    drawTile(bytes);
    drawNotes(bytes);
    drawAvatar(bytes);
    drawWave(bytes, null);
    digestOut.textContent = 'sha256 digest ' + hex(bytes, 12) + ' — ' + NOTE_COUNT + ' notes, 3 palette hues, 15 hashed pixels';
  }

  let audioContext = null;
  let playToken = 0;

  // Audio exists only behind this click handler: nothing autoplays, and the
  // AudioContext is created (or resumed) strictly on request.
  playButton.addEventListener('click', () => {
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext) {
      playButton.textContent = 'no WebAudio here';
      playButton.disabled = true;
      return;
    }
    if (!audioContext) audioContext = new AudioContext();
    if (audioContext.state === 'suspended') audioContext.resume();
    const bytes = lastBytes;
    const notes = melody(bytes);
    const start = audioContext.currentTime + 0.06;
    const master = audioContext.createGain();
    master.gain.value = 0.55;
    const analyser = audioContext.createAnalyser();
    analyser.fftSize = 1024;
    master.connect(analyser);
    analyser.connect(audioContext.destination);
    notes.forEach((note, index) => {
      const at = start + index * STEP_SECONDS;
      const oscillator = audioContext.createOscillator();
      oscillator.type = 'square';
      oscillator.frequency.value = note.frequency;
      const gain = audioContext.createGain();
      gain.gain.setValueAtTime(0.0001, at);
      gain.gain.exponentialRampToValueAtTime(0.14, at + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, at + STEP_SECONDS * 0.92);
      oscillator.connect(gain);
      gain.connect(master);
      oscillator.start(at);
      oscillator.stop(at + STEP_SECONDS);
    });

    const token = ++playToken;
    const samples = new Uint8Array(analyser.frequencyBinCount);
    const totalSeconds = notes.length * STEP_SECONDS;
    const finish = () => {
      if (token !== playToken) return;
      analyser.getByteTimeDomainData(samples);
      drawWave(bytes, samples);
      playButton.disabled = false;
    };
    playButton.disabled = true;
    if (window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches) {
      // Respect reduced motion: one captured frame instead of a running scope.
      setTimeout(finish, totalSeconds * 1000);
      return;
    }
    const sweep = () => {
      if (token !== playToken) return;
      analyser.getByteTimeDomainData(samples);
      drawWave(bytes, samples);
      if (audioContext.currentTime < start + totalSeconds) requestAnimationFrame(sweep);
      else finish();
    };
    requestAnimationFrame(sweep);
  });

  const refresh = () => {
    render(input.value);
  };
  input.addEventListener('input', refresh);
  refresh();
})();
