# 工具栏 UI 改版 & 手势精简 & 自定义手势扩展 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将手势从 5 个精简到 2 个核心姿势，工具栏重构为左侧纵向 5 区卡片布局，自定义手势动作从 4 种扩展到 8 种，引入三层视觉反馈体系，区域擦除替代整线擦除。

**Architecture:** 自底向上重构：先改独立的数据层（draw-layer 区域擦除+redo 栈），再改核心状态机（2 手势+长按/脉冲检测），然后新增反馈模块，接着重写工具栏和自定义手势面板，最后在 main.js 中集成所有模块。

**Tech Stack:** Vanilla JS (ES modules), HTML5 Canvas 2D, CSS3 transitions

**Spec:** `docs/superpowers/specs/2026-05-29-toolbar-gesture-redesign.md`

---

## 文件结构

| 文件 | 操作 | 职责 |
|---|---|---|
| `frontend/js/draw-layer.js` | 修改 | 区域擦除算法 + redo 栈 |
| `frontend/js/gesture-state-machine.js` | 重写 | 2 手势评分 + 稳定检测 + 脉冲检测 |
| `frontend/js/feedback-layer.js` | **新建** | L1 状态卡 / L2 进度环 / L3 Toast |
| `frontend/js/toolbar.js` | 重写 | 左侧纵向 5 区卡片工具栏 |
| `frontend/js/custom-gestures.js` | 修改 | 动作类型扩展 + 新动作选择器 UI |
| `frontend/js/calibration.js` | 修改 | 移除 SWITCH 手势的校准 |
| `frontend/js/main.js` | 修改 | 集成新架构 |
| `frontend/js/gesture-feedback.js` | 移除 | 功能并入 feedback-layer.js |
| `frontend/css/style.css` | 重写 | 侧边栏 + 反馈层 + 自定义面板样式 |
| `frontend/index.html` | 修改 | DOM 结构调整 |

---

### Task 1: DrawLayer — 区域擦除算法

**Files:**
- Modify: `frontend/js/draw-layer.js`

**Background:** 当前 `eraseAt()` 是整线擦除逻辑（擦除圆碰到笔画上任意一个点，整根线标记 erased）。改为片段擦除：只删除圆内的连续点段，圆外点段保留为独立笔画。

- [ ] **Step 1: 重构 `eraseAt()` 为片段擦除**

替换 `frontend/js/draw-layer.js` 中的 `eraseAt()` 方法（L92-115）：

```javascript
eraseAt(center) {
  const r = this.eraseRadius;
  let changed = false;
  const newStrokes = [];

  for (const stroke of this.strokes) {
    if (stroke.erased) continue;

    // Bbox quick reject
    if (center.x + r < stroke.bbox.x || center.x - r > stroke.bbox.x + stroke.bbox.w ||
        center.y + r < stroke.bbox.y || center.y - r > stroke.bbox.y + stroke.bbox.h) {
      continue;
    }

    // Mark erased points
    const keep = stroke.points.map(pt => {
      const dx = pt.x - center.x;
      const dy = pt.y - center.y;
      return (dx * dx + dy * dy < r * r) ? null : pt;
    });

    // If nothing was erased, skip
    const anyErased = keep.some(p => p === null);
    if (!anyErased) continue;

    changed = true;
    stroke.erased = true;

    // Split remaining points into continuous segments
    let segment = [];
    for (const pt of keep) {
      if (pt !== null) {
        segment.push(pt);
      } else {
        if (segment.length > 2) {
          newStrokes.push(this._makeFragment(stroke, segment));
        }
        segment = [];
      }
    }
    if (segment.length > 2) {
      newStrokes.push(this._makeFragment(stroke, segment));
    }
  }

  // Add surviving fragments
  for (const frag of newStrokes) {
    this.strokes.push(frag);
  }

  if (changed) this._redrawHistory();
  return changed;
}
```

- [ ] **Step 2: 新增 `_makeFragment()` 辅助方法**

在 `DrawLayer` 类中（`endStroke` 之后的位置）加入：

```javascript
_makeFragment(sourceStroke, points) {
  const bbox = { x: points[0].x, y: points[0].y, w: 0, h: 0 };
  for (const pt of points) {
    const nx = Math.min(bbox.x, pt.x);
    const ny = Math.min(bbox.y, pt.y);
    bbox.w = Math.max(bbox.x + bbox.w, pt.x) - nx;
    bbox.h = Math.max(bbox.y + bbox.h, pt.y) - ny;
    bbox.x = nx;
    bbox.y = ny;
  }
  return {
    id: crypto.randomUUID(),
    color: sourceStroke.color,
    lineWidth: sourceStroke.lineWidth,
    points,
    erased: false,
    bbox,
  };
}
```

- [ ] **Step 3: 新增橡皮大小设置方法**

在 `DrawLayer` 类中加入：

```javascript
setEraserRadius(r) {
  this.eraseRadius = r;
}
```

- [ ] **Step 4: 验证 — 启动应用，测试区域擦除**

启动前后端，用手势擦除书写内容，确认：
- 擦除圆只删除覆盖范围内的笔画片段
- 圆外片段保留为独立笔画
- 完全擦除笔画后不留碎片

- [ ] **Step 5: Commit**

```bash
git add frontend/js/draw-layer.js
git commit -m "feat: replace whole-stroke erase with region-based fragment erase"
```

---

### Task 2: DrawLayer — Redo 栈

**Files:**
- Modify: `frontend/js/draw-layer.js`

**Background:** 撤销的笔画需要能恢复。新增 `redoStack`，撤销时 push 进去，重做时 pop 回来，新笔画清空 redo 栈。

- [ ] **Step 1: 初始化 redo 栈**

在 `constructor` 中（L10 附近）添加：

```javascript
this.redoStack = [];
```

- [ ] **Step 2: 修改 `undo()` 方法，将撤销的笔画推入 redo 栈**

替换 `undo()` 方法（L117-126）：

```javascript
undo() {
  for (let i = this.strokes.length - 1; i >= 0; i--) {
    if (!this.strokes[i].erased) {
      this.strokes[i].erased = true;
      this.redoStack.push(this.strokes[i]);
      this._redrawHistory();
      return true;
    }
  }
  return false;
}
```

- [ ] **Step 3: 新增 `redo()` 方法**

在 `undo()` 后面加入：

```javascript
redo() {
  if (this.redoStack.length === 0) return false;
  const stroke = this.redoStack.pop();
  stroke.erased = false;
  this._redrawHistory();
  return true;
}
```

