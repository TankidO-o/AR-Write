# AR 手势书写交互系统 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 构建基于 MediaPipe + WebSocket + Canvas 的 AR 手势书写交互系统，用户通过摄像头隔空手势在视频画面上书写、擦除、切换颜色。

**Architecture:** Python 后端负责摄像头采集与 MediaPipe 关键点检测，通过 WebSocket 推送原始关键点坐标至浏览器前端。前端集中完成手势规则判定、One-Euro Filter 平滑、分层 Canvas 渲染与 UI 交互。纯本地部署，ws://localhost 通信。

**Tech Stack:** Python 3.10+ / OpenCV / MediaPipe Hands / FastAPI / WebSocket // HTML5 Canvas 2D / Vanilla JS (ES Modules)

---

## 文件结构规划

```
backend/
  camera.py              # OpenCV 摄像头管理，单例
  hand_detector.py       # MediaPipe Hands 封装
  server.py              # FastAPI + WebSocket 端点
  requirements.txt       # Python 依赖
frontend/
  index.html             # 主页面，视频 + 3 层 Canvas + 工具栏
  css/style.css           # 全部样式
  js/
    main.js              # 入口：初始化各模块，启动主循环
    video-layer.js       # getUserMedia 摄像头预览
    ws-client.js         # WebSocket 连接管理 + 重连 + 心跳
    gesture-state-machine.js  # 5 判定函数 + 防抖 + 死区 + 优先级
    draw-layer.js        # 3 层 Canvas 管理 + strokes[] + 绘制/擦除/撤销/清空
    toolbar.js           # UI 控制面板，与 draw-layer 共享状态
    one-euro-filter.js   # One-Euro Filter 平滑滤波器
    perf-monitor.js      # FPS 监控 + 降级触发
  assets/                # 工具栏图标 (SVG)
```

---

### Task 0: 项目脚手架与 Python 依赖

**Files:**
- Create: `backend/requirements.txt`
- Create: `frontend/index.html`
- Create: `frontend/css/style.css`

- [ ] **Step 1: 创建 Python 依赖文件**

`backend/requirements.txt`:
```
opencv-python==4.10.0
mediapipe==0.10.14
fastapi==0.115.0
uvicorn[standard]==0.30.0
```

- [ ] **Step 2: 创建前端主页面骨架**

`frontend/index.html`:
```html
<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>AR 手势书写</title>
<link rel="stylesheet" href="css/style.css">
</head>
<body>
<div id="app">
  <div id="video-container">
    <video id="webcam" autoplay playsinline></video>
    <canvas id="layer-history"></canvas>
    <canvas id="layer-active"></canvas>
    <canvas id="layer-cursor"></canvas>
  </div>
  <div id="toolbar"></div>
  <div id="status-bar">
    <span id="fps-display">-- FPS</span>
    <span id="gesture-display">Idle</span>
    <span id="ws-status">●</span>
  </div>
</div>
<script type="module" src="js/main.js"></script>
</body>
</html>
```

- [ ] **Step 3: 创建基础样式**

`frontend/css/style.css`:
```css
*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
body { background: #1a1a2e; color: #eee; font-family: 'Segoe UI', system-ui, sans-serif; overflow: hidden; }
#app { position: relative; width: 100vw; height: 100vh; display: flex; flex-direction: column; }
#video-container { flex: 1; position: relative; overflow: hidden; background: #000; }
#webcam { display: none; }
#video-container canvas { position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%); object-fit: contain; }
#toolbar { display: flex; align-items: center; gap: 12px; padding: 10px 16px; background: #16213e; border-top: 1px solid #0f3460; }
#status-bar { display: flex; gap: 16px; padding: 4px 16px; font-size: 12px; color: #888; background: #0f0f1a; }
#ws-status { color: #f00; }
#ws-status.connected { color: #0f0; }
```

- [ ] **Step 4: 安装 Python 依赖**

Run: `cd backend && pip install -r requirements.txt`
Expected: 所有包成功安装，无错误。

- [ ] **Step 5: Commit**

```bash
git add backend/requirements.txt frontend/index.html frontend/css/style.css
git commit -m "feat: project scaffolding with dependencies and page skeleton"
```

---

### Task 1: 后端 — 摄像头管理模块

**Files:**
- Create: `backend/camera.py`

- [ ] **Step 1: 编写 camera.py**

`backend/camera.py`:
```python
import cv2
import threading

class Camera:
    _instance = None
    _lock = threading.Lock()

    def __new__(cls):
        if cls._instance is None:
            with cls._lock:
                if cls._instance is None:
                    cls._instance = super().__new__(cls)
        return cls._instance

    def __init__(self):
        if not hasattr(self, '_initialized'):
            self._cap = None
            self._initialized = True

    def start(self, device_id=0, width=640, height=480, fps=30):
        self._cap = cv2.VideoCapture(device_id, cv2.CAP_DSHOW)
        self._cap.set(cv2.CAP_PROP_FRAME_WIDTH, width)
        self._cap.set(cv2.CAP_PROP_FRAME_HEIGHT, height)
        self._cap.set(cv2.CAP_PROP_FPS, fps)
        if not self._cap.isOpened():
            raise RuntimeError(f"Cannot open camera device {device_id}")
        return self

    def read_frame(self):
        if self._cap is None:
            return None
        ret, frame = self._cap.read()
        if not ret:
            return None
        return cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)

    @property
    def is_opened(self):
        return self._cap is not None and self._cap.isOpened()

    def stop(self):
        if self._cap:
            self._cap.release()
            self._cap = None

    def __del__(self):
        self.stop()
```

- [ ] **Step 2: 验证 camera.py 可导入**

Run: `cd backend && python -c "from camera import Camera; c = Camera(); c.start(); print('OK, frame shape:', c.read_frame().shape); c.stop()"`
Expected: 输出 `OK, frame shape: (480, 640, 3)`

- [ ] **Step 3: Commit**

```bash
git add backend/camera.py
git commit -m "feat: add camera module with singleton OpenCV capture"
```

---

### Task 2: 后端 — MediaPipe 手部检测模块

**Files:**
- Create: `backend/hand_detector.py`

- [ ] **Step 1: 编写 hand_detector.py**

