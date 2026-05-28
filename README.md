# AR 手势书写交互系统

基于计算机视觉的隔空手势书写系统。通过电脑摄像头识别手部关键点，在实时视频画面上叠加书写笔迹。

## 快速开始

### 环境要求
- Python 3.10+ (推荐使用 conda)
- 带有摄像头的电脑
- 现代浏览器 (Chrome/Edge 90+)

### 安装与启动

```bash
# 创建 conda 环境
conda create -n ar-gesture python=3.10 -y
conda activate ar-gesture

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
