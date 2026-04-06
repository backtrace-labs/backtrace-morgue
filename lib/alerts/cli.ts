import * as options from '../cli/options';
import * as time from '../cli/time';
import {errx} from '../cli/errors';
import * as queryCli from '../cli/query';

import * as client from './client';

import type {
  AlertsTargetCreateCommand,
  AlertsTargetGetCommand,
  AlertsTargetUpdateCommand,
  AlertsTargetDeleteCommand,
  AlertsAlertGetCommand,
  AlertsAlertCreateCommand,
  AlertsAlertUpdateCommand,
  AlertsAlertDeleteCommand,
  GlobalOptions,
} from '../cli/generated/types';

export class AlertsCli {
  client: any;

  constructor(client, universe, project) {
    this.client = client;
    this.client.setDefaultQs({universe, project});
  }

  async targetIdFromName(name: string) {
    for await (const t of this.client.listTargets()) {
      if (t.name == name) {
        return t.id;
      }
    }
    errx(`Target ${name} not found`);
  }

  async targetIdFromIdOrName(id?: string, name?: string) {
    if (!id && !name) {
      errx('One of --id or --name is required');
    }
    if (!id) {
      id = await this.targetIdFromName(name!);
    }
    return id;
  }

  printTarget(target) {
    console.log(`${target.id}`);
    console.log(
      `  name=${target.name} workflow=${target.workflow1.workflow_name}`,
    );
  }

  async getTarget(cmd: AlertsTargetGetCommand) {
    const id = await this.targetIdFromIdOrName(cmd.id, cmd.name);
    const target = await this.client.getTarget(id);
    this.printTarget(target);
  }

  async listTargets() {
    for await (const t of this.client.listTargets()) {
      this.printTarget(t);
    }
  }

  async createTarget(cmd: AlertsTargetCreateCommand) {
    const res = await this.client.createTarget({
      name: cmd.name,
      target_type: 'workflow1',
      workflow1: {
        workflow_name: cmd.workflowName,
      },
    });
    console.log(`Created target ${res.id}`);
  }

  async deleteTarget(cmd: AlertsTargetDeleteCommand) {
    const id = await this.targetIdFromIdOrName(cmd.id, cmd.name);
    await this.client.deleteTarget(id);
    console.log(`Deleted target ${id}`);
  }

  async updateTarget(cmd: AlertsTargetUpdateCommand) {
    const id = await this.targetIdFromIdOrName(cmd.id, cmd.name);
    const target = await this.client.getTarget(id);
    if (cmd.rename) {
      target.name = cmd.rename;
    }
    if (cmd.workflowName) {
      target.workflow1.workflow_name = cmd.workflowName;
    }
    await this.client.updateTarget(id, target);
    console.log(`Target ${id} updated`);
  }

  async alertIdFromName(name: string) {
    for await (const a of this.client.listAlerts()) {
      if (a.name == name) {
        return a.id;
      }
    }
    errx(`Alert ${name} not found`);
  }

  async alertIdFromIdOrName(id?: string, name?: string) {
    if (!id && !name) {
      errx('One of --id or --name is required');
    }
    if (!id) {
      id = await this.alertIdFromName(name!);
    }
    return id;
  }

  /*
   * Generate a possibly partial alert specification, minus the query, which
   * is handled separately.
   */
  async generateAlertSpec(
    cmd: {
      name?: string;
      enabled?: string;
      queryPeriod?: string;
      minNotificationInterval?: string;
      muteUntil?: string;
      trigger?: string | string[];
      targetId?: string[];
      targetName?: string[];
    },
    isCreate: boolean,
  ) {
    const convertOne = isCreate ? options.convertOne : options.convertAtMostOne;
    const partial: any = {
      name: convertOne('name', cmd.name),
      /* This is always optional, defaults true below if in create. */
      enabled: options.convertAtMostOne('enabled', cmd.enabled),
      query_period: convertOne('query-period', cmd.queryPeriod),
      min_notification_interval: convertOne(
        'min-notification-interval',
        cmd.minNotificationInterval,
      ),
      /* Also always optional; defaults to 0 if in create. */
      mute_until: options.convertAtMostOne('mute-until', cmd.muteUntil),
      triggers: options.convertMany('trigger', cmd.trigger, true),
    };

    if (partial.enabled === undefined || partial.enabled === null) {
      if (isCreate) {
        partial.enabled = true;
      }
    } else {
      partial.enabled = options.convertBool('enabled', partial.enabled);
    }
    if (partial.mute_until === undefined || partial.mute_until === null) {
      if (isCreate) {
        partial.mute_until = 0;
      }
    }

    /*
     * targets are always optional, even on create.
     */
    const targetIds = options.convertMany('target-id', cmd.targetId, true);
    const targetNames = options.convertMany(
      'target-name',
      cmd.targetName,
      true,
    );

    if (targetIds) {
      partial.targets = targetIds;
    }

    if (targetNames) {
      partial.targets = partial.targets || [];
      for (const t of targetNames) {
        partial.targets.push(await this.targetIdFromName(t));
      }
    }

    if (partial.query_period) {
      partial.query_period = time.timespecToSeconds(partial.query_period);
    }

    if (partial.min_notification_interval) {
      partial.min_notification_interval = time.timespecToSeconds(
        partial.min_notification_interval,
      );
    }

    /*
     * the format of a trigger is column,index,comparison,warning,critical.
     */
    if (partial.triggers) {
      const parsedTriggers = [];
      for (const t of partial.triggers) {
        const split = t.split(',');
        if (split.length != 5) {
          errx(
            'The format of a trigger is column,aggregation_index,comparison,warning,critical',
          );
        }
        const [column, index_str, comparison, warningStr, criticalStr] = split;
        const index = Number.parseInt(index_str);
        if (Number.isNaN(index)) {
          errx('Trigger indices must be integers');
        }
        if (comparison != 'le' && comparison != 'ge') {
          errx('Valid trigger comparisons are le or ge');
        }
        const warning = Number.parseFloat(warningStr);
        if (Number.isNaN(warning)) {
          errx('Trigger warning is not a valid number');
        }
        const critical = Number.parseFloat(criticalStr);
        if (Number.isNaN(critical)) {
          errx('Trigger critical threshold is not a number');
        }

        parsedTriggers.push({
          aggregation: {
            column,
            index,
          },
          comparison_operator: comparison,
          warning_threshold: warning,
          critical_threshold: critical,
        });
      }

      partial.triggers = parsedTriggers;
    }

    return partial;
  }

