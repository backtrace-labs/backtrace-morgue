import * as config from '../config';
import * as crdb from '../crdb';
import * as queryCli from '../cli/query';
import {errx, chalk, success_color} from '../cli/errors';
import {abortIfNotLoggedIn, coronerParams, coronerClientArgv} from '../cli/context';
import {usage, nsToUs, printSamples} from '../cli/util';
import {coronerPrint} from '../cli/print';

const yellow = chalk.yellow;
const blue = chalk.blue;

/**
 * @brief: Implements the list command.
 */
function coronerList(argv: any, config: any): any {
  abortIfNotLoggedIn(config);
  let query;
  let p;

  const coroner = coronerClientArgv(config, argv);

  if (argv._.length < 2) {
    return usage('Missing project, universe arguments');
  }

  let implicitTimeOps = true;
  if (argv['implicit-filters'] === false) {
    implicitTimeOps = false;
  }

  const csv = argv.csv;
  if (csv && !argv.select && !argv['select-wildcard'])
    return usage('--csv requires select or select-wildcard parameters');

  p = coronerParams(argv, config);

  if (!argv.table) {
    argv.table = 'objects';
  }

  const aq = queryCli.argvQuery(argv, implicitTimeOps, /*doFolds=*/ true);
  query = aq.query;
  const d_age = aq.age;

  if (argv.table != 'objects') {
    query.table = argv.table;
  }

  if (argv.set) {
    let set = argv.set;

    if (!Array.isArray(set)) set = [argv.set];

    query.set = {};
    set.forEach(s => {
      const kv = s.split('=');
      query.set[kv[0]] = kv[1];
    });
  }

  if (argv.clear) {
    let clear = argv.clear;

    if (!Array.isArray(clear)) clear = [argv.clear];

    if (!query.set) query.set = {};
    clear.forEach(c => {
      query.set[c] = null;
    });
  }

  if (argv.query) {
    console.log(JSON.stringify(query));
    if (!argv.raw) return;
  }

  if (argv.benchmark) {
    let start, end;
    let concurrency = 1;
    const samples = [];
    let n_samples = 8;
    let requests = 0;
    let i;

    if (argv.concurrency) concurrency = parseInt(argv.concurrency);

    if (argv.samples) n_samples = argv.samples;

    start = process.hrtime();

    for (i = 0; i < concurrency; i++) {
      (function queryPr() {
        requests++;

        coroner.query(p.universe, p.project, query, (err, result) => {
          samples.push(result._.latency);

          if (--n_samples == 0) {
            printSamples(
              requests,
              samples,
              start,
              process.hrtime(),
              concurrency,
            );
            return;
          }

          coroner.query(p.universe, p.project, query, queryPr);
        });
      })();
    }
  } else {
    coroner.query(p.universe, p.project, query, async (err, result) => {
      if (err) {
        errx(err.message);
      }

      if (argv.raw) {
        let pp;

        try {
          pp = JSON.stringify(result);
        } catch (err) {
          pp = result;
        }

        console.log(pp);
        return;
      }

      /*
       * Determine if we should print any data to stream to output
       * if limit option was used.
       */
      if (query.set) {
        if (result.response.result === 'success')
          console.log(success_color('Success'));
        else console.log('result:\n' + JSON.stringify(result.response));
      } else {
        const rp = new crdb.Response(result.response);

        if (argv.json) {
          const results = rp.unpack();

          console.log(JSON.stringify(results, null, 2));
          return;
        }

        await coronerPrint(
          query,
          rp,
          result.response,
          null,
          result._.runtime,
          csv,
        );

        var date_label;
        if (d_age) {
          date_label = 'as of ' + d_age + ' ago';
        } else {
          date_label = 'with a time range of ' + argv.time;
        }
      }

      if (argv.verbose) {
        console.log(yellow('Timing:'));

        let o = '';
        let aggs = result._.runtime.aggregate;
        if ('time' in aggs) aggs = aggs.time;
        else if ('pre_sort' in aggs) aggs = aggs.pre_sort + aggs.post_sort;

        o += yellow('     Rows: ') + result._.runtime.filter.rows + '\n';
        o +=
          yellow('   Filter: ') +
          result._.runtime.filter.time +
          'us (' +
          Math.ceil(
            (result._.runtime.filter.time / result._.runtime.filter.rows) *
              1000,
          ) +
          'ns / row)\n';
        o +=
          yellow('    Group: ') +
          result._.runtime.group_by.time +
          'us (' +
          Math.ceil(
            result._.runtime.group_by.time / result._.runtime.group_by.groups,
          ) +
          'us / group)\n';
        o += yellow('Aggregate: ') + aggs + 'us\n';
        o += yellow('     Sort: ') + result._.runtime.sort.time + 'us\n';
        if (result._.runtime.set) {
          o += yellow('      Set: ') + result._.runtime.set.time + 'us\n';
        }
        o += yellow('    Total: ') + result._.runtime.total_time + 'us';
        console.log(o + '\n');
      }

      const footer =
        result._.user +
        ': ' +
        result._.universe +
        '/' +
        result._.project +
        ' ' +
        date_label +
        ' [' +
        result._.latency +
        ']';
      console.log(blue(footer));
    });
  }
}

export const commands: Record<string, (argv: any, config: config.Config) => any> = {
  list: coronerList,
};
