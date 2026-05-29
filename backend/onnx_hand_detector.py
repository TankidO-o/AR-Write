"""
ONNX-based hand detection backend.

Replicates the MediaPipe HandLandmarker pipeline using pure ONNX Runtime
inference. Compatible with Python 3.14+ where the mediapipe package lacks
pre-built wheels.

Pipeline:
  1. Hand (palm) detection  – hand_detector.onnx   → bbox + keypoints
  2. Hand landmark detection – hand_landmarks_detector.onnx → 21 keypoints

The public interface matches the existing HandDetector class exactly so
server.py requires zero changes.

Before using this backend, generate the ONNX models:
    python convert_models.py
"""

import os
import math
from typing import Optional

import numpy as np

try:
    import onnxruntime as ort

    # Silence ONNX Runtime shape‑merge and non‑critical warnings
    _ORT_SO = ort.SessionOptions()
    _ORT_SO.log_severity_level = 3  # ERROR only
    _ORT_AVAILABLE = True
except ImportError:
    _ORT_AVAILABLE = False

# Also suppress at module level (before first InferenceSession call)
os.environ.setdefault("ORT_DISABLE_EXTENSIONS", "0")
os.environ.setdefault("ORT_DISABLE_TELEMETRY", "1")


# ---------------------------------------------------------------------------
# Paths
# ---------------------------------------------------------------------------
_MODEL_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), ".models")
_HAND_DETECTOR_ONNX = os.path.join(_MODEL_DIR, "hand_detector.onnx")
_HAND_LANDMARKS_ONNX = os.path.join(_MODEL_DIR, "hand_landmarks_detector.onnx")


# ---------------------------------------------------------------------------
# Palm detector constants (SSD anchor grid)
# ---------------------------------------------------------------------------
_DET_INPUT_SIZE = 192
_DET_STRIDE = 16            # feature map stride
_DET_GRID_SIZE = _DET_INPUT_SIZE // _DET_STRIDE  # 12
_NUM_ANCHORS = 2016 // (_DET_GRID_SIZE * _DET_GRID_SIZE)  # 14

# Anchor offsets in (x_center, y_center) per grid cell, image-normalised.
_ANCHOR_OFFSETS: "list[tuple[float, float]]" = []
for _i in range(_DET_GRID_SIZE):
    for _j in range(_DET_GRID_SIZE):
        _cx = (_j + 0.5) / _DET_GRID_SIZE
        _cy = (_i + 0.5) / _DET_GRID_SIZE
        _ANCHOR_OFFSETS.append((_cx, _cy))

# Per-anchor scales – approximate values; validated against MediaPipe output.
_BASE_SCALES = [0.75, 1.0, 1.75, 2.5]
_ASPECT_RATIOS = [0.65, 1.0]
_EXTRA_SCALES_PER = _NUM_ANCHORS - (len(_BASE_SCALES) * len(_ASPECT_RATIOS))  # 6

# Landmark model
_LDM_INPUT_SIZE = 224


# ---------------------------------------------------------------------------
# Anchor generation
# ---------------------------------------------------------------------------

def _build_anchors() -> np.ndarray:
    """Return (num_anchors, 4) array of [x_center, y_center, w, h] normalised."""
    anchors = []

    for cx, cy in _ANCHOR_OFFSETS:  # 144 grid centres
        for s in _BASE_SCALES:
            for ar in _ASPECT_RATIOS:
                w = s * math.sqrt(ar) / _DET_GRID_SIZE
                h = s / math.sqrt(ar) / _DET_GRID_SIZE
                anchors.append([cx, cy, w, h])

        # Extra anchors (6 more per location to reach 14)
        for k in range(_EXTRA_SCALES_PER):
            scale = _BASE_SCALES[0] * (1.0 + 0.3 * (k + 1))
            w = scale * 1.0 / _DET_GRID_SIZE
            h = scale * 1.0 / _DET_GRID_SIZE
            anchors.append([cx, cy, w, h])

    return np.array(anchors, dtype=np.float32)  # (2016, 4)


# ---------------------------------------------------------------------------
# Detection decoding
# ---------------------------------------------------------------------------