`backend/hand_detector.py`:
```python
import mediapipe as mp
from mediapipe.tasks import python
from mediapipe.tasks.python import vision
import numpy as np
import math

class HandDetector:
    def __init__(self, model_path=None, min_detection_confidence=0.5, min_tracking_confidence=0.5):
        if model_path is None:
            base_options = python.BaseOptions(model_asset_path=None)
        else:
            base_options = python.BaseOptions(model_asset_path=model_path)
        options = vision.HandLandmarkerOptions(
            base_options=base_options,
            num_hands=1,
            min_hand_detection_confidence=min_detection_confidence,
            min_tracking_confidence=min_tracking_confidence,
        )
        self._detector = vision.HandLandmarker.create_from_options(options)
        self._locked_handedness = None

    def detect(self, rgb_frame, timestamp_ms=0):
        mp_image = mp.Image(image_format=mp.ImageFormat.SRGB, data=rgb_frame)
        result = self._detector.detect_for_video(mp_image, timestamp_ms)

        if not result.hand_landmarks:
            self._locked_handedness = None
            return None

        hand_index = self._select_hand(result)
        if hand_index is None:
            return None

        landmarks = result.hand_landmarks[hand_index]
        keypoints = []
        for i, lm in enumerate(landmarks):
            keypoints.append({"id": i, "x": round(lm.x, 4), "y": round(lm.y, 4), "z": round(lm.z, 4)})

        wrist = landmarks[0]
        middle_mcp = landmarks[9]
        palm_center = {
            "x": round((wrist.x + middle_mcp.x) / 2, 4),
            "y": round((wrist.y + middle_mcp.y) / 2, 4),
        }

        return {
            "handedness": result.handedness[hand_index][0].category_name,
            "keypoints": keypoints,
            "palm_center": palm_center,
        }

    def _select_hand(self, result):
        if self._locked_handedness is None:
            self._locked_handedness = result.handedness[0][0].category_name
            return 0
        for i, h in enumerate(result.handedness):
            if h[0].category_name == self._locked_handedness:
                return i
        return None

    def close(self):
        self._detector.close()
```

- [ ] **Step 2: 验证 hand_detector.py 可运行**

Run: `cd backend && python -c "from camera import Camera; from hand_detector import HandDetector; c = Camera().start(); d = HandDetector(); frame = c.read_frame(); r = d.detect(frame); print('Detected:', r is not None); c.stop(); d.close()"`
Expected: 输出 `Detected: True`（将手放入摄像头视野中）或 `Detected: False`（无手时）。

- [ ] **Step 3: Commit**

```bash
git add backend/hand_detector.py
git commit -m "feat: add MediaPipe hand landmark detection module"
```

---

### Task 3: 后端 — FastAPI WebSocket 服务

**Files:**
- Create: `backend/server.py`

- [ ] **Step 1: 编写 server.py**

`backend/server.py`:
```python
import asyncio
import json
import time
from fastapi import FastAPI, WebSocket
from fastapi.middleware.cors import CORSMiddleware
from camera import Camera
from hand_detector import HandDetector
import uvicorn

app = FastAPI()
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])

camera = Camera()
detector = HandDetector()
running = False

@app.websocket("/ws")
async def websocket_endpoint(ws: WebSocket):
    global running
    await ws.accept()
    running = True
    last_frame_time = time.time()
    frame_count = 0
    fps = 0.0

    try:
        while running:
            frame_start = time.time()

            frame = camera.read_frame()
            if frame is None:
                await asyncio.sleep(0.001)
                continue

            timestamp_ms = int(time.time() * 1000)
            hand_data = detector.detect(frame, timestamp_ms)

            frame_count += 1
            now = time.time()
            elapsed = now - last_frame_time
            if elapsed >= 1.0:
                fps = round(frame_count / elapsed, 1)
                frame_count = 0
                last_frame_time = now

            payload = {
                "timestamp": round(time.time(), 3),
                "fps": fps,
                "hand": hand_data,
            }

            try:
                await ws.send_json(payload)
            except Exception:
                break

            frame_time = time.time() - frame_start
            target_frame_time = 1.0 / 30
            if frame_time < target_frame_time:
                await asyncio.sleep(target_frame_time - frame_time)

    except Exception as e:
        print(f"WebSocket error: {e}")
    finally:
        running = False
        try:
            await ws.close()
        except Exception:
            pass

@app.get("/health")
async def health():
    return {"status": "ok", "camera": camera.is_opened}

def main():
    try:
        camera.start()
        print("Camera started")
        uvicorn.run(app, host="127.0.0.1", port=8765, log_level="info")
    finally:
        camera.stop()
        detector.close()
        print("Shutdown complete")

if __name__ == "__main__":
    main()
```

- [ ] **Step 2: 启动服务验证**

Run: `cd backend && python server.py`
Expected: 输出 `Camera started` 和 Uvicorn 启动日志。打开浏览器 `http://127.0.0.1:8765/health` 应返回 `{"status":"ok","camera":true}`。

- [ ] **Step 3: Commit**

```bash
git add backend/server.py
git commit -m "feat: add FastAPI WebSocket server with real-time hand data streaming"
```

---

### Task 4: 前端 — One-Euro Filter

**Files:**
- Create: `frontend/js/one-euro-filter.js`

- [ ] **Step 1: 编写 One-Euro Filter**

`frontend/js/one-euro-filter.js`:
```javascript
class LowPassFilter {
  constructor(alpha) {
    this.alpha = alpha;
    this.initialized = false;
    this.y = 0;
  }
  filter(value, alpha) {
    if (alpha !== undefined) this.alpha = alpha;
    if (this.initialized) {
      this.y = this.alpha * value + (1 - this.alpha) * this.y;
    } else {
      this.y = value;
      this.initialized = true;
    }
    return this.y;
  }
}

export class OneEuroFilter {
  constructor(beta = 0.007, f_c_min = 1.0, freq = 30) {
    this.beta = beta;
    this.f_c_min = f_c_min;
    this.freq = freq;
    this.x_filter = new LowPassFilter(1);
    this.dx_filter = new LowPassFilter(1);
    this.last_x = null;
    this.last_t = null;
  }

  _alpha(cutoff) {
    const tau = 1 / (2 * Math.PI * cutoff);
    const te = 1 / this.freq;
    return 1 / (1 + tau / te);
  }

  filter(x, t) {
    if (this.last_x === null || this.last_t === null || this.last_t === t) {
      this.last_x = x;
      this.last_t = t;
      return x;
    }

    const dx = (x - this.last_x) / (t - this.last_t);
    const dx_hat = this.dx_filter.filter(dx);

    const cutoff = this.f_c_min + this.beta * Math.abs(dx_hat);
    const alpha = this._alpha(cutoff);
    const result = this.x_filter.filter(x, alpha);

    this.last_x = result;
    this.last_t = t;
    return result;
  }

  reset() {
    this.x_filter = new LowPassFilter(1);
    this.dx_filter = new LowPassFilter(1);
    this.last_x = null;
    this.last_t = null;
  }
}
```

- [ ] **Step 2: 验证导入**

