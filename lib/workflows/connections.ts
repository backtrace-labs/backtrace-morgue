import {output, loadInit} from './utils';
import {CreateConnection} from './models/createConnection';
import {UpdateConnection} from './models/updateConnection';
import {connectionOptions} from './plugins/plugins';
import * as cliOptions from '../cli/options';

import type {
  WorkflowsConnectionCreateCommand,
  WorkflowsConnectionListCommand,
  WorkflowsConnectionGetCommand,
  WorkflowsConnectionUpdateCommand,
  WorkflowsConnectionDeleteCommand,
} from '../cli/generated/types';

export class WorkflowsConnectionsCli {
  client: any;
  universe: any;

  constructor(client: any, universe: any) {
    this.client = client;
    this.universe = universe;
  }

  async getConnection(cmd: WorkflowsConnectionGetCommand) {
    const connection = await this.client.getConnection(this.universe, cmd.id);
    output(connection, cmd.raw ?? false, printConnection);
  }

  async getConnections(cmd: WorkflowsConnectionListCommand) {
    const connections = await this.client.getConnections(this.universe);

    output(
      connections.sort((c1, c2) => c1.name.localeCompare(c2.name)),
      cmd.raw ?? false,
      printConnection,
    );
  }

  async createConnection(cmd: WorkflowsConnectionCreateCommand) {
    const init = loadInit(cmd.fromFile);
    const pluginId = cliOptions.convertOne(
      'plugin',
      cmd.plugin || init.pluginId,
    );
    const optionsInitFn = connectionOptions(pluginId);

    const body = CreateConnection.fromCmd(cmd, init, optionsInitFn(cmd.options, init));
    const connection = await this.client.createConnection(this.universe, body);
    output(connection, cmd.raw ?? false, printConnection);
  }

  async updateConnection(cmd: WorkflowsConnectionUpdateCommand) {
    const connection = await this.client.getConnection(this.universe, cmd.id);

    const init = loadInit(cmd.fromFile);
    const pluginId = connection.pluginId;
    const optionsInitFn = connectionOptions(pluginId);

    const body = UpdateConnection.fromCmd(
      cmd,
      init,
      optionsInitFn(cmd.options, init),
    );

    const updated = await this.client.updateConnection(this.universe, cmd.id, body);

    output(updated, cmd.raw ?? false, printConnection);
  }

  async deleteConnection(cmd: WorkflowsConnectionDeleteCommand) {
    const connection = await this.client.deleteConnection(this.universe, cmd.id);
    output(connection, cmd.raw ?? false, printConnection);
  }
}

function printConnection(connection) {
  console.log(`Connection ID=${connection.id}`);
  console.log(`  name=${connection.name} plugin=${connection.pluginId}`);
}