- [ ] **Step 4: 修改 `clearAll()` 清空 redo 栈**

替换 `clearAll()` 方法（L128-131）：

```javascript
clearAll() {
  for (const s of this.strokes) s.erased = true;
  this.redoStack = [];
  this._redrawHistory();
}
```

- [ ] **Step 5: 修改 `beginStroke()` 清空 redo 栈**

在 `beginStroke()` 方法开头（L37 之后）添加：

```javascript
this.redoStack = [];
```

- [ ] **Step 6: Commit**

```bash
git add frontend/js/draw-layer.js
git commit -m "feat: add redo stack to DrawLayer"
```

---

### Task 3: GestureStateMachine — 2 手势重写

**Files:**
- Modify: `frontend/js/gesture-state-machine.js`

**Background:** 当前 5 个手势（WRITE/CLEAR/ERASE/SWITCH/UNDO）→ 精简到 2 个（WRITE/ERASE）。清除由擦除手势长按+稳定触发，撤销由捏合快速脉冲触发。移除 SWITCH。

- [ ] **Step 1: 更新 Gesture 常量和移除 SWITCH 手势**

修改文件顶部：

```javascript
const Gesture = Object.freeze({
  IDLE:   'idle',
  WRITE:  'write',
  ERASE:  'erase',
});
```

- [ ] **Step 2: 重写 `computeGestureScores()` — 只保留 WRITE 和 ERASE 评分**

替换从 L67 到 L106 的 `computeGestureScores` 函数：

```javascript
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

  return scores;
}
```

- [ ] **Step 3: 重写 `GestureStateMachine` 类 — 添加稳定检测和脉冲检测**

替换整个类体。保留 `update()` 的核心状态机框架，但重组为 2 手势逻辑。关键改动：

```javascript
// 在 constructor 中添加新的配置参数
constructor({
  debounceFrames = 3,
  idleFrames = 5,
  deadZoneMs = 300,
  clearHoldMs = 1500,
  undoPulseMaxMs = 300,
  undoDeadZoneMs = 500,
  eraseStableThreshold = 0.03,  // normalized screen space
  scoreThreshold = 60,
} = {}) {
  // ... 现有字段 ...
  this.clearHoldMs = clearHoldMs;
  this.undoPulseMaxMs = undoPulseMaxMs;
  this.undoDeadZoneMs = undoDeadZoneMs;
  this.eraseStableThreshold = eraseStableThreshold;

  // 新增稳定检测状态
  this._eraseStableAnchor = null;    // {x, y} 稳定锚点
  this._eraseStableDuration = 0;      // 累积稳定时间 ms
  this._eraseStableLastTs = 0;

  // 新增脉冲检测状态
  this._writeStartTime = null;
  this._writeStartedStroke = false;   // 是否已落笔（用于区分撤销脉冲）
  this._lastUndoTime = 0;

  // ... 其余初始化 ...
}
```

- [ ] **Step 4: 添加清除稳定判定到 `_handleStateAction`**

在 `_handleStateAction` 的 `ERASE` case 中（替换 L293-296）：

```javascript
case Gesture.ERASE: {
  const ex = this.eraseFilterX.filter(pc.x, ts / 1000);
  const ey = this.eraseFilterY.filter(pc.y, ts / 1000);
  if (this.onEraseAt) this.onEraseAt({ x: ex, y: ey });

  // Stability detection for clear canvas
  const now = Date.now();
  if (this._eraseStableAnchor === null) {
    this._eraseStableAnchor = { x: pc.x, y: pc.y };
    this._eraseStableDuration = 0;
  }
  const dx = pc.x - this._eraseStableAnchor.x;
  const dy = pc.y - this._eraseStableAnchor.y;
  const moved = Math.hypot(dx, dy);

  if (moved < this.eraseStableThreshold) {
    this._eraseStableDuration += (now - this._eraseStableLastTs);
    const progress = Math.min(this._eraseStableDuration / this.clearHoldMs, 1);
    if (this.onClearProgress) this.onClearProgress(progress);
    if (progress >= 1) {
      if (this.onClear) this.onClear();
      this._eraseStableAnchor = null;
      this._eraseStableDuration = 0;
      this._transition(Gesture.IDLE);
    }
  } else {
    // Reset stability tracking
    this._eraseStableAnchor = { x: pc.x, y: pc.y };
    this._eraseStableDuration = 0;
    if (this.onClearProgress) this.onClearProgress(0);
  }
  this._eraseStableLastTs = now;
  break;
}
```

- [ ] **Step 5: 在 `_handleStateAction` 的 WRITE case 中记录落笔状态**

在 WRITE case 开头（L283 之后）加入：

```javascript
if (this.onWritePoint) {
  this._writeStartedStroke = true;
}
```

- [ ] **Step 6: 在 `_transition` 中添加撤销脉冲检测**

在 `_transition` 方法中（L247 最后），检测从 WRITE 到 IDLE 的快速脉冲：

```javascript
// Check for undo pulse: quick pinch-open without drawing
if (this.prevState === Gesture.WRITE && newState === Gesture.IDLE) {
  const pulseDuration = now - this._writeStartTime;
  if (pulseDuration < this.undoPulseMaxMs &&
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
```

- [ ] **Step 7: 移除 SWITCH 相关代码**

删除 `_handleStateAction` 中 `Gesture.SWITCH` case（L298-301），以及 `onSwitchColor` 相关字段。

- [ ] **Step 8: 移除 CLEAR 和 UNDO 的独立状态处理**

删除 `_handleStateAction` 中原有的 `Gesture.CLEAR` case（L303-313）和 `Gesture.UNDO` case（L315-326）。

- [ ] **Step 9: 简化 `resetDefaults()`**

```javascript
resetDefaults() {
  this.scoreThreshold = 60;
  this._gestureThresholds = { ...DEFAULT_GESTURE_THRESHOLDS };
}
```

- [ ] **Step 10: Commit**

```bash
git add frontend/js/gesture-state-machine.js
git commit -m "refactor: reduce gestures from 5 to 2 (write/erase) with hold/pulse detection"
```

---

### Task 4: FeedbackLayer — 新建三层反馈模块

**Files:**
- Create: `frontend/js/feedback-layer.js`

**Background:** 新建独立模块，统一管理 L1 手势状态卡（右上角）、L2 环形进度条（中央）、L3 Toast（顶部中央）。替代旧的 `gesture-feedback.js`。

- [ ] **Step 1: 创建 `feedback-layer.js`**

