/*
 * Output formatting: print query results, callstacks, histograms, etc.
 */

import printf from 'printf';
import * as ta from 'time-ago';
import ipv6 from 'ip6addr';
import {bar} from '../../bin/bar';
import {histogram} from '../../bin/histogram';
import {Callstack, CallstackOptions} from '../callstack';
import {createObjectCsvWriter as createCsvWriter} from 'csv-writer';
import {chalk, success_color} from './errors';

const bold = chalk.bold;
const green = chalk.green;
const red = chalk.red;
const yellow = chalk.yellow;
const label_color = yellow.bold;

/*
 * Module-level state for callstack error dedup.
 * Set via initPrint() from the entry point.
 */
let callstackError = false;
let btClient: any = null;

export function initPrint(opts: {btClient?: any}): void {
  btClient = opts.btClient;
}

export interface CallstackPrintOptions {
  verbose?: boolean;
  l?: boolean;
  collapse?: boolean;
  suffix?: string;
}

export function uint128ToUuid(uint128: any): string {
  const uuid_sizes = [8, 4, 4, 4, 12];
  const uint128_pattern = /^[0-9a-f]{32,32}$/;
  const parts = [];

  if (!uint128_pattern.test(uint128)) return uint128;

  for (
    let i = 0, step = 0, size = uuid_sizes[i];
    i < uuid_sizes.length;
    i++, size = uuid_sizes[i], step += size
  )
    parts.push(uint128.slice(step, step + size));

  return parts.join('-');
}

export function uint128ToIpv6(uint128: any): string {
  // already an ipv6 address
  if (typeof uint128 === 'string' && uint128.includes(':')) {
    return ipv6.parse(uint128).toString();
  }

  const bytes = Buffer.from(uint128.padStart(32, '0'), 'hex');
  const parts = [];

  for (let i = 0; i < 16; i += 2) {
    parts.push(
      bytes
        .subarray(i, i + 2)
        .toString('hex')
        .padStart(1, '0'),
    );
  }

  const ipv6Str = parts.join(':') || '::';
  return ipv6.parse(ipv6Str).toString();
}

export function fieldFormat(st: any, format: any): string {
  switch (format) {
    case 'memory_address':
      return printf('%#lx', st);
    case 'kilobytes':
      return st + ' kB';
    case 'megabytes':
      return st + ' MB';
    case 'gigabytes':
      return st + ' GB';
    case 'bytes':
      return st + ' B';
    case 'ipv4':
      var ipl = parseInt(st);
      return `${ipl >>> 24}.${(ipl >> 16) & 255}.${(ipl >> 8) & 255}.${ipl & 255}`;
    case 'ipv6':
      return uint128ToIpv6(st);
    case 'gps_timestamp':
    case 'unix_timestamp':
      return String(new Date(parseInt(st) * 1000));
    case 'js_timestamp':
      return String(new Date(parseInt(st)));
    case 'seconds':
      return st + ' sec';
    case 'milliseconds':
      return st + ' ms';
    case 'nanoseconds':
      return st + ' ns';
    case 'uuid':
      return uint128ToUuid(st);
    default:
      return st;
  }
}

export function rangePrint(field: any, factor: any): void {
  console.log(field[0] + ' - ' + field[1] + ' (' + (field[1] - field[0]) + ')');
}

export function binPrint(field, factor, ff) {
  const data: any = {};
  let j = 0;
  let i;
  const format = '%20s %20s';

  if (field.length === 0) return false;

  for (i = 0; i < field.length; i++) {
    var label;

    if (field[i].length === 0) continue;

    label = printf(
      format,
      fieldFormat(field[i][0], ff),
      fieldFormat(field[i][1], ff),
    );
    data[label] = field[i][2];
    j++;
  }

  if (j === 0) return false;

  process.stdout.write('\n');
  console.log(
    histogram(data, {
      sort: false,
      width: 10,
      bar: '\u2586',
    }),
  );

  return true;
}

