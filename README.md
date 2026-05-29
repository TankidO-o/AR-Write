# AR 手势书写交互系统

> 基于计算机视觉的隔空手势书写系统。通过摄像头识别手部关键点，在空气中用不同手势完成书写、擦除、撤销和清空画布等操作。

## 快速开始

### 环境要求
- Python 3.10+（推荐 3.12；**3.14 通过 ONNX 后端支持**）
- 带有摄像头的电脑
- 现代浏览器 (Chrome/Edge 90+)

### 安装与启动

```bash
# 创建 conda 环境（可选）
conda create -n ar-gesture python=3.12 -y
conda activate ar-gesture

# 安装 Python 依赖
cd backend
pip install -r requirements.txt

# (仅首次使用 ONNX 后端时需要) 转换手部检测模型
python convert_models.py
```

> **Python 3.14 用户**：mediapipe 暂无 3.14 wheel，系统会自动切换到 ONNX Runtime 后端。只需安装 `onnxruntime onnx opencv-python fastapi uvicorn`，然后运行一次 `python convert_models.py` 生成 ONNX 模型即可。

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

浏览器打开 `http://localhost:8080`。首次进入会弹出悬浮手势指南（点击 `?` 可随时重新查看）。

## 手势操作

| 手势 | 操作 | 说明 |
|------|------|------|
| 🤏 拇指与食指捏合 | **书写** | 即时开始，食指尖有绿色十字准星辅助定位 |
| 🖐️ 五指张开 | **区域擦除** | 仅擦除圆内笔画片段，不删整根线 |
| ✊ 握拳保持 1 秒 | **清空画布** | L2 环形进度条显示倒计时 |
| 🤏→张开 快速脉冲 | **撤销** | 快速捏合后松开（不落笔），撤销最近一笔 |

## 工具栏

左侧纵向 5 区卡片式工具栏：

| 分区 | 功能 |
|------|------|
| 🎨 颜色 | 6 预设色块 + 取色器 |
| 🖌️ 笔刷 | S/M/L 快捷预设 + 滑块微调 (2~20px) |
| 🧹 橡皮 | 小/中/大 三级预设 (15/30/50px) |
| 📋 画布 | ↩ 撤销 · ↪ 重做 · ✕ 清空 · 💾 截图 |
| ⚡ 手势 | ? 手势指南 · ⚙ 校准 · ⚡ 自定义手势 |

点击 🖼️ 按钮可在**摄像头模式 / 黑板模式 / 白板模式**之间循环切换，黑白板模式下摄像头画面自动隐藏。

## 自定义手势

点击工具栏 ⚡ 按钮打开自定义手势面板：

- **覆写**：用你自己的标定数据（10 次采样）覆盖内置手势
- **新建**：通过模板匹配创建自定义手势（3 次采样），可绑定 8 种动作
- 调整每个手势的**触发阈值**（40–95）并保存到本地

可绑定的动作：

| 动作 | 说明 |
|------|------|
| 🎨 切换颜色 | 指定目标颜色 |
| 🖌️ 笔刷大小 | S/M/L 三档 |
| 🧹 橡皮大小 | 小/中/大 三档 |
| ↩ 撤销 | 撤销最近一笔 |
| ↪ 重做 | 恢复被撤销的笔画 |
| ✕ 清空画布 | 清空整个画布 |
| 💾 保存截图 | 下载 PNG 截图 |
| 🖼️ 切换背景 | 摄像头/黑板/白板 |

## 视觉反馈

三层反馈体系时刻告知当前状态：

| 层级 | 位置 | 内容 |
|------|------|------|
| L1 持久 | 画布右上角 | 当前手势图标 + 名称 + 颜色/笔刷信息 |
| L2 进度 | 画布中央 | 环形进度条（清空画布时长按倒计时） |
| L3 瞬态 | 画布顶部 | 动作完成确认 Toast，1 秒淡出 |

## 项目结构

```
backend/    Python 后端 (OpenCV + MediaPipe + FastAPI)
frontend/   Web 前端 (Canvas 2D + Vanilla JS ES Modules)
docs/       设计文档与实施计划
```

## 技术栈

**后端**: Python, OpenCV, MediaPipe Hands / ONNX Runtime, FastAPI, WebSocket
**前端**: HTML5 Canvas 2D, WebSocket API, ES Modules

> 后端的 hand detection 支持双后端自动切换：mediapipe（Python ≤3.12，性能更优）和 ONNX Runtime（任意 Python 版本，包括 3.14+）。详见 `backend/onnx_hand_detector.py`。
