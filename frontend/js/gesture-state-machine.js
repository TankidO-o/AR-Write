import { OneEuroFilter } from './one-euro-filter.js';

const Gesture = Object.freeze({
  IDLE:   'idle',
  WRITE:  'write',
  ERASE:  'erase',
  CLEAR:  'clear',
});

// MediaPipe hand landmark indices
const WRIST = 0;
const TIP = { THUMB: 4, INDEX: 8, MIDDLE: 12, RING: 16, PINKY: 20 };
const PIP = { INDEX: 6, MIDDLE: 10, RING: 14, PINKY: 18 };
const MCP = { INDEX: 5, MIDDLE: 9, RING: 13, PINKY: 17 };

function dist2d(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

// ── Scale-invariant features (all ratios use wrist as reference) ──

function extRatio(wrist, tip, mcp) {
  return dist2d(wrist, tip) / Math.max(dist2d(wrist, mcp), 0.01);
}

function rampUp(value, lo, hi) {
  if (value >= hi) return 1.0;
  if (value <= lo) return 0.0;
  return (value - lo) / (hi - lo);
}
function rampDown(value, lo, hi) {
  if (value <= lo) return 1.0;
  if (value >= hi) return 0.0;
  return 1.0 - (value - lo) / (hi - lo);
}

function extScore(wrist, tip, mcp) {
  return rampUp(extRatio(wrist, tip, mcp), 1.2, 1.8);
}

function curlScore(wrist, tip, mcp) {
  return rampDown(extRatio(wrist, tip, mcp), 0.9, 1.15);
}

function pinchScore(tipA, tipB, palmSize) {
  const d = dist2d(tipA, tipB);
  const n = d / Math.max(palmSize, 0.01);
  return rampDown(n, 0.12, 0.30);
}

function pinchHystScore(tipA, tipB, palmSize) {
  const d = dist2d(tipA, tipB);
  const n = d / Math.max(palmSize, 0.01);
  return rampDown(n, 0.16, 0.40);
}

function thumbWrapScore(thumbTip, indexMcp, palmSize) {
  const d = dist2d(thumbTip, indexMcp);
  const n = d / Math.max(palmSize, 0.01);
  return rampDown(n, 0.4, 0.8);
}

// ── Standalone scoring (exported for calibration / custom gestures) ──

export function computeGestureScores(kp, currentState) {
  const K = (i) => ({ x: kp[i].x, y: kp[i].y });
  const wrist = K(WRIST);
  const palmSize = dist2d(wrist, K(MCP.MIDDLE));

  const ie = extScore(wrist, K(TIP.INDEX), K(MCP.INDEX));
  const me = extScore(wrist, K(TIP.MIDDLE), K(MCP.MIDDLE));
  const re = extScore(wrist, K(TIP.RING), K(MCP.RING));
  const pe = extScore(wrist, K(TIP.PINKY), K(MCP.PINKY));

  const pinchClose = currentState === Gesture.WRITE
    ? pinchHystScore(K(TIP.THUMB), K(TIP.INDEX), palmSize)
    : pinchScore(K(TIP.THUMB), K(TIP.INDEX), palmSize);

  const scores = {};

  // WRITE: thumb+index pinch + other fingers curled
  const ic = curlScore(wrist, K(TIP.INDEX), K(MCP.INDEX));
  const mc = curlScore(wrist, K(TIP.MIDDLE), K(MCP.MIDDLE));
  const rc = curlScore(wrist, K(TIP.RING), K(MCP.RING));
  const pc = curlScore(wrist, K(TIP.PINKY), K(MCP.PINKY));
  scores[Gesture.WRITE] = Math.round(
    pinchClose * 55 + ie * 35 + mc * 5 + rc * 3 + pc * 2);

  // ERASE: all fingers extended
  scores[Gesture.ERASE] = Math.round(
    ie * 25 + me * 25 + re * 25 + pe * 25);

  // CLEAR: fist — all fingers curled + thumb wrapped
  const tw = thumbWrapScore(K(TIP.THUMB), K(MCP.INDEX), palmSize);
  scores[Gesture.CLEAR] = Math.round(
    ic * 40 + mc * 20 + rc * 15 + pc * 15 + tw * 10);

  return scores;
}

// ── State machine ──

const SCORE_THRESHOLD = 60;
const DEFAULT_GESTURE_THRESHOLDS = {
  clear: 90,
  undo: 80,
};

export class GestureStateMachine {
  constructor({
    debounceFrames = 3,
    idleFrames = 5,
    deadZoneMs = 300,
    scoreThreshold = SCORE_THRESHOLD,
  } = {}) {
    this.debounceFrames = debounceFrames;
    this.idleFrames = idleFrames;
    this.deadZoneMs = deadZoneMs;
    this.scoreThreshold = scoreThreshold;

    // Clear: hold fist for 1000 ms
    this.clearHoldMs = 1000;
    // Undo: quick pinch-open pulse (< 300 ms, no stroke drawn)
    this.undoPulseMaxMs = 300;
    this.undoDeadZoneMs = 500;

    this.state = Gesture.IDLE;
    this.prevState = Gesture.IDLE;
    this.debounceCounter = 0;
    this.idleCounter = 0;
    this.lastSwitchTime = 0;
    this.clearStartTime = null;
    this.pendingGesture = null;
    this.pendingCounter = 0;

    this._writeStartTime = null;
    this._writeStartedStroke = false;
    this._lastUndoTime = 0;

    this.pinchFilterX = new OneEuroFilter();
    this.pinchFilterY = new OneEuroFilter();
    this.eraseFilterX = new OneEuroFilter();
    this.eraseFilterY = new OneEuroFilter();

    // Per-gesture threshold overrides (set by calibration / custom overwrite)
    this._gestureThresholds = { ...DEFAULT_GESTURE_THRESHOLDS };

    // Exposed for debug visualization
    this._scores = {};

    this.onGestureChange = null;
    this.onWritePoint = null;
    this.onEraseAt = null;
    this.onClear = null;
    this.onUndo = null;
    this.onClearProgress = null;
  }

  // ── Threshold management ──

  applyThresholds(t) {
    if (t) {
      if (t.scoreThreshold != null) this.scoreThreshold = t.scoreThreshold;
      if (t.gestureThresholds) {
        this._gestureThresholds = { ...DEFAULT_GESTURE_THRESHOLDS, ...t.gestureThresholds };
      }
    }
    console.log('[Gesture] Score-based engine ready', this._gestureThresholds);
  }

  resetDefaults() {
    this.scoreThreshold = 60;
    this._gestureThresholds = { ...DEFAULT_GESTURE_THRESHOLDS };
  }

  // ── Main update ──

  update(handData, timestampMs) {
    if (!handData) {
      this.idleCounter++;
      if (this.idleCounter >= this.idleFrames) {
        this._transition(Gesture.IDLE);
      }
      return;
    }
    this.idleCounter = 0;

    const kp = handData.keypoints;
    const pc = handData.palm_center;

    // Score all gestures, pick highest that meets threshold
    const scored = this._scoreAll(kp);
    this._scores = scored;

    let best = Gesture.IDLE;
    let bestScore = 0;
    for (const [gesture, score] of Object.entries(scored)) {
      const threshold = this._gestureThresholds[gesture] || this.scoreThreshold;
      if (score >= threshold && score > bestScore) {
        bestScore = score;
        best = gesture;
      }
    }

    if (best === this.state) {
      this.debounceCounter = Math.min(this.debounceCounter + 1, this.debounceFrames);
      this.pendingGesture = null;
      this.pendingCounter = 0;
      this._handleStateAction(kp, pc, timestampMs);
    } else if (best !== Gesture.IDLE) {
      if (best === this.pendingGesture) {
        this.pendingCounter++;
        if (this.pendingCounter >= this.debounceFrames) {
          this._transition(best);
          this.pendingGesture = null;
          this.pendingCounter = 0;
        }
      } else {
        this.pendingGesture = best;
        this.pendingCounter = 1;
      }
    } else {
      // No gesture above threshold → transition to IDLE after debounce
      if (this.pendingGesture === Gesture.IDLE) {
        this.pendingCounter++;
        if (this.pendingCounter >= this.debounceFrames) {
          this._transition(Gesture.IDLE);
          this.pendingGesture = null;
          this.pendingCounter = 0;
        }
      } else {
        this.pendingGesture = Gesture.IDLE;
        this.pendingCounter = 1;
      }
    }
  }

  _scoreAll(kp) {
    return computeGestureScores(kp, this.state);
  }

  // ── Transitions ──

  _transition(newState) {
    const now = Date.now();
    if (now - this.lastSwitchTime < this.deadZoneMs) return;

    this.prevState = this.state;
    this.state = newState;
    this.debounceCounter = 0;
    this.lastSwitchTime = now;

    if (this.state !== Gesture.WRITE) {
      this.pinchFilterX.reset();
      this.pinchFilterY.reset();
    }
    if (this.state !== Gesture.ERASE) {
      this.eraseFilterX.reset();
      this.eraseFilterY.reset();
    }

    if (this.state === Gesture.CLEAR) {
      this.clearStartTime = now;
    } else {
      this.clearStartTime = null;
    }

    if (this.onGestureChange) {
      this.onGestureChange(this.state, this.prevState);
    }

    // Check for undo pulse: quick pinch-open without drawing
    if (this.prevState === Gesture.WRITE && newState === Gesture.IDLE) {
      const pulseDuration = now - this._writeStartTime;
      if (this._writeStartTime !== null &&
          pulseDuration < this.undoPulseMaxMs &&
          !this._writeStartedStroke &&
          now - this._lastUndoTime > this.undoDeadZoneMs) {
        this._lastUndoTime = now;
        if (this.onUndo) this.onUndo();
      }
    }
    // Reset write tracking
    if (newState !== Gesture.WRITE) {
      this._writeStartTime = null;
      this._writeStartedStroke = false;
    }
    if (newState === Gesture.WRITE) {
      this._writeStartTime = now;
      this._writeStartedStroke = false;
    }
  }

  _handleStateAction(kp, pc, ts) {
    switch (this.state) {
      case Gesture.WRITE: {
        const midX = (kp[TIP.THUMB].x + kp[TIP.INDEX].x) / 2;
        const midY = (kp[TIP.THUMB].y + kp[TIP.INDEX].y) / 2;
        const sx = this.pinchFilterX.filter(midX, ts / 1000);
        const sy = this.pinchFilterY.filter(midY, ts / 1000);
        if (this.onWritePoint) {
          this.onWritePoint({ x: sx, y: sy });
          this._writeStartedStroke = true;
        }
        break;
      }
      case Gesture.ERASE: {
        const ex = this.eraseFilterX.filter(pc.x, ts / 1000);
        const ey = this.eraseFilterY.filter(pc.y, ts / 1000);
        if (this.onEraseAt) this.onEraseAt({ x: ex, y: ey });
        break;
      }
      case Gesture.CLEAR: {
        if (this.clearStartTime !== null) {
          const elapsed = Date.now() - this.clearStartTime;
          const progress = Math.min(elapsed / this.clearHoldMs, 1);
          if (this.onClearProgress) this.onClearProgress(progress);
          if (progress >= 1) {
            if (this.onClear) this.onClear();
            this._transition(Gesture.IDLE);
          }
        }
        break;
      }
    }
  }

  isActive() {
    return this.state === Gesture.WRITE || this.state === Gesture.ERASE || this.state === Gesture.CLEAR;
  }
}

export { Gesture };
