// Custom gesture system — record, store, detect user-defined hand poses
// Also supports overwriting built-in gesture calibration data

import { computeGestureScores } from './gesture-state-machine.js';

const STORAGE_KEY = 'ar-custom-gestures';
const DATA_VERSION = 1;
const MATCH_THRESHOLD = 70;
const CUSTOM_RECORD_SAMPLES = 3;
const OVERWRITE_SAMPLES = 10;
const DEBOUNCE_FRAMES = 3;
const DEAD_ZONE_MS = 500;

const WRIST = 0;
const TIP = { THUMB: 4, INDEX: 8, MIDDLE: 12, RING: 16, PINKY: 20 };
const MCP = { INDEX: 5, MIDDLE: 9, RING: 13, PINKY: 17 };

const HAND_CONNECTIONS = [
  [0,1],[1,2],[2,3],[3,4], [0,5],[5,6],[6,7],[7,8],
  [5,9],[9,10],[10,11],[11,12], [9,13],[13,14],[14,15],[15,16],
  [13,17],[17,18],[18,19],[19,20],
];

const VIDEO_ASPECT = 4 / 3;

const BUILTIN_META = [
  { id: 'write',  label: '书写',   icon: '✍️', desc: '拇指食指尖捏合，其余三指蜷曲' },
  { id: 'clear',  label: '清空',   icon: '✊', desc: '擦除手势保持静止1.5秒' },
  { id: 'erase',  label: '擦除',   icon: '🖐️', desc: '五指完全伸直展开，区域擦除' },
  { id: 'undo',   label: '撤销',   icon: '✌️', desc: '快速捏合后立即松开' },
];

const AVAILABLE_ACTIONS = [
  { type: 'setColor',      label: '切换颜色',   icon: '🎨', needsColor: true },
  { type: 'setBrushSize',  label: '笔刷大小',   icon: '🖌️', needsSize: true },
  { type: 'setEraserSize', label: '橡皮大小',   icon: '🧹', needsSize: true },
  { type: 'undo',          label: '撤销',       icon: '↩',  needsColor: false },
  { type: 'redo',          label: '重做',       icon: '↪',  needsColor: false },
  { type: 'clear',         label: '清空画布',   icon: '✕',  needsColor: false },
  { type: 'save',          label: '保存截图',   icon: '💾', needsColor: false },
  { type: 'setBackground', label: '切换背景色', icon: '🖼️', needsBackground: true },
];

function dist2d(a, b) { return Math.hypot(a.x - b.x, a.y - b.y); }

function rampDown(value, lo, hi) {
  if (value <= lo) return 1.0;
  if (value >= hi) return 0.0;
  return 1.0 - (value - lo) / (hi - lo);
}

// ── Scale-invariant feature extraction (for custom gesture templates) ──

function extractFeatures(kp) {
  const K = (i) => ({ x: kp[i].x, y: kp[i].y });
  const wrist = K(WRIST);
  const palmSize = dist2d(wrist, K(MCP.MIDDLE));
  return {
    indexER:  dist2d(wrist, K(TIP.INDEX))  / Math.max(dist2d(wrist, K(MCP.INDEX)),  0.01),
    middleER: dist2d(wrist, K(TIP.MIDDLE)) / Math.max(dist2d(wrist, K(MCP.MIDDLE)), 0.01),
    ringER:   dist2d(wrist, K(TIP.RING))   / Math.max(dist2d(wrist, K(MCP.RING)),   0.01),
    pinkyER:  dist2d(wrist, K(TIP.PINKY))  / Math.max(dist2d(wrist, K(MCP.PINKY)),  0.01),
    pinchN:   dist2d(K(TIP.THUMB), K(TIP.INDEX))  / Math.max(palmSize, 0.01),
    midPinchN: dist2d(K(TIP.THUMB), K(TIP.MIDDLE)) / Math.max(palmSize, 0.01),
    thumbWrapN: dist2d(K(TIP.THUMB), K(MCP.INDEX)) / Math.max(palmSize, 0.01),
  };
}

function avgFeatures(samples) {
  const keys = Object.keys(samples[0]);
  const avg = {};
  for (const k of keys) {
    avg[k] = samples.reduce((s, f) => s + f[k], 0) / samples.length;
  }
  return avg;
}

