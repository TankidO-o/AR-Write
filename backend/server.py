"""
AR Gesture Writing System -- unified backend + frontend server.

Serves:
  - WebSocket hand-tracking stream   ws://host:port/ws
  - REST API                         http://host:port/health, /frame, /shutdown
  - Frontend SPA                     http://host:port/

Usage:
    python server.py                       # default: 127.0.0.1:8765
    python server.py --host 0.0.0.0        # allow LAN access
    python server.py --port 8080           # custom port
    python server.py --shutdown-timeout 5  # quit 5s after last client disconnects
    python server.py --no-browser          # don't open browser
    python server.py --no-shutdown         # never auto-shutdown
"""

import argparse
import asyncio
import json
import logging
import os
import sys
import threading
import time
import webbrowser

import cv2
import uvicorn
from fastapi import FastAPI, WebSocket
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, HTMLResponse, Response
from fastapi.staticfiles import StaticFiles

from camera import Camera
from hand_detector import HandDetector

# Keep logging quiet -- only show errors from noisy libraries
# ---------------------------------------------------------------------------
# Fix: when packaged with --noconsole, sys.stdout/stderr can be None,
# which breaks uvicorn's logging config (it calls .isatty() on the stream).
for _attr in ("stdout", "stderr"):
    if getattr(sys, _attr) is None:
        setattr(sys, _attr, open(os.devnull, "w"))

logging.getLogger("uvicorn").setLevel(logging.WARNING)
logging.getLogger("onnxruntime").setLevel(logging.ERROR)

# ---------------------------------------------------------------------------
# Paths (PyInstaller-aware — uses sys._MEIPASS when bundled)
# ---------------------------------------------------------------------------
if getattr(sys, "frozen", False):
    # Running inside a PyInstaller bundle
    _ROOT_DIR = sys._MEIPASS  # type: ignore[attr-defined]
else:
    _ROOT_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

_BACKEND_DIR = os.path.join(_ROOT_DIR, "backend")
_FRONTEND_DIR = os.path.join(_ROOT_DIR, "frontend")

