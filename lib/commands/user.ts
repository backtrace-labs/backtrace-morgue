import printf from 'printf';
import * as config from '../config';
import {errx, err, chalk, success_color} from '../cli/errors';
import {abortIfNotLoggedIn, coronerClientArgv, coronerBpgSetup, tenantURL} from '../cli/context';
import {bpgPostAsync, bpgSingleRequest} from '../cli/bpg-helpers';
import {sequence, prompt_for} from '../cli/util';
import {BACKTRACE_ROLES} from '../cli/constants';
import * as BPG from '../bpg';

function userUsage(error_str?: any): never {
  if (typeof error_str === 'string') err(error_str + '\n');
  console.log('Usage: morgue user reset [options]');
  console.log('Valid options:');
  console.log('  --password=P   Specify password to use for reset.');
  console.log('  --universe=U   Specify universe scope.');
  console.log('  --user=USER    Specify user to reset password for');
  process.exit(1);
}

function userReset(argv: any, config: any): void {
  const ctx: any = {
    user: argv.user,
    password: argv.password,
    role: argv.role,
    coroner: coronerClientArgv(config, argv),
  };

  const prompts = [];
  const tasks = [];

  (ctx.bpg = coronerBpgSetup(ctx.coroner, argv)), (ctx.model = ctx.bpg.get());

  /* If no universe specified, use the first one. */
  ctx.universe = argv.universe;
  if (!ctx.universe && config && config.config && config.config.universes)
    ctx.universe = Object.keys(config.config.universes)[0];
  if (!ctx.universe) {
    errx('No universes.');
  }

  /* Find the universe with the specified name. */
  for (let i = 0; i < ctx.model.universe.length; i++) {
    if (ctx.model.universe[i].get('name') === ctx.universe) {
      ctx.univ_obj = ctx.model.universe[i];
      break;
    }
  }
  if (!ctx.univ_obj) {
    userUsage('Must specify known universe.');
  }

  if (!ctx.user) {
    prompts.push({name: 'username', message: 'User', required: true});
  }

  if (ctx.role && !BACKTRACE_ROLES.includes(ctx.role)) {
    console.error(`Role must be one of: ${BACKTRACE_ROLES.join(', ')}.`);
    return;
  }

  if (prompts.length > 0) {
    tasks.push(prompt_for(prompts));
    tasks.push(result => {
      if (result.username) ctx.user = result.username;
      if (result.password) ctx.password = result.password;
    });
  }

  tasks.push(() => {
    /* Find the user with the specified name. */
    for (let i = 0; i < ctx.model.users.length; i++) {
      if (
        ctx.model.users[i].get('username') === ctx.user &&
        ctx.model.users[i].get('universe') === ctx.univ_obj.get('id')
      ) {
        ctx.user_obj = ctx.model.users[i];
        break;
      }
    }
    if (!ctx.user_obj) {
      return Promise.reject('Must specify valid user.');
    }

    const modifyFields: any = {};
    if (!ctx.role && !ctx.password) {
      return Promise.reject('Must specify a field to modify.');
    }

    if (ctx.password) {
      modifyFields.password = BPG.blobText(ctx.password);
    }
    if (ctx.role) {
      modifyFields.role = ctx.role;
    }

    try {
      ctx.bpg.modify(ctx.user_obj, modifyFields);
      ctx.bpg.commit();
      console.log(success_color('User successfully modified.'));
      return Promise.resolve();
    } catch (e) {
      return Promise.reject(e);
    }
  });

  sequence(tasks).catch(e => {
    err(e.toString());
    process.exit(1);
  });
}

function addDomainWhitelist(argv: any, config: any): Promise<any> {
  const domain = argv.domain;
  const role = argv.role;
  const method = argv.method;
  const coroner = coronerClientArgv(config, argv);
  const bpg = coronerBpgSetup(coroner, argv);

  let universe = argv.universe;
  if (!universe) universe = Object.keys(config.config.universes)[0];

  const model = bpg.get();

  let universeId;
  /* Find the universe with the specified name. */
  for (let i = 0; i < model.universe.length; i++) {
    if (model.universe[i].get('name') === universe) {
      const un = model.universe[i];
      universeId = un.get('id');
    }
  }
  if (!universeId) {
    return Promise.reject('Missing config universe.');
  }

  if (!domain || !role || !method) {
    return Promise.reject('Missing arguments: domain, role, or method.');
  }
  if (!BACKTRACE_ROLES.includes(role)) {
    return Promise.reject(
      `Role must be one of: ${BACKTRACE_ROLES.join(', ')}.`,
    );
  }

  const signup = bpg.new('signup_whitelist');
  signup.set('universe', universeId);
  signup.set('domain', domain);
  signup.set('role', role);
  signup.set('method', method);
  bpg.create(signup);
  bpg.commit();
  console.log(`Created domain whitelist for domain ${domain}.`);
  return Promise.resolve();
}

async function listTeamlessUsers(argv: any, config: any): Promise<any> {
  const coroner = coronerClientArgv(config, argv);
  const bpg = coronerBpgSetup(coroner, argv);

  // Get all users and team_members
  const allUsers: any = await bpgPostAsync(
    bpg,
    bpgSingleRequest({
      action: 'get',
      type: 'configuration/users',
    }),
  );
  const users = allUsers.filter(u => !isBacktraceUser(u));
  const teamMembers: any = await bpgPostAsync(
    bpg,
    bpgSingleRequest({
      action: 'get',
      type: 'configuration/team_member',
    }),
  );

  // get set of all user ids
  const allTeamMemberIds = teamMembers.map(teamMember => teamMember.user);
  const teamMemberIds = [...new Set(allTeamMemberIds)];

  // filter all users by ones that are not included in the teamMembers set
  const noTeamUsers = users.filter(user => !teamMemberIds.includes(user.uid));

  if (!noTeamUsers.length) {
    console.log('No teamless users.');
    return;
  }
  // log results
  console.log('Users with no teams:');
  console.log(
    noTeamUsers
      .map(
        (u, i) =>
          `${i + 1}. username=${u.username}, email=${u.email}, role=${u.role}`,
      )
      .join('\n'),
  );
}

