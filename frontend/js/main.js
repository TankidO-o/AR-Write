import { VideoLayer } from './video-layer.js';
import { WSClient } from './ws-client.js';
import { GestureStateMachine, Gesture } from './gesture-state-machine.js';
import { DrawLayer } from './draw-layer.js';
import { Toolbar } from './toolbar.js';
import { PerfMonitor } from './perf-monitor.js';

class App {
  constructor() {
    this.video = new VideoLayer('webcam');
    this.ws = new WSClient();
    this.gesture = new GestureStateMachine();
    this.draw = new DrawLayer('layer-history', 'layer-active', 'layer-cursor');
    this.toolbar = new Toolbar();
    this.perf = new PerfMonitor();
    this.renderPending = false;
  }

  async start() {
    try {
      await this.video.start();
    } catch (e) {
      console.warn('Camera not available, continuing without video preview:', e.message);
      const vc = document.getElementById('video-container');
      vc.style.background = '#111';
      const msg = document.createElement('div');
      msg.id = 'camera-msg';
      msg.style.cssText = 'position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);color:#666;font-size:18px;z-index:10;text-align:center;';
      msg.innerHTML = '摄像头未检测到<br><small style="color:#444">手势数据由后端摄像头处理，请确认后端已启动</small>';
      vc.appendChild(msg);
    }

    this.toolbar.render('toolbar');
    this.toolbar.onColorChange = (c) => this.draw.setColor(c);
    this.toolbar.onLineWidthChange = (w) => this.draw.setLineWidth(w);
    this.toolbar.onUndo = () => this.draw.undo();
    this.toolbar.onClear = () => this.draw.clearAll();
    this.toolbar.onSave = () => this.draw.saveScreenshot();

    this.gesture.onGestureChange = (g, prev) => {
      document.getElementById('gesture-display').textContent = g;
      if (prev === Gesture.WRITE && g !== Gesture.WRITE) {
        this.draw.endStroke();
      }
    };

    this.gesture.onWritePoint = (pt) => {
      const c = this.draw.normToCanvas(pt.x, pt.y);
      if (!this.draw.currentStroke) {
        this.draw.beginStroke(c);
      }
      this.draw.addPoint(c);
      this.draw.drawWriteCursor(c);
    };

    this.gesture.onEraseAt = (pt) => {
      const c = this.draw.normToCanvas(pt.x, pt.y);
      this.draw.eraseAt(c);
      this.draw.drawEraseCursor(c);
    };

    this.gesture.onSwitchColor = () => {
      const colors = this.draw.colors;
      const idx = colors.indexOf(this.draw.color);
      const next = colors[(idx + 1) % colors.length];
      this.draw.setColor(next);
    };

    this.gesture.onClear = () => this.draw.clearAll();
    this.gesture.onUndo = () => this.draw.undo();
    this.gesture.onClearProgress = (p) => {
      this._drawClearProgress(p);
      if (p >= 1) this.draw.clearCursor();
    };

    this.perf.onLevelChange = (level) => {
      if (level === 1) {
        this.video.video.style.opacity = '0.3';
      } else if (level === 2) {
        document.getElementById('video-container').style.background = '#111';
        this.video.video.style.display = 'none';
      } else {
        this.video.video.style.opacity = '1';
        this.video.video.style.display = 'block';
        document.getElementById('video-container').style.background = '#000';
      }
    };

    this.ws.onMessage = (data) => this._onFrame(data);
    this.ws.connect();
    requestAnimationFrame(() => this._renderLoop());
  }

  _onFrame(data) {
    if (data.fps) {
      this.perf.update(data.fps);
      document.getElementById('fps-display').textContent = `${data.fps} FPS`;
    }
    this.gesture.update(data.hand, data.timestamp * 1000);

    if (!this.gesture.isActive() && !this.draw.currentStroke) {
      this.draw.clearCursor();
    }
  }

  _renderLoop() {
    this.renderPending = false;
    requestAnimationFrame(() => this._renderLoop());
  }

  _drawClearProgress(p) {
    const c = this.draw.cursorCanvas;
    const ctx = this.draw.cursorCtx;
    const cx = c.width / 2, cy = c.height / 2, r = 40;
    ctx.clearRect(0, 0, c.width, c.height);
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(255,255,255,0.3)';
    ctx.lineWidth = 4;
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(cx, cy, r, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * p);
    ctx.strokeStyle = '#ff4444';
    ctx.lineWidth = 4;
    ctx.stroke();
  }
}

const app = new App();
app.start().catch(err => {
  console.error('App failed to start:', err);
  document.getElementById('fps-display').textContent = 'Error';
});
