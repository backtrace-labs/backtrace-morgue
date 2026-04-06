import {metricsImporterCliFromCoroner} from '../metricsImporter/cli';
import {coronerClientFromGlobal} from '../cli/context';
import type {
  MetricsImporterImporterCreateCommand,
  MetricsImporterSourceCheckQueryCommand,
  MetricsImporterLogsCommand,
} from '../cli/generated/types';

async function makeCli(
  cmd: {globalOptions: any},
  config: any,
) {
  const coroner = coronerClientFromGlobal(config, cmd.globalOptions);
  return metricsImporterCliFromCoroner(coroner);
}

// --- metrics-importer.importer.create ---

async function handleImporterCreate(
  cmd: MetricsImporterImporterCreateCommand,
  config: any,
) {
  const cli = await makeCli(cmd, config);
  await cli.importerCreate(cmd);
}

// --- metrics-importer.source.check-query ---

async function handleSourceCheckQuery(
  cmd: MetricsImporterSourceCheckQueryCommand,
  config: any,
) {
  const cli = await makeCli(cmd, config);
  await cli.sourceCheckQuery(cmd);
}

// --- metrics-importer.logs ---

async function handleLogs(cmd: MetricsImporterLogsCommand, config: any) {
  const cli = await makeCli(cmd, config);
  await cli.logs(cmd);
}

export const handlers: Record<string, (cmd: any, config: any) => any> = {
  'metrics-importer.importer.create': handleImporterCreate,
  'metrics-importer.source.check-query': handleSourceCheckQuery,
  'metrics-importer.logs': handleLogs,
};
