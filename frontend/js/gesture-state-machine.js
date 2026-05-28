import { OneEuroFilter } from './one-euro-filter.js';

const Gesture = Object.freeze({
  IDLE:    'idle',
  WRITE:   'write',
  CLEAR:   'clear',
  ERASE:   'erase',
  SWITCH:  'switch',
  UNDO:    'undo',
});

const PRIORITY = [Gesture.WRITE, Gesture.CLEAR, Gesture.ERASE, Gesture.SWITCH, Gesture.UNDO];

// MediaPipe hand landmark indices
const TIP = { THUMB: 4, INDEX: 8, MIDDLE: 12, RING: 16, PINKY: 20 };
const PIP  = { INDEX: 6, MIDDLE: 10, RING: 14, PINKY: 18 };
const MCP  = { INDEX: 5, MIDDLE: 9, RING: 13, PINKY: 17 };
const WRIST = 0;

function dist2d(a, b) {
  return Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2);
}

function isFingerExtended(tip, pip) {
  return tip.y < pip.y;
}

export class GestureStateMachine {
  constructor({ debounceFrames = 5, idleFrames = 3, deadZoneMs = 200, clearHoldMs = 1000, pinchThreshold = 0.06, eraseRadius = 0.15 } = {}) {
    this.debounceFrames = debounceFrames;
    this.idleFrames = idleFrames;
    this.deadZoneMs = deadZoneMs;
    this.clearHoldMs = clearHoldMs;
    this.pinchThreshold = pinchThreshold;
    this.eraseRadius = eraseRadius;

    this.state = Gesture.IDLE;
    this.prevState = Gesture.IDLE;
    this.debounceCounter = 0;
    this.idleCounter = 0;
    this.lastSwitchTime = 0;
    this.clearStartTime = null;

    this.indexTrajectory = [];
    this.circleAngularSum = 0;

    this.pinchFilter = new OneEuroFilter();
    this.eraseFilter = new OneEuroFilter();

    // Callbacks set by App
    this.onGestureChange = null;   // (newGesture, prevGesture)
    this.onWritePoint = null;      // ({x, y})
    this.onEraseAt = null;         // ({x, y})
    this.onSwitchColor = null;     // ()
    this.onClear = null;           // ()
    this.onUndo = null;            // ()
    this.onClearProgress = null;   // (progress: 0..1)
  }

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

    // Evaluate by priority
    let detected = Gesture.IDLE;
    for (const g of PRIORITY) {
      if (this._detect(g, kp, pc, timestampMs)) {
        detected = g;
        break;
      }
    }

