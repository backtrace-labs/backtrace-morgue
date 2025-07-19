/**
 * Module dependencies.
 */

import fmt from 'printf';

/**
 * Expose `histogram()`.
 */

interface DataItem {
  key: string;
  val: number;
}

interface HistogramOptions {
  width?: number;
  bar?: string;
  map?: (val: number) => any;
  sort?: boolean;
}

/**
 * Return ascii histogram of `data`.
 *
 * @param {Object} data
 * @param {Object} [opts]
 * @return {String}
 * @api public
 */

export function histogram(
  data: Record<string, number> | DataItem[],
  opts?: HistogramOptions,
): string {
  opts = opts || {};

  // options

  const width = opts.width || 60;
  const barc = opts.bar || '#';
  const map = opts.map || noop;

  // normalize data

  let dataArray = toArray(data);
  if (opts.sort) dataArray = dataArray.sort(descending);

  const maxKey = max(
    dataArray.map(d => {
      return d.key.length;
    }),
  );
  const maxVal = max(
    dataArray.map(d => {
      return d.val;
    }),
  );
  let str = '';

  // blah blah histo

  for (let i = 0; i < dataArray.length; i++) {
    const d = dataArray[i];
    if (d.key === '') d.key = '--';
    const p = d.val / maxVal || 1;
    const shown = Math.round(width * p);
    const blank = width - shown;
    let bar = Array(shown + 1).join(barc);
    bar += Array(blank + 1).join(' ');
    if (i > 0) str += '\n';

    str += fmt('  %*s %s %s', d.key, maxKey, bar, map(d.val));
  }

  return str;
}

/**
 * Sort descending.
 */

function descending(a: DataItem, b: DataItem): number {
  return b.val - a.val;
}

/**
 * Return max in array.
 */

function max(data: number[]): number {
  let n = data[0];

  for (let i = 1; i < data.length; i++) {
    n = data[i] > n ? data[i] : n;
  }

  return n;
}

/**
 * Turn object into an array.
 */

function toArray(obj: Record<string, number> | DataItem[]): DataItem[] {
  if (Array.isArray(obj)) {
    return obj;
  }
  return Object.keys(obj).map(key => {
    return {
      key: key,
      val: obj[key],
    };
  });
}

/**
 * Noop map function.
 */

function noop(val: number): number {
  return val;
}
//-- vim:ts=2:et:sw=2
