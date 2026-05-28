export class PerfMonitor {
  constructor({ lowThreshold = 15, criticalThreshold = 10, sampleWindow = 60 } = {}) {
    this.lowThreshold = lowThreshold;
    this.criticalThreshold = criticalThreshold;
    this.sampleWindow = sampleWindow;
    this.fpsHistory = [];
    this.currentFps = 0;
    this.level = 0; // 0=normal, 1=low, 2=critical
    this.onLevelChange = null; // (level: 0|1|2)
  }

  update(fps) {
    this.currentFps = fps;
    this.fpsHistory.push({ fps, t: Date.now() });

    const cutoff = Date.now() - this.sampleWindow * 1000;
    while (this.fpsHistory.length > 0 && this.fpsHistory[0].t < cutoff) {
      this.fpsHistory.shift();
    }

    const avg = this.fpsHistory.length > 0
      ? this.fpsHistory.reduce((s, e) => s + e.fps, 0) / this.fpsHistory.length
      : fps;

    let newLevel = 0;
    if (fps < this.criticalThreshold) newLevel = 2;
    else if (fps < this.lowThreshold) newLevel = 1;

    if (newLevel !== this.level) {
      this.level = newLevel;
      if (this.onLevelChange) this.onLevelChange(this.level);
    }
  }
}