    if (detected === this.state) {
      this.debounceCounter = Math.min(this.debounceCounter + 1, this.debounceFrames);
      this._handleStateAction(kp, pc, timestampMs);
    } else if (this.debounceCounter >= this.debounceFrames) {
      this._transition(detected);
    } else {
      this.debounceCounter = 0;
    }
  }

  _detect(gesture, kp, pc, ts) {
    switch (gesture) {
      case Gesture.WRITE:
        return this._isPinch(kp);
      case Gesture.CLEAR:
        return this._isFist(kp);
      case Gesture.ERASE:
        return this._isOpenPalm(kp);
      case Gesture.SWITCH:
        return this._isCircling(kp, ts);
      case Gesture.UNDO:
        return this._isRock(kp);
      default:
        return false;
    }
  }

  _isPinch(kp) {
    const d = dist2d(kp[TIP.THUMB], kp[TIP.INDEX]);
    return d < this.pinchThreshold &&
           !isFingerExtended(kp[TIP.MIDDLE], kp[PIP.MIDDLE]) &&
           !isFingerExtended(kp[TIP.RING], kp[PIP.RING]) &&
           !isFingerExtended(kp[TIP.PINKY], kp[PIP.PINKY]);
  }

  _isFist(kp) {
    return !isFingerExtended(kp[TIP.INDEX], kp[PIP.INDEX]) &&
           !isFingerExtended(kp[TIP.MIDDLE], kp[PIP.MIDDLE]) &&
           !isFingerExtended(kp[TIP.RING], kp[PIP.RING]) &&
           !isFingerExtended(kp[TIP.PINKY], kp[PIP.PINKY]);
  }

  _isOpenPalm(kp) {
    return isFingerExtended(kp[TIP.INDEX], kp[PIP.INDEX]) &&
           isFingerExtended(kp[TIP.MIDDLE], kp[PIP.MIDDLE]) &&
           isFingerExtended(kp[TIP.RING], kp[PIP.RING]) &&
           isFingerExtended(kp[TIP.PINKY], kp[PIP.PINKY]);
  }

  _isCircling(kp, ts) {
    const indexExtended = isFingerExtended(kp[TIP.INDEX], kp[PIP.INDEX]);
    const middleFolded = !isFingerExtended(kp[TIP.MIDDLE], kp[PIP.MIDDLE]);
    const ringFolded = !isFingerExtended(kp[TIP.RING], kp[PIP.RING]);
    const pinkyFolded = !isFingerExtended(kp[TIP.PINKY], kp[PIP.PINKY]);

    if (!(indexExtended && middleFolded && ringFolded && pinkyFolded)) {
      this.indexTrajectory = [];
      this.circleAngularSum = 0;
      return false;
    }

    const pt = kp[TIP.INDEX];
    this.indexTrajectory.push({ x: pt.x, y: pt.y, t: ts });

    if (this.indexTrajectory.length < 3) return false;

    const recent = this.indexTrajectory.slice(-3);
    const v1 = { x: recent[1].x - recent[0].x, y: recent[1].y - recent[0].y };
    const v2 = { x: recent[2].x - recent[1].x, y: recent[2].y - recent[1].y };

    const cross = v1.x * v2.y - v1.y * v2.x;
    const dot = v1.x * v2.x + v1.y * v2.y;
    const angle = Math.abs(Math.atan2(cross, dot));

    this.circleAngularSum += angle;

    if (this.indexTrajectory.length > 30) {
      const oldest = this.indexTrajectory.shift();
      const oldestV = { x: this.indexTrajectory[0].x - oldest.x, y: this.indexTrajectory[0].y - oldest.y };
      const oldestCross = oldestV.x * v2.y - oldestV.y * v2.x;
      this.circleAngularSum -= Math.abs(Math.atan2(oldestCross, oldestV.x * v2.x + oldestV.y * v2.y));
    }

    return this.circleAngularSum >= Math.PI; // 180 degrees
  }

  _isRock(kp) {
    return isFingerExtended(kp[TIP.INDEX], kp[PIP.INDEX]) &&
           !isFingerExtended(kp[TIP.MIDDLE], kp[PIP.MIDDLE]) &&
           !isFingerExtended(kp[TIP.RING], kp[PIP.RING]) &&
           isFingerExtended(kp[TIP.PINKY], kp[PIP.PINKY]);
  }

  _transition(newState) {
    const now = Date.now();
    if (now - this.lastSwitchTime < this.deadZoneMs) return;

    this.prevState = this.state;
    this.state = newState;
    this.debounceCounter = 0;
    this.lastSwitchTime = now;

    if (this.state === Gesture.CLEAR) {
      this.clearStartTime = now;
    } else {
      this.clearStartTime = null;
    }

    if (this.state !== Gesture.SWITCH) {
      this.indexTrajectory = [];
      this.circleAngularSum = 0;
    }

    if (this.state !== Gesture.WRITE) {
      this.pinchFilter.reset();
    }
    if (this.state !== Gesture.ERASE) {
      this.eraseFilter.reset();
    }

    if (this.onGestureChange) {
      this.onGestureChange(this.state, this.prevState);
    }
  }

  _handleStateAction(kp, pc, ts) {
    switch (this.state) {
      case Gesture.WRITE: {
        const midX = (kp[TIP.THUMB].x + kp[TIP.INDEX].x) / 2;
        const midY = (kp[TIP.THUMB].y + kp[TIP.INDEX].y) / 2;
        const sx = this.pinchFilter.filter(midX, ts / 1000);
        const sy = this.pinchFilter.filter(midY, ts / 1000);
        if (this.onWritePoint) this.onWritePoint({ x: sx, y: sy });
        break;
      }
      case Gesture.ERASE: {
        const ex = this.eraseFilter.filter(pc.x, ts / 1000);
        const ey = this.eraseFilter.filter(pc.y, ts / 1000);
        if (this.onEraseAt) this.onEraseAt({ x: ex, y: ey });
        break;
      }
      case Gesture.SWITCH: {
        if (this.onSwitchColor) this.onSwitchColor();
        this._transition(Gesture.IDLE);
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
      case Gesture.UNDO: {
        if (this.onUndo) this.onUndo();
        this._transition(Gesture.IDLE);
        break;
      }
    }
  }

  isActive() {
    return this.state === Gesture.WRITE || this.state === Gesture.ERASE;
  }
}

export { Gesture };