export function histogramPrint(field, unused, format) {
  const data: any = {};
  let j = 0;
  let i;

  for (i = 0; i < field.length; i++) {
    if (field[i].length === 0) continue;

    data[fieldFormat(field[i][0], format)] = field[i][1];
    j++;
  }

  if (j === 0) return false;

  process.stdout.write('\n');
  console.log(
    histogram(data, {
      sort: true,
      bar: '\u2586',
      width: 40,
    }),
  );

  return true;
}

export function distributionPrint(field, unused, format) {
  const distribution = field[0];
  const data = distribution.vals;
  const tail_sum = distribution.tail || 0;
  const total_sum = tail_sum + data.reduce((s, v) => s + v[1], 0);

  console.log(distribution.keys + ' keys total, with a count of ' + total_sum);
  histogramPrint(data, unused, format);
}

export function unaryPrint(field, unused, format) {
  console.log(fieldFormat(field[0], format));
  return true;
}

export function noFormatPrint(field, unused, format) {
  console.log(field[0]);
  return true;
}

export function callstackPrint(cs: any, opts?: CallstackPrintOptions): void {
  let callstack;
  let frames, i, length;
  const o = opts || {};

  if (!cs || cs.length === 0) {
    console.log('');
    return;
  }

  try {
    callstack = JSON.parse(cs);
  } catch (error) {
    if (callstackError === false) {
      if (btClient) btClient.send(error as Error);
      callstackError = true;
    }

    console.log(' ' + cs);
    return;
  }

  frames = callstack.frame;
  if (frames === undefined) {
    console.log(cs);
    return;
  }

  process.stdout.write('\n    ');

  length = 4;

  if (!o.verbose && !o.l) {
    const csOpts: CallstackOptions = {};
    const label = new Callstack(frames);

    if (o.collapse) csOpts.dynamic = true;
    if (o.suffix) {
      csOpts.suffix = parseInt(o.suffix);
      csOpts.dynamic = false;
    }

    frames = label.render(csOpts);
  }

  for (i = 0; i < frames.length; i++) {
    length += frames[i].length + 4;

    if (i !== 0 && length >= 76) {
      process.stdout.write('\n    ');
      length = frames[i].length + 4;
    }

    if (i === frames.length - 1) {
      process.stdout.write(frames[i]);
    } else {
      process.stdout.write(frames[i] + ' ← ');
    }
  }

  process.stdout.write('\n');
}

