"""
Build AR-Write into a standalone Windows .exe using PyInstaller.

The resulting executable bundles Python, ONNX Runtime, OpenCV, FastAPI,
and the frontend — no Python installation required for end users.

Usage:
    pip install pyinstaller
    python build_exe.py

Output:  dist/AR-Write.exe  (single-file, ~150 MB)
"""

import os
import subprocess
import sys

ROOT = os.path.dirname(os.path.abspath(__file__))
BACKEND = os.path.join(ROOT, "backend")
FRONTEND = os.path.join(ROOT, "frontend")

# Icon — use the project SVG converted to ICO, or fall back to default
ICON = os.path.join(FRONTEND, "icon.png")
if not os.path.isfile(ICON):
    ICON = None


def main():
    print("Building AR-Write.exe ...")
    print()

    # ------------------------------------------------------------------
    # Collect hidden imports that PyInstaller might miss
    # ------------------------------------------------------------------
    hidden_imports = [
        "uvicorn.logging",
        "uvicorn.loops",
        "uvicorn.loops.auto",
        "uvicorn.protocols",
        "uvicorn.protocols.http",
        "uvicorn.protocols.http.auto",
        "uvicorn.protocols.websockets",
        "uvicorn.protocols.websockets.auto",
        "uvicorn.lifespan",
        "uvicorn.lifespan.on",
        "fastapi",
        "onnxruntime",
        "onnxruntime.capi",
        "cv2",
        "numpy",
        "hand_detector",
        "onnx_hand_detector",
        "camera",
    ]

    # ------------------------------------------------------------------
    # Data files to bundle inside the exe
    # ------------------------------------------------------------------
    datas = [
        # Frontend static files
        (os.path.join(FRONTEND, "index.html"), "frontend"),
        (os.path.join(FRONTEND, "css"), "frontend/css"),
        (os.path.join(FRONTEND, "js"), "frontend/js"),
    ]
    # Icon files (optional)
    for fname in ("icon.png", "icon.svg", "icon-512.png"):
        p = os.path.join(FRONTEND, fname)
        if os.path.isfile(p):
            datas.append((p, "frontend"))

    # ONNX models (if pre-built — so users don't need convert_models.py)
    models_dir = os.path.join(BACKEND, ".models")
    det_onnx = os.path.join(models_dir, "hand_detector.onnx")
    ldm_onnx = os.path.join(models_dir, "hand_landmarks_detector.onnx")
    if os.path.isfile(det_onnx) and os.path.isfile(ldm_onnx):
        datas.append((det_onnx, "backend/.models"))
        datas.append((ldm_onnx, "backend/.models"))
        print("  Including ONNX models (pre-converted).")
    else:
        print("  WARNING: ONNX models not found — run convert_models.py first.")
        print("  The exe will still work if mediapipe is installed.")

    # ------------------------------------------------------------------
    # Build the PyInstaller command
    # ------------------------------------------------------------------
    cmd = [
        sys.executable, "-m", "PyInstaller",
        "--name=AR-Write",
        "--onefile",
        "--noconsole",
        "--clean",
        "--add-data", f"{os.path.join(BACKEND, 'server.py')}{os.pathsep}backend",
        "--add-data", f"{os.path.join(BACKEND, 'hand_detector.py')}{os.pathsep}backend",
        "--add-data", f"{os.path.join(BACKEND, 'onnx_hand_detector.py')}{os.pathsep}backend",
        "--add-data", f"{os.path.join(BACKEND, 'camera.py')}{os.pathsep}backend",
    ]

    if ICON:
        cmd += ["--icon", ICON]

    for imp in hidden_imports:
        cmd += ["--hidden-import", imp]

    for src, dst in datas:
        cmd += ["--add-data", f"{src}{os.pathsep}{dst}"]

    # Entry point
    entry = os.path.join(ROOT, "launcher.py")
    cmd.append(entry)

    print("  Running PyInstaller ...")
    print(f"  {' '.join(cmd[:6])} ...")
    subprocess.run(cmd, cwd=ROOT, check=True)

    print()
    print("=" * 56)
    print("  Build complete!")
    print(f"  {os.path.join(ROOT, 'dist', 'AR-Write.exe')}")
    print("=" * 56)
    print()
    print("Distribute AR-Write.exe to end users.")
    print("They do NOT need Python, pip, or any dependencies.")


if __name__ == "__main__":
    main()
