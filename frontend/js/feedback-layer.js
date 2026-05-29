// Three-layer visual feedback for gesture interactions
// L1: Persistent gesture status card (top-right of canvas)
// L2: Hold progress ring (center of canvas, for hold-to-activate gestures)
// L3: Action confirmation toast (top-center, transient)

export class FeedbackLayer {
  constructor(containerId) {
    const container = document.getElementById(containerId);
    if (!container) throw new Error(`Container #${containerId} not found`);

    // Wrapper to counter parent scaleX(-1) mirror
    const wrap = document.createElement('div');
    wrap.className = 'fb-wrap';
    container.appendChild(wrap);

    // L1 — Gesture status card
    this._l1 = document.createElement('div');
    this._l1.className = 'fb-status';
    this._l1.style.opacity = '0';
    wrap.appendChild(this._l1);

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
    wrap.appendChild(this._l2);

    // L3 — Toast
    this._l3 = document.createElement('div');
    this._l3.className = 'fb-toast';
    this._l3.style.opacity = '0';
    wrap.appendChild(this._l3);

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
