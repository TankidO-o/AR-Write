export class VideoLayer {
  constructor(videoElementId) {
    this.video = document.getElementById(videoElementId);
  }

  async start() {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { width: { ideal: 640 }, height: { ideal: 480 }, facingMode: 'user' }
    });
    this.video.srcObject = stream;
    await this.video.play();
    return stream;
  }

  get videoWidth() {
    return this.video.videoWidth;
  }

  get videoHeight() {
    return this.video.videoHeight;
  }
}
