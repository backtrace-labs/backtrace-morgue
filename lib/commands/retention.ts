import * as config from '../config';
import type {Config} from '../config';
import {err, errx, success_color} from '../cli/errors';
import {
  abortIfNotLoggedIn,
  coronerClientFromGlobal,
  coronerBpgFromGlobal,
  parseProjectArg,
  requireConfigFile,
} from '../cli/context';
import {bpgPost, bpgObjectFind, std_failure_cb} from '../cli/bpg-helpers';
import * as timeCli from '../cli/time';
import type {
  RetentionListCommand,
  RetentionSetCommand,
  RetentionClearCommand,
  RetentionStatusCommand,
  CommandHandler,
  CommandHandlerMap,
} from '../cli/generated/types';


function retentionTypeFor(parent_type: any): string {
  if (parent_type === 'universe') return 'universe_retention';
  if (parent_type === 'project') return 'project_retention';
  if (parent_type === 'instance') return 'instance_retention';
  throw new Error("Invalid parent type '" + parent_type + "'");
}

function retentionParent(objects, parent_type, name) {
  /* If an universe/project was passed in, look up the universe first. */
  const fields = [];
  const vals = [];

  if (parent_type === 'project') {
    const [u, p] = name.split('/');
    if (p) {
      name = p;
      const uobj = bpgObjectFind(objects, 'universe', u, 'name');
      if (!uobj) return null;

      fields.push('universe');
      vals.push(uobj.get('id'));
    }
  }

  fields.push('name');
  vals.push(name);
  return bpgObjectFind(objects, parent_type, vals, fields);
}

function addCriterion(rule, type, params) {
  rule.criteria.push(
    Object.assign(
      {
        type,
      },
      params || {},
    ),
  );
}

function addAction(rule, type, params?) {
  rule.actions.push(
    Object.assign(
      {
        type,
      },
      params || {},
    ),
  );
}

function getRuleId(str: any): number {
  const fields = str.split(',');
  return parseInt(fields[0]);
}

function checkRuleId(n_rules, field, str) {
  const fields = str.split(',');
  const ruleIdStr = fields.shift();
  const ruleId = parseInt(ruleIdStr);

  if (isNaN(ruleId) === true || ruleId < 0 || ruleId >= n_rules) {
    errx(
      `${field}: '${ruleIdStr}' is not >= 0 and < ${n_rules} rules`,
    );
  }
  return [ruleId, fields];
}

function normalizeRetentionParam(param: any): string[] {
  if (param === undefined) return [];
  if (Number.isInteger(param)) return [`${param}`];
  /* Handle parameter set without a key, special case for 1 rule. */
  if (param === true) return ['0'];
  if (!Array.isArray(param)) return [param];
  return param;
}

