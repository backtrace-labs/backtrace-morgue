import {CreateIntegration} from './models/createIntegration';
import {UpdateIntegration} from './models/updateIntegration';
import {output, loadInit} from './utils';
import {integrationOptions} from './plugins/plugins';
import * as cliOptions from '../cli/options';

import type {
  WorkflowsIntegrationCreateCommand,
  WorkflowsIntegrationListCommand,
  WorkflowsIntegrationGetCommand,
  WorkflowsIntegrationUpdateCommand,
  WorkflowsIntegrationDeleteCommand,
} from '../cli/generated/types';

export class WorkflowsIntegrationsCli {
  client: any;
  universe: any;
  project: any;

  constructor(client: any, universe: any, project: any) {
    this.client = client;
    this.universe = universe;
    this.project = project;
  }

  async getIntegration(cmd: WorkflowsIntegrationGetCommand) {
    const integration = await this.client.getIntegration(
      this.universe,
      this.project,
      cmd.id,
    );

    output(integration, cmd.raw ?? false, printIntegration);
  }

  async getIntegrations(cmd: WorkflowsIntegrationListCommand) {
    const integrations = await this.client.getIntegrations(
      this.universe,
      this.project,
    );

    integrations
      .sort((i1, i2) => i1.watcherName.localeCompare(i2.watcherName))
      .forEach(i => output(i, cmd.raw ?? false, printIntegration));
  }

  async createIntegration(cmd: WorkflowsIntegrationCreateCommand) {
    const init = loadInit(cmd.fromFile);
    const pluginId = cliOptions.convertOne(
      'plugin',
      cmd.plugin || init.pluginId,
    );
    const optionsInitFn = integrationOptions(pluginId);

    const body = CreateIntegration.fromCmd(
      cmd,
      init,
      optionsInitFn(cmd.options, init),
    );

    const integration = await this.client.createIntegration(
      this.universe,
      this.project,
      body,
    );

    output(integration, cmd.raw ?? false, printIntegration);
  }

  async updateIntegration(cmd: WorkflowsIntegrationUpdateCommand) {
    const integration = await this.client.getIntegration(
      this.universe,
      this.project,
      cmd.id,
    );

    const init = loadInit(cmd.fromFile);
    const pluginId = integration.pluginId;
    const optionsInitFn = integrationOptions(pluginId);

    const body = UpdateIntegration.fromCmd(
      cmd,
      init,
      optionsInitFn(cmd.options, init),
    );

    const updated = await this.client.updateIntegration(
      this.universe,
      this.project,
      cmd.id,
      body,
    );

    output(updated, cmd.raw ?? false, printIntegration);
  }

  async deleteIntegration(cmd: WorkflowsIntegrationDeleteCommand) {
    const integration = await this.client.deleteIntegration(
      this.universe,
      this.project,
      cmd.id,
    );

    output(integration, cmd.raw ?? false, printIntegration);
  }
}

function printIntegration(integration) {
  console.log(`Integration ID=${integration.id}`);
  console.log(
    `  name=${integration.watcherName} plugin=${integration.pluginId} state=${integration.state}`,
  );
}
