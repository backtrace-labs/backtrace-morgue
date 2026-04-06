import * as config from '../config';
import {errx, chalk, success_color} from '../cli/errors';
import {abortIfNotLoggedIn, coronerClientArgv, coronerClient, coronerBpgSetup} from '../cli/context';

const bold = chalk.bold;
const yellow = chalk.yellow;
const blue = chalk.blue;

function coronerToken(argv: any, config: any): any {
  const options = null;
  let project, universe, pid, un, target;

  abortIfNotLoggedIn(config);
  const coroner = coronerClientArgv(config, argv);

  universe = argv.universe;
  if (!universe) universe = Object.keys(config.config.universes)[0];

  project = argv.project;

  /* The sub-command. */
  const action = argv._[1];

  const bpg = coronerBpgSetup(coroner, argv);
  const model = bpg.get();

  /* Find the universe with the specified name. */
  for (var i = 0; i < model.universe.length; i++) {
    if (model.universe[i].get('name') === universe) {
      un = target = model.universe[i];
    }
  }

  const pm: any = {};

  for (var i = 0; i < model.project.length; i++) {
    pm[model.project[i].get('pid')] = model.project[i].get('name');

    if (
      model.project[i].get('name') === project &&
      model.project[i].get('universe') === un.get('id')
    ) {
      pid = model.project[i].get('pid');
    }
  }

  if (action == 'list') {
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

    return;
  }

  if (action === 'delete') {
    const id = argv._[2];
    var token;

    if (!id) errx('Usage: morgue token delete <id>');

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
    return;
  }

  if (action === 'create') {
    let capabilities = '';

    if (!universe || !project)
      errx('Must specify a project or infer a universe');

    if (!pid) errx('Invalid project');

    if (!argv.capability) {
      errx(
        'Must specify a capability:\n' +
          '    error:post symbol:post query:post',
      );
    }

    if (Array.isArray(argv.capability)) {
      capabilities = argv.capability.join(' ');
    } else {
      if (capabilities && capabilities.length > 0) capabilities += ' ';

      capabilities += argv.capability;
    }

    if (!capabilities || capabilities.length === 0)
      errx('Must specify a capability: error:post sym:post query:post');

    const api_token = bpg.new('api_token');
    api_token.set('id', '0000');
    api_token.set('project', pid);
    api_token.set('owner', config.config.uid);
    api_token.set('capabilities', capabilities);

    if (argv.metadata) api_token.set('metadata', argv.metadata);

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
}

function coronerSession(argv: any, config: any): any {
  const options = null;
  let universe;

  if (!argv.endpoint && !argv.universe) abortIfNotLoggedIn(config);

  let coroner;

  if (argv.endpoint) {
    config.config = coroner;
    config.endpoint = argv.endpoint;
    coroner = coronerClient(
      config,
      true,
      !!argv.debug,
      argv._[1],
      argv.timeout,
    );
  } else {
    coroner = coronerClientArgv(config, argv);
  }

  const usageText =
    'Usage: morgue session <list | set | unset>\n' +
    '\n' +
    '   list : List active sessions.\n';
  ('    set : Set resource override values.\n');
  ('  unset : Unset resource override values.\n');

  if (argv.h || argv.help) {
    console.log(usageText);
    return;
  }

  universe = argv.universe;
  if (!universe) {
    if (argv.endpoint) errx('--universe= must be specified');

    universe = Object.keys(config.config.universes)[0];
  }

  /* The sub-command. */
  const action = argv._[1];
  const qs: any = {token: argv.token || coroner.config.token};

  if (action === 'list') {
    if (argv.g) qs.scope = 'global';
    if (argv.u) qs.scope = 'user';
    if (argv.s) qs.scope = 'session';

    if (argv.scope) {
      if (argv.scope === 'global') {
        qs.scope = 'global';
      } else if (argv.scope === 'user') {
        qs.scope = 'user';
      } else if (argv.scope === 'session') {
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

    return;
  } else if (action === 'set') {
    var resources;

    try {
      resources = JSON.parse(argv._[2]);
    } catch (error) {
      errx('resources must be a valid JSON object: ' + error);
    }

    if (argv.persist) {
      let universe_id, owner;
      const bpg = coronerBpgSetup(coroner, argv);

      process.stderr.write(blue('Persisting...'));

      universe_id = config.config.universe.id;
      owner = config.config.user.uid;

      const model = bpg.get();

      for (const key in resources) {
        const ro = bpg.new('resource_override');
        var previous;

        if (argv.persist === 'universe') {
          ro.set('uid', 0);
        } else {
          ro.set('uid', owner);
          if (argv.uid) ro.set('uid', argv.uid);
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
  } else if (action === 'unset') {
    var resources = argv._.slice(2, argv._.length);

    coroner.post(
      '/api/session',
      qs,
      {
        action: 'unset',
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
  } else {
    errx('unknown sub-command, expecting set, unset or list');
  }
}

export const commands: Record<string, (argv: any, config: any) => any> = {
  token: coronerToken,
  session: coronerSession,
};
