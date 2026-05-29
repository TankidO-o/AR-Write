# AR Gesture Writing System

> An AR gesture-based writing and drawing system powered by computer vision. Use hand gestures in mid-air to write, erase, undo, and clear the canvas — no touch, no stylus, just your webcam.

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

# (ONNX backend only — first time setup) Convert the hand detection model
python convert_models.py
```

> **Python 3.14 users**: mediapipe does not have 3.14 wheels yet. The system auto‑falls back to the ONNX Runtime backend. Install `onnxruntime onnx opencv-python fastapi uvicorn`, then run `python convert_models.py` once to generate the ONNX models.

**Windows**: Double-click the launcher files in the project root:

| File | Description |
|------|-------------|
| `start_backend.bat` | Start backend (WebSocket + Camera) |
| `start_frontend.bat` | Start frontend (HTTP static server) |
| `start_all.bat` | One-click launch both + open browser |

**Manual launch**:

```bash
# Terminal 1 - Backend
cd backend
python server.py

# Terminal 2 - Frontend
cd frontend
python -m http.server 8080
```

Open `http://localhost:8080` in your browser. A gesture guide overlay appears on first launch (click `?` to re-open anytime).

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
| 📋 Canvas | ↩ Undo · ↪ Redo · ✕ Clear · 💾 Save |
| ⚡ Gestures | ? Guide · ⚙ Calibrate · ⚡ Custom Gestures |

Click 🖼️ to cycle through **Camera / Blackboard / Whiteboard** modes. The camera feed is hidden in blackboard and whiteboard modes.

## Custom Gestures

Click the ⚡ button in the toolbar to open the custom gesture panel:

- **Overwrite** existing built-in gestures with your own calibration data (10 samples each)
- **Create** custom gestures with template matching (3 samples each) — bind to any of 8 action types
- Adjust per-gesture **thresholds** (40–95) and save to localStorage

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
backend/    Python backend (OpenCV + MediaPipe + FastAPI)
frontend/   Web frontend (Canvas 2D + Vanilla JS ES Modules)
docs/       Design documents and implementation plans
```

## Tech Stack

**Backend**: Python, OpenCV, MediaPipe Hands / ONNX Runtime, FastAPI, WebSocket
**Frontend**: HTML5 Canvas 2D, WebSocket API, ES Modules

> The hand detection backend auto‑switches between mediapipe (Python ≤3.12, faster) and ONNX Runtime (any Python version including 3.14+). See `backend/onnx_hand_detector.py`.
