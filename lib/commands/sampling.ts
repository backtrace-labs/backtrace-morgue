import {sprintf} from 'extsprintf';
import printf from 'printf';
import type {
  SamplingStatusCommand,
  SamplingResetCommand,
  SamplingConfigureCommand,
  CommandHandler,
} from '../cli/generated/types';
import * as config from '../config';
import type {Config} from '../config';
import {err, errx, chalk, success_color, error_color} from '../cli/errors';
import {abortIfNotLoggedIn, coronerClientFromGlobal, coronerBpgFromGlobal, parseProjectArg, getDefaultUniverse} from '../cli/context';
import {std_success_cb, std_failure_cb} from '../cli/bpg-helpers';
import * as timeCli from '../cli/time';

const yellow = chalk.yellow;

type SamplingCommand = SamplingStatusCommand | SamplingResetCommand | SamplingConfigureCommand;

function samplingParamsFromCmd(coroner: any, action: string, cmd: SamplingCommand, config: Config) {
  const params: any = {};

  // Parse project arg if present
  if (cmd.project) {
    const a = cmd.project.split('/');
    if (a.length === 2) {
      params.universe = a[0];
      params.project = a[1];
    } else {
      params.project = a[0];
    }
  }

  if (cmd.globalOptions.universe) {
    params.universe = cmd.globalOptions.universe;
  }

  // Fall back to config universe
  if (!params.universe) {
    params.universe = getDefaultUniverse(config);
  }

  params.action = action;

  if ('fingerprint' in cmd && cmd.fingerprint) {
    params.fingerprints = Array.isArray(cmd.fingerprint) ? cmd.fingerprint : [cmd.fingerprint];
  }

  params.token = coroner.config.token;
  return params;
}

function samplingPost(coroner: any, params: any): Promise<any> {
  return coroner.promise('post', '/api/sampling', null, params, null);
}

function samplingBucketFor(buckets: any, count: any): any {
  let b, i;
  let total = 0;

  for (i = 0; i < buckets.length; i++) {
    b = buckets[i];
    total += b.count;
    if (total > count) break;
  }
  if (i === buckets.length) return null;

  return b;
}

function strHashCode(str: string): number {
  let hash = 0,
    i,
    chr;
  if (str.length === 0) return hash;
  for (i = 0; i < str.length; i++) {
    chr = str.charCodeAt(i);
    hash = (hash << 5) - hash + chr;
    hash |= 0; /* convert to 32-bit int */
  }
  return hash;
}