Run: `cd frontend && node -e "import('./js/one-euro-filter.js').then(m => { const f = new m.OneEuroFilter(); console.log(f.filter(0.5, 1)); console.log(f.filter(0.6, 2)); console.log('OK'); })"`
Expected: 输出 `0.5`, `0.6`（或接近值）, `OK`。

注意：Node.js 需要支持 ES Modules，如果失败可用简单脚本测试。

- [ ] **Step 3: Commit**

```bash
git add frontend/js/one-euro-filter.js
git commit -m "feat: add One-Euro Filter for trajectory smoothing"
```

---

### Task 5: 前端 — 视频层与 WebSocket 客户端

**Files:**
- Create: `frontend/js/video-layer.js`
- Create: `frontend/js/ws-client.js`

- [ ] **Step 1: 编写 video-layer.js**

`frontend/js/video-layer.js`:
```javascript
export class VideoLayer {
  constructor(videoElementId) {
    this.video = document.getElementById(videoElementId);
  }

  async start() {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { width: 640, height: 480, facingMode: 'user' }
    });
    this.video.srcObject = stream;
    await this.video.play();
    return stream;
  }

  get videoWidth() {
    return this.video.videoWidth;
  }

  get videoHeight() {
    return this.video.videoHeight;
  }
}
```

- [ ] **Step 2: 编写 ws-client.js**

`frontend/js/ws-client.js`:
```javascript
export class WSClient {
  constructor(url = 'ws://127.0.0.1:8765/ws') {
    this.url = url;
    this.ws = null;
    this.onMessage = null;
    this.reconnectDelay = 1000;
    this.maxDelay = 30000;
    this.reconnectAttempts = 0;
    this.heartbeatInterval = null;
    this.lastPong = 0;
  }

  connect() {
    this.ws = new WebSocket(this.url);
    this.ws.onopen = () => {
      this.reconnectAttempts = 0;
      this.reconnectDelay = 1000;
      this.lastPong = Date.now();
      this._startHeartbeat();
      this._updateStatus(true);
    };

    this.ws.onmessage = (event) => {
      const data = JSON.parse(event.data);
      if (data.type === 'pong') {
        this.lastPong = Date.now();
        return;
      }
      if (this.onMessage) this.onMessage(data);
    };

    this.ws.onclose = () => {
      this._updateStatus(false);
      this._stopHeartbeat();
      this._scheduleReconnect();
    };

    this.ws.onerror = () => {
      this.ws.close();
    };
  }

  _startHeartbeat() {
    this.heartbeatInterval = setInterval(() => {
      if (Date.now() - this.lastPong > 10000) {
        this.ws.close();
        return;
      }
      if (this.ws.readyState === WebSocket.OPEN) {
        this.ws.send(JSON.stringify({ type: 'ping' }));
      }
    }, 5000);
  }

  _stopHeartbeat() {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }
  }

  _scheduleReconnect() {
    if (this.reconnectAttempts >= 10) {
      console.warn('Max reconnect attempts reached');
      return;
    }
    setTimeout(() => {
      this.reconnectAttempts++;
      this.reconnectDelay = Math.min(this.reconnectDelay * 2, this.maxDelay);
      this.connect();
    }, this.reconnectDelay);
  }

  _updateStatus(connected) {
    const el = document.getElementById('ws-status');
    if (el) {
      el.className = connected ? 'connected' : '';
    }
  }
}
```

- [ ] **Step 3: State check — 验证 ws-client 连接**

与 Task 3 的 server.py 一起验证：启动 Python 服务后，在浏览器控制台中测试 WebSocket 连接并打印收到的第一帧数据。

- [ ] **Step 4: Commit**

```bash
git add frontend/js/video-layer.js frontend/js/ws-client.js
git commit -m "feat: add video layer and WebSocket client with reconnection"
```

---

### Task 6: 前端 — 主入口，管线集成验证

**Files:**
- Create: `frontend/js/main.js`

- [ ] **Step 1: 编写 main.js（Phase 1 管线验证版本）**

`frontend/js/main.js`:
```javascript
import { VideoLayer } from './video-layer.js';
import { WSClient } from './ws-client.js';

class App {
  constructor() {
    this.video = new VideoLayer('webcam');
    this.ws = new WSClient();
  }

  async start() {
    await this.video.start();
    this.ws.onMessage = (data) => this._onFrame(data);
    this.ws.connect();
  }

  _onFrame(data) {
    if (data.fps) {
      document.getElementById('fps-display').textContent = `${data.fps} FPS`;
    }
    if (data.hand) {
      document.getElementById('gesture-display').textContent =
        data.hand.handedness || 'Hand';
    } else {
      document.getElementById('gesture-display').textContent = 'No hand';
    }
  }
}

const app = new App();
app.start();
```

- [ ] **Step 2: 端到端验证**

1. 启动后端: `cd backend && python server.py`
2. 启动前端: `cd frontend && python -m http.server 8080` 或使用 Live Server
3. 打开浏览器 `http://localhost:8080`
4. 预期：看到摄像头画面（预览需在前端单独添加 video 显示），状态栏显示 FPS 和手势状态。

注意：此阶段 video 元素仅作尺寸基准参考，前端的视觉显示先验证数据链路通了即可。后续任务会添加可见的视频 preview 和 Canvas 绘制。

验证标准：状态栏 FPS 数值更新、gesture-display 在手进入/离开画面时在 "Right/Left" 和 "No hand" 之间切换。

- [ ] **Step 3: Commit**

```bash
git add frontend/js/main.js
git commit -m "feat: add app entry point with pipeline integration"
```

---

### Task 7: 前端 — 手势状态机（判定函数 + 状态机核心）

**Files:**
- Create: `frontend/js/gesture-state-machine.js`

- [ ] **Step 1: 编写 gesture-state-machine.js**

