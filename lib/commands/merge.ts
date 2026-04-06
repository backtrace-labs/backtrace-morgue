import * as util from 'util';
import * as config from '../config';
import {errx, err, success_color} from '../cli/errors';
import {abortIfNotLoggedIn, coronerParams, coronerClientArgv} from '../cli/context';
import {usage} from '../cli/util';
import {eMsg} from '../util';
import {WorkflowsClient} from '../workflows/client';

function dump_obj(o) {
  console.log(util.inspect(o, {showHidden: false, depth: null}));
}

function userUsage(error_str?: any): never {
  if (typeof error_str === 'string') err(error_str + '\n');
  console.log('Usage: morgue user reset [options]');
  console.log('Valid options:');
  console.log('  --password=P   Specify password to use for reset.');
  console.log('  --universe=U   Specify universe scope.');
  console.log('  --user=USER    Specify user to reset password for');
  process.exit(1);
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

async function mergeFingerprints(argv: any, config: any): Promise<any> {
  abortIfNotLoggedIn(config);
  if (argv._.length === 0) {
    return userUsage();
  }

  const {universe, project} = coronerParams(argv, config);
  if (!universe || !project) {
    return usage('Missing project, universe arguments');
  }

  const fingerprints = argv._.slice(2);
  if (!fingerprints.length) {
    return usage('At least one fingerprint must be specified');
  }

  const coroner = coronerClientArgv(config, argv);
  const isWorkflowsAvailable = await WorkflowsClient.isAvailable(coroner);
  if (isWorkflowsAvailable) {
    if (argv.debug) {
      console.log('Merging using the Workflows service');
    }
    return _workflowsMerge(coroner, universe, project, fingerprints);
  } else {
    if (argv.debug) {
      console.log('Merging using Coroner directly');
    }
    return _coronerMerge(coroner, universe, project, fingerprints, 'merge');
  }
}

function unmergeFingerprints(argv: any, config: any): any {
  abortIfNotLoggedIn(config);
  if (argv._.length === 0) {
    return userUsage();
  }

  const {universe, project} = coronerParams(argv, config);
  if (!universe || !project) {
    return usage('Missing project, universe arguments');
  }

  const fingerprints = argv._.slice(2);
  if (!fingerprints.length) {
    return usage('At least one fingerprint must be specified');
  }

  const coroner = coronerClientArgv(config, argv);
  return _coronerMerge(coroner, universe, project, fingerprints, 'unmerge');
}

export const commands: Record<string, (argv: any, config: config.Config) => any> = {
  merge: mergeFingerprints,
  unmerge: unmergeFingerprints,
};
