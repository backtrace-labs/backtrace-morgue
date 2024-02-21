const cliOptions = require("../../cli/options");
const assignDeep = require("assign-deep");
const { skipNotDefinedKeys } = require("../utils");

class CreateConnection {
  constructor({ pluginId, name, options }) {
    this.pluginId = pluginId;
    this.name = name;
    this.options = options;
  }

  static fromArgv(argv, init) {
    return new CreateConnection(
      assignDeep(
        init,
        skipNotDefinedKeys({
          name: cliOptions.convertOne("name", argv.name || init.name),
          pluginId: cliOptions.convertOne(
            "plugin",
            argv.plugin || init.pluginId
          ),
          options: cliOptions.convertObject(
            "options",
            argv.options || init.options
          ),
        })
      )
    );
  }
}

module.exports = CreateConnection;
