const cliOptions = require("../../cli/options");
const assignDeep = require("assign-deep");
const { skipNotDefinedKeys } = require("../utils");

class UpdateIntegration {
  constructor({
    state,
    synchronizeIssues,
    synchronizeIssuesOnAdd,
    options,
    connectionId,
  }) {
    this.state = state;
    this.synchronizeIssues = synchronizeIssues;
    this.synchronizeIssuesOnAdd = synchronizeIssuesOnAdd;
    this.options = options;
    this.connectionId = connectionId;
  }

  static fromArgv(argv, init, options) {
    return new UpdateIntegration(
      assignDeep(
        init,
        skipNotDefinedKeys({
          state: cliOptions.convertAtMostOne("state", argv.state || init.state),
          synchronizeIssues: cliOptions.convertBool(
            "synchronize-issues",
            argv["synchronize-issues"] || init.synchronizeIssues,
            null
          ),
          synchronizeIssuesOnAdd: cliOptions.convertBool(
            "synchronize-issues-on-add",
            argv["synchronize-issues-on-add"] || init.synchronizeIssuesOnAdd,
            null
          ),
          connectionId: cliOptions.convertAtMostOne(
            "connection",
            argv.connectionId || init.connectionId
          ),
          options,
        })
      )
    );
  }
}

module.exports = UpdateIntegration;
