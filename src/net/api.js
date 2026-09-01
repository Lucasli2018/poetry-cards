// =============================================================
// 统一请求层（诗泉 API）
// 组合：令牌桶(主动限流) → 指数退避 + 全抖动 → 熔断 → 失败分类。
// - 优先尊重服务端 Retry-After 头。
// - 退避采用 full jitter：wait = random(0, base * 2^n)，避免重试惊群
//   （Postman 429 指南 / apipark 最佳实践）。
// - 失败分类为 ApiError，便于上层区分「限流 / 网络 / HTTP / 熔断」。
// =============================================================

import { TokenBucket } from './rate-limit.js';
import { CircuitBreaker } from './circuit-breaker.js';

const API = 'https://poetry.palemoky.com';

// 保守阈值：容量 6 / 补充 3/s / 同时最多 2 个在途（远低于触发 429 的并发）
const limiter = new TokenBucket({ capacity: 6, refillPerSec: 3, maxConcurrent: 2 });
const breaker = new CircuitBreaker({ threshold: 5, cooldownMs: 10000 });

const sleep = (ms, signal) => new Promise((r, reject) => {
  const t = setTimeout(r, ms);
  if (signal) {
    if (signal.aborted) { clearTimeout(t); reject({ name: 'AbortError', code: 20 }); return; }
    signal.addEventListener('abort', () => { clearTimeout(t); reject({ name: 'AbortError', code: 20 }); }, { once: true });
  }
});

export class ApiError extends Error {
  constructor(message, { kind, status } = {}) {
    super(message);
    this.name = 'ApiError';
    this.kind = kind;       // 'rate_limit' | 'network' | 'http' | 'circuit'
    this.status = status;
  }
}

async function rawFetch(path, { signal } = {}) {
  const release = await limiter.acquire();
  try {
    let res;
    try {
      res = await fetch(API + path, { headers: { accept: 'application/json' }, signal });
    } catch (e) {
      // 用户主动取消
      if (e && (e.name === 'AbortError' || e.code === 20)) throw e;
      throw new ApiError('网络请求失败', { kind: 'network' });
    }
    if (!res.ok) {
      if (res.status === 429) {
        const e = new ApiError('API 429 (Too Many Requests)', { kind: 'rate_limit', status: 429 });
        e.resHeaders = res.headers;
        throw e;
      }
      if (res.status >= 500) {
        throw new ApiError(`API ${res.status}`, { kind: 'http', status: res.status });
      }
      // 其他 4xx（非限流）：客户端错误，不重试
      throw new ApiError(`API ${res.status}`, { kind: 'http', status: res.status });
    }
    const j = await res.json().catch(() => ({}));
    return j.data;
  } finally {
    release();
  }
}

function _isRetryable(e, attempt, maxRetries) {
  if (attempt >= maxRetries) return false;
  if (!(e instanceof ApiError)) return false;
  return (
    e.kind === 'rate_limit' ||
    e.kind === 'network' ||
    (e.kind === 'http' && e.status >= 500)
  );
}

/**
 * 统一请求：经过令牌桶 + 熔断 + 退避抖动。
 * @param {string} path  形如 '/api/poems/random'
 * @param {object} opts
 * @param {number} opts.maxRetries  最大重试次数（默认 3）
 * @param {AbortSignal} opts.signal  取消信号（被取消时直接抛 AbortError，不重试）
 */
export async function apiRequest(path, { maxRetries = 3, signal } = {}) {
  return breaker.call(async () => {
    let attempt = 0;
    while (true) {
      try {
        return await rawFetch(path, { signal });
      } catch (e) {
        // 用户主动取消：直接抛出，不重试、不进退避
        if (e && (e.name === 'AbortError' || e.code === 20)) throw e;
        if (!_isRetryable(e, attempt, maxRetries)) throw e;
        // 计算退避时长
        let wait;
        if (e.kind === 'rate_limit') {
          const retryAfter = Number(e.resHeaders?.get?.('Retry-After')) || 0;
          wait = retryAfter > 0 ? retryAfter * 1000 : Math.min(300 * 2 ** attempt, 8000);
        } else {
          wait = Math.min(300 * 2 ** attempt, 8000);
        }
        // 全抖动：在 [0, wait] 间随机，避免多客户端同步重试
        // 退避期间也要尊重取消信号
        await sleep(Math.random() * wait, signal);
        attempt++;
      }
    }
  });
}

export function breakerState() {
  return breaker.state;
}
export function resetBreaker() {
  breaker.reset();
}
