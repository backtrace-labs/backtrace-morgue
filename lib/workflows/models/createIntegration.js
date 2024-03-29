const cliOptions = require("../../cli/options");
const assignDeep = require("assign-deep");
const { skipNotDefinedKeys, getPluginId } = require("../utils");

class CreateIntegration {
  constructor({
    pluginId,
    watcherName,
    state,
    synchronizeIssues,
    synchronizeIssuesOnAdd,
    options,
    connectionId,
  }) {
    this.pluginId = pluginId;
    this.watcherName = watcherName;
    this.state = state;
    this.synchronizeIssues = synchronizeIssues;
    this.synchronizeIssuesOnAdd = synchronizeIssuesOnAdd;
    this.options = options;
    this.connectionId = connectionId;
  }

  static fromArgv(argv, init, options) {
    return new CreateIntegration(
      assignDeep(
        init,
        skipNotDefinedKeys({
          pluginId: getPluginId(argv, init),
          watcherName: cliOptions.convertOne(
            "name",
            argv.name || init.watcherName
          ),
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
            argv.connection || init.connectionId
          ),
          options,
        })
      )
    );
  }
}

module.exports = CreateIntegration;