function retentionSet(bpg, objects, cmd: RetentionSetCommand, config: Config): any {
  const act_obj: any = {};
  let rules = [
    {
      criteria: [{type: 'object-age', op: 'at-least'}],
      actions: [{type: 'delete-all'}],
    },
  ];
  const rtn_ptype = cmd.type || 'project';
  const rtn_type = retentionTypeFor(rtn_ptype);
  let rtn_pname: string | null = cmd.name;
  let rtn_parent = null;
  let rtn_parent_id = null;
  let obj = null;

  /* Normalize inputs.  Make all parameters arrays of strings. */
  const n_rules = cmd.rules ? parseInt(cmd.rules) : 1;
  const ageArr = normalizeRetentionParam(cmd.age);
  const compressArr = normalizeRetentionParam(cmd.compress);
  const deleteArr = normalizeRetentionParam(cmd.delete);

  /* Convert the old-style --max-age argument to new-style --age. */
  const maxAgeArr = normalizeRetentionParam(cmd.maxAge);
  for (const mage of maxAgeArr) {
    const fields = mage.split(',');
    if (fields.length === 1) {
      ageArr.push(`0,at-least,${mage}`);
    } else {
      const [ruleId, rest] = checkRuleId(n_rules, 'max-age', mage);
      ageArr.push(`${ruleId},at-least,${rest.join(',')}`);
    }
  }

  /* Convert the old-style --physical-only to new-style --delete. */
  const physicalOnlyArr = normalizeRetentionParam(cmd.physicalOnly);
  for (const po of physicalOnlyArr) {
    const ruleId = getRuleId(po);
    if (isNaN(ruleId)) {
      deleteArr.push('0,physical');
    } else {
      deleteArr.push(`${ruleId},physical`);
    }
  }

  /*
   * Generate the rules.
   * Make sure every parameter, if specified for a rule, has a valid rule id.
   */
  rules = [];
  for (let i = 0; i < n_rules; i++) rules[i] = {criteria: [], actions: []};

  for (const a of ageArr) {
    const [ruleId, fields] = checkRuleId(n_rules, 'age', a);
    const [op, time, time_end] = fields;
    const params: any = {op, time: timeCli.timespecToSeconds(time).toString()};
    if (time_end)
      params.time_end = timeCli.timespecToSeconds(time_end).toString();
    addCriterion(rules[ruleId], 'object-age', params);
  }
  for (const d of deleteArr) {
    const [ruleId, fields] = checkRuleId(n_rules, 'delete', d);
    const [subset] = fields;
    const params: any = {};
    if (subset) params.subsets = [subset];
    addAction(rules[ruleId], 'delete-all', params);
  }
  for (const d of compressArr) {
    const [ruleId, fields] = checkRuleId(n_rules, 'compress', d);
    addAction(rules[ruleId], 'compress');
  }

  /* Require every rule to have an age parameter and at least one action. */
  for (const rule of rules) {
    if (
      !rule.criteria.some(c => {
        return c.type === 'object-age';
      })
    ) {
      return errx('Age is a required parameter for every rule.');
    }
    if (rule.actions.length === 0) {
      return errx('Must specify at least one action for every rule.');
    }
  }

  /* Determine the target policy being set. */
  if (rtn_type === 'instance_retention') {
    /* Instances do not have names; name is required by the type but
     * for instance type it should be empty/ignored. */
  }

  /* Determine whether a create or update is needed. */
  if (rtn_pname && rtn_type !== 'instance_retention') {
    const id_attr = rtn_ptype === 'project' ? 'pid' : 'id';
    rtn_parent = retentionParent(objects, rtn_ptype, rtn_pname);
    if (!rtn_parent) {
      return errx('Unknown ' + rtn_ptype + " '" + rtn_pname + "'.");
    }
    rtn_parent_id = rtn_parent.get(id_attr);
    obj = bpgObjectFind(objects, rtn_type, rtn_parent_id, rtn_ptype);
  } else {
    obj = bpgObjectFind(objects, rtn_type, null);
  }

  act_obj.type = 'configuration/' + rtn_type;
  if (!obj) {
    act_obj.action = 'create';
    act_obj.object = {id: 0, rules: JSON.stringify(rules)};
    if (rtn_parent_id) {
      act_obj.object[rtn_ptype] = rtn_parent_id;
    }
  } else {
    act_obj.action = 'modify';
    act_obj.fields = {rules: JSON.stringify(rules)};
    act_obj.key = {};
    if (rtn_parent_id) {
      act_obj.key[rtn_ptype] = rtn_parent_id;
    } else {
      act_obj.key.id = obj.get('id');
    }
  }

  if (cmd.dryrun) {
    console.log('# BPG command that would be executed:');
    console.log(JSON.stringify({actions: [act_obj]}, null, 4));
    return;
  }

  bpgPost(bpg, {actions: [act_obj]}, (e, r) => {
    if (e) {
      err(e);
      return;
    }
    console.log(success_color(r.results[0].text || r.results[0].string));
  });
}

