import * as client from './client';
import type {
  MetricsImporterImporterCreateCommand,
  MetricsImporterSourceCheckQueryCommand,
  MetricsImporterLogsCommand,
} from '../cli/generated/types';

export class MetricsImporterCli {
  client: any;

  constructor(client) {
    this.client = client;
  }

  async logs(cmd: MetricsImporterLogsCommand) {
    const {project, sourceId, importerId} = cmd;
    let limit = 100;

    if (!project) {
      console.log('Project is required');
      return;
    }
    if (!sourceId && !importerId) {
      console.error('Specify either --source or --importer, not both');
      return;
    }

    if (cmd.limit !== undefined) {
      limit = Number.parseInt(cmd.limit);
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

  async importerCreate(cmd: MetricsImporterImporterCreateCommand) {
    const {project, source, name, metric, metricGroup, query, delay} = cmd;
    const startAtUnparsed = cmd.startAt;

    if (!project) {
      console.error('Project is required');
      return;
    }

    if (!source) {
      console.error('--source is required');
      return;
    }

    if (!name) {
      console.error('--name is required');
      return;
    }

    if (!metric) {
      console.error('--metric is required');
      return;
    }

    if (!metricGroup) {
      console.error('--metric-group is required');
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
      sourceId: source,
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

  async sourceCheckQuery(cmd: MetricsImporterSourceCheckQueryCommand) {
    const {project, source, query} = cmd;

    if (!project) {
      console.error('Project is required');
      return;
    }

    if (!source) {
      console.error('--source is required');
      return;
    }

    if (!query) {
      console.error('--query is required');
      return;
    }

    const resp = await this.client.checkSource({
      project,
      sourceId: source,
      query,
    });
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
