import type {Config} from '../config';
import {
  abortIfNotLoggedIn,
  coronerClientFromGlobal,
} from '../cli/context';
import {AlertsCli, alertsCliFromCoroner} from '../alerts/cli';
import type {
  AlertsTargetCreateCommand,
  AlertsTargetListCommand,
  AlertsTargetGetCommand,
  AlertsTargetUpdateCommand,
  AlertsTargetDeleteCommand,
  AlertsAlertListCommand,
  AlertsAlertGetCommand,
  AlertsAlertCreateCommand,
  AlertsAlertUpdateCommand,
  AlertsAlertDeleteCommand,
  CommandHandler,
  CommandHandlerMap,
} from '../cli/generated/types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function buildCli(
  globalOptions: {universe?: string; project?: string} & Record<string, any>,
  config: Config,
): Promise<AlertsCli> {
  abortIfNotLoggedIn(config);
  const coroner = coronerClientFromGlobal(config, globalOptions);
  return alertsCliFromCoroner(coroner, globalOptions, config);
}

// ---------------------------------------------------------------------------
// Target handlers
// ---------------------------------------------------------------------------

async function targetCreate(cmd: AlertsTargetCreateCommand, config: Config) {
  const cli = await buildCli(cmd.globalOptions, config);
  await cli.createTarget(cmd);
}

async function targetList(cmd: AlertsTargetListCommand, config: Config) {
  const cli = await buildCli(cmd.globalOptions, config);
  await cli.listTargets();
}

async function targetGet(cmd: AlertsTargetGetCommand, config: Config) {
  const cli = await buildCli(cmd.globalOptions, config);
  await cli.getTarget(cmd);
}

async function targetUpdate(cmd: AlertsTargetUpdateCommand, config: Config) {
  const cli = await buildCli(cmd.globalOptions, config);
  await cli.updateTarget(cmd);
}

async function targetDelete(cmd: AlertsTargetDeleteCommand, config: Config) {
  const cli = await buildCli(cmd.globalOptions, config);
  await cli.deleteTarget(cmd);
}

// ---------------------------------------------------------------------------
// Alert handlers
// ---------------------------------------------------------------------------

async function alertList(cmd: AlertsAlertListCommand, config: Config) {
  const cli = await buildCli(cmd.globalOptions, config);
  await cli.listAlerts();
}

async function alertGet(cmd: AlertsAlertGetCommand, config: Config) {
  const cli = await buildCli(cmd.globalOptions, config);
  await cli.getAlert(cmd);
}

async function alertCreate(cmd: AlertsAlertCreateCommand, config: Config) {
  const cli = await buildCli(cmd.globalOptions, config);
  await cli.createAlert(cmd);
}

async function alertUpdate(cmd: AlertsAlertUpdateCommand, config: Config) {
  const cli = await buildCli(cmd.globalOptions, config);
  await cli.updateAlert(cmd);
}

async function alertDelete(cmd: AlertsAlertDeleteCommand, config: Config) {
  const cli = await buildCli(cmd.globalOptions, config);
  await cli.deleteAlert(cmd);
}

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------

export const handlers = {
  'alerts.target.create': targetCreate,
  'alerts.target.list': targetList,
  'alerts.target.get': targetGet,
  'alerts.target.update': targetUpdate,
  'alerts.target.delete': targetDelete,
  'alerts.alert.list': alertList,
  'alerts.alert.get': alertGet,
  'alerts.alert.create': alertCreate,
  'alerts.alert.update': alertUpdate,
  'alerts.alert.delete': alertDelete,
} satisfies Partial<CommandHandlerMap>;
