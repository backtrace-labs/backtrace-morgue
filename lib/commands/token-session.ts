import type {Config} from '../config';
import type {
  TokenCreateCommand,
  TokenListCommand,
  TokenDeleteCommand,
  SessionListCommand,
  SessionSetCommand,
  SessionUnsetCommand,
  CommandHandler,
} from '../cli/generated/types';
import {errx, chalk, success_color} from '../cli/errors';
import {
  abortIfNotLoggedIn,
  coronerClientFromGlobal,
  coronerBpgFromGlobal,
  coronerClient,
  getDefaultUniverse,
  requireConfigFile,
} from '../cli/context';

const bold = chalk.bold;
const yellow = chalk.yellow;
const blue = chalk.blue;

function tokenList(cmd: TokenListCommand, config: Config): any {
  abortIfNotLoggedIn(config);
  const coroner = coronerClientFromGlobal(config, cmd.globalOptions);

  const universe = getDefaultUniverse(config, cmd.globalOptions.universe);

  const project = cmd.project;

  const bpg = coronerBpgFromGlobal(coroner, cmd.globalOptions);
  const model = bpg.get();

  /* Find the universe with the specified name. */
  let un;
  for (var i = 0; i < model.universe.length; i++) {
    if (model.universe[i].get('name') === universe) {
      un = model.universe[i];
    }
  }

  const pm: any = {};
  let pid;

  for (var i = 0; i < model.project.length; i++) {
    pm[model.project[i].get('pid')] = model.project[i].get('name');

    if (
      model.project[i].get('name') === project &&
      un &&
      model.project[i].get('universe') === un.get('id')
    ) {
      pid = model.project[i].get('pid');
    }
  }

  const apiTokens = model.api_token ? model.api_token.length : 0;
  const tokens = model.token ? model.token.length : 0;
  const totalTokens = apiTokens + tokens;

  if (totalTokens <= 0) {
    console.log(success_color('No API tokens found.'));
    return;
  }

  if (model.api_token) {
    model.api_token.sort((a, b) => {
      const a_d = Number(a.get('id'));
      const b_d = Number(b.get('id'));

      return +(a_d > b_d) - +(a_d < b_d);
    });

    for (var i = 0; i < model.api_token.length; i++) {
      var token = model.api_token[i];

      if (pid && token.get('project') != pid) continue;

      console.log(bold(token.get('id')));
      console.log(
        '  capabilities=' +
          token.get('capabilities') +
          ',project=' +
          pm[token.get('project')] +
          '(' +
          token.get('project') +
          '),owner=' +
          token.get('owner'),
      );

      const metadata = token.get('metadata');
      if (metadata) {
        console.log('  metadata:');
        const jm = JSON.stringify(JSON.parse(metadata), null, 2);
        console.log(jm);
      }
    }
  }

  if (model.token) {
    for (var i = 0; i < model.token.length; i++) {
      var token = model.token[i];

      if (pid && token.get('project') != pid) continue;

      console.log(bold(token.get('id')));
      console.log(
        '  capabilities=error:post' +
          ',project=' +
          pm[token.get('project')] +
          '(' +
          token.get('project') +
          '),owner=' +
          token.get('owner'),
      );
    }
  }
}

function tokenDelete(cmd: TokenDeleteCommand, config: Config): any {
  abortIfNotLoggedIn(config);
  const coroner = coronerClientFromGlobal(config, cmd.globalOptions);
  const bpg = coronerBpgFromGlobal(coroner, cmd.globalOptions);
  const model = bpg.get();

  const id = cmd.token;
  if (!id) errx('Usage: morgue token delete <id>');

  var token;
  for (var i = 0; i < model.api_token.length; i++) {
    if (model.api_token[i].get('id').indexOf(id) >= 0) {
      if (token) errx(id + ' is an ambiguous identifier. Multiple matches.');

      token = model.api_token[i];
    }
  }

  if (!token) errx('Token not found.');

  console.log('Deleting token [' + yellow(token.get('id') + ']...'));
  bpg.delete(token);
  bpg.commit();
}

