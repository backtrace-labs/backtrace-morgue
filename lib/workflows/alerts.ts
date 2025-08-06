import {output, loadInit} from './utils';
import * as cliOptions from '../cli/options';
import {CreateAlert} from './models/createAlert';
import * as router from '../cli/router';
import {UpdateAlert} from './models/updateAlert';
import {errx} from '../cli/errors';

const HELP_MESSAGE = `
Usage:

morgue workflows alert [create | list | get | update | delete] <args>

See the Morgue README for option documentation.
`;

export class WorkflowsAlertsCli {
  client: any;
  universe: any;
  project: any;

  constructor(client, universe, project) {
    this.client = client;
    this.universe = universe;
    this.project = project;
  }

  async routeMethod(argv) {
    if (!this.project) {
      errx('--project is required');
    }

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
    const id = cliOptions.convertOne('id', argv.id || argv._[0]);
    const alert = await this.client.getAlert(this.universe, this.project, id);
    output(alert, argv, printAlert);
  }

  async getAlerts(argv) {
    const alerts = await this.client.getAlerts(this.universe, this.project);

    output(
      alerts.sort((a1, a2) => a1.name.localeCompare(a2.name)),
      argv,
      printAlert,
    );
  }

  async createAlert(argv) {
    const body = CreateAlert.fromArgv(argv, loadInit(argv));

    const alert = await this.client.createAlert(
      this.universe,
      this.project,
      body,
    );

    output(alert, argv, printAlert);
  }

  async updateAlert(argv) {
    const id = cliOptions.convertOne('id', argv.id || argv._[0]);
    const body = UpdateAlert.fromArgv(argv, loadInit(argv));

    const alert = await this.client.updateAlert(
      this.universe,
      this.project,
      id,
      body,
    );

    output(alert, argv, printAlert);
  }

  async deleteAlert(argv) {
    const id = cliOptions.convertOne('id', argv.id || argv._[0]);
    const alert = await this.client.deleteAlert(
      this.universe,
      this.project,
      id,
    );

    output(alert, argv, printAlert);
  }
}

function printAlert(alert) {
  console.log(`Alert ID=${alert.id}`);
  console.log(`  name=${alert.name} state=${alert.state}`);
}
