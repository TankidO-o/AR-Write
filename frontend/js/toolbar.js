export class Toolbar {
  constructor(defaultColors = ['#00ff88', '#ff4444', '#4488ff', '#ffaa00', '#aa44ff', '#ffffff']) {
    this.colors = defaultColors;
    this.selectedColor = defaultColors[0];
    this.lineWidth = 4;

    this.onColorChange = null;
    this.onLineWidthChange = null;
    this.onUndo = null;
    this.onClear = null;
    this.onSave = null;
  }

  render(containerId) {
    const el = document.getElementById(containerId);
    el.innerHTML = `
      <div class="tb-colors">
        ${this.colors.map((c, i) =>
          `<button class="tb-color-btn${c === this.selectedColor ? ' active' : ''}"
                   style="background:${c}" data-color="${c}"></button>`
        ).join('')}
        <input type="color" class="tb-color-picker" value="${this.selectedColor}">
      </div>
      <div class="tb-size">
        <label>笔刷</label>
        <input type="range" min="1" max="20" value="${this.lineWidth}" class="tb-size-slider">
        <span class="tb-size-val">${this.lineWidth}px</span>
      </div>
      <div class="tb-actions">
        <button class="tb-btn tb-undo" title="撤销">↩</button>
        <button class="tb-btn tb-clear" title="清空">✕</button>
        <button class="tb-btn tb-save" title="截图保存">💾</button>
      </div>
    `;

    el.querySelectorAll('.tb-color-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const color = btn.dataset.color;
        this.selectedColor = color;
        el.querySelectorAll('.tb-color-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        el.querySelector('.tb-color-picker').value = color;
        if (this.onColorChange) this.onColorChange(color);
      });
    });

    el.querySelector('.tb-color-picker').addEventListener('input', (e) => {
      this.selectedColor = e.target.value;
      el.querySelectorAll('.tb-color-btn').forEach(b => b.classList.remove('active'));
      if (this.onColorChange) this.onColorChange(this.selectedColor);
    });

    el.querySelector('.tb-size-slider').addEventListener('input', (e) => {
      this.lineWidth = parseInt(e.target.value);
      el.querySelector('.tb-size-val').textContent = `${this.lineWidth}px`;
      if (this.onLineWidthChange) this.onLineWidthChange(this.lineWidth);
    });

    el.querySelector('.tb-undo').addEventListener('click', () => {
      if (this.onUndo) this.onUndo();
    });
    el.querySelector('.tb-clear').addEventListener('click', () => {
      if (this.onClear) this.onClear();
    });
    el.querySelector('.tb-save').addEventListener('click', () => {
      if (this.onSave) this.onSave();
    });
  }

  // Sync toolbar UI when color changes externally (e.g. SWITCH gesture)
  syncActiveColor(color) {
    this.selectedColor = color;
    const el = document.getElementById('toolbar');
    if (!el) return;
    el.querySelectorAll('.tb-color-btn').forEach(b => {
      b.classList.toggle('active', b.dataset.color === color);
    });
    const picker = el.querySelector('.tb-color-picker');
    if (picker) picker.value = color;
  }
}
