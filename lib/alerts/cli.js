const router = require('../cli/router');
const options = require('../cli/options');
const time = require('../cli/time');
const { errx } = require('../cli/errors');
const queryCli = require('../cli/query');

const client = require('./client');

const HELP_MESSAGE = `
USAGE:

morgue alerts target [create | list | get | update | delete] <args>
morgue alerts alert [create | list | get | update | delete] <args>

See the Morgue README for option documentation.
`;
class AlertsCli {
  constructor(client, universe, project) {
    this.client = client;
    this.client.setDefaultQs({ universe, project });
  }

  async routeMethod(args) {
    const routes = {
      target: {
        get: this.getTarget.bind(this),
        list: this.listTargets.bind(this),
        create: this.createTarget.bind(this),
        delete: this.deleteTarget.bind(this),
        update: this.updateTarget.bind(this),
      },
      alert: {
        get: this.getAlert.bind(this),
        list: this.listAlerts.bind(this),
        create: this.createAlert.bind(this),
        update: this.updateAlert.bind(this),
        delete: this.deleteAlert.bind(this),
      }
    };

    router.route(routes, HELP_MESSAGE, args);
  }

  async targetIdFromName(name) {
    for await (const t of this.client.listTargets()) {
      if (t.name == name) {
        return t.id;
      }
    }
    errx(`Target ${name} not found`);
  }

  async targetIdFromArgs(argv) {
    let id = options.convertAtMostOne("id", argv.id);
    let name = options.convertAtMostOne("name", argv.name);
    if (!id && !name) {
      errx("One of --id or --name is required");
    }
    if (!id) {
      id = await this.targetIdFromName(name);
    }
    return id;
  }

  printTarget(target) {
    console.log(`${target.id}`);
    console.log(`  name=${target.name} workflow=${target.workflow1.workflow_name}`);
  }

  async getTarget(argv) {
    const id = await this.targetIdFromArgs(argv);
    const target = await this.client.getTarget(id);
    this.printTarget(target);
  }

  async listTargets() {
    for await (const t of this.client.listTargets()) {
      this.printTarget(t);
    }
  }

  async createTarget(argv) {
    const name = options.convertOne("name", argv.name);
    const workflowName =
      options.convertOne("workflow-name", argv["workflow-name"]);
    const res = await this.client.createTarget({
      name,
      target_type: "workflow1",
      workflow1: {
        workflow_name: workflowName,
      }
    });
    console.log(`Created target ${res.id}`);
  }

  async deleteTarget(argv) {
    const id = await this.targetIdFromArgs(argv);
    await this.client.deleteTarget(id);
    console.log(`Deleted target ${id}`);
  }

  async updateTarget(argv) {
    const id = await this.targetIdFromArgs(argv);
    const newName = options.convertAtMostOne("rename", argv.rename);
    const workflowName =
      options.convertAtMostOne("workflow-name", argv["workflow-name"]);
    let target = await this.client.getTarget(id);
    if (newName) {
      target.name = newName;
    }
    if (workflowName) {
      target.workflow1.workflow_name = workflowName;
    }
    await this.client.updateTarget(id, target);
    console.log(`Target ${id} updated`);
  }

  async alertIdFromName(name) {
    for await (const a of this.client.listAlerts()) {
      if (a.name == name) {
        return a.id;
      }
    }
    errx(`Alert ${name} not found`);
  }

  async alertIdFromArgs(argv) {
    let id = options.convertAtMostOne("id", argv.id);
    let name = options.convertAtMostOne("name", argv.name);
    if (!id && !name) {
      errx("One of --id or --name is required");
    }
    if (!id) {
      id = await this.alertIdFromName(name);
    }
    return id;
  }

