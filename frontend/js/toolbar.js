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
    this.onBackgroundToggle = null;
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
        <div class="tb-actions" style="margin-top:4px;">
          <button class="tb-btn tb-bg-btn" title="切换黑板/白板" id="tb-bg-toggle">🖼️ 黑板</button>
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

    // Background toggle
    el.querySelector('#tb-bg-toggle').addEventListener('click', () => {
      if (this.onBackgroundToggle) this.onBackgroundToggle();
    });
  }

  updateBgButton(isDark) {
    const btn = document.getElementById('tb-bg-toggle');
    if (btn) btn.textContent = isDark ? '🖼️ 黑板' : '🖼️ 白板';
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
