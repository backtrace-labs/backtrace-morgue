/*
 * Helper functions for building queries from CLI args.
 */
import * as chrono from 'chrono-node';

import * as timeCli from './time';
import {error_color, errx} from './errors';
import type {QueryOptions} from './generated/types';

// ---------------------------------------------------------------------------
// Query types
// ---------------------------------------------------------------------------

/** A single filter operation: [op] or [op, value] or [op, value, flags]. */
export type FilterOp = [string] | [string, string | number] | [string, string | number, Record<string, boolean>];

/** Filter map: attribute name → array of filter operations. */
export type FilterMap = Record<string, FilterOp[]>;

/** Sort term for query results. */
export interface SortTerm {
  name: string;
  ordering: 'ascending' | 'descending';
}

/** Virtual column definition (quantize_uint). */
export interface VirtualColumn {
  name: string;
  type: 'quantize_uint';
  quantize_uint: {
    backing_column: string;
    size: number;
    offset: number;
  };
}

/** The query object sent to the coroner API. */
export interface Query {
  template?: string;
  limit?: string;
  offset?: string;
  filter: FilterMap[];
  order?: SortTerm[];
  group?: string[];
  fold?: Record<string, (string | number)[][]>;
  select?: string[];
  select_wildcard?: Record<string, boolean>;
  virtual_columns?: VirtualColumn[];
  set?: Record<string, string | null>;
  table?: string;
}

/** Result of buildQuery / buildQueryFilterOnly. */
export interface QueryResult {
  query: Query;
  age: string | null;
}

// ---------------------------------------------------------------------------
// Shared parse helpers
// ---------------------------------------------------------------------------

function parseSortTerm(term: string): SortTerm {
  if (term[0] === '-') {
    return {name: term.slice(1), ordering: 'descending'};
  }
  return {name: term, ordering: 'ascending'};
}

function parseFilterFlags(input: string): Record<string, boolean> {
  const parts = input.split(',');
  if (parts.length < 4) {
    return {};
  }

  const flags: Record<string, boolean> = {};
  const known_flags = new Set(['case_insensitive']);
  for (const f of parts.slice(3)) {
    const transformed = f.replace('-', '_');
    if (!known_flags.has(transformed)) {
      errx(`Unknown filter flag ${f}`);
    }
    flags[transformed] = true;
  }
  return flags;
}

export function parseFilter(input: string): {attribute: string; filter: FilterOp} {
  const [attribute, op, value, flags] = input.split(',');
  if (!attribute || !op) {
    errx('Filter must be of form <column>,<operation>[,<value>].');
  }

  let parsedValue: string | number | undefined = value;
  if (attribute === '_tx' && value && typeof value === 'string') {
    // Convert 0x hex values
    const rr = value.split('x');
    if (rr.length === 2) {
      parsedValue = parseInt(rr[1], 16);
    }
  }

  if (!parsedValue) {
    return {attribute, filter: [op]};
  } else if (!flags) {
    return {attribute, filter: [op, parsedValue]};
  } else {
    return {attribute, filter: [op, parsedValue, parseFilterFlags(input)]};
  }
}

// ---------------------------------------------------------------------------
// Query builder internals
// ---------------------------------------------------------------------------

function quantizeUintFromOpts(opts: QueryOptions): VirtualColumn[] {
  const q = opts.quantizeUint;
  if (!q || q.length === 0) return [];

  return q.map(a => {
    const segs = a.split(',');
    if (segs.length < 3) {
      errx(
        'Quantize column definition is of the form output_name,backing_column,size,[offset]',
      );
    }
    const [name, backing, sizeStr, offsetStr] = segs;
    const parsedSize = timeCli.parseTimeInt(sizeStr);
    const parsedOffset = timeCli.parseTimeInt(offsetStr ?? '0');
    return {
      name,
      type: 'quantize_uint' as const,
      quantize_uint: {backing_column: backing, size: parsedSize, offset: parsedOffset},
    };
  });
}

