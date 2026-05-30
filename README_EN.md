# AR Gesture Writing System

> An AR gesture-based writing and drawing system powered by computer vision. Use hand gestures in mid-air to write, erase, undo, and clear the canvas -- no touch, no stylus, just your webcam.

## Quick Start

### Prerequisites
- Python 3.10+ (3.12 recommended; **3.14 supported via ONNX backend**)
- A computer with a webcam
- Modern browser (Chrome/Edge 90+)

### Installation & Launch

```bash
# Create conda environment (optional)
conda create -n ar-gesture python=3.12 -y
conda activate ar-gesture

# Install Python dependencies
cd backend
pip install -r requirements.txt

# (ONNX backend only -- first time setup) Convert the hand detection model
python convert_models.py
```

> **Python 3.14 users**: mediapipe does not have 3.14 wheels yet. The system auto-falls back to the ONNX Runtime backend. Install `onnxruntime onnx opencv-python fastapi uvicorn`, then run `python convert_models.py` once to generate the ONNX models.

**Launch**:

| Platform | Method |
|----------|--------|
| **Windows** | Double-click `launcher.py`, or `python launcher.py` in terminal |
| **macOS / Linux** | `python launcher.py` in terminal |
| **Manual** | `cd backend && python server.py` |

The browser opens automatically at `http://localhost:8765`. A gesture guide overlay appears on first launch (click `?` to re-open anytime).

> `launcher.py` auto-detects your Python version, missing dependencies, and hand-detection backend availability, giving clear guidance in English. The frontend is embedded in the backend -- no separate HTTP server required.

### Build Installer (no Python required for end users)

```bash
pip install pyinstaller
python build_exe.py
```

Produces `dist/AR-Write-Setup.exe` (~150 MB, self-contained: Python + ONNX + OpenCV + frontend).

Users double-click the installer and the GUI wizard guides them through:
1. Welcome page (important notes)
2. License agreement
3. Install directory selection (default: `%LOCALAPPDATA%\AR-Write\`)
4. Progress bar during extraction
5. Shortcut creation + launch

After install, launch from the Start Menu or Desktop shortcut — **starts instantly** (no extraction on every launch).

### One-Click GitHub Release

```bash
# Install GitHub CLI & sign in (one-time)
# winget install GitHub.cli   or   scoop install gh
gh auth login

# Build + tag + publish in one command
python release.py                    # auto version (v2026.05.31)
python release.py --version v1.2.0   # custom version
python release.py --dry-run          # build only, skip publishing
```

Users then download `AR-Write-Setup.exe` directly from GitHub Releases — double-click, install, go.

## Gestures

| Gesture | Action | Notes |
|---------|--------|-------|
| 🤏 Pinch thumb & index finger | **Write** | Green crosshair at index fingertip for precision |
| 🖐️ Spread all five fingers | **Region Erase** | Only erases stroke fragments within the circle |
| ✊ Fist (hold 1 sec) | **Clear Canvas** | L2 progress ring shows countdown |
| 🤏→Release quick pulse | **Undo** | Quick pinch-and-release without drawing |

## Toolbar

Left sidebar with 5 card sections:

| Section | Features |
|---------|----------|
| 🎨 Colors | 6 preset swatches + color picker |
| 🖌️ Brush | S/M/L presets + fine slider (2~20px) |
| 🧹 Eraser | Small/Medium/Large presets (15/30/50px) |
| 📋 Canvas | ↩ Undo - ↪ Redo - ✕ Clear - 💾 Save |
| ⚡ Gestures | ? Guide - ⚙ Calibrate - ⚡ Custom Gestures |

Click 🖼️ to cycle through **Camera / Blackboard / Whiteboard** modes. The camera feed is hidden in blackboard and whiteboard modes.

## Custom Gestures

Click the ⚡ button in the toolbar to open the custom gesture panel:

- **Overwrite** existing built-in gestures with your own calibration data (10 samples each)
- **Create** custom gestures with template matching (3 samples each) -- bind to any of 8 action types
- Adjust per-gesture **thresholds** (40-95) and save to localStorage

Available actions:

| Action | Description |
|--------|-------------|
| 🎨 Set Color | Switch to a specific color |
| 🖌️ Brush Size | Toggle S/M/L |
| 🧹 Eraser Size | Toggle Small/Medium/Large |
| ↩ Undo | Undo last stroke |
| ↪ Redo | Redo last undone stroke |
| ✕ Clear | Clear entire canvas |
| 💾 Save | Download PNG screenshot |
| 🖼️ Background | Cycle camera/blackboard/whiteboard |

## Visual Feedback

Three-layer feedback system keeps you informed:

| Layer | Position | Content |
|-------|----------|---------|
| L1 Persistent | Top-right of canvas | Current gesture icon + name + color/brush info |
| L2 Progress | Center of canvas | Ring progress bar (clear canvas countdown) |
| L3 Transient | Top-center of canvas | Action confirmation toast, fades in 1s |

## Project Structure

```
launcher.py     One-click entry point (dev mode)
setup.py        GUI installer wizard (bundled into Setup.exe)
build_exe.py    Build installer (onedir → zip → onefile setup)
release.py      One-click GitHub Release
backend/       Python backend (OpenCV + MediaPipe/ONNX + FastAPI, serves frontend)
frontend/      Web frontend (Canvas 2D + Vanilla JS ES Modules)
docs/          Design documents and implementation plans
```

## Tech Stack

**Backend**: Python, OpenCV, MediaPipe Hands / ONNX Runtime, FastAPI, WebSocket
**Frontend**: HTML5 Canvas 2D, WebSocket API, ES Modules

> The hand detection backend auto-switches between mediapipe (Python ≤3.12, faster) and ONNX Runtime (any Python version including 3.14+). See `backend/onnx_hand_detector.py`.
