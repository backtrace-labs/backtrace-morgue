import printf from 'printf';
import type {
  AccessTeamCreateCommand,
  AccessTeamRemoveCommand,
  AccessTeamDetailsCommand,
  AccessTeamAddUserCommand,
  AccessTeamRemoveUserCommand,
  AccessTeamListCommand,
  AccessProjectAddTeamCommand,
  AccessProjectRemoveTeamCommand,
  AccessProjectAddUserCommand,
  AccessProjectRemoveUserCommand,
  AccessProjectDetailsCommand,
  LimitListCommand,
  LimitResetCommand,
  LimitDeleteCommand,
  LimitCreateCommand,
} from '../cli/generated/types';
import * as config from '../config';
import {errx, err, chalk, success_color} from '../cli/errors';
import {abortIfNotLoggedIn, coronerClientFromGlobal, coronerBpgFromGlobal} from '../cli/context';

const bold = chalk.bold;
const blue = chalk.blue;
const red = chalk.red;
const yellow = chalk.yellow;

function getUniverseAndBpg(config: any, globalOptions: any) {
  const coroner = coronerClientFromGlobal(config, globalOptions);
  let universe = globalOptions.universe;
  if (!universe) universe = Object.keys(config.config.universes)[0];

  const bpg = coronerBpgFromGlobal(coroner, globalOptions);
  const model = bpg.get();

  let universeId: any;
  for (let i = 0; i < model.universe.length; i++) {
    if (model.universe[i].get('name') === universe) {
      universeId = model.universe[i].get('id');
    }
  }
  if (universeId === undefined) {
    errx(red('Universe not found'));
  }

  return {coroner, bpg, model, universeId, universe};
}

function accessTeamCreate(cmd: AccessTeamCreateCommand, config: any) {
  abortIfNotLoggedIn(config);
  const {bpg, model, universeId} = getUniverseAndBpg(config, cmd.globalOptions);

  const team = bpg.new('team');
  team.set('name', cmd.team);
  team.set('universe', universeId);
  team.set('id', 0);
  bpg.create(team);
  bpg.commit();
}

function accessTeamRemove(cmd: AccessTeamRemoveCommand, config: any) {
  abortIfNotLoggedIn(config);
  const {bpg, model} = getUniverseAndBpg(config, cmd.globalOptions);

  const team = model.team.find(t => t.get('name') == cmd.team);
  if (team === undefined) {
    err('Team not found');
    return;
  }
  bpg.delete(team);
  bpg.commit();
}

function accessTeamList(cmd: AccessTeamListCommand, config: any) {
  abortIfNotLoggedIn(config);
  const {model, universeId} = getUniverseAndBpg(config, cmd.globalOptions);

  model.team
    .filter(t => t.get('universe') == universeId)
    .forEach(t => {
      console.log(t.get('name'));
    });
}

