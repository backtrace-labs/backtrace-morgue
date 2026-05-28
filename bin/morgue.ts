#!/usr/bin/env node

'use strict';

// setup abort controller
import '../lib/abortController';

import * as path from 'path';
import * as bt from '@backtrace/node';
import * as packageJson from '../package.json';
import promptLib from 'prompt';
import {errx} from '../lib/cli/errors';
import {setEndpoint, loadConfig} from '../lib/cli/context';
import {configDir} from '../lib/cli/constants';
import {initPrint} from '../lib/cli/print';
import {eHasCode} from '../lib/util';
import {createProgram} from '../lib/cli/generated/parser';
import {installCompletion} from '../lib/cli/completion';
import type {CliCommand, CommandHandler, CommandHandlerMap} from '../lib/cli/generated/types';

// Import all command handlers
import {handlers as errorHandlers} from '../lib/commands/error';
import {handlers as tenantHandlers} from '../lib/commands/tenant';
import {handlers as projectHandlers} from '../lib/commands/project';
import {handlers as mergeHandlers} from '../lib/commands/merge';
import {handlers as repairHandlers} from '../lib/commands/repair';
import {handlers as bpgHandlers} from '../lib/commands/bpg';
import {handlers as serviceStatusHandlers} from '../lib/commands/service-status';
import {handlers as actionsHandlers} from '../lib/commands/actions';
import {handlers as scrubberHandlers} from '../lib/commands/scrubber';
import {handlers as symbolHandlers} from '../lib/commands/symbol';
import {handlers as reportHandlers} from '../lib/commands/report';
import {handlers as auditLogHandlers} from '../lib/commands/audit-log';
import {handlers as tokenSessionHandlers} from '../lib/commands/token-session';
import {handlers as userHandlers} from '../lib/commands/user';
import {handlers as retentionHandlers} from '../lib/commands/retention';
import {handlers as getPutHandlers} from '../lib/commands/get-put';
import {handlers as queryOpsHandlers} from '../lib/commands/query-ops';
import {handlers as listHandlers} from '../lib/commands/list';
import {handlers as samplingHandlers} from '../lib/commands/sampling';
import {handlers as accessHandlers} from '../lib/commands/access';
import {handlers as attributeHandlers} from '../lib/commands/attribute';
import {handlers as authHandlers} from '../lib/commands/auth';
import {handlers as callstackHandlers} from '../lib/commands/callstack';
import {handlers as similarityHandlers} from '../lib/commands/similarity';
import {handlers as symboldHandlers} from '../lib/commands/symbold-handlers';
import {handlers as metricsImporterHandlers} from '../lib/commands/metrics-importer-handlers';
import {handlers as alertsHandlers} from '../lib/commands/alerts-handlers';
import {handlers as workflowsHandlers} from '../lib/commands/workflows-handlers';

// Provide package info explicitly so @backtrace/node doesn't fail when
// installed globally (where its package.json walk-up can't find ours).
if (!process.env.npm_package_name) {
  process.env.npm_package_name = packageJson.name;
}
if (!process.env.npm_package_version) {
  process.env.npm_package_version = packageJson.version;
}

// A shell-completion invocation (`morgue complete ...`, issued by the generated
// completion script) takes a minimal, side-effect-free path: no Backtrace error
// reporting client, no telemetry, no config load — just the parser plus tab's
// completion handling. This keeps tab completion fast and quiet.
const isCompletion = process.argv.slice(2).includes('complete');

const backtraceDatabaseDirectory = path.join(configDir, 'backtrace');
const client = isCompletion
  ? undefined
  : bt.BacktraceClient.initialize({
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

if (client) {
  initPrint({btClient: client});
}

// ---------------------------------------------------------------------------
// Command handler registry — all commands dispatched by kind
// ---------------------------------------------------------------------------

// satisfies ensures all 153 command kinds have a handler and none are misspelled.
// The cast to CommandHandlerMap gives us a proper indexed type for runtime lookup.
const handlers: CommandHandlerMap = {
  ...errorHandlers,
  ...tenantHandlers,
  ...projectHandlers,
  ...mergeHandlers,
  ...repairHandlers,
  ...bpgHandlers,
  ...serviceStatusHandlers,
  ...actionsHandlers,
  ...scrubberHandlers,
  ...symbolHandlers,
  ...reportHandlers,
  ...auditLogHandlers,
  ...tokenSessionHandlers,
  ...userHandlers,
  ...retentionHandlers,
  ...getPutHandlers,
  ...queryOpsHandlers,
  ...listHandlers,
  ...samplingHandlers,
  ...accessHandlers,
  ...attributeHandlers,
  ...authHandlers,
  ...callstackHandlers,
  ...similarityHandlers,
  ...symboldHandlers,
  ...metricsImporterHandlers,
  ...alertsHandlers,
  ...workflowsHandlers,
} satisfies CommandHandlerMap;

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

process.stdout.on('error', () => {
  process.exit(0);
});
process.stderr.on('error', () => {
  process.exit(0);
});
main();

function main(): any {
  const {program, getResult} = createProgram();
  program.version(packageJson.version, '-v, --version');

  // Completion fast path: wire up tab and let it handle `complete [shell]`
  // (script generation) and `complete -- <words>` (candidate emission). None of
  // the regular command-dispatch machinery below runs.
  if (isCompletion) {
    installCompletion(program)
      .then(() => program.parse())
      .catch(() => process.exit(1));
    return;
  }

  program.exitOverride();
  let cmd: CliCommand | undefined;
  try {
    program.parse();
    cmd = getResult();
  } catch (e: any) {
    // Commander exits for --version and --help — let those through
    if (e?.exitCode !== undefined) {
      process.exit(e.exitCode);
    }
    // Commander couldn't parse — show help
    program.outputHelp();
    process.exit(1);
  }

  if (!cmd) {
    program.outputHelp();
    process.exit(1);
  }

  // Set global endpoint/token from parsed command
  if (cmd.globalOptions.endpoint) {
    setEndpoint(cmd.globalOptions.endpoint, cmd.globalOptions.token);
  } else if (cmd.globalOptions.token) {
    setEndpoint(undefined, cmd.globalOptions.token);
  }

  // Setup
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
        // Direct indexing of CommandHandlerMap with a union key produces a `never`
        // parameter (TypeScript intersects all handler signatures). The cast is
        // safe because satisfies already proved every kind has a matching handler.
        await (handlers[cmd.kind] as CommandHandler)(cmd, config);
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
