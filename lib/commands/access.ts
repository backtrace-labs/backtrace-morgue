import printf from 'printf';
import * as config from '../config';
import {errx, err, chalk, success_color} from '../cli/errors';
import {abortIfNotLoggedIn, coronerClientArgv, coronerBpgSetup} from '../cli/context';

const bold = chalk.bold;
const blue = chalk.blue;
const red = chalk.red;
const yellow = chalk.yellow;

function coronerAccessControlUsage() {
  console.error('Usage:');
  console.error('morgue access <action> [params...]');
  console.error('');
  console.error('actions:');
  console.error(' - team');
  console.error(' - project');
  console.error('');
  console.error('action team:');
  console.error('    morgue access team <create|remove|details> <team>');
  console.error('    morgue access team add-user <team> <user>');
  console.error('    morgue access team remove-user <team> <user>');
  console.error('    morgue access team list');
  console.error('');
  console.error('action project:');
  console.error('    morgue access project <project> add-team <team> <role>');
  console.error('    morgue access project <project> remove-team <team>');
  console.error('    morgue access project <project> add-user <user> <role>');
  console.error('    morgue access project <project> remove-user <user>');
  console.error('    morgue access project <project> details');
}

function coronerTeamCreate({bpg, argv, universeId, model}) {
  const teamName = argv._[3];

  const team = bpg.new('team');
  team.set('name', teamName);
  team.set('universe', universeId);
  team.set('id', 0);
  bpg.create(team);
  bpg.commit();
}

function coronerTeamDelete({bpg, argv, model}) {
  const teamName = argv._[3];

  const team = model.team.find(t => {
    return t.get('name') == teamName;
  });
  if (team === undefined) {
    err('Team not found');
    return;
  }
  bpg.delete(team);
  bpg.commit();
}

function coronerTeamList({argv, universeId, model}) {
  model.team
    .filter(t => t.get('universe') == universeId)
    .forEach(t => {
      console.log(t.get('name'));
    });
}

function coronerTeamUserAdd({bpg, argv, universeId, model}) {
  const teamName = argv._[3];
  const userName = argv._[4];

  const team = model.team.find(t => {
    return t.get('name') == teamName;
  });
  if (team === undefined) {
    err('Team not found');
    return;
  }

  const user = model.users.find(u => {
    return u.get('username') == userName;
  });
  if (user === undefined) {
    err('User not found');
    return;
  }

  const tm = bpg.new('team_member');
  tm.set('team', team.get('id'));
  tm.set('user', user.get('uid'));
  bpg.create(tm);
  bpg.commit();
}

function coronerTeamUserDelete({bpg, argv, universeId, model}) {
  const teamName = argv._[3];
  const userName = argv._[4];

  const team = model.team.find(t => {
    return t.get('name') == teamName;
  });
  if (team === undefined) {
    err('Team not found');
    return;
  }

  const user = model.users.find(u => {
    return u.get('username') == userName;
  });
  if (user === undefined) {
    err('User not found');
    return;
  }

  const tm = model.team_member.find(tm => {
    return (
      tm.get('user') == user.get('uid') && tm.get('team') == team.get('tid')
    );
  });
  if (tm === undefined) {
    err(`User '${userName}' is not a member of team '${teamName}'`);
    return;
  }

  bpg.delete(tm);
  bpg.commit();
}

function coronerTeamDetails({argv, model}) {
  const teamName = argv._[3];
  const team = model.team.find(t => {
    return t.get('name') == teamName;
  });
  if (team === undefined) {
    err('Team not found');
    return;
  }
  const teamId = team.get('id');

  const idToUser = (function () {
    const ret = {};
    const arr = model.users.map(u => [u.get('uid'), u.get('username')]);
    arr.forEach(a => (ret[a[0]] = a[1]));
    return ret;
  })();

  console.log(blue('Team members:'));
  model.team_member
    .filter(tm => tm.get('team') == teamId)
    .forEach(tm => {
      const name = idToUser[tm.get('user')] || '<unknown_name>';
      console.log(` - ${name}`);
    });

  console.log(blue('\nTeam is a member of projects:'));
  model.project_member_team
    .filter(pm => pm.get('team') == teamId)
    .forEach(pm => {
      const projectBpg = model.project.find(
        p => p.get('pid') == pm.get('project'),
      );
      if (projectBpg === undefined)
        errx(`Project with id ${pm.get('project')} not found`);
      console.log(` - ${projectBpg.get('name')} - ${pm.get('role')}`);
    });
}

