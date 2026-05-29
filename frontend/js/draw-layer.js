export class DrawLayer {
  constructor(historyCanvasId, activeCanvasId, cursorCanvasId) {
    this.historyCanvas = document.getElementById(historyCanvasId);
    this.activeCanvas = document.getElementById(activeCanvasId);
    this.cursorCanvas = document.getElementById(cursorCanvasId);
    this.historyCtx = this.historyCanvas.getContext('2d');
    this.activeCtx = this.activeCanvas.getContext('2d');
    this.cursorCtx = this.cursorCanvas.getContext('2d');

    this.strokes = [];
    this.redoStack = [];
    this.currentStroke = null;
    this.lineWidth = 4;
    this.color = '#00ff88';
    this.eraseRadius = 30;
    this.colors = ['#00ff88', '#ff4444', '#4488ff', '#ffaa00', '#aa44ff', '#ffffff'];

    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  resize() {
    const container = this.historyCanvas.parentElement;
    const rect = container.getBoundingClientRect();
    [this.historyCanvas, this.activeCanvas, this.cursorCanvas].forEach(c => {
      c.width = rect.width;
      c.height = rect.height;
    });
  }

  normToCanvas(normX, normY) {
    return {
      x: normX * this.historyCanvas.width,
      y: normY * this.historyCanvas.height,
    };
  }

  beginStroke(pt) {
    this.currentStroke = {
      id: crypto.randomUUID(),
      color: this.color,
      lineWidth: this.lineWidth,
      points: [pt],
      erased: false,
      bbox: { x: pt.x, y: pt.y, w: 0, h: 0 },
    };
    this.redoStack = [];
    this.activeCtx.clearRect(0, 0, this.activeCanvas.width, this.activeCanvas.height);
    this.activeCtx.strokeStyle = this.color;
    this.activeCtx.lineWidth = this.lineWidth;
    this.activeCtx.lineCap = 'round';
    this.activeCtx.lineJoin = 'round';
    this.activeCtx.beginPath();
    this.activeCtx.moveTo(pt.x, pt.y);
  }

  addPoint(pt) {
    if (!this.currentStroke) return;
    this.currentStroke.points.push(pt);
    this.activeCtx.lineTo(pt.x, pt.y);
    this.activeCtx.stroke();

    // Update bbox
    const bb = this.currentStroke.bbox;
    const nx = Math.min(bb.x, pt.x);
    const ny = Math.min(bb.y, pt.y);
    bb.w = Math.max(bb.x + bb.w, pt.x) - nx;
    bb.h = Math.max(bb.y + bb.h, pt.y) - ny;
    bb.x = nx;
    bb.y = ny;
  }

  endStroke() {
    if (!this.currentStroke) return;
    this._compact();
    this.strokes.push(this.currentStroke);
    this._mergeToHistory(this.currentStroke);
    this.currentStroke = null;
    this.activeCtx.clearRect(0, 0, this.activeCanvas.width, this.activeCanvas.height);
  }

  _makeFragment(sourceStroke, points) {
    const bbox = { x: points[0].x, y: points[0].y, w: 0, h: 0 };
    for (const pt of points) {
      const nx = Math.min(bbox.x, pt.x);
      const ny = Math.min(bbox.y, pt.y);
      bbox.w = Math.max(bbox.x + bbox.w, pt.x) - nx;
      bbox.h = Math.max(bbox.y + bbox.h, pt.y) - ny;
      bbox.x = nx;
      bbox.y = ny;
    }
    return {
      id: crypto.randomUUID(),
      color: sourceStroke.color,
      lineWidth: sourceStroke.lineWidth,
      points,
      erased: false,
      bbox,
    };
  }

  _mergeToHistory(stroke) {
    this.historyCtx.strokeStyle = stroke.color;
    this.historyCtx.lineWidth = stroke.lineWidth;
    this.historyCtx.lineCap = 'round';
    this.historyCtx.lineJoin = 'round';
    this.historyCtx.beginPath();
    this.historyCtx.moveTo(stroke.points[0].x, stroke.points[0].y);
    for (let i = 1; i < stroke.points.length; i++) {
      this.historyCtx.lineTo(stroke.points[i].x, stroke.points[i].y);
    }
    this.historyCtx.stroke();
  }

  eraseAt(center) {
    const r = this.eraseRadius;
    let changed = false;
    const newStrokes = [];

    for (const stroke of this.strokes) {
      if (stroke.erased) continue;

      // Bbox quick reject
      if (center.x + r < stroke.bbox.x || center.x - r > stroke.bbox.x + stroke.bbox.w ||
          center.y + r < stroke.bbox.y || center.y - r > stroke.bbox.y + stroke.bbox.h) {
        continue;
      }

      // Mark erased points
      const keep = stroke.points.map(pt => {
        const dx = pt.x - center.x;
        const dy = pt.y - center.y;
        return (dx * dx + dy * dy < r * r) ? null : pt;
      });

      // If nothing was erased, skip
      const anyErased = keep.some(p => p === null);
      if (!anyErased) continue;

      changed = true;
      stroke.erased = true;

      // Split remaining points into continuous segments
      let segment = [];
      for (const pt of keep) {
        if (pt !== null) {
          segment.push(pt);
        } else {
          if (segment.length >= 2) {
            newStrokes.push(this._makeFragment(stroke, segment));
          }
          segment = [];
        }
      }
      if (segment.length >= 2) {
        newStrokes.push(this._makeFragment(stroke, segment));
      }
    }

    // Add surviving fragments
    for (const frag of newStrokes) {
      this.strokes.push(frag);
    }

    if (changed) this._redrawHistory();
    return changed;
  }

  undo() {
    for (let i = this.strokes.length - 1; i >= 0; i--) {
      if (!this.strokes[i].erased) {
        this.strokes[i].erased = true;
        this.redoStack.push(this.strokes[i]);
        this._redrawHistory();
        return true;
      }
    }
    return false;
  }

  redo() {
    if (this.redoStack.length === 0) return false;
    const stroke = this.redoStack.pop();
    stroke.erased = false;
    this._redrawHistory();
    return true;
  }

  clearAll() {
    for (const s of this.strokes) s.erased = true;
    this.redoStack = [];
    this._redrawHistory();
  }

  _redrawHistory() {
    this.historyCtx.clearRect(0, 0, this.historyCanvas.width, this.historyCanvas.height);
    for (const stroke of this.strokes) {
      if (stroke.erased) continue;
      this.historyCtx.strokeStyle = stroke.color;
      this.historyCtx.lineWidth = stroke.lineWidth;
      this.historyCtx.lineCap = 'round';
      this.historyCtx.lineJoin = 'round';
      this.historyCtx.beginPath();
      this.historyCtx.moveTo(stroke.points[0].x, stroke.points[0].y);
      for (let i = 1; i < stroke.points.length; i++) {
        this.historyCtx.lineTo(stroke.points[i].x, stroke.points[i].y);
      }
      this.historyCtx.stroke();
    }
  }

  _compact() {
    // Keep at most 50 erased strokes for undo; discard older ones
    let erasedCount = 0;
    for (let i = this.strokes.length - 1; i >= 0; i--) {
      if (this.strokes[i].erased) {
        erasedCount++;
        if (erasedCount > 50) {
          this.strokes.splice(i, 1);
        }
      }
    }
  }

  setColor(color) { this.color = color; }
  setLineWidth(w) { this.lineWidth = w; }
  setEraserRadius(r) {
    this.eraseRadius = r;
  }

  // Cursor rendering
  drawWriteCursor(pt) {
    this._clearCursor();
    this.cursorCtx.beginPath();
    this.cursorCtx.arc(pt.x, pt.y, this.lineWidth / 2 + 2, 0, Math.PI * 2);
    this.cursorCtx.fillStyle = this.color;
    this.cursorCtx.fill();
  }

  drawEraseCursor(center) {
    this._clearCursor();
    this.cursorCtx.beginPath();
    this.cursorCtx.arc(center.x, center.y, this.eraseRadius, 0, Math.PI * 2);
    this.cursorCtx.strokeStyle = 'rgba(255,255,255,0.6)';
    this.cursorCtx.lineWidth = 2;
    this.cursorCtx.stroke();
    this.cursorCtx.fillStyle = 'rgba(255,255,255,0.1)';
    this.cursorCtx.fill();
  }

  clearCursor() {
    this._clearCursor();
  }

  _clearCursor() {
    this.cursorCtx.clearRect(0, 0, this.cursorCanvas.width, this.cursorCanvas.height);
  }

  saveScreenshot() {
    const combined = document.createElement('canvas');
    combined.width = this.historyCanvas.width;
    combined.height = this.historyCanvas.height;
    const ctx = combined.getContext('2d');

    const video = document.getElementById('webcam');
    if (video && video.readyState >= 2) {
      ctx.drawImage(video, 0, 0, combined.width, combined.height);
    }
    ctx.drawImage(this.historyCanvas, 0, 0);
    ctx.drawImage(this.activeCanvas, 0, 0);

    const link = document.createElement('a');
    link.download = `ar-drawing-${Date.now()}.png`;
    link.href = combined.toDataURL('image/png');
    link.click();
  }
}