`frontend/js/gesture-state-machine.js`:
```javascript
import { OneEuroFilter } from './one-euro-filter.js';

const Gesture = Object.freeze({
  IDLE:    'idle',
  WRITE:   'write',
  CLEAR:   'clear',
  ERASE:   'erase',
  SWITCH:  'switch',
  UNDO:    'undo',
});

const PRIORITY = [Gesture.WRITE, Gesture.CLEAR, Gesture.ERASE, Gesture.SWITCH, Gesture.UNDO];

// MediaPipe hand landmark indices
const TIP = { THUMB: 4, INDEX: 8, MIDDLE: 12, RING: 16, PINKY: 20 };
const PIP  = { INDEX: 6, MIDDLE: 10, RING: 14, PINKY: 18 };
const MCP  = { INDEX: 5, MIDDLE: 9, RING: 13, PINKY: 17 };
const WRIST = 0;

function dist2d(a, b) {
  return Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2);
}

function isFingerExtended(tip, pip) {
  return tip.y < pip.y;
}

export class GestureStateMachine {
  constructor({ debounceFrames = 5, idleFrames = 3, deadZoneMs = 200, clearHoldMs = 1000, pinchThreshold = 0.06, eraseRadius = 0.15 } = {}) {
    this.debounceFrames = debounceFrames;
    this.idleFrames = idleFrames;
    this.deadZoneMs = deadZoneMs;
    this.clearHoldMs = clearHoldMs;
    this.pinchThreshold = pinchThreshold;
    this.eraseRadius = eraseRadius;

    this.state = Gesture.IDLE;
    this.prevState = Gesture.IDLE;
    this.debounceCounter = 0;
    this.idleCounter = 0;
    this.lastSwitchTime = 0;
    this.clearStartTime = null;

    this.indexTrajectory = [];
    this.circleAngularSum = 0;

    this.pinchFilter = new OneEuroFilter();
    this.eraseFilter = new OneEuroFilter();

    // Callbacks set by App
    this.onGestureChange = null;   // (newGesture, prevGesture)
    this.onWritePoint = null;      // ({x, y})
    this.onEraseAt = null;         // ({x, y})
    this.onSwitchColor = null;     // ()
    this.onClear = null;           // ()
    this.onUndo = null;            // ()
    this.onClearProgress = null;   // (progress: 0..1)
  }

  update(handData, timestampMs) {
    if (!handData) {
      this.idleCounter++;
      if (this.idleCounter >= this.idleFrames) {
        this._transition(Gesture.IDLE);
      }
      return;
    }
    this.idleCounter = 0;

    const kp = handData.keypoints;
    const pc = handData.palm_center;

    // Evaluate by priority
    let detected = Gesture.IDLE;
    for (const g of PRIORITY) {
      if (this._detect(g, kp, pc, timestampMs)) {
        detected = g;
        break;
      }
    }

    if (detected === this.state) {
      this.debounceCounter = Math.min(this.debounceCounter + 1, this.debounceFrames);
      this._handleStateAction(kp, pc, timestampMs);
    } else if (this.debounceCounter >= this.debounceFrames) {
      this._transition(detected);
    } else {
      this.debounceCounter = 0;
    }
  }

  _detect(gesture, kp, pc, ts) {
    switch (gesture) {
      case Gesture.WRITE:
        return this._isPinch(kp);
      case Gesture.CLEAR:
        return this._isFist(kp);
      case Gesture.ERASE:
        return this._isOpenPalm(kp);
      case Gesture.SWITCH:
        return this._isCircling(kp, ts);
      case Gesture.UNDO:
        return this._isRock(kp);
      default:
        return false;
    }
  }

  _isPinch(kp) {
    const d = dist2d(kp[TIP.THUMB], kp[TIP.INDEX]);
    return d < this.pinchThreshold &&
           !isFingerExtended(kp[TIP.MIDDLE], kp[PIP.MIDDLE]) &&
           !isFingerExtended(kp[TIP.RING], kp[PIP.RING]) &&
           !isFingerExtended(kp[TIP.PINKY], kp[PIP.PINKY]);
  }

  _isFist(kp) {
    return !isFingerExtended(kp[TIP.INDEX], kp[PIP.INDEX]) &&
           !isFingerExtended(kp[TIP.MIDDLE], kp[PIP.MIDDLE]) &&
           !isFingerExtended(kp[TIP.RING], kp[PIP.RING]) &&
           !isFingerExtended(kp[TIP.PINKY], kp[PIP.PINKY]);
  }

  _isOpenPalm(kp) {
    return isFingerExtended(kp[TIP.INDEX], kp[PIP.INDEX]) &&
           isFingerExtended(kp[TIP.MIDDLE], kp[PIP.MIDDLE]) &&
           isFingerExtended(kp[TIP.RING], kp[PIP.RING]) &&
           isFingerExtended(kp[TIP.PINKY], kp[PIP.PINKY]);
  }

  _isCircling(kp, ts) {
    const indexExtended = isFingerExtended(kp[TIP.INDEX], kp[PIP.INDEX]);
    const middleFolded = !isFingerExtended(kp[TIP.MIDDLE], kp[PIP.MIDDLE]);
    const ringFolded = !isFingerExtended(kp[TIP.RING], kp[PIP.RING]);
    const pinkyFolded = !isFingerExtended(kp[TIP.PINKY], kp[PIP.PINKY]);

    if (!(indexExtended && middleFolded && ringFolded && pinkyFolded)) {
      this.indexTrajectory = [];
      this.circleAngularSum = 0;
      return false;
    }

    const pt = kp[TIP.INDEX];
    this.indexTrajectory.push({ x: pt.x, y: pt.y, t: ts });

    if (this.indexTrajectory.length < 3) return false;

    const recent = this.indexTrajectory.slice(-3);
    const v1 = { x: recent[1].x - recent[0].x, y: recent[1].y - recent[0].y };
    const v2 = { x: recent[2].x - recent[1].x, y: recent[2].y - recent[1].y };

    const cross = v1.x * v2.y - v1.y * v2.x;
    const dot = v1.x * v2.x + v1.y * v2.y;
    const angle = Math.abs(Math.atan2(cross, dot));

    this.circleAngularSum += angle;

    if (this.indexTrajectory.length > 30) {
      const oldest = this.indexTrajectory.shift();
      const oldestV = { x: this.indexTrajectory[0].x - oldest.x, y: this.indexTrajectory[0].y - oldest.y };
      const oldestCross = oldestV.x * v2.y - oldestV.y * v2.x;
      this.circleAngularSum -= Math.abs(Math.atan2(oldestCross, oldestV.x * v2.x + oldestV.y * v2.y));
    }

    return this.circleAngularSum >= Math.PI; // 180°
  }

  _isRock(kp) {
    return isFingerExtended(kp[TIP.INDEX], kp[PIP.INDEX]) &&
           !isFingerExtended(kp[TIP.MIDDLE], kp[PIP.MIDDLE]) &&
           !isFingerExtended(kp[TIP.RING], kp[PIP.RING]) &&
           isFingerExtended(kp[TIP.PINKY], kp[PIP.PINKY]);
  }

  _transition(newState) {
    const now = Date.now();
    if (now - this.lastSwitchTime < this.deadZoneMs) return;

    this.prevState = this.state;
    this.state = newState;
    this.debounceCounter = 0;
    this.lastSwitchTime = now;

    if (this.state === Gesture.CLEAR) {
      this.clearStartTime = now;
    } else {
      this.clearStartTime = null;
    }

    if (this.state !== Gesture.SWITCH) {
      this.indexTrajectory = [];
      this.circleAngularSum = 0;
    }

    if (this.state !== Gesture.WRITE) {
      this.pinchFilter.reset();
    }
    if (this.state !== Gesture.ERASE) {
      this.eraseFilter.reset();
    }

    if (this.onGestureChange) {
      this.onGestureChange(this.state, this.prevState);
    }
  }

  _handleStateAction(kp, pc, ts) {
    switch (this.state) {
      case Gesture.WRITE: {
        const midX = (kp[TIP.THUMB].x + kp[TIP.INDEX].x) / 2;
        const midY = (kp[TIP.THUMB].y + kp[TIP.INDEX].y) / 2;
        const sx = this.pinchFilter.filter(midX, ts / 1000);
        const sy = this.pinchFilter.filter(midY, ts / 1000);
        if (this.onWritePoint) this.onWritePoint({ x: sx, y: sy });
        break;
      }
      case Gesture.ERASE: {
        const ex = this.eraseFilter.filter(pc.x, ts / 1000);
        const ey = this.eraseFilter.filter(pc.y, ts / 1000);
        if (this.onEraseAt) this.onEraseAt({ x: ex, y: ey });
        break;
      }
      case Gesture.SWITCH: {
        if (this.onSwitchColor) this.onSwitchColor();
        this._transition(Gesture.IDLE);
        break;
      }
      case Gesture.CLEAR: {
        if (this.clearStartTime !== null) {
          const elapsed = Date.now() - this.clearStartTime;
          const progress = Math.min(elapsed / this.clearHoldMs, 1);
          if (this.onClearProgress) this.onClearProgress(progress);
          if (progress >= 1) {
            if (this.onClear) this.onClear();
            this._transition(Gesture.IDLE);
          }
        }
        break;
      }
      case Gesture.UNDO: {
        if (this.onUndo) this.onUndo();
        this._transition(Gesture.IDLE);
        break;
      }
    }
  }

  isActive() {
    return this.state === Gesture.WRITE || this.state === Gesture.ERASE;
  }
}

export { Gesture };
```

