/* Polynomial interpolation panel, ported from osec.io's
 * PolynomialInterpolationPanel.vue (Vue SFC) to a dependency-free custom
 * element: toy circuit over the reals, wire sliders, interpolated witness /
 * constraint polynomials, quotient plot and series toggles.
 *
 * Requires: window.OSEC_WIDGET_MATH (widget-math.js) and katex.min.css.
 */
(() => {
  'use strict';

  const M = () => window.OSEC_WIDGET_MATH || {};

  const X_INTERP_NEG = -1;
  const X_INTERP_POS = 1;
  const X_MIN = -2;
  const X_MAX = 2;
  const Y_MIN = -40;
  const Y_MAX = 40;
  const WIRE_MIN = -12;
  const WIRE_MAX = 12;
  const WIRE_STEP = 0.5;
  const PLOT_WIDTH = 760;
  const PLOT_HEIGHT = 360;
  const SAMPLE_COUNT = 360;
  const SINGULARITY_GAP = 0.015;
  const EPS = 1e-9;

  const el = (tag, className, html) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (html != null) node.innerHTML = html;
    return node;
  };
  const svgEl = (tag, attrs) => {
    const node = document.createElementNS('http://www.w3.org/2000/svg', tag);
    for (const [k, v] of Object.entries(attrs || {})) node.setAttribute(k, v);
    return node;
  };

  const clamp = (v, min, max) => (Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : 0);
  const roundToOneDecimal = (v) => {
    const r = Math.round(v * 10) / 10;
    return Math.abs(r) < EPS ? 0 : r;
  };
  const cleanNearZero = (v) => (Math.abs(v) < EPS ? 0 : v);
  const normalizeOneDecimal = (v, min, max) => roundToOneDecimal(clamp(v, min, max));
  const snapToStep = (v, step) => (Number.isFinite(v) && step > 0 ? Math.round(v / step) * step : v);
  const formatNumber = (v) => {
    const r = Math.round(v * 1000) / 1000;
    if (Math.abs(r) < EPS) return '0';
    return r.toFixed(3).replace(/\.0+$/, '').replace(/(\.\d*?)0+$/, '$1');
  };

  /* ---------- real-coefficient polynomials (degree-first) ---------- */
  const trimLeadingZeros = (coeffs) => {
    const result = coeffs.map(cleanNearZero);
    while (result.length > 1 && Math.abs(result[0]) < EPS) result.shift();
    return result;
  };
  const addPoly = (a, b) => {
    const len = Math.max(a.length, b.length);
    const out = Array.from({ length: len }, (_, i) => {
      const ai = a[a.length - len + i] ?? 0;
      const bi = b[b.length - len + i] ?? 0;
      return cleanNearZero(ai + bi);
    });
    return trimLeadingZeros(out);
  };
  const mulPoly = (a, b) => {
    const out = new Array(a.length + b.length - 1).fill(0);
    for (let i = 0; i < a.length; i += 1) {
      for (let j = 0; j < b.length; j += 1) out[i + j] += a[i] * b[j];
    }
    return trimLeadingZeros(out.map(cleanNearZero));
  };
  const evalPoly = (coeffs, x) => {
    let y = 0;
    for (let i = 0; i < coeffs.length; i += 1) y = y * x + coeffs[i];
    return cleanNearZero(y);
  };
  const dividePoly = (dividend, divisor) => {
    const a = trimLeadingZeros([...dividend]);
    const b = trimLeadingZeros([...divisor]);
    if (b.length === 1 && Math.abs(b[0]) < EPS) return { quotient: [0], remainder: a };
    if (a.length < b.length) return { quotient: [0], remainder: a };
    const quotientLength = a.length - b.length + 1;
    const quotient = new Array(quotientLength).fill(0);
    const remainder = [...a];
    for (let i = 0; i < quotientLength; i += 1) {
      const leadFactor = remainder[i] / b[0];
      quotient[i] = cleanNearZero(leadFactor);
      for (let j = 0; j < b.length; j += 1) {
        remainder[i + j] = cleanNearZero(remainder[i + j] - leadFactor * b[j]);
      }
    }
    const rem = trimLeadingZeros(remainder.slice(quotientLength));
    return { quotient: trimLeadingZeros(quotient), remainder: rem.length === 0 ? [0] : rem };
  };
  const interpolateAtNeg1AndPos1 = (vNeg, vPos) => {
    const slope = cleanNearZero((vPos - vNeg) / 2);
    const intercept = cleanNearZero((vPos + vNeg) / 2);
    return trimLeadingZeros([slope, intercept]);
  };

  // Degree-first coefficients -> HTML term markup (mirror of polynomialToLatex).
  const num = (v) => `<span class="ow-mn">${v}</span>`;
  const sign = (s) => `<span class="ow-mo">${s}</span>`;
  const polyBodyHtml = (coeffs) => {
    const terms = [];
    for (let idx = 0; idx < coeffs.length; idx += 1) {
      const c = cleanNearZero(coeffs[idx]);
      if (Math.abs(c) < EPS) continue;
      const degree = coeffs.length - 1 - idx;
      const abs = Math.abs(c);
      let body;
      if (degree === 0) body = num(formatNumber(abs));
      else if (degree === 1) body = Math.abs(abs - 1) < EPS ? '<span class="ow-mv">x</span>' : `${num(formatNumber(abs))}<span class="ow-mv">x</span>`;
      else body = Math.abs(abs - 1) < EPS ? `<span class="ow-mv">x</span><sup class="ow-mexp">${degree}</sup>` : `${num(formatNumber(abs))}<span class="ow-mv">x</span><sup class="ow-mexp">${degree}</sup>`;

      if (terms.length === 0) terms.push(c < 0 ? sign('&minus;') + body : body);
      else terms.push(c < 0 ? sign('&minus;') + body : sign('+') + body);
    }
    return terms.length > 0 ? terms.join(' ') : num(0);
  };

  const toPlotX = (x) => ((x - X_MIN) / (X_MAX - X_MIN)) * PLOT_WIDTH;
  const toPlotY = (y) => PLOT_HEIGHT - ((y - Y_MIN) / (Y_MAX - Y_MIN)) * PLOT_HEIGHT;

  const buildCurvePath = (fn) => {
    let path = '';
    let hasSegment = false;
    for (let i = 0; i <= SAMPLE_COUNT; i += 1) {
      const t = i / SAMPLE_COUNT;
      const x = X_MIN + (X_MAX - X_MIN) * t;
      const y = fn(x);
      if (y === null || !Number.isFinite(y)) {
        hasSegment = false;
        continue;
      }
      path += `${hasSegment ? 'L' : 'M'}${toPlotX(x)} ${toPlotY(y)} `;
      hasSegment = true;
    }
    return path.trim();
  };

  const MINI_WIRES = [
    { id: 'a_to_add1', path: 'M 80 46 L 248 46 L 248 58', value: (w) => w.x, labelX: 168, labelY: 36, className: 'poly-panel__mini-wire--input', labelClassName: 'poly-panel__mini-wire-label--input' },
    { id: 'b_to_add1', path: 'M 80 106 L 184 106 L 184 78 L 220 78', value: (w) => w.y, labelX: 156, labelY: 98, className: 'poly-panel__mini-wire--input', labelClassName: 'poly-panel__mini-wire-label--input' },
    { id: 'add1_to_add2', path: 'M 276 78 L 428 78 L 428 88', value: (w) => w.s, labelX: 352, labelY: 68, className: 'poly-panel__mini-wire--op', labelClassName: 'poly-panel__mini-wire-label--op' },
    { id: 'c_to_add2', path: 'M 80 166 L 360 166 L 360 108 L 400 108', value: (w) => w.z, labelX: 312, labelY: 156, className: 'poly-panel__mini-wire--input', labelClassName: 'poly-panel__mini-wire-label--input' },
    { id: 'sum_to_zero', path: 'M 456 108 L 600 108', value: (w) => w.t, labelX: 528, labelY: 98, className: 'poly-panel__mini-wire--out', labelClassName: 'poly-panel__mini-wire-label--out' },
  ];

  const Q_M = [0.5, 0.5];
  const Q_L = [-0.5, 0.5];
  const Q_R = [-1, 1];
  const Q_O = [0.5, -0.5];
  const Q_C = [0];
  const POLY_Z = [1, 0, -1];

  class PolyInterpolationPanel extends HTMLElement {
    connectedCallback() {
      if (this._init) return;
      this._init = true;
      this.replaceChildren(); // drop the no-JS fallback markup
      const math = M();
      this._math = math;

      this._wires = { x: 2, y: -5, z: 3, s: 0, t: 0 };
      this._series = { A: true, B: true, O: true, F: true, Q: true };
      this._activeGate = null;
      this._recomputeDerived();

      const root = el('section', 'poly-panel');
      root.appendChild(el('h3', 'poly-panel__title', 'Interactive Polynomial Interpolation'));
      root.appendChild(this._buildMiniCircuit());

      const desc = el('div', 'poly-panel__description');
      desc.innerHTML =
        `<p>This is the same row-to-polynomial step as above, but over the reals on ` +
        `<span class="poly-panel__inline-math">${math['poly.roots']}</span>.</p>` +
        `<p>The selector rows interpolate to <span class="poly-panel__inline-math">${math['poly.selectorPolys']}</span>.</p>` +
        `<p>Move <span class="poly-panel__inline-math">${math['poly.inputs']}</span>. The point is to see when ` +
        `<span class="poly-panel__inline-math">${math['poly.xyzCondition']}</span>, we get ` +
        `<span class="poly-panel__inline-math">${math['poly.rootChecks']}</span>, so ` +
        `<span class="poly-panel__inline-math">${math['poly.zPoly']}</span> divides ` +
        `<span class="poly-panel__inline-math">${math['poly.f']}</span>.</p>`;
      root.appendChild(desc);

      root.appendChild(this._buildControls());
      this._equationsBox = el('div', 'poly-panel__equations');
      root.appendChild(this._equationsBox);
      root.appendChild(this._buildPlot());
      root.appendChild(this._buildLegend());

      this.appendChild(root);
      this._update();
    }

    _recomputeDerived() {
      const w = this._wires;
      w.s = roundToOneDecimal(w.x + 2 * w.y);
      w.t = roundToOneDecimal(w.s * w.z);
    }

    _polys() {
      const w = this._wires;
      const A = interpolateAtNeg1AndPos1(w.x, w.s);
      const B = interpolateAtNeg1AndPos1(w.y, w.z);
      const O = interpolateAtNeg1AndPos1(w.s, w.t);
      const F = trimLeadingZeros(
        addPoly(
          addPoly(addPoly(addPoly(mulPoly(mulPoly(Q_M, A), B), mulPoly(Q_L, A)), mulPoly(Q_R, B)), mulPoly(Q_O, O)),
          Q_C,
        ),
      );
      const division = dividePoly(F, POLY_Z);
      const zDividesF = division.remainder.every((v) => Math.abs(v) < EPS);
      return { A, B, O, F, Q: division.quotient, zDividesF };
    }

    _buildMiniCircuit() {
      const math = this._math;
      const box = el('div', 'poly-panel__mini-circuit');
      box.appendChild(el('h4', 'poly-panel__mini-title',
        `Toy circuit <span class="poly-panel__inline-math">${math['poly.goal']}</span>`));

      const wrap = el('div', 'poly-panel__mini-svg-wrap');
      wrap.tabIndex = 0;
      wrap.setAttribute('role', 'region');
      wrap.setAttribute('aria-label', 'Toy interpolation circuit, scroll horizontally to inspect');
      const svg = svgEl('svg', { class: 'poly-panel__mini-svg', viewBox: '0 0 680 210', role: 'img', 'aria-label': 'Toy interpolation circuit' });
      const defs = svgEl('defs');
      defs.innerHTML = `<marker id="mini-arrow-head" markerWidth="6" markerHeight="5" refX="6" refY="2.5" orient="auto" markerUnits="strokeWidth"><polygon points="0 0, 8 3, 0 6" fill="context-stroke"></polygon></marker>`;
      svg.appendChild(defs);

      this._miniWireEls = {};
      this._miniLabelEls = {};
      for (const wire of MINI_WIRES) {
        const path = svgEl('path', { d: wire.path, class: `poly-panel__mini-wire ${wire.className}`, 'marker-end': 'url(#mini-arrow-head)' });
        this._miniWireEls[wire.id] = path;
        svg.appendChild(path);
        const label = svgEl('text', { x: wire.labelX, y: wire.labelY, class: `poly-panel__mini-wire-label ${wire.labelClassName}`, 'text-anchor': 'middle' });
        this._miniLabelEls[wire.id] = label;
        svg.appendChild(label);
      }

      const node = (x, y, w, h, cls, textCls, symbol) => {
        svg.appendChild(svgEl('rect', { x, y, width: w, height: h, rx: 10, class: `poly-panel__mini-node ${cls}` }));
        const t = svgEl('text', { x: x + w / 2, y: y + h / 2 + 5, class: `poly-panel__mini-node-text ${textCls}`, 'text-anchor': 'middle' });
        t.textContent = symbol;
        svg.appendChild(t);
      };
      node(24, 28, 56, 36, 'poly-panel__mini-node--input', 'poly-panel__mini-node-text--input', 'x');
      node(24, 88, 56, 36, 'poly-panel__mini-node--input', 'poly-panel__mini-node-text--input', 'y');
      node(24, 148, 56, 36, 'poly-panel__mini-node--input', 'poly-panel__mini-node-text--input', 'z');

      this._miniGateEls = {};
      for (const [gateId, x, y, cls, textCls, symbol] of [
        ['lin_xy', 220, 58, 'poly-panel__mini-node--constraint', 'poly-panel__mini-node-text--constraint', '+'],
        ['mul_sz', 400, 88, 'poly-panel__mini-node--mul', 'poly-panel__mini-node-text--mul', '×'],
      ]) {
        const g = svgEl('g', { class: 'poly-panel__mini-gate-group' });
        g.appendChild(svgEl('rect', { x, y, width: 56, height: 40, rx: 10, class: `poly-panel__mini-node ${cls}` }));
        const t = svgEl('text', { x: x + 28, y: y + 25, class: `poly-panel__mini-node-text ${textCls}`, 'text-anchor': 'middle' });
        t.textContent = symbol;
        g.appendChild(t);
        g.addEventListener('mouseenter', () => this._setActiveGate(gateId));
        g.addEventListener('mouseleave', () => this._setActiveGate(null));
        this._miniGateEls[gateId] = g;
        svg.appendChild(g);
      }

      node(600, 88, 46, 40, 'poly-panel__mini-node--out', 'poly-panel__mini-node-text--out', '0');
      wrap.appendChild(svg);
      box.appendChild(wrap);

      const tableWrap = el('div', 'poly-panel__mini-table-wrap');
      const table = el('table', 'poly-panel__mini-table');
      table.setAttribute('aria-label', 'Mini circuit constraint table');
      table.innerHTML =
        `<thead><tr><th>${math['poly.h.gate']}</th><th>${math['poly.h.qM']}</th><th>${math['poly.h.qL']}</th>` +
        `<th>${math['poly.h.qR']}</th><th>${math['poly.h.qO']}</th><th>${math['poly.h.qC']}</th></tr></thead>`;
      const tbody = el('tbody');
      this._miniRowEls = {};
      for (const row of [
        { id: 'lin_xy', labelKey: 'poly.row.lin_xy', qM: 0, qL: 1, qR: 2, qO: -1, qC: 0 },
        { id: 'mul_sz', labelKey: 'poly.row.mul_sz', qM: 1, qL: 0, qR: 0, qO: 0, qC: 0 },
      ]) {
        const tr = el('tr', 'poly-panel__mini-row');
        tr.innerHTML = `<td>${math[row.labelKey]}</td><td>${row.qM}</td><td>${row.qL}</td><td>${row.qR}</td><td>${row.qO}</td><td>${row.qC}</td>`;
        tr.addEventListener('mouseenter', () => this._setActiveGate(row.id));
        tr.addEventListener('mouseleave', () => this._setActiveGate(null));
        this._miniRowEls[row.id] = tr;
        tbody.appendChild(tr);
      }
      table.appendChild(tbody);
      tableWrap.appendChild(table);
      box.appendChild(tableWrap);
      return box;
    }

    _setActiveGate(id) {
      this._activeGate = id;
      for (const [gateId, g] of Object.entries(this._miniGateEls)) {
        g.classList.toggle('poly-panel__mini-gate-group--active', gateId === id);
      }
      for (const [rowId, tr] of Object.entries(this._miniRowEls)) {
        tr.className = `poly-panel__mini-row${rowId === id ? ' poly-panel__mini-row--active' : ''}`;
      }
    }

    _buildControls() {
      const math = this._math;
      const group = el('div', 'poly-panel__control-group poly-panel__control-group--wires');
      group.appendChild(el('h4', 'poly-panel__group-title', 'Move x, y, z'));
      this._controlValueEls = {};
      for (const [id, labelKey] of [['x', 'poly.ctl.x'], ['y', 'poly.ctl.y'], ['z', 'poly.ctl.z']]) {
        const label = el('label', 'poly-panel__control');
        label.appendChild(el('span', 'poly-panel__label', math[labelKey]));
        const slider = document.createElement('input');
        slider.type = 'range';
        slider.className = 'poly-panel__slider poly-panel__slider--wire';
        slider.min = WIRE_MIN; slider.max = WIRE_MAX; slider.step = WIRE_STEP;
        slider.value = this._wires[id];
        slider.setAttribute('aria-label', `${id} wire value`);
        const number = document.createElement('input');
        number.type = 'number';
        number.className = 'poly-panel__number poly-panel__number--wire';
        number.min = WIRE_MIN; number.max = WIRE_MAX; number.step = WIRE_STEP;
        number.value = this._wires[id];
        number.setAttribute('aria-label', `${id} wire value`);
        const apply = (raw) => {
          this._wires[id] = normalizeOneDecimal(snapToStep(Number(raw), WIRE_STEP), WIRE_MIN, WIRE_MAX);
          this._recomputeDerived();
          slider.value = this._wires[id];
          number.value = this._wires[id];
          this._update();
        };
        slider.addEventListener('input', () => apply(slider.value));
        // Preserve partial signs/decimals while typing; sliders still update live.
        number.addEventListener('change', () => apply(number.value));
        number.addEventListener('blur', () => apply(number.value));
        label.append(slider, number);
        group.appendChild(label);
      }
      return group;
    }

    _buildPlot() {
      const wrap = el('div', 'poly-panel__plot-wrap');
      const svg = svgEl('svg', { class: 'poly-panel__plot', viewBox: `0 0 ${PLOT_WIDTH} ${PLOT_HEIGHT}`, role: 'img', 'aria-label': 'Interpolated witness and quotient polynomials' });
      svg.appendChild(svgEl('rect', { class: 'poly-panel__plot-bg', width: PLOT_WIDTH, height: PLOT_HEIGHT }));

      for (let x = Math.ceil(X_MIN); x <= Math.floor(X_MAX); x += 1) {
        svg.appendChild(svgEl('line', { x1: toPlotX(x), x2: toPlotX(x), y1: 0, y2: PLOT_HEIGHT, class: 'poly-panel__grid' }));
      }
      for (let y = Math.ceil(Y_MIN / 4) * 4; y <= Math.floor(Y_MAX / 4) * 4; y += 4) {
        svg.appendChild(svgEl('line', { x1: 0, x2: PLOT_WIDTH, y1: toPlotY(y), y2: toPlotY(y), class: 'poly-panel__grid' }));
      }
      svg.appendChild(svgEl('line', { x1: 0, x2: PLOT_WIDTH, y1: toPlotY(0), y2: toPlotY(0), class: 'poly-panel__axis' }));
      svg.appendChild(svgEl('line', { x1: toPlotX(0), x2: toPlotX(0), y1: 0, y2: PLOT_HEIGHT, class: 'poly-panel__axis' }));

      this._curveEls = {};
      this._pointEls = {};
      for (const key of ['A', 'B', 'O', 'F', 'Q']) {
        this._curveEls[key] = svgEl('path', { class: `poly-panel__curve poly-panel__curve--${key.toLowerCase()}` });
        svg.appendChild(this._curveEls[key]);
      }
      for (const key of ['A', 'B', 'O', 'F', 'Q']) {
        const g1 = svgEl('circle', { cx: 0, cy: 0, r: 3.8, class: `poly-panel__point poly-panel__point--${key.toLowerCase()}` });
        const g2 = svgEl('circle', { cx: 0, cy: 0, r: 3.8, class: `poly-panel__point poly-panel__point--${key.toLowerCase()}` });
        this._pointEls[key] = [g1, g2];
        svg.appendChild(g1);
        svg.appendChild(g2);
      }
      wrap.appendChild(svg);
      return wrap;
    }

    _buildLegend() {
      const legend = el('div', 'poly-panel__legend');
      legend.setAttribute('aria-label', 'Plot legend');
      this._legendEls = {};
      const names = { A: 'A(x)', B: 'B(x)', O: 'O(x)', F: 'F(x)', Q: 'F(x)/Z(x)' };
      for (const key of ['A', 'B', 'O', 'F', 'Q']) {
        const item = el('button', 'poly-panel__legend-item',
          `<i class="poly-panel__legend-swatch poly-panel__legend-swatch--${key.toLowerCase()}"></i>${names[key]}`);
        item.type = 'button';
        item.addEventListener('click', () => {
          this._series[key] = !this._series[key];
          this._applySeriesVisibility();
        });
        this._legendEls[key] = item;
        legend.appendChild(item);
      }
      return legend;
    }

    _applySeriesVisibility() {
      for (const [key, curve] of Object.entries(this._curveEls)) {
        curve.classList.toggle('poly-panel__curve--muted', !this._series[key]);
      }
      for (const [key, points] of Object.entries(this._pointEls)) {
        for (const p of points) p.classList.toggle('poly-panel__point--muted', !this._series[key]);
      }
      for (const [key, item] of Object.entries(this._legendEls)) {
        item.classList.toggle('poly-panel__legend-item--muted', !this._series[key]);
      }
      for (const item of this._equationsBox.children) {
        const key = item.dataset.seriesKey;
        if (key) item.classList.toggle('poly-panel__equation--muted', !this._series[key]);
      }
    }

    _update() {
      const w = this._wires;
      for (const wire of MINI_WIRES) {
        this._miniLabelEls[wire.id].textContent = formatNumber(wire.value(w));
      }

      const { A, B, O, F, Q, zDividesF } = this._polys();

      this._curveEls.A.setAttribute('d', buildCurvePath((x) => evalPoly(A, x)));
      this._curveEls.B.setAttribute('d', buildCurvePath((x) => evalPoly(B, x)));
      this._curveEls.O.setAttribute('d', buildCurvePath((x) => evalPoly(O, x)));
      this._curveEls.F.setAttribute('d', buildCurvePath((x) => evalPoly(F, x)));
      const fOverZAt = (x) => {
        if (zDividesF) return evalPoly(Q, x);
        const denominator = x * x - 1;
        if (Math.abs(denominator) < SINGULARITY_GAP) return null;
        return evalPoly(F, x) / denominator;
      };
      this._curveEls.Q.setAttribute('d', buildCurvePath(fOverZAt));

      const setPoints = (key, poly, forceShow = false) => {
        const coords = [X_INTERP_NEG, X_INTERP_POS].map((x) => ({ cx: toPlotX(x), cy: toPlotY(evalPoly(poly, x)) }));
        this._pointEls[key].forEach((p, i) => {
          p.setAttribute('cx', coords[i].cx);
          p.setAttribute('cy', coords[i].cy);
          p.style.display = forceShow || i < coords.length ? '' : 'none';
        });
      };
      setPoints('A', A); setPoints('B', B); setPoints('O', O); setPoints('F', F);
      const qPoints = zDividesF ? Q : null;
      this._pointEls.Q.forEach((p, i) => {
        p.style.display = qPoints ? '' : 'none';
        if (qPoints) {
          const x = i === 0 ? X_INTERP_NEG : X_INTERP_POS;
          p.setAttribute('cx', toPlotX(x));
          p.setAttribute('cy', toPlotY(evalPoly(qPoints, x)));
        }
      });
      const math = this._math;
      const eq = (labelKey, poly) =>
        `<span class="poly-panel__inline-math">${math[labelKey]}</span> <span class="ow-inline-eq">${polyBodyHtml(poly)}</span>`;
      this._equationsBox.innerHTML =
        `<p class="poly-panel__equation" data-series-key="A">${eq('poly.eqLabel.a', A)}</p>` +
        `<p class="poly-panel__equation" data-series-key="B">${eq('poly.eqLabel.b', B)}</p>` +
        `<p class="poly-panel__equation" data-series-key="O">${eq('poly.eqLabel.o', O)}</p>` +
        `<p class="poly-panel__equation" data-series-key="F">${eq('poly.eqLabel.f', F)}</p>` +
        `<p class="poly-panel__equation">${math['poly.eqZ']}</p>` +
        (zDividesF
          ? `<p class="poly-panel__equation" data-series-key="Q">${eq('poly.eqLabel.q', Q)}</p>`
          : `<p class="poly-panel__equation poly-panel__equation--note">${math['poly.quotientNote']}</p>`);
      this._applySeriesVisibility();
    }
  }

  customElements.define('poly-interpolation-panel', PolyInterpolationPanel);
})();
