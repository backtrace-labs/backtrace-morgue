import {errx} from '../cli/errors';
import {WorkflowsClient} from './client';
import {WorkflowsIntegrationsCli} from './integrations';
import {WorkflowsAlertsCli} from './alerts';
import {WorkflowsConnectionsCli} from './connections';

import type {GlobalOptions} from '../cli/generated/types';

export class WorkflowsCli {
  client: any;
  universe: any;
  project: any;
  integrations: WorkflowsIntegrationsCli;
  alerts: WorkflowsAlertsCli;
  connections: WorkflowsConnectionsCli;

  constructor(client, universe, project) {
    this.client = client;
    this.universe = universe;
    this.project = project;
    this.integrations = new WorkflowsIntegrationsCli(client, universe, project);
    this.alerts = new WorkflowsAlertsCli(client, universe, project);
    this.connections = new WorkflowsConnectionsCli(client, universe);
  }

  static async fromCoroner(
    coroner,
    globalOptions: GlobalOptions,
    config,
  ): Promise<WorkflowsCli> {
    let universe = globalOptions.universe;
    const project = globalOptions.project;
    /*
     * Currently the service infrastructure doesn't support inferring
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
    const client = await WorkflowsClient.fromCoroner(coroner);
    return new WorkflowsCli(client, universe, project);
  }
}