- [ ] **Step 2: 单元测试 — 判定函数**

在当前阶段用 Node.js 运行手势判定函数的独立测试（mock 关键点数据，验证 _isPinch / _isFist / _isOpenPalm / _isRock 的 true/false 输出）。创建测试脚本 `frontend/test/test-gesture-detect.js`：

```javascript
import { GestureStateMachine, Gesture } from '../js/gesture-state-machine.js';

function makeKeypoint(id, x, y, z = 0) {
  return { id, x, y, z };
}

function test(label, condition) {
  console.log(condition ? `PASS: ${label}` : `FAIL: ${label}`);
}

const gsm = new GestureStateMachine();

// Test pinch detection
const pinchKp = {};
[0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20].forEach(i => {
  pinchKp[i] = makeKeypoint(i, 0.5, 0.5);
});
// Thumb tip close to index tip
pinchKp[4] = makeKeypoint(4, 0.5, 0.5);
pinchKp[8] = makeKeypoint(8, 0.505, 0.505);
// Other fingers folded (tip below pip)
pinchKp[12] = makeKeypoint(12, 0.5, 0.55);
pinchKp[10] = makeKeypoint(10, 0.5, 0.45); // PIP above tip → finger folded
pinchKp[16] = makeKeypoint(16, 0.5, 0.55);
pinchKp[14] = makeKeypoint(14, 0.5, 0.45);
pinchKp[20] = makeKeypoint(20, 0.5, 0.55);
pinchKp[18] = makeKeypoint(18, 0.5, 0.45);

test('pinch detected', gsm._isPinch(pinchKp));

// Test fist detection
const fistKp = {};
[0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20].forEach(i => {
  fistKp[i] = makeKeypoint(i, 0.5, 0.5);
});
fistKp[8]  = makeKeypoint(8,  0.5, 0.52); fistKp[6]  = makeKeypoint(6,  0.5, 0.45);
fistKp[12] = makeKeypoint(12, 0.5, 0.52); fistKp[10] = makeKeypoint(10, 0.5, 0.45);
fistKp[16] = makeKeypoint(16, 0.5, 0.52); fistKp[14] = makeKeypoint(14, 0.5, 0.45);
fistKp[20] = makeKeypoint(20, 0.5, 0.52); fistKp[18] = makeKeypoint(18, 0.5, 0.45);
test('fist detected', gsm._isFist(fistKp));

// Test open palm
const palmKp = {};
[0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20].forEach(i => {
  palmKp[i] = makeKeypoint(i, 0.5, 0.5);
});
palmKp[8]  = makeKeypoint(8,  0.5, 0.45); palmKp[6]  = makeKeypoint(6,  0.5, 0.5);
palmKp[12] = makeKeypoint(12, 0.5, 0.45); palmKp[10] = makeKeypoint(10, 0.5, 0.5);
palmKp[16] = makeKeypoint(16, 0.5, 0.45); palmKp[14] = makeKeypoint(14, 0.5, 0.5);
palmKp[20] = makeKeypoint(20, 0.5, 0.45); palmKp[18] = makeKeypoint(18, 0.5, 0.5);
test('open palm detected', gsm._isOpenPalm(palmKp));

// Test rock gesture
const rockKp = {};
[0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20].forEach(i => {
  rockKp[i] = makeKeypoint(i, 0.5, 0.5);
});
rockKp[8]  = makeKeypoint(8,  0.5, 0.45); rockKp[6]  = makeKeypoint(6,  0.5, 0.5);
rockKp[12] = makeKeypoint(12, 0.5, 0.52); rockKp[10] = makeKeypoint(10, 0.5, 0.45);
rockKp[16] = makeKeypoint(16, 0.5, 0.52); rockKp[14] = makeKeypoint(14, 0.5, 0.45);
rockKp[20] = makeKeypoint(20, 0.5, 0.45); rockKp[18] = makeKeypoint(18, 0.5, 0.5);
test('rock gesture detected', gsm._isRock(rockKp));

console.log('All gesture detection tests complete');
```

Run: `cd frontend && node test/test-gesture-detect.js`
Expected: 所有 4 项输出 `PASS:`。

- [ ] **Step 3: Commit**

```bash
git add frontend/js/gesture-state-machine.js frontend/test/test-gesture-detect.js
git commit -m "feat: add gesture state machine with detection functions"
```

---

### Task 8: 前端 — Canvas 绘制层（分层 Canvas + 笔画管理）

**Files:**
- Create: `frontend/js/draw-layer.js`

- [ ] **Step 1: 编写 draw-layer.js**

