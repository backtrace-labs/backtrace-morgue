import { CreateIntegration } from './models/createIntegration';
import * as cliOptions from '../cli/options';
import * as router from '../cli/router';
import { UpdateIntegration } from './models/updateIntegration';
import { output, loadInit, getPluginId } from './utils';
import { errx } from '../cli/errors';
import { integrationOptions } from './plugins/plugins';

const HELP_MESSAGE = `
Usage:

morgue workflows integration [create | list | get | update | delete] <args>

See the Morgue README for option documentation.
`;

export class WorkflowsIntegrationsCli {
  client: any;
  universe: any;
  project: any;

  constructor(client: any, universe: any, project: any) {
    this.client = client;
    this.universe = universe;
    this.project = project;
  }

  async routeMethod(argv) {
    if (!this.project) {
      errx("--project is required");
    }

    const routes = {
      get: this.getIntegration.bind(this),
      list: this.getIntegrations.bind(this),
      create: this.createIntegration.bind(this),
      update: this.updateIntegration.bind(this),
      delete: this.deleteIntegration.bind(this),
    };

    await router.route(routes, HELP_MESSAGE, argv);
  }

  async getIntegration(argv) {
    const id = cliOptions.convertOne("id", argv.id || argv._[0]);
    const integration = await this.client.getIntegration(
      this.universe,
      this.project,
      id
    );

    output(integration, argv, printIntegration);
  }

  async getIntegrations(argv) {
    const integrations = await this.client.getIntegrations(
      this.universe,
      this.project
    );

    integrations
      .sort((i1, i2) => i1.watcherName.localeCompare(i2.watcherName))
      .forEach((i) => output(i, argv, printIntegration));
  }

  async createIntegration(argv) {
    const init = loadInit(argv);
    const pluginId = getPluginId(argv, init);
    const optionsInitFn = integrationOptions(pluginId);

    const body = CreateIntegration.fromArgv(
      argv,
      init,
      optionsInitFn(argv, init)
    );

    const integration = await this.client.createIntegration(
      this.universe,
      this.project,
      body
    );

    output(integration, argv, printIntegration);
  }

  async updateIntegration(argv) {
    const id = cliOptions.convertOne("id", argv.id || argv._[0]);
    const integration = await this.client.getIntegration(
      this.universe,
      this.project,
      id
    );

    const init = loadInit(argv);
    const pluginId = integration.pluginId;
    const optionsInitFn = integrationOptions(pluginId);

    const body = UpdateIntegration.fromArgv(
      argv,
      init,
      optionsInitFn(argv, init)
    );

    const updated = await this.client.updateIntegration(
      this.universe,
      this.project,
      id,
      body
    );

    output(updated, argv, printIntegration);
  }

  async deleteIntegration(argv) {
    const id = cliOptions.convertOne("id", argv.id || argv._[0]);
    const integration = await this.client.deleteIntegration(
      this.universe,
      this.project,
      id
    );

    output(integration, argv, printIntegration);
  }
}

function printIntegration(integration) {
  console.log(`Integration ID=${integration.id}`);
  console.log(
    `  name=${integration.watcherName} plugin=${integration.pluginId} state=${integration.state}`
  );
}
