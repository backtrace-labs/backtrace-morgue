import {sprintf} from 'extsprintf';
import printf from 'printf';
import * as config from '../config';
import {err, errx, chalk, success_color, error_color} from '../cli/errors';
import {abortIfNotLoggedIn, coronerClientArgv, coronerBpgSetup, coronerParams} from '../cli/context';
import {std_success_cb, std_failure_cb} from '../cli/bpg-helpers';
import * as timeCli from '../cli/time';

const yellow = chalk.yellow;

function samplingParams(coroner, action, argv, config) {
  const params = coronerParams(argv, config);
  params.action = action;
  if (argv.group) argv.fingerprint = argv.group;
  if (argv.fingerprint) {
    params.fingerprints = argv.fingerprint;
    if (!Array.isArray(params.fingerprints)) {
      params.fingerprints = [params.fingerprints];
    }
  }
  if (argv.universe) {
    params.universe = argv.universe;
  }
  if (argv.project) {
    const a = argv.project.split('/');

    params.project = a[0];
    if (a.length === 2) {
      params.universe = a[0];
      params.project = a[1];
    }
  }
  params.token = coroner.config.token;
  return params;
}

function samplingPost(coroner: any, params: any): Promise<any> {
  return coroner.promise('post', '/api/sampling', null, params, null);
}

function samplingBucketFor(buckets: any, count: any): Promise<any> {
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

function samplingStatusProject(argv, config, universe, project) {
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

  if (argv.a || argv.all) {
    max_groups = -1;
  } else {
    max_groups = parseInt(argv['max-groups']);
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

  if (argv.verbose && backoffs.accepts) {
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

function samplingStatus(coroner, argv, config) {
  const params = samplingParams(coroner, 'status', argv, config);

  samplingPost(coroner, params)
    .then(r => {
      let first, last;

      if (r.universes) {
        if (r.universes.length === 0) {
          console.log('No groups yet.');
        } else {
          r.universes.forEach(universe => {
            if (universe.projects.length === 0) {
              console.log(sprintf('%s: No groups yet.', universe.name));
            } else {
              universe.projects.forEach(project => {
                samplingStatusProject(argv, config, universe, project);
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

function samplingReset(coroner, argv, config) {
  const params = samplingParams(coroner, 'reset', argv, config);

  samplingPost(coroner, params).then(std_success_cb).catch(std_failure_cb);
}

function samplingUsage(str?: string): Promise<any> {
  if (str) err(str + '\n');
  console.error('Usage: morgue sampling <status|reset> [options]');
  console.error('');
  console.error('Options for either status or reset:');
  console.error(
    '  --fingerprint=group             Specify a fingerprint to apply to.',
  );
  console.error(
    '                                  Without this, applies to all.',
  );
  console.error(
    '  --project=[universe/]project    Specify a project to apply to.',
  );
  console.error(
    '                                  Without this, applies to all.',
  );
  console.error('');
  console.error('Options for status only:');
  console.error(
    '  --max-groups=N                  Specify max number of groups to display',
  );
  console.error(
    '                                  per project.  Default is 16.  0 displays',
  );
  console.error(
    '                                  no groups; < 0 displays all.',
  );
  console.error('  -a, --all                       Display all groups.');
  process.exit(1);
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

function samplingConfigFromArgv(argv: any): any {
  /*
   * For now all we support is backoff; don't expose as an arg.
   */
  const type = 'backoff';

  let attributes = argv.attribute;
  if (attributes === undefined) {
    attributes = [];
  }
  if (!Array.isArray(attributes)) {
    attributes = [attributes];
  }

  let backoffsUnparsed = argv.backoff;
  if (backoffsUnparsed === undefined) {
    errx('At least one --backoff is required');
  }
  if (!Array.isArray(backoffsUnparsed)) {
    backoffsUnparsed = [backoffsUnparsed];
  }

  /*
   * Each backoff is count,interval.
   */
  const backoffs = [];
  for (const unparsed of backoffsUnparsed) {
    const split = unparsed.split(',');
    if (split.length !== 2) {
      errx('Usage of --backoff is --backoff count,interval');
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
  const config: any = {
    type,
    backoffs,
    object_attributes: attributes,
  };

  if (argv['reset-interval'] !== undefined) {
    if (Array.isArray(argv['reset-interval'])) {
      errx('Only one --reset-interval is allowed');
    }
    config.reset_interval = timeCli.parseTimeInt(argv['reset-interval']);
  }

  config.missing_symbols = {};
  const keepWhitelisted = argv['process-whitelisted'];
  if (keepWhitelisted !== undefined) {
    config.missing_symbols.process_whitelisted = parseBool(keepWhitelisted);
  }
  const keepPrivate = argv['process-private'];
  if (keepPrivate !== undefined) {
    config.missing_symbols.process_private = parseBool(keepPrivate);
  }

  const bucketsUnparsed = argv.buckets;
  if (bucketsUnparsed !== undefined) {
    if (typeof bucketsUnparsed !== 'number') {
      errx('--buckets must be integer');
    }
    config.buckets = bucketsUnparsed;
  }

  const resetIntervalUnparsed = argv['reset-interval'];
  if (resetIntervalUnparsed !== undefined) {
    config.reset_interval = timeCli.parseTimeInt(resetIntervalUnparsed);
  }
  return config;
}

function samplingConfigure(coroner, argv, config) {
  let universe = argv.universe;
  if (!universe) {
    universe = Object.keys(config.config.universes)[0];
  }

  const project = argv.project;

  if (!universe) {
    errx('--universe is required');
  }

  if (!project) {
    errx('--project is required');
  }

  const bpg = coronerBpgSetup(coroner, argv);
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

  const disabled = argv.disable ? 1 : 0;

  let projectSampling = null;
  if (model.project_sampling) {
    for (const cfg of model.project_sampling) {
      if (cfg.get('project') === pid) {
        projectSampling = cfg;
      }
    }
  }

  if (argv.clear) {
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
    configurationObj = samplingConfigFromArgv(argv);
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

/**
 * @brief Implements the sampling command.
 */
function coronerSampling(argv: any, config: any): any {
  abortIfNotLoggedIn(config);
  let coroner;
  let fn;
  let subcmd;
  const subcmd_map = {
    status: samplingStatus,
    configure: samplingConfigure,
    reset: samplingReset,
  };

  argv._.shift();
  if (argv._.length === 0) {
    return samplingUsage('No request specified.');
  }
  if (argv._.length >= 2) {
    return samplingUsage('No arguments accepted for this command.');
  }

  subcmd = argv._.shift();
  if (subcmd === '--help' || subcmd === 'help') return samplingUsage();

  fn = subcmd_map[subcmd];
  if (fn) {
    coroner = coronerClientArgv(config, argv);
    return fn(coroner, argv, config);
  }

  samplingUsage("Invalid sampling subcommand '" + subcmd + "'.");
}

export const commands: Record<string, (argv: any, config: config.Config) => any> = {
  sampling: coronerSampling,
};