function retentionClear(bpg, objects, cmd: RetentionClearCommand, config: Config) {
  /* Clear is essentially set with zero rules. */
  const setCmd: RetentionSetCommand = {
    kind: 'retention.set',
    globalOptions: cmd.globalOptions,
    name: cmd.name,
    type: cmd.type,
    rules: '0',
  };
  return retentionSet(bpg, objects, setCmd, config);
}

function ageCritToString(crit: any): string {
  const max_age = timeCli.secondsToTimespec(crit.value || crit.time);
  return `object-age ${crit.op} ${max_age}`;
}

function deleteActToString(act: any): string {
  let actstr = 'delete-all';
  if (act.subsets && act.subsets.indexOf('physical') != -1)
    actstr += '(physical-only)';
  return actstr;
}

function compressActToString(act: any): string {
  const actstr = 'compress';
  return actstr;
}

function ruleToString(rule: any): string {
  let s = '';

  if (Array.isArray(rule.criteria) === false || rule.criteria.length === 0)
    return 'no criteria';

  if (Array.isArray(rule.actions) === false || rule.actions.length === 0)
    return 'no actions';

  s = 'criteria[';
  s += rule.criteria
    .map(crit => {
      if (crit.type === 'object-age') return ageCritToString(crit);
      return '?';
    })
    .join(', ');
  s += ']';

  s += ' actions[';
  s += rule.actions.map(act => {
    if (act.type === 'compress') return compressActToString(act);
    if (act.type === 'delete-all') return deleteActToString(act);
    return '?';
  });
  s += ']';

  return s;
}

function retentionToStrings(r_obj: any): string[] {
  const rules = JSON.parse(r_obj.get('rules'));

  if (Array.isArray(rules) === false || rules.length === 0) return null;

  return rules.map(ruleToString);
}

function retentionListRules(spaces: any, rules: any): string {
  if (rules.length === 1) {
    /* If only one rule, just list it directly inline. */
    return ` ${rules[0]}`;
  }
  const rules_annotated = rules.map((r, n) => `rule #${n}: ${r}`);
  return `\n${spaces}${rules_annotated.join(`\n${spaces}`)}`;
}

function retentionListNamespaceRules(ns_obj: any, rules: any): string {
  return `  ${ns_obj.get('name')}:${retentionListRules('    ', rules)}`;
}

function retentionList(bpg, objects): any {
  let r;
  let count = 0;
  let before = 0;

  if ((r = objects['instance_retention'])) {
    const rules = retentionToStrings(r[0]);
    if (rules) {
      console.log(`Instance-level:${retentionListRules('  ', rules)}`);
    }
  }

  if ((r = objects['universe_retention'])) {
    before = count;
    r.forEach(r_obj => {
      const universe = bpgObjectFind(
        objects,
        'universe',
        r_obj.get('universe'),
      );
      const rules = retentionToStrings(r_obj);
      if (rules) {
        if (count === before) console.log('Universe-level:');
        count++;
        console.log(retentionListNamespaceRules(universe, rules));
      }
    });
  }

  if ((r = objects['project_retention'])) {
    before = count;
    r.forEach(r_obj => {
      const project = bpgObjectFind(objects, 'project', r_obj.get('project'));
      const rules = retentionToStrings(r_obj);
      if (rules) {
        if (count === before) console.log('Project-level:');
        count++;
        console.log(retentionListNamespaceRules(project, rules));
      }
    });
  }

  if (count === 0) {
    console.log('No retention policies in effect.');
  }
}

function usageRetentionStatus(str?: string): never {
  if (str) {
    errx(str);
  }
  errx('--type must be "universe" or "project", and a name must be provided.');
}

function epochsec_to_datestr(sec: any): string {
  return new Date(sec * 1000).toUTCString();
}

function shouldExpireStr(expiry_ts, recvtime, toff) {
  const calc_expiry = recvtime + toff + 1; /* include timer slop */
  if (expiry_ts === calc_expiry) return 'expires as expected';

  return `should expire at ${epochsec_to_datestr(calc_expiry)}`;
}