`frontend/js/draw-layer.js`:
```javascript
export class DrawLayer {
  constructor(historyCanvasId, activeCanvasId, cursorCanvasId) {
    this.historyCanvas = document.getElementById(historyCanvasId);
    this.activeCanvas = document.getElementById(activeCanvasId);
    this.cursorCanvas = document.getElementById(cursorCanvasId);
    this.historyCtx = this.historyCanvas.getContext('2d');
    this.activeCtx = this.activeCanvas.getContext('2d');
    this.cursorCtx = this.cursorCanvas.getContext('2d');

    this.strokes = [];
    this.currentStroke = null;
    this.lineWidth = 4;
    this.color = '#00ff88';
    this.eraseRadius = 30;
    this.colors = ['#00ff88', '#ff4444', '#4488ff', '#ffaa00', '#aa44ff', '#ffffff'];

    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  resize() {
    const container = this.historyCanvas.parentElement;
    const rect = container.getBoundingClientRect();
    [this.historyCanvas, this.activeCanvas, this.cursorCanvas].forEach(c => {
      c.width = rect.width;
      c.height = rect.height;
    });
  }

  normToCanvas(normX, normY) {
    return {
      x: normX * this.historyCanvas.width,
      y: normY * this.historyCanvas.height,
    };
  }

  beginStroke(pt) {
    this.currentStroke = {
      id: crypto.randomUUID(),
      color: this.color,
      lineWidth: this.lineWidth,
      points: [pt],
      erased: false,
      bbox: { x: pt.x, y: pt.y, w: 0, h: 0 },
    };
    this.activeCtx.clearRect(0, 0, this.activeCanvas.width, this.activeCanvas.height);
    this.activeCtx.strokeStyle = this.color;
    this.activeCtx.lineWidth = this.lineWidth;
    this.activeCtx.lineCap = 'round';
    this.activeCtx.lineJoin = 'round';
    this.activeCtx.beginPath();
    this.activeCtx.moveTo(pt.x, pt.y);
  }

  addPoint(pt) {
    if (!this.currentStroke) return;
    this.currentStroke.points.push(pt);
    this.activeCtx.lineTo(pt.x, pt.y);
    this.activeCtx.stroke();

    // Update bbox
    const bb = this.currentStroke.bbox;
    const nx = Math.min(bb.x, pt.x);
    const ny = Math.min(bb.y, pt.y);
    bb.w = Math.max(bb.x + bb.w, pt.x) - nx;
    bb.h = Math.max(bb.y + bb.h, pt.y) - ny;
    bb.x = nx;
    bb.y = ny;
  }

  endStroke() {
    if (!this.currentStroke) return;
    this.strokes.push(this.currentStroke);
    this._mergeToHistory(this.currentStroke);
    this.currentStroke = null;
    this.activeCtx.clearRect(0, 0, this.activeCanvas.width, this.activeCanvas.height);
  }

  _mergeToHistory(stroke) {
    this.historyCtx.strokeStyle = stroke.color;
    this.historyCtx.lineWidth = stroke.lineWidth;
    this.historyCtx.lineCap = 'round';
    this.historyCtx.lineJoin = 'round';
    this.historyCtx.beginPath();
    this.historyCtx.moveTo(stroke.points[0].x, stroke.points[0].y);
    for (let i = 1; i < stroke.points.length; i++) {
      this.historyCtx.lineTo(stroke.points[i].x, stroke.points[i].y);
    }
    this.historyCtx.stroke();
  }

  eraseAt(center) {
    const r = this.eraseRadius;
    let changed = false;
    for (const stroke of this.strokes) {
      if (stroke.erased) continue;
      // Bbox quick reject
      if (center.x + r < stroke.bbox.x || center.x - r > stroke.bbox.x + stroke.bbox.w ||
          center.y + r < stroke.bbox.y || center.y - r > stroke.bbox.y + stroke.bbox.h) {
        continue;
      }
      // Point-by-point check
      for (const pt of stroke.points) {
        const dx = pt.x - center.x;
        const dy = pt.y - center.y;
        if (dx * dx + dy * dy < r * r) {
          stroke.erased = true;
          changed = true;
          break;
        }
      }
    }
    if (changed) this._redrawHistory();
    return changed;
  }

  undo() {
    for (let i = this.strokes.length - 1; i >= 0; i--) {
      if (!this.strokes[i].erased) {
        this.strokes[i].erased = true;
        this._redrawHistory();
        return true;
      }
    }
    return false;
  }

  clearAll() {
    for (const s of this.strokes) s.erased = true;
    this._redrawHistory();
  }

  _redrawHistory() {
    this.historyCtx.clearRect(0, 0, this.historyCanvas.width, this.historyCanvas.height);
    for (const stroke of this.strokes) {
      if (stroke.erased) continue;
      this.historyCtx.strokeStyle = stroke.color;
      this.historyCtx.lineWidth = stroke.lineWidth;
      this.historyCtx.lineCap = 'round';
      this.historyCtx.lineJoin = 'round';
      this.historyCtx.beginPath();
      this.historyCtx.moveTo(stroke.points[0].x, stroke.points[0].y);
      for (let i = 1; i < stroke.points.length; i++) {
        this.historyCtx.lineTo(stroke.points[i].x, stroke.points[i].y);
      }
      this.historyCtx.stroke();
    }
  }

  setColor(color) { this.color = color; }
  setLineWidth(w) { this.lineWidth = w; }

  // Cursor rendering
  drawWriteCursor(pt) {
    this._clearCursor();
    this.cursorCtx.beginPath();
    this.cursorCtx.arc(pt.x, pt.y, this.lineWidth / 2 + 2, 0, Math.PI * 2);
    this.cursorCtx.fillStyle = this.color;
    this.cursorCtx.fill();
  }

  drawEraseCursor(center) {
    this._clearCursor();
    this.cursorCtx.beginPath();
    this.cursorCtx.arc(center.x, center.y, this.eraseRadius, 0, Math.PI * 2);
    this.cursorCtx.strokeStyle = 'rgba(255,255,255,0.6)';
    this.cursorCtx.lineWidth = 2;
    this.cursorCtx.stroke();
    this.cursorCtx.fillStyle = 'rgba(255,255,255,0.1)';
    this.cursorCtx.fill();
  }

  clearCursor() {
    this._clearCursor();
  }

  _clearCursor() {
    this.cursorCtx.clearRect(0, 0, this.cursorCanvas.width, this.cursorCanvas.height);
  }

  saveScreenshot() {
    const combined = document.createElement('canvas');
    combined.width = this.historyCanvas.width;
    combined.height = this.historyCanvas.height;
    const ctx = combined.getContext('2d');

    const video = document.getElementById('webcam');
    if (video && video.readyState >= 2) {
      ctx.drawImage(video, 0, 0, combined.width, combined.height);
    }
    ctx.drawImage(this.historyCanvas, 0, 0);
    ctx.drawImage(this.activeCanvas, 0, 0);

    const link = document.createElement('a');
    link.download = `ar-drawing-${Date.now()}.png`;
    link.href = combined.toDataURL('image/png');
    link.click();
  }
}
```

