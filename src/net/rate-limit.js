// =============================================================
// 令牌桶限速器（主动限流）
// 目标：在打到 429 之前，就把对诗泉 API 的出站请求速率压在阈值以下。
// 参考最佳实践：主动令牌桶/漏桶 优于 被动重试（apipark / ergonode）。
// =============================================================

export class TokenBucket {
  /**
   * @param {object} opts
   * @param {number} opts.capacity      桶容量（突发上限）
   * @param {number} opts.refillPerSec  每秒补充的令牌数（稳态速率）
   * @param {number} opts.maxConcurrent 同时在途请求上限
   */
  constructor({ capacity = 6, refillPerSec = 3, maxConcurrent = 2 } = {}) {
    this.capacity = capacity;
    this.refillPerSec = refillPerSec;
    this.maxConcurrent = maxConcurrent;
    this.tokens = capacity;
    this.active = 0;
    this._last = Date.now();
    this._waiters = [];
    this._timer = null; // 令牌不足时为等待者安排的补充泵送定时器
  }

  _refill() {
    const now = Date.now();
    const dt = (now - this._last) / 1000;
    if (dt > 0) {
      this.tokens = Math.min(this.capacity, this.tokens + dt * this.refillPerSec);
      this._last = now;
    }
  }

  get _canRun() {
    return this.tokens >= 1 && this.active < this.maxConcurrent;
  }

  _pump() {
    this._refill();
    while (this._waiters.length && this._canRun) {
      this.tokens -= 1;
      this.active += 1;
      const release = this._waiters.shift();
      release();
    }
    this._maybeSchedulePump();
  }

  // 还有等待者却拿不到令牌时（无在途请求触发 release），按补充节奏
  // 安排一次泵送，避免「空桶 + 无活动」导致的死锁。
  _maybeSchedulePump() {
    if (this._waiters.length === 0) {
      if (this._timer) { clearTimeout(this._timer); this._timer = null; }
      return;
    }
    if (this.tokens >= 1) return; // 仅受并发上限阻塞，等 release 即可
    if (this._timer) return;
    const dtMs = Math.max(0, (1 - this.tokens) / this.refillPerSec) * 1000;
    this._timer = setTimeout(() => {
      this._timer = null;
      this._pump();
    }, dtMs + 1);
  }

  /**
   * 获取一个发送配额；若额度/并发不足则等待。
   * 返回的 release 必须在请求结束后调用。
   * @returns {Promise<Function>}
   */
  acquire() {
    return new Promise((resolve) => {
      this._pump();
      if (this._canRun) {
        this.tokens -= 1;
        this.active += 1;
        resolve(this._release.bind(this));
      } else {
        this._waiters.push(() => resolve(this._release.bind(this)));
        // 等待者入队后再安排泵送（_pump 内的调度此时 waiters 尚为 0）
        this._maybeSchedulePump();
      }
    });
  }

  _release() {
    this.active -= 1;
    this._pump();
  }
}
