import mediapipe as mp
from mediapipe.tasks import python
from mediapipe.tasks.python import vision
import os
import urllib.request

_HAND_LANDMARKER_MODEL_URL = (
    "https://storage.googleapis.com/mediapipe-models/"
    "hand_landmarker/hand_landmarker/float16/latest/hand_landmarker.task"
)

def _download_default_model():
    cache_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), ".models")
    os.makedirs(cache_dir, exist_ok=True)
    model_path = os.path.join(cache_dir, "hand_landmarker.task")
    if not os.path.exists(model_path):
        print(f"Downloading hand landmarker model to {model_path} ...")
        urllib.request.urlretrieve(_HAND_LANDMARKER_MODEL_URL, model_path)
    return model_path

class HandDetector:
    def __init__(self, model_path=None, min_detection_confidence=0.5, min_tracking_confidence=0.5):
        if model_path is None:
            model_path = _download_default_model()
        base_options = python.BaseOptions(model_asset_path=model_path)
        options = vision.HandLandmarkerOptions(
            base_options=base_options,
            running_mode=vision.RunningMode.VIDEO,
            num_hands=1,
            min_hand_detection_confidence=min_detection_confidence,
            min_tracking_confidence=min_tracking_confidence,
        )
        self._detector = vision.HandLandmarker.create_from_options(options)
        self._locked_handedness = None

    def detect(self, rgb_frame, timestamp_ms=0):
        mp_image = mp.Image(image_format=mp.ImageFormat.SRGB, data=rgb_frame)
        result = self._detector.detect_for_video(mp_image, timestamp_ms)

        if not result.hand_landmarks:
            self._locked_handedness = None
            return None

        hand_index = self._select_hand(result)
        if hand_index is None:
            return None

        landmarks = result.hand_landmarks[hand_index]
        keypoints = []
        for i, lm in enumerate(landmarks):
            keypoints.append({"id": i, "x": round(lm.x, 4), "y": round(lm.y, 4), "z": round(lm.z, 4)})

        wrist = landmarks[0]
        middle_mcp = landmarks[9]
        palm_center = {
            "x": round((wrist.x + middle_mcp.x) / 2, 4),
            "y": round((wrist.y + middle_mcp.y) / 2, 4),
        }

        return {
            "handedness": result.handedness[hand_index][0].category_name,
            "keypoints": keypoints,
            "palm_center": palm_center,
        }

    def _select_hand(self, result):
        if self._locked_handedness is None:
            self._locked_handedness = result.handedness[0][0].category_name
            return 0
        for i, h in enumerate(result.handedness):
            if h[0].category_name == self._locked_handedness:
                return i
        return None

    def close(self):
        self._detector.close()
