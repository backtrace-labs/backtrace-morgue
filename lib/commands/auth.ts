import promptLib from 'prompt';
import * as url from 'url';
import * as fs from 'fs';
import * as config from '../config';
import {errx, chalk, success_color} from '../cli/errors';
import {abortIfNotLoggedIn, coronerClientArgv, coronerClient, coronerBpgSetup, saveConfig} from '../cli/context';
import {usage} from '../cli/util';
import * as BPG from '../bpg';

const bold = chalk.bold;
const cyan = chalk.cyan;
const grey = chalk.grey;
const green = chalk.green;
const red = chalk.red;

async function coronerSetupNext(coroner, bpg, setupCfg): Promise<any> {
  const model = bpg.get();

  process.stderr.write('\n');

  /* Do this one first so superuser isn't set up before this is. */
  const cons_l = model.listener.find(l => {
    return l.get('type') === 'http/console';
  });
  if (cons_l) {
    const dns_name = cons_l.get('dns_name');
    if (!dns_name || dns_name.length === 0)
      return coronerSetupDns(coroner, bpg, cons_l, setupCfg);
  }

  if (!model.universe || model.universe.length === 0)
    return coronerSetupUniverse(coroner, bpg, setupCfg);

  if (!model.users || model.users.length === 0)
    return coronerSetupUser(coroner, bpg, setupCfg);

  process.stderr.write('Please use a web browser to complete setup:\n');
  process.stderr.write(
    cyan.bold(
      coroner.endpoint + '/config/' + model.universe[0].get('name') + '\n',
    ),
  );
  return;
}

async function coronerSetupDns(coroner, bpg, cons_l, setupCfg): Promise<any> {
  let dns_name = setupCfg?.dns_name;
  if (!dns_name) {
    console.log(bold('Specify DNS name users will use to reach the server'));
    console.log(
      'We must specify this so that services accessing the server via SSL\n' +
        'can reach it without skipping validation.\n',
    );

    const result = await promptLib.get([
      {
        name: 'dns_name',
        description: 'DNS name',
        pattern:
          /^(([a-zA-Z0-9]|[a-zA-Z0-9][a-zA-Z0-9\-]*[a-zA-Z0-9])\.)*([A-Za-z0-9]|[A-Za-z0-9][A-Za-z0-9\-]*[A-Za-z0-9])$/,
        type: 'string',
        required: true,
      },
    ]);
    dns_name = result.dns_name;
  }
  const model = bpg.get();

  bpg.modify(cons_l, {dns_name});
  bpg.commit();

  return coronerSetupNext(coroner, bpg, setupCfg);
}

async function coronerSetupUser(coroner, bpg, setupCfg): Promise<any> {
  let username = setupCfg?.username;
  let email = setupCfg?.email;
  let password = setupCfg?.password;

  // Simplify a bit by requiring all inputs even if only one is missing.  Caller
  // using the JSON file is expected to provide all inputs ahead of time.
  if (!username) {
    console.log(bold('Create an administrator'));
    console.log(
      'We must create an administrator user. This user will be used to configure\n' +
        'the server as well as perform system-wide administrative tasks.\n',
    );

    const result = await promptLib.get([
      {
        name: 'username',
        description: 'Username',
        pattern: /^[a-z0-9\_]+$/,
        type: 'string',
        required: true,
      },
      {
        name: 'email',
        description: 'E-mail address',
        required: true,
        type: 'string',
        pattern: /^([a-zA-Z0-9_\-\.]+)@([a-zA-Z0-9_\-\.]+)\.([a-zA-Z]{2,5})$/,
      },
      {
        name: 'password',
        description: 'Password',
        required: true,
        hidden: true,
        replace: '*',
        type: 'string',
      },
      {
        name: 'passwordConfirm',
        description: 'Confirm password',
        required: true,
        hidden: true,
        replace: '*',
        type: 'string',
      },
    ]);
    if (result.password !== result.passwordConfirm) {
      errx('Passwords do not match.');
    }
    username = result.username;
    email = result.email;
    password = result.password;
  }

  const model = bpg.get();
  const user = bpg.new('users');
  user.set('uid', 0);
  user.set('superuser', 1);
  user.set('method', 'password');
  user.set('universe', model.universe[0].get('id'));
  user.set('username', username);
  user.set('email', email);
  user.set('password', BPG.blobText(password));
  bpg.create(user);
  bpg.commit();

  return coronerSetupNext(coroner, bpg, setupCfg);
}

async function coronerSetupUniverse(coroner, bpg, setupCfg): Promise<any> {
  let universe_name = setupCfg?.universe;
  if (!universe_name) {
    console.log(bold('Create an organization'));
    console.log(
      'We must configure the organization that is using the object store.\n' +
        'Please provide a one word name for the organization using the object store.\n' +
        'For example, if your company name is "Appleseed Systems I/O", you could\n' +
        'use the name "appleseed". The name must be lowercase.\n',
    );

    const result = await promptLib.get([
      {
        name: 'universe',
        description: 'Organization name',
        message: 'Must be lowercase and only contains letters.',
        type: 'string',
        pattern: /^[a-z0-9]+$/,
        required: true,
      },
    ]);
    universe_name = result.universe;
  }

  const universe = bpg.new('universe');
  universe.set('id', 0);
  universe.set('name', universe_name);
  bpg.create(universe);
  bpg.commit();
  return coronerSetupNext(coroner, bpg, setupCfg);
}