# ---------------------------------------------------------------------------
# App
# ---------------------------------------------------------------------------
app = FastAPI(title="AR Gesture Writing", version="1.0.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

camera = Camera()
detector = HandDetector()

_latest_jpeg: bytes | None = None
_jpeg_lock = threading.Lock()

# Auto-shutdown tracking
_connected_clients: set[WebSocket] = set()
_shutdown_event: asyncio.Event | None = None
_shutdown_timeout: float = 10.0
_enable_auto_shutdown: bool = True


# ---------------------------------------------------------------------------
# WebSocket -- hand tracking stream
# ---------------------------------------------------------------------------
@app.websocket("/ws")
async def websocket_endpoint(ws: WebSocket):
    await ws.accept()
    _connected_clients.add(ws)

    # Cancel any pending shutdown when a client connects
    global _shutdown_event
    if _shutdown_event:
        _shutdown_event.set()

    running = True
    last_frame_time = time.time()
    frame_count = 0
    fail_count = 0
    fps = 0.0
    # Frame-skip hand detection to reduce CPU — MediaPipe/ONNX inference is
    # the bottleneck.  Detection runs every N frames; intermediate frames
    # reuse the previous result.  This roughly halves CPU at the cost of a
    # ~1-frame detection lag (imperceptible at 30 fps).
    _detect_every_n = 2
    _cached_hand = None  # type: ignore[assignment]

    async def handle_incoming():
        try:
            while running:
                raw = await ws.receive_text()
                msg = json.loads(raw)
                if msg.get("type") == "ping":
                    await ws.send_json({"type": "pong"})
        except Exception:
            pass

    recv_task = asyncio.create_task(handle_incoming())

    try:
        while running:
            frame_start = time.time()

            frame = await asyncio.to_thread(camera.read_frame)
            if frame is None:
                fail_count += 1
                backoff = min(0.001 * (2 ** min(fail_count, 10)), 0.1)
                await asyncio.sleep(backoff)
                continue
            fail_count = 0

            # Encode JPEG preview
            _, jpeg = cv2.imencode(
                ".jpg",
                cv2.cvtColor(frame, cv2.COLOR_RGB2BGR),
                [cv2.IMWRITE_JPEG_QUALITY, 60],
            )
            with _jpeg_lock:
                global _latest_jpeg
                _latest_jpeg = jpeg.tobytes()

            timestamp_ms = int(time.time() * 1000)

            # Skip hand detection on some frames to save CPU
            if frame_count % _detect_every_n == 0:
                hand_data = await asyncio.to_thread(detector.detect, frame, timestamp_ms)
                _cached_hand = hand_data
            else:
                hand_data = _cached_hand

            frame_count += 1
            now = time.time()
            elapsed = now - last_frame_time
            if elapsed >= 1.0:
                fps = round(frame_count / elapsed, 1)
                frame_count = 0
                last_frame_time = now

            payload = {
                "timestamp": round(time.time(), 3),
                "fps": fps,
                "hand": hand_data,
            }

            try:
                await ws.send_json(payload)
            except Exception:
                break

            frame_time = time.time() - frame_start
            target_frame_time = 1.0 / 30
            if frame_time < target_frame_time:
                await asyncio.sleep(target_frame_time - frame_time)

    except Exception as e:
        print(f"WebSocket error: {e}")
    finally:
        running = False
        recv_task.cancel()
        try:
            await recv_task
        except asyncio.CancelledError:
            pass
        _connected_clients.discard(ws)
        try:
            await ws.close()
        except Exception:
            pass

        # Start auto-shutdown countdown when last client leaves
        if _enable_auto_shutdown and not _connected_clients:
            asyncio.create_task(_auto_shutdown())


async def _auto_shutdown():
    """Wait a grace period, then stop the server if no client reconnected."""
    global _shutdown_event
    _shutdown_event = asyncio.Event()

    try:
        await asyncio.wait_for(_shutdown_event.wait(), timeout=_shutdown_timeout)
        # Client reconnected -- cancel shutdown
        _shutdown_event = None
    except asyncio.TimeoutError:
        # No client reconnected -- shut down
        print("\nAll clients disconnected. Shutting down ...")
        # Give uvicorn a moment to finish pending writes, then stop
        await asyncio.sleep(0.5)
        os._exit(0)


# ---------------------------------------------------------------------------
# REST API
# ---------------------------------------------------------------------------
@app.get("/health")
async def health():
    return {"status": "ok", "camera": camera.is_opened}


@app.get("/frame")
async def get_frame():
    with _jpeg_lock:
        if _latest_jpeg is None:
            return Response(status_code=204)
        return Response(content=_latest_jpeg, media_type="image/jpeg")


@app.post("/shutdown")
async def shutdown():
    """Explicit shutdown endpoint -- called by frontend on tab close."""
    print("Shutdown requested via API.")
    threading.Thread(target=lambda: time.sleep(0.5) or os._exit(0), daemon=True).start()
    return {"status": "shutting down"}


# ---------------------------------------------------------------------------
# Frontend SPA
# ---------------------------------------------------------------------------
@app.get("/")
async def index():
    index_path = os.path.join(_FRONTEND_DIR, "index.html")
    if os.path.isfile(index_path):
        return HTMLResponse(open(index_path, encoding="utf-8").read())
    return HTMLResponse("<h1>Frontend not found</h1>", status_code=404)


# ---------------------------------------------------------------------------
# Startup
# ---------------------------------------------------------------------------
def _open_browser(url: str, delay: float = 1.5):
    time.sleep(delay)
    try:
        webbrowser.open(url)
    except Exception:
        pass


def main():
    global _shutdown_timeout, _enable_auto_shutdown

    parser = argparse.ArgumentParser(description="AR Gesture Writing Server")
    parser.add_argument("--host", default="127.0.0.1", help="Listen address")
    parser.add_argument("--port", type=int, default=8765, help="Listen port")
    parser.add_argument("--no-browser", action="store_true", help="Don't open browser")
    parser.add_argument(
        "--shutdown-timeout",
        type=float,
        default=10.0,
        help="Seconds to wait after last client disconnects (default: 10)",
    )
    parser.add_argument(
        "--no-shutdown",
        action="store_true",
        help="Never auto-shutdown (keep running after browser closes)",
    )
    args = parser.parse_args()

    _shutdown_timeout = args.shutdown_timeout
    _enable_auto_shutdown = not args.no_shutdown

    # Mount frontend static assets
    if os.path.isdir(_FRONTEND_DIR):
        app.mount("/css", StaticFiles(directory=os.path.join(_FRONTEND_DIR, "css")), name="css")
        app.mount("/js", StaticFiles(directory=os.path.join(_FRONTEND_DIR, "js")), name="js")
        for fname in ("icon.png", "icon.svg", "icon-512.png"):
            fpath = os.path.join(_FRONTEND_DIR, fname)
            if os.path.isfile(fpath):

                async def _icon_handler(_p=fpath):
                    return FileResponse(_p)

                app.get(f"/{fname}")(_icon_handler)

    url = f"http://{args.host}:{args.port}"
    if args.host == "0.0.0.0":
        url = f"http://127.0.0.1:{args.port}"

    print("=" * 50)
    print("  AR Gesture Writing System")
    print("=" * 50)
    print(f"  Address:    {url}")
    print(f"  Backend:    {'MediaPipe' if 'MediaPipe' in type(detector).__name__ else 'ONNX Runtime'}")
    if _enable_auto_shutdown:
        print(f"  Auto-quit:  {_shutdown_timeout}s after browser closes")
    print("=" * 50)

    if not args.no_browser:
        threading.Thread(target=_open_browser, args=(url,), daemon=True).start()

    try:
        camera.start()
        uvicorn.run(app, host=args.host, port=args.port, log_level="warning")
    finally:
        camera.stop()
        detector.close()
        print("Shutdown complete.")


if __name__ == "__main__":
    main()
