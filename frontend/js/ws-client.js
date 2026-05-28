export class WSClient {
  constructor(url = 'ws://127.0.0.1:8765/ws') {
    this.url = url;
    this.ws = null;
    this.onMessage = null;
    this.reconnectDelay = 1000;
    this.maxDelay = 30000;
    this.reconnectAttempts = 0;
    this.heartbeatInterval = null;
    this.lastPong = 0;
  }

  connect() {
    this.ws = new WebSocket(this.url);
    this.ws.onopen = () => {
      this.reconnectAttempts = 0;
      this.reconnectDelay = 1000;
      this.lastPong = Date.now();
      this._startHeartbeat();
      this._updateStatus(true);
    };

    this.ws.onmessage = (event) => {
      const data = JSON.parse(event.data);
      if (data.type === 'pong') {
        this.lastPong = Date.now();
        return;
      }
      if (this.onMessage) this.onMessage(data);
    };

    this.ws.onclose = () => {
      this._updateStatus(false);
      this._stopHeartbeat();
      this._scheduleReconnect();
    };

    this.ws.onerror = () => {
      this.ws.close();
    };
  }

  _startHeartbeat() {
    this.heartbeatInterval = setInterval(() => {
      if (Date.now() - this.lastPong > 10000) {
        this.ws.close();
        return;
      }
      if (this.ws.readyState === WebSocket.OPEN) {
        this.ws.send(JSON.stringify({ type: 'ping' }));
      }
    }, 5000);
  }

  _stopHeartbeat() {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }
  }

  _scheduleReconnect() {
    if (this.reconnectAttempts >= 10) {
      console.warn('Max reconnect attempts reached');
      return;
    }
    setTimeout(() => {
      this.reconnectAttempts++;
      this.reconnectDelay = Math.min(this.reconnectDelay * 2, this.maxDelay);
      this.connect();
    }, this.reconnectDelay);
  }

  _updateStatus(connected) {
    const el = document.getElementById('ws-status');
    if (el) {
      el.className = connected ? 'connected' : '';
    }
  }
}
