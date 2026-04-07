import type {Config} from '../config';
import * as crdb from '../crdb';
import * as queryCli from '../cli/query';
import type {RepairCommand, ReprocessCommand,
  CommandHandler,
  CommandHandlerMap,
} from '../cli/generated/types';
import {success_color} from '../cli/errors';
import {
  abortIfNotLoggedIn,
  coronerClientFromGlobal,
  parseProjectArg,
} from '../cli/context';
import {oidToString} from '../cli/util';
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

function handleRepair(cmd: RepairCommand, config: Config): any {
  abortIfNotLoggedIn(config);

  const p = parseProjectArg(cmd.project, config);
  const coroner = coronerClientFromGlobal(config, cmd.globalOptions);

  const params: any = {
    ...p,
    action: 'reload',
    recovery: true,
  };

  coroner
    .promise('control', params)
    .then(result =>
      console.log(
        success_color('Reprocessing request #' + result.id + ' queued.'),
      ),
    )
    .catch(std_failure_cb);
}

function handleReprocess(cmd: ReprocessCommand, config: Config): any {
  abortIfNotLoggedIn(config);

  const p = parseProjectArg(cmd.project, config);
  const coroner = coronerClientFromGlobal(config, cmd.globalOptions);

  const params: any = {
    ...p,
    action: 'reload',
  };

  if (cmd.first) params.first = cmd.first;
  if (cmd.last) params.last = cmd.last;

  // Check for target objects vs query filter
  const targets = cmd.target || [];
  const hasTargets = targets.length > 0;

  // Build a filter-only query from the reprocess command's query options
  // Note: ReprocessCommand doesn't have queryOptions in the generated types,
  // so filter-based reprocessing would need the legacy path for now.
  // For direct object reprocessing, targets are available typed.

  const success_cb = function (result) {
    console.log(
      success_color('Reprocessing request #' + result.id + ' queued.'),
    );
  };

  if (hasTargets) {
    params.objects = targets;
    coroner
      .promise('control', params)
      .then(result => success_cb(result))
      .catch(std_failure_cb);
  } else {
    coroner
      .promise('control', params)
      .then(result => success_cb(result))
      .catch(std_failure_cb);
  }
}

export const handlers = {
  repair: handleRepair,
  reprocess: handleReprocess,
} satisfies Partial<CommandHandlerMap>;