function coronerProjectAddTeamUser({mode, bpg, argv, model, idSupply}) {
  const projectName = argv._[2];
  const suppliedName = argv._[4];
  const role = argv._[5];

  const project = model.project.find(p => p.get('name') == projectName);
  if (project === undefined) errx(red(`project not found: ${projectName}`));

  const id = idSupply[mode](suppliedName);

  if (role === undefined) errx(red('need to supply role'));
  if (role.match(/(guest|member|admin)/) == false) errx(red('unknown role'));

  const add = bpg.new(`project_member_${mode}`);
  add.set('project', project.get('pid'));
  add.set(mode, id);
  add.set('role', role);
  bpg.create(add);
  bpg.commit();
}

function coronerProjectRemoveTeamUser({mode, bpg, argv, model, idSupply}) {
  const projectName = argv._[2];
  const suppliedName = argv._[4];

  const id = idSupply[mode](suppliedName);

  const project = model.project.find(p => p.get('name') == projectName);
  if (project === undefined) errx(red(`project not found: ${projectName}`));

  const bpgObject = model[`project_member_${mode}`].find(
    pm => pm.get(mode) == id && pm.get('project') == project.get('pid'),
  );
  if (bpgObject === undefined)
    errx(`${mode} not found for project ${projectName}`);

  bpg.delete(bpgObject);
  bpg.commit();
}

function coronerProjectAccessDetails({argv, model}) {
  const projectName = argv._[2];
  const project = model.project.find(p => p.get('name') == projectName);
  if (project === undefined) errx(red(`project not found: ${projectName}`));

  const users = model.project_member_user.filter(
    pm => pm.get('project') == project.get('pid'),
  );
  const teams = model.project_member_team.filter(
    pm => pm.get('project') == project.get('pid'),
  );

  if (users.length == 0 && teams.length == 0) {
    console.log(`Project ${projectName} has no access control`);
    return;
  }

  console.log('Teams:');
  teams.forEach(pm => {
    const team = model.team.find(t => t.get('id') == pm.get('team'));
    if (team === undefined) errx(`Team ${pm.get('team')} not found`);
    console.log(`${team.get('name')} - ${pm.get('role')}`);
  });
  console.log('--\n');
  console.log('Users:');
  users.forEach(pm => {
    const user = model.users.find(u => u.get('uid') == pm.get('user'));
    if (user === undefined) errx(`User ${pm.get('user')} not found`);
    console.log(`${user.get('username')} - ${pm.get('role')}`);
  });
  console.log('--\n');
}

/**
 * @brief Implements the limit command.
 */
function coronerAccessControl(argv: any, config: any): any {
  const options = null;

  abortIfNotLoggedIn(config);
  const coroner = coronerClientArgv(config, argv);

  let universe = argv.universe;
  if (!universe) universe = Object.keys(config.config.universes)[0];

  const bpg = coronerBpgSetup(coroner, argv);
  const model = bpg.get();

  let universeId;
  /* Find the universe with the specified name. */
  for (let i = 0; i < model.universe.length; i++) {
    if (model.universe[i].get('name') === universe) {
      const un = model.universe[i];
      universeId = un.get('id');
    }
  }
  if (universeId === undefined) {
    errx(red('Universe not found'));
  }

  /* The sub-command. */
  const submodule = argv._[1];

  if (submodule == 'team') {
    const actionHandlers = {
      create: coronerTeamCreate,
      remove: coronerTeamDelete,
      list: coronerTeamList,
      details: coronerTeamDetails,
      'add-user': coronerTeamUserAdd,
      'remove-user': coronerTeamUserDelete,
    };
    const params = {
      bpg: bpg,
      argv: argv,
      universeId: universeId,
      model: model,
    };
    const action = argv._[2];

    const handler = actionHandlers[action];
    if (handler !== undefined) {
      handler(params);
    } else {
      coronerAccessControlUsage();
    }
  } else if (submodule == 'project') {
    // access project <project> action [user|team] [role]

    const idSupply = {
      team: suppliedName => {
        const t = model.team.find(t => t.get('name') == suppliedName);
        if (t === undefined) errx(red(`team not found: ${suppliedName}`));
        return t.get('id');
      },
      user: suppliedName => {
        const u = model.users.find(u => u.get('username') == suppliedName);
        if (u === undefined) errx(red(`user not found: ${suppliedName}`));
        return u.get('uid');
      },
    };

    const params = {
      bpg: bpg,
      argv: argv,
      model: model,
      idSupply: idSupply,
    };

    const actionHandlers = {
      'add-team': ps =>
        coronerProjectAddTeamUser(Object.assign({mode: 'team'}, ps)),
      'remove-team': ps =>
        coronerProjectRemoveTeamUser(Object.assign({mode: 'team'}, ps)),
      'add-user': ps =>
        coronerProjectAddTeamUser(Object.assign({mode: 'user'}, ps)),
      'remove-user': ps =>
        coronerProjectRemoveTeamUser(Object.assign({mode: 'user'}, ps)),
      details: coronerProjectAccessDetails,
    };

    const action = argv._[3];
    const handler = actionHandlers[action];
    if (handler !== undefined) {
      handler(params);
    } else {
      coronerAccessControlUsage();
    }
  } else {
    coronerAccessControlUsage();
    return;
  }
}

