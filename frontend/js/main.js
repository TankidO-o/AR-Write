import { VideoLayer } from './video-layer.js';
import { WSClient } from './ws-client.js';

class App {
  constructor() {
    this.video = new VideoLayer('webcam');
    this.ws = new WSClient();
  }

  async start() {
    await this.video.start();
    this.ws.onMessage = (data) => this._onFrame(data);
    this.ws.connect();
  }

  _onFrame(data) {
    if (data.fps) {
      document.getElementById('fps-display').textContent = `${data.fps} FPS`;
    }
    if (data.hand) {
      document.getElementById('gesture-display').textContent =
        data.hand.handedness || 'Hand';
    } else {
      document.getElementById('gesture-display').textContent = 'No hand';
    }
  }
}

const app = new App();
app.start();
