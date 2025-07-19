import * as client from './client';

function validateOne(option, value) {
  if (!value) {
    console.error(`--${option} is required`);
    return false;
  }
  if (Array.isArray(value)) {
    console.error(`--${option} must have exactly one value`);
    return false;
  }
  return true;
}

function validateZeroOrOne(option, value) {
  if (Array.isArray(value)) {
    console.error(`--${option} must have at most one value`);
    return false;
  }
  return true;
}

export class MetricsImporterCli {
  client: any;

  constructor(client) {
    this.client = client;
  }

  async routeMethod(args) {
    const routes = {
      importer: {
        create: args => this.importerCreate(args),
      },
      source: {
        'check-query': args => this.sourceCheckQuery(args),
      },
      logs: args => this.logs(args),
    };

    let route = routes;
    let next;
    while (typeof route === 'object') {
      next = args._[0];
      args._.shift();
      if (!next) {
        route = null;
        break;
      }
      route = route[next];
    }

    if (!route) {
      console.error(
        'Unrecognized command. See metrics-importer help for usage',
      );
      return;
    }
    await (route as any)(args);
  }

  help() {
    console.warn(`
    usage: morgue metrics-import [<entity>] <command> <options>
    
    Command may be one of the following:
    
    source check-query: Run a test query against a given source.
    importer create: create an importer.
    logs: Get logs by source id or importer id.
    
    For full documentation, please see:
    https://github.com/backtrace-labs/backtrace-morgue
    `);
  }

  async logs(args) {
    const project = args.project;
    const sourceId = args['source'];
    const importerId = args['importer'];
    let limit = 100;

    if (!project) {
      console.log('Project is required');
      return;
    }
    if (
      !validateZeroOrOne('source', sourceId) ||
      !validateZeroOrOne('importer', importerId)
    ) {
      return;
    }
    if (!sourceId && !importerId) {
      console.error('Specify either --source or --importer, not both');
      return;
    }

    if ('limit' in args) {
      limit = Number.parseInt(args.limit);
      if (Number.isNaN(limit) || limit <= 0) {
        console.error('--limit must be a positive integer');
        return;
      }
    }

    const response = await this.client.logs({
      project,
      sourceId,
      importerId,
      limit,
    });

    if (response.messages.length === 0) {
      console.log('No logs');
      return;
    }

    /*
     * The service gives us messages most recent first, but we want to display
     * most recent last.
     */
    const sorted = response.messages.reverse();
    for (const m of sorted) {
      const time = new Date(m.time * 1000).toISOString();
      let msg;
      if (importerId) {
        msg = `${time} ${m.message}`;
      } else {
        msg = `${time} importer=${m.sourceId} ${m.message}`;
      }
      msg = `${m.level.padEnd(9)}${msg}`;
      console.log(msg);
    }
  }

  async importerCreate(args) {
    const project = args.project;
    const sourceId = args['source'];
    const query = args.query;
    const startAtUnparsed = args['start-at'];
    const delay = args.delay;
    const metric = args.metric;
    const metricGroup = args['metric-group'];
    const name = args.name;

    if (!project) {
      console.error('Project is required');
      return;
    }

    if (
      !validateOne('source', sourceId) ||
      !validateOne('name', name) ||
      !validateOne('metric', metric) ||
      !validateOne('metric-group', metricGroup) ||
      !validateZeroOrOne('delay', delay) ||
      !validateZeroOrOne('start-at', startAtUnparsed)
    ) {
      return;
    }

    /* By default, scrape the last day. */
    let startAt = new Date(Date.now() - 24 * 60 * 1000);
    if (startAtUnparsed) {
      startAt = new Date(startAtUnparsed);
      if (Number.isNaN(startAt.getTime())) {
        console.error('Unable to parse --start-at');
        return;
      }
    }

    const params = {
      project,
      sourceId,
      name,
      metric,
      metricGroup,
      query,
      startAt: Math.floor(startAt.getTime() / 1000),
      delay: delay !== undefined ? delay : 60,
    };

    const resp = await this.client.createImporter(params);
    console.log(`Importer id ${resp.id}`);
  }

  async sourceCheckQuery(args) {
    const project = args.project;
    const sourceId = args['source'];
    const query = args.query;

    if (!project) {
      console.error('Project is required');
      return;
    }

    if (!validateOne('source', sourceId) || !validateOne('query', query)) {
      return;
    }

    const resp = await this.client.checkSource({project, sourceId, query});
    if (resp.errors.length) {
      console.log('Errors:');
      resp.errors.map(i => console.log(i));
      console.log('');
    }
    if (resp.warnings.length) {
      console.log('Warnings:');
      resp.warnings.map(i => console.log(i));
      console.log('');
    }
    if (resp.success) {
      console.log(
        'This query can be used as a valid importer query for this source',
      );
    } else {
      console.log(`If used to create an importer, this query will be unable to
complete scrapes successfully.`);
    }
  }
}

export async function metricsImporterCliFromCoroner(coroner) {
  const c = await client.metricsImporterClientFromCoroner(coroner);
  return new MetricsImporterCli(c);
}
