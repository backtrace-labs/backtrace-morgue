const cliOptions = require("../../cli/options");
const assignDeep = require("assign-deep");
const { parseFilter } = require("../../cli/query");
const { skipNotDefinedKeys } = require("../utils");

class CreateAlert {
  constructor({
    name,
    condition,
    state,
    filters,
    threshold,
    frequency,
    integrations,
    executionDelay,
  }) {
    this.name = name;
    this.condition = condition;
    this.state = state;
    this.filters = filters;
    this.threshold = threshold;
    this.frequency = frequency;
    this.integrations = integrations;
    this.executionDelay = executionDelay;
  }

  static fromArgv(argv, init) {
    return new CreateAlert(
      assignDeep(
        init,
        skipNotDefinedKeys({
          name: cliOptions.convertOne("name", argv.name || init.name),
          condition: cliOptions.convertObject(
            "condition",
            argv.condition || init.condition
          ),
          state: cliOptions.convertAtMostOne("state", argv.state || init.state),
          filters: argv.filter
            ? cliOptions
                .convertMany("filter", argv.filter, true)
                .map(parseFilter)
                .map((filter) => ({ type: "attribute", ...filter }))
            : cliOptions.convertMany("filter", init.filters, true),
          threshold: cliOptions.convertAtMostOne(
            "threshold",
            argv.threshold ?? init.threshold
          ),
          frequency: cliOptions.convertOne(
            "frequency",
            argv.frequency ?? init.frequency
          ),
          integrations: cliOptions.convertMany(
            "integration",
            argv.integration ?? init.integrations,
            true
          ),
          executionDelay: cliOptions.convertAtMostOne(
            "execution-delay",
            argv["execution-delay"] || init.executionDelay
          ),
        })
      )
    );
  }
}

module.exports = CreateAlert;
