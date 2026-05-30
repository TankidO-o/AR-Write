# AR Write

> Write and draw in mid-air using hand gestures — no touch, no stylus, just your webcam.

## Getting Started

### System Requirements

- A Windows PC with a webcam (built-in or USB)
- Windows 10 or later (64-bit)

### Download and Install

1. Go to the [Releases](https://github.com/your-org/your-repo/releases) page
2. Download the latest `AR-Write-Setup.exe`
3. Double-click the installer and follow the guided wizard

The wizard walks you through the license agreement, install location, and creates Start Menu and Desktop shortcuts. No Python or other dependencies are required — everything is bundled into a single installer.

### Launch

After installation, launch AR Write from either:

- The **Start Menu** shortcut
- The **Desktop** shortcut

The app starts instantly and opens in your default browser.

## Gestures

| Gesture | Action | Notes |
|---------|--------|-------|
| Pinch thumb & index finger | **Write / Draw** | Green crosshair at index fingertip for precision |
| Spread all five fingers | **Region Erase** | Only erases stroke fragments within the circle |
| Pinch-and-release (quick) | **Undo** | Quick pulse without drawing |
| Fist (hold 1 second) | **Clear Canvas** | Ring progress bar shows countdown |

## Toolbar

The left sidebar has five sections:

| Section | Features |
|---------|----------|
| Colors | 6 preset swatches + color picker |
| Brush | Small / Medium / Large presets + fine slider (2–20 px) |
| Eraser | Small / Medium / Large presets (15 / 30 / 50 px) |
| Canvas | Undo, Redo, Clear, Save |
| Gestures | Guide, Calibrate, Custom Gestures |

Click the background button to cycle through **Camera**, **Blackboard**, and **Whiteboard** modes. The camera feed is hidden in blackboard and whiteboard modes.

## Custom Gestures

Click the gestures button in the toolbar to open the custom gesture panel:

- **Overwrite** existing built-in gestures with your own calibration data
- **Create** custom gestures (template matching, 3 samples each) and bind them to actions: set color, toggle brush/eraser size, undo, redo, clear, save, or cycle background
- Adjust per-gesture **sensitivity thresholds** (saved automatically)

## Visual Feedback

A three-layer feedback system keeps you informed of your current state:

| Layer | Position | Content |
|-------|----------|---------|
| Persistent | Top-right of canvas | Current gesture icon, name, and color/brush info |
| Progress | Center of canvas | Ring progress bar during countdown (clear canvas) |
| Transient | Top-center of canvas | Action confirmation messages, fade out after 1 second |

---

Powered by Python, OpenCV, and MediaPipe.
