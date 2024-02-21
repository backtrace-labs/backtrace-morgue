const cliOptions = require("../../cli/options");
const assignDeep = require("assign-deep");
const { skipNotDefinedKeys } = require("../utils");

class UpdateConnection {
  constructor({ name, options }) {
    this.name = name;
    this.options = options;
  }

  static fromArgv(argv, init) {
    return new UpdateConnection(
      assignDeep(
        init,
        skipNotDefinedKeys({
          name: cliOptions.convertAtMostOne("name", argv.name || init.name),
          options: cliOptions.convertObject(
            "options",
            argv.options || init.options,
            true
          ),
        })
      )
    );
  }
}

module.exports = UpdateConnection;