function tokenCreate(cmd: TokenCreateCommand, config: Config): any {
  abortIfNotLoggedIn(config);
  const coroner = coronerClientFromGlobal(config, cmd.globalOptions);

  const universe = getDefaultUniverse(config, cmd.globalOptions.universe);

  const project = cmd.project;

  const bpg = coronerBpgFromGlobal(coroner, cmd.globalOptions);
  const model = bpg.get();

  /* Find the universe with the specified name. */
  let un;
  for (var i = 0; i < model.universe.length; i++) {
    if (model.universe[i].get('name') === universe) {
      un = model.universe[i];
    }
  }

  const pm: any = {};
  let pid;

  for (var i = 0; i < model.project.length; i++) {
    pm[model.project[i].get('pid')] = model.project[i].get('name');

    if (
      model.project[i].get('name') === project &&
      un &&
      model.project[i].get('universe') === un.get('id')
    ) {
      pid = model.project[i].get('pid');
    }
  }

  if (!universe || !project)
    errx('Must specify a project or infer a universe');

  if (!pid) errx('Invalid project');

  const capabilities = cmd.capability;

  if (!capabilities || capabilities.length === 0)
    errx('Must specify a capability: error:post sym:post query:post');

  requireConfigFile(config);
  const api_token = bpg.new('api_token');
  api_token.set('id', '0000');
  api_token.set('project', pid);
  api_token.set('owner', config.config.uid);
  api_token.set('capabilities', capabilities);

  if (cmd.metadata) api_token.set('metadata', cmd.metadata);

  bpg.create(api_token);

  try {
    const response = bpg.commitWithResponse();

    // find the index of actions where action == create and type == 'configuration/api_token' so we can access the correct result
    const index = response.actions.findIndex(
      action =>
        action.action === 'create' &&
        action.type === 'configuration/api_token',
    );

    if (index < 0) errx('Cannot find token.');

    const token = response.results[index].result;
    console.log(success_color('API token successfully created:'));
    console.log(bold(token.id));
    console.log(
      '  capabilities=' +
        token.capabilities +
        ',project=' +
        pm[token.project] +
        ',owner=' +
        token.owner,
    );
  } catch (e) {
    errx(e + '');
  }
}

function sessionList(cmd: SessionListCommand, config: Config): any {
  if (!cmd.globalOptions.endpoint && !cmd.globalOptions.universe)
    abortIfNotLoggedIn(config);

  let coroner;

  if (cmd.globalOptions.endpoint) {
    config.config = coroner;
    config.endpoint = cmd.globalOptions.endpoint;
    coroner = coronerClient(
      config,
      true,
      !!cmd.globalOptions.debug,
      cmd.globalOptions.endpoint,
      cmd.globalOptions.timeout ? Number(cmd.globalOptions.timeout) : undefined,
    );
  } else {
    coroner = coronerClientFromGlobal(config, cmd.globalOptions);
  }

  let universe = cmd.globalOptions.universe;
  if (!universe) {
    if (cmd.globalOptions.endpoint) errx('--universe= must be specified');

    universe = getDefaultUniverse(config);
  }

  const qs: any = {token: cmd.globalOptions.token || coroner.config.token};

  if (cmd.g) qs.scope = 'global';
  if (cmd.u) qs.scope = 'user';
  if (cmd.s) qs.scope = 'session';

  if (cmd.scope) {
    if (cmd.scope === 'global') {
      qs.scope = 'global';
    } else if (cmd.scope === 'user') {
      qs.scope = 'user';
    } else if (cmd.scope === 'session') {
      qs.scope = 'session';
    } else {
      errx('scope must be one of global, user or session');
    }
  }

  coroner.http_get('/api/session', qs, null, (error, result) => {
    if (error) errx(error + '');

    const rp = JSON.parse(result.bodyData);

    console.log(JSON.stringify(rp, null, 2));
  });
}

