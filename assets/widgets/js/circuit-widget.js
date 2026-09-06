/* Arithmetic circuit widget, ported from osec.io's ArithmeticCircuitWidget.vue
 * (Vue SFC) to a dependency-free custom element. Field math over F_37,
 * interactive witness sliders, gate/selector table and interpolated
 * polynomials. Math strings come from widget-math.js (build-time KaTeX).
 *
 * Requires: window.OSEC_WIDGET_MATH (widget-math.js) and katex.min.css.
 */
(() => {
  'use strict';

  const M = () => window.OSEC_WIDGET_MATH || {};
  const P = 37;

  /* ---------- F_37 arithmetic ---------- */
  const mod = (n) => ((((Number.isFinite(n) ? Math.trunc(n) : 0) % P) + P) % P);
  const addF = (a, b) => mod(a + b);
  const subF = (a, b) => mod(a - b);
  const mulF = (a, b) => mod(a * b);
  const invF = (a) => {
    const v = mod(a);
    if (v === 0) return 0;
    for (let i = 1; i < P; i += 1) if (mod(v * i) === 1) return i;
    return 0;
  };

  // 6th roots of unity in F_37 (the interpolation domain H).
  const ROOTS = [1, 10, 11, 26, 27, 36];

  /* ---------- tiny DOM helpers ---------- */
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

  /* ---------- dynamic math as HTML (KaTeX fonts, no runtime engine) ---------- */
  const num = (v) => `<span class="ow-mn">${v}</span>`;
  const sign = (s) => `<span class="ow-mo">${s}</span>`;

  const toBalanced = (c) => {
    const v = mod(c);
    return v > Math.floor(P / 2) ? v - P : v;
  };

  // Degree-first coefficient list -> term HTML (mirror of formatPolynomialLatex).
  const polyBodyHtml = (coeffs) => {
    let degree = coeffs.length - 1;
    while (degree > 0 && mod(coeffs[degree]) === 0) degree -= 1;

    const parts = [];
    for (let i = degree; i >= 0; i -= 1) {
      const c = toBalanced(coeffs[i]);
      if (c === 0) continue;
      const abs = Math.abs(c);
      let term;
      if (i === 0) term = num(abs);
      else if (i === 1) term = (abs === 1 ? '' : num(abs)) + '<span class="ow-mv">x</span>';
      else term = (abs === 1 ? '' : num(abs)) + `<span class="ow-mv">x</span><sup class="ow-mexp">${i}</sup>`;

      if (parts.length === 0) parts.push(c < 0 ? sign('&minus;') + term : term);
      else parts.push(c < 0 ? sign('&minus;') + term : sign('+') + term);
    }
    return parts.length > 0 ? parts.join(' ') : num(0);
  };

  // Unique polynomial of degree <= 5 through the six domain points
  // (equivalent to the widget's 37x37 Vandermonde solve, see port notes).
  const interpolateCoefficients = (values) => {
    const coeffs = [0, 0, 0, 0, 0, 0];
    for (let i = 0; i < ROOTS.length; i += 1) {
      // basis = prod_{j != i} (x - r_j) / (r_i - r_j)
      let scale = mod(values[i]);
      let basis = [1];
      for (let j = 0; j < ROOTS.length; j += 1) {
        if (i === j) continue;
        scale = mulF(scale, invF(subF(ROOTS[i], ROOTS[j])));
        // multiply basis by (x - r_j)
        const next = new Array(basis.length + 1).fill(0);
        for (let k = 0; k < basis.length; k += 1) {
          next[k + 1] = addF(next[k + 1], basis[k]); // x * basis
          next[k] = subF(next[k], mulF(basis[k], ROOTS[j])); // -r_j * basis
        }
        basis = next;
      }
      for (let k = 0; k < basis.length && k < coeffs.length; k += 1) {
        coeffs[k] = addF(coeffs[k], mulF(scale, basis[k]));
      }
    }
    return coeffs;
  };

  const dividePolynomials = (dividend, divisor) => {
    const trim = (arr) => {
      const out = [...arr];
      while (out.length > 1 && mod(out[out.length - 1]) === 0) out.pop();
      return out.map(mod);
    };
    const a = trim(dividend);
    const b = trim(divisor);
    const remainder = [...a];
    if (b.length === 0 || (b.length === 1 && b[0] === 0)) return { quotient: [0], remainder: a };
    if (a.length < b.length) return { quotient: [0], remainder: a };

    const quotient = new Array(a.length - b.length + 1).fill(0);
    const leadInv = invF(b[b.length - 1]);
    for (let d = remainder.length - b.length; d >= 0; d -= 1) {
      const lead = remainder[d + b.length - 1];
      if (lead === 0) continue;
      const factor = mulF(lead, leadInv);
      quotient[d] = factor;
      for (let i = 0; i < b.length; i += 1) {
        remainder[d + i] = subF(remainder[d + i], mulF(factor, b[i]));
      }
    }
    return { quotient: trim(quotient), remainder: trim(remainder) };
  };

  const Z_POLY = () => [mod(-1), 0, 0, 0, 0, 0, 1];

  // Polynomial arithmetic over F_37 on ascending-degree coefficient lists.
  const mulPolyF = (a, b) => {
    const out = new Array(a.length + b.length - 1).fill(0);
    for (let i = 0; i < a.length; i += 1) {
      for (let j = 0; j < b.length; j += 1) out[i + j] = addF(out[i + j], mulF(a[i], b[j]));
    }
    return out;
  };
  const addPolyF = (a, b) => {
    const len = Math.max(a.length, b.length);
    const out = [];
    for (let i = 0; i < len; i += 1) out.push(addF(a[i] ?? 0, b[i] ?? 0));
    return out;
  };

  /* ---------- static layout (ported verbatim from the Vue SFC) ---------- */
  const NODES = {
    xIn: { x: 20, y: 80, w: 70, h: 50 },
    yIn: { x: 20, y: 210, w: 70, h: 50 },
    mulX2: { x: 155, y: 80, w: 60, h: 50 },
    mulX3: { x: 280, y: 80, w: 60, h: 50 },
    const7: { x: 350, y: 165, w: 50, h: 40 },
    add: { x: 420, y: 80, w: 60, h: 50 },
    mulY2: { x: 155, y: 210, w: 60, h: 50 },
    sub: { x: 540, y: 80, w: 60, h: 50 },
    out0: { x: 640, y: 80, w: 60, h: 50 },
  };
  const cx = (n) => n.x + n.w / 2;
  const cy = (n) => n.y + n.h / 2;
  const pathFrom = (pts) =>
    pts.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p[0]} ${p[1]}`).join(' ');

  const EDGES = [
    { id: 'x_to_x2_a', points: [[90, 99], [155, 99]], value: (s) => `${s.x}`, labelX: 112, labelY: 92, wireClass: 'circuit-widget__wire--input', valueClass: 'circuit-widget__wire-label--input', showValueLabel: true, roleMarkers: [{ label: 'a', x: 136, y: 91, className: 'circuit-widget__wire-role--input' }] },
    { id: 'x_to_x2_b', points: [[90, 111], [155, 111]], value: () => '', labelX: 0, labelY: 0, wireClass: 'circuit-widget__wire--input', valueClass: 'circuit-widget__wire-label--input', showValueLabel: false, roleMarkers: [{ label: 'b', x: 136, y: 122, className: 'circuit-widget__wire-role--input' }] },
    { id: 'x_to_x3', points: [[55, 80], [55, 62], [310, 62], [310, 80]], value: () => '', labelX: 0, labelY: 0, wireClass: 'circuit-widget__wire--input', valueClass: 'circuit-widget__wire-label--input', showValueLabel: false, roleMarkers: [{ label: 'b', x: 316, y: 72, className: 'circuit-widget__wire-role--input' }] },
    { id: 'x2_to_x3', points: [[215, 99], [280, 99]], value: (s) => `${s.x2}`, labelX: 248, labelY: 92, wireClass: 'circuit-widget__wire--op', valueClass: 'circuit-widget__wire-label--derived', showValueLabel: true, roleMarkers: [{ label: 'o', x: 219, y: 91, className: 'circuit-widget__wire-role--op' }, { label: 'a', x: 268, y: 91, className: 'circuit-widget__wire-role--op' }] },
    { id: 'x3_to_add', points: [[340, 99], [420, 99]], value: (s) => `${s.x3}`, labelX: 380, labelY: 92, wireClass: 'circuit-widget__wire--op', valueClass: 'circuit-widget__wire-label--derived', showValueLabel: true, roleMarkers: [{ label: 'o', x: 344, y: 91, className: 'circuit-widget__wire-role--op' }, { label: 'a', x: 408, y: 91, className: 'circuit-widget__wire-role--op' }] },
    { id: 'c7_to_add', points: [[375, 165], [375, 145], [450, 145], [450, 130]], value: () => '', labelX: 0, labelY: 0, wireClass: 'circuit-widget__wire--const', valueClass: 'circuit-widget__wire-label--const', showValueLabel: false, roleMarkers: [{ label: 'b', x: 438, y: 152, className: 'circuit-widget__wire-role--const' }] },
    { id: 'y_to_y2_a', points: [[90, 229], [155, 229]], value: (s) => `${s.y}`, labelX: 112, labelY: 222, wireClass: 'circuit-widget__wire--input', valueClass: 'circuit-widget__wire-label--input', showValueLabel: true, roleMarkers: [{ label: 'a', x: 136, y: 221, className: 'circuit-widget__wire-role--input' }] },
    { id: 'y_to_y2_b', points: [[90, 241], [155, 241]], value: () => '', labelX: 0, labelY: 0, wireClass: 'circuit-widget__wire--input', valueClass: 'circuit-widget__wire-label--input', showValueLabel: false, roleMarkers: [{ label: 'b', x: 136, y: 252, className: 'circuit-widget__wire-role--input' }] },
    { id: 'add_to_sub', points: [[480, 99], [540, 99]], value: (s) => `${s.rhs}`, labelX: 510, labelY: 92, wireClass: 'circuit-widget__wire--constraint', valueClass: 'circuit-widget__wire-label--constraint', showValueLabel: true, roleMarkers: [{ label: 'o', x: 484, y: 91, className: 'circuit-widget__wire-role--constraint' }, { label: 'a', x: 528, y: 91, className: 'circuit-widget__wire-role--constraint' }] },
    { id: 'y2_to_sub', points: [[215, 235], [500, 235], [500, 155], [570, 155], [570, 130]], value: (s) => `${s.y2}`, labelX: 360, labelY: 228, wireClass: 'circuit-widget__wire--op', valueClass: 'circuit-widget__wire-label--derived', showValueLabel: true, roleMarkers: [{ label: 'o', x: 219, y: 227, className: 'circuit-widget__wire-role--op' }, { label: 'b', x: 556, y: 152, className: 'circuit-widget__wire-role--op' }] },
    { id: 'sub_to_out', points: [[600, 105], [640, 105]], value: () => '', labelX: 0, labelY: 0, wireClass: 'circuit-widget__wire--result', valueClass: 'circuit-widget__wire-label--result', showValueLabel: false, roleMarkers: [{ label: 'o', x: 604, y: 91, className: 'circuit-widget__wire-role--result' }] },
  ];

  const GATES = [
    { id: 'mulX2', node: 'mulX2', cls: 'node--mul', symbol: '×', symbolCls: 'node__symbol--mul' },
    { id: 'mulX3', node: 'mulX3', cls: 'node--mul', symbol: '×', symbolCls: 'node__symbol--mul' },
    { id: 'add', node: 'add', cls: 'node--constraint', symbol: '+', symbolCls: 'node__symbol--constraint' },
    { id: 'mulY2', node: 'mulY2', cls: 'node--mul', symbol: '×', symbolCls: 'node__symbol--mul' },
    { id: 'sub', node: 'sub', cls: 'node--constraint', symbol: '−', symbolCls: 'node__symbol--constraint' },
    { id: 'assert0', node: 'out0', cls: null, symbol: '0', symbolCls: 'node__symbol--out', out: true },
  ];

  const SELECTOR_KEYS = ['qM', 'qL', 'qR', 'qO', 'qC'];
  const POLY_KEYS = [...SELECTOR_KEYS, 'a', 'b', 'o', 'f', 'fOverZ'];
  const POLY_EQ_LABEL = {
    qM: 'circuit.eqLabel.qM', qL: 'circuit.eqLabel.qL', qR: 'circuit.eqLabel.qR',
    qO: 'circuit.eqLabel.qO', qC: 'circuit.eqLabel.qC', a: 'circuit.eqLabel.a',
    b: 'circuit.eqLabel.b', o: 'circuit.eqLabel.o', f: 'circuit.eqLabel.f',
    fOverZ: 'circuit.eqLabel.fOverZ',
  };

  /* ---------- widget ---------- */
  class ArithmeticCircuitWidget extends HTMLElement {
    connectedCallback() {
      if (this._init) return;
      this._init = true;
      this.replaceChildren(); // drop the no-JS fallback markup
      const math = M();
      this._math = math;

      this._state = { x: 6, y: 1, hoveredGate: null, hoveredPoly: null, pinned: new Set(), showPolys: false };
      this._compute();

      const root = el('section', 'circuit-widget');
      root.appendChild(el('h3', 'circuit-widget__title',
        `Arithmetic Circuit In <span class="circuit-widget__inline-math">${math['circuit.f37']}</span>`));
      root.appendChild(el('p', 'circuit-widget__description',
        `Circuit computes <span class="circuit-widget__inline-math">${math['circuit.diffExpr']}</span> over ` +
        `<span class="circuit-widget__inline-math">${math['circuit.f37']}</span> and checks whether it equals ` +
        `<span class="circuit-widget__inline-math">${math['circuit.zero']}</span>.`));

      root.appendChild(this._buildSvg());

      const controls = el('div', 'circuit-widget__controls');
      this._xSlider = this._buildSlider('x', 0, 36, this._state.x, controls);
      this._ySlider = this._buildSlider('y', 0, 36, this._state.y, controls);
      root.appendChild(controls);

      root.appendChild(this._buildTable());
      root.appendChild(this._buildPolyPanel());
      this.appendChild(root);

      this._update();
    }

    /* ----- derived F_37 values for the current witness ----- */
    _compute() {
      const s = this._state;
      s.x = mod(s.x); s.y = mod(s.y);
      s.x2 = mulF(s.x, s.x);
      s.x3 = mulF(s.x2, s.x);
      s.rhs = addF(s.x3, 7);
      s.y2 = mulF(s.y, s.y);
      s.diff = subF(s.y2, s.rhs);
      s.satisfied = s.diff === 0;
    }

    _rows() {
      const s = this._state;
      return [
        { id: 'mulX2', labelKey: 'circuit.row.mulX2', qM: 1, qL: 0, qR: 0, qO: -1, qC: 0, a: s.x, b: s.x, o: s.x2 },
        { id: 'mulX3', labelKey: 'circuit.row.mulX3', qM: 1, qL: 0, qR: 0, qO: -1, qC: 0, a: s.x2, b: s.x, o: s.x3 },
        { id: 'add', labelKey: 'circuit.row.add', qM: 0, qL: 1, qR: 0, qO: -1, qC: 7, a: s.x3, b: 0, o: s.rhs },
        { id: 'mulY2', labelKey: 'circuit.row.mulY2', qM: 1, qL: 0, qR: 0, qO: -1, qC: 0, a: s.y, b: s.y, o: s.y2 },
        { id: 'sub', labelKey: 'circuit.row.sub', qM: 0, qL: 1, qR: -1, qO: -1, qC: 0, a: s.y2, b: s.rhs, o: s.diff },
        { id: 'assert0', labelKey: 'circuit.row.assert0', qM: 0, qL: 1, qR: 0, qO: 0, qC: 0, a: s.diff, b: 0, o: 0 },
      ];
    }

    _buildSvg() {
      const math = this._math;
      const wrap = el('div', 'circuit-widget__svg-wrap');
      const svg = svgEl('svg', { class: 'circuit-widget__svg', viewBox: '0 0 720 320', role: 'img', 'aria-label': 'Arithmetic circuit diagram' });
      const defs = svgEl('defs');
      defs.innerHTML = `<marker id="circuit-arrow-head" viewBox="0 -5 10 10" markerWidth="4" markerHeight="4" refX="10" refY="0" orient="auto"><polygon points="0 -4, 10 0, 0 4" fill="context-stroke"></polygon></marker>`;
      svg.appendChild(defs);

      this._wireEls = {};
      this._wireLabelEls = {};
      for (const edge of EDGES) {
        const path = svgEl('path', {
          d: pathFrom(edge.points),
          class: `circuit-widget__wire ${edge.wireClass}`,
          'marker-end': 'url(#circuit-arrow-head)',
        });
        this._wireEls[edge.id] = path;
        svg.appendChild(path);

        if (edge.showValueLabel) {
          const text = svgEl('text', {
            x: edge.labelX, y: edge.labelY,
            class: `circuit-widget__wire-label ${edge.valueClass}`,
            'text-anchor': 'middle',
          });
          this._wireLabelEls[edge.id] = text;
          svg.appendChild(text);
        }

        for (const marker of edge.roleMarkers || []) {
          svg.appendChild(svgEl('text', {
            x: marker.x, y: marker.y,
            class: `circuit-widget__wire-role ${marker.className}`,
            'text-anchor': 'middle',
          })).textContent = marker.label;
        }
      }

      this._failLabel = svgEl('text', { x: 622, y: 72, class: 'circuit-widget__fail-label', 'text-anchor': 'middle' });
      svg.appendChild(this._failLabel);

      const addNode = (key, cls, symbol, symbolCls) => {
        const n = NODES[key];
        svg.appendChild(svgEl('rect', { x: n.x, y: n.y, width: n.w, height: n.h, rx: 12, class: `node ${cls}` }));
        const t = svgEl('text', { x: cx(n), y: cy(n) + 6, class: `node__symbol ${symbolCls}`, 'text-anchor': 'middle' });
        t.textContent = symbol;
        svg.appendChild(t);
      };
      addNode('xIn', 'node--input', 'x', 'node__symbol--input');
      addNode('yIn', 'node--input', 'y', 'node__symbol--input');
      addNode('const7', 'node--const', '7', 'node__symbol--const');

      this._gateEls = {};
      for (const gate of GATES) {
        const g = svgEl('g', { class: 'circuit-widget__gate-group' });
        const n = NODES[gate.node];
        const rectClass = gate.out
          ? `node ${this._state.satisfied ? 'node--out-ok' : 'node--out-bad'}`
          : `node ${gate.cls}`;
        g.appendChild(svgEl('rect', { x: n.x, y: n.y, width: n.w, height: n.h, rx: gate.out ? 30 : 12, class: rectClass }));
        const t = svgEl('text', { x: cx(n), y: cy(n) + 6, class: `node__symbol ${gate.symbolCls}`, 'text-anchor': 'middle' });
        t.textContent = gate.symbol;
        g.appendChild(t);
        g.addEventListener('mouseenter', () => this._setHoveredGate(gate.id));
        g.addEventListener('mouseleave', () => this._setHoveredGate(null));
        this._gateEls[gate.id] = g;
        svg.appendChild(g);
      }

      wrap.appendChild(svg);
      return wrap;
    }

    _buildSlider(name, min, max, value, container) {
      const label = el('label', 'circuit-widget__control');
      const span = el('span', null, `${name} = ${value}`);
      const input = document.createElement('input');
      input.type = 'range'; input.min = min; input.max = max; input.step = 1; input.value = value;
      input.setAttribute('aria-label', `${name} witness value`);
      input.addEventListener('input', () => {
        this._state[name] = Number(input.value);
        span.innerHTML = `${name} = ${input.value}`;
        this._compute();
        this._update();
      });
      label.append(span, input);
      container.appendChild(label);
      return input;
    }

    _buildTable() {
      const math = this._math;
      const wrap = el('div', 'circuit-widget__table-wrap');
      const table = el('table', 'circuit-widget__table');
      table.setAttribute('aria-label', 'Gate constraint table');
      table.innerHTML =
        `<colgroup><col class="circuit-widget__col-gate">${'<col class="circuit-widget__col-num">'.repeat(8)}</colgroup>`;
      const thead = el('thead');
      const headRow = el('tr');
      this._headerCells = {};
      const headers = [
        ['gate', math['circuit.h.gate'], null],
        ['qM', math['circuit.h.qM'], 'qM'], ['qL', math['circuit.h.qL'], 'qL'],
        ['qR', math['circuit.h.qR'], 'qR'], ['qO', math['circuit.h.qO'], 'qO'],
        ['qC', math['circuit.h.qC'], 'qC'], ['a', math['circuit.h.a'], 'a'],
        ['b', math['circuit.h.b'], 'b'], ['o', math['circuit.h.o'], 'o'],
      ];
      for (const [key, html, polyKey] of headers) {
        const th = el('th', 'circuit-widget__header-q', html);
        if (polyKey) {
          th.addEventListener('mouseenter', () => this._setHoveredPoly(polyKey));
          th.addEventListener('mouseleave', () => this._setHoveredPoly(null));
          this._headerCells[polyKey] = th;
        }
        headRow.appendChild(th);
      }
      thead.appendChild(headRow);
      table.appendChild(thead);

      const tbody = el('tbody');
      this._rowEls = {};
      this._rowCells = {};
      for (const row of this._rows()) {
        const tr = el('tr', 'circuit-widget__table-row');
        tr.appendChild(el('td', null, math[row.labelKey]));
        const cells = {};
        for (const key of [...SELECTOR_KEYS, 'a', 'b', 'o']) {
          const td = el('td', 'circuit-widget__table-cell-poly');
          td.addEventListener('mouseenter', () => this._setHoveredPoly(key));
          td.addEventListener('mouseleave', () => this._setHoveredPoly(null));
          cells[key] = td;
          tr.appendChild(td);
        }
        tr.addEventListener('mouseenter', () => this._setHoveredGate(row.id));
        tr.addEventListener('mouseleave', () => this._setHoveredGate(null));
        this._rowEls[row.id] = tr;
        this._rowCells[row.id] = cells;
        tbody.appendChild(tr);
      }
      table.appendChild(tbody);
      wrap.appendChild(table);
      return wrap;
    }

    _buildPolyPanel() {
      const math = this._math;
      const panel = el('div', 'circuit-widget__poly-panel');
      const header = el('div', 'circuit-widget__poly-header');
      header.appendChild(el('p', 'circuit-widget__poly-copy',
        `Using the same witness selected above, <span class="circuit-widget__inline-math ow-witness"></span>, ` +
        `the table columns induce interpolated polynomials over <span class="circuit-widget__inline-math">${math['circuit.f37']}</span>.`));
      this._witnessEl = header.querySelector('.ow-witness');
      const toggle = el('button', 'circuit-widget__poly-toggle', 'Show interpolated polynomials');
      toggle.type = 'button';
      toggle.addEventListener('click', () => {
        this._state.showPolys = !this._state.showPolys;
        toggle.textContent = this._state.showPolys ? 'Hide interpolated polynomials' : 'Show interpolated polynomials';
        toggle.classList.toggle('circuit-widget__poly-toggle--active', this._state.showPolys);
        this._renderPolyEquations();
      });
      this._polyToggle = toggle;
      header.appendChild(toggle);
      panel.appendChild(header);

      panel.appendChild(el('p', 'circuit-widget__poly-note',
        `When <span class="circuit-widget__inline-math">${math['circuit.f']}</span> is zero at all six interpolation points, ` +
        `<span class="circuit-widget__inline-math">${math['circuit.zH']}</span> divides it, so ` +
        `<span class="circuit-widget__inline-math">${math['circuit.fOverZH']}</span> is again a polynomial.`));

      this._polyStatus = el('p', 'circuit-widget__poly-status');
      panel.appendChild(this._polyStatus);

      this._polyEquations = el('div', 'circuit-widget__poly-equations');
      this._polyEquations.hidden = true;
      panel.appendChild(this._polyEquations);
      return panel;
    }

    /* ----- interaction ----- */
    _setHoveredGate(id) {
      this._state.hoveredGate = id;
      for (const [gateId, g] of Object.entries(this._gateEls)) {
        g.classList.toggle('circuit-widget__gate-group--active', gateId === id);
      }
      for (const [rowId, tr] of Object.entries(this._rowEls)) {
        const base = rowId === 'assert0'
          ? (this._state.satisfied ? 'circuit-widget__table-row--ok' : 'circuit-widget__table-row--bad')
          : '';
        tr.className = `circuit-widget__table-row${rowId === id ? ' circuit-widget__table-row--active' : ''}${base ? ' ' + base : ''}`;
      }
    }

    _setHoveredPoly(key) {
      this._state.hoveredPoly = key;
      const active = (k) => this._state.hoveredPoly === k || this._state.pinned.has(k);
      for (const [k, th] of Object.entries(this._headerCells)) th.classList.toggle('circuit-widget__header-q--active', active(k));
      for (const cells of Object.values(this._rowCells)) {
        for (const [k, td] of Object.entries(cells)) td.classList.toggle('circuit-widget__table-cell-poly--active', active(k));
      }
      for (const item of this._polyEquations ? this._polyEquations.children : []) {
        item.classList.toggle('circuit-widget__poly-equation--active', active(item.dataset.polyKey));
      }
    }

    _togglePinned(key) {
      const pinned = this._state.pinned;
      if (pinned.has(key)) pinned.delete(key); else pinned.add(key);
      this._setHoveredPoly(this._state.hoveredPoly);
    }

    /* ----- reactive update ----- */
    _update() {
      const s = this._state;
      for (const edge of EDGES) {
        const label = this._wireLabelEls[edge.id];
        if (label) label.textContent = edge.value(s);
      }
      this._failLabel.textContent = s.satisfied ? '' : `${s.diff} != 0`;
      this._wireEls.sub_to_out.classList.toggle('circuit-widget__wire--ok', s.satisfied);
      this._wireEls.sub_to_out.classList.toggle('circuit-widget__wire--bad', !s.satisfied);

      this._witnessEl.innerHTML =
        `<span class="ow-mv">x</span><span class="ow-mo">=</span>${num(s.x)}<span class="ow-mo">,</span><span class="ow-mv">y</span><span class="ow-mo">=</span>${num(s.y)}`;

      for (const row of this._rows()) {
        const cells = this._rowCells[row.id];
        for (const key of [...SELECTOR_KEYS, 'a', 'b', 'o']) cells[key].textContent = String(row[key]);
      }

      // Polynomial interpolation panel.
      const rows = this._rows();
      const cols = {};
      for (const key of [...SELECTOR_KEYS, 'a', 'b', 'o']) {
        cols[key] = interpolateCoefficients(rows.map((r) => r[key]));
      }
      // F = qM*a*b + qL*a + qR*b + qO*o + qC as a polynomial product (degree
      // <= 15 < 37, so this matches the original's Vandermonde solve exactly).
      const fCoeffs = addPolyF(
        addPolyF(
          addPolyF(mulPolyF(mulPolyF(cols.qM, cols.a), cols.b), mulPolyF(cols.qL, cols.a)),
          addPolyF(mulPolyF(cols.qR, cols.b), mulPolyF(cols.qO, cols.o)),
        ),
        cols.qC,
      );
      const { quotient, remainder } = dividePolynomials(fCoeffs, Z_POLY());
      const divisible = remainder.every((c) => mod(c) === 0);

      this._polyStatus.className = `circuit-widget__poly-status ${divisible ? 'circuit-widget__poly-status--ok' : 'circuit-widget__poly-status--bad'}`;
      this._polyStatus.innerHTML =
        `For the current witness, <span class="circuit-widget__inline-math">${this._math['circuit.zH']}</span> ` +
        `${divisible ? ' divides ' : ' does not divide '}` +
        `<span class="circuit-widget__inline-math">${this._math['circuit.f']}</span>.`;

      this._polyData = { cols, fCoeffs, quotient, divisible };
      if (this._state.showPolys) this._renderPolyEquations();
    }

    _renderPolyEquations() {
      const box = this._polyEquations;
      box.hidden = !this._state.showPolys;
      if (!this._state.showPolys || !this._polyData) return;

      const { cols, fCoeffs, quotient, divisible } = this._polyData;
      const keys = [...SELECTOR_KEYS, 'a', 'b', 'o', 'f', ...(divisible ? ['fOverZ'] : [])];
      const bodies = { ...cols, f: fCoeffs, fOverZ: quotient };

      box.textContent = '';
      for (const key of keys) {
        const p = el('p', 'circuit-widget__poly-equation');
        p.dataset.polyKey = key;
        p.innerHTML = `<span class="circuit-widget__inline-math">${this._math[POLY_EQ_LABEL[key]]}</span> <span class="ow-inline-eq">${polyBodyHtml(bodies[key])}</span>`;
        p.addEventListener('mouseenter', () => this._setHoveredPoly(key));
        p.addEventListener('mouseleave', () => this._setHoveredPoly(null));
        p.addEventListener('click', () => this._togglePinned(key));
        box.appendChild(p);
      }
    }
  }

  customElements.define('arithmetic-circuit-widget', ArithmeticCircuitWidget);
})();
