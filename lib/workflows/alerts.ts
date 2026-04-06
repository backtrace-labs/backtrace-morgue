import {output, loadInit} from './utils';
import {CreateAlert} from './models/createAlert';
import {UpdateAlert} from './models/updateAlert';

import type {
  WorkflowsAlertCreateCommand,
  WorkflowsAlertListCommand,
  WorkflowsAlertGetCommand,
  WorkflowsAlertUpdateCommand,
  WorkflowsAlertDeleteCommand,
} from '../cli/generated/types';

export class WorkflowsAlertsCli {
  client: any;
  universe: any;
  project: any;

  constructor(client, universe, project) {
    this.client = client;
    this.universe = universe;
    this.project = project;
  }

  async getAlert(cmd: WorkflowsAlertGetCommand) {
    const alert = await this.client.getAlert(this.universe, this.project, cmd.id);
    output(alert, cmd.raw ?? false, printAlert);
  }

  async getAlerts(cmd: WorkflowsAlertListCommand) {
    const alerts = await this.client.getAlerts(this.universe, this.project);

    output(
      alerts.sort((a1, a2) => a1.name.localeCompare(a2.name)),
      cmd.raw ?? false,
      printAlert,
    );
  }

  async createAlert(cmd: WorkflowsAlertCreateCommand) {
    const init = loadInit(cmd.fromFile);
    const body = CreateAlert.fromCmd(cmd, init);

    const alert = await this.client.createAlert(
      this.universe,
      this.project,
      body,
    );

    output(alert, cmd.raw ?? false, printAlert);
  }

  async updateAlert(cmd: WorkflowsAlertUpdateCommand) {
    const init = loadInit(cmd.fromFile);
    const body = UpdateAlert.fromCmd(cmd, init);

    const alert = await this.client.updateAlert(
      this.universe,
      this.project,
      cmd.id,
      body,
    );

    output(alert, cmd.raw ?? false, printAlert);
  }

  async deleteAlert(cmd: WorkflowsAlertDeleteCommand) {
    const alert = await this.client.deleteAlert(
      this.universe,
      this.project,
      cmd.id,
    );

    output(alert, cmd.raw ?? false, printAlert);
  }
}

function printAlert(alert) {
  console.log(`Alert ID=${alert.id}`);
  console.log(`  name=${alert.name} state=${alert.state}`);
}