  /*
   * Generate a possibly partial alert specification, minus the query, which
   * is handled separately.
   *
   */
  async generateAlertSpec(argv, isCreate) {
    const convertOne = isCreate ? options.convertOne : options.convertAtMostOne;
    const partial = {
      name: convertOne("name", argv.name),
      /* This is always optional, defaults true below if in create. */
      enabled: options.convertAtMostOne("enabled", argv.enabled),
      query_period: convertOne("query-period", argv['query-period']),
      min_notification_interval: convertOne("min-notification-interval",
        argv['min-notification-interval']),
      /* Also always optional; defaults to 0 if in create. */
      mute_until: options.convertAtMostOne("mute-until", argv['mute-until']),
      triggers: options.convertMany("trigger", argv.trigger, true),
    };

    if (partial.enabled === undefined || partial.enabled === null) {
      if (isCreate) {
        partial.enabled = true;
      }
    } else {
      partial.enabled = options.convertBool("enabled", partial.enabled);
    }
    if (partial.mute_until === undefined || partial.mute_until === null) {
      if (isCreate) {
        partial.mute_until = 0;
      }
    }

    /*
     * targets are always optional, even on create.
     */
    let targetIds = options.convertMany("target-id", argv['target-id'], true);
    const targetNames = options.convertMany("target-name",
      argv['target-name'], true);

    if (targetIds) {
      partial.targets = targetIds;
    }

    if (targetNames) {
      partial.targets = partial.targets || [];
      for (const t of targetNames) {
        partial.targets.push(await this.targetIdFromName(t));
      }
    }

    if (partial.query_period) {
      partial.query_period = time.timespecToSeconds(partial.query_period);
    }

    if (partial.min_notification_interval) {
      partial.min_notification_interval =
        time.timespecToSeconds(partial.min_notification_interval);
    }

    /*
     * the format of a trigger is column,index,comparison,warning,critical.
     */
    if (partial.triggers) {
      let parsedTriggers = [];
      for (const t of partial.triggers) {
        const split = t.split(",");
        if (split.length != 5) {
          errx("The format of a trigger is column,aggregation_index,comparison,warning,critical");
        }
        const [column, index_str, comparison, warningStr, criticalStr] = split;
        const index = Number.parseInt(index_str);
        if (Number.isNaN(index)) {
          errx("Trigger indices must be integers");
        }
        if (comparison != "le" && comparison != "ge") {
          errx("Valid trigger comparisons are le or ge");
        }
        const warning = Number.parseFloat(warningStr);
        if (Number.isNaN(warning)) {
          errx("Trigger warning is not a valid number");
        }
        const critical = Number.parseFloat(criticalStr);
        if (Number.isNaN(critical)) {
          errx("Trigger critical threshold is not a number");
        }

        parsedTriggers.push({
          aggregation: {
            column,
            index,
          },
          comparison_operator: comparison,
          warning_threshold: warning,
          critical_threshold: critical,
        });
      }

      partial.triggers = parsedTriggers;
    }

    return partial;
  }

  async createAlert(argv) {
    const spec = await this.generateAlertSpec(argv, true);

    const query = queryCli.argvQuery(argv, /*implicitTimestampOps=*/false,
      /*doFolds=*/true).query;
    if (query.select) {
      errx("Alerts only work on aggregation queryes");
    }

    const queryStr = JSON.stringify(query);
    spec.query = queryStr;

    let res = await this.client.createAlert(spec);
    console.log(`Created alert ${res.id}`);
  }

  async updateAlert(argv) {
    let unfilteredSpec = this.generateAlertSpec(argv, false);

    /*
     * Filter out anything which wasn't set.
     */
    const spec = {};
    for (const [k, v] of unfilteredSpec) {
      if (v === null || v === undefined) {
        continue;
      }
      spec[k] = v;
    }

    /*
     * get rid of name, if set.
     */
    delete spec.name;
    const newName = options.convertAtMostOne("rename", argv.rename);
    if (newName) {
      spec.name = newName;
    }

    /*
     * because argvQuery is happy to generate queries from empty args, require
     * the user to be explicit.
     */
    if (argv['replace-query']) {
      const query = queryCli.argvQuery(argv, /*implicitTimestampOps=*/false,
        /*doFolds=*/true).query;
      if (query.select) {
        errx("Alerts only work with aggregation queries");
      }
      updated.query = JSON.stringify(query);
    }

    if (argv['clear-targets']) {
      updated.targets = [];
    }

    const id = this.alertIdFromArgv(argv);
    const alert  = await this.client.getAlert(id);
    const updated = { ...alert, ...spec };
    await this.client.updateAlert(id, updated);
    console.log(`Updated alert ${id}`);
  }

  printAlert(a) {
    const period = time.secondsToTimespec(a.query_period);
    console.log(`${a.id}`);
    /* Note: we don't have a way to pretty print CRDB queries. */
    console.log(`  name=${a.name} period=${period}`);
  }

  async listAlerts() {
    for await (const a of this.client.listAlerts()) {
      this.printAlert(a);
    }
  }

  async getAlert(argv) {
    const id = await this.alertIdFromArgs(argv);
    const alert = await this.client.getAlert(id);
    this.printAlert(alert);
  }

  async deleteAlert(argv) {
    const id = await this.alertIdFromArgs(argv);
    await this.client.deleteAlert(id);
    console.log(`Deleted alert ${id}`);
  }
}

async function alertsCliFromCoroner(coroner, argv, config) {
  let universe = options.convertAtMostOne("universe", argv.universe);
  const project = options.convertOne("project", argv.project);
  /*
   * Currently the Rust service infrastructure doesn't support inferring
   * universe, so do it on our end if we can.
   */
  if (!universe && config.config.universe) {
    universe = config.config.universe.name;
  }
  if (!universe) {
    errx("Unable to infer universe from config. Please provide --universe to select");
  }
  const c = await client.alertsClientFromCoroner(coroner);
  return new AlertsCli(c, universe, project);
}

module.exports = {
  AlertsCli,
  alertsCliFromCoroner,
};