def _decode_detections(
    raw_boxes: np.ndarray,   # (1, 2016, 18)
    raw_scores: np.ndarray,  # (1, 2016, 1)
    anchors: np.ndarray,     # (2016, 4)
    threshold: float = 0.3,
) -> list[dict]:
    """Decode SSD detection outputs into a list of hand candidates."""
    raw_boxes = raw_boxes[0]    # (2016, 18)
    raw_scores = raw_scores[0]  # (2016, 1)

    # Clip extreme values to prevent overflow in exp/sigmoid
    raw_scores = np.clip(raw_scores, -50.0, 50.0)
    raw_boxes = np.clip(raw_boxes, -50.0, 50.0)

    # Sigmoid scores
    scores = 1.0 / (1.0 + np.exp(-raw_scores[:, 0]))

    # Decode bounding box
    dy = raw_boxes[:, 0]
    dx = raw_boxes[:, 1]
    dh = raw_boxes[:, 2]
    dw = raw_boxes[:, 3]

    anchor_cx = anchors[:, 0]
    anchor_cy = anchors[:, 1]
    anchor_w = anchors[:, 2]
    anchor_h = anchors[:, 3]

    pred_cx = anchor_cx + dx * anchor_w
    pred_cy = anchor_cy + dy * anchor_h
    pred_w = anchor_w * np.exp(dw)
    pred_h = anchor_h * np.exp(dh)

    pred_x = pred_cx - pred_w / 2.0
    pred_y = pred_cy - pred_h / 2.0

    # Decode 7 keypoints (indices 4..17)
    kp_decoded = []
    for i in range(7):
        kpx = anchor_cx + raw_boxes[:, 4 + i] * anchor_w
        kpy = anchor_cy + raw_boxes[:, 4 + 7 + i] * anchor_h
        kp_decoded.append((kpx, kpy))

    # NMS – filter invalid values first
    valid = (
        np.isfinite(pred_x) & np.isfinite(pred_y) &
        np.isfinite(pred_w) & np.isfinite(pred_h) &
        np.isfinite(scores) &
        (scores >= threshold) &
        (pred_w > 0) & (pred_h > 0)
    )
    valid_idx = np.where(valid)[0]
    if len(valid_idx) == 0:
        return []

    keep = _nms(
        pred_x[valid_idx], pred_y[valid_idx],
        pred_w[valid_idx], pred_h[valid_idx],
        scores[valid_idx], threshold,
    )
    # Map back to original indices
    keep = valid_idx[keep]

    results = []
    for idx in keep:
        bbox = (
            float(pred_x[idx]),
            float(pred_y[idx]),
            float(pred_w[idx]),
            float(pred_h[idx]),
        )
        pts = [(float(kp_decoded[i][0][idx]), float(kp_decoded[i][1][idx]))
               for i in range(7)]
        results.append({"bbox": bbox, "score": float(scores[idx]), "keypoints": pts})

    return results


def _nms(x, y, w, h, scores, threshold):
    """Greedy NMS returning indices of retained boxes."""
    if len(scores) == 0:
        return np.array([], dtype=np.int64)

    # Clamp extreme values
    x, y, w, h = [np.clip(a, -1e6, 1e6) for a in (x, y, w, h)]
    w = np.clip(w, 0, 1e6)
    h = np.clip(h, 0, 1e6)

    x1, y1 = x, y
    x2, y2 = x + w, y + h
    areas = w * h

    order = np.argsort(-scores)
    keep = []

    while len(order) > 0:
        i = order[0]
        keep.append(i)
        if len(order) == 1:
            break

        xx1 = np.maximum(x1[i], x1[order[1:]])
        yy1 = np.maximum(y1[i], y1[order[1:]])
        xx2 = np.minimum(x2[i], x2[order[1:]])
        yy2 = np.minimum(y2[i], y2[order[1:]])

        inter_w = np.maximum(0.0, xx2 - xx1)
        inter_h = np.maximum(0.0, yy2 - yy1)
        inter = inter_w * inter_h

        iou = inter / (areas[i] + areas[order[1:]] - inter + 1e-8)
        remaining = np.where(iou <= threshold)[0]
        order = order[remaining + 1]

    return keep


