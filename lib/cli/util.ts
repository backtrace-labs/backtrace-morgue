/*
 * Small pure-ish utility functions used across CLI commands.
 */

import promptLib from 'prompt';
import {sprintf} from 'extsprintf';
import printf from 'printf';
import {chalk} from './errors';

export function nsToUs(tm: any): number {
  return Math.round(tm[0] * 1000000 + tm[1] / 1000);
}

export function oidToString(oid: number): string {
  return oid.toString(16);
}

export function oidFromString(oid: string): number {
  return parseInt(oid, 16);
}

export function objToPath(oid: string | number, resource?: string): string {
  let str = typeof oid !== 'string' ? oidToString(oid) : oid;

  if (resource) str += ':' + resource;
  else str += '.bin';
  return str;
}

export function sequence(tasks: any): Promise<any> {
  return tasks.reduce((chain, s) => {
    if (typeof s === 'function')
      return chain.then(s).catch(e => {
        return Promise.reject(e);
      });
    return chain
      .then(() => {
        return s;
      })
      .catch(e => {
        return Promise.reject(e);
      });
  }, Promise.resolve());
}

export function prompt_for(items: any): Promise<any> {
  return new Promise((resolve, reject) => {
    promptLib.get(items, (err, result) => {
      if (err) reject(err);
      else resolve(result);
    });
  });
}

export function printSamples(requests, samples, start, stop, concurrency) {
  let i;
  let sum = 0;
  let minimum, maximum, tps;

  start = nsToUs(start);
  stop = nsToUs(stop);

  for (i = 0; i < samples.length; i++) {
    const value = parseInt(samples[i]);

    sum += value;

    if (!maximum || value > maximum) maximum = value;
    if (!minimum || value < minimum) minimum = value;
  }

  sum = Math.ceil(sum / samples.length);

  tps = Math.floor(requests / ((stop - start) / 1000000));

  process.stdout.write(
    chalk.grey(
      sprintf(
        '# %12s %12s %12s %12s %12s %12s %12s\n',
        'Concurrency',
        'Requests',
        'Time',
        'Minimum',
        'Average',
        'Maximum',
        'Throughput',
      ),
    ),
  );
  process.stdout.write(
    printf(
      '  %12d %12ld %12f %12ld %12ld %12ld %12ld\n',
      concurrency,
      requests,
      (stop - start) / 1000000,
      minimum,
      sum,
      maximum,
      tps,
    ),
  );
  return;
}
