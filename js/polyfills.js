/* ============ polyfills.js：老 Android WebView 缺的新 JS 能力 ============
 * PDF.js 5 使用 Math.sumPrecise 等较新的内建函数；Android System WebView 版本旧时
 * 会直接抛 "Math.sumPrecise is not a function"，导致 PDF 导入失败。
 */
(function () {
  if (!Math.sumPrecise) {
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
  if (!Promise.try) {
    Promise.try = function (fn) {
      return new Promise(resolve => resolve(fn()));
    };
  }
  if (!Promise.withResolvers) {
    Promise.withResolvers = function () {
      let resolve, reject;
      const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
      return { promise, resolve, reject };
    };
  }
  if (!Array.prototype.findLast) {
    Object.defineProperty(Array.prototype, 'findLast', {
      value: function (fn, thisArg) {
        for (let i = this.length - 1; i >= 0; i--) if (fn.call(thisArg, this[i], i, this)) return this[i];
        return undefined;
      }, configurable: true, writable: true,
    });
  }
  if (!Array.prototype.findLastIndex) {
    Object.defineProperty(Array.prototype, 'findLastIndex', {
      value: function (fn, thisArg) {
        for (let i = this.length - 1; i >= 0; i--) if (fn.call(thisArg, this[i], i, this)) return i;
        return -1;
      }, configurable: true, writable: true,
    });
  }
  if (!Object.hasOwn) {
    Object.hasOwn = function (obj, key) { return Object.prototype.hasOwnProperty.call(obj, key); };
  }
  if (!Array.prototype.toSorted) {
    Object.defineProperty(Array.prototype, 'toSorted', {
      value: function (compareFn) { return this.slice().sort(compareFn); },
      configurable: true, writable: true,
    });
  }
  if (!Array.prototype.toReversed) {
    Object.defineProperty(Array.prototype, 'toReversed', {
      value: function () { return this.slice().reverse(); },
      configurable: true, writable: true,
    });
  }
  if (!Array.prototype.with) {
    Object.defineProperty(Array.prototype, 'with', {
      value: function (index, value) {
        const out = this.slice();
        const i = index < 0 ? out.length + index : index;
        if (i < 0 || i >= out.length) throw new RangeError('index out of range');
        out[i] = value;
        return out;
      },
      configurable: true, writable: true,
    });
  }
})();