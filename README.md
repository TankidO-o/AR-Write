# AR 手势书写交互系统

> An AR gesture-based writing and drawing system powered by computer vision. Use hand gestures in mid-air to write, erase, undo, switch colors, and clear the canvas — no touch, no stylus, just your webcam.

基于计算机视觉的隔空手势书写系统。通过摄像头识别手部关键点，在空气中用不同手势完成书写、擦除、撤销、切换颜色和清空画布等操作。

## 快速开始

### 环境要求
- Python 3.10+ (推荐使用 conda)
- 带有摄像头的电脑
- 现代浏览器 (Chrome/Edge 90+)

### 安装与启动

```bash
# 创建 conda 环境（可选）
conda create -n ar-gesture python=3.10 -y
conda activate ar-gesture

# 安装 Python 依赖
cd backend
pip install -r requirements.txt
```

**Windows**: 双击项目根目录的启动文件：

| 文件 | 说明 |
|------|------|
| `start_backend.bat` | 启动后端 (WebSocket + 摄像头) |
| `start_frontend.bat` | 启动前端 (HTTP 静态服务) |
| `start_all.bat` | 一键启动前后端 + 自动打开浏览器 |

**手动启动**：

```bash
# 终端 1 - 后端
cd backend
python server.py

# 终端 2 - 前端
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
| 拇指与中指捏合 | 切换颜色 |
| 比耶手势保持 1 秒 | 撤销 |

## 项目结构

```
backend/    Python 后端 (OpenCV + MediaPipe + FastAPI)
frontend/   Web 前端 (Canvas 2D + Vanilla JS)
docs/       方案书与实施计划
```

## 技术栈

Python: OpenCV, MediaPipe Hands, FastAPI, WebSocket
前端: HTML5 Canvas 2D, WebSocket API, getUserMedia
