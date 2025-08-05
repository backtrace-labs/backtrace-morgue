import * as cliOptions from '../cli/options';
import { errx } from '../cli/errors';
import { WorkflowsClient } from './client';
import * as router from '../cli/router';
import { WorkflowsIntegrationsCli } from './integrations';
import { WorkflowsAlertsCli } from './alerts';
import { WorkflowsConnectionsCli } from './connections';

const HELP_MESSAGE = `
Usage:

morgue workflows connection [create | list | get | update | delete] <options>
morgue workflows integration [create | list | get | update | delete] <options>
morgue workflows alert [create | list | get | update | delete] <options>

See the Morgue README for option documentation.
`;

export class WorkflowsCli {
  client: any;
  universe: any;
  project: any;
  integrations: any;
  alerts: any;
  connections: any;

  constructor(client, universe, project) {
    this.client = client;
    this.universe = universe;
    this.project = project;
    this.integrations = new WorkflowsIntegrationsCli(client, universe, project);
    this.alerts = new WorkflowsAlertsCli(client, universe, project);
    this.connections = new WorkflowsConnectionsCli(client, universe);
  }

  static async fromCoroner(coroner, argv, config) {
    let universe = cliOptions.convertAtMostOne("universe", argv.universe);
    const project = cliOptions.convertAtMostOne("project", argv.project);
    /*
     * Currently the service infrastructure doesn't support inferring
     * universe, so do it on our end if we can.
     */
    if (!universe && config.config.universe) {
      universe = config.config.universe.name;
    }
    if (!universe) {
      errx(
        "Unable to infer universe from config. Please provide --universe to select"
      );
    }
    const client = await WorkflowsClient.fromCoroner(coroner);
    return new WorkflowsCli(client, universe, project);
  }

  async routeMethod(args) {
    const routes = {
      integration: this.integrations.routeMethod.bind(this.integrations),
      alert: this.alerts.routeMethod.bind(this.alerts),
      connection: this.connections.routeMethod.bind(this.connections),
    };

    await router.route(routes, HELP_MESSAGE, args);
  }
}
