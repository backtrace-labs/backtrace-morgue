import type {Config} from '../config';
import * as fs from 'fs';
import {errx} from '../cli/errors';
import {
  abortIfNotLoggedIn,
  coronerClientFromGlobal,
  coronerBpgFromGlobal,
  projectIdFromFlags,
  getDefaultUniverse,
} from '../cli/context';
import type {
  ActionsGetCommand,
  ActionsDisableCommand,
  ActionsEnableCommand,
  ActionsUploadCommand,
  ActionsDeleteCommand,
  StabilityCreateMetricCommand,
  CommandHandler,
} from '../cli/generated/types';

function actionsGet(cmd: ActionsGetCommand, config: Config): any {
  abortIfNotLoggedIn(config);
  const coroner = coronerClientFromGlobal(config, cmd.globalOptions);
  const bpg = coronerBpgFromGlobal(coroner, cmd.globalOptions);
  const model = bpg.get();

  const pid = projectIdFromFlags(config, model, {universe: cmd.universe, project: cmd.project});

  let ssa = model.server_side_actions;
  if (Array.isArray(ssa)) {
    const ind = ssa.findIndex(x => x.get('project') === pid);
    ssa = ind >= 0 ? ssa[ind] : undefined;
  }

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

function actionsDisable(cmd: ActionsDisableCommand, config: Config): any {
  abortIfNotLoggedIn(config);
  const coroner = coronerClientFromGlobal(config, cmd.globalOptions);
  const bpg = coronerBpgFromGlobal(coroner, cmd.globalOptions);
  const model = bpg.get();

  const pid = projectIdFromFlags(config, model, {universe: cmd.universe, project: cmd.project});

  let ssa = model.server_side_actions;
  if (Array.isArray(ssa)) {
    const ind = ssa.findIndex(x => x.get('project') === pid);
    ssa = ind >= 0 ? ssa[ind] : undefined;
  }

  if (!ssa) {
    errx('No actions configuration for this project');
  }

  bpg.modify(ssa, {enabled: 0});
  bpg.commit();

  console.log('Actions disabled for this project');
}

function actionsEnable(cmd: ActionsEnableCommand, config: Config): any {
  abortIfNotLoggedIn(config);
  const coroner = coronerClientFromGlobal(config, cmd.globalOptions);
  const bpg = coronerBpgFromGlobal(coroner, cmd.globalOptions);
  const model = bpg.get();

  const pid = projectIdFromFlags(config, model, {universe: cmd.universe, project: cmd.project});

  let ssa = model.server_side_actions;
  if (Array.isArray(ssa)) {
    const ind = ssa.findIndex(x => x.get('project') === pid);
    ssa = ind >= 0 ? ssa[ind] : undefined;
  }

  if (!ssa) {
    errx('No server_side_actions is configured for this project');
  }

  bpg.modify(ssa, {enabled: 1});
  bpg.commit();

  console.log('Actions enabled for this project');
}

function actionsUpload(cmd: ActionsUploadCommand, config: Config): any {
  abortIfNotLoggedIn(config);
  const coroner = coronerClientFromGlobal(config, cmd.globalOptions);
  const bpg = coronerBpgFromGlobal(coroner, cmd.globalOptions);
  const model = bpg.get();

  const pid = projectIdFromFlags(config, model, {universe: cmd.universe, project: cmd.project});

  let ssa = model.server_side_actions;
  if (Array.isArray(ssa)) {
    const ind = ssa.findIndex(x => x.get('project') === pid);
    ssa = ind >= 0 ? ssa[ind] : undefined;
  }

  const cfg = fs.readFileSync(cmd.path, 'utf8');
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
}

function actionsDelete(cmd: ActionsDeleteCommand, config: Config): any {
  abortIfNotLoggedIn(config);
  const coroner = coronerClientFromGlobal(config, cmd.globalOptions);
  const bpg = coronerBpgFromGlobal(coroner, cmd.globalOptions);
  const model = bpg.get();

  const pid = projectIdFromFlags(config, model, {universe: cmd.universe, project: cmd.project});

  let ssa = model.server_side_actions;
  if (Array.isArray(ssa)) {
    const ind = ssa.findIndex(x => x.get('project') === pid);
    ssa = ind >= 0 ? ssa[ind] : undefined;
  }

  if (!ssa) {
    errx('No actions config exists for this project');
  }

  bpg.delete(ssa);
  bpg.commit();

  console.log('Actions configuration deleted');
}

function stabilityCreateMetric(cmd: StabilityCreateMetricCommand, config: Config): any {
  abortIfNotLoggedIn(config);
  const coroner = coronerClientFromGlobal(config, cmd.globalOptions);
  const bpg = coronerBpgFromGlobal(coroner, cmd.globalOptions);

  let universe = cmd.universe;
  if (!universe) {
    universe = getDefaultUniverse(config);
  }

  if (!universe) {
    errx('--universe is required');
  }

  const project = cmd.project;
  if (!project) {
    errx('--project is required');
  }

  const metricGroupName = cmd.metricGroup;
  if (!metricGroupName) {
    errx('--metric-group is required');
  }

  const name = cmd.name;
  if (!name) {
    errx('--name is required');
  }

  let attributes: string[] = [];
  if (cmd.attribute) {
    if (Array.isArray(cmd.attribute)) {
      attributes = cmd.attribute;
    } else {
      attributes = [cmd.attribute];
    }
  }

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

export const handlers: Record<string, CommandHandler> = {
  'actions.get': actionsGet,
  'actions.disable': actionsDisable,
  'actions.enable': actionsEnable,
  'actions.upload': actionsUpload,
  'actions.delete': actionsDelete,
  'stability.create-metric': stabilityCreateMetric,
};
