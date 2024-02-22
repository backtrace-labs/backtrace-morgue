const cliOptions = require("../cli/options");
const { errx } = require("../cli/errors");
const WorkflowsClient = require("./client");
const router = require("../cli/router");
const WorkflowsIntegrationsCli = require("./integrations");
const WorkflowsAlertsCli = require("./alerts");
const WorkflowsConnectionsCli = require("./connections");

const HELP_MESSAGE = `
Usage:

morgue workflows integration <args>

See the Morgue README for option documentation.
`;

class WorkflowsCli {
  constructor(client, universe, project) {
    this.client = client;
    this.universe = universe;
    this.project = project;
    this.integrations = new WorkflowsIntegrationsCli(client, universe, project);
    this.alerts = new WorkflowsAlertsCli(client, universe, project);
    this.connections = new WorkflowsConnectionsCli(client, universe, project);
  }

  static async fromCoroner(coroner, argv, config) {
    let universe = cliOptions.convertAtMostOne("universe", argv.universe);
    const project = cliOptions.convertAtMostOne("project", argv.project);
    /*
     * Currently the Rust service infrastructure doesn't support inferring
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

module.exports = WorkflowsCli;
