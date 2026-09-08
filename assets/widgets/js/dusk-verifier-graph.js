/* Dusk verifier dependence graph, ported from osec.io's
 * DuskVerifierDependenceGraph.vue + useGraphPanZoom.ts + lib helpers to a
 * dependency-free custom element. BFS neighborhood slicing, kind filters,
 * orthogonal edge routing with trunk tracks, scroll pan + wheel/pinch zoom,
 * and a detail panel with code anchors.
 *
 * The graph JSON is fetched lazily from ../data/dusk-verifier-graph.json
 * (relative to this script) when the widget approaches the viewport.
 */
(() => {
  'use strict';

  const SVG_NS = 'http://www.w3.org/2000/svg';
  const VIEW_PADDING = 28;
  const MOBILE_BREAKPOINT = 760;
  const MIN_ZOOM = 0.35;
  const MAX_ZOOM = 2.6;
  const MOBILE_FOCUS_HOP_COUNT = 1;

  const AGGREGATOR_FOCUS_IDS = new Set([
    'agg:D', 'agg:E_scalar', 'agg:E', 'agg:F', 'agg:left_pairing', 'agg:right_pairing',
  ]);

  // Resolved while this classic script executes (document.currentScript is
  // only set during execution), so the data path tracks the script location.
  const SCRIPT_TAG = document.currentScript;
  const DEFAULT_DATA_URL = SCRIPT_TAG
    ? new URL('../data/dusk-verifier-graph.json', SCRIPT_TAG.src).href
    : new URL('/assets/widgets/data/dusk-verifier-graph.json', location.origin + location.pathname).href;

  /* ---------- theme (lib/dusk-verifier-graph/theme.ts) ---------- */
  const BASE_FILL = '#080b11';
  const KIND_META = {
    proof_eval: { label: 'Proof eval', fill: BASE_FILL, stroke: '#f7b955', text: '#f7d787' },
    proof_commitment: { label: 'Proof comm', fill: BASE_FILL, stroke: '#60a5fa', text: '#c7d8ff' },
    vk_commitment: { label: 'VK comm', fill: BASE_FILL, stroke: '#94a3b8', text: '#d5dde8' },
    transcript_absorb: { label: 'Transcript', fill: BASE_FILL, stroke: '#94a3b8', text: '#d5dde8' },
    challenge: { label: 'Challenge', fill: BASE_FILL, stroke: '#b793ff', text: '#eadcff' },
    derived_scalar: { label: 'Derived scalar', fill: BASE_FILL, stroke: '#b793ff', text: '#eadcff' },
    widget_identity: { label: 'Verifier check', fill: BASE_FILL, stroke: '#b793ff', text: '#eadcff' },
    msm_term: { label: 'Aggregation', fill: BASE_FILL, stroke: '#60a5fa', text: '#c7d8ff' },
    pairing_term: { label: 'Pairing', fill: BASE_FILL, stroke: '#60a5fa', text: '#c7d8ff' },
    final_check: { label: 'Final check', fill: BASE_FILL, stroke: '#4fd38f', text: '#d0f5df' },
  };
  const EDGE_META = {
    absorbed_into: { stroke: '#94a3b8' },
    derives: { stroke: '#b793ff' },
    used_in: { stroke: '#60a5fa' },
    opened_by: { stroke: '#60a5fa' },
    omitted_from: { stroke: '#fb7185', dash: '6 6' },
    committed_as: { stroke: '#60a5fa' },
    contributes_to: { stroke: '#60a5fa' },
    checked_by: { stroke: '#4fd38f' },
  };
  const COMPONENT_WIRE_META = {
    transcript: { stroke: '#94a3b8', order: 0 },
    challenge: { stroke: '#b793ff', order: 1 },
    arithmetic: { stroke: '#f7b955', order: 2 },
    range: { stroke: '#a3e635', order: 3 },
    logic: { stroke: '#c084fc', order: 4 },
    fixed_base: { stroke: '#22d3ee', order: 5 },
    variable_base: { stroke: '#14b8a6', order: 6 },
    permutation: { stroke: '#7dd3fc', order: 7 },
    quotient: { stroke: '#60a5fa', order: 8 },
    opening: { stroke: '#60a5fa', order: 9 },
    pairing: { stroke: '#4fd38f', order: 10 },
    omitted: { stroke: '#fb7185', order: 11 },
    generic: { stroke: '#8ba6c8', order: 12 },
  };

  /* ---------- text helpers (lib/dusk-verifier-graph/text.ts) ---------- */
  const labelLines = (label) => {
    const source = label.trim();
    // Nine 15px monospace characters fit the 92px boxes with 5px side insets.
    // Keep the label in order, preferring separators when the remaining text fits.
    const maxChars = 9;
    const lineCount = Math.ceil(source.length / maxChars);
    const lines = [];
    let rest = source;
    while (rest.length > maxChars) {
      const boundary = Math.max(...[' ', '_', '-'].map((s) => rest.lastIndexOf(s, maxChars - 1))) + 1;
      const remainingLines = lineCount - lines.length - 1;
      const split = boundary > 0 && rest.length - boundary <= remainingLines * maxChars ? boundary : maxChars;
      lines.push(rest.slice(0, split).trim());
      rest = rest.slice(split).trim();
    }
    if (rest) lines.push(rest);
    return lines;
  };
  const labelStartY = (label) => 33 - (labelLines(label).length - 1) * 7.5;
  const ambientTagWidth = (label) => Math.max(18, Math.ceil(label.length * 6 + 12));

  /* ---------- DOM helpers ---------- */
  const el = (tag, className, html) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (html != null) node.innerHTML = html;
    return node;
  };
  const escapeHtml = (s) =>
    String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  const distributeOffsets = (count, gap, availableHeight, margin = 10) => {
    if (count <= 1) return [0];
    const maxSpread = Math.max(0, availableHeight - margin * 2);
    const idealSpread = gap * (count - 1);
    const actualGap = idealSpread <= maxSpread ? gap : maxSpread / (count - 1);
    const start = -((count - 1) * actualGap) / 2;
    return Array.from({ length: count }, (_, i) => start + i * actualGap);
  };

  const pathFromPoints = (points) => {
    if (points.length === 0) return '';
    const commands = [`M ${points[0].x} ${points[0].y}`];
    for (let i = 1; i < points.length; i += 1) {
      const prev = points[i - 1];
      const cur = points[i];
      if (prev.x === cur.x) commands.push(`V ${cur.y}`);
      else if (prev.y === cur.y) commands.push(`H ${cur.x}`);
      else commands.push(`L ${cur.x} ${cur.y}`);
    }
    return commands.join(' ');
  };

  class DuskVerifierGraph extends HTMLElement {
    connectedCallback() {
      if (this._init) return;
      this._init = true;
      this.replaceChildren(); // drop the no-JS fallback markup

      this._state = { selectedNodeId: null, hopCount: 2, enabledKinds: {} };
      this._zoom = { scale: 1, isMobile: false, mobileFocused: false, pinch: { distance: 0, startScale: 1 }, touchPan: null, panning: false, panStart: null };
      this._graph = null;

      this._buildShell();

      const dataUrl = this.getAttribute('data-src') || DEFAULT_DATA_URL;
      this._dataUrl = dataUrl;

      if ('IntersectionObserver' in window) {
        const io = new IntersectionObserver((entries) => {
          if (entries.some((e) => e.isIntersecting)) {
            io.disconnect();
            this._loadData();
          }
        }, { rootMargin: '400px' });
        io.observe(this);
      } else {
        this._loadData();
      }
    }

    async _loadData() {
      try {
        const response = await fetch(this._dataUrl);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        this._onData(await response.json());
      } catch (error) {
        this._canvasWrap.innerHTML =
          `<p class="dusk-dep-graph__load-error">Could not load the verifier graph data (${escapeHtml(error.message)}). ` +
          `See the <a href="https://osec.io/blog/unverified-evaluations-dusk-plonk/" target="_blank" rel="noreferrer">original post</a> for the interactive version.</p>`;
      }
    }

    _onData(graph) {
      this._graph = graph;
      const g = this._graph;

      this.nodeById = new Map(g.nodes.map((n) => [n.id, n]));
      this.columnMetaById = new Map(g.columns.map((c) => [c.id, c]));
      this.outgoingMap = new Map();
      this.incomingMap = new Map();
      for (const edge of g.edges) {
        const out = this.outgoingMap.get(edge.from) ?? [];
        out.push(edge); this.outgoingMap.set(edge.from, out);
        const inc = this.incomingMap.get(edge.to) ?? [];
        inc.push(edge); this.incomingMap.set(edge.to, inc);
      }
      const normalizeLookup = (v) => v.trim().toLowerCase();
      this.lookupByLabel = new Map(
        g.nodes.flatMap((n) => [[normalizeLookup(n.label), n.id], [normalizeLookup(n.id), n.id]]),
      );
      this.searchableNodes = [...g.nodes].sort((a, b) => a.label.localeCompare(b.label));

      this._state.selectedNodeId = g.defaults.selectedNodeId;
      this._state.hopCount = g.defaults.hopCount;
      this._state.enabledKinds = Object.fromEntries(Object.keys(KIND_META).map((k) => [k, true]));

      // Global "dangerous" reachability (graph-static).
      this.dangerousSourceNodeIds = new Set(g.nodes.filter((n) => n.tags?.includes('omitted')).map((n) => n.id));
      this.dangerousReachableNodeIds = (() => {
        const visited = new Set(this.dangerousSourceNodeIds);
        const queue = [...this.dangerousSourceNodeIds];
        while (queue.length > 0) {
          const current = queue.shift();
          if (!current) continue;
          for (const edge of this.outgoingMap.get(current) ?? []) {
            if (edge.kind === 'omitted_from') continue;
            if (!visited.has(edge.to)) { visited.add(edge.to); queue.push(edge.to); }
          }
        }
        return visited;
      })();
      this.dangerousDownstreamEdgeIds = new Set(
        g.edges
          .filter((e) => e.kind !== 'omitted_from'
            && this.dangerousReachableNodeIds.has(e.from)
            && this.dangerousReachableNodeIds.has(e.to))
          .map((e) => e.id),
      );

      this._buildControls();
      this._updateViewportMode();
      this._applyInitialFocus();
      this._render();

      window.addEventListener('resize', () => {
        this._updateViewportMode();
        if (this._zoom.isMobile && !this._zoom.mobileFocused) this._applyInitialFocus();
      });
    }

    /* ================= shell ================= */
    _buildShell() {
      const root = el('section', 'dusk-dep-graph');

      const header = el('div', 'dusk-dep-graph__header');
      header.innerHTML = `
        <div>
          <p class="dusk-dep-graph__eyebrow">Verifier Dependence Graph</p>
          <h3 class="dusk-dep-graph__title">What actually flows into the final check?</h3>
          <p class="dusk-dep-graph__lede">Click a proof value or commitment to trace its verifier slice. Safe values feed the opening
          accumulator on the way to the pairing check; the red selector flow shows values the verifier
          consumes without ever opening.</p>
        </div>
        <div class="dusk-dep-graph__meta">
          <span class="dusk-dep-graph__meta-pill dusk-dep-graph__commit"></span>
          <span class="dusk-dep-graph__meta-pill">red = consumed but not opened</span>
        </div>`;
      root.appendChild(header);

      this._controlsBox = el('div', 'dusk-dep-graph__controls');
      this._controlsBox.innerHTML = '<p class="dusk-dep-graph__lede">Loading graph data&hellip;</p>';
      root.appendChild(this._controlsBox);

      const frame = el('div', 'dusk-dep-graph__frame');
      this._canvasWrap = el('div', 'dusk-dep-graph__canvas-wrap');
      this._canvasWrap.setAttribute('role', 'region');
      this._canvasWrap.setAttribute('aria-label', 'Dusk verifier dependence graph, scroll to pan');
      this._svg = document.createElementNS(SVG_NS, 'svg');
      this._svg.setAttribute('class', 'dusk-dep-graph__canvas');
      this._svg.setAttribute('preserveAspectRatio', 'xMinYMin meet');
      this._svg.setAttribute('role', 'img');
      this._svg.setAttribute('aria-label', 'Dusk verifier dependence graph');
      this._svg.innerHTML = `<defs><marker id="dusk-dep-arrow" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="6" markerHeight="6" orient="auto"><path d="M 0 0 L 8 4 L 0 8 z" fill="context-stroke"></path></marker></defs>`;
      const canvasStage = el('div', 'dusk-dep-graph__canvas-stage');
      canvasStage.appendChild(this._svg);
      this._canvasWrap.appendChild(canvasStage);
      this._canvasWrap.addEventListener('pointerdown', (e) => this._beginPan(e));
      this._canvasWrap.addEventListener('pointermove', (e) => this._continuePan(e));
      this._canvasWrap.addEventListener('pointerup', (e) => this._endPan(e));
      this._canvasWrap.addEventListener('pointerleave', (e) => this._endPan(e));
      this._canvasWrap.addEventListener('pointercancel', (e) => this._endPan(e));
      this._canvasWrap.addEventListener('wheel', (e) => this._wheelZoom(e), { passive: false });
      this._canvasWrap.addEventListener('touchstart', (e) => this._touchStart(e), { passive: true });
      this._canvasWrap.addEventListener('touchmove', (e) => this._touchMove(e), { passive: false });
      this._canvasWrap.addEventListener('touchend', () => this._touchEnd());
      this._canvasWrap.addEventListener('touchcancel', () => this._touchEnd());
      this._svg.addEventListener('click', (e) => {
        const nodeGroup = e.target.closest('g[data-node-id]');
        if (nodeGroup) {
          this._state.selectedNodeId = nodeGroup.dataset.nodeId;
          this._syncSearchInput();
          this._render();
          if (this._zoom.isMobile) this._centerOnSelection();
        }
      });
      frame.appendChild(this._canvasWrap);

      this._detail = el('aside', 'dusk-dep-graph__detail');
      frame.appendChild(this._detail);
      root.appendChild(frame);
      this.appendChild(root);
    }

    _buildControls() {
      const box = this._controlsBox;
      box.textContent = '';

      const searchControl = el('label', 'dusk-dep-graph__control');
      searchControl.innerHTML = '<span>Selected variable</span>';
      this._searchInput = document.createElement('input');
      this._searchInput.type = 'text';
      this._searchInput.className = 'dusk-dep-graph__input';
      this._searchInput.setAttribute('list', 'dusk-graph-node-list');
      this._searchInput.value = this.nodeById.get(this._state.selectedNodeId)?.label ?? this._state.selectedNodeId;
      const applyLookup = () => {
        const key = this._searchInput.value.trim().toLowerCase();
        const id = this.lookupByLabel.get(key);
        if (id) {
          this._state.selectedNodeId = id;
          this._render();
          if (this._zoom.isMobile) this._centerOnSelection();
        }
      };
      this._searchInput.addEventListener('change', applyLookup);
      this._searchInput.addEventListener('keyup', (e) => { if (e.key === 'Enter') applyLookup(); });
      searchControl.appendChild(this._searchInput);
      const datalist = document.createElement('datalist');
      datalist.id = 'dusk-graph-node-list';
      for (const node of this.searchableNodes) {
        const option = document.createElement('option');
        option.value = node.label;
        datalist.appendChild(option);
      }
      searchControl.appendChild(datalist);
      box.appendChild(searchControl);

      const hopControl = el('label', 'dusk-dep-graph__control dusk-dep-graph__control--compact');
      hopControl.innerHTML = '<span>Neighborhood</span>';
      this._hopSelect = document.createElement('select');
      this._hopSelect.className = 'dusk-dep-graph__select';
      for (const hops of [1, 2, 3]) {
        const option = document.createElement('option');
        option.value = String(hops);
        option.textContent = `${hops} hop${hops > 1 ? 's' : ''}`;
        this._hopSelect.appendChild(option);
      }
      this._hopSelect.value = String(this._state.hopCount);
      this._hopSelect.addEventListener('change', () => {
        this._state.hopCount = Number(this._hopSelect.value);
        this._render();
        if (this._zoom.isMobile) this._centerOnSelection();
      });
      hopControl.appendChild(this._hopSelect);
      box.appendChild(hopControl);

      const filters = el('details', 'dusk-dep-graph__filters');
      filters.innerHTML = '<summary>Filter kinds</summary>';
      const grid = el('div', 'dusk-dep-graph__filter-grid');
      for (const [kind, meta] of Object.entries(KIND_META)) {
        const item = el('label', 'dusk-dep-graph__filter-item');
        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.checked = true;
        checkbox.addEventListener('change', () => {
          this._state.enabledKinds[kind] = checkbox.checked;
          this._render();
        });
        item.append(checkbox, Object.assign(document.createElement('span'), { textContent: meta.label }));
        grid.appendChild(item);
      }
      filters.appendChild(grid);

      const zoomBox = el('div', 'dusk-dep-graph__zoom');
      zoomBox.innerHTML = '<span>Zoom</span>';
      const zoomControls = el('div', 'dusk-dep-graph__zoom-controls');
      const mkButton = (label, handler, extraClass) => {
        const button = el('button', `dusk-dep-graph__zoom-button${extraClass ? ' ' + extraClass : ''}`, label);
        button.type = 'button';
        button.addEventListener('click', handler);
        return button;
      };
      this._zoomReadout = mkButton('', () => this._resetZoom(), 'dusk-dep-graph__zoom-button--readout');
      zoomControls.append(
        mkButton('&minus;', () => this._zoomOut()),
        this._zoomReadout,
        mkButton('+', () => this._zoomIn()),
      );
      zoomBox.appendChild(zoomControls);
      box.append(zoomBox, filters);

      this.querySelector('.dusk-dep-graph__commit').textContent = `commit ${this._graph.commitHash.slice(0, 12)}`;
      this._updateZoomReadout();
    }

    _syncSearchInput() {
      if (!this._searchInput) return;
      this._searchInput.value = this.nodeById.get(this._state.selectedNodeId)?.label ?? this._state.selectedNodeId;
    }

    /* ================= visibility pipeline (ported computed chain) ================= */
    _baseVisibleNodeIds() {
      const { selectedNodeId, hopCount, enabledKinds } = this._state;
      const seed = this.nodeById.get(selectedNodeId);
      if (!seed) return new Set();
      const visited = new Set([seed.id]);
      const queue = [{ id: seed.id, depth: 0 }];
      while (queue.length > 0) {
        const current = queue.shift();
        if (!current || current.depth >= hopCount) continue;
        for (const edge of this.outgoingMap.get(current.id) ?? []) {
          if (!visited.has(edge.to)) { visited.add(edge.to); queue.push({ id: edge.to, depth: current.depth + 1 }); }
        }
        for (const edge of this.incomingMap.get(current.id) ?? []) {
          if (!visited.has(edge.from)) { visited.add(edge.from); queue.push({ id: edge.from, depth: current.depth + 1 }); }
        }
      }
      for (const id of [...visited]) {
        const node = this.nodeById.get(id);
        if (node && !enabledKinds[node.kind] && id !== selectedNodeId) visited.delete(id);
      }
      return visited;
    }

    _pipeline() {
      const g = this._graph;
      const { selectedNodeId } = this._state;

      const baseVisibleNodeIds = this._baseVisibleNodeIds();
      const baseVisibleEdges = g.edges.filter((e) => baseVisibleNodeIds.has(e.from) && baseVisibleNodeIds.has(e.to));

      const selectedNode = this.nodeById.get(selectedNodeId) ?? null;
      const useReducedAggregationView = selectedNode
        && this._state.hopCount >= 2
        && (AGGREGATOR_FOCUS_IDS.has(selectedNode.id) || selectedNode.kind === 'msm_term' || selectedNode.kind === 'pairing_term');

      const immediateBaseNeighborIds = new Set([selectedNodeId]);
      for (const edge of baseVisibleEdges) {
        if (edge.from === selectedNodeId || edge.to === selectedNodeId) {
          immediateBaseNeighborIds.add(edge.from);
          immediateBaseNeighborIds.add(edge.to);
        }
      }

      const visibleNodeIds = (() => {
        if (!useReducedAggregationView) return baseVisibleNodeIds;
        const keep = new Set(immediateBaseNeighborIds);
        for (const id of baseVisibleNodeIds) {
          const node = this.nodeById.get(id);
          if (!node) continue;
          if (node.tags?.includes('omitted')) { keep.add(id); continue; }
          if (AGGREGATOR_FOCUS_IDS.has(node.id) || node.kind === 'final_check') keep.add(id);
        }
        return keep;
      })();

      const visibleNodes = [...visibleNodeIds]
        .map((id) => this.nodeById.get(id))
        .filter(Boolean)
        .sort((l, r) => (l.layout.columnIndex !== r.layout.columnIndex
          ? l.layout.columnIndex - r.layout.columnIndex
          : l.layout.centerY - r.layout.centerY));

      const visibleEdges = baseVisibleEdges.filter((e) => visibleNodeIds.has(e.from) && visibleNodeIds.has(e.to));

      const ambientTagsByNodeId = new Map();
      for (const node of visibleNodes) {
        const entries = [];
        for (const ambientInputId of node.ambientInputs ?? []) {
          const source = this.nodeById.get(ambientInputId);
          if (!source) continue;
          const label = source.shortLabel ?? source.label.replaceAll('_challenge', '').replaceAll('_eval', '');
          if (!entries.some((entry) => entry.label === label)) {
            entries.push({ label, stroke: COMPONENT_WIRE_META[source.component ?? 'challenge'].stroke });
          }
        }
        if (entries.length > 0) ambientTagsByNodeId.set(node.id, entries);
      }
      for (const [nodeId, entries] of ambientTagsByNodeId) {
        if (entries.length > 4) {
          ambientTagsByNodeId.set(nodeId, [...entries.slice(0, 3), { label: `+${entries.length - 3}`, stroke: '#94a3b8' }]);
        }
      }

      return { baseVisibleNodeIds, baseVisibleEdges, selectedNodeId, selectedNode, useReducedAggregationView, immediateBaseNeighborIds, visibleNodeIds, visibleNodes, visibleEdges, ambientTagsByNodeId };
    }

    _layout(pipeline) {
      const g = this._graph;
      const layoutMeta = g.layout;
      const { visibleNodes, visibleEdges, selectedNodeId } = pipeline;

      // ---- group visible nodes into layer blocks (splitting the vulnerable bus) ----
      const byColumnId = new Map();
      for (const node of visibleNodes) {
        const column = this.columnMetaById.get(node.layout.columnId);
        if (!column) continue;
        const block = byColumnId.get(column.id) ?? {
          id: `block:${column.id}`, columnId: column.id, originalColumnIndex: column.index,
          layerId: column.layerId, label: column.layerLabel, nodes: [],
        };
        block.nodes.push(node);
        byColumnId.set(column.id, block);
      }
      const visibleBlocks = [...byColumnId.values()]
        .flatMap((block) => {
          if (block.layerId !== 'proof_evals') return [block];
          const safeNodes = block.nodes.filter((n) => !n.tags?.includes('omitted'));
          const omittedNodes = block.nodes.filter((n) => n.tags?.includes('omitted'));
          const split = [];
          if (safeNodes.length > 0) split.push({ ...block, id: `${block.id}:safe`, label: block.label, nodes: safeNodes, splitOrder: 0 });
          if (omittedNodes.length > 0) split.push({ ...block, id: `${block.id}:omitted`, label: 'Vulnerable Bus', nodes: omittedNodes, splitOrder: 1 });
          return split;
        })
        .map((block) => ({
          ...block,
          nodes: [...block.nodes].sort((l, r) => {
            const rankDiff = (l.displayRank ?? 0) - (r.displayRank ?? 0);
            if (rankDiff !== 0) return rankDiff;
            return l.layout.centerY - r.layout.centerY;
          }),
        }))
        .sort((l, r) => (l.originalColumnIndex !== r.originalColumnIndex
          ? l.originalColumnIndex - r.originalColumnIndex
          : (l.splitOrder ?? 0) - (r.splitOrder ?? 0)));

      const blockIdByNodeId = new Map();
      for (const block of visibleBlocks) for (const node of block.nodes) blockIdByNodeId.set(node.id, block.id);

      // ---- block-level reachability for column packing ----
      const adjacency = new Map(visibleBlocks.map((b) => [b.id, new Set()]));
      for (const edge of visibleEdges) {
        const from = blockIdByNodeId.get(edge.from);
        const to = blockIdByNodeId.get(edge.to);
        if (from && to && from !== to) adjacency.get(from)?.add(to);
      }
      const blockReachability = new Map();
      for (const block of visibleBlocks) {
        const visited = new Set();
        const queue = [...(adjacency.get(block.id) ?? [])];
        while (queue.length > 0) {
          const current = queue.shift();
          if (!current || visited.has(current)) continue;
          visited.add(current);
          for (const next of adjacency.get(current) ?? []) if (!visited.has(next)) queue.push(next);
        }
        blockReachability.set(block.id, visited);
      }

      const edgeRoutingOrder = (edge) => (this.dangerousDownstreamEdgeIds.has(edge.id)
        ? -1
        : COMPONENT_WIRE_META[edge.component ?? 'generic'].order);

      // ---- pack blocks into display columns ----
      const dedicatedLoopbackLayers = new Set(['vk_commitments', 'transcript', 'challenges', 'aggregation']);
      const packed = [];
      for (const block of visibleBlocks) {
        let target = null;
        const isDedicated = dedicatedLoopbackLayers.has(block.layerId);
        for (const displayColumn of packed) {
          const sameLayerOnly = displayColumn.blocks.length > 0
            && displayColumn.blocks.every((o) => o.layerId === block.layerId);
          if (isDedicated && sameLayerOnly) { target = displayColumn; break; }
          if (isDedicated || displayColumn.blocks.some((o) => dedicatedLoopbackLayers.has(o.layerId))) continue;
          const conflicts = displayColumn.blocks.some((o) =>
            blockReachability.get(block.id)?.has(o.id) || blockReachability.get(o.id)?.has(block.id));
          if (!conflicts) { target = displayColumn; break; }
        }
        if (!target) { target = { id: `display:${packed.length}`, blocks: [] }; packed.push(target); }
        target.blocks.push(block);
      }
      const packedDisplayColumns = packed.map((c, index) => ({
        ...c, index,
        blocks: [...c.blocks].sort((l, r) => l.originalColumnIndex - r.originalColumnIndex),
      }));

      const displayColumnIndexByBlockId = new Map();
      for (const column of packedDisplayColumns) {
        for (const block of column.blocks) displayColumnIndexByBlockId.set(block.id, column.index);
      }

      // ---- display column centers sized by inter-column traffic ----
      const gapLoads = new Map();
      for (const edge of visibleEdges) {
        const fromBlock = blockIdByNodeId.get(edge.from);
        const toBlock = blockIdByNodeId.get(edge.to);
        const fromColumn = fromBlock == null ? null : displayColumnIndexByBlockId.get(fromBlock);
        const toColumn = toBlock == null ? null : displayColumnIndexByBlockId.get(toBlock);
        if (fromColumn == null || toColumn == null) continue;
        for (let gap = Math.min(fromColumn, toColumn); gap < Math.max(fromColumn, toColumn); gap += 1) {
          gapLoads.set(gap, (gapLoads.get(gap) ?? 0) + 1);
        }
      }
      const displayColumnCenters = new Map();
      let cursor = 44 + layoutMeta.nodeWidth / 2;
      for (const column of packedDisplayColumns) {
        displayColumnCenters.set(column.index, cursor);
        if (column.index === packedDisplayColumns.length - 1) continue;
        const gapLoad = gapLoads.get(column.index) ?? 0;
        cursor += layoutMeta.nodeWidth + 46 + Math.min(32, gapLoad * 4);
      }

      // ---- final display layout ----
      const headerHeight = 18;
      const blockPaddingTop = 18;
      const blockPaddingBottom = 12;
      const blockGap = 18;
      const nodeGap = 10;
      const groupGap = 10;

      const renderedColumns = packedDisplayColumns.map((displayColumn) => {
        const mergedBlocks = [];
        for (const block of displayColumn.blocks) {
          const previous = mergedBlocks[mergedBlocks.length - 1];
          if (previous && previous.layerId === block.layerId) {
            previous.sourceBlockIds.push(block.id);
            previous.nodes.push(...block.nodes);
            continue;
          }
          mergedBlocks.push({
            id: `display-block:${displayColumn.index}:${mergedBlocks.length}`,
            label: block.label, layerId: block.layerId, sourceBlockIds: [block.id], nodes: [...block.nodes],
          });
        }
        return {
          ...displayColumn,
          blocks: mergedBlocks.map((block) => ({
            ...block,
            nodes: [...block.nodes].sort((l, r) => {
              const rankDiff = (l.displayRank ?? 0) - (r.displayRank ?? 0);
              if (rankDiff !== 0) return rankDiff;
              if (l.layout.columnIndex !== r.layout.columnIndex) return l.layout.columnIndex - r.layout.columnIndex;
              return l.layout.centerY - r.layout.centerY;
            }),
          })),
        };
      });

      const nodeDisplays = new Map();
      const displayBlocks = [];
      let overallBottom = layoutMeta.topPad;

      for (const displayColumn of renderedColumns) {
        const centerX = displayColumnCenters.get(displayColumn.index) ?? (44 + layoutMeta.nodeWidth / 2);
        let cursorY = layoutMeta.topPad;
        for (const block of displayColumn.blocks) {
          const blockTop = cursorY;
          const headingY = blockTop + 12;
          cursorY += headerHeight + blockPaddingTop;
          let previousGroup = '';
          for (const node of block.nodes) {
            if (previousGroup && previousGroup !== node.group) cursorY += groupGap;
            const centerY = cursorY + node.layout.height / 2;
            nodeDisplays.set(node.id, {
              ...node, blockId: block.id, displayColumnIndex: displayColumn.index,
              displayX: centerX - node.layout.width / 2, displayY: centerY - node.layout.height / 2,
              displayCenterX: centerX, displayCenterY: centerY,
            });
            cursorY += node.layout.height + nodeGap;
            previousGroup = node.group;
          }
          const blockBottom = cursorY + blockPaddingBottom;
          displayBlocks.push({
            id: block.id, label: block.label, layerId: block.layerId, displayColumnIndex: displayColumn.index,
            x: centerX - layoutMeta.nodeWidth / 2 - 10, y: blockTop,
            width: layoutMeta.nodeWidth + 20, height: Math.max(44, blockBottom - blockTop), headingY,
          });
          cursorY = blockBottom + blockGap;
          overallBottom = Math.max(overallBottom, blockBottom);
        }
      }

      const displayColumnRightEdge = new Map();
      for (const block of displayBlocks) {
        displayColumnRightEdge.set(block.displayColumnIndex,
          Math.max(displayColumnRightEdge.get(block.displayColumnIndex) ?? 0, block.x + block.width));
      }

      // ---- per-node port offsets ----
      const visibleOutgoingByNode = new Map();
      const visibleIncomingByNode = new Map();
      for (const edge of visibleEdges) {
        const out = visibleOutgoingByNode.get(edge.from) ?? [];
        out.push(edge); visibleOutgoingByNode.set(edge.from, out);
        const inc = visibleIncomingByNode.get(edge.to) ?? [];
        inc.push(edge); visibleIncomingByNode.set(edge.to, inc);
      }
      const outgoingPortOffsets = new Map();
      const incomingPortOffsets = new Map();
      for (const node of visibleNodes) {
        const displayNode = nodeDisplays.get(node.id);
        if (!displayNode) continue;
        const outgoingEdges = [...(visibleOutgoingByNode.get(node.id) ?? [])].sort((l, r) => {
          const lp = nodeDisplays.get(l.to);
          const rp = nodeDisplays.get(r.to);
          if ((lp?.displayCenterY ?? 0) !== (rp?.displayCenterY ?? 0)) return (lp?.displayCenterY ?? 0) - (rp?.displayCenterY ?? 0);
          return l.id.localeCompare(r.id);
        });
        const outgoingOffsets = distributeOffsets(outgoingEdges.length, 8, node.layout.height);
        outgoingEdges.forEach((edge, index) => {
          outgoingPortOffsets.set(edge.id, outgoingOffsets[index] ?? 0);
        });
        const incomingEdges = [...(visibleIncomingByNode.get(node.id) ?? [])].sort((l, r) => {
          const lp = nodeDisplays.get(l.from);
          const rp = nodeDisplays.get(r.from);
          if ((lp?.displayCenterY ?? 0) !== (rp?.displayCenterY ?? 0)) return (lp?.displayCenterY ?? 0) - (rp?.displayCenterY ?? 0);
          return l.id.localeCompare(r.id);
        });
        const incomingOffsets = distributeOffsets(incomingEdges.length, 8, node.layout.height);
        incomingEdges.forEach((edge, index) => {
          incomingPortOffsets.set(edge.id, incomingOffsets[index] ?? 0);
        });
      }

      // ---- trunk tracks for cross-column edges ----
      const edgesByTrunkGap = new Map();
      for (const edge of visibleEdges) {
        const from = nodeDisplays.get(edge.from);
        const to = nodeDisplays.get(edge.to);
        if (!from || !to || from.displayColumnIndex === to.displayColumnIndex) continue;
        const left = Math.min(from.displayColumnIndex, to.displayColumnIndex);
        const right = Math.max(from.displayColumnIndex, to.displayColumnIndex);
        const trunkGap = Math.floor((left + right - 1) / 2);
        const bucket = edgesByTrunkGap.get(trunkGap) ?? [];
        bucket.push(edge);
        edgesByTrunkGap.set(trunkGap, bucket);
      }
      const trackXByEdgeId = new Map();
      for (const [gapIndex, edgesInGap] of edgesByTrunkGap) {
        const leftCenter = displayColumnCenters.get(gapIndex) ?? 0;
        const rightCenter = displayColumnCenters.get(gapIndex + 1) ?? leftCenter + layoutMeta.nodeWidth + 46;
        const gapMid = (leftCenter + rightCenter) / 2;
        const sortedEdges = [...edgesInGap].sort((l, r) => {
          const lo = edgeRoutingOrder(l);
          const ro = edgeRoutingOrder(r);
          if (lo !== ro) return lo - ro;
          const lm = ((nodeDisplays.get(l.from)?.displayCenterY ?? 0) + (nodeDisplays.get(l.to)?.displayCenterY ?? 0)) / 2;
          const rm = ((nodeDisplays.get(r.from)?.displayCenterY ?? 0) + (nodeDisplays.get(r.to)?.displayCenterY ?? 0)) / 2;
          if (lm !== rm) return lm - rm;
          return l.id.localeCompare(r.id);
        });
        const offsets = distributeOffsets(sortedEdges.length, 10, 200, 0);
        sortedEdges.forEach((edge, index) => {
          trackXByEdgeId.set(edge.id, gapMid + (offsets[index] ?? 0));
        });
      }

      // ---- side tracks for same-column edges ----
      const sameColumnEdges = new Map();
      for (const edge of visibleEdges) {
        const from = nodeDisplays.get(edge.from);
        const to = nodeDisplays.get(edge.to);
        if (!from || !to || from.displayColumnIndex !== to.displayColumnIndex) continue;
        const bucket = sameColumnEdges.get(from.displayColumnIndex) ?? [];
        bucket.push(edge);
        sameColumnEdges.set(from.displayColumnIndex, bucket);
      }
      const sameColumnTrackX = new Map();
      for (const [columnIndex, edgesInColumn] of sameColumnEdges) {
        const rightEdge = displayColumnRightEdge.get(columnIndex) ?? 0;
        const sortedEntries = edgesInColumn
          .map((edge) => {
            const from = nodeDisplays.get(edge.from);
            const to = nodeDisplays.get(edge.to);
            return {
              edge,
              intervalStart: Math.min(from?.displayCenterY ?? 0, to?.displayCenterY ?? 0),
              intervalEnd: Math.max(from?.displayCenterY ?? 0, to?.displayCenterY ?? 0),
            };
          })
          .sort((l, r) => {
            const lo = edgeRoutingOrder(l.edge);
            const ro = edgeRoutingOrder(r.edge);
            if (lo !== ro) return lo - ro;
            if (l.intervalStart !== r.intervalStart) return l.intervalStart - r.intervalStart;
            const ls = l.intervalEnd - l.intervalStart;
            const rs = r.intervalEnd - r.intervalStart;
            if (ls !== rs) return rs - ls;
            return l.edge.id.localeCompare(r.edge.id);
          });
        const trackEnds = [];
        for (const entry of sortedEntries) {
          let trackIndex = -1;
          for (let i = 0; i < trackEnds.length; i += 1) {
            if (trackEnds[i] + 8 <= entry.intervalStart) { trackIndex = i; break; }
          }
          if (trackIndex === -1) { trackIndex = trackEnds.length; trackEnds.push(entry.intervalEnd); }
          else trackEnds[trackIndex] = entry.intervalEnd;
          sameColumnTrackX.set(entry.edge.id, rightEdge + 18 + trackIndex * 12);
        }
      }

      const displayEdges = visibleEdges.map((edge) => {
        const from = nodeDisplays.get(edge.from);
        const to = nodeDisplays.get(edge.to);
        if (!from || !to) return { ...edge, displayPoints: [] };
        const startX = from.displayCenterX + from.layout.width / 2;
        const sameColumn = from.displayColumnIndex === to.displayColumnIndex;
        const endX = sameColumn ? to.displayCenterX + to.layout.width / 2 : to.displayCenterX - to.layout.width / 2;
        const startY = from.displayCenterY + (outgoingPortOffsets.get(edge.id) ?? 0);
        const endY = to.displayCenterY + (incomingPortOffsets.get(edge.id) ?? 0);
        const trackX = sameColumn
          ? sameColumnTrackX.get(edge.id) ?? Math.max(startX, endX) + 18
          : trackXByEdgeId.get(edge.id) ?? (startX + endX) / 2;
        return {
          ...edge,
          displayPoints: [
            { x: startX, y: startY }, { x: trackX, y: startY }, { x: trackX, y: endY }, { x: endX, y: endY },
          ],
        };
      });

      // ---- selection highlight sets ----
      const selectedPathEdgeIds = new Set();
      if (pipeline.visibleNodeIds.has(selectedNodeId)) {
        const forwardVisited = new Set([selectedNodeId]);
        const forwardQueue = [selectedNodeId];
        while (forwardQueue.length > 0) {
          const current = forwardQueue.shift();
          if (!current) continue;
          for (const edge of this.outgoingMap.get(current) ?? []) {
            if (!pipeline.visibleNodeIds.has(edge.to)) continue;
            selectedPathEdgeIds.add(edge.id);
            if (!forwardVisited.has(edge.to)) { forwardVisited.add(edge.to); forwardQueue.push(edge.to); }
          }
        }
        const backwardVisited = new Set([selectedNodeId]);
        const backwardQueue = [selectedNodeId];
        while (backwardQueue.length > 0) {
          const current = backwardQueue.shift();
          if (!current) continue;
          for (const edge of this.incomingMap.get(current) ?? []) {
            if (!pipeline.visibleNodeIds.has(edge.from)) continue;
            selectedPathEdgeIds.add(edge.id);
            if (!backwardVisited.has(edge.from)) { backwardVisited.add(edge.from); backwardQueue.push(edge.from); }
          }
        }
      }
      const selectedPathNodeIds = new Set([selectedNodeId]);
      for (const edge of visibleEdges) {
        if (selectedPathEdgeIds.has(edge.id)) { selectedPathNodeIds.add(edge.from); selectedPathNodeIds.add(edge.to); }
      }

      return {
        displayBlocks, displayEdges,
        displayNodes: [...nodeDisplays.values()].sort((l, r) => (l.displayColumnIndex !== r.displayColumnIndex
          ? l.displayColumnIndex - r.displayColumnIndex
          : l.displayCenterY - r.displayCenterY)),
        nodeDisplayById: nodeDisplays,
        selectedPathEdgeIds, selectedPathNodeIds,
        bottomY: overallBottom,
      };
    }

    /* ================= styling helpers ================= */
    _nodeStyle(node) {
      if (node.tags?.includes('omitted')) {
        return { label: 'Omitted', fill: '#0f172a', stroke: '#fb7185', text: '#fecdd3' };
      }
      return KIND_META[node.kind] ?? KIND_META.proof_eval;
    }

    _edgeStyle(edge) {
      const base = EDGE_META[edge.kind] ?? EDGE_META.used_in;
      if (this.dangerousDownstreamEdgeIds.has(edge.id)) {
        return { stroke: COMPONENT_WIRE_META.omitted.stroke, dash: base.dash };
      }
      return { stroke: COMPONENT_WIRE_META[edge.component ?? 'generic'].stroke ?? base.stroke, dash: base.dash };
    }

    _edgeOpacity(edge, ctx) {
      if (ctx.useImmediateFocus) {
        if (ctx.selectedImmediateEdgeIds.has(edge.id)) return 0.98;
        if (this.dangerousDownstreamEdgeIds.has(edge.id)) return ctx.selectedPathEdgeIds.has(edge.id) ? 0.92 : 0.32;
        if (ctx.selectedPathEdgeIds.has(edge.id)) return 0.1;
        return 0.035;
      }
      if (ctx.selectedPathEdgeIds.has(edge.id)) return 0.98;
      if (this.dangerousDownstreamEdgeIds.has(edge.id)) return 0.34;
      return 0.12;
    }

    _edgeWidth(edge, ctx) {
      if (ctx.useImmediateFocus) {
        if (this.dangerousDownstreamEdgeIds.has(edge.id) && !ctx.selectedImmediateEdgeIds.has(edge.id)) return 2.5;
        return ctx.selectedImmediateEdgeIds.has(edge.id) ? 3.4 : 1.8;
      }
      if (ctx.selectedPathEdgeIds.has(edge.id)) return 3.3;
      if (this.dangerousDownstreamEdgeIds.has(edge.id)) return 2.8;
      return 2;
    }

    _nodeOpacity(node, ctx) {
      if (ctx.useImmediateFocus) {
        if (ctx.selectedImmediateNodeIds.has(node.id)) return 1;
        if (ctx.selectedPathNodeIds.has(node.id)) return 0.18;
        return 0.08;
      }
      return ctx.selectedPathNodeIds.has(node.id) ? 1 : 0.28;
    }

    _ambientTagX(nodeId, index, pipeline) {
      const tags = pipeline.ambientTagsByNodeId.get(nodeId) ?? [];
      const gap = 4;
      const widths = tags.map((t) => ambientTagWidth(t.label));
      const totalWidth = widths.reduce((s, w) => s + w, 0) + Math.max(0, widths.length - 1) * gap;
      let cursor = Math.max(4, (this._graph.layout.nodeWidth - totalWidth) / 2);
      for (let i = 0; i < index; i += 1) cursor += widths[i] + gap;
      return cursor;
    }

    /* ================= render ================= */
    _render() {
      if (!this._graph) return;
      const pipeline = this._pipeline();
      const layout = this._layout(pipeline);
      this._layoutCache = { pipeline, layout };

      const { selectedNode } = pipeline;
      const useImmediateFocus = selectedNode
        && (AGGREGATOR_FOCUS_IDS.has(selectedNode.id) || selectedNode.kind === 'msm_term' || selectedNode.kind === 'pairing_term');
      const selectedImmediateEdgeIds = new Set(pipeline.visibleEdges.filter((e) => e.from === this._state.selectedNodeId || e.to === this._state.selectedNodeId).map((e) => e.id));
      const selectedImmediateNodeIds = new Set([this._state.selectedNodeId]);
      for (const edge of pipeline.visibleEdges) {
        if (selectedImmediateEdgeIds.has(edge.id)) { selectedImmediateNodeIds.add(edge.from); selectedImmediateNodeIds.add(edge.to); }
      }
      const ctx = { useImmediateFocus, selectedImmediateEdgeIds, selectedImmediateNodeIds, selectedPathEdgeIds: layout.selectedPathEdgeIds, selectedPathNodeIds: layout.selectedPathNodeIds };

      // ---- SVG contents ----
      const parts = [];
      for (const block of layout.displayBlocks) {
        const dangerous = block.label === 'Vulnerable Bus';
        parts.push(
          `<rect class="dusk-dep-graph__block-box" x="${block.x}" y="${block.y}" width="${block.width}" height="${block.height}" rx="14"></rect>` +
          `<text class="dusk-dep-graph__block-label${dangerous ? ' dusk-dep-graph__block-label--dangerous' : ''}" x="${block.x + block.width / 2}" y="${block.headingY}" text-anchor="middle">${escapeHtml(block.label)}</text>`,
        );
      }
      for (const edge of layout.displayEdges) {
        const style = this._edgeStyle(edge);
        const dangerous = this.dangerousDownstreamEdgeIds.has(edge.id);
        parts.push(
          `<path class="dusk-dep-graph__edge${dangerous ? ' dusk-dep-graph__edge--dangerous' : ''}" d="${pathFromPoints(edge.displayPoints)}"` +
          ` stroke="${style.stroke}" stroke-width="${this._edgeWidth(edge, ctx)}" opacity="${this._edgeOpacity(edge, ctx)}"` +
          `${style.dash ? ` stroke-dasharray="${style.dash}"` : ''} marker-end="url(#dusk-dep-arrow)"></path>`,
        );
      }
      for (const node of layout.displayNodes) {
        const nodeStyle = this._nodeStyle(node);
        const isSelected = this._state.selectedNodeId === node.id;
        const ambientTags = pipeline.ambientTagsByNodeId.get(node.id) ?? [];
        const tagMarkup = ambientTags.map((tag, index) => {
          const width = ambientTagWidth(tag.label);
          return `<g class="dusk-dep-graph__ambient-tag" transform="translate(${this._ambientTagX(node.id, index, pipeline)}, -14)">` +
            `<rect class="dusk-dep-graph__ambient-tag-box" width="${width}" height="12" rx="6" stroke="${tag.stroke}"></rect>` +
            `<text class="dusk-dep-graph__ambient-tag-text" x="${width / 2}" y="8.5" text-anchor="middle">${escapeHtml(tag.label)}</text></g>`;
        }).join('');
        const lines = labelLines(node.label);
        const tspans = lines.map((line, index) =>
          `<tspan x="5" dy="${index === 0 ? 0 : 15}">${escapeHtml(line)}</tspan>`).join('');
        parts.push(
          `<g class="dusk-dep-graph__node" data-node-id="${escapeHtml(node.id)}" transform="translate(${node.displayX}, ${node.displayY})" opacity="${this._nodeOpacity(node, ctx)}">` +
          `<title>${escapeHtml(node.label)}</title>${tagMarkup}` +
          `<rect class="dusk-dep-graph__node-box" width="${node.layout.width}" height="${node.layout.height}" rx="10"` +
          ` fill="${nodeStyle.fill}" stroke="${isSelected ? '#f8fafc' : nodeStyle.stroke}" stroke-width="${isSelected ? 2.8 : 1.5}"></rect>` +
          `<text class="dusk-dep-graph__node-label" fill="${nodeStyle.text}" x="5" y="${labelStartY(node.label)}">${tspans}</text></g>`,
        );
      }
      const content = this._svg.querySelector('defs');
      this._svg.textContent = '';
      this._svg.appendChild(content);
      this._svg.insertAdjacentHTML('beforeend', parts.join(''));

      // ---- viewBox ----
      let viewBox = '0 0 900 620';
      if (layout.displayNodes.length > 0) {
        const xValues = layout.displayNodes.flatMap((n) => [n.displayX, n.displayX + n.layout.width]);
        const yValues = layout.displayNodes.flatMap((n) => [n.displayY, n.displayY + n.layout.height]);
        for (const edge of layout.displayEdges) {
          for (const p of edge.displayPoints) { xValues.push(p.x); yValues.push(p.y); }
        }
        for (const block of layout.displayBlocks) { xValues.push(block.x, block.x + block.width); yValues.push(block.y, block.y + block.height); }
        const minX = Math.min(...xValues) - VIEW_PADDING;
        const maxX = Math.max(...xValues) + VIEW_PADDING;
        const minY = Math.max(0, Math.min(...yValues, this._graph.layout.layerLabelY) - VIEW_PADDING);
        const maxY = Math.max(...yValues) + VIEW_PADDING;
        viewBox = `${minX} ${minY} ${maxX - minX} ${maxY - minY}`;
      }
      this._svg.setAttribute('viewBox', viewBox);
      this._viewBounds = {
        minX: Number(viewBox.split(' ')[0]),
        minY: Number(viewBox.split(' ')[1]),
        width: Number(viewBox.split(' ')[2]) || 900,
        height: Number(viewBox.split(' ')[3]) || 620,
      };
      this._applyCanvasSize();
      this._renderDetail(pipeline);
    }

    _renderDetail(pipeline) {
      const node = pipeline.selectedNode;
      if (!node) {
        this._detail.hidden = true;
        return;
      }
      this._detail.hidden = false;
      const formatKind = (kind) => KIND_META[kind]?.label ?? kind.replaceAll('_', ' ');
      const why = node.callout?.trim() ?? '';
      const summary = node.summary?.trim() ?? '';
      const callout = why && why !== summary ? why : '';
      const omitted = node.tags?.includes('omitted');

      const edgePeer = (edge, direction) =>
        this.nodeById.get(direction === 'incoming' ? edge.from : edge.to) ?? null;
      const filterEdges = (edges, direction) =>
        edges.filter((edge) => {
          const peer = edgePeer(edge, direction);
          return peer && (this._state.enabledKinds[peer.kind] || peer.id === this._state.selectedNodeId);
        });
      const edgeList = (edges, direction) => filterEdges(edges, direction).map((edge) => {
        const peer = edgePeer(edge, direction);
        const anchor = edge.anchors?.[0];
        return `<li><strong>${escapeHtml(peer?.label ?? (direction === 'incoming' ? edge.from : edge.to))}</strong>` +
          `<span>${escapeHtml(edge.summary)}</span>` +
          (anchor ? `<a href="${escapeHtml(anchor.url)}" target="_blank" rel="noreferrer">${escapeHtml(anchor.file)}:${anchor.startLine}</a>` : '') +
          '</li>';
      }).join('');

      this._detail.innerHTML =
        `<div class="dusk-dep-graph__detail-header">
          <div>
            <p class="dusk-dep-graph__detail-eyebrow">${escapeHtml(formatKind(node.kind))}</p>
            <h4 class="dusk-dep-graph__detail-title">${escapeHtml(node.label)}</h4>
          </div>
          <div class="dusk-dep-graph__detail-badges">
            <span class="dusk-dep-graph__badge">${escapeHtml(node.group)}</span>
            ${omitted ? '<span class="dusk-dep-graph__badge dusk-dep-graph__badge--omitted">omitted from opening</span>' : ''}
          </div>
        </div>
        <p class="dusk-dep-graph__detail-copy">${escapeHtml(node.summary)}</p>
        ${callout ? `<p class="dusk-dep-graph__detail-callout">${escapeHtml(callout)}</p>` : ''}
        <div class="dusk-dep-graph__detail-grid">
          <div class="dusk-dep-graph__detail-block">
            <h5>Code anchors</h5>
            <ul class="dusk-dep-graph__anchor-list">${
              (node.anchors ?? []).map((a) =>
                `<li><a href="${escapeHtml(a.url)}" target="_blank" rel="noreferrer">${escapeHtml(a.label)}</a><span>${escapeHtml(a.file)}:${a.startLine}</span></li>`).join('')
            }</ul>
          </div>
          <div class="dusk-dep-graph__detail-block">
            <h5>Incoming edges</h5>
            <ul class="dusk-dep-graph__edge-list">${edgeList(this.incomingMap.get(node.id) ?? [], 'incoming')}</ul>
          </div>
          <div class="dusk-dep-graph__detail-block">
            <h5>Outgoing edges</h5>
            <ul class="dusk-dep-graph__edge-list">${edgeList(this.outgoingMap.get(node.id) ?? [], 'outgoing')}</ul>
          </div>
        </div>`;
    }

    /* ================= pan / zoom (ported useScrollGraphPanZoom) ================= */
    _applyCanvasSize() {
      const bounds = this._viewBounds ?? { width: 900, height: 620 };
      // Keep one SVG unit equal to one CSS pixel at 100%, even for small slices.
      const width = bounds.width * this._zoom.scale;
      const height = bounds.height * this._zoom.scale;
      this._svg.style.width = `${width}px`;
      this._svg.style.minWidth = `${width}px`;
      this._svg.style.height = `${height}px`;
    }

    _canvasOffset() {
      const wrap = this._canvasWrap;
      const viewport = wrap.getBoundingClientRect();
      const canvas = this._svg.getBoundingClientRect();
      // The stage centers small graphs without changing their scale.
      return {
        x: canvas.left - viewport.left - wrap.clientLeft + wrap.scrollLeft,
        y: canvas.top - viewport.top - wrap.clientTop + wrap.scrollTop,
      };
    }

    _updateZoomReadout() {
      if (this._zoomReadout) this._zoomReadout.textContent = `${Math.round(this._zoom.scale * 100)}%`;
    }

    _setZoom(nextScale, origin) {
      const wrap = this._canvasWrap;
      const previous = this._zoom.scale;
      const clamped = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, nextScale));
      if (!wrap || clamped === previous) {
        this._zoom.scale = clamped;
        this._updateZoomReadout();
        return;
      }
      const rect = wrap.getBoundingClientRect();
      const originX = origin ? origin.clientX - rect.left - wrap.clientLeft : wrap.clientWidth / 2;
      const originY = origin ? origin.clientY - rect.top - wrap.clientTop : wrap.clientHeight / 2;
      const offset = this._canvasOffset();
      const contentX = wrap.scrollLeft + originX - offset.x;
      const contentY = wrap.scrollTop + originY - offset.y;
      const ratio = clamped / previous;
      this._zoom.scale = clamped;
      requestAnimationFrame(() => {
        const nextOffset = this._canvasOffset();
        wrap.scrollLeft = Math.max(0, contentX * ratio + nextOffset.x - originX);
        wrap.scrollTop = Math.max(0, contentY * ratio + nextOffset.y - originY);
      });
      this._applyCanvasSize();
      this._updateZoomReadout();
    }

    _zoomIn() { this._setZoom(this._zoom.scale * 1.15); }
    _zoomOut() { this._setZoom(this._zoom.scale / 1.15); }
    _resetZoom() {
      this._setZoom(1);
      requestAnimationFrame(() => this._centerOnSelection());
    }

    _wheelZoom(event) {
      if (event.ctrlKey || event.metaKey) {
        event.preventDefault();
        const direction = event.deltaY > 0 ? 0.92 : 1.08;
        this._setZoom(this._zoom.scale * direction, { clientX: event.clientX, clientY: event.clientY });
      }
    }

    _beginPan(event) {
      if (event.pointerType === 'touch' || event.button !== 0) return;
      const target = event.target;
      if (target.closest && target.closest('.dusk-dep-graph__node, .dusk-dep-graph__edge')) return;
      this._zoom.panning = true;
      this._zoom.panStart = { x: event.clientX, y: event.clientY, left: this._canvasWrap.scrollLeft, top: this._canvasWrap.scrollTop };
      this._canvasWrap.classList.add('dusk-dep-graph__canvas-wrap--panning');
      this._canvasWrap.setPointerCapture?.(event.pointerId);
    }

    _continuePan(event) {
      if (!this._zoom.panning || !this._zoom.panStart) return;
      this._canvasWrap.scrollLeft = this._zoom.panStart.left - (event.clientX - this._zoom.panStart.x);
      this._canvasWrap.scrollTop = this._zoom.panStart.top - (event.clientY - this._zoom.panStart.y);
    }

    _endPan(event) {
      if (event && this._canvasWrap.releasePointerCapture && event.pointerId != null) {
        try { this._canvasWrap.releasePointerCapture(event.pointerId); } catch { /* not captured */ }
      }
      this._zoom.panning = false;
      this._zoom.panStart = null;
      this._canvasWrap.classList.remove('dusk-dep-graph__canvas-wrap--panning');
    }

    _touchDistance(event) {
      if (event.touches.length < 2) return 0;
      const [a, b] = [event.touches[0], event.touches[1]];
      return Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
    }

    _touchStart(event) {
      if (event.touches.length === 1) {
        this._zoom.touchPan = {
          x: event.touches[0].clientX, y: event.touches[0].clientY,
          left: this._canvasWrap.scrollLeft, top: this._canvasWrap.scrollTop,
        };
      } else if (event.touches.length === 2) {
        this._zoom.pinch = { distance: this._touchDistance(event), startScale: this._zoom.scale };
      }
    }

    _touchMove(event) {
      if (event.touches.length === 1 && this._zoom.touchPan && this._zoom.pinch.distance === 0) {
        this._canvasWrap.scrollLeft = this._zoom.touchPan.left - (event.touches[0].clientX - this._zoom.touchPan.x);
        this._canvasWrap.scrollTop = this._zoom.touchPan.top - (event.touches[0].clientY - this._zoom.touchPan.y);
        return;
      }
      if (event.touches.length !== 2 || this._zoom.pinch.distance === 0) return;
      event.preventDefault();
      const ratio = this._touchDistance(event) / this._zoom.pinch.distance;
      const [a, b] = [event.touches[0], event.touches[1]];
      this._setZoom(this._zoom.pinch.startScale * ratio, {
        clientX: (a.clientX + b.clientX) / 2,
        clientY: (a.clientY + b.clientY) / 2,
      });
    }

    _touchEnd() {
      this._zoom.pinch.distance = 0;
    }

    _updateViewportMode() {
      this._zoom.isMobile = window.innerWidth <= MOBILE_BREAKPOINT;
    }

    _applyInitialFocus() {
      if (this._zoom.isMobile && !this._zoom.mobileFocused) {
        if (this._state.hopCount === this._graph.defaults.hopCount) {
          this._state.hopCount = MOBILE_FOCUS_HOP_COUNT;
          if (this._hopSelect) this._hopSelect.value = String(MOBILE_FOCUS_HOP_COUNT);
        }
        this._zoom.mobileFocused = true;
      }
      requestAnimationFrame(() => {
        this._zoom.scale = 1;
        this._applyCanvasSize();
        this._updateZoomReadout();
        this._centerOnSelection();
      });
    }

    _centerOnSelection() {
      const node = this.nodeById.get(this._state.selectedNodeId);
      if (!node || !this._layoutCache) return;
      const { nodeDisplayById } = this._layoutCache.layout;
      const displayNode = nodeDisplayById.get(node.id);
      const centerX = displayNode?.displayCenterX ?? node.layout.centerX;
      const centerY = displayNode?.displayCenterY ?? node.layout.centerY;
      const bounds = this._viewBounds ?? { minX: 0, minY: 0, width: 1, height: 1 };
      const offset = this._canvasOffset();
      const pointX = offset.x + (centerX - bounds.minX) * this._zoom.scale;
      const pointY = offset.y + (centerY - bounds.minY) * this._zoom.scale;
      this._canvasWrap.scrollLeft = Math.max(0, pointX - this._canvasWrap.clientWidth / 2);
      this._canvasWrap.scrollTop = Math.max(0, pointY - this._canvasWrap.clientHeight / 2);
    }
  }

  customElements.define('dusk-verifier-graph', DuskVerifierGraph);
})();
