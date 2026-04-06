import * as config from '../config';
import * as crdb from '../crdb';
import * as queryCli from '../cli/query';
import {success_color} from '../cli/errors';
import {abortIfNotLoggedIn, coronerParams, coronerClientArgv} from '../cli/context';
import {usage, oidToString} from '../cli/util';
import {std_failure_cb} from '../cli/bpg-helpers';

function unpackQueryObjects(objects: any, qresult: any): void {
  const response = new crdb.Response(qresult.response);
  const rp: any = response.unpack();

  if (rp['*']) {
    rp['*'].forEach(o => {
      objects.push(oidToString(o.object));
    });
  }
}

function coronerRepair(argv: any, config: any): any {
  abortIfNotLoggedIn(config);
  const params = coronerParams(argv, config);
  let coroner = coronerClientArgv(config, argv);

  if (argv._.length < 2) {
    return usage('Missing universe, project arguments.');
  }

  coroner = coronerClientArgv(config, argv);

  params.action = 'reload';
  params.recovery = true;

  coroner
    .promise('control', params)
    .then(result =>
      console.log(
        success_color('Reprocessing request #' + result.id + ' queued.'),
      ),
    )
    .catch(std_failure_cb);
}

/**
 * @brief Implements the reprocess command.
 */
function coronerReprocess(argv: any, config: any): any {
  abortIfNotLoggedIn(config);
  const params = coronerParams(argv, config);
  let coroner;
  let n_objects;
  let aq: any = {};

  if (argv._.length < 2) {
    return usage('Missing universe, project arguments.');
  }

  params.action = 'reload';
  if (argv.first) params.first = oidToString(argv.first);
  if (argv.last) params.last = oidToString(argv.last);

  aq = queryCli.argvQueryFilterOnly(argv);
  coroner = coronerClientArgv(config, argv);

  /* Check for a query parameter to be sent. */
  n_objects = argv._.length - 2;

  if (n_objects > 0 && aq && aq.query) {
    return usage('Cannot specify both a query and a set of objects.');
  }

  const success_cb = function (result) {
    console.log(
      success_color('Reprocessing request #' + result.id + ' queued.'),
    );
  };

  if (aq && aq.query) {
    params.objects = [];
    coroner
      .promise('query', params.universe, params.project, aq.query)
      .then(r => {
        unpackQueryObjects(params.objects, r);
        if (params.objects.length === 0)
          return Promise.reject(new Error('No matching objects.'));
        return coroner.promise('control', params);
      })
      .then(result => success_cb(result))
      .catch(std_failure_cb);
  } else {
    if (n_objects > 0) {
      /* May specify just --first or --last, or just all objects. */
      params.objects = argv._.slice(2);
    }
    coroner
      .promise('control', params)
      .then(result => success_cb(result))
      .catch(std_failure_cb);
  }
}

export const commands: Record<string, (argv: any, config: config.Config) => any> = {
  repair: coronerRepair,
  reprocess: coronerReprocess,
};
