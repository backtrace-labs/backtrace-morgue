/*
 * Shared context: client construction, config loading/saving, auth checks.
 */

import * as fs from 'fs';
import * as url from 'url';
import mkdirp from 'mkdirp';
import {CoronerClient} from '../coroner';
import * as BPG from '../bpg';
import * as config from '../config';
import {eMsg} from '../util';
import {errx} from './errors';
import {configDir, configFile} from './constants';

/*
 * Module-level state for --endpoint / --token overrides.
 * Set once from main() via setEndpoint() before any command runs.
 */
let _endpoint: string | undefined;
let _endpointToken: string | undefined;

export function setEndpoint(ep: string, token?: string): void {
  _endpoint = ep;
  _endpointToken = token;
}

export function getEndpoint(): string | undefined {
  return _endpoint;
}

export function abortIfNotLoggedIn(cfg?: config.Config): void {
  if (cfg?.config?.token) return;

  /* If an endpoint is specified, then synthesize a configuration structure. */
  if (_endpoint) {
    cfg.config = {} as any;

    /* We rely on host-based authentication if no token is specified. */
    cfg.config.token = _endpointToken ?? '00000';

    cfg.endpoint = _endpoint;
    return;
  }

  errx('Must login first.');
}

export function coronerClient(
  cfg: any,
  insecure: boolean,
  debug: boolean,
  endpoint: string,
  timeout?: number,
): CoronerClient {
  return new CoronerClient({
    insecure: insecure,
    debug: debug,
    endpoint: endpoint,
    timeout: timeout,
    config: cfg.config,
  });
}

function makeConfigDir(callback: any): void {
  mkdirp(configDir, {mode: '0700'}, callback);
}

export function saveConfig(
  coroner: any,
  callback: (err?: any) => void,
): void {
  makeConfigDir(err => {
    if (err) return callback(err);

    const c: any = {
      config: coroner.config,
      endpoint: coroner.endpoint,
    };

    if (Array.isArray(coroner.config.endpoints.post)) {
      const ep = coroner.config.endpoints.post;
      const fu = url.parse(coroner.endpoint);
      const i = Math.max(
        0,
        ep.findIndex(ep => ep.protocol === 'https'),
      );

      c.submissionEndpoint =
        ep[i].protocol + '://' + fu.hostname + ':' + ep[i].port + '/post';
    }

    const text = JSON.stringify(c, null, 2);
    fs.writeFile(configFile, text, callback);
  });
}

export function loadConfig(
  callback: (error: Error | null, result?: config.ConfigFile) => void,
): void {
  makeConfigDir(err => {
    if (err) return callback(err);
    fs.readFile(configFile, {encoding: 'utf8'}, (err, text) => {
      let json;

      if (text && text.length > 0) {
        try {
          json = JSON.parse(text);
        } catch (err) {
          return callback(new Error(eMsg(err)));
        }
      } else {
        json = {};
      }
      callback(null, json);
    });
  });
}

export function tenantURL(cfg: config.Config, tn: any): string {
  if (!cfg.config.universe) return cfg.endpoint;

  requireConfigFile(cfg);

  const uname = cfg.config.universe.name;
  let pattern = uname;
  let replacement = tn;

  const tsep = cfg.config.tenant_separator;
  if (tsep) {
    pattern += tsep;
    replacement += tsep;
  }

  return cfg.endpoint.replace(pattern, replacement);
}

export function projectIdFromFlags(
  cfg: config.Config,
  model: any,
  flags: {universe?: string; project?: string},
): number {
  let universe = flags.universe;
  if (!universe) {
    universe = getDefaultUniverse(cfg);
  }

  if (!universe) {
    errx('--universe is required');
  }

  const project = flags.project;
  if (!project) {
    errx('--project is required');
  }

  /* Find universe. */
  let uid = 0;
  for (const u of model.universe) {
    if (u.get('name') === universe) {
      uid = u.get('id');
    }
  }

  if (uid == 0) {
    errx('Universe not found');
  }

  let pid = 0;
  for (const p of model.project) {
    if (p.get('universe') === uid && p.get('name') == project) {
      pid = p.get('pid');
      break;
    }
  }

  if (pid === 0) {
    errx('Project not found');
  }

  return pid;
}

// ---------------------------------------------------------------------------
// Typed helpers (accept GlobalOptions instead of argv)
// ---------------------------------------------------------------------------

import type {GlobalOptions} from './generated/types';
import {isConfigFile} from '../config';
export {isConfigFile};

/**
 * Get the first universe name from config, or the provided override.
 * Returns undefined if no universe is available.
 */
export function getDefaultUniverse(cfg: config.Config, override?: string): string | undefined {
  if (override) return override;
  if (isConfigFile(cfg)) {
    for (const name in cfg.config.universes) return name;
  }
  return undefined;
}

/**
 * Assert config is a full ConfigFile (not synthetic).
 * Use this before accessing config.config.universes, .user, .uid, etc.
 */
export function requireConfigFile(cfg: config.Config): asserts cfg is config.ConfigFile {
  if (!isConfigFile(cfg)) {
    errx('This command requires a full login (not --endpoint mode).');
  }
}

/**
 * Create a CoronerClient from typed GlobalOptions.
 * Replaces coronerClientArgv for migrated commands.
 */
export function coronerClientFromGlobal(
  cfg: config.Config,
  opts: GlobalOptions,
): any {
  if (opts.token && opts.endpoint) {
    cfg.config.token = opts.token;
    cfg.endpoint = opts.endpoint;
  }
  return coronerClient(
    cfg,
    !!opts.k,
    !!opts.debug,
    cfg.endpoint,
    opts.timeout ? parseInt(opts.timeout) : undefined,
  );
}

/**
 * Create a submission-endpoint CoronerClient from typed GlobalOptions.
 */
export function coronerClientSubmitFromGlobal(
  cfg: config.Config,
  opts: GlobalOptions,
): any {
  return coronerClient(
    cfg,
    !!opts.k,
    !!opts.debug,
    cfg.submissionEndpoint,
    opts.timeout ? parseInt(opts.timeout) : undefined,
  );
}

/**
 * Create a BPG client from typed GlobalOptions.
 * Replaces coronerBpgSetup for migrated commands.
 */
export function coronerBpgFromGlobal(coroner: any, opts: GlobalOptions): any {
  const coronerd = {
    url: coroner.endpoint,
    session: {token: '000000000'},
  };
  const bpgOpts: any = {};

  if (coroner.config && coroner.config.token)
    coronerd.session.token = coroner.config.token;

  if (opts.debug) bpgOpts.debug = true;

  return new BPG.BPG(coronerd, bpgOpts);
}

/**
 * Parse a "universe/project" or "project" positional arg into components.
 * Replaces coronerParams for migrated commands.
 */
export function parseProjectArg(
  project: string,
  cfg: any,
): {universe: string; project: string} {
  const split = project.split('/');
  if (split.length === 2) {
    return {universe: split[0], project: split[1]};
  }
  let first;
  for (first in cfg.config.universes) break;
  return {universe: first, project};
}