function coronerSetupStart(coroner: any, argv: any): any {
  const bpg = coronerBpgSetup(coroner, argv);
  let setupCfg;
  if (argv.setup_json && fs.existsSync(argv.setup_json)) {
    setupCfg = JSON.parse(fs.readFileSync(argv.setup_json, 'utf8'));
  }

  coronerSetupNext(coroner, bpg, setupCfg)
    .then(() => console.log('Setup complete'))
    .catch(err => console.log(`Setup failed: ${err}`));
}

function loginComplete(coroner, argv, err, cb) {
  if (err) {
    errx('Unable to authenticate: ' + err.message + '.');
  }

  saveConfig(coroner, err => {
    if (err) {
      errx('Unable to save config: ' + err.message + '.');
    }

    console.log(
      success_color('Logged in') + ' ' + grey('[' + coroner.config.token + ']'),
    );

    if (cb) {
      cb(coroner, argv);
    }

    return coroner;
  });

  return;
}

function coronerLogin(argv, config, cb?) {
  const endpoint = argv._[1];

  if (!endpoint) {
    return usage('Expected endpoint argument.');
  }

  const coroner = coronerClient(
    config,
    !!argv.k,
    argv.debug,
    endpoint,
    argv.timeout,
  );

  /*
   * If a token is supplied, immediately to go login path.
   */
  if (argv.token) {
    return coroner.login_token(argv.token, err => {
      loginComplete(coroner, argv, err, cb);
    });
  }

  const loginCb = (username, password) => {
    coroner.login(username, password, err => {
      loginComplete(coroner, argv, err, cb);
    });
  };

  if (process.env.MORGUE_USERNAME && process.env.MORGUE_PASSWORD) {
    loginCb(process.env.MORGUE_USERNAME, process.env.MORGUE_PASSWORD);
    return;
  }

  promptLib.get(
    [
      {
        name: 'username',
        message: 'User',
        required: true,
      },
      {
        message: 'Password',
        name: 'password',
        replace: '*',
        hidden: true,
        required: true,
      },
    ],
    (err, result) => {
      if (err) {
        if (err.message === 'canceled') {
          return;
        } else {
          throw err;
        }
      }

      loginCb(result.username, result.password);
    },
  );
}

function coronerLogout(argv: any, config: any): any {
  abortIfNotLoggedIn(config);
  const coroner = coronerClientArgv(config, argv);

  coroner.http_get(
    '/api/logout',
    {token: argv.token || coroner.config.token},
    null,
    (error, result) => {
      if (error) errx(error + '');

      console.log(success_color('Logged out.'));
    },
  );
}

function coronerSetup(argv: any, config: any): any {
  let coroner, pu;

  process.env.NODE_TLS_REJECT_UNAUTHORIZED = !argv.k ? '1' : '0';
  try {
    pu = url.parse(argv._[1]);
  } catch (error) {
    errx('Usage: morgue setup <url>');
  }

  if (pu.protocol !== 'http:' && pu.protocol !== 'https:') {
    errx('Usage: morgue setup <url>');
  }

  coroner = coronerClient(config, true, !!argv.debug, argv._[1], argv.timeout);

  process.stderr.write(bold('Determining system state...'));

  coroner.get('/api/is_configured', '', (error, response) => {
    response = parseInt(response + '');

    if (response === 0) {
      process.stderr.write(red('unconfigured\n'));
      return coronerSetupStart(coroner, argv);
    } else if (response === 1) {
      process.stderr.write(green('configured\n\n'));

      console.log(bold('Please login to continue setup.'));
      return coronerLogin(argv, config, coronerSetupStart);
    } else {
      process.stderr.write(
        red("\n\nUnexpected response when checking the server's status.\n\n"),
      );
      process.stderr.write(
        red('This could be caused by one of the following:\n'),
      );
      process.stderr.write(
        red(
          '  * Either the coronerd or backtrace-nginx services are not running on the server, or are in a failed state.\n',
        ),
      );
      process.stderr.write(
        red(
          '  * A proxy or forwarder is handling the request and is returning a response that the morgue client cannot understand.\n',
        ),
      );
      process.stderr.write(
        red(
          '  * Certificate validation is failing when trying to communicate with the server (try using -k if using self-signed certificates).\n',
        ),
      );
      process.stderr.write(red('  * The destination URL is incorrect.\n'));
      process.stderr.write(red('\n'));
      process.stderr.write(
        red(
          'To view the response from the server, try running the following command:\n',
        ),
      );
      process.stderr.write(red('  curl ' + argv._[1] + '/api/is_configured\n'));
      process.exit(1);
    }
  });
}

export const commands: Record<string, (argv: any, config: config.Config) => any> = {
  login: coronerLogin,
  logout: coronerLogout,
  setup: coronerSetup,
};
