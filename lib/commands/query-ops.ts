import * as util from 'util';
import {sprintf} from 'extsprintf';
import * as config from '../config';
import * as crdb from '../crdb';
import * as BPG from '../bpg';
import * as queryCli from '../cli/query';
import {errx, success_color} from '../cli/errors';
import {abortIfNotLoggedIn, coronerParams, coronerClientArgv} from '../cli/context';
import {std_success_cb, std_failure_cb} from '../cli/bpg-helpers';
import {usage} from '../cli/util';
import {argvPushObjectRanges} from './get-put';

function coronerNuke(argv: any, config: any): any {
  abortIfNotLoggedIn(config);

  const coroner = coronerClientArgv(config, argv);
  let query, project, universe, un, target;
  let ru;

  const coronerd = {
    url: coroner.endpoint,
    session: {token: '000000000'},
  };
  const opts: any = {};
  let bpg: any = {};

  if (coroner.config && coroner.config.token)
    coronerd.session.token = coroner.config.token;

  if (argv.debug) opts.debug = true;

  bpg = new BPG.BPG(coronerd, opts);

  if (argv.universe) universe = argv.universe;
  if (argv.project) project = argv.project;

  const model = bpg.get();

  if (universe) {
    /* Find the universe with the specified name. */
    for (var i = 0; i < model.universe.length; i++) {
      if (model.universe[i].get('name') === universe) {
        un = target = model.universe[i];
      }
    }
  }

  if (!un) {
    errx('Universe not found.');
  }

  if (project) {
    target = null;
    for (var i = 0; i < model.project.length; i++) {
      if (
        model.project[i].get('name') === project &&
        model.project[i].get('universe') === un.get('id')
      ) {
        target = model.project[i];
        break;
      }
    }
  }

  if (target === null) {
    errx('No such object.');
  }

  bpg.delete(target, {cascade: true});

  try {
    bpg.commit();
  } catch (em) {
    errx(em);
  }

  console.log(success_color('Success'));
  return;
}

function coronerSet(argv: any, config: any): any {
  abortIfNotLoggedIn(config);
  let query;
  let p;

  const coroner = coronerClientArgv(config, argv);

  if (argv._.length < 2) {
    return usage('Missing project, universe arguments');
  }

  p = coronerParams(argv, config);

  if (!argv.table) {
    argv.table = 'objects';
  }

  const aq = queryCli.argvQuery(argv);
  query = aq.query;

  delete query.fold;
  delete query.factor;

  if (!argv.time && !argv.age) {
    for (var i = 0; i < query.filter.length; i++) {
      delete query.filter[i].timestamp;
    }
  }

  const set: any = {};
  for (var i = 0; i < argv._.length; i++) {
    if (argv._[i].indexOf('=') === -1) continue;

    const kv = argv._[i].split('=');

    set[kv[0]] = kv[1];
  }

  query.set = set;

  if (argv.table) query.table = argv.table;

  coroner.query(p.universe, p.project, query, (err, result) => {
    if (err) {
      errx(err.message);
    }

    console.log(success_color('Success.'));
    return;
  });

  return;
}

async function coronerCleanFingerprints(argv, coroner, fingerprints, query, p) {
  query.limit = 10000;
  query.order = [{name: '_tx', ordering: 'descending'}];
  query.select = ['object.size'];

  let saved = 0;
  let selected = 0;
  let total = 0;
  let lowest_overall = 2 ** 32;
  let highest_overall = 0;

  /*
   * Perform independent queries for each fingerprint.  This allows
   * argv.{keep,oldest} to reserve objects per fingerprint.  Objects
   * shouldn't switch fingerprints between queries.
   */
  for (const fp of fingerprints) {
    let oids = [];
    let reserved = [];
    let kept = 0;

    query.filter[0].fingerprint = [['equal', fp]];
    query.filter[0]._tx = [['greater-than', '0']];
    for (;;) {
      let lowest_id = 2 ** 32;
      const result = await coroner.query(p.universe, p.project, query);
      const response = new crdb.Response(result.response);
      const rp: any = response.unpack();

      const objects = rp['*'];
      if (objects.length === 0) break;

      /* Update id trackers now before any array manipulation occurs. */
      if (objects[0].object > highest_overall)
        highest_overall = objects[0].object;
      lowest_id = objects[objects.length - 1].object;
      if (lowest_id < lowest_overall) lowest_overall = lowest_id;

      /*
       * If saving oldest N objects:
       * - prepend (unshift) the contents of the reserved array into objects,
       *   to preserve position in the overall queue
       * - splice the last N objects into the reserved array
       *
       * Then proceed as usual.  This will effectively reserve the oldest
       * objects when they appear, and they will ultimately not be
       * considered for deletion.
       */
      if (argv.oldest > 0) {
        objects.unshift(...reserved);
        const off =
          objects.length < argv.oldest ? 0 : objects.length - argv.oldest;
        reserved = objects.splice(off, argv.oldest);
      }

      for (let i = 0; i < objects.length; i++) {
        if (kept < argv.keep) {
          kept++;
          continue;
        }

        selected++;
        oids.push(objects[i].id);
        saved += objects[i]['object.size'];
      }
      if (argv.output && oids.length > 0) {
        process.stdout.write(oids.join(' '));
        process.stdout.write('\n');
        oids = [];
      }

      total += objects.length;
      if (argv.verbose) {
        process.stderr.write(
          `${objects.length} objects processed, ` +
            `setting object <= ${lowest_id.toString(16)} ...\n`,
        );
      }

      /* Paginate by updating the _tx filter. */
      query.filter[0]._tx = [['less-than', `${lowest_id}`]];
    }

    /* Include reserved objects in total at this point. */
    total += reserved.length;
    if (argv.verbose) {
      reserved = reserved.map(obj => obj.id);
      process.stderr.write(
        `reserved(${reserved.length}]: ${reserved.join(' ')}\n`,
      );
    }
  }

  const range = `${lowest_overall.toString(16)}..${highest_overall.toString(16)}`;
  process.stderr.write(
    `${selected}/${total} objects (range ${range}) ` +
      `across ${fingerprints.length} fingerprint(s), would save about ` +
      `${Math.floor(saved / 1024 / 1024)}MB.\n`,
  );
}

