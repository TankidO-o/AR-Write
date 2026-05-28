class LowPassFilter {
  constructor(alpha) {
    this.alpha = alpha;
    this.initialized = false;
    this.y = 0;
  }
  filter(value, alpha) {
    if (alpha !== undefined) this.alpha = alpha;
    if (this.initialized) {
      this.y = this.alpha * value + (1 - this.alpha) * this.y;
    } else {
      this.y = value;
      this.initialized = true;
    }
    return this.y;
  }
}

export class OneEuroFilter {
  constructor(beta = 0.007, f_c_min = 1.0, freq = 30) {
    this.beta = beta;
    this.f_c_min = f_c_min;
    this.freq = freq;
    this.x_filter = new LowPassFilter(1);
    this.dx_filter = new LowPassFilter(1);
    this.last_x = null;
    this.last_t = null;
  }

  _alpha(cutoff) {
    const tau = 1 / (2 * Math.PI * cutoff);
    const te = 1 / this.freq;
    return 1 / (1 + tau / te);
  }

  filter(x, t) {
    if (this.last_x === null || this.last_t === null || this.last_t === t) {
      this.last_x = x;
      this.last_t = t;
      return x;
    }

    const dx = (x - this.last_x) / (t - this.last_t);
    const dx_hat = this.dx_filter.filter(dx);

    const cutoff = this.f_c_min + this.beta * Math.abs(dx_hat);
    const alpha = this._alpha(cutoff);
    const result = this.x_filter.filter(x, alpha);

    this.last_x = result;
    this.last_t = t;
    return result;
  }

  reset() {
    this.x_filter = new LowPassFilter(1);
    this.dx_filter = new LowPassFilter(1);
    this.last_x = null;
    this.last_t = null;
  }
}
