const cliOptions = require("../../cli/options");
const assignDeep = require("assign-deep");
const { skipNotDefinedKeys, getPluginId } = require("../utils");

class CreateConnection {
  constructor({ pluginId, name, options }) {
    this.pluginId = pluginId;
    this.name = name;
    this.options = options;
  }

  static fromArgv(argv, init, options) {
    return new CreateConnection(
      assignDeep(
        init,
        skipNotDefinedKeys({
          name: cliOptions.convertOne("name", argv.name || init.name),
          pluginId: getPluginId(argv, init),
          options,
        })
      )
    );
  }
}

module.exports = CreateConnection;
