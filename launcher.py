"""
AR Gesture Writing — Smart Launcher.

Handles environment detection, dependency checks, and platform
differences automatically.  Double‑click or run from terminal.

Usage:
    python launcher.py                 # default: 127.0.0.1:8765
    python launcher.py --host 0.0.0.0  # allow LAN access
    python launcher.py --port 8080     # custom port
    python launcher.py --no-browser    # don't open browser
"""

import os
import subprocess
import sys


# ---------------------------------------------------------------------------
# Environment checks
# ---------------------------------------------------------------------------

def _check_python_version():
    """Warn if the Python version is unsupported or has known issues."""
    major, minor = sys.version_info[:2]
    if (major, minor) < (3, 10):
        print("ERROR: Python 3.10+ required (you have %d.%d)." % (major, minor))
        print("Download: https://www.python.org/downloads/")
        sys.exit(1)
    if (major, minor) == (3, 14):
        print("NOTE: Python 3.14 detected — will use the ONNX Runtime backend.")
        print("      Make sure you ran `python convert_models.py` first.")
        print()


def _check_critical_deps():
    """Verify the minimum required packages are installed."""
    missing = []
    for pkg, import_name in [
        ("opencv-python", "cv2"),
        ("fastapi", "fastapi"),
        ("uvicorn", "uvicorn"),
    ]:
        try:
            __import__(import_name)
        except ImportError:
            missing.append(pkg)

    if missing:
        print("ERROR: Required packages are missing:")
        for m in missing:
            print("  - %s" % m)
        print()
        print("Install them with:")
        print("  cd backend")
        print("  pip install -r requirements.txt")
        sys.exit(1)


def _check_backend():
    """Ensure at least one hand‑detection backend is available."""
    # Try mediapipe
    try:
        __import__("mediapipe")
        return  # mediapipe available — good
    except ImportError:
        pass

    # Try onnxruntime + ONNX models
    try:
        import onnxruntime  # noqa: F401
        backend_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), "backend")
        models_dir = os.path.join(backend_dir, ".models")
        det = os.path.join(models_dir, "hand_detector.onnx")
        ldm = os.path.join(models_dir, "hand_landmarks_detector.onnx")
        if os.path.isfile(det) and os.path.isfile(ldm):
            return  # ONNX models exist — good

        print("ERROR: No hand‑detection backend available.")
        print()
        print("Option A (recommended) — Install mediapipe:")
        print("  pip install mediapipe>=0.10.14")
        print()
        print("Option B — Use ONNX Runtime (works on Python 3.14+):")
        print("  pip install onnxruntime")
        print("  cd backend")
        print("  python convert_models.py")
        sys.exit(1)

    except ImportError:
        pass

    print("ERROR: No hand‑detection backend available.")
    print()
    print("Install one of:")
    print("  pip install mediapipe>=0.10.14         (Python <= 3.12)")
    print("  pip install onnxruntime && cd backend && python convert_models.py  (any Python)")
    sys.exit(1)


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main():
    print("AR Gesture Writing — Launcher")
    print("-" * 32)

    _check_python_version()
    _check_critical_deps()
    _check_backend()

    backend_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), "backend")
    server_py = os.path.join(backend_dir, "server.py")

    if not os.path.isfile(server_py):
        print(f"ERROR: {server_py} not found.")
        print("Make sure the 'backend/' directory is present.")
        sys.exit(1)

    # Forward all arguments to server.py
    args = [sys.executable, server_py] + sys.argv[1:]
    subprocess.run(args, cwd=backend_dir)


if __name__ == "__main__":
    main()