async function coronerCleanAsync(argv: any, config: any): Promise<any> {
  abortIfNotLoggedIn(config);
  let query;
  let p;

  const coroner = coronerClientArgv(config, argv);
  coroner.sync_query = coroner.query;
  coroner.query = util.promisify(coroner.sync_query);

  if (argv._.length < 2) {
    return usage('Missing project, universe arguments');
  }

  /* Process --oldest, defaulting to 0. */
  argv.oldest = argv.oldest ? parseInt(argv.oldest) : 0;

  /* Process --keep, defaulting to 3 if no --oldest set. */
  if (argv.keep) {
    argv.keep = parseInt(argv.keep);
    if (argv.keep === 0) errx('--keep must be greater than 0');
  } else if (!argv.oldest) {
    argv.keep = 3;
  }

  p = coronerParams(argv, config);

  if (!argv.table) {
    argv.table = 'objects';
  }

  const aq = queryCli.argvQuery(argv);
  query = aq.query;
  const d_age = aq.age;

  /* Only consider non-deleted objects, period. */
  if (!query.filter) query.filter = [];
  if (!query.filter[0]) query.filter[0] = {};
  query.filter[0]['_deleted'] = [['equal', '0']];

  /* First, unless specified, extract the top N fingerprint objects. */
  let fingerprints = [];
  if (argv.fingerprint) {
    fingerprints = Array.isArray(argv.fingerprint)
      ? argv.fingerprint
      : [argv.fingerprint];
  }
  if (fingerprints.length === 0) {
    query.group = ['fingerprint'];
    query.order = [{name: ';count', ordering: 'descending'}];

    const result = await coroner.query(p.universe, p.project, query);
    const rp = new crdb.Response(result.response);
    for (let i = 0; i < rp.json.values.length; i++)
      fingerprints.push(rp.json.values[i][0]);
  }

  /* Now, we construct selection queries for all objects matching these. */
  delete query.group;
  delete query.fold;
  delete query.order;

  await coronerCleanFingerprints(argv, coroner, fingerprints, query, p);
}

/**
 * @brief: Implements the clean command.
 */
async function coronerClean(argv: any, config: any): Promise<any> {
  await coronerCleanAsync(argv, config).catch(err => {
    console.error(err);
  });
}

async function coronerDelete(argv: any, config: any): Promise<any> {
  let aq, coroner, o, p;
  const tasks = [];
  const chunklen = argv.chunklen || 16384;
  const params: any = {};
  const physical_only = argv['physical-only'];
  const crdb_only = argv['crdb-only'];

  abortIfNotLoggedIn(config);

  aq = queryCli.argvQueryFilterOnly(argv);
  coroner = coronerClientArgv(config, argv);
  p = coronerParams(argv, config);
  o = argv._.slice(2);
  argvPushObjectRanges(o, argv);

  if (o.length === 0 && !(aq && aq.query)) {
    errx('Must specify either objects to be deleted or a query.');
  }

  if (argv.sync) {
    params.sync = true;
    if (!argv.timeout) {
      /* Set longer 5 minute timeout in case of heavy load. */
      coroner.timeout = 300 * 1000;
    }
  }

  if (!argv.all) {
    params.subsets = [];
    if (!crdb_only) params.subsets.push('physical');
    else params.subsets.push('crdb');
  }

  const delete_fn = function () {
    const n_objects = o.length;
    if (n_objects === 0)
      return Promise.reject(new Error('No matching objects.'));
    while (o.length > 0) {
      const objs = o.splice(0, Math.min.apply(Math, [o.length, chunklen]));
      tasks.push(
        coroner.promise('delete_objects', p.universe, p.project, objs, params),
      );
    }
    process.stderr.write(
      success_color(
        sprintf(
          'Deleting %d objects in %d requests...',
          n_objects,
          tasks.length,
        ),
      ) + '\n',
    );

    return Promise.all(tasks);
  };

  if (aq && aq.query) {
    await coroner
      .promise('delete_by_query', p.universe, p.project, aq.query, params)
      .then(std_success_cb)
      .catch(std_failure_cb);
  } else {
    await delete_fn().then(std_success_cb).catch(std_failure_cb);
  }
}

export const commands: Record<string, (argv: any, config: config.Config) => any> = {
  set: coronerSet,
  delete: coronerDelete,
  clean: coronerClean,
  nuke: coronerNuke,
};