- [ ] **Step 2: 验证 draw-layer 可导入**

Run: `cd frontend && node -e "import('./js/draw-layer.js').then(m => console.log('DrawLayer imported OK'))"`
Expected: 输出 `DrawLayer imported OK`。

注意：此验证在 Node.js 中仅测试模块语法正确性，DOM 相关的构造函数调用将在浏览器中测试。

- [ ] **Step 3: Commit**

```bash
git add frontend/js/draw-layer.js
git commit -m "feat: add layered Canvas drawing with stroke management"
```

---

### Task 9: 前端 — 工具栏 UI

**Files:**
- Create: `frontend/js/toolbar.js`

- [ ] **Step 1: 编写 toolbar.js**

`frontend/js/toolbar.js`:
```javascript
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
}
```

- [ ] **Step 2: 更新 style.css 添加工具栏样式**

在 `frontend/css/style.css` 末尾追加：
```css
.tb-colors { display: flex; align-items: center; gap: 6px; }
.tb-color-btn { width: 28px; height: 28px; border-radius: 50%; border: 2px solid transparent; cursor: pointer; }
.tb-color-btn.active { border-color: #fff; box-shadow: 0 0 6px rgba(255,255,255,0.5); }
.tb-color-picker { width: 28px; height: 28px; border: none; cursor: pointer; background: none; padding: 0; }
.tb-size { display: flex; align-items: center; gap: 8px; }
.tb-size label { font-size: 13px; color: #aaa; }
.tb-size-slider { width: 100px; }
.tb-size-val { font-size: 12px; color: #aaa; min-width: 36px; }
.tb-actions { display: flex; gap: 6px; margin-left: auto; }
.tb-btn { width: 34px; height: 34px; border: 1px solid #333; border-radius: 6px; background: #1a1a2e; color: #eee; cursor: pointer; font-size: 16px; display: flex; align-items: center; justify-content: center; }
.tb-btn:hover { background: #0f3460; }
```

- [ ] **Step 3: Commit**

```bash
git add frontend/js/toolbar.js frontend/css/style.css
git commit -m "feat: add toolbar UI with color picker, brush size, and action buttons"
```

---

### Task 10: 前端 — 性能监控模块

**Files:**
- Create: `frontend/js/perf-monitor.js`

- [ ] **Step 1: 编写 perf-monitor.js**

`frontend/js/perf-monitor.js`:
```javascript
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
```

- [ ] **Step 2: Commit**

```bash
git add frontend/js/perf-monitor.js
git commit -m "feat: add FPS performance monitor with degradation levels"
```

---

### Task 11: 前端 — 主入口完整集成（所有模块串联）

**Files:**
- Modify: `frontend/js/main.js`

- [ ] **Step 1: 重写 main.js 完整版**

`frontend/js/main.js`:
```javascript
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
    await this.video.start();

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
      // Visual clear progress indicator — renders a ring overlay
      this._drawClearProgress(p);
      if (p >= 1) this.draw.clearCursor();
    };

    this.perf.onLevelChange = (level) => {
      if (level === 1) {
        this.video.video.style.opacity = '0.3';
        console.warn('Perf level 1: video dimmed');
      } else if (level === 2) {
        document.getElementById('video-container').style.background = '#111';
        this.video.video.style.display = 'none';
        console.warn('Perf level 2: video hidden');
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

    // Clear cursor when idle
    if (!this.gesture.isActive() && !this.draw.currentStroke) {
      this.draw.clearCursor();
    }
  }

  _renderLoop() {
    this.renderPending = false;
    // Canvas rendering is event-driven (addPoint triggers activeCtx.stroke())
    // This loop handles any pending visual refresh if needed
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
app.start();
```

- [ ] **Step 2: 更新 style.css 补充视频预览可见性**

在前端 `frontend/css/style.css` 中确保 `#webcam` 可见（作为背景层）。将此前 `display:none` 改为：
```css
#webcam {
  position: absolute;
  top: 50%; left: 50%;
  transform: translate(-50%, -50%);
  width: 100%; height: 100%;
  object-fit: contain;
  z-index: 0;
}
#layer-history { z-index: 1; }
#layer-active { z-index: 2; }
#layer-cursor { z-index: 3; }
```

- [ ] **Step 3: 完整功能验证**

条件：后端运行 `python server.py`，前端通过 HTTP 服务访问。

验证清单：
1. 摄像头画面显示在背景
2. 状态栏 FPS 持续更新
3. 拇指食指捏合 → 书写笔迹出现
4. 五指张开 → 手掌位置擦除笔迹
5. 握拳保持 1 秒 → 出现红色进度环 → 全清空
6. 食指伸出画圈 → 颜色切换
7. 工具栏颜色选取器和笔刷大小生效
8. 工具栏撤销/清空/截图按钮可用
9. FPS 过低时触发降级

- [ ] **Step 4: Commit**

```bash
git add frontend/js/main.js frontend/css/style.css
git commit -m "feat: full integration of gesture pipeline, drawing, toolbar, and perf monitor"
```

---

### Task 12: 后端 — 心跳支持与降级分辨率

**Files:**
- Modify: `backend/server.py`

- [ ] **Step 1: 更新 server.py 添加心跳响应、发送前缓冲丢弃、动态分辨率**

`backend/server.py` 修改点（仅列变更部分，完整代码通过 Edit 工具应用）：

**变更 1** — WebSocket receive handler（在 `await ws.accept()` 之后添加，`try` 块之前）:
```python
    # Start a task to handle incoming messages (heartbeat pings)
    async def handle_incoming():
        try:
            while running:
                raw = await ws.receive_text()
                msg = json.loads(raw)
                if msg.get("type") == "ping":
                    await ws.send_json({"type": "pong"})
        except Exception:
            pass

    recv_task = asyncio.create_task(handle_incoming())
```

**变更 2** — 主循环中获取 `recv_task` 引用并在 finally 中 cancel:
```python
    finally:
        running = False
        recv_task.cancel()
        try:
            await ws.close()
        except Exception:
            pass
```

- [ ] **Step 2: 验证心跳**

启动后端并从前端确认 ws-status 点显示绿色（connected）且不跳断。

- [ ] **Step 3: Commit**

```bash
git add backend/server.py
git commit -m "feat: add WebSocket heartbeat pong support"
```

---

### Task 13: 打磨 — video 对齐、CSS 微调、暗色主题完善

**Files:**
- Modify: `frontend/css/style.css`

