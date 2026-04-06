#!/usr/bin/env node

'use strict';

// setup abort controller
import '../lib/abortController';

import minimist from 'minimist';
import * as path from 'path';
import * as bt from '@backtrace/node';
import * as packageJson from '../package.json';
import promptLib from 'prompt';
import * as symbold from '../lib/symbold';
import * as metricsImporterCli from '../lib/metricsImporter/cli';
import * as alertsCli from '../lib/alerts/cli';
import {WorkflowsCli} from '../lib/workflows/cli';
import {errx} from '../lib/cli/errors';
import {
  setEndpoint,
  loadConfig,
  coronerClientArgv,
  abortIfNotLoggedIn,
} from '../lib/cli/context';
import {usage} from '../lib/cli/util';
import {configDir} from '../lib/cli/constants';
import {initPrint} from '../lib/cli/print';
import {eHasCode} from '../lib/util';

// Import command modules
import {commands as errorCommands} from '../lib/commands/error';
import {commands as projectCommands} from '../lib/commands/project';
import {commands as mergeCommands} from '../lib/commands/merge';
import {commands as repairCommands} from '../lib/commands/repair';
import {commands as actionsCommands} from '../lib/commands/actions';
import {commands as serviceStatusCommands} from '../lib/commands/service-status';
import {commands as samplingCommands} from '../lib/commands/sampling';
import {commands as bpgCommands} from '../lib/commands/bpg';
import {commands as tenantCommands} from '../lib/commands/tenant';
import {commands as auditLogCommands} from '../lib/commands/audit-log';
import {commands as tokenSessionCommands} from '../lib/commands/token-session';
import {commands as userCommands} from '../lib/commands/user';
import {commands as accessCommands} from '../lib/commands/access';
import {commands as attributeCommands} from '../lib/commands/attribute';
import {commands as scrubberCommands} from '../lib/commands/scrubber';
import {commands as symbolCommands} from '../lib/commands/symbol';
import {commands as reportCommands} from '../lib/commands/report';
import {commands as retentionCommands} from '../lib/commands/retention';
import {commands as authCommands} from '../lib/commands/auth';
import {commands as callstackCommands} from '../lib/commands/callstack';
import {commands as similarityCommands} from '../lib/commands/similarity';
import {commands as getPutCommands} from '../lib/commands/get-put';
import {commands as queryOpsCommands} from '../lib/commands/query-ops';
import {commands as listCommands} from '../lib/commands/list';

// Backtrace error reporting
const backtraceDatabaseDirectory = path.join(configDir, 'backtrace');
const client = bt.BacktraceClient.initialize({
  url: 'https://submit.backtrace.io/backtrace/2cfca2efffd862c7ad7188be8db09d8697bd098a3561cd80a56fe5c4819f5d14/json',
  timeout: 1500,
  userAttributes: {
    version: packageJson.version,
  },
  database: {
    enable: true,
    path: backtraceDatabaseDirectory,
    autoSend: false,
    captureNativeCrashes: true,
    createDatabaseDirectory: true,
  },
  metrics: {
    enable: false,
  },
});

// Initialize print module with BacktraceClient for error reporting
initPrint({btClient: client});

// Thin wrappers for modules that use a class-based CLI pattern
function symboldCmd(argv: any, config: any): any {
  const coroner = coronerClientArgv(config, argv);
  const sc = new symbold.SymboldClient(coroner);
  argv._.shift();
  sc.routeMethod(argv);
}

async function metricsImporterCmd(argv: any, config: any): Promise<any> {
  abortIfNotLoggedIn(config);
  const coroner = coronerClientArgv(config, argv);
  const cli = await metricsImporterCli.metricsImporterCliFromCoroner(coroner);
  argv._.shift();
  await cli.routeMethod(argv);
}

async function alertsCmd(argv: any, config: any): Promise<any> {
  abortIfNotLoggedIn(config);
  const coroner = coronerClientArgv(config, argv);
  const cli = await alertsCli.alertsCliFromCoroner(coroner, argv, config);
  argv._.shift();
  await cli.routeMethod(argv);
}

async function workflowsCmd(argv: any, config: any): Promise<any> {
  abortIfNotLoggedIn(config);
  const coroner = coronerClientArgv(config, argv);
  const cli = await WorkflowsCli.fromCoroner(coroner, argv, config);
  argv._.shift();
  await cli.routeMethod(argv);
}

// Assemble the command map
const commands: Record<string, (argv: any, config: any) => any> = {
  ...errorCommands,
  ...projectCommands,
  ...mergeCommands,
  ...repairCommands,
  ...actionsCommands,
  ...serviceStatusCommands,
  ...samplingCommands,
  ...bpgCommands,
  ...tenantCommands,
  ...auditLogCommands,
  ...tokenSessionCommands,
  ...userCommands,
  ...accessCommands,
  ...attributeCommands,
  ...scrubberCommands,
  ...symbolCommands,
  ...reportCommands,
  ...retentionCommands,
  ...authCommands,
  ...callstackCommands,
  ...similarityCommands,
  ...getPutCommands,
  ...queryOpsCommands,
  ...listCommands,

  // Aliases
  ls: listCommands.list,

  // Class-based CLI modules
  symbold: symboldCmd,
  'metrics-importer': metricsImporterCmd,
  alerts: alertsCmd,
  workflows: workflowsCmd,
};

process.stdout.on('error', () => {
  process.exit(0);
});
process.stderr.on('error', () => {
  process.exit(0);
});
main();

function main(): any {
  const argv = minimist(process.argv.slice(2), {
    boolean: ['k', 'debug', 'v', 'version'],
    /* Don't convert arguments that are often hex strings. */
    string: ['first', 'last', 'fingerprint', 'attachment-id', '_'],
  });

  if (argv.v || argv.version) {
    console.log(packageJson.version);
    process.exit(1);
  }

  if (argv.endpoint) {
    setEndpoint(argv.endpoint, argv.token);
  } else if (argv.token) {
    setEndpoint(undefined, argv.token);
  }

  const commandName = argv._[0];
  const command = commands[commandName];
  if (!command) return usage();

  // send reports from the previous session
  const abortController = new AbortController();
  client.database.send(abortController.signal);
  promptLib.message = '';
  promptLib.delimiter = ':';
  promptLib.colors = false;
  promptLib.start();

  loadConfig((err, config) => {
    if (err && !eHasCode(err, 'ENOENT')) {
      errx('Unable to read configuration: ' + err.message + '.');
    }

    (async function executeCommand() {
      try {
        await command(argv, config);
      } catch (e) {
        await client.send(e as Error);
        abortController.abort();
        client.dispose();
        setTimeout(() => {
          throw e;
        }, 0);
      }
    })();
  });
}

//-- vim:ts=2:et:sw=2
