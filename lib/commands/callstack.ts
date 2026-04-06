import * as fs from 'fs';
import * as zlib from 'zlib';
import * as config from '../config';
import * as crdb from '../crdb';
import * as queryCli from '../cli/query';
import {table} from 'table';
import {errx, err, success_color} from '../cli/errors';
import {abortIfNotLoggedIn, coronerClientArgv, coronerBpgSetup, coronerParams} from '../cli/context';
import {std_failure_cb} from '../cli/bpg-helpers';

function callstackUsage(str?: any): never {
  if (str) err(str + '\n');
  console.error('Usage: morgue callstack <subcommand>:');
  console.error(
    '   morgue callstack evaluate <project> [--name=fmt] <object>|<filename>',
  );
  console.error('     Evaluate a specific object/file.');
  console.error('');
  console.error(
    '   morgue callstack get [project] [--language=language] <--name=name>',
  );
  console.error('     Retrieve the ruleset for a specific name.');
  console.error('');
  process.exit(1);
}

function coronerCallstackParams(argv, p, action) {
  const csparams = Object.assign(
    {
      action: action,
      fulljson: true,
    },
    p,
  );
  if (argv.name) csparams.name = argv.name;
  if (argv.language) csparams.language = argv.language;
  if (argv.platform) csparams.platform = argv.platform;
  return csparams;
}

async function coronerCallstackEval(argv, coroner, p): Promise<any> {
  const csparams = coronerCallstackParams(argv, p, 'evaluate');
  let data, params, obj;

  if (argv._.length != 1) {
    return callstackUsage('evaluate: Must specify one object.');
  }

  obj = argv._[0];

  if (fs.existsSync(obj)) {
    data = JSON.parse(fs.readFileSync(obj, 'utf8'));
    coroner
      .promise('post', '/api/callstack', csparams, data, null)
      .then(csr => {
        console.log(JSON.stringify(csr, null, 4));
      })
      .catch(std_failure_cb);
    return;
  }

  /*
   * Fetch the json resource, then submit it to /api/callstack, dumping the
   * JSON response.
   */
  params = {resource: 'json.gz'};

  await coroner
    .promise('http_fetch', p.universe, p.project, obj, params)
    .then(async hr => {
      try {
        data = JSON.parse(zlib.gunzipSync(hr.bodyData).toString('utf8'));
      } catch (e) {
        data = JSON.parse(hr.bodyData);
      }

      await coroner
        .promise('post', '/api/callstack', csparams, data, null)
        .then(csr => {
          console.log(JSON.stringify(csr, null, 4));
        })
        .catch(std_failure_cb);
    })
    .catch(std_failure_cb);
}

function coronerCallstackGet(argv, coroner, p) {
  const csparams = coronerCallstackParams(argv, p, 'get');

  coroner
    .promise('get', '/api/callstack', csparams)
    .then(csr => {
      const json = JSON.parse(csr.toString('utf8'));
      console.log(JSON.stringify(json, null, 4));
    })
    .catch(std_failure_cb);
}

/**
 * @brief Implements the callstack command.
 */
function coronerCallstack(argv: any, config: any): any {
  let coroner, fn, p, subcmd;

  const subcmd_map = {
    evaluate: coronerCallstackEval,
    eval: coronerCallstackEval,
    get: coronerCallstackGet,
  };

  argv._.shift();
  if (argv._.length === 0) {
    return callstackUsage('No request specified.');
  }

  subcmd = argv._[0];
  if (subcmd === '--help' || subcmd === 'help' || subcmd === '-h')
    return callstackUsage();

  coroner = coronerClientArgv(config, argv);
  p = coronerParams(argv, config);
  argv._.shift(); /* remove subcmd */
  argv._.shift(); /* remove project */

  fn = subcmd_map[subcmd];
  if (fn) {
    return fn(argv, coroner, p);
  }

  callstackUsage("Invalid callstack subcommand '" + subcmd + "'.");
}