function oiiToString(exp_data: any, verbosity: any): string {
  const oii = exp_data.next_object;
  const toff = parseInt(exp_data.off);
  const recvtime = parseInt(oii.recvtime);
  let str = '';

  if (oii.namespace !== null) {
    str += `${oii.namespace} oid ${oii.object_id}`;
    if (verbosity >= 1) {
      const expiry_ts = parseInt(oii.expiry);
      if (expiry_ts && expiry_ts > 0) {
        str += ` expires at ${epochsec_to_datestr(expiry_ts)}`;
        if (!isNaN(recvtime) && verbosity >= 2) {
          str += ` (${shouldExpireStr(expiry_ts, recvtime, toff)})`;
        }
      } else {
        /* estimate expiry time if receive time available */
        if (recvtime && toff) {
          str += `, ${shouldExpireStr(null, recvtime, toff)}`;
        } else {
          str += ', no expiry';
        }
      }
    }
  }

  if (str.length === 0) {
    str = 'idle, awaiting new objects';
  }

  if (verbosity >= 3 && oii.last_eval) {
    const leval = epochsec_to_datestr(parseInt(oii.last_eval));
    str += ` (last eval ${leval})`;
  }
  return str;
}

function retentionSkip(obj, level, name) {
  if (level === 'universe' && name === 'users') return true;
  if (typeof name === 'string' && name.indexOf('_') === 0) return true;
  return false;
}

function retentionSublevel(level: any): string | null {
  if (level === 'instance') return 'universe';
  else if (level === 'universe') return 'project';
  else return null;
}

function ageCritStatus(crit: any): string {
  return ageCritToString(crit);
}

function deleteActStatus(act: any): string {
  return deleteActToString(act);
}

function compressStats(statobj: any): string {
  let s = `${statobj.n_compressed}/${statobj.n_consumed} compressed`;
  s += ` ${statobj.n_input_bytes} to ${statobj.n_compressed_bytes} bytes`;
  s += ` (ratio ${((100 * statobj.n_compressed_bytes) / statobj.n_input_bytes).toFixed(2)}%)`;
  return s;
}

function compressActStatus(act: any): string {
  let s = '';
  if (act.last_id === 0) {
    s += 'not yet run';
  } else {
    if (act.running_since) {
      s += `running since ${epochsec_to_datestr(act.running_since)}`;
      if (act.runstats) {
        s += ` (${compressStats(act.runstats)})`;
      }
    } else {
      s += 'not running';
    }

    let last_completed = 0;
    if (act.total !== undefined && act.total.last_completed !== undefined)
      last_completed = act.total.last_completed;
    if (Number.isInteger(last_completed) && last_completed > 0) {
      s += `, last completed ${epochsec_to_datestr(last_completed)}`;
      s += `, ${compressStats(act.total)}`;
    } else if (act.running_since) s += ', never completed';
    else s += ', never run';
  }
  return `compress(${s})`;
}

function ruleTaskStatus(rule: any): string {
  const items = [];
  if (rule.enabled !== undefined)
    items.push(rule.enabled ? 'enabled' : 'disabled');
  if (rule.target !== undefined) {
    let target = rule.target;
    if (Number.isInteger(target)) target = epochsec_to_datestr(target);
    items.push(`target ${target}`);
    items.push(`count ${rule.count}`);
  }
  if (rule.backoff) items.push('backoff');
  if (rule.pause_begin)
    items.push(`paused since ${epochsec_to_datestr(rule.pause_begin)}`);
  return 'status[' + items.join(', ') + ']';
}

