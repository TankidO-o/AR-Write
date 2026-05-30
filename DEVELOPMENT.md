# Development Guide

Developer-facing build and release instructions for AR-Write.

## Prerequisites

- Python 3.10+ (3.12 recommended; 3.14 supported via ONNX backend)
- Webcam-enabled computer
- Modern browser (Chrome/Edge 90+)

## Setup

```bash
# Create conda environment (optional)
conda create -n ar-gesture python=3.12 -y
conda activate ar-gesture

# Install Python dependencies
cd backend
pip install -r requirements.txt

# ONNX backend only — first time: convert hand detection models
python convert_models.py
```

> **Python 3.14 users**: mediapipe has no 3.14 wheel. The system auto-falls back to ONNX Runtime. Install `onnxruntime onnx opencv-python fastapi uvicorn`, then run `python convert_models.py`.

## Launch (Development)

| Platform | Method |
|----------|--------|
| Windows | Double-click `launcher.py`, or `python launcher.py` |
| macOS / Linux | `python launcher.py` |
| Manual | `cd backend && python server.py` |

`launcher.py` auto-detects Python version, missing deps, and hand-detection backend.

## Build Installer

```bash
pip install pyinstaller
python build_exe.py
```

Produces `dist/AR-Write-Setup.exe` (~150 MB). Three-stage build:
1. PyInstaller `--onedir` → `dist/AR-Write/` (fast startup, no per-launch extraction)
2. Zip the onedir directory
3. PyInstaller `--onefile` with `setup.py` → `dist/AR-Write-Setup.exe` (GUI installer)

The `setup.py` inside the installer is a tkinter GUI wizard that:
- Shows welcome page with notes
- Requires license agreement
- Lets user choose install path (default: `%LOCALAPPDATA%\AR-Write\`)
- Shows extraction progress
- Creates Start Menu / Desktop shortcuts
- Launches the app on completion

## One-Click GitHub Release

```bash
# Install GitHub CLI & sign in (one-time)
gh auth login

# Build + tag + publish
python release.py                    # auto version (v2026.05.31)
python release.py --version v1.2.0   # custom version
python release.py --dry-run          # build only, skip publishing
```

## Project Structure

```
launcher.py     Entry point (dev); in frozen mode runs server in-process
setup.py        GUI installer wizard (bundled into AR-Write-Setup.exe)
build_exe.py    Build pipeline: onedir app → zip → onefile installer
release.py      One-click GitHub Release (build + tag + upload)
backend/        Python backend (OpenCV + MediaPipe/ONNX + FastAPI, serves frontend)
frontend/       Web frontend (Canvas 2D + Vanilla JS ES Modules)
docs/           Design documents and implementation plans
```

## Tech Stack

**Backend**: Python, OpenCV, MediaPipe Hands / ONNX Runtime, FastAPI, WebSocket
**Frontend**: HTML5 Canvas 2D, WebSocket API, ES Modules

The hand detection backend auto-switches between mediapipe (Python ≤3.12) and ONNX Runtime (any Python version including 3.14+).
