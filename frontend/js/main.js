import { VideoLayer, CameraPermissionError } from './video-layer.js';
import { WSClient } from './ws-client.js';
import { GestureStateMachine, Gesture } from './gesture-state-machine.js';
import { DrawLayer } from './draw-layer.js';
import { Toolbar } from './toolbar.js';
import { PerfMonitor } from './perf-monitor.js';
import { Calibration } from './calibration.js';
import { FeedbackLayer } from './feedback-layer.js';
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
    this.feedback = new FeedbackLayer('video-container');
    this.customGestures = new CustomGestureManager(() => this._latestHand);
    this._mode = 'camera';  // 'camera' | 'blackboard' | 'whiteboard'
  }

  _cycleMode() {
    const modes = ['camera', 'blackboard', 'whiteboard'];
    const idx = modes.indexOf(this._mode);
    const next = modes[(idx + 1) % 3];
    this._setMode(next);
  }

  _setMode(mode) {
    this._mode = mode;
    const vc = document.getElementById('video-container');
    const video = document.getElementById('webcam');
    console.log('[App] _setMode:', mode, 'video:', !!video, 'vc:', !!vc);

    if (!vc || !video) return;

    const labels = { camera: '摄像头', blackboard: '黑板', whiteboard: '白板' };

    if (mode === 'camera') {
      vc.style.background = '#000';
      video.style.display = '';
      video.style.removeProperty('visibility');
      video.style.opacity = '1';
    } else {
      vc.style.background = mode === 'blackboard' ? '#111' : '#fff';
      video.style.display = 'none';
      video.style.visibility = 'hidden';
    }

    this.toolbar.updateModeButton(mode);
    this.feedback.showActionToast('🖼️', `切换为${labels[mode]}`, '#ffaa00', 800);

    // Verify it took effect
    console.log('[App] _setMode done — video.display:', video.style.display, 'video.visibility:', video.style.visibility);
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
    this.toolbar.onEraserRadiusChange = (r) => this.draw.setEraserRadius(r);
    this.toolbar.onUndo = () => this.draw.undo();
    this.toolbar.onClear = () => this.draw.clearAll();
    this.toolbar.onSave = () => this.draw.saveScreenshot();
    this.toolbar.onRedo = () => this.draw.redo();
    this.toolbar.onCalibrate = () => this._runCalibration();
    this.toolbar.onCustomGestures = () => this.customGestures.showPanel();
    this.toolbar.onModeCycle = () => this._cycleMode();
    this.toolbar.onShowHints = () => this._showGestureHints();

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
        this.feedback.hideHoldProgress();
      } else if (g === Gesture.CLEAR) {
        this.feedback.showGestureStatus('✊', '清空',
          '#ff4444', '· 握拳保持1秒');
      } else {
        this.feedback.hideGestureStatus();
        this.feedback.hideHoldProgress();
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

    this.gesture.onClear = () => {
      if (this._calibrating) return;
      this.draw.clearAll();
      this.feedback.showActionToast('✕', '清空画布', '#ff4444', 800);
    };
    this.gesture.onUndo = () => {
      if (this._calibrating) return;
      this.draw.undo();
      this.feedback.showActionToast('↩', '撤销', '#cc66ff', 800);
    };
    this.gesture.onClearProgress = (p) => {
      if (p > 0) {
        this.feedback.showHoldProgress(p, '✊', '#ff4444');
      } else {
        this.feedback.hideHoldProgress();
      }
    };
    // onUndoProgress removed — undo is now a pulse, not a hold gesture

    this.perf.onLevelChange = (level) => {
      const video = document.getElementById('webcam');
      if (!video) return;
      if (level === 1) {
        if (this._mode === 'camera') video.style.opacity = '0.3';
      } else if (level === 2) {
        video.style.display = 'none';
      } else if (this._mode === 'camera') {
        video.style.opacity = '1';
        video.style.display = '';
        video.style.removeProperty('visibility');
      } else {
        video.style.display = 'none';
        video.style.visibility = 'hidden';
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
        case 'setBackground': {
          const mode = action.value === '#000000' ? 'blackboard' : action.value === '#ffffff' ? 'whiteboard' : 'camera';
          this._setMode(mode);
          break;
        }
      }
    };

    // ── Gesture hint overlay (dismissable) ──
    this._showGestureHints();

    requestAnimationFrame(() => this._renderLoop());
  }

  _showGestureHints() {
    // Remove existing overlay if any
    const existing = document.querySelector('.gh-overlay');
    if (existing) existing.remove();

    const vc = document.getElementById('video-container');
    const hint = document.createElement('div');
    hint.className = 'gh-overlay';
    hint.innerHTML = `
      <div class="gh-card">
        <div class="gh-title">🖐️ 手势指南</div>
        <div class="gh-row"><span class="gh-icon">🤏</span> 拇指食指捏合 — <b style="color:#00ff88">书写</b></div>
        <div class="gh-row"><span class="gh-icon">🖐️</span> 五指张开 — <b style="color:#4488ff">擦除</b></div>
        <div class="gh-row"><span class="gh-icon">✊</span> 握拳保持 — <b style="color:#ff4444">清空</b></div>
        <div class="gh-row"><span class="gh-icon">🤏👆</span> 快速捏合后松开 — <b style="color:#cc66ff">撤销</b></div>
        <button class="gh-dismiss">知道了</button>
      </div>`;
    vc.appendChild(hint);
    hint.querySelector('.gh-dismiss').addEventListener('click', () => {
      hint.style.opacity = '0';
      setTimeout(() => { if (hint.parentNode) hint.remove(); }, 300);
    });
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

    if (!this.gesture.isActive() && !this.draw.currentStroke) {
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

    // Crosshair at index fingertip (landmark 8)
    const idx = pt(8);
    const cr = 8; // crosshair radius
    ctx.strokeStyle = 'rgba(0,255,136,0.5)';
    ctx.lineWidth = 1;
    // vertical line
    ctx.beginPath();
    ctx.moveTo(idx.x, idx.y - cr);
    ctx.lineTo(idx.x, idx.y + cr);
    ctx.stroke();
    // horizontal line
    ctx.beginPath();
    ctx.moveTo(idx.x - cr, idx.y);
    ctx.lineTo(idx.x + cr, idx.y);
    ctx.stroke();
  }

}

const app = new App();
app.start().catch(err => {
  console.error('App failed to start:', err);
  document.getElementById('fps-display').textContent = 'Error';
});
