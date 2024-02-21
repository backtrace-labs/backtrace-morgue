const CreateIntegration = require("./models/createIntegration");
const cliOptions = require("../cli/options");
const router = require("../cli/router");
const UpdateIntegration = require("./models/updateIntegration");
const { output, loadInit } = require("./utils");

const HELP_MESSAGE = `
Usage:

morgue workflows integration [create | list | get | update | delete] <args>

See the Morgue README for option documentation.
`;

class WorkflowsIntegrationsCli {
  constructor(client, universe, project) {
    this.client = client;
    this.universe = universe;
    this.project = project;
  }

  async routeMethod(argv) {
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
    const idOrName =
      cliOptions.convertAtMostOne("id", argv.id) ||
      cliOptions.convertAtMostOne("name", argv.name) ||
      argv._[0];

    const integration = await this.client.getIntegration(
      this.universe,
      this.project,
      idOrName
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
    const body = CreateIntegration.fromArgv(argv, loadInit(argv));

    const integration = await this.client.createIntegration(
      this.universe,
      this.project,
      body
    );

    output(integration, argv, printIntegration);
  }

  async updateIntegration(argv) {
    const idOrName =
      cliOptions.convertAtMostOne("id", argv.id) ||
      cliOptions.convertAtMostOne("name", argv.name) ||
      argv._[0];

    const body = UpdateIntegration.fromArgv(argv, loadInit(argv));

    const integration = await this.client.updateIntegration(
      this.universe,
      this.project,
      idOrName,
      body
    );

    output(integration, argv, printIntegration);
  }

  async deleteIntegration(argv) {
    const idOrName =
      cliOptions.convertAtMostOne("id", argv.id) ||
      cliOptions.convertAtMostOne("name", argv.name) ||
      argv._[0];

    const integration = await this.client.deleteIntegration(
      this.universe,
      this.project,
      idOrName
    );

    output(integration, argv, printIntegration);
  }
}

function printIntegration(integration) {
  console.log(integration.id);
  console.log(
    `  name=${integration.watcherName} plugin=${integration.pluginId} state=${integration.state}`
  );
}

module.exports = WorkflowsIntegrationsCli;