function accessTeamDetails(cmd: AccessTeamDetailsCommand, config: any) {
  abortIfNotLoggedIn(config);
  const {model} = getUniverseAndBpg(config, cmd.globalOptions);

  const team = model.team.find(t => t.get('name') == cmd.team);
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

function accessTeamAddUser(cmd: AccessTeamAddUserCommand, config: any) {
  abortIfNotLoggedIn(config);
  const {bpg, model} = getUniverseAndBpg(config, cmd.globalOptions);

  const team = model.team.find(t => t.get('name') == cmd.team);
  if (team === undefined) {
    err('Team not found');
    return;
  }

  const user = model.users.find(u => u.get('username') == cmd.user);
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

function accessTeamRemoveUser(cmd: AccessTeamRemoveUserCommand, config: any) {
  abortIfNotLoggedIn(config);
  const {bpg, model} = getUniverseAndBpg(config, cmd.globalOptions);

  const team = model.team.find(t => t.get('name') == cmd.team);
  if (team === undefined) {
    err('Team not found');
    return;
  }

  const user = model.users.find(u => u.get('username') == cmd.user);
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
    err(`User '${cmd.user}' is not a member of team '${cmd.team}'`);
    return;
  }

  bpg.delete(tm);
  bpg.commit();
}

function accessProjectAddTeam(cmd: AccessProjectAddTeamCommand, config: any) {
  abortIfNotLoggedIn(config);
  const {bpg, model} = getUniverseAndBpg(config, cmd.globalOptions);

  const project = model.project.find(p => p.get('name') == cmd.project);
  if (project === undefined) errx(red(`project not found: ${cmd.project}`));

  const t = model.team.find(t => t.get('name') == cmd.team);
  if (t === undefined) errx(red(`team not found: ${cmd.team}`));

  const add = bpg.new('project_member_team');
  add.set('project', project.get('pid'));
  add.set('team', t.get('id'));
  add.set('role', cmd.role);
  bpg.create(add);
  bpg.commit();
}

function accessProjectRemoveTeam(cmd: AccessProjectRemoveTeamCommand, config: any) {
  abortIfNotLoggedIn(config);
  const {bpg, model} = getUniverseAndBpg(config, cmd.globalOptions);

  const project = model.project.find(p => p.get('name') == cmd.project);
  if (project === undefined) errx(red(`project not found: ${cmd.project}`));

  const t = model.team.find(t => t.get('name') == cmd.team);
  if (t === undefined) errx(red(`team not found: ${cmd.team}`));

  const bpgObject = model.project_member_team.find(
    pm => pm.get('team') == t.get('id') && pm.get('project') == project.get('pid'),
  );
  if (bpgObject === undefined)
    errx(`team not found for project ${cmd.project}`);

  bpg.delete(bpgObject);
  bpg.commit();
}

function accessProjectAddUser(cmd: AccessProjectAddUserCommand, config: any) {
  abortIfNotLoggedIn(config);
  const {bpg, model} = getUniverseAndBpg(config, cmd.globalOptions);

  const project = model.project.find(p => p.get('name') == cmd.project);
  if (project === undefined) errx(red(`project not found: ${cmd.project}`));

  const u = model.users.find(u => u.get('username') == cmd.user);
  if (u === undefined) errx(red(`user not found: ${cmd.user}`));

  const add = bpg.new('project_member_user');
  add.set('project', project.get('pid'));
  add.set('user', u.get('uid'));
  add.set('role', cmd.role);
  bpg.create(add);
  bpg.commit();
}

function accessProjectRemoveUser(cmd: AccessProjectRemoveUserCommand, config: any) {
  abortIfNotLoggedIn(config);
  const {bpg, model} = getUniverseAndBpg(config, cmd.globalOptions);

  const project = model.project.find(p => p.get('name') == cmd.project);
  if (project === undefined) errx(red(`project not found: ${cmd.project}`));

  const u = model.users.find(u => u.get('username') == cmd.user);
  if (u === undefined) errx(red(`user not found: ${cmd.user}`));

  const bpgObject = model.project_member_user.find(
    pm => pm.get('user') == u.get('uid') && pm.get('project') == project.get('pid'),
  );
  if (bpgObject === undefined)
    errx(`user not found for project ${cmd.project}`);

  bpg.delete(bpgObject);
  bpg.commit();
}

function accessProjectDetails(cmd: AccessProjectDetailsCommand, config: any) {
  abortIfNotLoggedIn(config);
  const {model} = getUniverseAndBpg(config, cmd.globalOptions);

  const project = model.project.find(p => p.get('name') == cmd.project);
  if (project === undefined) errx(red(`project not found: ${cmd.project}`));

  const users = model.project_member_user.filter(
    pm => pm.get('project') == project.get('pid'),
  );
  const teams = model.project_member_team.filter(
    pm => pm.get('project') == project.get('pid'),
  );

  if (users.length == 0 && teams.length == 0) {
    console.log(`Project ${cmd.project} has no access control`);
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

function limitList(cmd: LimitListCommand, config: any) {
  abortIfNotLoggedIn(config);
  const coroner = coronerClientFromGlobal(config, cmd.globalOptions);

  let universe = cmd.globalOptions.universe;
  if (!universe) universe = Object.keys(config.config.universes)[0];

  const bpg = coronerBpgFromGlobal(coroner, cmd.globalOptions);
  const model = bpg.get();

  let un: any;
  if (universe) {
    for (var i = 0; i < model.universe.length; i++) {
      if (model.universe[i].get('name') === universe) {
        un = model.universe[i];
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
}

function limitReset(cmd: LimitResetCommand, config: any) {
  abortIfNotLoggedIn(config);
  const coroner = coronerClientFromGlobal(config, cmd.globalOptions);

  let universe = cmd.globalOptions.universe;
  if (!universe) universe = Object.keys(config.config.universes)[0];

  const bpg = coronerBpgFromGlobal(coroner, cmd.globalOptions);
  const model = bpg.get();

  let un: any;
  for (var i = 0; i < model.universe.length; i++) {
    if (model.universe[i].get('name') === universe) {
      un = model.universe[i];
      break;
    }
  }
  if (!un) errx('universe not found');

  let limit: any;
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
}

function limitDelete(cmd: LimitDeleteCommand, config: any) {
  abortIfNotLoggedIn(config);
  const coroner = coronerClientFromGlobal(config, cmd.globalOptions);

  let universe = cmd.globalOptions.universe;
  if (!universe) universe = Object.keys(config.config.universes)[0];

  const bpg = coronerBpgFromGlobal(coroner, cmd.globalOptions);
  const model = bpg.get();

  let un: any;
  for (var i = 0; i < model.universe.length; i++) {
    if (model.universe[i].get('name') === universe) {
      un = model.universe[i];
      break;
    }
  }
  if (!un) errx('Usage: morgue limit delete --universe=<universe>');

  let limit: any;
  for (var i = 0; i < model.limits.length; i++) {
    if (model.limits[i].get('universe') === un.get('id')) {
      limit = model.limits[i];
    }
  }

  if (!limit) errx('Limit not found.');

  console.log('Deleting limit [' + yellow(limit.get('universe') + ']...'));
  bpg.delete(limit);
  bpg.commit();
}

function limitCreate(cmd: LimitCreateCommand, config: any) {
  abortIfNotLoggedIn(config);
  const coroner = coronerClientFromGlobal(config, cmd.globalOptions);

  let universe = cmd.globalOptions.universe;
  if (!universe) universe = Object.keys(config.config.universes)[0];

  const bpg = coronerBpgFromGlobal(coroner, cmd.globalOptions);
  const model = bpg.get();

  let un: any;
  for (var i = 0; i < model.universe.length; i++) {
    if (model.universe[i].get('name') === universe) {
      un = model.universe[i];
      break;
    }
  }
  if (!un) errx('Must specify a universe');

  if (!cmd.submissions) errx('--submissions must be specified');

  const definition: any = {};
  var limit = bpg.new('limits');
  limit.set('universe', un.get('id'));

  definition.submissions = {
    period: 'month',
    day: 1,
    limit: [cmd.submissions, cmd.submissions],
  };
  limit.set('definition', JSON.stringify(definition));

  limit.set('metadata', '{}');
  if (cmd.metadata) limit.set('metadata', cmd.metadata);

  bpg.create(limit);

  try {
    bpg.commit();
  } catch (e) {
    errx(e + '');
  }

  console.log(success_color('Limit successfully created.'));
}

export const handlers: Record<string, (cmd: any, config: any) => any> = {
  'access.team.create': accessTeamCreate,
  'access.team.remove': accessTeamRemove,
  'access.team.list': accessTeamList,
  'access.team.details': accessTeamDetails,
  'access.team.add-user': accessTeamAddUser,
  'access.team.remove-user': accessTeamRemoveUser,
  'access.project.add-team': accessProjectAddTeam,
  'access.project.remove-team': accessProjectRemoveTeam,
  'access.project.add-user': accessProjectAddUser,
  'access.project.remove-user': accessProjectRemoveUser,
  'access.project.details': accessProjectDetails,
  'limit.list': limitList,
  'limit.reset': limitReset,
  'limit.delete': limitDelete,
  'limit.create': limitCreate,
};
