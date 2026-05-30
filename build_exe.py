"""
Build AR Gesture Writing into a distributable Windows installer.

Two-stage build:
  1. Build the app with PyInstaller --onedir  → dist/AR-Write/  (fast startup)
  2. Zip it, then bundle into a --onefile GUI installer → dist/AR-Write-Setup.exe

The installer is a proper Windows wizard (tkinter GUI):
  - Welcome page with notes
  - License agreement
  - Install path selection with disk-space check
  - Progress bar during extraction
  - Shortcut options + launch on completion

Usage:
    pip install pyinstaller
    python build_exe.py

Output:  dist/AR-Write-Setup.exe  (~150 MB, single-file installer)
"""

import os
import shutil
import subprocess
import sys
import zipfile

ROOT = os.path.dirname(os.path.abspath(__file__))
BACKEND = os.path.join(ROOT, "backend")
FRONTEND = os.path.join(ROOT, "frontend")
DIST = os.path.join(ROOT, "dist")

ICON = os.path.join(FRONTEND, "icon.png")
if not os.path.isfile(ICON):
    ICON = None


# ---------------------------------------------------------------------------
# Hidden imports — separate sets for app vs installer to keep setup.exe lean
# ---------------------------------------------------------------------------
APP_HIDDEN_IMPORTS = [
    # uvicorn internals
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
    # FastAPI & Starlette
    "fastapi",
    "fastapi.middleware",
    "fastapi.middleware.cors",
    "fastapi.responses",
    "fastapi.staticfiles",
    "starlette.middleware",
    "starlette.middleware.cors",
    "starlette.responses",
    "starlette.staticfiles",
    # ML / vision
    "onnxruntime",
    "onnxruntime.capi",
    "cv2",
    "numpy",
    # Backend modules (imported via sys.path at runtime)
    "hand_detector",
    "onnx_hand_detector",
    "camera",
    "server",
]

SETUP_HIDDEN_IMPORTS = [
    "tkinter",
    "tkinter.filedialog",
    "tkinter.messagebox",
    "tkinter.ttk",
]


# ---------------------------------------------------------------------------
# Shared helpers
# ---------------------------------------------------------------------------
def _collect_app_datas():
    """Build the --add-data list for the main app."""
    datas = [
        # Backend modules
        (os.path.join(BACKEND, "server.py"), "backend"),
        (os.path.join(BACKEND, "hand_detector.py"), "backend"),
        (os.path.join(BACKEND, "onnx_hand_detector.py"), "backend"),
        (os.path.join(BACKEND, "camera.py"), "backend"),
        # Frontend
        (os.path.join(FRONTEND, "index.html"), "frontend"),
        (os.path.join(FRONTEND, "css"), "frontend/css"),
        (os.path.join(FRONTEND, "js"), "frontend/js"),
    ]
    for fname in ("icon.png", "icon.svg", "icon-512.png"):
        p = os.path.join(FRONTEND, fname)
        if os.path.isfile(p):
            datas.append((p, "frontend"))

    # ONNX models
    models_dir = os.path.join(BACKEND, ".models")
    for name in ("hand_detector.onnx", "hand_landmarks_detector.onnx"):
        p = os.path.join(models_dir, name)
        if os.path.isfile(p):
            datas.append((p, "backend/.models"))

    return datas


