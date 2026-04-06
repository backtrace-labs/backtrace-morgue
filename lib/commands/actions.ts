import * as fs from 'fs';
import * as config from '../config';
import {errx} from '../cli/errors';
import {coronerClientArgv, coronerBpgSetup, projectIdFromFlags} from '../cli/context';

function stabilityCreateMetric(coroner, argv, config) {
  let universe = argv.universe;
  if (!universe) {
    universe = Object.keys(config.config.universes)[0];
  }

  if (!universe) {
    errx('--universe is required');
  }

  const project = argv.project;
  if (!project) {
    errx('--project is required');
  }

  const metricGroupName = argv['metric-group'];
  if (!metricGroupName) {
    errx('--metric-group is required');
  }
  if (Array.isArray(metricGroupName)) {
    errx('Specify only one --metric-group');
  }

  const name = argv.name;
  if (!name) {
    errx('--name is required');
  }
  if (Array.isArray(name)) {
    errx('Only one --name allowed');
  }

  let attributes = argv.attribute;
  if (!attributes) {
    /*
     * 0 attributes are possible, though rare save for people integrating with
     * the submission API directly.
     */
    attributes = [];
  } else if (!Array.isArray(attributes)) {
    attributes = [attributes];
  }

  const bpg = coronerBpgSetup(coroner, argv);
  const model = bpg.get();

  if (!model.metric_group) {
    errx('No metric groups exist yet.');
  }

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
      break;
    }
  }

  if (pid === 0) {
    errx('Project not found');
  }

  let metricGroupId = 0;
  for (const g of model.metric_group) {
    if (g.get('name') === metricGroupName && g.get('project') === pid) {
      metricGroupId = g.get('id');
      break;
    }
  }

  if (metricGroupId === 0) {
    errx('Metric group not found');
  }

  const attributesObj: any = {};
  for (const a of attributes) {
    const parts = a.split(',');
    if (parts.length != 2) {
      errx('Usage of --attribute is name, value');
    }
    if (parts[1].length === 0) {
      errx('Attributes may not have empty values');
    }
    /*
     * This works because coronerd uses crdb_column_string_set, so no matter
     * the column type, the attribute can be a string. Otherwise, we'd have
     * to do a bunch of joins in order to do further validation.
     */
    attributesObj[parts[0]] = parts[1];
  }

  const obj = bpg.new('metric').withFields({
    metric_group: metricGroupId,
    name,
    attribute_values: JSON.stringify(attributesObj),
  });
  bpg.create(obj);
  bpg.commit();
  console.log('Metric created');
}

function coronerStability(argv: any, config: any): any {
  const coroner = coronerClientArgv(config, argv);

  argv._.shift();
  if (argv._.length === 0) {
    errx('Subcommand missing. Valid subcommands: create-metric');
  }

  const commands = {
    'create-metric': stabilityCreateMetric,
  };

  const cmd = argv._.shift();
  const fn = commands[cmd];
  if (!fn) {
    errx('Unrecognized subcommand');
  }
  return fn(coroner, argv, config);
}

function actionsEnable(bpg, pid, ssa) {
  if (!ssa) {
    errx('No server_side_actions is configured for this project');
  }

  bpg.modify(ssa, {enabled: 1});
  bpg.commit();

  console.log('Actions enabled for this project');
  return;
}

function actionsDisable(bpg, pid, ssa) {
  if (!ssa) {
    errx('No actions configuration for this project');
  }

  bpg.modify(ssa, {enabled: 0});
  bpg.commit();

  console.log('Actions disabled for this project');
  return;
}

function actionsUpload(bpg, pid, ssa, path) {
  if (!path) {
    errx('Specify config file to upload');
  }

  const cfg = fs.readFileSync(path, 'utf8');
  if (ssa) {
    bpg.modify(ssa, {configuration: cfg});
  } else {
    const tmp = bpg.new('server_side_actions').withFields({
      project: pid,
      configuration: cfg,
      enabled: 1,
    });
    bpg.create(tmp);
  }
  bpg.commit();

  console.log('Configuration uploaded');
  return;
}

function actionsDelete(bpg, pid, ssa) {
  if (!ssa) {
    errx('No actions config exists for this project');
  }

  bpg.delete(ssa);
  bpg.commit();

  console.log('Actions configuration deleted');
}

function actionsGet(bpg, pid, ssa) {
  if (!ssa) {
    console.log('No actions configuration for this project');
    return;
  }

  console.log(
    `Actions are ${ssa.get('enabled') ? 'enabled' : 'disabled'} for this project.`,
  );
  console.log('JSON configuration is:');
  console.log(ssa.get('configuration'));
}

function coronerActions(argv: any, config: any): any {
  const coroner = coronerClientArgv(config, argv);
  const bpg = coronerBpgSetup(coroner, argv);
  const model = bpg.get();

  const pid = projectIdFromFlags(config, model, argv);

  const cmd = argv._[1];
  if (!cmd) {
    errx('Command is required');
  }

  let ssa = model.server_side_actions;
  if (Array.isArray(ssa)) {
    const ind = ssa.findIndex(x => x.get('project') === pid);
    ssa = ind >= 0 ? ssa[ind] : undefined;
  }

  const commands = {
    disable: actionsDisable,
    enable: actionsEnable,
    upload: actionsUpload,
    delete: actionsDelete,
    get: actionsGet,
  };

  const fn = commands[cmd];
  if (!fn) {
    errx('Unrecognized command.');
  }

  fn(bpg, pid, ssa, /*path=*/ argv._[2]);
}

export const commands: Record<string, (argv: any, config: config.Config) => any> = {
  actions: coronerActions,
  stability: coronerStability,
};
