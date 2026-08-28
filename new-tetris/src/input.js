export const INPUT_ACTIONS = Object.freeze([
  "left",
  "right",
  "softDrop",
  "rotateLeft",
  "rotateRight",
  "hardDrop",
  "hold",
  "pause",
  "restart",
]);

export const INPUT_ACTION_LABELS = Object.freeze({
  left: "Move left",
  right: "Move right",
  softDrop: "Move down",
  rotateLeft: "Turn left",
  rotateRight: "Turn right",
  hardDrop: "Drop now",
  hold: "Hold",
  pause: "Pause",
  restart: "Reset game",
});

export const DEFAULT_KEY_BINDINGS = Object.freeze({
  left: Object.freeze(["ArrowLeft"]),
  right: Object.freeze(["ArrowRight"]),
  softDrop: Object.freeze(["ArrowDown"]),
  rotateLeft: Object.freeze(["z"]),
  rotateRight: Object.freeze(["x", "ArrowUp"]),
  hardDrop: Object.freeze([" "]),
  hold: Object.freeze(["c", "Shift"]),
  pause: Object.freeze(["p", "Escape"]),
  restart: Object.freeze(["r"]),
});

const KEY_LABELS = Object.freeze({
  " ": "Space",
  ArrowLeft: "Left",
  ArrowRight: "Right",
  ArrowDown: "Down",
  ArrowUp: "Up",
  Escape: "Esc",
  Shift: "Shift",
  Backspace: "Backspace",
  Enter: "Enter",
});

const FORBIDDEN_BINDING_KEYS = new Set([
  "Alt",
  "Control",
  "Meta",
  "Tab",
  "Dead",
  "Process",
  "Unidentified",
]);

const REPEAT = Object.freeze({
  left: { delay: 150, interval: 45 },
  right: { delay: 150, interval: 45 },
  softDrop: { delay: 60, interval: 35 },
});

function copyBindings(source = DEFAULT_KEY_BINDINGS) {
  return Object.fromEntries(INPUT_ACTIONS.map((action) => [action, [...source[action]]]));
}

export function normalizeBindingKey(key) {
  if (key === "Spacebar") return " ";
  if (typeof key !== "string" || key.length === 0 || FORBIDDEN_BINDING_KEYS.has(key)) return null;
  return key.length === 1 ? key.toLowerCase() : key;
}

export function keyBindingLabel(key) {
  const normalized = normalizeBindingKey(key);
  if (!normalized) return "Unknown";
  return KEY_LABELS[normalized] ?? (normalized.length === 1 ? normalized.toUpperCase() : normalized);
}

export function keyBindingsLabel(keys) {
  return keys.map(keyBindingLabel).join(" / ");
}

export function normalizeKeyBindings(candidate) {
  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) return copyBindings();
  const normalized = {};
  const seen = new Set();
  for (const action of INPUT_ACTIONS) {
    const values = candidate[action];
    if (!Array.isArray(values) || values.length === 0 || values.length > 4) return copyBindings();
    normalized[action] = [];
    for (const value of values) {
      const key = normalizeBindingKey(value);
      if (!key || seen.has(key)) return copyBindings();
      seen.add(key);
      normalized[action].push(key);
    }
  }
  return normalized;
}

function actionForKey(event, bindings) {
  const key = normalizeBindingKey(event.key);
  if (!key) return null;
  return INPUT_ACTIONS.find((action) => bindings[action].includes(key)) ?? null;
}

function isInteractiveTarget(target) {
  return typeof Element !== "undefined"
    && target instanceof Element
    && Boolean(target.closest("button, input, select, textarea, a[href], dialog, [contenteditable]"));
}

export class InputController {
  constructor(game, root = document, { bindings = null, onBindingEvent = null } = {}) {
    this.game = game;
    this.root = root;
    this.held = new Map();
    this.keyActions = new Map();
    this.bindings = normalizeKeyBindings(bindings);
    this.rebindingAction = null;
    this.onBindingEvent = onBindingEvent;

    this.onKeyDown = this.onKeyDown.bind(this);
    this.onKeyUp = this.onKeyUp.bind(this);
    this.onBlur = this.onBlur.bind(this);
    root.addEventListener("keydown", this.onKeyDown);
    root.addEventListener("keyup", this.onKeyUp);
    window.addEventListener("blur", this.onBlur);

    this.buttons = [...root.querySelectorAll("[data-action]")];
    for (const button of this.buttons) this.bindButton(button);
  }

  getBindings() {
    return copyBindings(this.bindings);
  }

  emitBindingEvent(type, detail = {}) {
    this.onBindingEvent?.({ type, ...detail, bindings: this.getBindings() });
  }

  beginRebind(action) {
    if (!INPUT_ACTIONS.includes(action)) throw new RangeError(`Unknown input action: ${action}`);
    this.clearPressedInputs();
    this.rebindingAction = action;
    this.emitBindingEvent("waiting", { action });
  }