function buildQueryPrefold(opts: QueryOptions, implicitTimestampOps: boolean): QueryResult {
  if (opts.rawQuery) {
    return {query: JSON.parse(opts.rawQuery), age: null};
  }

  const query: Query = {
    filter: [{}],
  };
  let d_age: string | null = null;
  let ts_attr = 'timestamp';

  if (
    opts.table === 'unique_aggregations' ||
    opts.table === 'unique_aggregations_coarse'
  ) {
    ts_attr = '_end_timestamp';
  }

  if (opts.timestampAttribute && opts.timestampAttribute.length > 0)
    ts_attr = opts.timestampAttribute;

  if (opts.template) query.template = opts.template;
  if (opts.limit) query.limit = opts.limit;
  if (opts.offset) query.offset = opts.offset;

  // filter is already string[] from commander (no normalization needed)
  if (opts.filter) {
    const filters = Array.isArray(opts.filter) ? opts.filter : [opts.filter];
    for (const f of filters) {
      const {attribute, filter} = parseFilter(f);
      if (!query.filter[0][attribute]) query.filter[0][attribute] = [];
      query.filter[0][attribute].push(filter);
    }
  }

  if (opts.sort && opts.sort.length > 0) {
    query.order = opts.sort.map(parseSortTerm);
  }

  if (!query.filter[0][ts_attr] && implicitTimestampOps)
    query.filter[0][ts_attr] = [];

  if (opts.time) {
    if (query.filter[0][ts_attr] && query.filter[0][ts_attr].length > 0)
      errx('Cannot mix --time and timestamp filters');

    const tm = chrono.parse(opts.time);
    let ts_s: number | undefined;
    let ts_e: number | undefined;

    if (tm.length === 0) errx('invalid time specifier "' + opts.time + '"');

    if (tm.length > 1) {
      if (tm.length === 2) {
        if (tm[0].start && tm[1].start && !tm[0].end && !tm[1].end) {
          ts_s = tm[0].start.date().getTime();
          ts_e = tm[1].start.date().getTime();
        }
      }
      if (!ts_s) errx(error_color('only a single date or range is permitted.'));
    } else {
      if (!tm[0].start)
        errx(error_color('date specification lacks start date'));
      if (!tm[0].end) errx(error_color('date specification lacks end date'));
      ts_s = tm[0].start.date().getTime();
      ts_e = tm[0].end.date().getTime();
    }

    ts_s = Math.floor(ts_s! / 1000);
    if (ts_s === 0) ts_s = 1;
    ts_e = Math.floor(ts_e! / 1000);

    query.filter[0][ts_attr] = [
      ['at-least', ts_s],
      ['less-than', ts_e],
    ];
    d_age = null;
  }

  if (opts.factor) query.group = [opts.factor];

  query.virtual_columns = quantizeUintFromOpts(opts);

  if (opts.template === 'select') {
    // no-op: server-side template handles selection
  } else if (opts.select || opts.selectWildcard) {
    if (opts.select) {
      query.select = Array.isArray(opts.select) ? [...opts.select] : [opts.select];
    }
    if (opts.selectWildcard) {
      if (!query.select_wildcard) query.select_wildcard = {};
      const wildcards = Array.isArray(opts.selectWildcard)
        ? [opts.selectWildcard]
        : [opts.selectWildcard];
      for (const w of wildcards) {
        query.select_wildcard[w] = true;
      }
    }
  } else if (opts.table === 'objects' && implicitTimestampOps) {
    if (!query.fold) query.fold = {};
    query.fold[ts_attr] = [['range'], ['bin']];
  }

  if (opts.fingerprint) {
    if (Array.isArray(opts.fingerprint))
      errx('Only one fingerprint argument can be specified.');

    const length = String(opts.fingerprint).length;
    const op = length === 64 ? 'equal' : 'regular-expression';
    const ar = length === 64 ? opts.fingerprint : '^' + opts.fingerprint;

    if (!query.filter[0].fingerprint) query.filter[0].fingerprint = [];
    query.filter[0].fingerprint.push([op, ar]);
  }

  if (opts.age) {
    if (query.filter[0][ts_attr] && query.filter[0][ts_attr].length > 0)
      errx('Cannot mix --age and timestamp filters');
    d_age = opts.age;
  } else if (
    !query.filter[0][ts_attr] ||
    query.filter[0][ts_attr].length === 0
  ) {
    d_age = '1M';
  }

  if (d_age && implicitTimestampOps) {
    const now = Date.now();
    const target = now / 1000 - timeCli.timespecToSeconds(d_age);
    const oldest = Math.floor(target);

    query.filter[0][ts_attr] = [['at-least', oldest]];

    const range_start = oldest;
    const range_stop = Math.floor(now / 1000);

    if (query.fold && query.fold[ts_attr] && implicitTimestampOps) {
      const ft = query.fold[ts_attr];
      for (let i = 0; i < ft.length; i++) {
        if (ft[i][0] === 'bin') {
          ft[i] = ft[i].concat([32, range_start, range_stop]);
        }
      }
    }
  }

  if (opts.table === 'objects') {
    if (
      !query.filter[0][ts_attr] ||
      (query.filter[0][ts_attr].length === 0 && implicitTimestampOps)
    ) {
      if (!query.filter[0][ts_attr]) query.filter[0][ts_attr] = [];
      query.filter[0][ts_attr].push(['greater-than', 0]);
    }
  }

  return {query, age: d_age};
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Build a query from typed QueryOptions.
 */
export function buildQuery(
  opts: QueryOptions,
  implicitTimeOps = false,
  doFolds = false,
): QueryResult {
  const {query, age} = buildQueryPrefold(opts, implicitTimeOps);

  if (!doFolds) return {query, age};

  function fold(q: Query, attribute: string | string[], label: string): void {
    if (!q.fold) q.fold = {};
    const attrs = Array.isArray(attribute) ? attribute : [attribute];

    for (const attr of attrs) {
      const parts = attr.split(',');
      const col = parts.shift()!;
      const modifiers: number[] = parts.map(m => {
        const n = parseInt(m);
        if (isNaN(n)) errx('Modifiers must be integers.');
        return n;
      });
      if (!q.fold[col]) q.fold[col] = [];
      q.fold[col].push([label, ...modifiers]);
    }
  }

  const folds: [string | string[] | undefined, string][] = [
    [opts.last, 'last'],
    [opts.first, 'first'],
    [opts.tail, 'tail'],
    [opts.head, 'head'],
    [opts.object, 'object'],
    [opts.histogram, 'histogram'],
    [opts.distribution, 'distribution'],
    [opts.unique, 'unique'],
    [opts.mean, 'mean'],
    [opts.min, 'min'],
    [opts.max, 'max'],
    [opts.sum, 'sum'],
    [opts.bin, 'bin'],
    [opts.range, 'range'],
    [opts.count, 'count'],
  ];

  for (const [attr, op] of folds) {
    if (attr) fold(query, attr, op);
  }

  return {query, age};
}

/**
 * Filter-only variant of buildQuery for commands like delete/reprocess.
 */
export function buildQueryFilterOnly(opts: QueryOptions): QueryResult | null {
  if (
    opts.select ||
    opts.filter ||
    opts.fingerprint ||
    opts.age ||
    opts.time ||
    opts.selectWildcard
  ) {
    if (!opts.select && !opts.selectWildcard && !opts.template) {
      opts = {...opts, select: ['object']};
    }
    return buildQuery(opts);
  }
  return null;
}

//-- vim:ts=2:et:sw=2
