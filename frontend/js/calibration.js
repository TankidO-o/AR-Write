const GESTURE_META = {
  write:  { label: '拇指食指捏合', icon: '✍️', desc: '拇指与食指尖捏在一起，其余三指自然蜷曲' },
  switch: { label: '拇指中指捏合', icon: '🔄', desc: '拇指与中指尖捏在一起，食指伸直，其余蜷曲' },
  clear:  { label: '握拳',         icon: '✊', desc: '四指紧握，拇指包在手指外侧' },
  erase:  { label: '五指张开',     icon: '🖐️', desc: '五指完全伸直展开' },
  undo:   { label: '比耶手势',     icon: '✌️', desc: '食指和中指伸直，无名指小指蜷曲' },
};

const SAMPLES_PER_GESTURE = 10;
const STORAGE_KEY = 'ar-gesture-calibration';
const DATA_VERSION = 2; // bump when format changes

const TIP = { THUMB: 4, INDEX: 8, MIDDLE: 12, RING: 16, PINKY: 20 };
const PIP = { INDEX: 6, MIDDLE: 10, RING: 14, PINKY: 18 };
const MCP = { INDEX: 5, MIDDLE: 9, RING: 13, PINKY: 17 };

function dist2d(a, b) {
  return Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2);
}

function pipAngle(mcp, pip, tip) {
  const v1x = pip.x - mcp.x, v1y = pip.y - mcp.y;
  const v2x = tip.x - pip.x, v2y = tip.y - pip.y;
  const dot = v1x * v2x + v1y * v2y;
  const m1 = Math.sqrt(v1x * v1x + v1y * v1y);
  const m2 = Math.sqrt(v2x * v2x + v2y * v2y);
  if (m1 < 0.001 || m2 < 0.001) return 180;
  const cos = Math.max(-1, Math.min(1, dot / (m1 * m2)));
  return Math.acos(cos) * (180 / Math.PI);
}

function extractFeatures(kp) {
  const K = (i) => ({ x: kp[i].x, y: kp[i].y });
  return {
    pinchDist: dist2d(K(TIP.THUMB), K(TIP.INDEX)),
    midPinchDist: dist2d(K(TIP.THUMB), K(TIP.MIDDLE)),
    thumbToIndexMcp: dist2d(K(TIP.THUMB), K(MCP.INDEX)),
    indexAngle:  pipAngle(K(MCP.INDEX), K(PIP.INDEX), K(TIP.INDEX)),
    middleAngle: pipAngle(K(MCP.MIDDLE), K(PIP.MIDDLE), K(TIP.MIDDLE)),
    ringAngle:   pipAngle(K(MCP.RING), K(PIP.RING), K(TIP.RING)),
    pinkyAngle:  pipAngle(K(MCP.PINKY), K(PIP.PINKY), K(TIP.PINKY)),
  };
}

function mean(arr) {
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}

function stddev(arr, avg) {
  if (arr.length < 2) return 0;
  const variance = arr.reduce((s, v) => s + (v - avg) ** 2, 0) / (arr.length - 1);
  return Math.sqrt(variance);
}

// ── skeleton drawing (shared) ──

const HAND_CONNECTIONS = [
  [0,1],[1,2],[2,3],[3,4],
  [0,5],[5,6],[6,7],[7,8],
  [5,9],[9,10],[10,11],[11,12],
  [9,13],[13,14],[14,15],[15,16],
  [13,17],[17,18],[18,19],[19,20],
];

const VIDEO_ASPECT = 4 / 3;