function isBacktraceUser(user: any): boolean {
  if (!user) return false;
  return user.username === 'Backtrace' || user.email.includes('@backtrace.io');
}

function coronerUser(argv: any, config: any): any {
  argv._.shift();
  if (argv._.length === 0) {
    userUsage();
  }

  if (argv._[0] !== 'reset') {
    userUsage('Only the reset subcommand is supported.');
  }

  argv._.shift();
  userReset(argv, config);
}

function coronerUsers(argv: any, config: any): any {
  argv._.shift();
  const action = argv._[0];

  switch (action) {
    case 'add-domain-whitelist':
      addDomainWhitelist(argv, config);
      break;
    case 'list-teamless-users':
      listTeamlessUsers(argv, config);
      break;
  }
}

function coronerInvite(argv: any, config: any): any {
  const options = null;

  abortIfNotLoggedIn(config);
  const coroner = coronerClientArgv(config, argv);

  const usageText =
    'Usage: morgue invite <create | list | resend>\n' +
    '  create <username> <email>\n' +
    '    --role=<"guest" | "member" | "admin">\n' +
    '    --metadata=<metadata>\n' +
    '    --tenant=<tenant name>\n' +
    '    --method=<password | saml | pam>\n' +
    '  delete --universe <universe> <email>\n' +
    '  resend <token>';

  if (argv.h || argv.help) {
    console.log(usageText);
    return;
  }

  let universe = argv.universe;
  if (!universe && config && config.config && config.config.universes)
    universe = Object.keys(config.config.universes)[0];

  const bpg = coronerBpgSetup(coroner, argv);
  const model = bpg.get();

  const action = argv._[1];
  if (!action) errx(usageText);

  if (action === 'list') {
    console.log(
      printf(
        '%6s %20s %8s %8s %30s',
        'Tenant',
        'Username',
        'Method',
        'Role',
        'Email',
      ),
    );

    for (var i = 0; i < model.signup_pending.length; i++) {
      var username = model.signup_pending[i].get('username');
      var email = model.signup_pending[i].get('email');
      var method = model.signup_pending[i].get('method');
      var role = model.signup_pending[i].get('role');
      const sp_universe = model.signup_pending[i].get('universe');

      console.log(
        printf(
          '%6d %20s %8s %8s %30s',
          sp_universe,
          username,
          method,
          role,
          email,
        ),
      );
    }

    return;
  } else if (action === 'delete') {
    var email = argv._[2];
    let matchToken;

    if (!universe || !email)
      errx('Usage: morgue invite delete --universe <universe> <email>');

    const u = model.universe.find(u => u.get('name') === universe);
    if (!u) errx('Universe not found');

    for (var i = 0; i < model.signup_pending.length; i++) {
      const sp_email = model.signup_pending[i].get('email');
      const sp_universe = model.signup_pending[i].get('universe');
      if (sp_email === email && sp_universe === u.get('id')) {
        matchToken = model.signup_pending[i];
        break;
      }
    }

    if (!matchToken) errx('invitation not found.');

    bpg.delete(matchToken);
    try {
      bpg.commit();
    } catch (e) {
      errx(e + '');
    }

    console.log(success_color('Invitation successfully deleted.'));
    return;
  } else if (action === 'create') {
    var username = argv._[2];
    var email = argv._[3];
    const metadata = argv.metadata ? argv.metadata : ' ';
    var role = argv.role ? argv.role : 'member';
    var method = argv.method ? argv.method : 'password';
    const tenant = argv.tenant ? argv.tenant : universe;
    let un;

    if (!tenant || !username || !email || !metadata || !role || !method)
      errx(usageText);

    /* First, validate that a universe with the specified name exists. */
    for (var i = 0; i < model.universe.length; i++) {
      if (model.universe[i].get('name') === tenant) {
        un = model.universe[i];
        break;
      }
    }

    if (!un) errx('failed to find tenant ' + tenant + '.');

    const signup = bpg.new('signup_pending');
    signup.set('token', '0');
    signup.set('role', role);
    signup.set('method', method);
    signup.set('universe', un.get('id'));
    signup.set('email', email);
    signup.set('username', username);
    bpg.create(signup);

    try {
      bpg.commit();
    } catch (e) {
      errx(e + '');
    }

    console.log(success_color('Invitation successfully created for ' + email));

    process.stderr.write('Sending e-mail...');
    coroner.endpoint = tenantURL(config, un.get('name'));
    coroner.post(
      '/api/signup',
      {universe: un.get('name')},
      {
        action: 'resend',
        form: {
          username: username,
        },
      },
      null,
      (e, r) => {
        if (e) errx(e);

        if (r.status !== 'ok') errx(r.message);

        process.stderr.write('done\n');
        return;
      },
    );
  } else {
    errx(usageText);
  }
}

export const commands: Record<string, (argv: any, config: any) => any> = {
  user: coronerUser,
  users: coronerUsers,
  invite: coronerInvite,
};
