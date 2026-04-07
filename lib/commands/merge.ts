import type {Config} from '../config';
import * as util from 'util';
import type {MergeCommand, UnmergeCommand,
  CommandHandler,
} from '../cli/generated/types';
import {errx, success_color} from '../cli/errors';
import {
  abortIfNotLoggedIn,
  coronerClientFromGlobal,
  parseProjectArg,
} from '../cli/context';
import {eMsg} from '../util';
import {WorkflowsClient} from '../workflows/client';

function dump_obj(o) {
  console.log(util.inspect(o, {showHidden: false, depth: null}));
}

function _coronerMerge(coroner, universe, project, fingerprints, action) {
  const query = {
    actions: {
      fingerprint: [
        {
          type: action,
          arguments: fingerprints,
        },
      ],
    },
  };

  dump_obj(query);

  coroner.query(universe, project, query, err => {
    if (err) {
      errx(err.message);
    }
    console.log(success_color('Success.'));
  });
}

async function _workflowsMerge(coroner, universe, project, fingerprints) {
  const client = await WorkflowsClient.fromCoroner(coroner);
  try {
    await client.mergeFingerprints(universe, project, fingerprints);
    console.log(success_color('Success.'));
  } catch (err) {
    errx(eMsg(err));
  }
}

async function handleMerge(cmd: MergeCommand, config: Config): Promise<any> {
  abortIfNotLoggedIn(config);

  const {universe, project} = parseProjectArg(cmd.project, config);

  const fingerprints = cmd.fingerprints;

  const coroner = coronerClientFromGlobal(config, cmd.globalOptions);
  const isWorkflowsAvailable = await WorkflowsClient.isAvailable(coroner);
  if (isWorkflowsAvailable) {
    if (cmd.globalOptions.debug) {
      console.log('Merging using the Workflows service');
    }
    return _workflowsMerge(coroner, universe, project, fingerprints);
  } else {
    if (cmd.globalOptions.debug) {
      console.log('Merging using Coroner directly');
    }
    return _coronerMerge(coroner, universe, project, fingerprints, 'merge');
  }
}

function handleUnmerge(cmd: UnmergeCommand, config: Config): any {
  abortIfNotLoggedIn(config);

  const {universe, project} = parseProjectArg(cmd.project, config);

  const fingerprints = cmd.fingerprints;

  const coroner = coronerClientFromGlobal(config, cmd.globalOptions);
  return _coronerMerge(coroner, universe, project, fingerprints, 'unmerge');
}

export const handlers: Record<string, CommandHandler> = {
  merge: handleMerge,
  unmerge: handleUnmerge,
};