  async createAlert(cmd: AlertsAlertCreateCommand) {
    const spec = await this.generateAlertSpec(cmd, true);

    const query = queryCli.buildQuery(
      cmd.queryOptions,
      /*implicitTimestampOps=*/ false,
      /*doFolds=*/ true,
    ).query;
    if (query.select || query['select-wildcard']) {
      errx('Alerts only work on aggregation queryes');
    }

    const queryStr = JSON.stringify(query);
    spec.query = queryStr;

    const res = await this.client.createAlert(spec);
    console.log(`Created alert ${res.id}`);
  }

  async updateAlert(cmd: AlertsAlertUpdateCommand) {
    const unfilteredSpec = this.generateAlertSpec(cmd, false);

    /*
     * Filter out anything which wasn't set.
     */
    const spec: any = {};
    for (const [k, v] of Object.entries(await unfilteredSpec)) {
      if (v === null || v === undefined) {
        continue;
      }
      spec[k] = v;
    }

    /*
     * get rid of name, if set.
     */
    delete spec.name;
    if (cmd.rename) {
      spec.name = cmd.rename;
    }

    /*
     * because buildQuery is happy to generate queries from empty args, require
     * the user to be explicit.
     */
    var updated: any = {};
    if (cmd.replaceQuery) {
      const query = queryCli.buildQuery(
        cmd.queryOptions,
        /*implicitTimestampOps=*/ false,
        /*doFolds=*/ true,
      ).query;
      if (query.select || query['select-wildcard']) {
        errx('Alerts only work with aggregation queries');
      }
      updated.query = JSON.stringify(query);
    }

    if (cmd.clearTargets) {
      updated.targets = [];
    }

    const id = await this.alertIdFromIdOrName(cmd.id, cmd.name);
    const alert = await this.client.getAlert(id);
    updated = {...alert, ...spec, ...updated};
    await this.client.updateAlert(id, updated);
    console.log(`Updated alert ${id}`);
  }

  printAlert(a) {
    const period = time.secondsToTimespec(a.query_period);
    console.log(`${a.id}`);
    /* Note: we don't have a way to pretty print CRDB queries. */
    console.log(`  name=${a.name} period=${period}`);
  }

  async listAlerts() {
    for await (const a of this.client.listAlerts()) {
      this.printAlert(a);
    }
  }

  async getAlert(cmd: AlertsAlertGetCommand) {
    const id = await this.alertIdFromIdOrName(cmd.id, cmd.name);
    const alert = await this.client.getAlert(id);
    this.printAlert(alert);
  }

  async deleteAlert(cmd: AlertsAlertDeleteCommand) {
    const id = await this.alertIdFromIdOrName(cmd.id, cmd.name);
    await this.client.deleteAlert(id);
    console.log(`Deleted alert ${id}`);
  }
}

export async function alertsCliFromCoroner(
  coroner,
  globalOptions: GlobalOptions,
  config,
) {
  let universe = globalOptions.universe;
  const project = globalOptions.project;
  if (!project) {
    errx('--project is required');
  }
  /*
   * Currently the Rust service infrastructure doesn't support inferring
   * universe, so do it on our end if we can.
   */
  if (!universe && config.config.universe) {
    universe = config.config.universe.name;
  }
  if (!universe) {
    errx(
      'Unable to infer universe from config. Please provide --universe to select',
    );
  }
  const c = await client.alertsClientFromCoroner(coroner);
  return new AlertsCli(c, universe, project);
}