- [ ] **Step 1: 完善全页样式**

确保以下样式完整覆盖：
```css
*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
body { background: #1a1a2e; color: #eee; font-family: 'Segoe UI', system-ui, sans-serif; overflow: hidden; height: 100vh; }
#app { display: flex; flex-direction: column; height: 100vh; }
#video-container { flex: 1; position: relative; overflow: hidden; background: #000; min-height: 0; }
#webcam { position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%); width: 100%; height: 100%; object-fit: contain; z-index: 0; pointer-events: none; }
#video-container canvas { position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%); }
#layer-history { z-index: 1; }
#layer-active { z-index: 2; }
#layer-cursor { z-index: 3; }
#toolbar { display: flex; align-items: center; gap: 12px; padding: 10px 16px; background: #16213e; border-top: 1px solid #0f3460; flex-shrink: 0; }
#status-bar { display: flex; gap: 16px; padding: 4px 16px; font-size: 12px; color: #888; background: #0f0f1a; flex-shrink: 0; }
#ws-status { color: #f00; font-size: 18px; line-height: 1; }
#ws-status.connected { color: #0f0; }
#gesture-display { text-transform: capitalize; }
.tb-colors { display: flex; align-items: center; gap: 6px; }
.tb-color-btn { width: 28px; height: 28px; border-radius: 50%; border: 2px solid transparent; cursor: pointer; transition: border-color 0.15s, box-shadow 0.15s; }
.tb-color-btn.active { border-color: #fff; box-shadow: 0 0 6px rgba(255,255,255,0.5); }
.tb-color-picker { width: 28px; height: 28px; border: none; cursor: pointer; background: none; padding: 0; }
.tb-size { display: flex; align-items: center; gap: 8px; }
.tb-size label { font-size: 13px; color: #aaa; }
.tb-size-slider { width: 100px; accent-color: #00ff88; }
.tb-size-val { font-size: 12px; color: #aaa; min-width: 36px; }
.tb-actions { display: flex; gap: 6px; margin-left: auto; }
.tb-btn { width: 34px; height: 34px; border: 1px solid #333; border-radius: 6px; background: #1a1a2e; color: #eee; cursor: pointer; font-size: 16px; display: flex; align-items: center; justify-content: center; transition: background 0.15s; }
.tb-btn:hover { background: #0f3460; }
```

- [ ] **Step 2: 验证 Canvas 尺寸对齐**

在 main.js 启动后确认 draw.resize() 被调用。在浏览器中检查：Canvas width/height 应等于 video-container 的渲染尺寸。手指捏合位置与 Canvas 笔迹位置应对齐（允许 ±5px 偏差）。

- [ ] **Step 3: Commit**

```bash
git add frontend/css/style.css
git commit -m "style: polish dark theme, video/canvas alignment, and toolbar styling"
```

---

### Task 14: 文档完善与 README

**Files:**
- Create: `README.md`

- [ ] **Step 1: 编写 README.md**

`README.md`:
```markdown
# AR 手势书写交互系统

基于计算机视觉的隔空手势书写系统。通过电脑摄像头识别手部关键点，在实时视频画面上叠加书写笔迹。

## 快速开始

### 环境要求
- Python 3.10+
- 带有摄像头的电脑
- 现代浏览器 (Chrome/Edge 90+)

### 安装与启动

```bash
# 安装 Python 依赖
cd backend
pip install -r requirements.txt

# 启动后端（WebSocket 服务）
python server.py
```

打开另一个终端：

```bash
# 启动前端
cd frontend
python -m http.server 8080
```

浏览器打开 `http://localhost:8080`。

## 手势操作

| 手势 | 操作 |
|------|------|
| 拇指与食指捏合 | 书写 |
| 五指张开 | 擦除 |
| 握拳保持 1 秒 | 清空画布 |
| 食指伸出画圈 | 切换颜色 |
| 食指+小指伸出（摇滚手势） | 撤销 |

## 项目结构

```
backend/    Python 后端 (OpenCV + MediaPipe + FastAPI)
frontend/   Web 前端 (Canvas 2D + Vanilla JS)
docs/       方案书与实施计划
```

## 技术栈

Python: OpenCV, MediaPipe Hands, FastAPI, WebSocket
前端: HTML5 Canvas 2D, WebSocket API, getUserMedia
```

- [ ] **Step 2: Commit**

```bash
git add README.md
git commit -m "docs: add README with setup and usage instructions"
```

---

### Task 15: 最终验证与 .gitignore

**Files:**
- Create: `.gitignore`
- Create: `.superpowers/` (already exists via brainstorming, add to gitignore)

- [ ] **Step 1: 编写 .gitignore**

`.gitignore`:
```
__pycache__/
*.pyc
*.pyo
.env
.venv/
venv/
.superpowers/
.DS_Store
Thumbs.db
```

- [ ] **Step 2: 最终端到端验证**

1. 确保后端运行正常：`cd backend && python server.py`
2. 确保前端运行正常：`cd frontend && python -m http.server 8080`
3. 浏览器打开，完整测试所有手势和 UI 按钮
4. 验证 .gitignore 排除了 pycache 和 .superpowers

- [ ] **Step 3: Commit**

```bash
git add .gitignore
git commit -m "chore: add .gitignore and final verification"
```

---

## 验证标准汇总

| Phase | 验证项 | 通过标准 |
|-------|--------|---------|
| Phase 1 | 管线连通 | 后端启动无报错，WebSocket 推送有效 JSON，前端接收并显示 FPS |
| Phase 2 | 手势识别 | 5 种手势各 10 次测试，识别率 ≥ 80%（原型阶段可接受） |
| Phase 2 | 防抖 | 单帧闪烁不触发手势切换（观察 gesture-display 无抖动） |
| Phase 3 | 书写 | 捏合移动时笔迹连续，松开时封笔，笔画颜色/粗细正确 |
| Phase 3 | 擦除 | 手掌张开靠近已画笔画区域时笔画消失 |
| Phase 3 | 撤销/清空 | 撤销移除最近一笔，清空移除全部 |
| Phase 4 | 工具栏 | 颜色选取器、笔刷滑块、撤销/清空/截图按钮均生效 |
| Phase 4 | 性能降级 | 人为制造低帧率场景（CPU 负载），观察降级触发 |

---

## 已知限制与后续优化方向

- 捏合阈值（0.06）基于归一化坐标，不同用户手掌大小需手动调整；后续可加入自动标定
- 轨迹平滑仅对 Write/Erase 生效；Idle→Write 首帧可能存在跳跃
- 握拳清空的 1 秒倒计时在手指数目发生变化时取消，但手指微动可能被误判为状态变化
- 画圈换色的检测在快速画小圈时可能不稳定
