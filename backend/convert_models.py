"""
One-time conversion: download HandLandmarker .task and convert to ONNX.

Usage:
    python convert_models.py

Requires:  tflite, tflite2onnx, onnx  (pip install tflite tflite2onnx onnx)

The generated ONNX models are saved to backend/.models/ and can be used
on any Python version with onnxruntime.

This script monkey-patches tflite2onnx at runtime to handle float16
models and bias-tensor layout issues.
"""

import os
import sys
import urllib.request
import zipfile

_MODEL_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), ".models")
_TASK_URL = (
    "https://storage.googleapis.com/mediapipe-models/"
    "hand_landmarker/hand_landmarker/float16/latest/hand_landmarker.task"
)


# ---------------------------------------------------------------------------
# Runtime monkey-patches for tflite2onnx float16 + layout bugs
# ---------------------------------------------------------------------------

def _apply_patches():
    """Monkey-patch tflite2onnx so it can convert our float16 models."""
    # Suppress float16 / empty-tensor warnings
    import logging
    logging.getLogger("tflite2onnx").setLevel(logging.ERROR)

    import tflite2onnx.layout
    import tflite2onnx.tensor
    import tflite2onnx.op.activation

    # ---- patch 1: guard against dim-mismatched layout transforms -----------
    _orig_transform_fn = tflite2onnx.layout.transform

    def _patched_transform(input, ilayout: str, olayout: str):
        if ilayout == olayout:
            return input
        if len(input) != len(ilayout):
            return input  # e.g. 1D bias tensor given 4D NHWC layout
        return _orig_transform_fn(input, ilayout, olayout)

    tflite2onnx.layout.transform = _patched_transform

    # ---- patch 2: guard tensor data transpose against dim mismatch --------
    _orig_tt = tflite2onnx.tensor.Tensor.transform

    def _patched_tt(self):
        if self.isInitializer and self.layout is not None:
            if len(self.shape) != len(self.layout.source):
                return  # skip layout transform for dim-mismatched tensors
        return _orig_tt(self)

    tflite2onnx.tensor.Tensor.transform = _patched_tt

    # ---- patch 3: PReLU alpha (slope) gets per-channel layout ------------
    import tflite2onnx.layout as _L
    _orig_activation_parse = tflite2onnx.op.activation.Activation.parse

    def _patched_activation_parse(self):
        _orig_activation_parse(self)
        if self.type == 'PRelu':
            # Give alpha a per-channel layout so NHWC→NCHW won't break it
            alpha = self.inputs[1]
            if alpha.layout is None or alpha.layout.source == 'C':
                pass  # already set
            else:
                alpha.layout = _L.Layout('C', 'C')

    tflite2onnx.op.activation.Activation.parse = _patched_activation_parse

    # ---- patch 4: PReLU transform reshapes slope to [1, C, 1, 1] ---------
    _orig_act_transform = tflite2onnx.op.activation.Activation.transform

    def _patched_act_transform(self):
        _orig_act_transform(self)
        if self.type == 'PRelu':
            X = self.inputs[0]
            alpha = self.inputs[1]
            if len(X.shape) == 4:  # [N, C, H, W] NCHW
                C = X.shape[1]
                alpha.shape = [1, C, 1, 1]

    tflite2onnx.op.activation.Activation.transform = _patched_act_transform

    print("   [patches] tflite2onnx monkey-patched for float16 models.")


# ---------------------------------------------------------------------------
# Post-processing: fix PReLU slope tensor shapes
# ---------------------------------------------------------------------------

def _fix_prelu_slopes(onnx_path: str):
    """Reshape PReLU slope tensors from [1, 1, C] to [1, C, 1, 1].

    The converter may leave slope tensors in NHWC layout while the
    rest of the model is NCHW.
    """
    import onnx
    from onnx import numpy_helper

    if not os.path.exists(onnx_path):
        return

    model = onnx.load(onnx_path)
    modified = 0

    for node in model.graph.node:
        if node.op_type != "PRelu":
            continue
        slope_name = node.input[1]
        for init in model.graph.initializer:
            if init.name != slope_name:
                continue
            arr = numpy_helper.to_array(init)
            if len(arr.shape) == 3 and arr.shape[0] == 1 and arr.shape[1] == 1:
                new_arr = arr.reshape(1, arr.shape[2], 1, 1)
                new_init = numpy_helper.from_array(new_arr, name=slope_name)
                model.graph.initializer.remove(init)
                model.graph.initializer.append(new_init)
                modified += 1
            break

    if modified:
        onnx.save(model, onnx_path)
        print(f"   Fixed {modified} PReLU slope tensors in {os.path.basename(onnx_path)}.")


# ---------------------------------------------------------------------------
# Conversion steps
# ---------------------------------------------------------------------------

def step1_download():
    """Download the .task file and extract TFLite models."""
    os.makedirs(_MODEL_DIR, exist_ok=True)

    task_path = os.path.join(_MODEL_DIR, "hand_landmarker.task")
    if not os.path.exists(task_path):
        print(f"[1/3] Downloading model …")
        urllib.request.urlretrieve(_TASK_URL, task_path)
        print(f"   Saved: {task_path}")
    else:
        print(f"[1/3] Model cached: {task_path}")

    ext_dir = os.path.join(_MODEL_DIR, "extracted")
    det_tflite = os.path.join(ext_dir, "hand_detector.tflite")
    ldm_tflite = os.path.join(ext_dir, "hand_landmarks_detector.tflite")

    if not os.path.exists(det_tflite) or not os.path.exists(ldm_tflite):
        os.makedirs(ext_dir, exist_ok=True)
        with zipfile.ZipFile(task_path, "r") as zf:
            zf.extractall(ext_dir)
        print("   Extracted TFLite models.")
    else:
        print("   TFLite models already extracted.")


def step2_convert():
    """Convert TFLite → ONNX."""
    from tflite2onnx import convert

    det_tflite = os.path.join(_MODEL_DIR, "extracted", "hand_detector.tflite")
    ldm_tflite = os.path.join(_MODEL_DIR, "extracted", "hand_landmarks_detector.tflite")
    det_onnx = os.path.join(_MODEL_DIR, "hand_detector.onnx")
    ldm_onnx = os.path.join(_MODEL_DIR, "hand_landmarks_detector.onnx")

    print("[2/3] Converting TFLite → ONNX …")
    for tfl, onx, label in [
        (det_tflite, det_onnx, "hand_detector"),
        (ldm_tflite, ldm_onnx, "hand_landmarks_detector"),
    ]:
        if os.path.exists(onx):
            print(f"   {label}.onnx already exists, skipping.")
            continue
        convert(tfl, onx)
        print(f"   {label}.onnx created.")


def step3_postprocess():
    """Fix known issues in generated ONNX models."""
    print("[3/3] Post-processing ONNX models …")
    _fix_prelu_slopes(os.path.join(_MODEL_DIR, "hand_detector.onnx"))
    _fix_prelu_slopes(os.path.join(_MODEL_DIR, "hand_landmarks_detector.onnx"))


def main():
    print("=" * 60)
    print("MediaPipe HandLandmarker → ONNX converter")
    print("=" * 60)

    _apply_patches()
    step1_download()
    step2_convert()
    step3_postprocess()

    print()
    print("Done! ONNX models are in", _MODEL_DIR)
    print("Run the server with onnxruntime -- no mediapipe required.")


if __name__ == "__main__":
    main()
