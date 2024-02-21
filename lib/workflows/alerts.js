const { output, loadInit } = require("./utils");
const cliOptions = require("../cli/options");
const CreateAlert = require("./models/createAlert");
const router = require("../cli/router");
const UpdateAlert = require("./models/updateAlert");

const HELP_MESSAGE = `
Usage:

morgue workflows alert [create | list | get | update | delete] <args>

See the Morgue README for option documentation.
`;

class WorkflowsAlertsCli {
  constructor(client, universe, project) {
    this.client = client;
    this.universe = universe;
    this.project = project;
  }

  async routeMethod(argv) {
    const routes = {
      get: this.getAlert.bind(this),
      list: this.getAlerts.bind(this),
      create: this.createAlert.bind(this),
      update: this.updateAlert.bind(this),
      delete: this.deleteAlert.bind(this),
    };

    await router.route(routes, HELP_MESSAGE, argv);
  }

  async getAlert(argv) {
    const id = cliOptions.convertAtMostOne("id", argv.id) || argv._[0];
    const alert = await this.client.getAlert(this.universe, this.project, id);
    output(alert, argv, printAlert);
  }

  async getAlerts(argv) {
    const alerts = await this.client.getAlerts(this.universe, this.project);

    alerts
      .sort((i1, i2) => i1.watcherName.localeCompare(i2.watcherName))
      .forEach((i) => output(i, argv, printAlert));
  }

  async createAlert(argv) {
    const body = CreateAlert.fromArgv(argv, loadInit(argv));

    const alert = await this.client.createAlert(
      this.universe,
      this.project,
      body
    );

    output(alert, argv, printAlert);
  }

  async updateAlert(argv) {
    const id = cliOptions.convertAtMostOne("id", argv.id) || argv._[0];

    const body = UpdateAlert.fromArgv(argv, loadInit(argv));

    const alert = await this.client.updateAlert(
      this.universe,
      this.project,
      id,
      body
    );

    output(alert, argv, printAlert);
  }

  async deleteAlert(argv) {
    const id = cliOptions.convertAtMostOne("id", argv.id) || argv._[0];

    const alert = await this.client.deleteAlert(
      this.universe,
      this.project,
      id
    );

    output(alert, argv, printAlert);
  }
}

function printAlert(alert) {
  console.log(alert.id);
  console.log(`  name=${alert.name} state=${alert.state}`);
}

module.exports = WorkflowsAlertsCli;
