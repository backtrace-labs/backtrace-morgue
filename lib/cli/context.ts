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

/**
 * Returns the universe/project pair to use for coroner commands.
 */
export function coronerParams(argv: any, cfg: any): any {
  const p: any = {};

  if (Array.isArray(argv._) === true && argv._.length > 1) {
    let split;

    split = argv._[1].split('/');
    if (split.length === 1) {
      let first;

      /* Try to automatically derive a path from the one argument. */
      for (first in cfg.config.universes) break;
      p.universe = first;
      p.project = argv._[1];
    } else {
      p.universe = split[0];
      p.project = split[1];
    }
  }
  if (argv.token) {
    p.token = argv.token;
  } else if (argv['api-token']) {
    /* argv.token is used for other things as well. */
    p.token = argv['api-token'];
  }

  return p;
}

export function coronerClient(
  cfg: any,
  insecure: boolean,
  debug: boolean,
  endpoint: string,
  timeout?: number,
): any {
  return new CoronerClient({
    insecure: insecure,
    debug: debug,
    endpoint: endpoint,
    timeout: timeout,
    config: cfg.config,
  });
}

export function coronerClientArgv(cfg: config.Config, argv: any): any {
  if (argv.token && argv.endpoint) {
    cfg.config.token = argv.token;
    cfg.endpoint = argv.endpoint;
  }
  return coronerClient(
    cfg,
    !!argv.k,
    !!argv.debug,
    cfg.endpoint,
    argv.timeout,
  );
}

export function coronerClientArgvSubmit(cfg: config.Config, argv: any): any {
  return coronerClient(
    cfg,
    !!argv.k,
    argv.debug,
    cfg.submissionEndpoint,
    argv.timeout,
  );
}

export function coronerBpgSetup(coroner: any, argv: any): any {
  const coronerd = {
    url: coroner.endpoint,
    session: {token: '000000000'},
  };
  const opts: any = {};

  if (coroner.config && coroner.config.token)
    coronerd.session.token = coroner.config.token;

  if (argv.debug) opts.debug = true;

  return new BPG.BPG(coronerd, opts);
}

function makeConfigDir(callback: any): any {
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
): any {
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

export function tenantURL(cfg: any, tn: any): string {
  if (!cfg.config.universe) return cfg.endpoint;

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

export function projectIdFromFlags(cfg: any, model: any, argv: any): number {
  let universe = argv.universe;
  if (!universe) {
    universe = Object.keys(cfg.config.universes)[0];
  }

  if (!universe) {
    errx('--universe is required');
  }

  const project = argv.project;
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
 * Replaces coronerClientArgvSubmit for migrated commands.
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