```javascript
// Three-layer visual feedback for gesture interactions
// L1: Persistent gesture status card (top-right of canvas)
// L2: Hold progress ring (center of canvas, for hold-to-activate gestures)
// L3: Action confirmation toast (top-center, transient)

export class FeedbackLayer {
  constructor(containerId) {
    const container = document.getElementById(containerId);
    if (!container) throw new Error(`Container #${containerId} not found`);

    // L1 — Gesture status card
    this._l1 = document.createElement('div');
    this._l1.className = 'fb-status';
    this._l1.style.opacity = '0';
    container.appendChild(this._l1);

    // L2 — Hold progress ring (SVG)
    this._l2 = document.createElement('div');
    this._l2.className = 'fb-progress';
    this._l2.innerHTML = `
      <svg viewBox="0 0 100 100" class="fb-progress-svg">
        <circle cx="50" cy="50" r="42" class="fb-progress-track"/>
        <circle cx="50" cy="50" r="42" class="fb-progress-fill"
                stroke-dasharray="0 264" stroke-dashoffset="0"
                transform="rotate(-90 50 50)"/>
      </svg>
      <div class="fb-progress-icon"></div>`;
    this._l2.style.display = 'none';
    this._l2Fill = this._l2.querySelector('.fb-progress-fill');
    this._l2Icon = this._l2.querySelector('.fb-progress-icon');
    container.appendChild(this._l2);

    // L3 — Toast
    this._l3 = document.createElement('div');
    this._l3.className = 'fb-toast';
    this._l3.style.opacity = '0';
    container.appendChild(this._l3);

    this._l3Timer = null;
  }

  // ── L1: Gesture Status (persistent) ──

  showGestureStatus(icon, name, color, detail) {
    this._l1.innerHTML = `
      <span class="fb-status-icon">${icon}</span>
      <span class="fb-status-text">
        <span class="fb-status-name" style="color:${color}">${name}</span>
        <span class="fb-status-detail">${detail}</span>
      </span>`;
    this._l1.style.opacity = '1';
    this._l1.style.transform = 'scale(1.05)';
    requestAnimationFrame(() => {
      this._l1.style.transform = 'scale(1)';
    });
  }

  hideGestureStatus() {
    this._l1.style.opacity = '0';
  }

  // ── L2: Hold Progress (transient) ──

  showHoldProgress(progress, icon, color) {
    // progress: 0.0 ~ 1.0
    const circumference = 2 * Math.PI * 42; // ~264
    const dashLen = circumference * progress;
    this._l2Fill.setAttribute('stroke-dasharray', `${dashLen} ${circumference}`);
    this._l2Fill.style.stroke = color;
    this._l2Icon.textContent = icon;
    this._l2.style.display = 'block';
  }

  hideHoldProgress() {
    this._l2.style.display = 'none';
  }

  // ── L3: Action Toast (transient) ──

  showActionToast(icon, text, color, duration = 1000) {
    if (this._l3Timer) clearTimeout(this._l3Timer);

    this._l3.innerHTML = `<span>${icon}</span> <span>${text}</span>`;
    this._l3.style.borderColor = color;
    this._l3.style.color = color;
    this._l3.style.opacity = '1';
    this._l3.style.transform = 'translateX(-50%) translateY(0)';

    this._l3Timer = setTimeout(() => {
      this._l3.style.opacity = '0';
      this._l3.style.transform = 'translateX(-50%) translateY(-10px)';
    }, duration);
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add frontend/js/feedback-layer.js
git commit -m "feat: add three-layer visual feedback module (L1 status/L2 progress/L3 toast)"
```

---

### Task 5: Toolbar — 侧边栏重写

**Files:**
- Modify: `frontend/js/toolbar.js`

**Background:** 当前 `Toolbar` 渲染为底部横向单行。重写为左侧纵向 5 区卡片布局：颜色、笔刷、橡皮（新增）、画布操作、手势设置。

- [ ] **Step 1: 重写 `Toolbar` 类**

完整替换 `frontend/js/toolbar.js`：

```javascript
export class Toolbar {
  constructor(defaultColors = ['#00ff88', '#ff4444', '#4488ff', '#ffaa00', '#aa44ff', '#ffffff']) {
    this.colors = defaultColors;
    this.selectedColor = defaultColors[0];
    this.lineWidth = 4;
    this.eraserRadius = 30;

    // Presets
    this.brushPresets = { S: 2, M: 4, L: 12 };
    this.eraserPresets = { S: 15, M: 30, L: 50 };
    this.activeBrushPreset = 'M';
    this.activeEraserPreset = 'M';

    this.onColorChange = null;
    this.onLineWidthChange = null;
    this.onEraserRadiusChange = null;
    this.onUndo = null;
    this.onClear = null;
    this.onSave = null;
    this.onRedo = null;
    this.onCalibrate = null;
    this.onCustomGestures = null;
  }

  render(containerId) {
    const el = document.getElementById(containerId);
    el.className = 'tb-sidebar';
    el.innerHTML = `
      <!-- Section 1: Colors -->
      <div class="tb-card">
        <div class="tb-card-label">🎨 颜色</div>
        <div class="tb-colors">
          ${this.colors.map(c =>
            `<button class="tb-swatch${c === this.selectedColor ? ' active' : ''}"
                     style="background:${c}" data-color="${c}"></button>`
          ).join('')}
          <input type="color" class="tb-color-picker" value="${this.selectedColor}">
        </div>
      </div>

      <!-- Section 2: Brush -->
      <div class="tb-card">
        <div class="tb-card-label">🖌️ 笔刷</div>
        <div class="tb-preset-row">
          ${Object.entries(this.brushPresets).map(([k, v]) =>
            `<button class="tb-preset${k === this.activeBrushPreset ? ' active' : ''}"
                     data-preset="${k}" data-value="${v}">${k}</button>`
          ).join('')}
        </div>
        <input type="range" class="tb-slider" min="1" max="20" value="${this.lineWidth}">
        <div class="tb-slider-labels"><span>1</span><span>10</span><span>20</span></div>
      </div>

      <!-- Section 3: Eraser -->
      <div class="tb-card">
        <div class="tb-card-label">🧹 橡皮</div>
        <div class="tb-preset-row">
          ${Object.entries(this.eraserPresets).map(([k, v]) =>
            `<button class="tb-preset${k === this.activeEraserPreset ? ' active' : ''}"
                     data-preset="${k}" data-value="${v}">${k}</button>`
          ).join('')}
        </div>
        <div class="tb-slider-labels" style="margin-top:4px;">
          <span>15px (小)</span><span>30px (中)</span><span>50px (大)</span>
        </div>
      </div>

      <!-- Section 4: Canvas Actions -->
      <div class="tb-card">
        <div class="tb-card-label">📋 画布</div>
        <div class="tb-actions">
          <button class="tb-btn" title="撤销" id="tb-undo">↩</button>
          <button class="tb-btn" title="重做" id="tb-redo">↪</button>
          <button class="tb-btn" title="清空画布" id="tb-clear">✕</button>
          <button class="tb-btn" title="截图保存" id="tb-save">💾</button>
        </div>
      </div>

      <!-- Section 5: Gesture Settings -->
      <div class="tb-card" style="margin-top:auto;">
        <div class="tb-card-label">⚡ 手势</div>
        <div class="tb-actions">
          <button class="tb-btn" title="校准手势" id="tb-calibrate">⚙</button>
          <button class="tb-btn" title="自定义手势" id="tb-custom-gestures">⚡</button>
        </div>
      </div>
    `;

    this._bindEvents(el);
  }

  _bindEvents(el) {
    // Color swatches
    el.querySelectorAll('.tb-swatch').forEach(btn => {
      btn.addEventListener('click', () => {
        const color = btn.dataset.color;
        this.selectedColor = color;
        this._updateSwatchActive(el, color);
        el.querySelector('.tb-color-picker').value = color;
        if (this.onColorChange) this.onColorChange(color);
      });
    });

    // Color picker
    el.querySelector('.tb-color-picker').addEventListener('input', (e) => {
      this.selectedColor = e.target.value;
      this._updateSwatchActive(el, this.selectedColor);
      if (this.onColorChange) this.onColorChange(this.selectedColor);
    });

    // Brush presets
    el.querySelectorAll('.tb-card:nth-child(2) .tb-preset').forEach(btn => {
      btn.addEventListener('click', () => {
        const w = parseInt(btn.dataset.value);
        this.activeBrushPreset = btn.dataset.preset;
        this.lineWidth = w;
        this._updatePresetActive(el, '.tb-card:nth-child(2)', btn.dataset.preset);
        el.querySelector('.tb-card:nth-child(2) .tb-slider').value = w;
        if (this.onLineWidthChange) this.onLineWidthChange(w);
      });
    });

    // Brush slider
    el.querySelector('.tb-card:nth-child(2) .tb-slider').addEventListener('input', (e) => {
      this.lineWidth = parseInt(e.target.value);
      if (this.onLineWidthChange) this.onLineWidthChange(this.lineWidth);
    });

    // Eraser presets
    el.querySelectorAll('.tb-card:nth-child(3) .tb-preset').forEach(btn => {
      btn.addEventListener('click', () => {
        const r = parseInt(btn.dataset.value);
        this.activeEraserPreset = btn.dataset.preset;
        this.eraserRadius = r;
        this._updatePresetActive(el, '.tb-card:nth-child(3)', btn.dataset.preset);
        if (this.onEraserRadiusChange) this.onEraserRadiusChange(r);
      });
    });

    // Action buttons
    el.querySelector('#tb-undo').addEventListener('click', () => { if (this.onUndo) this.onUndo(); });
    el.querySelector('#tb-redo').addEventListener('click', () => { if (this.onRedo) this.onRedo(); });
    el.querySelector('#tb-clear').addEventListener('click', () => { if (this.onClear) this.onClear(); });
    el.querySelector('#tb-save').addEventListener('click', () => { if (this.onSave) this.onSave(); });

    // Gesture buttons
    el.querySelector('#tb-calibrate').addEventListener('click', () => { if (this.onCalibrate) this.onCalibrate(); });
    el.querySelector('#tb-custom-gestures').addEventListener('click', () => { if (this.onCustomGestures) this.onCustomGestures(); });
  }

  _updateSwatchActive(el, color) {
    el.querySelectorAll('.tb-swatch').forEach(b => {
      b.classList.toggle('active', b.dataset.color === color);
    });
  }

  _updatePresetActive(el, cardSelector, preset) {
    el.querySelectorAll(`${cardSelector} .tb-preset`).forEach(b => {
      b.classList.toggle('active', b.dataset.preset === preset);
    });
  }

  syncActiveColor(color) {
    this.selectedColor = color;
    const el = document.getElementById('toolbar');
    if (!el) return;
    this._updateSwatchActive(el, color);
    const picker = el.querySelector('.tb-color-picker');
    if (picker) picker.value = color;
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add frontend/js/toolbar.js
git commit -m "refactor: rewrite toolbar as left sidebar with 5 card sections"
```

---

### Task 6: CustomGestureManager — 动作类型扩展

**Files:**
- Modify: `frontend/js/custom-gestures.js`

**Background:** `AVAILABLE_ACTIONS` 数组从 4 种扩展到 8 种。`setBrushSize` 和 `setEraserSize` 需要值选择器。`setBackground` 需要黑/白/透明三选一。`redo` 无参数，直接添加。

- [ ] **Step 1: 扩展 `AVAILABLE_ACTIONS` 数组**

替换 L34-39：

```javascript
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
```

- [ ] **Step 2: 修改 `_showActionPicker()` 中的点击处理**

在 `_showActionPicker` 方法（L628-653）中更新 `click` 回调：

```javascript
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
```

- [ ] **Step 3: 新增 `_showSizePicker()` 方法**

在 `_showColorPicker` 之后添加：

```javascript
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
```

- [ ] **Step 4: 新增 `_showBackgroundPicker()` 方法**

```javascript
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
```

- [ ] **Step 5: 更新 `_renderList` 中自定义手势列表的动作名称显示**

在 `_renderList`（L378 附近），更新 action label 解析，在 `AVAILABLE_ACTIONS` 查找后增加新类型的显示：

在循环 `for (const g of this._gestures)` 内部，action 显示的代码已是通用模式（`AVAILABLE_ACTIONS.find(a => a.type === g.action.type)`），新增动作自动适用。但完善 `actionLabel` 逻辑以支持 `setBrushSize` 和 `setEraserSize` 的值显示：

```javascript
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
```

- [ ] **Step 6: Commit**

```bash
git add frontend/js/custom-gestures.js
git commit -m "feat: extend custom gesture actions with brush/eraser size, redo, and background"
```

---

### Task 7: Calibration — 移除 SWITCH 手势

**Files:**
- Modify: `frontend/js/calibration.js`

**Background:** 校准流程中仍有 5 个手势的 META 定义，需移除 `switch`。

- [ ] **Step 1: 从 `GESTURE_META` 中移除 `switch`**

在 L1-7，删除这一行：

```javascript
switch: { label: '拇指中指捏合', icon: '🔄', desc: '拇指与中指尖捏在一起，食指伸直，其余蜷曲' },
```

- [ ] **Step 2: Commit**

```bash
git add frontend/js/calibration.js
git commit -m "refactor: remove SWITCH gesture from calibration meta"
```

---

### Task 8: Main.js — 集成所有新模块

**Files:**
- Modify: `frontend/js/main.js`

**Background:** 旧的 main.js 引用了 5 个手势、旧的 Toolbar 横向布局、手动拼接按钮、旧的 GestureFeedback。需要全部替换为新架构集成。

- [ ] **Step 1: 更新 import**

替换 L1-9 的 import：

```javascript
import { VideoLayer, CameraPermissionError } from './video-layer.js';
import { WSClient } from './ws-client.js';
import { GestureStateMachine, Gesture } from './gesture-state-machine.js';
import { DrawLayer } from './draw-layer.js';
import { Toolbar } from './toolbar.js';
import { PerfMonitor } from './perf-monitor.js';
import { Calibration } from './calibration.js';
import { FeedbackLayer } from './feedback-layer.js';
import { CustomGestureManager } from './custom-gestures.js';
```

- [ ] **Step 2: 初始化 FeedbackLayer（替换 GestureFeedback）**

在 `constructor` 中，替换 `this.feedback = new GestureFeedback()`：

```javascript
this.feedback = new FeedbackLayer('video-container');
```

- [ ] **Step 3: 添加 `_redrawBackground()` 方法和背景状态**

在 `constructor` 中添加：

```javascript
this._bgColor = '#000000';
```

在类中新增方法：

```javascript
setBackground(bgColor) {
  this._bgColor = bgColor;
  const vc = document.getElementById('video-container');
  if (vc) vc.style.background = bgColor === 'transparent' ? 'transparent' : bgColor;
  // Toggle skeleton visibility for transparent bg
  const skel = document.getElementById('layer-skeleton');
  if (skel) {
    skel.style.background = bgColor === 'transparent' ? 'rgba(0,0,0,0.3)' : 'transparent';
  }
}
```

- [ ] **Step 4: 重写 `start()` 中的工具栏绑定**

替换 L80-85 的 toolbar 绑定：

```javascript
this.toolbar.render('toolbar');
this.toolbar.onColorChange = (c) => this.draw.setColor(c);
this.toolbar.onLineWidthChange = (w) => this.draw.setLineWidth(w);
this.toolbar.onEraserRadiusChange = (r) => this.draw.setEraserRadius(r);
this.toolbar.onUndo = () => this.draw.undo();
this.toolbar.onClear = () => this.draw.clearAll();
this.toolbar.onSave = () => this.draw.saveScreenshot();
this.toolbar.onRedo = () => this.draw.redo();
this.toolbar.onCalibrate = () => this._runCalibration();
this.toolbar.onCustomGestures = () => this.customGestures.showPanel();
```

- [ ] **Step 5: 重写 `onGestureChange` 回调（L87-99）**

替换为 2 手势的 L1 反馈：

```javascript
this.gesture.onGestureChange = (g, prev) => {
  document.getElementById('gesture-display').textContent = g;
  if (this._calibrating) return;
  if (prev === Gesture.WRITE && g !== Gesture.WRITE) {
    this.draw.endStroke();
  }
  // L1 feedback: gesture status card
  if (g === Gesture.WRITE) {
    this.feedback.showGestureStatus('🤏', '书写',
      this.draw.color, `· ${this.draw.lineWidth}px`);
    this.feedback.hideHoldProgress();
  } else if (g === Gesture.ERASE) {
    this.feedback.showGestureStatus('🖐️', '擦除',
      '#4488ff', `· ${this.draw.eraseRadius}px`);
  } else {
    this.feedback.hideGestureStatus();
    this.feedback.hideHoldProgress();
  }
};
```

- [ ] **Step 6: 移除 `onSwitchColor` 绑定**

删除 L119-126 的 `this.gesture.onSwitchColor = ...` 代码块。

- [ ] **Step 7: 添加 L2 进度和 L3 回调**

将进度回调改为新的 FeedbackLayer：

```javascript
this.gesture.onClearProgress = (p) => {
  if (p > 0) {
    this.feedback.showHoldProgress(p, '🖐️', '#ff4444');
  } else {
    this.feedback.hideHoldProgress();
  }
};
// onUndoProgress removed — undo is now a pulse, not a hold gesture
```

- [ ] **Step 8: 移除手动拼接的工具栏按钮**

删除 L192-220（recalBtn、resetBtn、cgBtn 三个手动按钮创建），这些现在是侧边栏的内置部分。

- [ ] **Step 9: 移除 `onSwitchColor` 的无用绑定，更新自定义手势回调**

确认 L127 附近的 `onClear`、`onUndo` 绑定保留。

更新 `onClear` 和 `onUndo` 添加 L3 toast：

```javascript
this.gesture.onClear = () => {
  if (this._calibrating) return;
  this.draw.clearAll();
  this.feedback.showActionToast('✕', '清空画布', '#ff4444', 800);
};
this.gesture.onUndo = () => {
  if (this._calibrating) return;
  this.draw.undo();
  // Pulse undo feedback is handled by the state machine — no extra toast here
};
```

- [ ] **Step 10: 更新自定义手势的 `onAction` 回调（L228-248）**

- [ ] **Step 11: 删除过时的 `_drawHoldProgress` 方法**

移除 App 类中 L335-350 的 `_drawHoldProgress(p, color)` 方法（40 行），其功能已由 `FeedbackLayer.showHoldProgress()` 替代。

- [ ] **Step 12: Commit**

添加新动作的处理：

```javascript
this.customGestures.onAction = (action, name) => {
  switch (action.type) {
    case 'setColor':
      this.draw.setColor(action.value);
      this.toolbar.syncActiveColor(action.value);
      this.feedback.showActionToast('🎨', `${name}: ${action.value}`, action.value, 800);
      break;
    case 'setBrushSize': {
      const brushMap = { S: 2, M: 4, L: 12 };
      const w = brushMap[action.value] || 4;
      this.draw.setLineWidth(w);
      this.feedback.showActionToast('🖌️', `${name}: ${action.value} (${w}px)`, '#00ff88', 800);
      break;
    }
    case 'setEraserSize': {
      const eraserMap = { S: 15, M: 30, L: 50 };
      const r = eraserMap[action.value] || 30;
      this.draw.setEraserRadius(r);
      this.feedback.showActionToast('🧹', `${name}: ${action.value} (${r}px)`, '#4488ff', 800);
      break;
    }
    case 'undo':
      this.draw.undo();
      this.feedback.showActionToast('↩', `撤销 (${name})`, '#cc66ff', 800);
      break;
    case 'redo':
      this.draw.redo();
      this.feedback.showActionToast('↪', `重做 (${name})`, '#00ff88', 800);
      break;
    case 'clear':
      this.draw.clearAll();
      this.feedback.showActionToast('✕', `清空 (${name})`, '#ff4444', 800);
      break;
    case 'save':
      this.draw.saveScreenshot();
      this.feedback.showActionToast('💾', `截图 (${name})`, '#4488ff', 1000);
      break;
    case 'setBackground':
      this.setBackground(action.value);
      const bgLabel = action.value === '#000000' ? '黑色' : action.value === '#ffffff' ? '白色' : '透明';
      this.feedback.showActionToast('🖼️', `背景: ${bgLabel}`, '#ffaa00', 800);
      break;
  }
};
```

- [ ] **Step 12: Commit**

```bash
git add frontend/js/main.js
git commit -m "refactor: integrate new gesture engine, sidebar toolbar, and feedback layer"
```

---

### Task 9: CSS — 侧边栏 + 反馈层样式

**Files:**
- Modify: `frontend/css/style.css`

**Background:** 当前 CSS 是底部横向工具栏 + 自定义面板 + toast。重写为侧边栏 + 3 层反馈 + 保留自定义面板。

- [ ] **Step 1: 重写 `style.css`**

完整内容：

```css
*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
body { background: #0a0a14; color: #eee; font-family: 'Segoe UI', system-ui, sans-serif; overflow: hidden; height: 100vh; }

/* ── App layout ── */
#app { display: flex; height: 100vh; }
#video-container {
  flex: 1; position: relative; overflow: hidden; background: #000;
  min-height: 0; transform: scaleX(-1);
}
#webcam { position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%); width: 100%; height: 100%; object-fit: contain; z-index: 0; pointer-events: none; }
#video-container canvas { position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%); }
#layer-skeleton { z-index: 1; }
#layer-history { z-index: 2; }
#layer-active { z-index: 2; }
#layer-cursor { z-index: 3; }

/* ── Sidebar toolbar ── */
#toolbar {
  width: 160px; flex-shrink: 0; overflow-y: auto;
  background: rgba(10,10,25,0.97); border-right: 1px solid rgba(255,255,255,0.06);
  padding: 10px; display: flex; flex-direction: column; gap: 8px;
  backdrop-filter: blur(12px); -webkit-backdrop-filter: blur(12px);
}
.tb-card {
  background: rgba(17,17,40,0.6); border: 1px solid rgba(255,255,255,0.05);
  border-radius: 10px; padding: 10px;
}
.tb-card-label {
  font-size: 10px; color: #555; text-transform: uppercase;
  letter-spacing: 0.1em; margin-bottom: 8px;
}
.tb-colors { display: flex; flex-wrap: wrap; gap: 5px; }
.tb-swatch {
  width: 22px; height: 22px; border-radius: 50%;
  border: 2px solid rgba(255,255,255,0.08);
  cursor: pointer; transition: all 0.15s ease; padding: 0;
}
.tb-swatch:hover { border-color: rgba(255,255,255,0.4); transform: scale(1.15); }
.tb-swatch.active { border-color: #fff; box-shadow: 0 0 8px rgba(255,255,255,0.3); }
.tb-color-picker { width: 22px; height: 22px; border: none; cursor: pointer; background: none; padding: 0; border-radius: 50%; }
.tb-preset-row { display: flex; gap: 4px; margin-bottom: 6px; }
.tb-preset {
  flex: 1; padding: 5px 0; border: 1px solid rgba(255,255,255,0.06);
  border-radius: 6px; background: transparent; color: #888;
  font-size: 11px; cursor: pointer; transition: all 0.15s;
}
.tb-preset:hover { color: #ccc; border-color: rgba(255,255,255,0.2); }
.tb-preset.active { background: rgba(0,255,136,0.1); color: #00ff88; border-color: rgba(0,255,136,0.3); }
.tb-slider { width: 100%; height: 3px; accent-color: rgba(0,255,136,0.5); margin: 4px 0; }
.tb-slider-labels { display: flex; justify-content: space-between; font-size: 9px; color: #444; }
.tb-actions { display: flex; gap: 4px; }
.tb-btn {
  flex: 1; height: 30px; border: 1px solid rgba(255,255,255,0.06);
  border-radius: 7px; background: transparent; color: rgba(255,255,255,0.4);
  cursor: pointer; font-size: 14px; display: flex; align-items: center;
  justify-content: center; transition: all 0.15s;
}
.tb-btn:hover { background: rgba(255,255,255,0.06); color: rgba(255,255,255,0.85); border-color: rgba(255,255,255,0.15); }

/* ── Status bar (bottom) ── */
#status-bar {
  position: fixed; bottom: 0; left: 160px; right: 0;
  display: flex; gap: 16px; padding: 3px 16px; font-size: 10px;
  color: rgba(255,255,255,0.2); background: rgba(8,8,20,0.95);
  z-index: 100; pointer-events: none;
}
#ws-status { color: rgba(255,100,100,0.5); font-size: 8px; vertical-align: middle; }
#ws-status.connected { color: rgba(100,255,100,0.5); }
#gesture-display { text-transform: capitalize; }

/* ── Feedback Layer ── */

/* L1: Gesture Status Card (top-right of video-container) */
.fb-status {
  position: absolute; top: 12px; right: 12px; z-index: 50;
  display: flex; align-items: center; gap: 8px;
  padding: 8px 14px; border-radius: 10px;
  background: rgba(10,10,30,0.9); border: 1px solid rgba(0,255,136,0.2);
  pointer-events: none; transition: opacity 0.3s, transform 0.2s;
  backdrop-filter: blur(8px); -webkit-backdrop-filter: blur(8px);
}
.fb-status-icon { font-size: 20px; line-height: 1; }
.fb-status-text { display: flex; flex-direction: column; gap: 1px; }
.fb-status-name { font-size: 12px; font-weight: 600; }
.fb-status-detail { font-size: 10px; color: #555; }

/* L2: Hold Progress Ring (center of video-container) */
.fb-progress {
  position: absolute; top: 50%; left: 50%; z-index: 55;
  transform: translate(-50%, -50%); width: 100px; height: 100px;
  pointer-events: none;
}
.fb-progress-svg { width: 100%; height: 100%; }
.fb-progress-track { fill: none; stroke: rgba(255,255,255,0.1); stroke-width: 4; }
.fb-progress-fill { fill: none; stroke-width: 4; stroke-linecap: round; transition: stroke-dasharray 0.1s linear; }
.fb-progress-icon {
  position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%);
  font-size: 28px;
}

/* L3: Action Toast (top-center, above video-container) */
.fb-toast {
  position: absolute; top: 16px; left: 50%; z-index: 60;
  transform: translateX(-50%) translateY(-10px);
  padding: 8px 20px; border-radius: 20px;
  background: rgba(10,10,30,0.88); border: 1px solid rgba(255,255,255,0.1);
  font-size: 13px; font-weight: 500;
  pointer-events: none;
  transition: opacity 0.3s, transform 0.3s cubic-bezier(0.16, 1, 0.3, 1);
  backdrop-filter: blur(12px); -webkit-backdrop-filter: blur(12px);
}

/* ── Custom Gesture Panel (unchanged from original, keep all .cg-* styles) ── */
#cg-panel {
  position: fixed; top: 0; right: 0; width: 400px; height: 100vh;
  z-index: 1000; background: #14142b; border-left: 1px solid #1f1f4a;
  display: flex; flex-direction: column;
  transform: translateX(100%); transition: transform 0.3s ease;
  font-family: 'Segoe UI', system-ui, sans-serif; overflow-y: auto;
}
#cg-panel.open { transform: translateX(0); }
.cg-header {
  display: flex; align-items: center; justify-content: space-between;
  padding: 20px 24px; border-bottom: 1px solid #1f1f4a;
}
.cg-header h2 { font-size: 18px; color: #eee; margin: 0; }
.cg-close-btn {
  background: none; border: 1px solid #444; color: #aaa;
  width: 32px; height: 32px; border-radius: 8px; cursor: pointer;
  font-size: 16px; display: flex; align-items: center; justify-content: center;
}
.cg-close-btn:hover { color: #fff; border-color: #888; }
.cg-list { flex: 1; padding: 16px 24px; }
.cg-empty { text-align: center; color: #555; font-size: 14px; margin-top: 40px; }
.cg-item {
  display: flex; align-items: center; gap: 12px;
  padding: 14px; border-radius: 10px; background: #1a1a36;
  margin-bottom: 10px; border: 1px solid #25254a;
}
.cg-item-icon { font-size: 24px; }
.cg-item-info { flex: 1; min-width: 0; }
.cg-item-name { font-size: 15px; font-weight: 600; color: #eee; }
.cg-item-action { font-size: 12px; color: #888; margin-top: 2px; }
.cg-item-del {
  background: none; border: 1px solid #442; color: #a44; cursor: pointer;
  width: 28px; height: 28px; border-radius: 6px; font-size: 14px;
  display: flex; align-items: center; justify-content: center;
}
.cg-item-del:hover { background: #442; }
.cg-overwrite-btn {
  background: none; border: 1px solid #555; color: #aaa;
  padding: 6px 12px; border-radius: 6px; cursor: pointer;
  font-size: 12px; white-space: nowrap; transition: all 0.15s;
}
.cg-overwrite-btn:hover { color: #00ff88; border-color: #00ff88; }
.cg-threshold-row {
  display: flex; align-items: center; gap: 10px;
  padding: 10px 0; border-bottom: 1px solid rgba(255,255,255,0.04);
}
.cg-threshold-slider { flex: 1; height: 4px; accent-color: #00ff88; min-width: 0; }
.cg-threshold-val {
  font-size: 14px; font-weight: 700; color: #00ff88;
  min-width: 28px; text-align: right; font-variant-numeric: tabular-nums;
}
.cg-add-btn {
  display: block; width: 100%; margin: 0 0 16px;
  padding: 12px; border: 2px dashed #333; border-radius: 10px;
  background: none; color: #888; font-size: 15px; cursor: pointer;
  transition: all 0.15s;
}
.cg-add-btn:hover { border-color: #00ff88; color: #00ff88; }
.cg-record-section { padding: 16px 24px; }
.cg-record-name-input {
  width: 100%; padding: 10px 14px; border: 1px solid #333;
  border-radius: 8px; background: #1a1a2e; color: #eee; font-size: 15px;
  margin-bottom: 16px; outline: none;
}
.cg-record-name-input:focus { border-color: #00ff88; }
.cg-record-preview {
  width: 100%; aspect-ratio: 4/3; background: #000; border-radius: 10px;
  position: relative; overflow: hidden; margin-bottom: 12px;
}
#cg-preview-canvas { width: 100%; height: 100%; transform: scaleX(-1); }
.cg-record-status {
  text-align: center; font-size: 13px; color: #666; margin-bottom: 12px;
  transition: color 0.3s;
}
.cg-record-status.detected { color: #00ff88; }
.cg-sample-dots { display: flex; gap: 6px; justify-content: center; margin-bottom: 16px; }
.cg-sample-dot {
  width: 12px; height: 12px; border-radius: 50%; background: #333;
  transition: background 0.2s;
}
.cg-sample-dot.filled { background: #00ff88; }
.cg-record-btn {
  display: block; width: 100%; padding: 12px; border: none;
  border-radius: 10px; background: #00ff88; color: #111;
  font-size: 15px; font-weight: 700; cursor: pointer;
  margin-bottom: 8px; transition: background 0.15s;
}
.cg-record-btn:hover { background: #00cc66; }
.cg-record-actions { display: flex; gap: 8px; margin-top: 20px; }
.cg-action-picker { margin-top: 20px; }
.cg-action-picker h3 { font-size: 14px; color: #aaa; margin-bottom: 12px; }
.cg-action-option {
  display: block; width: 100%; padding: 10px 14px; border: 1px solid #333;
  border-radius: 8px; background: #1a1a2e; color: #ccc; font-size: 14px;
  cursor: pointer; text-align: left; margin-bottom: 6px; transition: all 0.15s;
}
.cg-action-option:hover { border-color: #00ff88; color: #fff; }
.cg-action-color-row { display: flex; gap: 6px; margin-top: 8px; margin-bottom: 6px; }
.cg-action-color-swatch {
  width: 28px; height: 28px; border-radius: 50%; cursor: pointer;
  border: 2px solid transparent; transition: border-color 0.15s;
}
.cg-action-color-swatch:hover { border-color: #fff; }
.cg-save-btn {
  display: block; width: 100%; padding: 12px; border: none;
  border-radius: 10px; background: #4488ff; color: #fff;
  font-size: 15px; font-weight: 700; cursor: pointer; margin-top: 8px;
}
.cg-save-btn:disabled { background: #333; color: #666; cursor: not-allowed; }
.cg-back-btn {
  background: none; border: 1px solid #444; color: #aaa;
  padding: 8px 16px; border-radius: 8px; cursor: pointer; font-size: 13px;
}
.cg-back-btn:hover { color: #fff; }
.cg-cancel-btn {
  background: none; border: 1px solid #442; color: #a44;
  padding: 8px 16px; border-radius: 8px; cursor: pointer; font-size: 13px;
}
.cg-cancel-btn:hover { background: #442; }

@media (max-width: 500px) {
  #cg-panel { width: 100vw; }
  #toolbar { width: 120px; }
  #status-bar { left: 120px; }
}
```

- [ ] **Step 2: Commit**

```bash
git add frontend/css/style.css
git commit -m "refactor: rewrite CSS for sidebar toolbar and three-layer feedback"
```

---

### Task 10: HTML — 结构微调

**Files:**
- Modify: `frontend/index.html`

**Background:** 移除旧的 `.gf-toast` 引用（由 FeedbackLayer L3 替代）、调整视频容器的 flex 布局配合侧边栏。

- [ ] **Step 1: 更新 `index.html`**

当前 `index.html` 结构基本可用。`#video-container` 已是 flex 容器内第一个元素，`#toolbar` 从底部改为侧边栏只需要 CSS 配合。无需修改 HTML 结构（`#app` 的 flex 方向依赖 CSS，HTML 本身不变）。只需要确认无 `.gf-toast` 的 HTML 元素（当前由 JS 动态创建）。

**无需修改 `index.html`。** 但验证：
- `#app` 是 `display: flex`（CSS 控制方向）
- `#video-container` 是第一个子元素 → flex: 1 占满剩余空间
- `#toolbar` 是侧边栏 → 固定宽度 160px
- `#status-bar` → 固定底部

- [ ] **Step 2: 删除 `gesture-feedback.js`**

```bash
git rm frontend/js/gesture-feedback.js
```

- [ ] **Step 3: Commit**

```bash
git rm frontend/js/gesture-feedback.js
git commit -m "chore: remove old gesture-feedback.js (replaced by feedback-layer.js)"
```

---

### Task 11: 端到端集成测试

**Files:**
- (无文件改动，验证步骤)

- [ ] **Step 1: 启动应用**

```bash
# 终端 1
cd backend && python server.py
# 终端 2
cd frontend && python -m http.server 8080
```

浏览器打开 `http://localhost:8080`

- [ ] **Step 2: 验证手势操作**

| 测试项 | 预期行为 |
|---|---|
| 拇指食指捏合 | 右侧出现 L1 状态卡 "🤏 书写"，可以画线 |
| 五指张开 | L1 切换为 "🖐️ 擦除"，擦除只删除圆内片段 |
| 擦除时保持不动 1.5s | L2 进度环出现并填充 → 清空画布 + L3 toast |
| 快速捏合一下（不落笔） | 撤销最近一笔 + L3 toast |
| 正常捏合书写 | 不应触发撤销 |

- [ ] **Step 3: 验证侧边栏交互**

| 测试项 | 预期行为 |
|---|---|
| 点击颜色色块 | 选中高亮，画笔颜色切换 |
| 点击取色器 | 自选颜色生效 |
| 点击笔刷 S/M/L | 预设切换，滑块同步 |
| 拖动笔刷滑块 | 线宽数值变化 |
| 点击橡皮预设 | 橡皮大小切换 |
| 点击 ↩ 撤销 | 撤销最近一笔 |
| 点击 ↪ 重做 | 恢复刚撤销的笔画 |
| 点击 ✕ 清空 | 画布清空 + L3 toast |
| 点击 💾 截图 | 下载 PNG 文件 |
| 点击 ⚙ 校准 | 进入手势校准流程（仅 WRITE/ERASE 两步） |
| 点击 ⚡ 自定义 | 滑出自定义手势面板 |

- [ ] **Step 4: 验证自定义手势新动作**

打开 ⚡ 面板 → 添加新手势 → 录制 3 次 → 选择动作：

| 动作类型 | 验证 |
|---|---|
| 🎨 切换颜色 → 选择颜色 | 手势触发后画笔颜色切换 |
| 🖌️ 笔刷大小 → 选 S/M/L | 手势触发后笔刷大小改变 |
| 🧹 橡皮大小 → 选 S/M/L | 手势触发后橡皮大小改变 |
| ↩ 撤销 | 手势触发后撤销 |
| ↪ 重做 | 手势触发后重做 |
| ✕ 清空画布 | 手势触发后清空 |
| 💾 保存截图 | 手势触发后下载 |
| 🖼️ 切换背景色 → 选黑/白/透明 | 手势触发后背景色改变 |

- [ ] **Step 5: 验证三层反馈**

| 场景 | L1 状态卡 | L2 进度环 | L3 Toast |
|---|---|---|---|
| 书写时 | 🤏 书写 显示 | 隐藏 | 隐藏 |
| 擦除时 | 🖐️ 擦除 显示 | 隐藏 | 隐藏 |
| 擦除稳定 1.5s | 持续显示 | 进度环填充 | "✕ 清空画布" |
| 自定义手势触发 | 不改变 | 隐藏 | "⚡ 动作名" |
| 手势离开 (IDLE) | 0.3s 淡出 | 隐藏 | 不变 |

- [ ] **Step 6: 验证区域擦除**

书写一根长线 → 五指张开擦除 → 只擦圆覆盖部分 → 圆外段保留为独立笔画 → 撤销/重做对这些片段也生效。

- [ ] **Step 7: Commit（如有微调）**

```bash
git add -A && git commit -m "test: end-to-end integration verification passed"
```

---

## 实现顺序

```
Task 1: DrawLayer — 区域擦除    (无依赖)
Task 2: DrawLayer — Redo 栈     (依赖 Task 1)
Task 3: GestureStateMachine     (无依赖)
Task 4: FeedbackLayer           (无依赖)
Task 5: Toolbar                 (无依赖)
Task 6: CustomGestureManager    (依赖 Task 2 redo)
Task 7: Calibration             (依赖 Task 3)
Task 8: Main.js                 (依赖所有以上)
Task 9: CSS                     (依赖 Task 4,5,8)
Task 10: HTML / 清理            (依赖所有以上)
Task 11: 集成测试               (依赖全部)
```

建议按顺序执行 Task 1-10，Task 11 每次改完一个模块都可以部分验证。
