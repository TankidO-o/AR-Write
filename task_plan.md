# Task Plan — AR 手势书写项目

## Goal
构建基于 MediaPipe + WebSocket + Canvas 的 AR 手势书写交互系统。

## Phases

### Phase 0: 方案设计 ✅
- [x] 需求澄清与头脑风暴
- [x] 技术路线选型
- [x] 架构设计
- [x] 设计审查
- [x] 方案书撰写与确认

### Phase 1: 基础管线 ✅
- [x] 搭建项目文件结构
- [x] 后端：camera.py + hand_detector.py + server.py
- [x] 前端：video-layer.js + ws-client.js + one-euro-filter.js + main.js
- [x] 验证：摄像头帧 → 关键点 → WebSocket 推送 → 前端接收并显示骨架
- [x] 代码审查修复：线程安全、资源泄漏、跨平台、异步卸载、连接隔离

### Phase 2: 手势识别引擎 ✅
- [x] 实现 5 个判定函数 (isPinch, isCircling, isOpenPalm, isFist, isRock)
- [x] 实现防抖机制 (N帧确认)
- [x] 实现优先级链与死区时间
- [x] 实现 Idle 状态
- [x] 实现 One-Euro Filter
- [x] 代码审查修复：x/y 独立滤波器实例、圆形检测角度追踪修正

### Phase 3: Canvas 绘制与擦除 ✅
- [x] 分层 Canvas 架构 (历史层/活跃层/光标层)
- [x] 笔画数据结构与 strokes[] 管理
- [x] 书写实时渲染
- [x] 擦除碰撞检测 (包围盒快速剔除 + 点距离检测)
- [x] 撤销/清空

### Phase 4: UI 与完整体验 ✅
- [x] 工具栏 UI (颜色选取器、笔刷滑块、操作按钮)
- [x] 手势视觉反馈 (光标、握拳进度环)
- [x] 截图保存 (Canvas.toDataURL)
- [x] 性能监控与三级降级触发
- [x] 完整模块集成 (main.js 串联全部 6 个前端模块)

### Phase 5: 打磨与测试 ✅
- [x] 暗色主题 CSS 完善
- [x] 视频/Canvas 坐标对齐 (object-fit: contain + translate 居中)
- [x] README 文档
- [x] .gitignore

## 产出统计
- 17 commits on dev branch
- 13 source files, ~1120 lines of code
- 后端 3 文件 (camera.py, hand_detector.py, server.py)
- 前端 8 文件 (8 JS + 1 HTML + 1 CSS)
- 方案书 1 文件, 实施计划 1 文件

## Decisions
- 手势判定全部收敛至前端，后端仅推送原始关键点
- Canvas 采用三分层架构（历史层/活跃层/光标层）
- 纯本地部署，ws://localhost
- 最多追踪一只手，锁定首次检测的 handedness
- One-Euro Filter x/y 独立实例，导数基于原始坐标计算
