import asyncio
import json
import time
from fastapi import FastAPI, WebSocket
from fastapi.middleware.cors import CORSMiddleware
from camera import Camera
from hand_detector import HandDetector
import uvicorn

app = FastAPI()
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])

camera = Camera()
detector = HandDetector()

@app.websocket("/ws")
async def websocket_endpoint(ws: WebSocket):
    await ws.accept()
    running = True
    last_frame_time = time.time()
    frame_count = 0
    fail_count = 0
    fps = 0.0

    # Handle incoming messages (heartbeat pings)
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

@app.get("/health")
async def health():
    return {"status": "ok", "camera": camera.is_opened}

def main():
    try:
        camera.start()
        print("Camera started")
        uvicorn.run(app, host="127.0.0.1", port=8765, log_level="info")
    finally:
        camera.stop()
        detector.close()
        print("Shutdown complete")

if __name__ == "__main__":
    main()
