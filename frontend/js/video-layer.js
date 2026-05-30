export class VideoLayer {
  constructor(videoElementId) {
    this.video = document.getElementById(videoElementId);
    this.stream = null;
    this._frameInterval = null;
    this._backendCanvas = null;
    this._backendCtx = null;
  }

  async start() {
    // Try browser camera first
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      return this._fallbackToBackend(
        'NOT_SUPPORTED',
        'Your browser does not support camera access, or the page is not served over a secure context (HTTPS / localhost).'
      );
    }

    const devices = await navigator.mediaDevices.enumerateDevices();
    const videoDevices = devices.filter(d => d.kind === 'videoinput');
    console.log(`[VideoLayer] Found ${videoDevices.length} video device(s):`,
      videoDevices.map(d => ({ label: d.label, deviceId: d.deviceId })));

    const constraintSets = videoDevices.length > 0
      ? [
          { video: { deviceId: { exact: videoDevices[0].deviceId }, width: { ideal: 640 }, height: { ideal: 480 } } },
          { video: { width: { ideal: 640 }, height: { ideal: 480 } } },
          { video: true },
        ]
      : [
          { video: { width: { ideal: 640 }, height: { ideal: 480 } } },
          { video: true },
        ];

    let lastError = null;
    for (const constraints of constraintSets) {
      try {
        console.log('[VideoLayer] Trying constraints:', JSON.stringify(constraints));
        this.stream = await navigator.mediaDevices.getUserMedia(constraints);
        console.log('[VideoLayer] Camera acquired successfully');
        this.video.srcObject = this.stream;
        await this.video.play();
        return this.stream;
      } catch (e) {
        lastError = e;
        console.log(`[VideoLayer] Browser camera unavailable (${e.name}: ${e.message}) — this is normal when the backend already owns the camera, falling back to backend stream`);
      }
    }

    // getUserMedia failed — fall back to backend frame streaming
    return this._fallbackToBackend(lastError?.name || 'UNKNOWN', lastError?.message || '');
  }

  async _fallbackToBackend(code, message) {
    console.log(`[VideoLayer] Falling back to backend stream (${code}: ${message})`);

    // Replace the <video> with a canvas (matched layout, behind drawing layers)
    const container = this.video.parentElement;
    const canvas = document.createElement('canvas');
    canvas.id = 'webcam-canvas';
    canvas.style.cssText = 'position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);width:100%;height:100%;object-fit:contain;z-index:0;pointer-events:none;';
    this.video.style.display = 'none';
    container.appendChild(canvas);

    this._backendCanvas = canvas;
    this._backendCtx = canvas.getContext('2d');

    // Poll /frame at ~25fps
    const poll = async () => {
      try {
        const resp = await fetch('http://127.0.0.1:8765/frame');
        if (resp.status === 204) return; // no frame yet
        if (!resp.ok) return;
        const blob = await resp.blob();
        const bitmap = await createImageBitmap(blob);
        canvas.width = bitmap.width;
        canvas.height = bitmap.height;
        this._backendCtx.drawImage(bitmap, 0, 0);
        bitmap.close();
      } catch (e) {
        // silently ignore fetch errors
      }
    };

    poll(); // first frame immediately
    this._frameInterval = setInterval(poll, 40); // ~25fps

    const err = new CameraPermissionError(code, message);
    err.fromBackend = true;
    throw err;
  }

  stop() {
    if (this._frameInterval) {
      clearInterval(this._frameInterval);
      this._frameInterval = null;
    }
    if (this.stream) {
      this.stream.getTracks().forEach(t => t.stop());
      this.stream = null;
    }
    if (this._backendCanvas) {
      this._backendCanvas.remove();
      this._backendCanvas = null;
      this._backendCtx = null;
    }
  }

  get videoWidth() {
    if (this._backendCanvas) return this._backendCanvas.width;
    return this.video.videoWidth;
  }

  get videoHeight() {
    if (this._backendCanvas) return this._backendCanvas.height;
    return this.video.videoHeight;
  }
}

export class CameraPermissionError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'CameraPermissionError';
    this.code = code;
    this.fromBackend = false;
  }
}
