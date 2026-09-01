// =============================================================
// 熔断器（Circuit Breaker）
// 目标：连续失败达阈值后「开路」，暂停对诗泉 API 的请求一段时间，
//       避免无效轰炸与配额浪费；冷却后「半开」探测，恢复则闭合。
// 参考最佳实践：apipark / ergonode《Best Practices》。
// =============================================================

export class CircuitBreaker {
  /**
   * @param {object} opts
   * @param {number} opts.threshold    连续失败多少次后开路
   * @param {number} opts.cooldownMs   开路持续时长（毫秒）
   */
  constructor({ threshold = 5, cooldownMs = 10000 } = {}) {
    this.threshold = threshold;
    this.cooldownMs = cooldownMs;
    this.state = 'CLOSED'; // CLOSED | OPEN | HALF_OPEN
    this.failures = 0;
    this.openedAt = 0;
  }

  /**
   * 包裹一次调用：成功归零计数并闭合；失败累加，达阈值则开路。
   * 开路期间直接抛出 'CIRCUIT_OPEN'，不再发请求。
   * @param {Function} fn
   */
  async call(fn) {
    if (this.state === 'OPEN') {
      if (Date.now() - this.openedAt >= this.cooldownMs) {
        this.state = 'HALF_OPEN';
      } else {
        const e = new Error('CIRCUIT_OPEN');
        e.kind = 'circuit';
        throw e;
      }
    }
    try {
      const r = await fn();
      this._onSuccess();
      return r;
    } catch (e) {
      this._onFailure();
      throw e;
    }
  }

  _onSuccess() {
    this.failures = 0;
    this.state = 'CLOSED';
  }

  _onFailure() {
    if (this.state === 'HALF_OPEN') {
      this.state = 'OPEN';
      this.openedAt = Date.now();
      return;
    }
    this.failures += 1;
    if (this.failures >= this.threshold) {
      this.state = 'OPEN';
      this.openedAt = Date.now();
    }
  }

  /** 手动复位（用于「重试恢复」按钮） */
  reset() {
    this.failures = 0;
    this.state = 'CLOSED';
    this.openedAt = 0;
  }

  get isOpen() {
    return this.state === 'OPEN' && Date.now() - this.openedAt < this.cooldownMs;
  }
}
