import cv2
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
            self._initialized = True

    def start(self, device_id=0, width=640, height=480, fps=30):
        self._cap = cv2.VideoCapture(device_id, cv2.CAP_DSHOW)
        self._cap.set(cv2.CAP_PROP_FRAME_WIDTH, width)
        self._cap.set(cv2.CAP_PROP_FRAME_HEIGHT, height)
        self._cap.set(cv2.CAP_PROP_FPS, fps)
        if not self._cap.isOpened():
            raise RuntimeError(f"Cannot open camera device {device_id}")
        return self

    def read_frame(self):
        if self._cap is None:
            return None
        ret, frame = self._cap.read()
        if not ret:
            return None
        return cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)

    @property
    def is_opened(self):
        return self._cap is not None and self._cap.isOpened()

    def stop(self):
        if self._cap:
            self._cap.release()
            self._cap = None

    def __del__(self):
        self.stop()
