import { VideoLayer, CameraPermissionError } from './video-layer.js';
import { WSClient } from './ws-client.js';
import { GestureStateMachine, Gesture } from './gesture-state-machine.js';
import { DrawLayer } from './draw-layer.js';
import { Toolbar } from './toolbar.js';
import { PerfMonitor } from './perf-monitor.js';
import { Calibration } from './calibration.js';
import { GestureFeedback } from './gesture-feedback.js';
import { CustomGestureManager } from './custom-gestures.js';

class App {
  constructor() {
    this.video = new VideoLayer('webcam');
    this.ws = new WSClient();
    this.gesture = new GestureStateMachine();
    this.draw = new DrawLayer('layer-history', 'layer-active', 'layer-cursor');
    this.toolbar = new Toolbar();
    this.perf = new PerfMonitor();
    this._calibrating = false;
    this._latestHand = null;
    this._lastWriteTs = 0;
    this._skelCanvas = document.getElementById('layer-skeleton');
    this._skelCtx = this._skelCanvas.getContext('2d');
    this.feedback = new GestureFeedback();
    this.customGestures = new CustomGestureManager(() => this._latestHand);
  }

  async start() {
    try {
      await this.video.start();
    } catch (e) {
      if (e instanceof CameraPermissionError && e.fromBackend) {
        // Backend stream is providing video via canvas — no placeholder needed
        console.log('[App] Using backend camera stream for preview');
      } else {
        console.warn('Camera not available, continuing without video preview:', e.message);
        const vc = document.getElementById('video-container');
        vc.style.background = '#111';
        const msg = document.createElement('div');
        msg.id = 'camera-msg';

        let title, hint;
        if (e instanceof CameraPermissionError) {
          switch (e.code) {
            case 'PERMISSION_DENIED':
              title = '摄像头权限被拒绝';
              hint = e.message;
              break;
            case 'NOT_ALLOWED':
              title = '摄像头被阻止';
              hint = e.message;
              break;
            case 'NOT_FOUND':
              title = '未检测到摄像头';
              hint = '请连接摄像头后刷新页面，手势数据由后端摄像头独立处理';
              break;
            case 'IN_USE':
              title = '摄像头被占用';
              hint = '请关闭其他使用摄像头的应用后刷新页面';
              break;
            case 'NOT_SUPPORTED':
              title = '浏览器不支持摄像头';
              hint = '请使用 HTTPS 或 localhost 访问，手势数据由后端摄像头独立处理';
              break;
            default:
              title = '摄像头不可用';
              hint = '手势数据由后端摄像头处理，请确认后端已启动';
          }
        } else {
          title = '摄像头未检测到';
          hint = '手势数据由后端摄像头处理，请确认后端已启动';
        }

        msg.style.cssText = 'position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);color:#666;font-size:18px;z-index:10;text-align:center;max-width:80%;white-space:pre-line;';
        msg.innerHTML = `${title}<br><small style="color:#444;font-size:13px;line-height:1.6">${hint}</small>`;
        vc.appendChild(msg);
      }
    }

    this.toolbar.render('toolbar');
    this.toolbar.onColorChange = (c) => this.draw.setColor(c);
    this.toolbar.onLineWidthChange = (w) => this.draw.setLineWidth(w);
    this.toolbar.onUndo = () => this.draw.undo();
    this.toolbar.onClear = () => this.draw.clearAll();
    this.toolbar.onSave = () => this.draw.saveScreenshot();

    this.gesture.onGestureChange = (g, prev) => {
      document.getElementById('gesture-display').textContent = g;
      if (this._calibrating) return;
      if (prev === Gesture.WRITE && g !== Gesture.WRITE) {
        this.draw.endStroke();
      }
      // Visual feedback for gesture activation
      if (g !== Gesture.IDLE) {
        const fb = { write: ['✍️', '书写', '#00ff88'], clear: ['✊', '清空', '#ff4444'],
                     erase: ['🖐️', '擦除', '#4488ff'], switch: ['🔄', '切换', '#ffaa00'],
                     undo: ['✌️', '撤销', '#cc66ff'] }[g];
        if (fb) this.feedback.show(fb[0], fb[1], fb[2]);
      }
    };

    this.gesture.onWritePoint = (pt) => {
      if (this._calibrating) return;
      const c = this.draw.normToCanvas(pt.x, pt.y);
      if (!this.draw.currentStroke) {
        this.draw.beginStroke(c);
      }
      this.draw.addPoint(c);
      this.draw.drawWriteCursor(c);
    };

    this.gesture.onEraseAt = (pt) => {
      if (this._calibrating) return;
      const c = this.draw.normToCanvas(pt.x, pt.y);
      this.draw.eraseAt(c);
      this.draw.drawEraseCursor(c);
    };

    this.gesture.onSwitchColor = () => {
      if (this._calibrating) return;
      const colors = this.draw.colors;
      const idx = colors.indexOf(this.draw.color);
      const next = colors[(idx + 1) % colors.length];
      this.draw.setColor(next);
      this.toolbar.syncActiveColor(next);
    };

    this.gesture.onClear = () => { if (!this._calibrating) this.draw.clearAll(); };
    this.gesture.onUndo = () => { if (!this._calibrating) this.draw.undo(); };
    this.gesture.onClearProgress = (p) => {
      this._drawHoldProgress(p, '#ff4444');
      if (p >= 1) this.draw.clearCursor();
    };
    this.gesture.onUndoProgress = (p) => {
      this._drawHoldProgress(p, '#cc66ff');
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

    // ── Calibration ──
    this._runCalibration = async () => {
      this._calibrating = true;
      await new Promise(r => setTimeout(r, 500));
      const cal = new Calibration(() => this._latestHand);
      return new Promise((resolve) => {
        cal.start({
          onComplete: (thresholds) => {
            this.gesture.applyThresholds(thresholds);
            console.log('[App] Calibration complete');
            this._calibrating = false;
            resolve();
          },
          onSkip: () => {
            console.log('[App] Calibration skipped');
            this._calibrating = false;
            resolve();
          },
        });
      });
    };

    const probeCal = new Calibration(() => null);
    if (!probeCal.isDone()) {
      await this._runCalibration();
    } else {
      this.gesture.applyThresholds(probeCal.getThresholds());
      console.log('[App] Loaded existing calibration');
    }

    // Load per-gesture thresholds from custom gesture data
    const cgThresholds = this.customGestures.gestureThresholds;
    if (cgThresholds && Object.keys(cgThresholds).length > 0) {
      this.gesture.applyThresholds({ gestureThresholds: cgThresholds });
      console.log('[App] Loaded per-gesture thresholds:', cgThresholds);
    }

    // Recalibrate button
    const recalBtn = document.createElement('button');
    recalBtn.className = 'tb-btn';
    recalBtn.title = '重新校准手势';
    recalBtn.textContent = '⚙';
    recalBtn.addEventListener('click', () => this._runCalibration());
    document.querySelector('#toolbar .tb-actions').appendChild(recalBtn);

    // Reset calibration button
    const resetBtn = document.createElement('button');
    resetBtn.className = 'tb-btn';
    resetBtn.title = '重置用户校准数据';
    resetBtn.textContent = '↺';
    resetBtn.style.fontSize = '18px';
    resetBtn.addEventListener('click', () => {
      localStorage.removeItem('ar-gesture-calibration');
      localStorage.removeItem('ar-custom-gestures');
      this.gesture.resetDefaults();
      console.log('[App] Reset to defaults, starting recalibration...');
      this._runCalibration();
    });
    document.querySelector('#toolbar .tb-actions').appendChild(resetBtn);

    // Custom gesture button
    const cgBtn = document.createElement('button');
    cgBtn.className = 'tb-btn tb-btn-custom';
    cgBtn.title = '自定义手势';
    cgBtn.textContent = '⚡';
    cgBtn.addEventListener('click', () => this.customGestures.showPanel());
    document.querySelector('#toolbar .tb-actions').appendChild(cgBtn);

    // Wire custom gesture threshold changes
    this.customGestures.onThresholdsChanged = (thresholds) => {
      this.gesture.applyThresholds({ gestureThresholds: thresholds });
    };

    // Wire custom gesture action dispatcher
    this.customGestures.onAction = (action, name) => {
      switch (action.type) {
        case 'setColor':
          this.draw.setColor(action.value);
          this.toolbar.syncActiveColor(action.value);
          this.feedback.show('⚡', name, action.value, 1000);
          break;
        case 'undo':
          this.draw.undo();
          this.feedback.show('⚡', `撤销 (${name})`, '#cc66ff', 800);
          break;
        case 'clear':
          this.draw.clearAll();
          this.feedback.show('⚡', `清空 (${name})`, '#ff4444', 800);
          break;
        case 'save':
          this.draw.saveScreenshot();
          this.feedback.show('⚡', `截图 (${name})`, '#4488ff', 1000);
          break;
      }
    };

    requestAnimationFrame(() => this._renderLoop());
  }

  _onFrame(data) {
    if (data.fps) {
      this.perf.update(data.fps);
      document.getElementById('fps-display').textContent = `${data.fps} FPS`;
    }
    this._latestHand = data.hand;
    this.gesture.update(data.hand, data.timestamp * 1000);

    // Check custom gestures (they override built-in if higher confidence)
    if (!this._calibrating) {
      this.customGestures.checkAndExecute(
        data.hand, this.gesture.state, this.gesture._scores);
    }

    // Auto-end stroke if WRITE not detected for >1000ms
    const now = data.timestamp * 1000;
    if (this.gesture.state === Gesture.WRITE) {
      this._lastWriteTs = now;
    }
    if (this.draw.currentStroke && (now - this._lastWriteTs > 1000)) {
      this.draw.endStroke();
    }

    if (!this.gesture.isActive() && !this.draw.currentStroke
        && this.gesture.state !== Gesture.CLEAR
        && this.gesture.state !== Gesture.UNDO) {
      this.draw.clearCursor();
    }
  }

  _renderLoop() {
    this._drawSkeleton();
    requestAnimationFrame(() => this._renderLoop());
  }

  _drawSkeleton() {
    const hand = this._latestHand;
    const canvas = this._skelCanvas;
    if (!hand || !canvas) return;

    const cw = this.draw.historyCanvas.width;
    const ch = this.draw.historyCanvas.height;
    if (canvas.width !== cw || canvas.height !== ch) {
      canvas.width = cw;
      canvas.height = ch;
    }

    const ctx = this._skelCtx;
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    const kp = hand.keypoints;
    const WRIST = 0;
    const pt = (i) => ({ x: kp[i].x * canvas.width, y: kp[i].y * canvas.height });

    // Ultra-subtle skeleton — barely visible, no text, no colors
    const connections = [
      [0,1],[1,2],[2,3],[3,4],
      [0,5],[5,6],[6,7],[7,8],
      [5,9],[9,10],[10,11],[11,12],
      [9,13],[13,14],[14,15],[15,16],
      [13,17],[17,18],[18,19],[19,20],
    ];
    ctx.lineWidth = 1;
    ctx.strokeStyle = 'rgba(255,255,255,0.06)';
    for (const [a, b] of connections) {
      const pa = pt(a), pb = pt(b);
      ctx.beginPath();
      ctx.moveTo(pa.x, pa.y);
      ctx.lineTo(pb.x, pb.y);
      ctx.stroke();
    }

    // Minimal knuckles
    ctx.fillStyle = 'rgba(255,255,255,0.10)';
    for (let i = 0; i < 21; i++) {
      const p = pt(i);
      ctx.beginPath();
      ctx.arc(p.x, p.y, 1.5, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  _drawHoldProgress(p, color) {
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
    ctx.strokeStyle = color;
    ctx.lineWidth = 4;
    ctx.stroke();
  }
}

const app = new App();
app.start().catch(err => {
  console.error('App failed to start:', err);
  document.getElementById('fps-display').textContent = 'Error';
});