const MATCH_WEIGHTS = {
  indexER: 25, middleER: 20, ringER: 15, pinkyER: 15,
  pinchN: 15, midPinchN: 5, thumbWrapN: 5,
};

function matchScore(features, template) {
  let totalWeight = 0;
  let weightedScore = 0;
  for (const [key, weight] of Object.entries(MATCH_WEIGHTS)) {
    const diff = Math.abs(features[key] - template[key]);
    const tolerance = Math.max(template[key] * 0.25, 0.2);
    const sim = rampDown(diff, 0, tolerance);
    weightedScore += sim * weight;
    totalWeight += weight;
  }
  return Math.round((weightedScore / totalWeight) * 100);
}

// ── Skeleton drawing for preview ──

function drawPreviewSkeleton(ctx, kp, w, h) {
  ctx.clearRect(0, 0, w, h);
  const canvasAspect = w / h;
  let dw, dh, dx, dy;
  if (canvasAspect > VIDEO_ASPECT) {
    dh = h; dw = h * VIDEO_ASPECT; dx = (w - dw) / 2; dy = 0;
  } else {
    dw = w; dh = w / VIDEO_ASPECT; dx = 0; dy = (h - dh) / 2;
  }
  const pt = (i) => ({ x: dx + kp[i].x * dw, y: dy + kp[i].y * dh });
  const extR = (tip, mcp) => dist2d(pt(WRIST), pt(tip)) / Math.max(dist2d(pt(WRIST), pt(mcp)), 0.01);

  const fingerColor = (tip, mcp) => {
    const r = extR(tip, mcp);
    if (r >= 1.8) return '#00ff88';
    if (r <= 0.9) return '#ff4444';
    return '#ffaa00';
  };

  ctx.lineWidth = 2;
  for (const [a, b] of HAND_CONNECTIONS) {
    const pa = pt(a), pb = pt(b);
    ctx.beginPath();
    ctx.moveTo(pa.x, pa.y);
    ctx.lineTo(pb.x, pb.y);
    ctx.strokeStyle = 'rgba(255,255,255,0.25)';
    ctx.stroke();
  }

  for (let i = 0; i < 21; i++) {
    const p = pt(i);
    ctx.beginPath();
    ctx.arc(p.x, p.y, 3, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(255,255,255,0.35)';
    ctx.fill();
  }

  const fingerTips = [
    { tip: TIP.INDEX, mcp: MCP.INDEX },
    { tip: TIP.MIDDLE, mcp: MCP.MIDDLE },
    { tip: TIP.RING, mcp: MCP.RING },
    { tip: TIP.PINKY, mcp: MCP.PINKY },
  ];
  for (const { tip, mcp } of fingerTips) {
    const p = pt(tip);
    ctx.beginPath();
    ctx.arc(p.x, p.y, 6, 0, Math.PI * 2);
    ctx.fillStyle = fingerColor(tip, mcp);
    ctx.fill();
    ctx.strokeStyle = '#000';
    ctx.lineWidth = 1;
    ctx.stroke();
  }
  const tp = pt(TIP.THUMB);
  ctx.beginPath();
  ctx.arc(tp.x, tp.y, 6, 0, Math.PI * 2);
  ctx.fillStyle = '#aaa';
  ctx.fill();
  ctx.stroke();
}

// ── Manager class ──

export class CustomGestureManager {
  constructor(getHandData) {
    this._getHand = getHandData;
    this._gestures = [];
    this._gestureThresholds = {};
    this._load();

    // Debounce state
    this._lastMatchId = null;
    this._matchCounter = 0;
    this._lastTriggerTime = 0;

    // Recording state
    this._recording = null;

    // Callbacks
    this.onAction = null;
    this.onThresholdsChanged = null;

    // Panel state
    this._panel = null;
    this._previewRaf = null;
  }

  // ── Persistence ──

  _load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const data = JSON.parse(raw);
      if (data.version !== DATA_VERSION) { localStorage.removeItem(STORAGE_KEY); return; }
      this._gestures = data.gestures || [];
      this._gestureThresholds = data.gestureThresholds || {};
    } catch { /* ignore */ }
  }

  _save() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      version: DATA_VERSION,
      gestureThresholds: this._gestureThresholds,
      gestures: this._gestures,
    }));
  }

  get count() { return this._gestures.length; }
  get gestureThresholds() { return this._gestureThresholds; }

  // ── Detection (called every frame from main) ──

  checkAndExecute(handData, currentBuiltinState, builtinScores) {
    if (this._gestures.length === 0 || !handData || !handData.keypoints) return;

    const features = extractFeatures(handData.keypoints);

    let bestMatch = null;
    let bestScore = 0;
    for (const g of this._gestures) {
      const score = matchScore(features, g.template);
      if (score > bestScore) {
        bestScore = score;
        bestMatch = g;
      }
    }

    if (!bestMatch || bestScore < MATCH_THRESHOLD) {
      this._lastMatchId = null;
      this._matchCounter = 0;
      return;
    }

    const builtinBest = Math.max(0, ...Object.values(builtinScores || {}));
    if (bestScore <= builtinBest) {
      this._lastMatchId = null;
      this._matchCounter = 0;
      return;
    }

    if (bestMatch.id === this._lastMatchId) {
      this._matchCounter++;
    } else {
      this._lastMatchId = bestMatch.id;
      this._matchCounter = 1;
    }

    if (this._matchCounter < DEBOUNCE_FRAMES) return;

    const now = Date.now();
    if (now - this._lastTriggerTime < DEAD_ZONE_MS) return;

    this._lastTriggerTime = now;
    this._lastMatchId = null;
    this._matchCounter = 0;
    this._dispatch(bestMatch);
  }

  _dispatch(gesture) {
    if (!this.onAction) return;
    this.onAction(gesture.action, gesture.name);
  }

  // ── Panel UI ──

  showPanel() {
    if (this._panel) { this.closePanel(); }

    const panel = document.createElement('div');
    panel.id = 'cg-panel';
    panel.innerHTML = `
      <div class="cg-header">
        <h2>⚡ 自定义手势</h2>
        <button class="cg-close-btn" id="cg-close-btn">✕</button>
      </div>
      <div class="cg-list" id="cg-list"></div>`;

    document.body.appendChild(panel);
    this._panel = panel;

    panel.querySelector('#cg-close-btn').addEventListener('click', () => this.closePanel());
    requestAnimationFrame(() => panel.classList.add('open'));
    this._renderList();

    this._escHandler = (e) => { if (e.key === 'Escape') this.closePanel(); };
    document.addEventListener('keydown', this._escHandler);
  }

  closePanel() {
    if (this._previewRaf) { cancelAnimationFrame(this._previewRaf); this._previewRaf = null; }
    if (this._recKeyHandler) { document.removeEventListener('keydown', this._recKeyHandler); this._recKeyHandler = null; }
    if (this._escHandler) { document.removeEventListener('keydown', this._escHandler); this._escHandler = null; }
    this._recording = null;
    if (this._panel) {
      this._panel.classList.remove('open');
      setTimeout(() => { this._panel?.remove(); this._panel = null; }, 300);
    }
  }

  _renderList() {
    const listEl = this._panel?.querySelector('#cg-list');
    if (!listEl) return;

    listEl.innerHTML = '';

    // ── Section: Built-in gesture thresholds ──
    const thSection = document.createElement('div');
    thSection.innerHTML = '<h3 style="color:#aaa;font-size:13px;margin-bottom:10px;">手势触发阈值</h3>';
    for (const meta of BUILTIN_META) {
      const currentTh = this._gestureThresholds[meta.id] || 60;
      const row = document.createElement('div');
      row.className = 'cg-threshold-row';
      row.innerHTML = `
        <span class="cg-item-icon" style="font-size:18px;">${meta.icon}</span>
        <span style="font-size:13px;color:#ccc;min-width:56px;">${meta.label}</span>
        <input type="range" class="cg-threshold-slider" data-gesture="${meta.id}"
               min="40" max="95" value="${currentTh}" step="5">
        <span class="cg-threshold-val" data-gesture="${meta.id}">${currentTh}</span>
        <button class="cg-overwrite-btn" data-gesture="${meta.id}" title="10次采样校准">录</button>`;
      row.querySelector('.cg-overwrite-btn').addEventListener('click', () => this._startOverwrite(meta));
      const slider = row.querySelector('.cg-threshold-slider');
      const valDisplay = row.querySelector('.cg-threshold-val');
      slider.addEventListener('input', () => {
        valDisplay.textContent = slider.value;
      });
      thSection.appendChild(row);
    }

    // Save button
    const saveRow = document.createElement('div');
    saveRow.style.cssText = 'margin-top:12px;display:flex;gap:8px;';
    const saveBtn = document.createElement('button');
    saveBtn.className = 'cg-save-btn';
    saveBtn.textContent = '💾 保存阈值';
    saveBtn.style.cssText = 'flex:1;';
    saveBtn.addEventListener('click', () => {
      // Read all sliders
      const sliders = this._panel?.querySelectorAll('.cg-threshold-slider');
      if (sliders) {
        for (const s of sliders) {
          this._gestureThresholds[s.dataset.gesture] = parseInt(s.value);
        }
      }
      this._save();
      if (this.onThresholdsChanged) {
        this.onThresholdsChanged(this._gestureThresholds);
      }
      // Brief feedback
      saveBtn.textContent = '✓ 已保存';
      saveBtn.style.background = '#00cc66';
      setTimeout(() => {
        saveBtn.textContent = '💾 保存阈值';
        saveBtn.style.background = '#4488ff';
      }, 800);
    });
    saveRow.appendChild(saveBtn);
    thSection.appendChild(saveRow);
    listEl.appendChild(thSection);

    // ── Divider ──
    const divider = document.createElement('div');
    divider.style.cssText = 'border-top:1px solid #1f1f4a;margin:20px 0;';
    listEl.appendChild(divider);

    // ── Section: Custom gestures ──
    const cgLabel = document.createElement('h3');
    cgLabel.style.cssText = 'color:#aaa;font-size:13px;margin-bottom:8px;';
    cgLabel.textContent = '自定义手势 (3次采样)';
    listEl.appendChild(cgLabel);

    const addBtn = document.createElement('button');
    addBtn.className = 'cg-add-btn';
    addBtn.textContent = '+ 添加新手势';
    addBtn.addEventListener('click', () => this._startCustomRecord());
    listEl.appendChild(addBtn);

    if (this._gestures.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'cg-empty';
      empty.textContent = '还没有自定义手势，点击上方按钮创建';
      listEl.appendChild(empty);
    } else {
      for (const g of this._gestures) {
        const actionLabel = (() => {
          const info = AVAILABLE_ACTIONS.find(a => a.type === g.action.type);
          if (!info) return g.action.type;
          if (g.action.type === 'setColor' && g.action.value) {
            return `${info.icon} ${info.label}: <span style="display:inline-block;width:12px;height:12px;border-radius:50%;background:${g.action.value};vertical-align:middle"></span>`;
          }
          if ((g.action.type === 'setBrushSize' || g.action.type === 'setEraserSize') && g.action.value) {
            return `${info.icon} ${info.label}: ${g.action.value}`;
          }
          if (g.action.type === 'setBackground' && g.action.value) {
            const bgLabel = g.action.value === '#000000' ? '黑色' : g.action.value === '#ffffff' ? '白色' : '透明';
            return `${info.icon} ${info.label}: ${bgLabel}`;
          }
          return `${info.icon} ${info.label}`;
        })();

        const item = document.createElement('div');
        item.className = 'cg-item';
        item.innerHTML = `
          <div class="cg-item-icon">✋</div>
          <div class="cg-item-info">
            <div class="cg-item-name">${this._esc(g.name)}</div>
            <div class="cg-item-action">${actionLabel}</div>
          </div>
          <button class="cg-item-del" data-id="${g.id}" title="删除">✕</button>`;
        item.querySelector('.cg-item-del').addEventListener('click', (e) => {
          e.stopPropagation();
          this._deleteGesture(g.id);
        });
        listEl.appendChild(item);
      }
    }
  }

  _esc(s) { const d = document.createElement('div'); d.textContent = s; return d.innerHTML; }

  _deleteGesture(id) {
    this._gestures = this._gestures.filter(g => g.id !== id);
    this._save();
    this._renderList();
  }

  // ── Overwrite built-in gesture (10 samples) ──

  _startOverwrite(meta) {
    this._recording = {
      type: 'overwrite',
      gestureId: meta.id,
      samples: [],  // array of { kp, score }
      meta,
    };

    this._renderRecordingUI(meta.icon, meta.label, OVERWRITE_SAMPLES);
  }

  // ── Custom gesture recording (3 samples) ──

  _startCustomRecord() {
    this._recording = {
      type: 'custom',
      samples: [],      // array of feature vectors
      name: '',
      action: null,
      actionValue: null,
    };

    this._renderRecordingUI('✋', '自定义手势', CUSTOM_RECORD_SAMPLES);
    // Show name input for custom gestures
    const section = this._panel?.querySelector('.cg-record-section');
    if (section) {
      const input = document.createElement('input');
      input.className = 'cg-record-name-input';
      input.id = 'cg-rec-name';
      input.placeholder = '手势名称（如：快速换红色）';
      input.maxLength = 20;
      section.insertBefore(input, section.firstChild);
      setTimeout(() => input.focus(), 100);
    }
  }

  // ── Shared recording UI ──

  _renderRecordingUI(icon, label, totalSamples) {
    const listEl = this._panel?.querySelector('#cg-list');
    if (!listEl) return;

    listEl.innerHTML = `
      <div class="cg-record-section">
        <div class="cg-record-preview">
          <canvas id="cg-preview-canvas"></canvas>
        </div>
        <div class="cg-record-status" id="cg-rec-status">○ 将手放入摄像头范围</div>
        <div style="text-align:center;font-size:18px;margin-bottom:8px;">${icon} <b>${label}</b></div>
        <div class="cg-sample-dots" id="cg-sample-dots">
          ${Array.from({length: totalSamples}, (_, i) =>
            `<div class="cg-sample-dot" data-idx="${i}"></div>`).join('')}
        </div>
        <button class="cg-record-btn" id="cg-rec-btn">● 录制 (空格键) 0/${totalSamples}</button>
        <div class="cg-record-actions">
          <button class="cg-back-btn" id="cg-rec-back">← 返回列表</button>
          <button class="cg-cancel-btn" id="cg-rec-cancel">取消</button>
        </div>
        <div class="cg-action-picker" id="cg-action-picker" style="display:none"></div>
      </div>`;

    listEl.querySelector('#cg-rec-back').addEventListener('click', () => {
      this._stopPreview();
      this._recording = null;
      this._renderList();
    });
    listEl.querySelector('#cg-rec-cancel').addEventListener('click', () => {
      this._stopPreview();
      this._recording = null;
      this.closePanel();
    });

    listEl.querySelector('#cg-rec-btn').addEventListener('click', () => this._recordSample());

    this._recKeyHandler = (e) => {
      if (e.code === 'Space') { e.preventDefault(); this._recordSample(); }
    };
    document.addEventListener('keydown', this._recKeyHandler);

    const canvas = listEl.querySelector('#cg-preview-canvas');
    const updateSize = () => {
      const parent = canvas.parentElement;
      canvas.width = parent.clientWidth;
      canvas.height = parent.clientHeight;
    };
    updateSize();
    window.addEventListener('resize', updateSize);

    this._startPreview(canvas);
  }

  _startPreview(canvas) {
    const loop = () => {
      if (!this._recording) return;
      this._previewRaf = requestAnimationFrame(loop);
      const hand = this._getHand();
      const ctx = canvas.getContext('2d');
      if (!hand) {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.fillStyle = 'rgba(255,255,255,0.04)';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        this._setRecStatus(false);
        return;
      }
      this._setRecStatus(true);
      drawPreviewSkeleton(ctx, hand.keypoints, canvas.width, canvas.height);
    };
    this._previewRaf = requestAnimationFrame(loop);
  }

  _stopPreview() {
    if (this._previewRaf) { cancelAnimationFrame(this._previewRaf); this._previewRaf = null; }
    if (this._recKeyHandler) { document.removeEventListener('keydown', this._recKeyHandler); this._recKeyHandler = null; }
  }

  _setRecStatus(detected) {
    const el = this._panel?.querySelector('#cg-rec-status');
    if (!el) return;
    el.textContent = detected ? '✓ 已检测到手部' : '○ 将手放入摄像头范围';
    el.className = detected ? 'cg-record-status detected' : 'cg-record-status';
  }

  _recordSample() {
    if (!this._recording) return;
    const hand = this._getHand();
    const btn = this._panel?.querySelector('#cg-rec-btn');

    if (!hand) {
      if (btn) { btn.style.background = '#ff4444'; btn.textContent = '✗ 未检测到手'; }
      setTimeout(() => {
        const total = this._recording.type === 'overwrite' ? OVERWRITE_SAMPLES : CUSTOM_RECORD_SAMPLES;
        if (btn) { btn.style.background = '#00ff88'; btn.textContent = `● 录制 (空格键) ${this._recording.samples.length}/${total}`; }
      }, 1200);
      return;
    }

    if (this._recording.type === 'overwrite') {
      // Compute the gesture engine's score for this sample
      const scores = computeGestureScores(hand.keypoints, 'idle');
      const score = scores[this._recording.gestureId] || 0;
      this._recording.samples.push({ kp: hand.keypoints, score });
    } else {
      // Custom gesture: extract features
      this._recording.samples.push(extractFeatures(hand.keypoints));
    }

    const total = this._recording.type === 'overwrite' ? OVERWRITE_SAMPLES : CUSTOM_RECORD_SAMPLES;
    const filled = this._recording.samples.length;

    // Update dots
    const dots = this._panel?.querySelectorAll('.cg-sample-dot');
    dots?.forEach((d, i) => { d.classList.toggle('filled', i < filled); });

    if (btn) {
      btn.style.background = '#00cc66';
      btn.textContent = `✓ 已录制 ${filled}/${total}`;
      setTimeout(() => {
        if (btn) { btn.style.background = '#00ff88'; btn.textContent = `● 录制 (空格键) ${filled}/${total}`; }
      }, 300);
    }

    if (filled >= total) {
      if (this._recording.type === 'overwrite') {
        this._finishOverwrite();
      } else {
        this._showActionPicker();
      }
    }
  }

  // ── Finish overwrite ──

  _finishOverwrite() {
    const scores = this._recording.samples.map(s => s.score);
    const avg = scores.reduce((a, b) => a + b, 0) / scores.length;
    const min = Math.min(...scores);
    const max = Math.max(...scores);

    // Set threshold to 70% of average, clamped between 40-65
    const threshold = Math.max(40, Math.min(65, Math.round(avg * 0.7)));
    this._gestureThresholds[this._recording.gestureId] = threshold;
    this._save();

    // Notify external listeners
    if (this.onThresholdsChanged) {
      this.onThresholdsChanged(this._gestureThresholds);
    }

    // Show result
    const section = this._panel?.querySelector('.cg-record-section');
    if (section) {
      section.innerHTML = `
        <div style="text-align:center;padding:20px;">
          <div style="font-size:48px;margin-bottom:12px;">✓</div>
          <h3 style="color:#00ff88;margin-bottom:8px;">覆写完成</h3>
          <p style="color:#aaa;font-size:14px;">
            ${this._recording.meta.icon} ${this._recording.meta.label}<br>
            平均分: ${avg.toFixed(0)} | 范围: ${min}-${max}<br>
            <span style="color:#00ff88">新阈值: ${threshold}</span>
          </p>
          <button class="cg-back-btn" id="cg-ow-done" style="margin-top:16px;">返回列表</button>
        </div>`;
      section.querySelector('#cg-ow-done').addEventListener('click', () => {
        this._stopPreview();
        this._recording = null;
        this._renderList();
      });
    }

    console.log(`[CustomGesture] Overwrite ${this._recording.gestureId}: avg=${avg.toFixed(0)}, threshold=${threshold}`);
  }

  // ── Custom gesture action picker & save ──

  _showActionPicker() {
    const picker = this._panel?.querySelector('#cg-action-picker');
    const btn = this._panel?.querySelector('#cg-rec-btn');
    if (!picker || !btn) return;

    picker.style.display = 'block';
    btn.style.display = 'none';

    picker.innerHTML = '<h3>选择手势动作</h3>';

    for (const action of AVAILABLE_ACTIONS) {
      const opt = document.createElement('button');
      opt.className = 'cg-action-option';
      opt.textContent = `${action.icon} ${action.label}`;
      opt.addEventListener('click', () => {
        if (action.needsColor) {
          this._showColorPicker(action);
        } else if (action.needsSize) {
          this._showSizePicker(action);
        } else if (action.needsBackground) {
          this._showBackgroundPicker(action);
        } else {
          this._recording.action = action.type;
          this._recording.actionValue = null;
          this._showSaveButton();
        }
      });
      picker.appendChild(opt);
    }
  }

  _showColorPicker(action) {
    const picker = this._panel?.querySelector('#cg-action-picker');
    if (!picker) return;

    const colors = ['#00ff88', '#ff4444', '#4488ff', '#ffaa00', '#aa44ff', '#ffffff'];
    picker.innerHTML = '<h3>选择目标颜色</h3><div class="cg-action-color-row"></div>';
    const row = picker.querySelector('.cg-action-color-row');

    for (const c of colors) {
      const swatch = document.createElement('div');
      swatch.className = 'cg-action-color-swatch';
      swatch.style.background = c;
      swatch.addEventListener('click', () => {
        this._recording.action = action.type;
        this._recording.actionValue = c;
        this._showSaveButton();
      });
      row.appendChild(swatch);
    }
  }

  _showSizePicker(action) {
    const picker = this._panel?.querySelector('#cg-action-picker');
    if (!picker) return;

    const sizes = action.type === 'setBrushSize'
      ? [
          { label: '细 S (2px)', value: 'S' },
          { label: '中 M (4px)', value: 'M' },
          { label: '粗 L (12px)', value: 'L' },
        ]
      : [
          { label: '小 (15px)', value: 'S' },
          { label: '中 (30px)', value: 'M' },
          { label: '大 (50px)', value: 'L' },
        ];

    picker.innerHTML = `<h3>选择${action.icon} ${action.label} 档位</h3>`;
    for (const size of sizes) {
      const opt = document.createElement('button');
      opt.className = 'cg-action-option';
      opt.textContent = size.label;
      opt.addEventListener('click', () => {
        this._recording.action = action.type;
        this._recording.actionValue = size.value;
        this._showSaveButton();
      });
      picker.appendChild(opt);
    }
  }

  _showBackgroundPicker(action) {
    const picker = this._panel?.querySelector('#cg-action-picker');
    if (!picker) return;

    const backgrounds = [
      { label: '⬛ 黑色背景', value: '#000000' },
      { label: '⬜ 白色背景', value: '#ffffff' },
      { label: '🫥 透明背景', value: 'transparent' },
    ];

    picker.innerHTML = `<h3>选择${action.icon} 目标背景</h3>`;
    for (const bg of backgrounds) {
      const opt = document.createElement('button');
      opt.className = 'cg-action-option';
      opt.textContent = bg.label;
      opt.addEventListener('click', () => {
        this._recording.action = action.type;
        this._recording.actionValue = bg.value;
        this._showSaveButton();
      });
      picker.appendChild(opt);
    }
  }

  _showSaveButton() {
    const picker = this._panel?.querySelector('#cg-action-picker');
    if (!picker) return;

    const nameInput = this._panel?.querySelector('#cg-rec-name');
    const name = (nameInput?.value || '').trim() || '自定义手势';

    const saveBtn = document.createElement('button');
    saveBtn.className = 'cg-save-btn';
    saveBtn.textContent = `✓ 保存手势 "${name}"`;
    saveBtn.addEventListener('click', () => this._saveGesture(name));
    picker.appendChild(saveBtn);
  }

  _saveGesture(name) {
    const template = avgFeatures(this._recording.samples);
    const gesture = {
      id: 'custom-' + Date.now(),
      name,
      action: { type: this._recording.action, value: this._recording.actionValue },
      template,
    };

    this._gestures.push(gesture);
    this._save();

    this._stopPreview();
    this._recording = null;
    this._renderList();
  }
}