function samplingStatusProject(cmd: SamplingStatusCommand, config: Config, universe: any, project: any) {
  const name = sprintf('%s/%s', universe.name, project.name);
  let top_line = '';
  const backoffs = project.backoffs;
  let buckets;
  let last;
  let next;
  let next_time;
  let now;
  let bucket;
  let group;
  let groups;
  let max_groups;
  let i;

  if (project.error) {
    console.log(error_color(sprintf('%s: %s', name, project.error)));
    return;
  }

  if (!backoffs) {
    console.log(sprintf('%s: Sampling not configured.', name));
    return;
  }

  if (!backoffs.groups || backoffs.groups.length === 0) {
    console.log(sprintf('%s: No groups yet.', name));
    return;
  }

  if (cmd.all) {
    max_groups = -1;
  } else {
    max_groups = parseInt(cmd.maxGroups);
    if (isNaN(max_groups)) max_groups = 16;
  }

  buckets = sprintf(
    'reset interval %s, buckets:',
    timeCli.secondsToTimespec(backoffs.reset_interval),
  );
  backoffs.backoffs.forEach(bucket => {
    buckets += sprintf(
      ' %d/%s',
      bucket.count,
      timeCli.secondsToTimespec(bucket.interval),
    );
  });
  top_line = sprintf('%d groups tracking', backoffs.groups.length);
  if (backoffs.missing_symbols > 0) {
    top_line += sprintf(
      ' (%d objects missing symbols, of which %d are private)',
      backoffs.missing_symbols,
      backoffs.private_missing_symbols,
    );
  }

  if (cmd.verbose && backoffs.accepts) {
    top_line += sprintf(
      ' (accepts %d rejects %d misses %d failures %d)',
      backoffs.accepts,
      backoffs.rejects,
      backoffs.misses,
      backoffs.failures,
    );
  }

  now = Math.round(new Date().valueOf() / 1000);
  console.log(sprintf('%s:', name));
  console.log(sprintf('  %s', buckets));
  console.log(sprintf('  %s:', top_line));
  groups = backoffs.groups.sort((a, b) => {
    if (a.count !== b.count) return b.count - a.count;
    if (a.last_accept !== b.last_accept) return b.last_accept - a.last_accept;
    return strHashCode(a.id) - strHashCode(b.id);
  });

  for (i = 0; i < groups.length; i++) {
    if (max_groups === 0) {
      break;
    } else if (i === max_groups) {
      console.log(
        sprintf('    ... truncating %d groups ...', groups.length - max_groups),
      );
      break;
    }

    group = groups[i];
    last = new Date(group.last_accept * 1000);
    bucket = samplingBucketFor(backoffs.backoffs, group.count);
    if (!bucket) {
      next = 'after reset';
    } else {
      next_time = group.last_accept + bucket.interval;
      if (next_time < now) {
        next = 'at any time';
      } else {
        next = sprintf('after %s', timeCli.secondsToTimespec(next_time - now));
      }
    }
    console.log(
      sprintf(
        '    "%s": %d objects, last accept _tx=%s on %s, next %s',
        group.id ? group.id : 'unknown',
        group.count,
        group.last_accept_txid
          ? group.last_accept_txid.toString(16)
          : 'unknown',
        last.toString(),
        next,
      ),
    );
  }
}

function samplingStatus(cmd: SamplingStatusCommand, config: Config) {
  abortIfNotLoggedIn(config);
  const coroner = coronerClientFromGlobal(config, cmd.globalOptions);
  const params = samplingParamsFromCmd(coroner, 'status', cmd, config);

  samplingPost(coroner, params)
    .then(r => {
      if (r.universes) {
        if (r.universes.length === 0) {
          console.log('No groups yet.');
        } else {
          r.universes.forEach(universe => {
            if (universe.projects.length === 0) {
              console.log(sprintf('%s: No groups yet.', universe.name));
            } else {
              universe.projects.forEach(project => {
                samplingStatusProject(cmd, config, universe, project);
              });
            }
          });
        }
      } else {
        errx('Sampling not configured.');
      }
    })
    .catch(std_failure_cb);
}

function samplingReset(cmd: SamplingResetCommand, config: Config) {
  abortIfNotLoggedIn(config);
  const coroner = coronerClientFromGlobal(config, cmd.globalOptions);
  const params = samplingParamsFromCmd(coroner, 'reset', cmd, config);

  samplingPost(coroner, params).then(std_success_cb).catch(std_failure_cb);
}

function parseBool(value: any): boolean {
  if (typeof value === 'boolean') {
    return value;
  }
  if (typeof value === 'number') {
    return value != 0;
  }
  const recognized_bools = new Set(['yes', 'true', 'on', '1']);
  return recognized_bools.has(value);
}

