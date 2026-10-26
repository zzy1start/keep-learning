/*
 * PDF.js 6.4 worker compatibility entry.
 * Its linearized-PDF path uses Uint8Array.prototype.toHex(), which is not yet
 * available in every supported browser/runtime. Add the standard lowercase
 * hex conversion before loading the upstream worker module.
 */
if (typeof Uint8Array.prototype.toHex !== 'function') {
  Object.defineProperty(Uint8Array.prototype, 'toHex', {
    configurable: true,
    writable: true,
    value() {
      return Array.from(this, byte => byte.toString(16).padStart(2, '0')).join('');
    },
  });
}

/* Keep Learning: 旧 Android WebView 的 worker 没有这些新内建函数 */
if (typeof Math.sumPrecise !== 'function') {
  Math.sumPrecise = function (iterable) {
    let sum = 0, c = 0;
    for (const value of iterable) {
      const y = Number(value) - c;
      const t = sum + y;
      c = (t - sum) - y;
      sum = t;
    }
    return sum;
  };
}
if (typeof Promise.withResolvers !== 'function') {
  Promise.withResolvers = function () {
    let resolve, reject;
    const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
    return { promise, resolve, reject };
  };
}
if (!Array.prototype.findLast) {
  Object.defineProperty(Array.prototype, 'findLast', {
    configurable: true, writable: true,
    value(fn, thisArg) {
      for (let i = this.length - 1; i >= 0; i--) if (fn.call(thisArg, this[i], i, this)) return this[i];
      return undefined;
    },
  });
}
if (!Uint8Array.prototype.toHex) {
  Object.defineProperty(Uint8Array.prototype, 'toHex', {
    configurable: true, writable: true,
    value() { return Array.from(this, b => b.toString(16).padStart(2, '0')).join(''); },
  });
}

const workerModule = await import('./pdf.worker.mjs');
// PDF.js also imports this entry in its Node fallback, which needs the named
// handler export; module workers use the global installed by pdf.worker.mjs.
export const WorkerMessageHandler = workerModule.WorkerMessageHandler;