function drawSkeleton(ctx, kp, w, h, extendedAngle, curledAngle) {
  ctx.clearRect(0, 0, w, h);

  // Cover-fill: maintain 4:3, crop excess to fill canvas
  const canvasAspect = w / h;
  let dw, dh, dx, dy;
  if (canvasAspect > VIDEO_ASPECT) {
    dh = h; dw = h * VIDEO_ASPECT; dx = (w - dw) / 2; dy = 0;
  } else {
    dw = w; dh = w / VIDEO_ASPECT; dx = 0; dy = (h - dh) / 2;
  }

  const EXT = extendedAngle || 135;
  const CURL = curledAngle || 110;
  const pt = (i) => ({ x: dx + kp[i].x * dw, y: dy + kp[i].y * dh });

  const fingerColor = (iTip, iPip, iMcp) => {
    const angle = pipAngle(pt(iMcp), pt(iPip), pt(iTip));
    if (angle > EXT) return '#00ff88';
    if (angle < CURL) return '#ff4444';
    return '#ffaa00';
  };

  // Connection lines
  ctx.lineWidth = 2;
  for (const [a, b] of HAND_CONNECTIONS) {
    const pa = pt(a), pb = pt(b);
    ctx.beginPath();
    ctx.moveTo(pa.x, pa.y);
    ctx.lineTo(pb.x, pb.y);
    ctx.strokeStyle = 'rgba(255,255,255,0.30)';
    ctx.stroke();
  }

  // Thumb-index distance line
  const ti = pt(TIP.THUMB), ii = pt(TIP.INDEX);
  const pinchDist = Math.hypot(ti.x - ii.x, ti.y - ii.y) / dw;
  ctx.beginPath();
  ctx.moveTo(ti.x, ti.y);
  ctx.lineTo(ii.x, ii.y);
  ctx.strokeStyle = pinchDist < 0.10 ? '#00ff88' : pinchDist < 0.15 ? '#ffaa00' : '#ff4444';
  ctx.lineWidth = 2;
  ctx.stroke();

  // All 21 landmarks
  for (let i = 0; i < 21; i++) {
    const p = pt(i);
    ctx.beginPath();
    ctx.arc(p.x, p.y, 3, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(255,255,255,0.35)';
    ctx.fill();
  }

  // Color-coded finger tips
  const tips = [
    { tip: TIP.INDEX, pip: PIP.INDEX, mcp: MCP.INDEX },
    { tip: TIP.MIDDLE, pip: PIP.MIDDLE, mcp: MCP.MIDDLE },
    { tip: TIP.RING, pip: PIP.RING, mcp: MCP.RING },
    { tip: TIP.PINKY, pip: PIP.PINKY, mcp: MCP.PINKY },
  ];
  for (const { tip, pip, mcp } of tips) {
    const p = pt(tip);
    ctx.beginPath();
    ctx.arc(p.x, p.y, 6, 0, Math.PI * 2);
    ctx.fillStyle = fingerColor(tip, pip, mcp);
    ctx.fill();
    ctx.strokeStyle = '#000';
    ctx.lineWidth = 1;
    ctx.stroke();
  }

  // Thumb tip
  const tp = pt(TIP.THUMB);
  ctx.beginPath();
  ctx.arc(tp.x, tp.y, 6, 0, Math.PI * 2);
  ctx.fillStyle = '#aaa';
  ctx.fill();
  ctx.strokeStyle = '#000';
  ctx.lineWidth = 1;
  ctx.stroke();
}

// ── calibration class ──

export class Calibration {
  constructor(getHandData) {
    this._getHand = getHandData;
    this._gestureOrder = ['write', 'switch', 'clear', 'erase', 'undo'];
    this._currentIdx = 0;
    this._sampleCount = 0;
    this._samples = {};
    this._data = null;
    this._overlay = null;
    this._onComplete = null;
    this._onSkip = null;
    this._rafId = null;
    this._previewCanvas = null;
  }

  isDone() {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return false;
    try {
      this._data = JSON.parse(raw);
      if (this._data.version !== DATA_VERSION) {
        localStorage.removeItem(STORAGE_KEY);
        this._data = null;
        return false;
      }
      return !!(this._data && this._data.thresholds);
    } catch { return false; }
  }

  getThresholds() {
    return this._data?.thresholds || null;
  }

  start({ onComplete, onSkip } = {}) {
    this._onComplete = onComplete;
    this._onSkip = onSkip;
    this._gestureOrder.forEach(g => { this._samples[g] = []; });
    this._currentIdx = 0;
    this._sampleCount = 0;
    this._renderOverlay();
    this._bindKeys();
    this._startPreviewLoop();
  }

  record() {
    const hand = this._getHand();
    const btn = this._overlay?.querySelector('#cal-record-btn');
    if (!hand) {
      if (btn) {
        btn.style.background = '#ff4444';
        btn.textContent = '✗ 未检测到手，请将手放入摄像头范围';
        setTimeout(() => {
          btn.style.background = '#00ff88';
          btn.textContent = '● 录制 (空格键)';
        }, 1200);
      }
      return false;
    }

    const gesture = this._gestureOrder[this._currentIdx];
    const features = extractFeatures(hand.keypoints);
    this._samples[gesture].push(features);
    this._sampleCount++;

    if (btn) {
      btn.style.background = '#00cc66';
      btn.textContent = `✓ 已录制 (${this._sampleCount}/${SAMPLES_PER_GESTURE})`;
      setTimeout(() => {
        btn.style.background = '#00ff88';
        btn.textContent = '● 录制 (空格键)';
      }, 300);
    }

    if (this._sampleCount >= SAMPLES_PER_GESTURE) {
      this._currentIdx++;
      this._sampleCount = 0;
      if (this._currentIdx >= this._gestureOrder.length) {
        this._finish();
        return true;
      }
    }
    this._updateOverlay();
    return true;
  }

  undo() {
    const gesture = this._gestureOrder[this._currentIdx];
    if (this._sampleCount > 0) {
      // Undo last sample of current gesture
      this._samples[gesture].pop();
      this._sampleCount--;
      this._updateOverlay();
    } else if (this._currentIdx > 0) {
      // Go back to previous gesture, remove its last sample
      this._currentIdx--;
      const prevGesture = this._gestureOrder[this._currentIdx];
      if (this._samples[prevGesture].length > 0) {
        this._samples[prevGesture].pop();
        this._sampleCount = this._samples[prevGesture].length;
        this._updateOverlay();
      }
    }
  }

  skip() {
    this._teardown();
    if (this._onSkip) this._onSkip();
  }

  // ── personalization ──

  _computeThresholds() {
    const t = {};

    // Pure union: the loosest sample × margin = threshold.
    // No default floor — thresholds are fully personalized.

    const writePinch = this._samples.write.map(f => f.pinchDist);
    const wpMax = Math.max(...writePinch);
    t.pinchThreshold = Math.min(wpMax * 1.25, 0.22);
    t.pinchHysteresis = Math.min(wpMax * 1.55, 0.30);

    const clearMaxAngles = this._samples.clear.map(f =>
      Math.max(f.indexAngle, f.middleAngle, f.ringAngle, f.pinkyAngle));
    const cmMax = Math.max(...clearMaxAngles);
    t.curledAngle = Math.min(Math.round(cmMax * 1.12 + 6), 125);

    const clearThumb = this._samples.clear.map(f => f.thumbToIndexMcp);
    const ctMax = Math.max(...clearThumb);
    t.fistThumbWrap = Math.min(ctMax * 1.30, 0.24);

    const eraseMinAngles = this._samples.erase.map(f =>
      Math.min(f.indexAngle, f.middleAngle, f.ringAngle, f.pinkyAngle));
    const emMin = Math.min(...eraseMinAngles);
    t.extendedAngle = Math.max(Math.round(emMin * 0.88), 110);

    const switchPinch = this._samples.switch.map(f => f.midPinchDist);
    const swMax = Math.max(...switchPinch);
    t.switchPinchThreshold = Math.min(swMax * 1.25, 0.22);

    console.log('[Calibration] pure-union thresholds:', JSON.stringify(t),
      '\n  write max pinch:', wpMax.toFixed(3),
      '| clear max angle:', Math.round(cmMax),
      '| erase min angle:', Math.round(emMin),
      '| sw max pinch:', swMax.toFixed(3));
    return t;
  }

  _finish() {
    const thresholds = this._computeThresholds();
    this._data = { version: DATA_VERSION, thresholds, timestamp: Date.now() };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(this._data));

    // Show completion briefly
    const box = this._overlay?.querySelector('.cal-control-pane');
    if (box) {
      box.innerHTML = `
        <h2 style="color:#00ff88">✓ 校准完成</h2>
        <p style="color:#aaa;font-size:14px;margin:12px 0;">
          捏合 ${thresholds.pinchThreshold.toFixed(3)} |
          伸直 ${thresholds.extendedAngle}° |
          蜷曲 ${thresholds.curledAngle}°
        </p>
        <p style="color:#666;font-size:13px;">正在进入应用...</p>`;
    }

    setTimeout(() => {
      this._teardown();
      if (this._onComplete) this._onComplete(thresholds);
    }, 800);
  }

  // ── preview loop ──

  _startPreviewLoop() {
    const loop = () => {
      if (!this._overlay) return;
      this._rafId = requestAnimationFrame(loop);
      this._drawPreview();
    };
    this._rafId = requestAnimationFrame(loop);
  }

  _drawPreview() {
    const canvas = this._previewCanvas;
    if (!canvas) return;
    const hand = this._getHand();
    const ctx = canvas.getContext('2d');

    if (!hand) {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = 'rgba(255,255,255,0.06)';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      // Counter-flip: canvas CSS has scaleX(-1), flip back so text reads correctly
      ctx.save();
      ctx.scale(-1, 1);
      ctx.fillStyle = '#555';
      ctx.font = '16px system-ui';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('等待手势...', -canvas.width / 2, canvas.height / 2);
      ctx.restore();
      this._setDetectStatus(false);
      return;
    }

    this._setDetectStatus(true);
    const kp = hand.keypoints;
    const EXT = 135, CURL = 110;
    drawSkeleton(ctx, kp, canvas.width, canvas.height, EXT, CURL);
  }

  _setDetectStatus(detected) {
    const el = this._overlay?.querySelector('#cal-detect-status');
    if (!el) return;
    el.textContent = detected ? '✓ 已检测到手部' : '○ 等待手部进入摄像头';
    el.style.color = detected ? '#00ff88' : '#666';
  }

  // ── UI ──

  _renderOverlay() {
    const div = document.createElement('div');
    div.id = 'calibration-overlay';
    div.innerHTML = `
      <div class="cal-layout">
        <div class="cal-preview-pane">
          <canvas id="cal-preview-canvas"></canvas>
          <div class="cal-detect-status" id="cal-detect-status">○ 等待手部进入摄像头</div>
        </div>
        <div class="cal-control-pane">
          <h2>手势个性化校准</h2>
          <p class="cal-sub">首次使用需要录入你的手势数据，每个手势 <b>${SAMPLES_PER_GESTURE} 次</b></p>
          <div class="cal-gesture" id="cal-gesture-name"></div>
          <div class="cal-desc" id="cal-gesture-desc"></div>
          <div class="cal-progress-bar"><div class="cal-progress-fill" id="cal-progress-fill"></div></div>
          <div class="cal-counter" id="cal-counter">0 / 10</div>
          <button class="cal-record-btn" id="cal-record-btn">● 录制 (空格键)</button>
          <p class="cal-hint">做出手势后按 <kbd>空格键</kbd> 或点击按钮</p>
          <div class="cal-undo-row">
            <button class="cal-undo-btn" id="cal-undo-btn">↩ 撤销上次录入</button>
            <button class="cal-skip-btn" id="cal-skip-btn">跳过，使用默认设置</button>
          </div>
        </div>
      </div>`;
    document.body.appendChild(div);
    this._overlay = div;

    this._previewCanvas = div.querySelector('#cal-preview-canvas');
    const updateSize = () => {
      const rect = this._previewCanvas.parentElement.getBoundingClientRect();
      this._previewCanvas.width = rect.width;
      this._previewCanvas.height = rect.height;
    };
    updateSize();
    window.addEventListener('resize', updateSize);

    div.querySelector('#cal-record-btn').addEventListener('click', () => this.record());
    div.querySelector('#cal-undo-btn').addEventListener('click', () => this.undo());
    div.querySelector('#cal-skip-btn').addEventListener('click', () => this.skip());
    this._updateOverlay();

    if (!document.getElementById('cal-styles')) {
      const style = document.createElement('style');
      style.id = 'cal-styles';
      style.textContent = `
        #calibration-overlay {
          position: fixed; inset: 0; z-index: 999;
          background: #0d0d1a;
          font-family: 'Segoe UI', system-ui, sans-serif;
        }
        .cal-layout {
          display: flex; height: 100vh;
        }
        .cal-preview-pane {
          flex: 1; position: relative; background: #000;
          display: flex; align-items: center; justify-content: center;
          min-width: 0;
        }
        #cal-preview-canvas {
          width: 100%; height: 100%;
          transform: scaleX(-1);
        }
        .cal-detect-status {
          position: absolute; bottom: 16px; left: 50%; transform: translateX(-50%);
          font-size: 14px; padding: 6px 16px; border-radius: 20px;
          background: rgba(0,0,0,0.6); transition: color 0.3s;
        }
        .cal-control-pane {
          width: 380px; padding: 40px 36px; display: flex;
          flex-direction: column; justify-content: center;
          background: #14142b; color: #eee; overflow-y: auto;
        }
        .cal-control-pane h2 { margin: 0 0 4px; font-size: 22px; }
        .cal-sub { color: #888; font-size: 13px; margin: 0 0 24px; }
        .cal-gesture { font-size: 26px; font-weight: 700; margin-bottom: 4px; }
        .cal-desc { color: #aaa; font-size: 13px; margin-bottom: 20px; }
        .cal-progress-bar {
          height: 6px; background: #333; border-radius: 3px;
          margin-bottom: 8px; overflow: hidden;
        }
        .cal-progress-fill {
          height: 100%; background: linear-gradient(90deg, #00ff88, #00cc66);
          border-radius: 3px; transition: width 0.2s; width: 0%;
        }
        .cal-counter { color: #aaa; font-size: 20px; font-weight: 600; margin-bottom: 20px; }
        .cal-record-btn {
          display: block; width: 100%; padding: 14px; border: none;
          border-radius: 10px; background: #00ff88; color: #111;
          font-size: 17px; font-weight: 700; cursor: pointer;
          margin-bottom: 10px; transition: background 0.15s;
        }
        .cal-record-btn:hover { background: #00cc66; }
        .cal-record-btn:active { background: #00994d; }
        .cal-hint { color: #666; font-size: 12px; margin: 0 0 16px; text-align: center; }
        .cal-hint kbd {
          background: #333; border: 1px solid #555; border-radius: 4px;
          padding: 1px 6px; font-size: 11px; color: #ccc;
        }
        .cal-undo-row {
          display: flex; gap: 8px;
        }
        .cal-undo-btn {
          flex: 1; background: none; border: 1px solid #555; color: #aaa;
          padding: 8px 14px; border-radius: 8px; cursor: pointer;
          font-size: 13px;
        }
        .cal-undo-btn:hover { color: #fff; border-color: #888; }
        .cal-skip-btn {
          flex: 1; background: none; border: 1px solid #444; color: #666;
          padding: 8px 14px; border-radius: 8px; cursor: pointer;
          font-size: 13px;
        }
        .cal-skip-btn:hover { color: #aaa; border-color: #666; }
        @media (max-width: 700px) {
          .cal-layout { flex-direction: column; }
          .cal-preview-pane { height: 45vh; }
          .cal-control-pane { width: 100%; padding: 24px 28px; }
        }
      `;
      document.head.appendChild(style);
    }
  }

  _updateOverlay() {
    if (!this._overlay) return;
    const gesture = this._gestureOrder[this._currentIdx];
    const meta = GESTURE_META[gesture];
    const total = this._gestureOrder.length;

    this._overlay.querySelector('#cal-gesture-name').textContent =
      `${meta.icon} ${meta.label} (${this._currentIdx + 1}/${total})`;
    this._overlay.querySelector('#cal-gesture-desc').textContent = meta.desc;

    const pct = ((this._currentIdx * SAMPLES_PER_GESTURE + this._sampleCount) /
                  (total * SAMPLES_PER_GESTURE) * 100);
    this._overlay.querySelector('#cal-progress-fill').style.width = pct + '%';
    this._overlay.querySelector('#cal-counter').textContent =
      `${this._sampleCount} / ${SAMPLES_PER_GESTURE}`;
  }

  _bindKeys() {
    this._keyHandler = (e) => {
      if (e.code === 'Space') {
        e.preventDefault();
        this.record();
      }
    };
    document.addEventListener('keydown', this._keyHandler);
  }

  _teardown() {
    if (this._rafId) {
      cancelAnimationFrame(this._rafId);
      this._rafId = null;
    }
    if (this._keyHandler) {
      document.removeEventListener('keydown', this._keyHandler);
      this._keyHandler = null;
    }
    if (this._overlay) {
      this._overlay.remove();
      this._overlay = null;
    }
    this._previewCanvas = null;
  }
}
