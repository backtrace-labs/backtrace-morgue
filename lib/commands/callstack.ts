import * as fs from 'fs';
import * as zlib from 'zlib';
import * as config from '../config';
import * as crdb from '../crdb';
import * as queryCli from '../cli/query';
import {table} from 'table';
import type {
  CallstackEvaluateCommand,
  DeduplicationAddCommand,
  DeduplicationDeleteCommand,
  DeduplicationModifyCommand,
  DeduplicationListCommand,
  CtsCommand,
} from '../cli/generated/types';
import {errx, err, success_color} from '../cli/errors';
import {abortIfNotLoggedIn, coronerClientFromGlobal, coronerBpgFromGlobal, parseProjectArg} from '../cli/context';
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

function coronerCallstackParams(cmd: CallstackEvaluateCommand, p, action) {
  const csparams = Object.assign(
    {
      action: action,
      fulljson: true,
    },
    p,
  );
  if ((cmd as any).name) csparams.name = (cmd as any).name;
  if ((cmd as any).language) csparams.language = (cmd as any).language;
  if ((cmd as any).platform) csparams.platform = (cmd as any).platform;
  return csparams;
}

async function coronerCallstackEval(cmd: CallstackEvaluateCommand, config: any): Promise<any> {
  abortIfNotLoggedIn(config);
  const coroner = coronerClientFromGlobal(config, cmd.globalOptions);
  const p = parseProjectArg(cmd.project, config);
  const csparams = coronerCallstackParams(cmd, p, 'evaluate');
  let data;

  const obj = cmd.target;

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
  const params = {resource: 'json.gz'};

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

function coronerDeduplicationAdd(cmd: DeduplicationAddCommand, coroner, p, bpg, rules): any {
  if (fs.existsSync(cmd.rules)) {
    const data = JSON.parse(fs.readFileSync(cmd.rules, 'utf8'));
    rules.set('rules', JSON.stringify(data));

    let priority = -1;
    if (cmd.priority && parseInt(cmd.priority) != 0)
      priority = parseInt(cmd.priority);
    rules.set('priority', priority);
    bpg.create(rules);
    bpg.commit();
    console.log(success_color(`Rule ${cmd.name} created`));
  } else {
    return deduplicationUsage(`Unknown file ${cmd.rules}`);
  }
}

function coronerDeduplicationDelete(cmd: DeduplicationDeleteCommand, coroner, p, bpg, rules) {
  bpg.delete(rules);
  bpg.commit();
  console.log(success_color(`Rule ${cmd.name} deleted`));
}

function coronerDeduplicationModify(cmd: DeduplicationModifyCommand, coroner, p, bpg, rules) {
  const delta: any = {};

  if (cmd.priority && parseInt(cmd.priority) != 0)
    delta.priority = parseInt(cmd.priority);

  if (cmd.rules !== undefined && fs.existsSync(cmd.rules)) {
    const data = JSON.parse(fs.readFileSync(cmd.rules, 'utf8'));
    delta.rules = JSON.stringify(data);
  }
  bpg.modify(rules, delta);
  bpg.commit();
  console.log(success_color(`Rule ${cmd.name} modified`));
}

function coronerDeduplicationList(cmd: DeduplicationListCommand, coroner, p, bpg, rules) {
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

  if (cmd.name !== undefined) {
    let found = undefined;

    for (let i = 0; i < model.deduplication.length; i++) {
      const el = model.deduplication[i].fields;
      if (el.name == cmd.name) {
        found = el;
        break;
      }
    }

    if (found === undefined) {
      return;
    }

    printDeduplicationList([found], cmd.verbose);
  } else {
    const fields = model.deduplication.map(e => e.fields);
    fields.sort((l, r) => l.priority - r.priority);

    printDeduplicationList(fields, cmd.verbose);
  }
}

function setupDeduplication(cmd: any, config: any) {
  abortIfNotLoggedIn(config);
  const coroner = coronerClientFromGlobal(config, cmd.globalOptions);
  const p = parseProjectArg(cmd.project, config);

  const bpg = coronerBpgFromGlobal(coroner, cmd.globalOptions);

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
  if ((cmd as any).owner !== undefined) owner = parseInt((cmd as any).owner);

  const rules = bpg.new('deduplication');

  if (cmd.name !== undefined) rules.set('name', cmd.name);
  rules.set('id', 0);
  rules.set('project', pid);
  rules.set('rules', '');
  rules.set('languages', 'c');
  rules.set('enabled', 1);
  rules.set('owner', owner);
  if (cmd.platform) rules.set('platforms', cmd.platform);

  return {coroner, p, bpg, rules};
}

function handleDeduplicationAdd(cmd: DeduplicationAddCommand, config: any): any {
  const result = setupDeduplication(cmd, config);
  if (!result) return;
  const {coroner, p, bpg, rules} = result;
  return coronerDeduplicationAdd(cmd, coroner, p, bpg, rules);
}

function handleDeduplicationDelete(cmd: DeduplicationDeleteCommand, config: any): any {
  const result = setupDeduplication(cmd, config);
  if (!result) return;
  const {coroner, p, bpg, rules} = result;
  return coronerDeduplicationDelete(cmd, coroner, p, bpg, rules);
}

function handleDeduplicationModify(cmd: DeduplicationModifyCommand, config: any): any {
  const result = setupDeduplication(cmd, config);
  if (!result) return;
  const {coroner, p, bpg, rules} = result;
  return coronerDeduplicationModify(cmd, coroner, p, bpg, rules);
}

function handleDeduplicationList(cmd: DeduplicationListCommand, config: any): any {
  const result = setupDeduplication(cmd, config);
  if (!result) return;
  const {coroner, p, bpg, rules} = result;
  return coronerDeduplicationList(cmd, coroner, p, bpg, rules);
}

/**
 * @brief Implements the cts command.
 */
function coronerCts(cmd: CtsCommand, config: any): any {
  /* First extract a list of all fingerprint values for the given target. */
  abortIfNotLoggedIn(config);
  const coroner = coronerClientFromGlobal(config, cmd.globalOptions);

  const p = parseProjectArg(cmd.project, config);
  const universe = cmd.globalOptions.universe || Object.keys((config as any).config.universes)[0];

  const attribute = cmd.attribute;
  const value = cmd.value;

  const aq = queryCli.buildQuery({});
  const q_v = aq.query;
  q_v.filter[0][attribute] = [['equal', value]];
  q_v.filter[0]['fingerprint;issues;tags'] = [['not-contains', value]];
  q_v.group = ['fingerprint'];
  q_v.fold = {};
  q_v.fold[attribute] = [['count']];

  if (cmd.query) {
    console.log(JSON.stringify(q_v, null, 2));
    return;
  }

  const fingerprint: any = {};

  coroner.query(universe, p.project, q_v, (err, result) => {
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
    coroner.query(universe, p.project, q_v, (err, result) => {
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

      coroner.query(universe, p.project, q_v, (error, result) => {
        if (err) {
          errx(err.message);
        }
      });
      return;
    });
  });
}

export const handlers: Record<string, (cmd: any, config: any) => any> = {
  'callstack.evaluate': coronerCallstackEval,
  'deduplication.add': handleDeduplicationAdd,
  'deduplication.delete': handleDeduplicationDelete,
  'deduplication.modify': handleDeduplicationModify,
  'deduplication.list': handleDeduplicationList,
  cts: coronerCts,
};