function sessionSet(cmd: SessionSetCommand, config: Config): any {
  if (!cmd.globalOptions.endpoint && !cmd.globalOptions.universe)
    abortIfNotLoggedIn(config);

  let coroner;

  if (cmd.globalOptions.endpoint) {
    config.config = coroner;
    config.endpoint = cmd.globalOptions.endpoint;
    coroner = coronerClient(
      config,
      true,
      !!cmd.globalOptions.debug,
      cmd.globalOptions.endpoint,
      cmd.globalOptions.timeout ? Number(cmd.globalOptions.timeout) : undefined,
    );
  } else {
    coroner = coronerClientFromGlobal(config, cmd.globalOptions);
  }

  let universe = cmd.globalOptions.universe;
  if (!universe) {
    if (cmd.globalOptions.endpoint) errx('--universe= must be specified');

    universe = getDefaultUniverse(config);
  }

  const qs: any = {token: cmd.globalOptions.token || coroner.config.token};

  var resources;

  try {
    resources = JSON.parse(cmd.resources_json);
  } catch (error) {
    errx('resources must be a valid JSON object: ' + error);
  }

  if (cmd.persist) {
    let universe_id, owner;
    const bpg = coronerBpgFromGlobal(coroner, cmd.globalOptions);

    process.stderr.write(blue('Persisting...'));

    requireConfigFile(config);
    universe_id = config.config.universe.id;
    owner = config.config.user.uid;

    const model = bpg.get();

    for (const key in resources) {
      const ro = bpg.new('resource_override');
      var previous;

      if (cmd.persist === 'universe') {
        ro.set('uid', 0);
      } else {
        ro.set('uid', owner);
        if (cmd.uid) ro.set('uid', cmd.uid);
      }

      ro.set('universe', universe_id);
      ro.set('name', key);
      ro.set('value', JSON.stringify(resources[key]));
      ro.set('owner', owner);

      /*
       * Check for the presence of a duplicate, if so, modification
       * is performed.
       */
      if (model.resource_override) {
        for (var i = 0; i < model.resource_override.length; i++) {
          if (
            model.resource_override[i].get('universe') === universe_id &&
            model.resource_override[i].get('uid') == ro.get('uid')
          ) {
            previous = model.resource_override[i];
            break;
          }
        }
      }

      if (previous) {
        bpg.modify(model.resource_override[i], {
          value: JSON.stringify(resources[key]),
        });
      } else {
        bpg.create(ro);
      }

      try {
        bpg.commit();
      } catch (error) {
        errx(error + '');
      }

      process.stderr.write(success_color('done\n'));
    }

    return;
  }

  coroner.post(
    '/api/session',
    qs,
    {
      action: 'set',
      form: {
        resources: resources,
      },
    },
    null,
    (e, r) => {
      if (e) errx(e + '');

      if (r.status === 'ok') {
        console.log(JSON.stringify(r.form, null, 2));
        console.log(success_color('\nSuccess.'));
      } else {
        errx(r);
      }

      return;
    },
  );
}

function sessionUnset(cmd: SessionUnsetCommand, config: Config): any {
  if (!cmd.globalOptions.endpoint && !cmd.globalOptions.universe)
    abortIfNotLoggedIn(config);

  let coroner;

  if (cmd.globalOptions.endpoint) {
    config.config = coroner;
    config.endpoint = cmd.globalOptions.endpoint;
    coroner = coronerClient(
      config,
      true,
      !!cmd.globalOptions.debug,
      cmd.globalOptions.endpoint,
      cmd.globalOptions.timeout ? Number(cmd.globalOptions.timeout) : undefined,
    );
  } else {
    coroner = coronerClientFromGlobal(config, cmd.globalOptions);
  }

  let universe = cmd.globalOptions.universe;
  if (!universe) {
    if (cmd.globalOptions.endpoint) errx('--universe= must be specified');

    universe = getDefaultUniverse(config);
  }

  const qs: any = {token: cmd.globalOptions.token || coroner.config.token};

  coroner.post(
    '/api/session',
    qs,
    {
      action: 'unset',
      form: {
        resources: cmd.resource_names,
      },
    },
    null,
    (e, r) => {
      if (e) errx(e + '');

      if (r.status === 'ok') {
        console.log(JSON.stringify(r.form, null, 2));
        console.log(success_color('\nSuccess.'));
      } else {
        errx(r);
      }

      return;
    },
  );
}

export const handlers: Record<string, CommandHandler> = {
  'token.create': tokenCreate,
  'token.list': tokenList,
  'token.delete': tokenDelete,
  'session.list': sessionList,
  'session.set': sessionSet,
  'session.unset': sessionUnset,
};