  cancelRebind(reason = "user") {
    if (!this.rebindingAction) return;
    const action = this.rebindingAction;
    this.rebindingAction = null;
    this.emitBindingEvent("canceled", { action, reason });
  }

  setBinding(action, value) {
    if (!INPUT_ACTIONS.includes(action)) throw new RangeError(`Unknown input action: ${action}`);
    const key = normalizeBindingKey(value);
    if (!key) throw new RangeError(`Unsupported key: ${value}`);

    const next = this.getBindings();
    const previousKeys = [...next[action]];
    const conflictAction = INPUT_ACTIONS.find((candidate) => (
      candidate !== action && next[candidate].includes(key)
    )) ?? null;
    let conflictReplacement = null;

    next[action] = [key];
    if (conflictAction) {
      conflictReplacement = previousKeys.find((candidate) => candidate !== key) ?? null;
      if (!conflictReplacement) throw new Error(`Cannot swap the key for ${conflictAction}`);
      next[conflictAction] = [conflictReplacement];
    }

    this.bindings = next;
    const detail = { action, key, conflictAction, conflictReplacement };
    this.emitBindingEvent("changed", detail);
    return detail;
  }

  resetBindings() {
    this.clearPressedInputs();
    this.rebindingAction = null;
    this.bindings = copyBindings();
    this.emitBindingEvent("reset");
  }

  onKeyDown(event) {
    if (this.rebindingAction) {
      event.preventDefault();
      event.stopPropagation?.();
      if (event.key === "Escape") {
        this.cancelRebind();
        return;
      }
      if (event.altKey || event.ctrlKey || event.metaKey) {
        this.emitBindingEvent("rejected", { action: this.rebindingAction });
        return;
      }
      const key = normalizeBindingKey(event.key);
      if (!key) {
        this.emitBindingEvent("rejected", { action: this.rebindingAction });
        return;
      }
      const action = this.rebindingAction;
      this.rebindingAction = null;
      this.setBinding(action, key);
      return;
    }

    if (event.altKey || event.ctrlKey || event.metaKey || isInteractiveTarget(event.target)) return;
    const action = actionForKey(event, this.bindings);
    if (!action) return;
    event.preventDefault();
    if (event.repeat || this.keyActions.has(event.code)) return;
    this.keyActions.set(event.code, action);
    this.press(action, `key:${event.code}`);
  }

  onKeyUp(event) {
    const action = this.keyActions.get(event.code);
    if (!action) return;
    event.preventDefault();
    this.keyActions.delete(event.code);
    this.release(action, `key:${event.code}`);
  }

  bindButton(button) {
    const action = button.dataset.action;
    button.addEventListener("pointerdown", (event) => {
      event.preventDefault();
      button.setPointerCapture?.(event.pointerId);
      this.press(action, `pointer:${event.pointerId}`);
    });
    for (const eventName of ["pointerup", "pointercancel", "lostpointercapture"]) {
      button.addEventListener(eventName, (event) => this.release(action, `pointer:${event.pointerId}`));
    }
    button.addEventListener("click", (event) => {
      if (event.detail === 0) this.run(action);
    });
    button.addEventListener("contextmenu", (event) => event.preventDefault());
  }

  press(action, source) {
    this.run(action);
    if (!REPEAT[action]) return;

    const current = this.held.get(action);
    if (current) {
      current.sources.add(source);
    } else {
      this.held.set(action, {
        sources: new Set([source]),
        elapsed: 0,
        nextAt: REPEAT[action].delay,
      });
    }
  }

  release(action, source) {
    const current = this.held.get(action);
    if (!current) return;
    current.sources.delete(source);
    if (current.sources.size === 0) this.held.delete(action);
  }

  clearPressedInputs() {
    this.held.clear();
    this.keyActions.clear();
  }

  onBlur() {
    this.clearPressedInputs();
    this.cancelRebind("blur");
  }

  update(deltaMs) {
    for (const [action, state] of this.held) {
      state.elapsed += deltaMs;
      const { interval } = REPEAT[action];
      while (state.elapsed >= state.nextAt) {
        this.run(action);
        state.nextAt += interval;
      }
    }
  }

  run(action) {
    switch (action) {
      case "left": this.game.move(-1, 0); break;
      case "right": this.game.move(1, 0); break;
      case "softDrop": this.game.softDrop(); break;
      case "rotateLeft": this.game.rotate(-1); break;
      case "rotateRight": this.game.rotate(1); break;
      case "hardDrop": this.game.hardDrop(); break;
      case "hold": this.game.hold(); break;
      case "pause": this.game.togglePause(); break;
      case "restart": this.game.restart(); break;
      default: break;
    }
  }
}