function samplingConfigFromCmd(cmd: SamplingConfigureCommand): any {
  /*
   * For now all we support is backoff; don't expose as an arg.
   */
  const type = 'backoff';

  let attributes: string[] = [];
  if (cmd.attribute !== undefined) {
    attributes = Array.isArray(cmd.attribute) ? cmd.attribute : [cmd.attribute];
  }

  let backoffsUnparsed = cmd.backoff;
  if (backoffsUnparsed === undefined) {
    errx('At least one --backoff is required');
  }
  const backoffList = Array.isArray(backoffsUnparsed) ? backoffsUnparsed : [backoffsUnparsed];

  /*
   * Each backoff is count,interval.
   */
  const backoffs = [];
  for (const unparsed of backoffList) {
    const split = unparsed.split(',');
    if (split.length !== 2) {
      errx('--backoff must be of form count,interval');
    }
    const [countStr, intervalStr] = split;
    const interval = timeCli.parseTimeInt(intervalStr);
    const count = Number.parseInt(countStr);
    if (Number.isNaN(count)) {
      errx('Backoff counts must be valid integers');
    }
    backoffs.push({count, interval});
  }

  /* Set the non-optional fields. */
  const samplingConfig: any = {
    type,
    backoffs,
    object_attributes: attributes,
  };

  if (cmd.resetInterval !== undefined) {
    samplingConfig.reset_interval = timeCli.parseTimeInt(cmd.resetInterval);
  }

  samplingConfig.missing_symbols = {};
  if (cmd.processWhitelisted !== undefined) {
    samplingConfig.missing_symbols.process_whitelisted = parseBool(cmd.processWhitelisted);
  }
  if (cmd.processPrivate !== undefined) {
    samplingConfig.missing_symbols.process_private = parseBool(cmd.processPrivate);
  }

  if (cmd.buckets !== undefined) {
    const bucketsNum = Number(cmd.buckets);
    if (isNaN(bucketsNum)) {
      errx('--buckets must be integer');
    }
    samplingConfig.buckets = bucketsNum;
  }

  return samplingConfig;
}

function samplingConfigure(cmd: SamplingConfigureCommand, config: Config) {
  abortIfNotLoggedIn(config);
  const coroner = coronerClientFromGlobal(config, cmd.globalOptions);

  let universe = cmd.universe || cmd.globalOptions.universe;
  if (!universe) {
    universe = getDefaultUniverse(config);
  }

  const project = cmd.project;

  if (!universe) {
    errx('--universe is required');
  }

  if (!project) {
    errx('--project is required');
  }

  const bpg = coronerBpgFromGlobal(coroner, cmd.globalOptions);
  const model = bpg.get();

  /* Find universe. */
  let uid = 0;
  for (const u of model.universe) {
    if (u.get('name') === universe) {
      uid = u.get('id');
    }
  }

  if (uid == 0) {
    errx('Universe not found');
  }

  let pid = 0;
  for (const p of model.project) {
    if (p.get('universe') === uid && p.get('name') == project) {
      pid = p.get('pid');
    }
  }

  if (pid === 0) {
    errx('Project not found');
  }

  const disabled = cmd.disable ? 1 : 0;

  let projectSampling = null;
  if (model.project_sampling) {
    for (const cfg of model.project_sampling) {
      if (cfg.get('project') === pid) {
        projectSampling = cfg;
      }
    }
  }

  if (cmd.clear) {
    if (projectSampling) {
      bpg.delete(projectSampling);
      bpg.commit();
    }
    console.log(
      `Sampling configuration cleared. Project ${project} will use coronerd.conf defaults.`,
    );
    return;
  }

  let configurationObj: any = {};
  if (projectSampling) {
    configurationObj = JSON.parse(projectSampling.get('configuration'));
  }

  /*
   * Allow --disable by itself, by not trying to parse the config
   */
  if (disabled === 0) {
    configurationObj = samplingConfigFromCmd(cmd);
  }

  const configuration = JSON.stringify(configurationObj);
  if (projectSampling) {
    bpg.modify(projectSampling, {disabled, configuration});
  } else {
    const obj = bpg.new('project_sampling').withFields({
      project: pid,
      configuration,
      disabled,
    });
    bpg.create(obj);
  }

  bpg.commit();
  console.log('Sampling configuration applied');
  if (disabled == 1) {
    console.log(`Project ${project} now has sampling explicitly disabled.
Changes in coronerd.conf will not enable sampling for this project.`);
    console.log(yellow('To use coronerd.conf defaults, use --clear instead'));
  }
}

export const handlers: Record<string, CommandHandler> = {
  'sampling.status': samplingStatus,
  'sampling.reset': samplingReset,
  'sampling.configure': samplingConfigure,
};
