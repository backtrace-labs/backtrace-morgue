const cliOptions = require("../../cli/options");
const assignDeep = require("assign-deep");
const { skipNotDefinedKeys } = require("../utils");

class UpdateConnection {
  constructor({ name, options }) {
    this.name = name;
    this.options = options;
  }

  static fromArgv(argv, init, options) {
    return new UpdateConnection(
      assignDeep(
        init,
        skipNotDefinedKeys({
          name: cliOptions.convertAtMostOne("name", argv.name || init.name),
          options,
        })
      )
    );
  }
}

module.exports = UpdateConnection;