function deduplicationUsage(str?: any): never {
  if (str) err(str + '\n');
  console.error('Usage: morgue deduplication <subcommand>:');
  console.error(
    '   morgue deduplication add <universe>/<project> <--name=name> <--rules=rules_file> <--priority=priority>',
  );
  console.error('     Add deduplication rules to the project.');
  console.error('');
  console.error(
    '   morgue deduplication delete <universe>/<project> <--name=name>',
  );
  console.error('     Remove the deduplication rule from the project.');
  console.error('');
  console.error(
    '   morgue deduplication modify <universe>/<project> <--name=name> [--rules=<rules_file>] [--priority=<priority>]',
  );
  console.error('     Modify deduplication rules from the project.');
  console.error('');
  process.exit(1);
}

function coronerDeduplicationAdd(argv, coroner, p, bpg, rules): any {
  if (fs.existsSync(argv.rules)) {
    const data = JSON.parse(fs.readFileSync(argv.rules, 'utf8'));
    rules.set('rules', JSON.stringify(data));

    let priority = -1;
    if (argv.priority && parseInt(argv.priority) != 0)
      priority = parseInt(argv.priority);
    rules.set('priority', priority);
    bpg.create(rules);
    bpg.commit();
    console.log(success_color(`Rule ${argv.name} created`));
  } else {
    return deduplicationUsage(`Unknown file ${argv.rules}`);
  }
}

function coronerDeduplicationDelete(argv, coroner, p, bpg, rules) {
  bpg.delete(rules);
  bpg.commit();
  console.log(success_color(`Rule ${argv.name} deleted`));
}

function coronerDeduplicationModify(argv, coroner, p, bpg, rules) {
  const delta: any = {};

  if (argv.priority && parseInt(argv.priority) != 0)
    delta.priority = parseInt(argv.priority);

  if (argv.rules !== undefined && fs.existsSync(argv.rules)) {
    const data = JSON.parse(fs.readFileSync(argv.rules, 'utf8'));
    delta.rules = JSON.stringify(data);
  }
  bpg.modify(rules, delta);
  bpg.commit();
  console.log(success_color(`Rule ${argv.name} modified`));
}

function coronerDeduplicationList(argv, coroner, p, bpg, rules) {
  const model = bpg.get();

  const printDeduplicationList = function (data, verbose) {
    let table_data = [
      ['Name', 'Priority', 'Languages', 'Plaforms', 'Rules', 'Enabled'],
    ];

    for (let i = 0; i < data.length; i++) {
      const el = data[i];
      const parsed_rules = JSON.parse(el.rules);
      table_data = table_data.concat([
        [
          el.name,
          el.priority,
          el.languages,
          el.platforms,
          parsed_rules.length,
          el.enabled,
        ],
      ]);
    }

    console.log(table(table_data));

    if (verbose === true) {
      const verbose_table_data = [
        [
          'Action',
          'Function',
          'Platform',
          'Object',
          'Replacement',
          'Attribute',
        ],
      ];

      for (let i = 0; i < data.length; i++) {
        const parsed_rules = JSON.parse(data[i].rules);
        const mapped = parsed_rules.map(e => {
          const arr = [
            e.actions,
            e.function,
            e.platform,
            e.object,
            e.replacement,
            e.attribute,
          ];
          return arr;
        });
        const to_print = verbose_table_data.concat(mapped);
        console.log(table(to_print));
      }
    }
  };

  if (argv.name !== undefined) {
    let found = undefined;

    for (let i = 0; i < model.deduplication.length; i++) {
      const el = model.deduplication[i].fields;
      if (el.name == argv.name) {
        found = el;
        break;
      }
    }

    if (found === undefined) {
      return;
    }

    printDeduplicationList([found], argv.verbose);
  } else {
    const fields = model.deduplication.map(e => e.fields);
    fields.sort((l, r) => l.priority - r.priority);

    printDeduplicationList(fields, argv.verbose);
  }
}

/**
 * @brief Implements the deduplication command.
 */
