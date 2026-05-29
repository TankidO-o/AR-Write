"""
AR Gesture Writing System — unified backend + frontend server.

Serves:
  - WebSocket hand‑tracking stream   ws://host:port/ws
  - REST API                         http://host:port/health, /frame
  - Frontend SPA                     http://host:port/

Usage:
    python server.py                 # default: 127.0.0.1:8765
    python server.py --host 0.0.0.0 --port 80
"""

import argparse
import asyncio
import json
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

# ---------------------------------------------------------------------------
# Paths
# ---------------------------------------------------------------------------
_BACKEND_DIR = os.path.dirname(os.path.abspath(__file__))
_FRONTEND_DIR = os.path.join(os.path.dirname(_BACKEND_DIR), "frontend")

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


# ---------------------------------------------------------------------------
# WebSocket — hand tracking stream
# ---------------------------------------------------------------------------
@app.websocket("/ws")
async def websocket_endpoint(ws: WebSocket):
    await ws.accept()
    running = True
    last_frame_time = time.time()
    frame_count = 0
    fail_count = 0
    fps = 0.0

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
            hand_data = await asyncio.to_thread(detector.detect, frame, timestamp_ms)

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
        try:
            await ws.close()
        except Exception:
            pass


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


# ---------------------------------------------------------------------------
# Frontend SPA
# ---------------------------------------------------------------------------
@app.get("/")
async def index():
    """Serve the SPA entry point."""
    index_path = os.path.join(_FRONTEND_DIR, "index.html")
    if os.path.isfile(index_path):
        return HTMLResponse(open(index_path, encoding="utf-8").read())
    return HTMLResponse("<h1>Frontend not found</h1>", status_code=404)


# ---------------------------------------------------------------------------
# Startup
# ---------------------------------------------------------------------------
def _open_browser(url: str, delay: float = 1.5):
    """Open the browser after a short delay (non‑blocking)."""
    time.sleep(delay)
    try:
        webbrowser.open(url)
    except Exception:
        pass


def main():
    parser = argparse.ArgumentParser(description="AR Gesture Writing Server")
    parser.add_argument("--host", default="127.0.0.1", help="Listen address")
    parser.add_argument("--port", type=int, default=8765, help="Listen port")
    parser.add_argument("--no-browser", action="store_true", help="Don't open browser")
    args = parser.parse_args()

    # Mount frontend static assets (CSS, JS, icons)
    if os.path.isdir(_FRONTEND_DIR):
        app.mount("/css", StaticFiles(directory=os.path.join(_FRONTEND_DIR, "css")), name="css")
        app.mount("/js", StaticFiles(directory=os.path.join(_FRONTEND_DIR, "js")), name="js")
        # Serve icon files individually
        for fname in ("icon.png", "icon.svg", "icon-512.png"):
            fpath = os.path.join(_FRONTEND_DIR, fname)
            if os.path.isfile(fpath):

                async def _icon_handler(_p=fpath):
                    return FileResponse(_p)

                app.get(f"/{fname}")(_icon_handler)

    url = f"http://{args.host}:{args.port}"
    if args.host == "0.0.0.0":
        url = f"http://127.0.0.1:{args.port}"

    print("=" * 54)
    print("  AR Gesture Writing System")
    print("=" * 54)
    print(f"  Server:   {url}")
    print(f"  WebSocket: ws://127.0.0.1:{args.port}/ws")
    print(f"  Frontend: embedded (no separate HTTP server)")
    print(f"  Backend:  {'MediaPipe' if 'MediaPipe' in type(detector).__name__ else 'ONNX Runtime'}")
    print("=" * 54)

    if not args.no_browser:
        threading.Thread(target=_open_browser, args=(url,), daemon=True).start()

    try:
        camera.start()
        print("Camera started.")
        uvicorn.run(app, host=args.host, port=args.port, log_level="warning")
    finally:
        camera.stop()
        detector.close()
        print("Shutdown complete.")


if __name__ == "__main__":
    main()
