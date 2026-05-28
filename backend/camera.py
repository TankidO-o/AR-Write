import cv2
import sys
import threading

class Camera:
    _instance = None
    _lock = threading.Lock()

    def __new__(cls):
        if cls._instance is None:
            with cls._lock:
                if cls._instance is None:
                    cls._instance = super().__new__(cls)
        return cls._instance

    def __init__(self):
        if not hasattr(self, '_initialized'):
            self._cap = None
            self._cap_lock = threading.Lock()
            self._initialized = True

    def start(self, device_id=0, width=640, height=480, fps=30):
        with self._cap_lock:
            self._release_cap()
            backend = cv2.CAP_DSHOW if sys.platform == 'win32' else cv2.CAP_ANY
            self._cap = cv2.VideoCapture(device_id, backend)
            self._cap.set(cv2.CAP_PROP_FRAME_WIDTH, width)
            self._cap.set(cv2.CAP_PROP_FRAME_HEIGHT, height)
            self._cap.set(cv2.CAP_PROP_FPS, fps)
            if not self._cap.isOpened():
                self._cap.release()
                self._cap = None
                raise RuntimeError(f"Cannot open camera device {device_id}")
        return self

    def read_frame(self):
        with self._cap_lock:
            if self._cap is None:
                return None
            ret, frame = self._cap.read()
            if not ret:
                return None
            return cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)

    @property
    def is_opened(self):
        with self._cap_lock:
            return self._cap is not None and self._cap.isOpened()

    def stop(self):
        with self._cap_lock:
            self._release_cap()

    def _release_cap(self):
        if self._cap:
            self._cap.release()
            self._cap = None

    def __del__(self):
        self.stop()
