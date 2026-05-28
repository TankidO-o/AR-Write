# AR Gesture Writing System

> An AR gesture-based writing and drawing system powered by computer vision. Use hand gestures in mid-air to write, erase, undo, switch colors, and clear the canvas — no touch, no stylus, just your webcam.

## Quick Start

### Prerequisites
- Python 3.10+ (conda recommended)
- A computer with a webcam
- Modern browser (Chrome/Edge 90+)

### Installation & Launch

```bash
# Create conda environment (optional)
conda create -n ar-gesture python=3.10 -y
conda activate ar-gesture

# Install Python dependencies
cd backend
pip install -r requirements.txt
```

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

Open `http://localhost:8080` in your browser.

## Gestures

| Gesture | Action |
|---------|--------|
| Pinch thumb & index finger | Write |
| Spread all five fingers | Erase |
| Fist (hold 1 second) | Clear canvas |
| Pinch thumb & middle finger | Switch color |
| Peace sign (hold 1 second) | Undo |

## Custom Gestures

Click the ⚡ button in the toolbar to open the custom gesture panel. You can:

- **Overwrite** existing built-in gestures with your own calibration data (10 samples each)
- **Create** custom gestures with template matching (3 samples each)
- Adjust per-gesture **thresholds** (40–95) and save to localStorage

## Project Structure

```
backend/    Python backend (OpenCV + MediaPipe + FastAPI)
frontend/   Web frontend (Canvas 2D + Vanilla JS)
docs/       Design documents and implementation plan
```

## Tech Stack

**Backend**: Python, OpenCV, MediaPipe Hands, FastAPI, WebSocket
**Frontend**: HTML5 Canvas 2D, WebSocket API, getUserMedia
