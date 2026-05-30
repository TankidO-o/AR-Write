# AR-Write

**Gesture-based air-writing system** -- write, erase, undo, and clear the canvas using hand gestures captured by your webcam. No keyboard, no mouse, no touchscreen required.

---

## Getting Started

### Download and Install

1. Go to the [GitHub Releases](https://github.com/TankidO-o/AR-Write/releases) page
2. Download the latest **`AR-Write-Setup.exe`**
3. Double-click the installer and follow the setup wizard

That is it -- the installer bundles everything the app needs. No Python, no drivers, no extra steps.

### System Requirements

- **Windows** (10 or later)
- **Webcam** (built-in or USB)
- No special hardware, no GPU required

### Launching the App

After installation, launch AR-Write from either:

- The **Start Menu** shortcut: `AR-Write`
- The **Desktop** shortcut: `AR-Write`

The app opens in your default browser. Grant camera permission when prompted, and you are ready to write.

---

## Gestures

| Gesture | Action | What Happens |
|---|---|---|
| Pinch: thumb + index finger together | **Write** | Starts drawing immediately. A green crosshair at your fingertip helps you aim. |
| Five fingers spread open | **Area Erase** | Erases stroke segments inside a circular zone. Entire lines stay intact unless the circle touches them. |
| Fist held for 1 second | **Clear Canvas** | A ring-shaped progress indicator fills up; release before it completes to cancel, hold through to wipe the canvas. |
| Quick pinch-then-spread pulse | **Undo** | Reverts the most recent stroke. Fast pinch-and-release (no writing motion). |

---

## Toolbar

A vertical card-style toolbar sits on the left side of the screen, organized into five sections:

| Section | Controls |
|---|---|
| **Color** | 6 preset swatches plus a color picker |
| **Brush** | S / M / L quick presets plus a slider (2--20 px) |
| **Eraser** | Small / Medium / Large presets (15 / 30 / 50 px) |
| **Canvas** | Undo -- Redo -- Clear -- Screenshot |
| **Gestures** | Help guide -- Calibration -- Custom gestures |

Click the background toggle button to cycle between **camera view**, **blackboard**, and **whiteboard** modes. In blackboard/whiteboard mode the camera feed is hidden automatically.

---

## Custom Gestures

Open the custom gesture panel from the toolbar (the lightning bolt icon):

- **Override** built-in gestures with your own calibration data (10 samples)
- **Create** new gestures via template matching (3 samples), then bind them to any of 8 actions: switch color, change brush/eraser size, undo, redo, clear canvas, save screenshot, or toggle background
- **Adjust** the detection threshold per gesture (40--95) and save to local storage

---

## Visual Feedback

Three layers of feedback keep you informed at all times:

| Layer | Position | Shows |
|---|---|---|
| L1 (persistent) | Top-right of canvas | Current gesture icon, name, color, and brush info |
| L2 (progress) | Center of canvas | Ring-shaped countdown timer (clear-canvas hold) |
| L3 (transient) | Top of canvas | Action confirmation toast, fades out after 1 second |

---

## Technology

Built with Python, OpenCV, and MediaPipe hand tracking. Renders via HTML5 Canvas in the browser.