def _pyinstaller(name, entry, hidden_imports, *, onefile=True, console=False,
                 extra_datas=None):
    """Run PyInstaller and return True on success."""
    cmd = [
        sys.executable, "-m", "PyInstaller",
        f"--name={name}",
        "--onedir" if not onefile else "--onefile",
        "--noconsole" if not console else "",
        "--clean",
    ]
    cmd = [a for a in cmd if a]

    if ICON:
        cmd += ["--icon", ICON]

    for imp in hidden_imports:
        cmd += ["--hidden-import", imp]

    datas = _collect_app_datas()
    if extra_datas:
        datas = datas + extra_datas
    for src, dst in datas:
        cmd += ["--add-data", f"{src}{os.pathsep}{dst}"]

    cmd.append(entry)

    print(f"  PyInstaller {name} ...")
    try:
        subprocess.run(cmd, cwd=ROOT, check=True)
        return True
    except subprocess.CalledProcessError:
        print(f"  ERROR: PyInstaller failed for {name}")
        return False


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------
def main():
    print("=" * 50)
    print("  AR Gesture Writing — Build Installer")
    print("=" * 50)
    print()

    # Clean
    for d in [os.path.join(ROOT, "build"), DIST]:
        if os.path.isdir(d):
            shutil.rmtree(d)
    for spec in ["AR-Write.spec", "AR-Write-Setup.spec"]:
        p = os.path.join(ROOT, spec)
        if os.path.isfile(p):
            os.remove(p)

    # ------------------------------------------------------------------
    # Stage 1 — Build the app (--onedir, fast startup after install)
    # ------------------------------------------------------------------
    print("[1/3] 构建主程序 (onedir, 启动快)...")
    print()

    entry_app = os.path.join(ROOT, "launcher.py")
    ok = _pyinstaller("AR-Write", entry_app, APP_HIDDEN_IMPORTS,
                       onefile=False, console=False)
    if not ok:
        sys.exit(1)

    app_dir = os.path.join(DIST, "AR-Write")
    app_exe = os.path.join(app_dir, "AR-Write.exe")
    if not os.path.isfile(app_exe):
        print(f"ERROR: {app_exe} not found — PyInstaller may have failed silently.")
        sys.exit(1)

    print(f"  -> {app_exe}")
    print()

    # ------------------------------------------------------------------
    # Stage 2 — Zip the app directory
    # ------------------------------------------------------------------
    print("[2/3] 打包为安装数据...")
    print()

    zip_path = os.path.join(DIST, "AR-Write.zip")
    with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED) as zf:
        for root, _dirs, files in os.walk(app_dir):
            for f in files:
                full = os.path.join(root, f)
                arcname = os.path.relpath(full, app_dir)
                zf.write(full, arcname)
    zip_mb = os.path.getsize(zip_path) / (1024 * 1024)
    print(f"  -> {zip_path}  ({zip_mb:.0f} MB)")
    print()

    # ------------------------------------------------------------------
    # Stage 3 — Build the GUI installer (--onefile, noconsole for clean look)
    # ------------------------------------------------------------------
    print("[3/3] 构建安装程序 (GUI 安装向导)...")
    print()

    setup_py = os.path.join(ROOT, "setup.py")
    ok = _pyinstaller(
        "AR-Write-Setup",
        setup_py,
        SETUP_HIDDEN_IMPORTS,
        onefile=True,
        console=False,
        extra_datas=[(zip_path, ".")],
    )
    if not ok:
        sys.exit(1)

    setup_exe = os.path.join(DIST, "AR-Write-Setup.exe")
    if not os.path.isfile(setup_exe):
        print(f"ERROR: {setup_exe} not found — PyInstaller may have failed silently.")
        sys.exit(1)

    size_mb = os.path.getsize(setup_exe) / (1024 * 1024)
    print()
    print("=" * 50)
    print("  构建完成！")
    print(f"  {setup_exe}")
    print(f"  大小: {size_mb:.0f} MB")
    print("=" * 50)
    print()
    print("将 AR-Write-Setup.exe 分发给用户。")
    print("用户双击运行后，GUI 安装向导会引导完成安装。")
    print("安装完成后从开始菜单或桌面快捷方式启动，秒开。")

    # Clean up intermediate files, keep only Setup.exe
    shutil.rmtree(os.path.join(ROOT, "build"), ignore_errors=True)
    for spec in ["AR-Write.spec", "AR-Write-Setup.spec"]:
        p = os.path.join(ROOT, spec)
        if os.path.isfile(p):
            os.remove(p)
    if os.path.isdir(app_dir):
        shutil.rmtree(app_dir)
    if os.path.isfile(zip_path):
        os.remove(zip_path)
    print()
    print("中间文件已清理，dist 目录只保留 AR-Write-Setup.exe")


if __name__ == "__main__":
    main()
