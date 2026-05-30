"""
AR Gesture Writing -- Smart Launcher.

Handles environment detection, dependency checks, and platform
differences automatically.  Double-click or run from terminal.

Works in two modes:
  - Development:   python launcher.py
  - Packaged .exe: built with PyInstaller (self-contained, no Python needed)

Usage:
    python launcher.py                 # default: 127.0.0.1:8765
    AR-Write.exe                       # self-contained executable
    python launcher.py --host 0.0.0.0  # allow LAN access
    python launcher.py --port 8080     # custom port
    python launcher.py --no-browser    # don't open browser
"""

import os
import subprocess
import sys


# ---------------------------------------------------------------------------
# PyInstaller support -- when bundled, files are extracted to sys._MEIPASS
# ---------------------------------------------------------------------------
def _get_root() -> str:
    """Return the project root directory (works in dev and PyInstaller modes)."""
    if getattr(sys, "frozen", False):
        # Running inside a PyInstaller bundle
        return sys._MEIPASS  # type: ignore[attr-defined]
    return os.path.dirname(os.path.abspath(__file__))


def _get_backend_dir() -> str:
    return os.path.join(_get_root(), "backend")


def _get_server_py() -> str:
    return os.path.join(_get_backend_dir(), "server.py")


# ---------------------------------------------------------------------------
# Environment checks (skipped in PyInstaller mode -- all deps are bundled)
# ---------------------------------------------------------------------------

def _check_python_version():
    major, minor = sys.version_info[:2]
    if (major, minor) < (3, 10):
        print("ERROR: Python 3.10+ required (you have %d.%d)." % (major, minor))
        print("Download: https://www.python.org/downloads/")
        sys.exit(1)
    if (major, minor) == (3, 14):
        print("NOTE: Python 3.14 detected -- will use the ONNX Runtime backend.")
        print("      Make sure you ran `python convert_models.py` first.")
        print()


def _check_critical_deps():
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
    # Try mediapipe
    try:
        __import__("mediapipe")
        return
    except ImportError:
        pass

    # Try onnxruntime + ONNX models
    try:
        import onnxruntime  # noqa: F401
        backend_dir = _get_backend_dir()
        models_dir = os.path.join(backend_dir, ".models")
        det = os.path.join(models_dir, "hand_detector.onnx")
        ldm = os.path.join(models_dir, "hand_landmarks_detector.onnx")
        if os.path.isfile(det) and os.path.isfile(ldm):
            return

        print("ERROR: No hand-detection backend available.")
        print()
        print("Option A (recommended) -- Install mediapipe:")
        print("  pip install mediapipe>=0.10.14")
        print()
        print("Option B -- Use ONNX Runtime (works on Python 3.14+):")
        print("  pip install onnxruntime")
        print("  cd backend")
        print("  python convert_models.py")
        sys.exit(1)

    except ImportError:
        pass

    print("ERROR: No hand-detection backend available.")
    print()
    print("Install one of:")
    print("  pip install mediapipe>=0.10.14         (Python <= 3.12)")
    print("  pip install onnxruntime && cd backend && python convert_models.py  (any Python)")
    sys.exit(1)


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main():
    is_frozen = getattr(sys, "frozen", False)

    if is_frozen:
        print("AR Gesture Writing (self-contained)")
    else:
        print("AR Gesture Writing -- Launcher")
    print("-" * 32)

    if not is_frozen:
        _check_python_version()
        _check_critical_deps()
        _check_backend()

    if is_frozen:
        # Running inside PyInstaller — run server.py in-process to avoid
        # spawning another copy of this .exe (which would re-enter launcher
        # and create an infinite fork bomb).
        backend_dir = _get_backend_dir()
        sys.path.insert(0, backend_dir)
        # Patch sys.argv so server.py's argparse picks up user flags
        import server  # type: ignore[import-not-found]
        server.main()
    else:
        server_py = _get_server_py()
        if not os.path.isfile(server_py):
            print(f"ERROR: {server_py} not found.")
            print("Make sure the 'backend/' directory is present.")
            sys.exit(1)
        # Forward all arguments to server.py
        args = [sys.executable, server_py] + sys.argv[1:]
        subprocess.run(args, cwd=_get_backend_dir())


if __name__ == "__main__":
    main()