# ---------------------------------------------------------------------------
# Hand landmark decoding
# ---------------------------------------------------------------------------

def _decode_landmarks(raw_landmarks: np.ndarray) -> list[dict]:
    """Convert raw landmark output [1, 63] into list of 21 keypoint dicts."""
    arr = raw_landmarks[0]  # (63,)
    keypoints = []
    for i in range(21):
        keypoints.append({
            "id": i,
            "x": round(float(arr[i * 3 + 0]), 4),
            "y": round(float(arr[i * 3 + 1]), 4),
            "z": round(float(arr[i * 3 + 2]), 4),
        })
    return keypoints


# ---------------------------------------------------------------------------
# Image helpers
# ---------------------------------------------------------------------------

def _resize_rgb(img: np.ndarray, target_w: int, target_h: int) -> np.ndarray:
    """Resize an RGB image with bilinear interpolation."""
    try:
        import cv2
        return cv2.resize(img, (target_w, target_h), interpolation=cv2.INTER_LINEAR)
    except ImportError:
        pass

    # Pure numpy fallback
    h, w = img.shape[:2]
    x_src = (np.arange(target_w) + 0.5) * w / target_w - 0.5
    y_src = (np.arange(target_h) + 0.5) * h / target_h - 0.5
    x0 = np.clip(np.floor(x_src).astype(int), 0, w - 1)
    x1 = np.clip(x0 + 1, 0, w - 1)
    y0 = np.clip(np.floor(y_src).astype(int), 0, h - 1)
    y1 = np.clip(y0 + 1, 0, h - 1)
    wx = x_src - x0
    wy = y_src - y0

    result = np.zeros((target_h, target_w, 3), dtype=np.float32)
    for c in range(3):
        Ia = img[y0[:, None], x0[None, :], c].astype(np.float32)
        Ib = img[y1[:, None], x0[None, :], c].astype(np.float32)
        Ic = img[y0[:, None], x1[None, :], c].astype(np.float32)
        Id = img[y1[:, None], x1[None, :], c].astype(np.float32)
        wa = (1 - wy[:, None]) * (1 - wx[None, :])
        wb = wy[:, None] * (1 - wx[None, :])
        wc = (1 - wy[:, None]) * wx[None, :]
        wd = wy[:, None] * wx[None, :]
        result[:, :, c] = Ia * wa + Ib * wb + Ic * wc + Id * wd

    return result.astype(img.dtype) if img.dtype != np.float32 else result


def _crop_hand_region(
    img: np.ndarray,
    bbox: tuple[float, float, float, float],
    scale: float,
) -> np.ndarray:
    """Extract a square hand region from the image given a normalised bbox.

    The bbox is in the padded 192×192 detection space.
    """
    h, w = img.shape[:2]
    bx, by, bw, bh = bbox

    # Validate bbox
    if not all(np.isfinite(v) and v >= 0 for v in bbox):
        return img
    if bw <= 0 or bh <= 0:
        return img

    cx = bx + bw / 2
    cy = by + bh / 2
    size = max(bw, bh) * 2.2  # context expansion

    # Map from padded space to original image
    cx_orig = cx * _DET_INPUT_SIZE / scale
    cy_orig = cy * _DET_INPUT_SIZE / scale
    size_orig = size * _DET_INPUT_SIZE / scale

    x1 = max(0, int(cx_orig - size_orig / 2))
    y1 = max(0, int(cy_orig - size_orig / 2))
    x2 = min(w, int(cx_orig + size_orig / 2))
    y2 = min(h, int(cy_orig + size_orig / 2))

    if x2 <= x1 or y2 <= y1:
        return img
    return img[y1:y2, x1:x2]


# ---------------------------------------------------------------------------
# ONNXHandDetector  (same API as hand_detector.HandDetector)
# ---------------------------------------------------------------------------