export function objectPrint(g, object, renderer, fields, runtime) {
  let string = String(g);
  let field, start, stop, sa;

  if (string.length > 28) {
    string = printf('%-28s...', string.substring(0, 28));
  } else {
    string = printf('%-31s', string);
  }

  process.stdout.write(bold(string) + ' ');

  /* This means that no aggregation has occurred. */
  if (object.length) {
    let i;
    let a;

    process.stdout.write('\n');

    for (i = 0; i < object.length; i++) {
      const ob = object[i];
      const label = printf('#%-7x ', ob.object);

      process.stdout.write(green.bold(label));

      if (ob.timestamp) {
        process.stdout.write(
          new Date(ob.timestamp * 1000) +
            '     ' +
            bold(ta.ago(ob.timestamp * 1000)) +
            '\n',
        );
      } else {
        process.stdout.write('\n');
      }

      for (a in ob) {
        if (a === 'object') continue;

        if (a === 'timestamp') continue;

        if (a === 'callstack') continue;

        console.log(
          '  ' + label_color(a) + ': ' + fieldFormat(ob[a], fields[a]),
        );
      }

      /*
       * If a callstack is present then render it in a pretty fashion.
       */
      if (ob.callstack) {
        process.stdout.write(label_color(`  ${fields[a]}:`));
        callstackPrint(ob.callstack);
      }
    }

    return;
  }

  const timestamp_bin = object['bin(timestamp)'];
  if (timestamp_bin) {
    bar(timestamp_bin, null, null);
    process.stdout.write(' ');
  }

  const timestamp_range = object['range(timestamp)'];
  if (timestamp_range) {
    start = new Date(timestamp_range[0] * 1000);
    stop = new Date(timestamp_range[1] * 1000);
    sa = ta.ago(stop) + '\n';

    process.stdout.write(success_color(sa));
  }

  if (timestamp_range) {
    console.log(label_color('First Occurrence: ') + start);
    if (timestamp_range[0] !== timestamp_range[1])
      console.log(label_color(' Last Occurrence: ') + stop);
  }

  if (object.count) {
    let label = object.count + '';

    if (runtime && runtime.filter && runtime.filter.rows > 0) {
      label += printf(' (%.2f%%)', (object.count / runtime.filter.rows) * 100);
    }

    console.log(label_color('     Occurrences: ') + label);
  }

  for (field in object) {
    var match;

    if (field === 'count') continue;

    match = field.indexOf('(');
    if (match > -1) {
      match = field.substring(0, match);
    }

    /*
     * This is terribly ugly. We special-case management of timestamp for
     * pretty-printing purposes.
     */
    if (
      field.indexOf('timestamp') > -1 &&
      (field.indexOf('bin(') > -1 || field.indexOf('range(') > -1)
    ) {
      continue;
    }

    process.stdout.write(label_color(`${field}: `));

    if (fields[field] === 'callstack') {
      callstackPrint(object[field]);
      continue;
    }

    if (!renderer[match]) {
      console.log(object[field]);
      continue;
    }

    if (
      renderer[match](object[field], label_color(field), fields[field]) ===
      false
    )
      console.log(object[field]);
  }
}

export async function coronerPrint(query, rp, raw, columns, runtime, csvPath) {
  const results = rp.unpack();
  const fields = rp.fields();
  let g;
  const renderer = {
    first: unaryPrint,
    last: unaryPrint,
    head: unaryPrint,
    tail: unaryPrint,
    unique: noFormatPrint,
    mean: noFormatPrint,
    min: noFormatPrint,
    max: noFormatPrint,
    object: noFormatPrint,
    sum: unaryPrint,
    histogram: histogramPrint,
    distribution: distributionPrint,
    quantize: binPrint,
    bin: binPrint,
    range: rangePrint,
  };
  const empty = results && results['*'] && results['*'].length === 0;

  let csvWriter = undefined;

  if (csvPath && !empty) {
    let header = Object.keys(rp._fields).map(n => {
      return {id: n, title: n};
    });

    header = header.concat([
      {title: 'object', id: 'object'},
      {title: 'id', id: 'id'},
    ]);
    csvWriter = createCsvWriter({path: csvPath, header: header, append: true});
  }

  for (g in results) {
    if (csvWriter) {
      if (results[g]) await csvWriter.writeRecords(results[g]);
    } else {
      objectPrint(g, results[g], renderer, fields, runtime);
    }

    if (!csvWriter) process.stdout.write('\n');
  }

  return;
}

/*
 * Print frames in j, relative to availability in k. Different functions
 * are bolded accordingly.
 */
export function printFrame(fr_a: any, fr_b: any): string {
  let pcs = '';
  let ln = 0;

  for (let j = 0; j < fr_a.length; j++) {
    if (j > 0) {
      pcs += ' ← ';
      ln += 3;
    }

    ln += fr_a[j].length;
    if (ln > 80) {
      if (j > 0) pcs += '\n        ';

      ln = 0;
    }

    if (j < fr_b.length) {
      if (fr_a[j] !== fr_b[j]) {
        if (fr_b.indexOf(fr_a[j]) <= 0) {
          pcs += red.bold(fr_a[j]);
        } else {
          pcs += yellow(fr_a[j]);
        }
      } else {
        pcs += fr_a[j];
      }
    } else {
      pcs += red.bold(fr_a[j]);
    }
  }

  return pcs;
}