function coronerDeduplication(argv: any, config: any): any {
  let coroner, fn, p, subcmd;

  const subcmd_map = {
    add: coronerDeduplicationAdd,
    delete: coronerDeduplicationDelete,
    modify: coronerDeduplicationModify,
    list: coronerDeduplicationList,
  };

  argv._.shift();
  if (argv._.length === 0) {
    return deduplicationUsage('No request specified.');
  }

  subcmd = argv._[0];
  if (subcmd === '--help' || subcmd === 'help' || subcmd === '-h')
    return deduplicationUsage();

  coroner = coronerClientArgv(config, argv);
  p = coronerParams(argv, config);
  argv._.shift(); /* remove subcmd */
  argv._.shift(); /* remove project */

  const bpg = coronerBpgSetup(coroner, argv);

  const model = bpg.get('project');

  let pid = null;

  for (let i = 0; i < model.project.length; i++) {
    const el = model.project[i];
    if (el.fields.name == p.project) {
      pid = el.fields.pid;
      break;
    }
  }

  if (pid === null) {
    return deduplicationUsage(`Unknown project ${p.project}`);
  }

  let owner = coroner.config.user.uid;
  if (argv.owner !== undefined) owner = parseInt(argv.owner);

  const rules = bpg.new('deduplication');

  if (argv.name !== undefined) rules.set('name', argv.name);
  rules.set('id', 0);
  rules.set('project', pid);
  rules.set('rules', '');
  rules.set('languages', 'c');
  rules.set('enabled', 1);
  rules.set('owner', owner);
  // rules.set('priority', priority);
  if (argv.platform) rules.set('platforms', argv.platform);

  fn = subcmd_map[subcmd];
  if (fn) {
    try {
      return fn(argv, coroner, p, bpg, rules);
    } catch (e) {
      return deduplicationUsage(e);
    }
  }

  deduplicationUsage("Invalid deduplication subcommand '" + subcmd + "'.");
}

/**
 * @brief Implements the cts command.
 */
function coronerCts(argv: any, config: any): any {
  /* First extract a list of all fingerprint values for the given target. */
  abortIfNotLoggedIn(config);
  const coroner = coronerClientArgv(config, argv);

  let universe = argv.universe;
  if (!universe) universe = Object.keys(config.config.universes)[0];

  const project = argv._[1];
  const attribute = argv._[2];
  const value = argv._[3];

  const query = queryCli.argvQuery(argv);
  const q_v = query.query;
  q_v.filter[0][attribute] = [['equal', value]];
  q_v.filter[0]['fingerprint;issues;tags'] = [['not-contains', value]];
  q_v.group = ['fingerprint'];
  q_v.fold = {};
  q_v.fold[attribute] = [['count']];

  if (argv.query) {
    console.log(JSON.stringify(q_v, null, 2));
    return;
  }

  const fingerprint: any = {};

  coroner.query(universe, project, q_v, (err, result) => {
    if (err) {
      errx(err.message);
    }

    const response = new crdb.Response(result.response);
    const rp: any = response.unpack();

    for (const k in rp) {
      fingerprint[k] = true;
    }

    /* Now we have suspect fingerprints. Eliminate those not unique to the run. */
    delete q_v.filter[0][attribute];
    q_v.fold[attribute] = [['distribution', 8192]];
    coroner.query(universe, project, q_v, (err, result) => {
      if (err) {
        errx(err.message);
      }

      const response = new crdb.Response(result.response);
      const rp: any = response.unpack();

      for (var k in rp) {
        if (!fingerprint[k]) continue;

        const dt = rp[k]['distribution(' + attribute + ')'][0];
        if (dt.keys > 1) delete fingerprint[k];
      }

      /* Construct a query to set tags for each of these issues. */
      delete q_v.group;
      delete q_v.fold;

      const n_issues = Object.keys(fingerprint).length;
      if (n_issues === 0) {
        console.log('No new issues introduced.');
        return;
      } else {
        console.log('Setting tag ' + value + ' on ' + n_issues + ' issues.');
      }

      let filter_string = '';
      let first = true;

      for (var k in fingerprint) {
        if (first === false) filter_string += '|';
        filter_string += '^' + k + '$';
        first = false;
      }

      q_v.filter[0].fingerprint = [['regular-expression', filter_string]];
      delete q_v.filter[0].timestamp;
      q_v.set = {tags: value + ''};
      q_v.table = 'issues';
      q_v.select = ['tags'];
      delete q_v.filter[0]['fingerprint;issues;tags'];
      q_v.filter[0]['tags'] = [['not-contains', value]];

      coroner.query(universe, project, q_v, (error, result) => {
        if (err) {
          errx(err.message);
        }
      });
      return;
    });
  });
}

export const commands: Record<string, (argv: any, config: config.Config) => any> = {
  callstack: coronerCallstack,
  deduplication: coronerDeduplication,
  cts: coronerCts,
};