class ONNXHandDetector:
    """ONNX‑based hand detection with the same interface as HandDetector."""

    def __init__(
        self,
        model_dir: str | None = None,
        min_detection_confidence: float = 0.5,
        min_tracking_confidence: float = 0.5,
    ):
        if not _ORT_AVAILABLE:
            raise RuntimeError(
                "onnxruntime is not installed. "
                "Install it with: pip install onnxruntime"
            )

        self.min_detection_confidence = min_detection_confidence
        self.min_tracking_confidence = min_tracking_confidence
        self._locked_handedness: str | None = None

        _model_dir = model_dir or _MODEL_DIR
        det_path = os.path.join(_model_dir, "hand_detector.onnx")
        ldm_path = os.path.join(_model_dir, "hand_landmarks_detector.onnx")

        if not os.path.exists(det_path) or not os.path.exists(ldm_path):
            raise FileNotFoundError(
                "ONNX models not found. Generate them first:\n"
                f"    python {os.path.join(os.path.dirname(__file__), 'convert_models.py')}\n"
                f"Expected:\n  {det_path}\n  {ldm_path}"
            )

        self._det_sess = ort.InferenceSession(
            det_path, _ORT_SO, providers=["CPUExecutionProvider"]
        )
        self._ldm_sess = ort.InferenceSession(
            ldm_path, _ORT_SO, providers=["CPUExecutionProvider"]
        )

        self._anchors = _build_anchors()
        self._det_input_name = self._det_sess.get_inputs()[0].name
        self._ldm_input_name = self._ldm_sess.get_inputs()[0].name

    def detect(self, rgb_frame: np.ndarray, timestamp_ms: int = 0) -> dict | None:
        """Run hand detection + landmarking on an RGB numpy frame (H×W×3)."""
        h, w = rgb_frame.shape[:2]

        # ---- Stage 1: hand detection --------------------------------------
        scale = min(_DET_INPUT_SIZE / w, _DET_INPUT_SIZE / h)
        new_w, new_h = int(w * scale), int(h * scale)
        resized = _resize_rgb(rgb_frame, new_w, new_h)

        det_input = np.zeros((_DET_INPUT_SIZE, _DET_INPUT_SIZE, 3), dtype=np.float32)
        det_input[0:new_h, 0:new_w, :] = resized
        det_input = (det_input / 127.5) - 1.0  # → [-1, 1]
        det_input = np.transpose(det_input, (2, 0, 1))[np.newaxis, :, :, :]

        raw_boxes, raw_scores = self._det_sess.run(
            None, {self._det_input_name: det_input.astype(np.float32)}
        )

        candidates = _decode_detections(
            raw_boxes, raw_scores, self._anchors,
            threshold=self.min_detection_confidence,
        )

        if not candidates:
            self._locked_handedness = None
            return None

        best = max(candidates, key=lambda c: c["score"])

        # ---- Stage 2: crop hand region → landmarks ------------------------
        hand_region = _crop_hand_region(rgb_frame, best["bbox"], scale)

        hand_input = _resize_rgb(hand_region, _LDM_INPUT_SIZE, _LDM_INPUT_SIZE)
        hand_input = hand_input.astype(np.float32) / 255.0  # → [0, 1]
        hand_input = np.transpose(hand_input, (2, 0, 1))[np.newaxis, :, :, :]

        raw_ldm, raw_handedness, raw_presence, _ = self._ldm_sess.run(
            None, {self._ldm_input_name: hand_input}
        )

        # Handedness – score > 0 means Right hand
        handedness_score = float(raw_handedness[0, 0])
        handedness = "Right" if handedness_score > 0 else "Left"

        if self._locked_handedness is None:
            self._locked_handedness = handedness

        keypoints = _decode_landmarks(raw_ldm)

        wrist = (keypoints[0]["x"], keypoints[0]["y"])
        middle_mcp = (keypoints[9]["x"], keypoints[9]["y"])
        palm_center = {
            "x": round((wrist[0] + middle_mcp[0]) / 2, 4),
            "y": round((wrist[1] + middle_mcp[1]) / 2, 4),
        }

        return {
            "handedness": self._locked_handedness,
            "keypoints": keypoints,
            "palm_center": palm_center,
        }

    def close(self):
        self._det_sess = None
        self._ldm_sess = None
