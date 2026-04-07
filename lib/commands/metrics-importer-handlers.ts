import type {Config} from '../config';
import {metricsImporterCliFromCoroner} from '../metricsImporter/cli';
import {coronerClientFromGlobal} from '../cli/context';
import type {
  MetricsImporterImporterCreateCommand,
  MetricsImporterSourceCheckQueryCommand,
  MetricsImporterLogsCommand,
  CommandHandler,
  CommandHandlerMap,
} from '../cli/generated/types';

async function makeCli(
  cmd: {globalOptions: any},
  config: Config,
) {
  const coroner = coronerClientFromGlobal(config, cmd.globalOptions);
  return metricsImporterCliFromCoroner(coroner);
}

// --- metrics-importer.importer.create ---

async function handleImporterCreate(
  cmd: MetricsImporterImporterCreateCommand,
  config: Config,
) {
  const cli = await makeCli(cmd, config);
  await cli.importerCreate(cmd);
}

// --- metrics-importer.source.check-query ---

async function handleSourceCheckQuery(
  cmd: MetricsImporterSourceCheckQueryCommand,
  config: Config,
) {
  const cli = await makeCli(cmd, config);
  await cli.sourceCheckQuery(cmd);
}

// --- metrics-importer.logs ---

async function handleLogs(cmd: MetricsImporterLogsCommand, config: Config) {
  const cli = await makeCli(cmd, config);
  await cli.logs(cmd);
}

export const handlers = {
  'metrics-importer.importer.create': handleImporterCreate,
  'metrics-importer.source.check-query': handleSourceCheckQuery,
  'metrics-importer.logs': handleLogs,
} satisfies Partial<CommandHandlerMap>;
