import { output, loadInit, getPluginId } from './utils';
import * as cliOptions from '../cli/options';
import { CreateConnection } from './models/createConnection';
import * as router from '../cli/router';
import { UpdateConnection } from './models/updateConnection';
import { connectionOptions } from './plugins/plugins';

const HELP_MESSAGE = `
Usage:

morgue workflows connection [create | list | get | update | delete] <args>

See the Morgue README for option documentation.
`;

export class WorkflowsConnectionsCli {
  client: any;
  universe: any;

  constructor(client: any, universe: any) {
    this.client = client;
    this.universe = universe;
  }

  async routeMethod(argv) {
    const routes = {
      get: this.getConnection.bind(this),
      list: this.getConnections.bind(this),
      create: this.createConnection.bind(this),
      update: this.updateConnection.bind(this),
      delete: this.deleteConnection.bind(this),
    };

    await router.route(routes, HELP_MESSAGE, argv);
  }

  async getConnection(argv) {
    const id = cliOptions.convertOne("id", argv.id || argv._[0]);
    const connection = await this.client.getConnection(this.universe, id);
    output(connection, argv, printConnection);
  }

  async getConnections(argv) {
    const connections = await this.client.getConnections(this.universe);

    output(
      connections.sort((c1, c2) => c1.name.localeCompare(c2.name)),
      argv,
      printConnection
    );
  }

  async createConnection(argv) {
    const init = loadInit(argv);
    const pluginId = getPluginId(argv, init);
    const optionsInitFn = connectionOptions(pluginId);

    const body = CreateConnection.fromArgv(argv, init, optionsInitFn(pluginId));
    const connection = await this.client.createConnection(this.universe, body);
    output(connection, argv, printConnection);
  }

  async updateConnection(argv) {
    const id = cliOptions.convertOne("id", argv.id || argv._[0]);
    const connection = await this.client.getConnection(this.universe, id);

    const init = loadInit(argv);
    const pluginId = connection.pluginId;
    const optionsInitFn = connectionOptions(pluginId);

    const body = UpdateConnection.fromArgv(
      argv,
      init,
      optionsInitFn(argv, init)
    );

    const updated = await this.client.updateConnection(this.universe, id, body);

    output(updated, argv, printConnection);
  }

  async deleteConnection(argv) {
    const id = cliOptions.convertOne("id", argv.id || argv._[0]);
    const connection = await this.client.deleteConnection(this.universe, id);
    output(connection, argv, printConnection);
  }
}

function printConnection(connection) {
  console.log(`Connection ID=${connection.id}`);
  console.log(`  name=${connection.name} plugin=${connection.pluginId}`);
}