/**
 * @brief Implements the limit command.
 */
function coronerLimit(argv: any, config: any): any {
  const options = null;
  let project, universe, pid, un, target;

  abortIfNotLoggedIn(config);
  const coroner = coronerClientArgv(config, argv);

  universe = argv.universe;
  if (!universe) universe = Object.keys(config.config.universes)[0];

  /* The sub-command. */
  const action = argv._[1];

  if (action == 'list') {
    var bpg = coronerBpgSetup(coroner, argv);
    var model = bpg.get();

    /* Find the universe with the specified name. */
    if (universe) {
      for (var i = 0; i < model.universe.length; i++) {
        if (model.universe[i].get('name') === universe) {
          un = target = model.universe[i];
          break;
        }
      }
    }

    coroner.http_get(
      '/api/limits',
      {universe: universe, token: coroner.config.token},
      null,
      (error, result) => {
        if (error) errx(error + '');

        const rp = JSON.parse(result.bodyData);

        for (const uni in rp) {
          if (un && un.get('name') !== uni) continue;

          const st = printf(
            '%3d %16s limit=%d,counter=%d,rejected=%d',
            rp[uni].id,
            bold(uni),
            rp[uni].submissions.limit,
            rp[uni].submissions.counter,
            rp[uni].submissions.rejected,
          );

          console.log(st);
        }

        return;
      },
    );
  } else {
    var bpg = coronerBpgSetup(coroner, argv);
    var model = bpg.get();

    /* Find the universe with the specified name. */
    for (var i = 0; i < model.universe.length; i++) {
      if (model.universe[i].get('name') === universe) {
        un = target = model.universe[i];
        break;
      }
    }

    if (!un) errx('universe not found');

    if (action === 'reset') {
      var limit;

      console.log(
        'Resetting limits for [' + un.get('id') + '/' + un.get('name') + ']...',
      );

      for (var i = 0; i < model.limits.length; i++) {
        if (model.limits[i].get('universe') === un.get('id')) {
          limit = model.limits[i];
          break;
        }
      }

      if (!limit) errx('Specified universe has no limits.');

      bpg.delete(limit);
      bpg.commit();
      bpg.create(limit);
      bpg.commit();
      return;
    }

    if (action === 'delete') {
      var limit;

      if (!un) errx('Usage: morgue limit delete --universe=<universe>');

      for (var i = 0; i < model.limits.length; i++) {
        if (model.limits[i].get('universe') === un.get('id')) {
          limit = model.limits[i];
        }
      }

      if (!limit) errx('Limit not found.');

      console.log('Deleting limit [' + yellow(limit.get('universe') + ']...'));
      bpg.delete(limit);
      bpg.commit();
      return;
    }

    if (action === 'create') {
      const definition: any = {};

      if (!un) errx('Must specify a universe');

      if (!argv.submissions) errx('--submissions must be specified');

      var limit = bpg.new('limits');
      limit.set('universe', un.get('id'));

      definition.submissions = {
        period: 'month',
        day: 1,
        limit: [argv.submissions, argv.submissions],
      };
      limit.set('definition', JSON.stringify(definition));

      limit.set('metadata', '{}');
      if (argv.metadata) limit.set('metadata', argv.metadata);

      bpg.create(limit);

      try {
        bpg.commit();
      } catch (e) {
        errx(e + '');
      }

      console.log(success_color('Limit successfully created.'));
      return;
    }

    errx('Unknown subcommand.');
  }
}

export const commands: Record<string, (argv: any, config: config.Config) => any> = {
  access: coronerAccessControl,
  limit: coronerLimit,
};
