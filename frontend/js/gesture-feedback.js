// Toast-based visual feedback — rendered to body to avoid parent scaleX(-1) mirroring

export class GestureFeedback {
  constructor() {
    this.timer = null;
  }

  show(icon, text, color, duration = 800) {
    const prev = document.querySelector('.gf-toast');
    if (prev) prev.remove();
    if (this.timer) clearTimeout(this.timer);

    const toast = document.createElement('div');
    toast.className = 'gf-toast';
    toast.innerHTML = `<span class="gf-icon">${icon}</span> <span class="gf-text">${text}</span>`;
    toast.style.borderColor = color;
    toast.style.color = color;
    document.body.appendChild(toast);

    requestAnimationFrame(() => {
      toast.style.opacity = '1';
      toast.style.transform = 'translateX(-50%) translateY(0)';
    });

    this.timer = setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transform = 'translateX(-50%) translateY(-10px)';
      setTimeout(() => toast.remove(), 300);
    }, duration);
  }
}
