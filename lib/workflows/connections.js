const { output, loadInit } = require("./utils");
const cliOptions = require("../cli/options");
const CreateConnection = require("./models/createConnection");
const router = require("../cli/router");
const UpdateConnection = require("./models/updateConnection");

const HELP_MESSAGE = `
Usage:

morgue workflows connection [create | list | get | update | delete] <args>

See the Morgue README for option documentation.
`;

class WorkflowsConnectionsCli {
  constructor(client, universe) {
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
    const body = CreateConnection.fromArgv(argv, loadInit(argv));
    const connection = await this.client.createConnection(this.universe, body);
    output(connection, argv, printConnection);
  }

  async updateConnection(argv) {
    const id = cliOptions.convertOne("id", argv.id || argv._[0]);
    const body = UpdateConnection.fromArgv(argv, loadInit(argv));

    const connection = await this.client.updateConnection(
      this.universe,
      id,
      body
    );

    output(connection, argv, printConnection);
  }

  async deleteConnection(argv) {
    const id = cliOptions.convertOne("id", argv.id || argv._[0]);
    const connection = await this.client.deleteConnection(this.universe, id);
    output(connection, argv, printConnection);
  }
}

function printConnection(connection) {
  console.log(connection.id);
  console.log(`  name=${connection.name} plugin=${connection.pluginId}`);
}

module.exports = WorkflowsConnectionsCli;