function ruleStatusInstances(rule, cmd: RetentionStatusCommand, exp_off, spaces) {
  let num_shown = 0;
  let num_excluded = 0;

  if (!cmd.instances) return;

  if (!rule.next_object || !rule.next_object.instances) return;

  const instances = [];
  for (let i = 0; i < rule.next_object.instances.length; i++) {
    const noi = rule.next_object.instances[i];
    if (noi.namespace === rule.next_object.namespace) {
      num_excluded++;
      continue;
    }
    /* Skip namespaces that don't keep objects. */
    if (!cmd.includeall) {
      if (noi.namespace.endsWith('/symbols')) {
        num_excluded++;
        continue;
      }
    }

    /*
     * Sort instances by expiry time, if they have one, and next by the
     * next receive time, if they have one.
     */
    const noi_expiry = parseInt(noi.expiry) || 0;
    const noi_recvtime = parseInt(noi.recvtime) || 0;
    if (noi_expiry === 0 && noi_recvtime === 0) {
      instances.push(noi);
      continue;
    }
    let index = 0;
    for (; index < instances.length; index++) {
      const inst_expiry = parseInt(instances[index].expiry);
      if (noi_expiry > 0) {
        if (inst_expiry === 0) break;
        if (noi_expiry <= inst_expiry) break;
        continue;
      } else if (inst_expiry > 0) continue;

      const inst_recvtime = parseInt(instances[index].recvtime);
      if (inst_recvtime === 0) break;
      if (noi_recvtime <= inst_recvtime) break;
    }
    instances.splice(index, 0, noi);
  }

  const verbosity = cmd.verbose ? 1 : 0;
  for (let i = 0; i < instances.length; i++) {
    const exp_data = {next_object: instances[i], off: exp_off};
    const s = oiiToString(exp_data, verbosity);
    if (s) {
      if (num_shown === 0) console.log(`${spaces}namespace instances:`);
      num_shown++;
      console.log(spaces + `-> ${s}`);
    }
  }
  if (num_shown != rule.next_object.instances.length && verbosity >= 2) {
    const diff = rule.next_object.instances.length - num_shown - num_excluded;
    if (diff !== 0)
      console.log(`${spaces}namespace instances: ${diff} not shown`);
  }
}

function ruleStatus(rule, cmd: RetentionStatusCommand, spaces) {
  const exp_data = rule.criteria.reduce(
    (exp_data, crit) => {
      if (exp_data.off === 0) {
        exp_data.off = crit.value;
      } else if (exp_data.off > crit.value) {
        exp_data.off = crit.value;
      }
      if (crit.next_object) exp_data.next_object = crit.next_object;
      return exp_data;
    },
    {off: 0, next_object: null},
  );

  if (!exp_data.next_object) exp_data.next_object = rule.next_object;

  const verbosity = cmd.verbose ? 1 : 0;
  const top_status = oiiToString(exp_data, verbosity);
  console.log(spaces + `rule: next_object[${top_status}]`);

  /* Indent rule metadata a bit. */
  spaces += '  ';

  let s = 'criteria[';
  s += rule.criteria
    .map(crit => {
      if (crit.type === 'object-age') return ageCritStatus(crit);
      return '-';
    })
    .join(', ');
  s += ']';
  console.log(spaces + s);

  s = 'actions[';
  s += rule.actions
    .map(act => {
      if (act.type === 'delete-all') return deleteActStatus(act);
      if (act.type === 'compress') return compressActStatus(act);
      return '-';
    })
    .join(', ');
  s += ']';

  console.log(spaces + s);
  if (verbosity >= 3) console.log(spaces + `${ruleTaskStatus(rule)}`);
  ruleStatusInstances(rule, cmd, exp_data.off, spaces);
}

function retentionStatusDump(cmd: RetentionStatusCommand, obj, name, level, indent) {
  let header, i;
  let spaces = '';

  if (retentionSkip(obj, level, name)) return;

  for (i = 0; i < indent; i++) spaces += ' ';
  header = spaces + level;
  if (name) header += ' ' + name;
  if (obj.state !== 'not installed' || !cmd.recursive || cmd.globalOptions.debug)
    console.log(header + ': policy state: ' + obj.state);
  spaces += '  ';

  if (obj.state !== 'not installed') {
    for (const rule of obj.rules) {
      ruleStatus(rule, cmd, spaces);
    }
  }
  if (typeof obj.children === 'object') {
    const keys = Object.keys(obj.children);
    const sublevel = retentionSublevel(level);
    for (i = 0; sublevel !== null && i < keys.length; i++) {
      retentionStatusDump(
        cmd,
        obj.children[keys[i]],
        keys[i],
        sublevel,
        indent + 2,
      );
    }
  }
}

