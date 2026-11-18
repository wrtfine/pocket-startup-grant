(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.PocketBoardSync = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const missing = Symbol('missing');
  const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
  function equal(left, right) {
    if (left === right) return true;
    if (Array.isArray(left) && Array.isArray(right)) return left.length === right.length && left.every((value, index) => equal(value, right[index]));
    if (!object(left) || !object(right)) return false;
    const keys = Object.keys(left);
    return keys.length === Object.keys(right).length && keys.every(key => Object.prototype.hasOwnProperty.call(right, key) && equal(left[key], right[key]));
  }
  const clone = value => value === undefined ? undefined : JSON.parse(JSON.stringify(value));
  function merge(base, local, remote, options = {}) {
    const conflicts = [];
    function conflict(path, left, right) {
      conflicts.push({ path: path.join(' / '), local: left === missing ? '(deleted)' : clone(left), remote: right === missing ? '(deleted)' : clone(right) });
      return options.prefer === 'remote' ? right : left;
    }
    function order(previous, left, right, path) {
      const retained = new Set([...left, ...right].filter(id => !previous.includes(id) || (left.includes(id) && right.includes(id))));
      const common = previous.filter(id => retained.has(id));
      const leftCommon = left.filter(id => common.includes(id));
      const rightCommon = right.filter(id => common.includes(id));
      const leftMoved = !equal(common, leftCommon);
      const rightMoved = !equal(common, rightCommon);
      if (leftMoved && rightMoved && !equal(leftCommon, rightCommon)) return conflict(path, left, right);
      const primary = leftMoved ? left : right;
      const secondary = leftMoved ? right : left;
      const result = primary.filter(id => retained.has(id));
      secondary.forEach((id, index) => {
        if (!retained.has(id) || result.includes(id)) return;
        const next = secondary.slice(index + 1).find(value => result.includes(value));
        const before = secondary.slice(0, index).reverse().find(value => result.includes(value));
        const insertion = before !== undefined ? result.indexOf(before) + 1 : next !== undefined ? result.indexOf(next) : result.length;
        result.splice(insertion, 0, id);
      });
      return result;
    }
    function visit(previous, left, right, path) {
      if (equal(left, previous)) return right;
      if (equal(right, previous) || equal(left, right)) return left;
      if (path.length === 1 && path[0] === 'logs' && Array.isArray(left) && Array.isArray(right)) {
        const records = new Map();
        [...left, ...right].forEach(log => {
          if (!log?.id) return;
          const existing = records.get(log.id);
          if (!existing || (!existing.undone && log.undone)) records.set(log.id, log);
        });
        return [...records.values()].sort((a, b) => (Date.parse(b.time) || 0) - (Date.parse(a.time) || 0)).slice(0, options.logLimit || 50);
      }
      if (Array.isArray(previous) && Array.isArray(left) && Array.isArray(right)) {
        if ([previous, left, right].every(items => items.every(item => object(item) && typeof item.id === 'string') && new Set(items.map(item => item.id)).size === items.length)) {
          const maps = [previous, left, right].map(items => new Map(items.map(item => [item.id, item])));
          const ids = [...new Set([...right.map(item => item.id), ...left.map(item => item.id), ...previous.map(item => item.id)])];
          const result = new Map();
          ids.forEach(id => {
            const value = visit(...maps.map(map => map.has(id) ? map.get(id) : missing), [...path, id]);
            if (value !== missing) result.set(id, value);
          });
          const newLocal = left.filter(item => !maps[0].has(item.id)).map(item => item.id);
          return [...new Set([...newLocal, ...ids])].filter(id => result.has(id)).map(id => result.get(id));
        }
        if ([previous, left, right].every(items => items.every(item => typeof item === 'string') && new Set(items).size === items.length)) return order(previous, left, right, path);
      }
      if ((object(previous) || previous === missing) && object(left) && object(right)) {
        if (previous === missing) previous = {};
        const result = {};
        for (const key of new Set([...Object.keys(previous), ...Object.keys(left), ...Object.keys(right)])) {
          if (['__proto__', 'constructor', 'prototype'].includes(key)) continue;
          const value = visit(...[previous, left, right].map(item => Object.prototype.hasOwnProperty.call(item, key) ? item[key] : missing), [...path, key]);
          if (value !== missing) result[key] = value;
        }
        return result;
      }
      return conflict(path, left, right);
    }
    const data = visit(base, local, remote, []);
    return { data: clone(data), conflicts, ok: conflicts.length === 0 || !!options.prefer };
  }
  return { equal, clone, merge };
});
