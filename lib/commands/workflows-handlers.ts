import {
  abortIfNotLoggedIn,
  coronerClientFromGlobal,
} from '../cli/context';
import {WorkflowsCli} from '../workflows/cli';
import type {
  WorkflowsConnectionCreateCommand,
  WorkflowsConnectionListCommand,
  WorkflowsConnectionGetCommand,
  WorkflowsConnectionUpdateCommand,
  WorkflowsConnectionDeleteCommand,
  WorkflowsIntegrationCreateCommand,
  WorkflowsIntegrationListCommand,
  WorkflowsIntegrationGetCommand,
  WorkflowsIntegrationUpdateCommand,
  WorkflowsIntegrationDeleteCommand,
  WorkflowsAlertCreateCommand,
  WorkflowsAlertListCommand,
  WorkflowsAlertGetCommand,
  WorkflowsAlertUpdateCommand,
  WorkflowsAlertDeleteCommand,
  GlobalOptions,
} from '../cli/generated/types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function buildCli(
  globalOptions: GlobalOptions,
  config: any,
): Promise<WorkflowsCli> {
  abortIfNotLoggedIn(config);
  const coroner = coronerClientFromGlobal(config, globalOptions);
  return WorkflowsCli.fromCoroner(coroner, globalOptions, config);
}

// ---------------------------------------------------------------------------
// Connection handlers
// ---------------------------------------------------------------------------

async function connectionCreate(cmd: WorkflowsConnectionCreateCommand, config: any) {
  const cli = await buildCli(cmd.globalOptions, config);
  await cli.connections.createConnection(cmd);
}

async function connectionList(cmd: WorkflowsConnectionListCommand, config: any) {
  const cli = await buildCli(cmd.globalOptions, config);
  await cli.connections.getConnections(cmd);
}

async function connectionGet(cmd: WorkflowsConnectionGetCommand, config: any) {
  const cli = await buildCli(cmd.globalOptions, config);
  await cli.connections.getConnection(cmd);
}

async function connectionUpdate(cmd: WorkflowsConnectionUpdateCommand, config: any) {
  const cli = await buildCli(cmd.globalOptions, config);
  await cli.connections.updateConnection(cmd);
}

async function connectionDelete(cmd: WorkflowsConnectionDeleteCommand, config: any) {
  const cli = await buildCli(cmd.globalOptions, config);
  await cli.connections.deleteConnection(cmd);
}

// ---------------------------------------------------------------------------
// Integration handlers
// ---------------------------------------------------------------------------

async function integrationCreate(cmd: WorkflowsIntegrationCreateCommand, config: any) {
  const cli = await buildCli(cmd.globalOptions, config);
  await cli.integrations.createIntegration(cmd);
}

async function integrationList(cmd: WorkflowsIntegrationListCommand, config: any) {
  const cli = await buildCli(cmd.globalOptions, config);
  await cli.integrations.getIntegrations(cmd);
}

async function integrationGet(cmd: WorkflowsIntegrationGetCommand, config: any) {
  const cli = await buildCli(cmd.globalOptions, config);
  await cli.integrations.getIntegration(cmd);
}

async function integrationUpdate(cmd: WorkflowsIntegrationUpdateCommand, config: any) {
  const cli = await buildCli(cmd.globalOptions, config);
  await cli.integrations.updateIntegration(cmd);
}

async function integrationDelete(cmd: WorkflowsIntegrationDeleteCommand, config: any) {
  const cli = await buildCli(cmd.globalOptions, config);
  await cli.integrations.deleteIntegration(cmd);
}

// ---------------------------------------------------------------------------
// Workflows Alert handlers
// ---------------------------------------------------------------------------

async function alertCreate(cmd: WorkflowsAlertCreateCommand, config: any) {
  const cli = await buildCli(cmd.globalOptions, config);
  await cli.alerts.createAlert(cmd);
}

async function alertList(cmd: WorkflowsAlertListCommand, config: any) {
  const cli = await buildCli(cmd.globalOptions, config);
  await cli.alerts.getAlerts(cmd);
}

async function alertGet(cmd: WorkflowsAlertGetCommand, config: any) {
  const cli = await buildCli(cmd.globalOptions, config);
  await cli.alerts.getAlert(cmd);
}

async function alertUpdate(cmd: WorkflowsAlertUpdateCommand, config: any) {
  const cli = await buildCli(cmd.globalOptions, config);
  await cli.alerts.updateAlert(cmd);
}

async function alertDelete(cmd: WorkflowsAlertDeleteCommand, config: any) {
  const cli = await buildCli(cmd.globalOptions, config);
  await cli.alerts.deleteAlert(cmd);
}

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------

export const handlers: Record<string, (cmd: any, config: any) => any> = {
  'workflows.connection.create': connectionCreate,
  'workflows.connection.list': connectionList,
  'workflows.connection.get': connectionGet,
  'workflows.connection.update': connectionUpdate,
  'workflows.connection.delete': connectionDelete,
  'workflows.integration.create': integrationCreate,
  'workflows.integration.list': integrationList,
  'workflows.integration.get': integrationGet,
  'workflows.integration.update': integrationUpdate,
  'workflows.integration.delete': integrationDelete,
  'workflows.alert.create': alertCreate,
  'workflows.alert.list': alertList,
  'workflows.alert.get': alertGet,
  'workflows.alert.update': alertUpdate,
  'workflows.alert.delete': alertDelete,
};