/**
 * retention status [--type universe|project] [name]
 * -> api/control?action=rpstatus, parse response JSON
 */
function retentionStatus(cmd: RetentionStatusCommand, config: Config): void {
  const coroner = coronerClientFromGlobal(config, cmd.globalOptions);
  const params: any = {action: 'rpstatus'};
  const name = cmd.name;
  const type = cmd.type;
  let level = 'instance';

  if (cmd.recursive) params.recursive = true;

  if (type != undefined) {
    if (type !== 'project' && type !== 'universe')
      return usageRetentionStatus();
    if (name === undefined) return usageRetentionStatus();
    if (name.indexOf('/') != -1)
      return usageRetentionStatus('Type specified, so name must not contain /');
  }

  if (name !== undefined) {
    /* Parse the name to extract universe/project. */
    const split = name.split('/');
    let p_universe: string | undefined;
    let p_project: string | undefined;

    if (split.length === 2) {
      p_universe = split[0];
      p_project = split[1];
    } else {
      /* Single name: look up as project in default universe. */
      requireConfigFile(config);
      let first;
      for (first in config.config.universes) break;
      p_universe = first;
      p_project = name;
    }

    /* Check type for any needed overrides. */
    if (type === 'project') {
      p_project = name;
    } else if (type === 'universe') {
      p_universe = name;
      p_project = undefined;
    }

    if (p_project !== undefined) {
      level = 'project';
      params.project = p_project;
      params.universe = p_universe;
    } else if (p_universe !== undefined) {
      level = 'universe';
      params.universe = p_universe;
    }
  }

  coroner
    .promise('control', params)
    .then(r => {
      if (cmd.raw) console.log(JSON.stringify(r, null, 4));
      else retentionStatusDump(cmd, r, null, level, 0);
    })
    .catch(std_failure_cb);
}

/**
 * Handler for retention.list
 */
function handleRetentionList(cmd: RetentionListCommand, config: Config): any {
  abortIfNotLoggedIn(config);
  const coroner = coronerClientFromGlobal(config, cmd.globalOptions);
  const bpg = coronerBpgFromGlobal(coroner, cmd.globalOptions);
  retentionList(bpg, bpg.get());
}

/**
 * Handler for retention.set
 */
function handleRetentionSet(cmd: RetentionSetCommand, config: Config): any {
  abortIfNotLoggedIn(config);
  const coroner = coronerClientFromGlobal(config, cmd.globalOptions);
  const bpg = coronerBpgFromGlobal(coroner, cmd.globalOptions);
  return retentionSet(bpg, bpg.get(), cmd, config);
}

/**
 * Handler for retention.clear
 */
function handleRetentionClear(cmd: RetentionClearCommand, config: Config): any {
  abortIfNotLoggedIn(config);
  const coroner = coronerClientFromGlobal(config, cmd.globalOptions);
  const bpg = coronerBpgFromGlobal(coroner, cmd.globalOptions);
  return retentionClear(bpg, bpg.get(), cmd, config);
}

/**
 * Handler for retention.status
 */
function handleRetentionStatus(cmd: RetentionStatusCommand, config: Config): any {
  abortIfNotLoggedIn(config);
  return retentionStatus(cmd, config);
}

export const handlers = {
  'retention.list': handleRetentionList,
  'retention.set': handleRetentionSet,
  'retention.clear': handleRetentionClear,
  'retention.status': handleRetentionStatus,
} satisfies Partial<CommandHandlerMap>;
