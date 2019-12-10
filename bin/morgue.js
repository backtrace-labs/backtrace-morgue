#!/usr/bin/env node

'use strict';

const Callstack = require('../lib/callstack.js');
const CoronerClient = require('../lib/coroner.js');
const crdb      = require('../lib/crdb.js');
const BPG       = require('../lib/bpg.js');
const minimist  = require('minimist');
const os        = require('os');
const ip        = require('ip');
const bar       = require('./bar.js');
const ta        = require('time-ago');
const histogram = require('./histogram.js');
const intersect = require('intersect');
const printf    = require('printf');
const moment    = require('moment');
const moment_tz = require('moment-timezone');
const colors    = require('colors');
const fs        = require('fs');
const mkdirp    = require('mkdirp');
const promptLib = require('prompt');
const path      = require('path');
const table     = require('table').table;
const bt        = require('backtrace-node');
const spawn     = require('child_process').spawn;
const url       = require('url');
const packageJson = require(path.join(__dirname, "..", "package.json"));
const sprintf   = require('extsprintf').sprintf;
const chrono = require('chrono-node');
const zlib      = require('zlib');
const symbold = require('../lib/symbold.js');

var levenshtein;

try {
  levenshtein = require('levenshtein-sse');
} catch (e) {
  levenshtein = null;
}

var flamegraph = path.join(__dirname, "..", "assets", "flamegraph.pl");

var callstackError = false;
var error = colors.red;
var range_start = null;
var range_stop = null;
var endpoint;
var endpointToken;
var reverse = 1;
var ARGV;
const configDir = path.join(os.homedir(), ".morgue");
const configFile = path.join(configDir, "current.json");

bt.initialize({
  timeout: 5000,
  endpoint: "https://backtrace.sp.backtrace.io:6098",
  token: "2cfca2efffd862c7ad7188be8db09d8697bd098a3561cd80a56fe5c4819f5d14",
  attributes: {
    version: packageJson.version
  }
});

function usage(str) {
  if (typeof str === 'string')
    err(str + "\n");
  console.error("Usage: morgue <command> [options]");
  console.error("");
  console.error("Options:");
  console.error("  -v, --version       Print version number and exit");
  console.error("  --debug             Enable verbose debug printing");
  console.error("  -k                  Disable SSL verification with CA");
  console.error("  --timeout ms        Set the timeout on API requests in milliseconds");
  console.error("");
  console.error("Documentation is available at:");
  console.error("https://github.com/backtrace-labs/backtrace-morgue#readme");
  process.exit(1);
}

function nsToUs(tm) {
  return Math.round((tm[0] * 1000000) + (tm[1] / 1000));
}

function oidToString(oid) {
  return oid.toString(16);
}

function oidFromString(oid) {
  return parseInt(oid, 16);
}

function err(msg) {
  if (msg) {
    var m = msg.toString();
    if (m.slice(0, 5) !== "Error")
      m = "Error: " + m;
    console.log(m.error);
  } else {
    console.log("Unknown error occured.".error);
  }
  return false;
}

function errx(errobj, opts) {
  if (typeof errobj === 'object' && errobj.message) {
    if (typeof opts === 'object' && opts.debug)
      console.log("err = ", errobj);
    err(errobj.message);
  } else {
    err(errobj);
  }
  process.exit(1);
}

/* Standardized success/failure callbacks. */
function std_success_cb(r) {
  console.log('Success'.blue);
}

function std_json_cb(r) {
  console.log('Success:'.blue);
  console.log(JSON.stringify(r, null, 4));
}

function std_failure_cb(e) {
  var msg = e.toString();

  if (e.response_obj && e.response_obj.bodyData) {
    try {
      var je = JSON.parse(e.response_obj.bodyData);

      if (je && je.error && je.error.message) {
        msg = je.error.message;
      }
    } catch (ex) {
      if (e.response_obj.debug) {
        console.log('Response:\n', e.response_obj.bodyData);
      }
      console.log('ex = ', ex);
    }
  }
  errx(msg);
}

function objToPath(oid, resource) {
  var str = oid;

  if (typeof oid !== 'string')
   str = oidToString(oid);

  if (resource)
    str += ":" + resource;
  else
    str += ".bin";
  return str;
}

function printSamples(requests, samples, start, stop, concurrency) {
  var i;
  var sum = 0;
  var minimum, maximum, tps;

  start = nsToUs(start);
  stop = nsToUs(stop);

  for (i = 0; i < samples.length; i++) {
    var value = parseInt(samples[i]);

    sum += value;

    if (!maximum || value > maximum)
      maximum = value;
    if (!minimum || value < minimum)
      minimum = value;
  }

  sum = Math.ceil(sum / samples.length);

  tps = Math.floor(requests / ((stop - start) / 1000000));

  process.stdout.write(printf("# %12s %12s %12s %12s %12s %12s %12s\n",
    "Concurrency", "Requests", "Time", "Minimum", "Average",
    "Maximum", "Throughput").grey);
  process.stdout.write(printf("  %12d %12ld %12f %12ld %12ld %12ld %12ld\n",
    concurrency, requests, (stop - start) / 1000000,
    minimum, sum, maximum, tps));
  return;
}

function sequence(tasks) {
  return tasks.reduce((chain, s) => {
    if (typeof s === 'function')
      return chain.then(s).catch((e) => { return Promise.reject(e) });
    return chain.then(() => { return s; }).catch((e) => { return Promise.reject(e) });
  }, Promise.resolve());
}

function prompt_for(items) {
  return new Promise((resolve, reject) => {
    promptLib.get(items, (err, result) => {
      if (err)
        reject(err);
      else
        resolve(result);
    });
  });
}

var commands = {
  attachment: coronerAttachment,
  attribute: coronerAttribute,
  audit: coronerAudit,
  log: coronerLog,
  bpg: coronerBpg,
  error: coronerError,
  list: coronerList,
  callstack: coronerCallstack,
  deduplication: coronerDeduplication,
  clean: coronerClean,
  report: coronerReport,
  latency: coronerLatency,
  tenant: coronerTenant,
  similarity: coronerSimilarity,
  flamegraph: coronerFlamegraph,
  control: coronerControl,
  invite: coronerInvite,
  ls: coronerList,
  describe: coronerDescribe,
  token: coronerToken,
  session: coronerSession,
  limit: coronerLimit,
  set: coronerSet,
  get: coronerGet,
  put: coronerPut,
  login: coronerLogin,
  logout: coronerLogout,
  modify: coronerModify,
  nuke: coronerNuke,
  delete: coronerDelete,
  repair: coronerRepair,
  reprocess: coronerReprocess,
  retention: coronerRetention,
  sampling: coronerSampling,
  service: coronerService,
  symbol: coronerSymbol,
  symbold: symboldClient,
  scrubber: coronerScrubber,
  setup: coronerSetup,
  user: coronerUser,
  merge: coronerMerge,
  unmerge: coronerUnmerge,
};

process.stdout.on('error', function(){process.exit(0);});
process.stderr.on('error', function(){process.exit(0);});
main();

function coronerError(argv, config) {
  if (argv._.length < 2) {
    errx("Missing error string");
  }

  throw Error(argv._[1]);
}

/**
 * @brief Returns the universe/project pair to use for coroner commands.
 */
function coronerParams(argv, config) {
  var p = {};

  if (Array.isArray(argv._) === true && argv._.length > 1) {
    var split;

    split = argv._[1].split('/');
    if (split.length === 1) {
      var first;

      /* Try to automatically derive a path from the one argument. */
      for (first in config.config.universes) break;
      p.universe = first;
      p.project = argv._[1];
    } else {
      p.universe = split[0];
      p.project = split[1];
    }
  }
  if (argv.token) {
    p.token = argv.token;
  } else if (argv["api-token"]) {
    /* argv.token is used for other things as well. */
    p.token = argv["api-token"];
  }

  return p;
}

function saveConfig(coroner, callback) {
  makeConfigDir(function(err) {
    if (err) return callback(err);

    var config = {
      config: coroner.config,
      endpoint: coroner.endpoint,
    };

    if (coroner.config.endpoints.post) {
      var ep = coroner.config.endpoints.post;
      var fu = url.parse(coroner.endpoint);
      var i = 0;

      config.submissionEndpoint = ep[0].protocol + '://' +
        fu.hostname + ':' + ep[0].port + '/post';
    }

    var text = JSON.stringify(config, null, 2);
    fs.writeFile(configFile, text, callback);
  });
}

function loadConfig(callback) {
  makeConfigDir(function(err) {
    if (err) return callback(err);
    fs.readFile(configFile, {encoding: 'utf8'}, function(err, text) {
      var json;

      if (text && text.length > 0) {
        try {
          json = JSON.parse(text);
        } catch (err) {
          return callback(new Error(err.message));
        }
      } else {
        json = {};
      }
      callback(null, json);
    });
  });
}

function makeConfigDir(callback) {
  mkdirp(configDir, {mode: "0700"}, callback);
}

function abortIfNotLoggedIn(config) {
  if (config && config.config && config.config.token) return;

  /* If an endpoint is specified, then synthensize aa configuration structure. */
  if (endpoint) {
    config.config = {};

    /* We rely on host-based authentication if no token is specified. */
    config.config.token = endpointToken;
    if (!config.config.token)
      config.config.token = '00000';

    config.endpoint = endpoint;
    return;
  }

  errx("Must login first.");
}

function coronerSetupNext(coroner, bpg) {
  var model = bpg.get();

  process.stderr.write('\n');

  if (!model.universe || model.universe.length === 0)
    return coronerSetupUniverse(coroner, bpg);

  if (!model.users || model.users.length === 0)
    return coronerSetupUser(coroner, bpg);

  process.stderr.write(
    'Please use a web browser to complete setup:\n');
  process.stderr.write((coroner.endpoint + '/config/' + model.universe[0].get('name') + '\n').cyan.bold);
  return;
}

function coronerSetupUser(coroner, bpg) {
  console.log('Create an administrator'.bold);
  console.log(
    'We must create an administrator user. This user will be used to configure\n' +
    'the server as well as perform system-wide administrative tasks.\n');

  promptLib.get([
  {
    name: 'username',
    description: 'Username',
    pattern: /^[a-z0-9\_]+$/,
    type: 'string',
    required: true
  },
  {
    name: 'email',
    description: 'E-mail address',
    required: true,
    type: 'string',
    pattern: /^([a-zA-Z0-9_\-\.]+)@([a-zA-Z0-9_\-\.]+)\.([a-zA-Z]{2,5})$/
  },
  {
    name: 'password',
    description: 'Password',
    required: true,
    hidden: true,
    replace: '*',
    type: 'string'
  },
  {
    name: 'passwordConfirm',
    description: 'Confirm password',
    required: true,
    hidden: true,
    replace: '*',
    type: 'string'
  },
  ], function(error, result) {
    var model = bpg.get();

    if (!result || !result.username || !result.password) {
      errx('No user provided.');
    }
    if (result.password !== result.passwordConfirm) {
      errx('Passwords do not match.');
    }

    var user = bpg.new('users');
    user.set('uid', 0);
    user.set('superuser', 1);
    user.set('method', 'password');
    user.set('universe', model.universe[0].get('id'));
    user.set('username', result.username);
    user.set('email', result.email);
    user.set('password', BPG.blobText(result.password));
    bpg.create(user);
    bpg.commit();

    return coronerSetupNext(coroner, bpg);
  });
}

function coronerSetupUniverse(coroner, bpg) {
  console.log('Create an organization'.bold);
  console.log(
    'We must first configure the organization that is using the object store.\n' +
    'Please provide a one word name for the organization using the object store.\n' +
    'For example, if your company name is "Appleseed Systems I/O", you could\n' +
    'use the name "appleseed". The name must be lowercase.\n');

  promptLib.get([{
    name: 'universe',
    description: 'Organization name',
    message: 'Must be lowercase and only contains letters.',
    type: 'string',
    pattern: /^[a-z0-9]+$/,
    required: true
  }], function(error, result) {
    if (!result || !result.universe) {
      errx('No organization name provided.');
    }

    var universe = bpg.new('universe');
    universe.set('id', 0);
    universe.set('name', result.universe);
    bpg.create(universe);
    bpg.commit();
    return coronerSetupNext(coroner, bpg);
  });
}

function coronerBpgSetup(coroner, argv) {
  var coronerd = {
    url: coroner.endpoint,
    session: { token: '000000000' }
  };
  var opts = {};
  var bpg = {};

  if (coroner.config && coroner.config.token)
    coronerd.session.token = coroner.config.token;

  if (argv.debug)
    opts.debug = true;

  bpg = new BPG.BPG(coronerd, opts);
  return bpg;
}

function coronerClient(config, insecure, debug, endpoint, timeout) {
  return new CoronerClient({
    insecure: insecure,
    debug: debug,
    endpoint: endpoint,
    timeout: timeout,
    config: config.config,
  });
}

function coronerClientArgv(config, argv) {
  if (argv.token && argv.endpoint) {
    config.config.token = argv.token;
    config.endpoint = argv.endpoint;
  }
  return coronerClient(
    config,
    !!argv.k,
    !!argv.debug,
    config.endpoint,
    argv.timeout
  );
}
function coronerClientArgvSubmit(config, argv) {
  return coronerClient(config, !!argv.k, argv.debug,
    config.submissionEndpoint, argv.timeout);
}

function coronerSetupStart(coroner, argv) {
  var bpg = coronerBpgSetup(coroner, argv);

  return coronerSetupNext(coroner, bpg);
}

function coronerSetup(argv, config) {
  var coroner, pu;

  process.env.NODE_TLS_REJECT_UNAUTHORIZED = (!!!argv.k) ? "1" : "0";
  try {
    pu = url.parse(argv._[1]);
  } catch (error) {
    errx('Usage: morgue setup <url>');
  }

  if (pu.protocol !== 'http:' &&
      pu.protocol !== 'https:') {
    errx('Usage: morgue setup <url>');
  }

  coroner = coronerClient(config, true, !!argv.debug, argv._[1], argv.timeout);

  process.stderr.write('Determining system state...'.bold);

  coroner.get('/api/is_configured', '', function(error, response) {
    response = parseInt(response + '');

    if (response === 0) {
      process.stderr.write('unconfigured\n'.red);
      return coronerSetupStart(coroner, argv);
    } else {
      process.stderr.write('configured\n\n'.green);

      console.log('Please login to continue setup.'.bold);
      return coronerLogin(argv, config, coronerSetupStart);
    }
  });
}

function userUsage(error_str) {
  if (typeof error_str === 'string')
    err(error_str + '\n');
  console.log("Usage: morgue user reset [options]".error);
  console.log("Valid options:.error");
  console.log("  --password=P   Specify password to use for reset.".error);
  console.log("  --universe=U   Specify universe scope.".error);
  console.log("  --user=USER    Specify user to reset password for".error);
  process.exit(1);
}

function userReset(argv, config) {
  var ctx = {
    user: argv.user,
    password: argv.password,
    coroner: coronerClientArgv(config, argv),
  };
  var prompts = [];
  var tasks = [];

  ctx.bpg = coronerBpgSetup(ctx.coroner, argv),
  ctx.model = ctx.bpg.get();

  /* If no universe specified, use the first one. */
  ctx.universe = argv.universe;
  if (!ctx.universe && config && config.config && config.config.universes)
    ctx.universe = Object.keys(config.config.universes)[0];
  if (!ctx.universe) {
    coronerUsage("No universes.");
  }

  /* Find the universe with the specified name. */
  for (var i = 0; i < ctx.model.universe.length; i++) {
    if (ctx.model.universe[i].get("name") === ctx.universe) {
      ctx.univ_obj = ctx.model.universe[i];
      break;
    }
  }
  if (!ctx.univ_obj) {
    userUsage("Must specify known universe.");
  }

  if (!ctx.user) {
    prompts.push({name: "username", message: "User", required: true});
  }
  if (!ctx.password) {
    prompts.push({name: "password", message: "Password", replace: "*",
      hidden: true, required: true});
  }
  if (prompts.length > 0) {
    tasks.push(prompt_for(prompts));
    tasks.push((result) => {
      if (result.username)
        ctx.user = result.username;
      if (result.password)
        ctx.password = result.password;
    });
  }

  tasks.push(() => {
    /* Find the user with the specified name. */
    for (var i = 0; i < ctx.model.users.length; i++) {
      if (ctx.model.users[i].get("username") === ctx.user &&
          ctx.model.users[i].get("universe") === ctx.univ_obj.get("id")) {
        ctx.user_obj = ctx.model.users[i];
        break;
      }
    }
    if (!ctx.user_obj) {
      return Promise.reject("Must specify valid user.");
    }

    try {
      ctx.bpg.modify(ctx.user_obj, {password: BPG.blobText(ctx.password)});
      ctx.bpg.commit();
      console.log("User successfully modified.".success);
    } catch(e) {
      return Promise.reject(e);
    }
  });

  sequence(tasks).catch((e) => {
    console.error(e.toString().error);
    process.exit(1);
  });
}

function coronerUser(argv, config) {
  argv._.shift();
  if (argv._.length === 0) {
    userUsage();
  }

  if (argv._[0] !== "reset") {
    userUsage("Only the reset subcommand is supported.");
  }

  argv._.shift();
  userReset(argv, config);
}

function dump_obj(o)
{
  console.log(require('util').inspect(o, {showHidden: false, depth: null}));
}

function _coronerMerge(argv, config, action) {
  abortIfNotLoggedIn(config);
  if (argv._.length === 0) {
    userUsage();
  }
  const coroner = coronerClientArgv(config, argv);

  if (argv._.length < 2) {
    return usage("Missing project, universe arguments");
  }
  const p = coronerParams(argv, config);
  let fingerprints = argv._;

  fingerprints.splice(0,2);
  const query = {
    actions: {
      fingerprint: [
	{
	  type: action,
	  arguments: fingerprints
	}
      ]
    }
  };

  dump_obj(query);

  coroner.query(p.universe, p.project, query, function(err, result) {
    if (err) {
      errx(err.message);
    }
    console.log('Success.'.success);
  });
}

function coronerMerge(argv, config) {
  return _coronerMerge(argv, config, 'merge');
}

function coronerUnmerge(argv, config) {
  return _coronerMerge(argv, config, 'unmerge');
}

/**
 * @brief Implements the logout command.
 */
function coronerLogout(argv, config) {
  abortIfNotLoggedIn(config);
  var coroner = coronerClientArgv(config, argv);

  coroner.http_get('/api/logout', { token: argv.token || coroner.config.token },
    null, function(error, result) {
      if (error)
        errx(error + '');

      console.log('Logged out.'.blue);
  });
}

/**
 * @brief Implements the limit command.
 */
function coronerLimit(argv, config) {
  var options = null;
  var project, universe, pid, un, target;

  abortIfNotLoggedIn(config);
  var coroner = coronerClientArgv(config, argv);

  universe = argv.universe;
  if (!universe)
    universe = Object.keys(config.config.universes)[0];

  /* The sub-command. */
  var action = argv._[1];

  if (action == 'list') {
    coroner.http_get('/api/limits', {token: coroner.config.token}, null, function(error, result) {
      if (error)
        errx(error + '');

      var rp = JSON.parse(result.bodyData);

      for (var uni in rp) {
        var st = printf("%3d %16s limit=%d,counter=%d,rejected=%d",
            rp[uni].id, uni.bold,
            rp[uni].submissions.limit,
            rp[uni].submissions.counter,
            rp[uni].submissions.rejected);

        console.log(st);
      }

      return;
    });
  } else {
    var bpg = coronerBpgSetup(coroner, argv);
    var model = bpg.get();

    /* Find the universe with the specified name. */
    for (var i = 0; i < model.universe.length; i++) {
      if (model.universe[i].get('name') === universe) {
        un = target = model.universe[i];
      }
    }

    if (!un)
      errx('universe not found');

    if (action === 'delete') {
      var id = argv._[2];
      var limit;

      if (!id)
        errx('Usage: morgue limit delete <id>');

      for (var i = 0; i < model.limits.length; i++) {
        if (model.limits[i].get('universe') === un.get('id')) {
          limit = model.limits[i];
        }
      }

      if (!limit)
        errx('Limit not found.');

      console.log(('Deleting limit [' +
          limit.get('universe') + ']...').yellow);
      bpg.delete(limit);
      bpg.commit();
      return;
    }

    if (action === 'create') {
      var definition = {};

      if (!un)
        errx('Must specify a universe');

      if (!argv.submissions)
        errx('--submissions must be specified');

      var limit = bpg.new('limits');
      limit.set('universe', un.get('id'));

      definition.submissions = {
        'period' : 'month',
        'day' : 1,
        'limit' : [argv.submissions, argv.submissions]
      };
      limit.set('definition', JSON.stringify(definition));

      limit.set('metadata', '{}');
      if (argv.metadata)
        limit.set('metadata', argv.metadata);

      bpg.create(limit);

      try {
        bpg.commit();
      } catch (e) {
        errx(e + '');
      }

      console.log('Limit successfully created.'.blue);
      return;
    }

    errx('Unknown subcommand.');
  }
}

function tenantURL(config, tn) {
  var ix = config.endpoint.indexOf('.');
  var s = [config.endpoint.substr(0, ix), config.endpoint.substr(ix)];

  return 'https://' + tn + s[1];
}

function coronerInvite(argv, config) {
  var options = null;

  abortIfNotLoggedIn(config);
  var coroner = coronerClientArgv(config, argv);

  var usageText =
      'Usage: morgue invite <create | list | resend>\n' +
      '  create <username> <email>\n' +
      '    --role=<"guest" | "member" | "admin">\n' +
      '    --metadata=<metadata>\n' +
      '    --tenant=<tenant name>\n' +
      '    --method=<password | saml | pam>\n' +
      '  delete <token>\n' +
      '  resend <token>';

  if (argv.h || argv.help) {
    console.log(usageText);
    return;
  }

  var universe = argv.universe;
  if (!universe)
    universe = Object.keys(config.config.universes)[0];

  var bpg = coronerBpgSetup(coroner, argv);
  var model = bpg.get();

  var action = argv._[1];
  if (!action)
    errx(usageText);

  if (action === 'list') {
    console.log(printf("%6s %20s %8s %8s %30s %s",
      "Tenant", "Username", "Method", "Role", "Email", "Token"));

    for (var i = 0; i < model.signup_pending.length; i++) {
      var token = model.signup_pending[i].get('token');
      var username = model.signup_pending[i].get('username');
      var email = model.signup_pending[i].get('email');
      var method = model.signup_pending[i].get('method');
      var role = model.signup_pending[i].get('role');
      var sp_universe = model.signup_pending[i].get('universe');

      console.log(printf("%6d %20s %8s %8s %30s %s",
        sp_universe, username, method, role, email, token.substr(0, 12) + '...'));
    }

    return;
  } else if (action === 'delete') {
    var token = argv._[2];
    var matchToken;

    if (!token)
      errx('Usage: morgue invite delete <token substring>');

    for (var i = 0; i < model.signup_pending.length; i++) {
      if ((model.signup_pending[i].get('token')).indexOf(token) > -1) {
        if (matchToken)
          errx('supplied token is ambiguous.');

        matchToken = model.signup_pending[i];
      }
    }

    if (!matchToken)
      errx('invitation not found.');

    bpg.delete(matchToken);
    try {
      bpg.commit();
    } catch (e) {
      errx(e + '');
    }

    console.log('Invitation successfully deleted.'.blue);
    return;
  } else if (action === 'create') {
    var username = argv._[2];
    var email = argv._[3];
    var metadata = argv.metadata ? argv.metadata : ' ';
    var role = argv.role ? argv.role : 'member';
    var method = argv.method ? argv.method : 'password';
    var tenant = argv.tenant ? argv.tenant : universe;
    var un;

    if (!tenant || !username || !email || !metadata || !role || !method)
      errx(usageText);

    /* First, validate that a universe with the specified name exists. */
    for (var i = 0; i < model.universe.length; i++) {
      if (model.universe[i].get('name') === tenant) {
        un = model.universe[i];
        break;
      }
    }

    if (!un)
      errx('failed to find tenant ' + tenant + '.');

    var signup = bpg.new('signup_pending');
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

    console.log(('Invitation successfully created for ' + email).blue);

    process.stderr.write('Sending e-mail...');
    coroner.endpoint = tenantURL(config, un.get('name'));
    coroner.post('/api/signup', { universe: un.get('name') }, {
      "action" : "resend",
      "form" : {
        "username" : username
      }
    }, null, function(e, r) {
      if (e)
        errx(e);

      if (r.status !== 'ok')
        errx(r.message);

      process.stderr.write('done\n');
      return;
    });
  } else {
    errx(usageText);
  }
}

function coronerSession(argv, config) {
  var options = null;
  var universe;

  if (!argv.endpoint && !argv.universe)
    abortIfNotLoggedIn(config);

  var coroner;

  if (argv.endpoint) {
    config.config = coroner;
    config.endpoint = argv.endpoint;
    coroner = coronerClient(config, true, !!argv.debug, argv._[1], argv.timeout);
  } else {
    coroner = coronerClientArgv(config, argv);
  }

  var usageText =
      'Usage: morgue session <list | set | unset>\n' +
      '\n' +
      '   list : List active sessions.\n'
      '    set : Set resource override values.\n'
      '  unset : Unset resource override values.\n'
      ;

  if (argv.h || argv.help) {
    console.log(usageText);
    return;
  }

  universe = argv.universe;
  if (!universe) {
    if (argv.endpoint)
      errx('--universe= must be specified');

    universe = Object.keys(config.config.universes)[0];
  }

  /* The sub-command. */
  var action = argv._[1];
  var qs = { token: argv.token || coroner.config.token };

  if (action === 'list') {
    if (argv.g)
      qs.scope = 'global';
    if (argv.u)
      qs.scope = 'user';
    if (argv.s)
      qs.scope = 'session';

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

    coroner.http_get('/api/session', qs, null, function(error, result) {
      if (error)
        errx(error + '');

      var rp = JSON.parse(result.bodyData);

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
      var universe_id, owner;
      var bpg = coronerBpgSetup(coroner, argv);

      process.stderr.write('Persisting...'.blue);

      universe_id = config.config.universe.id;
      owner = config.config.user.uid;

      var model = bpg.get();

      for (var key in resources) {
        var ro = bpg.new('resource_override');
        var previous;

        if (argv.persist === 'universe') {
          ro.set('uid', 0);
        } else {
          ro.set('uid', owner);
          if (argv.uid)
            ro.set('uid', argv.uid);
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
            if (model.resource_override[i].get("universe") === universe_id &&
                model.resource_override[i].get("uid") == ro.get("uid")) {
              previous = model.resource_override[i];
              break;
            }
          }
        }

        if (previous) {
          bpg.modify(model.resource_override[i], {
            'value' : JSON.stringify(resources[key])
          });
        } else {
          bpg.create(ro);
        }

        try {
          bpg.commit();
        } catch (error) {
          errx(error + '');
        }

        process.stderr.write('done\n'.blue);
      }

      return;
    }

    coroner.post("/api/session", qs, {
      'action' : 'set',
      'form' : {
        'resources' : resources
      }
    }, null, function(e, r) {
      if (e)
        errx(e + '');

      if (r.status === 'ok') {
        console.log(JSON.stringify(r.form,null,2));
        console.log('\nSuccess.'.blue);
      } else {
        errx(r);
      }

      return;
    });
  } else if (action === 'unset') {
    var resources = argv._.slice(2, argv._.length);

    coroner.post("/api/session", qs, {
      'action' : 'unset',
      'form' : {
        'resources' : resources
      }
    }, null, function(e, r) {
      if (e)
        errx(e + '');

      if (r.status === 'ok') {
        console.log(JSON.stringify(r.form,null,2));
        console.log('\nSuccess.'.blue);
      } else {
        errx(r);
      }

      return;
    });
  } else {
    errx('unknown sub-command, expecting set, unset or list');
  }
}

function coronerTenant(argv, config) {
  var options = null;
  var universe;

  abortIfNotLoggedIn(config);
  var coroner = coronerClientArgv(config, argv);

  var usageText =
      'Usage: morgue tenant <list | create | delete>\n' +
      '\n' +
      '  create <name>: Create a tenant with the specified name.\n' +
      '  delete <name>: Delete a tenant with the specified name.\n' +
      '           list: List all tenants on your instance.\n';

  if (argv.h || argv.help) {
    console.log(usageText);
    return;
  }

  universe = argv.universe;
  if (!universe)
    universe = Object.keys(config.config.universes)[0];

  /* The sub-command. */
  var action = argv._[1];

  var bpg = coronerBpgSetup(coroner, argv);
  var model = bpg.get();

  if (action === 'list') {
    console.log(printf("%4s %-20s %s", "ID", "Tenant", "URL"));

    for (var i = 0; i < model.universe.length; i++) {
      var id = model.universe[i].get('id');
      var name = model.universe[i].get('name');
      var url = tenantURL(config, name);

      console.log(printf("%4d %-20s %s", id, name, url));
    }

    return;
  }

  if (action === 'delete') {
    var name = argv._[2];

    if (!name)
      errx('Usage: morgue tenant delete <tenant name>');

    for (var i = 0; i < model.universe.length; i++) {
      if (model.universe[i].get('name') == name) {
        bpg.delete(model.universe[i], { cascade: true });
        try {
          bpg.commit();
        } catch (e) {
          errx(e + '');
        }

        console.log('Tenant successfully deleted.'.blue);
        return;
      }
    }

    errx('tenant not found.');
    return;
  }

  if (action === 'create') {
    var name = argv._[2];

    if (!name)
      errx('Usage: morgue tenant create <tenant name>');

    var universe = bpg.new('universe');
    universe.set('id', 0);
    universe.set('name', name);
    bpg.create(universe);

    try {
      bpg.commit();
    } catch (e) {
      errx(e + '');
    }

    console.log(('Tenant successfully created at ' +
      tenantURL(config, name)).blue);
    console.log('Wait a few minutes for propagation to complete.'.blue);
    return;
  }

  errx(usageText);
}

function coronerToken(argv, config) {
  var options = null;
  var project, universe, pid, un, target;

  abortIfNotLoggedIn(config);
  var coroner = coronerClientArgv(config, argv);

  universe = argv.universe;
  if (!universe)
    universe = Object.keys(config.config.universes)[0];

  project = argv.project;

  /* The sub-command. */
  var action = argv._[1];

  var bpg = coronerBpgSetup(coroner, argv);
  var model = bpg.get();

  /* Find the universe with the specified name. */
  for (var i = 0; i < model.universe.length; i++) {
    if (model.universe[i].get('name') === universe) {
      un = target = model.universe[i];
    }
  }

  var pm = {};

  for (var i = 0; i < model.project.length; i++) {
    pm[model.project[i].get('pid')] = model.project[i].get('name');

    if (model.project[i].get('name') === project &&
        model.project[i].get('universe') === un.get('id')) {
      pid = model.project[i].get('pid');
    }
  }

  if (action == 'list') {
    if (!model.api_token) {
      console.log('No API tokens found.'.blue);
      return;
    }

    model.api_token.sort(function(a, b) {
      var a_d = a.get('id');
      var b_d = b.get('id');

      return (a_d > b_d) - (a_d < b_d);
    });

    for (var i = 0; i < model.api_token.length; i++) {
      var token = model.api_token[i];
      var widgets;

      if (pid && token.get('project') != pid)
        continue;

      console.log(token.get('id').bold);
      console.log('  capabilities=' + token.get('capabilities') +
        ',project=' + pm[token.get('project')] + '(' +
        token.get('project') + '),owner=' + token.get('owner'));

      var metadata = token.get('metadata');
      if (metadata) {
        console.log('  metadata:');
        var jm = JSON.stringify(JSON.parse(metadata), null, 2);
        console.log(jm);
      }
    }

    for (var i = 0; i < model.token.length; i++) {
      var token = model.token[i];
      var widgets;

      if (pid && token.get('project') != pid)
        continue;

      console.log(token.get('id').bold);
      console.log('  capabilities=error:post' +
        ',project=' + pm[token.get('project')] + '(' +
        token.get('project') + '),owner=' + token.get('owner'));
    }

    return;
  }

  if (action === 'delete') {
    var id = argv._[2];
    var token;

    if (!id)
      errx('Usage: morgue token delete <id>');

    for (var i = 0; i < model.api_token.length; i++) {
      if (model.api_token[i].get('id').indexOf(id) >= 0) {
        if (token)
          errx(id + ' is an ambiguous identifier. Multiple matches.');

        token = model.api_token[i];
      }
    }

    if (!token)
      errx('Token not found.');

    console.log(('Deleting token [' +
        token.get('id') + ']...').yellow);
    bpg.delete(token);
    bpg.commit();
    return;
  }

  if (action === 'create') {
    var capabilities = '';

    if (!universe || !project)
      errx('Must specify a project or infer a universe');

    if (!argv.capability) {
      errx('Must specify a capability:\n' +
        '    error:post symbol:post query:post');
    }

    if (Array.isArray(argv.capability)) {
      capabilities = argv.capability.join(' ');
    } else {
      if (capabilities && capabilities.length > 0)
        capabilities += ' ';

      capabilities += argv.capability;
    }

    if (!capabilities || capabilities.length === 0)
      errx('Must specify a capability: error:post sym:post query:post');

    var api_token = bpg.new('api_token');
    api_token.set('id', '0000');
    api_token.set('project', pid);
    api_token.set('owner', config.config.uid);
    api_token.set('capabilities', capabilities);

    if (argv.metadata)
      api_token.set('metadata', argv.metadata);

    bpg.create(api_token);

    try {
      bpg.commit();
    } catch (e) {
      errx(e + '');
    }

    console.log('API token successfully created.'.blue);
  }
}

function coronerAudit(argv, config) {
  abortIfNotLoggedIn(config);
  var coroner = coronerClientArgv(config, argv);

  var universe = argv.universe;
  if (!universe)
    universe = Object.keys(config.config.universes)[0];

  var action = argv._[1];

  if (action === 'extract') {
    coroner.control2(universe, 'audit',
      {
        'action': 'extract'
      },
      function(error, rp) {
        if (error)
          errx(error);

        if (argv.json) {
          console.log(JSON.stringify(rp, null, 2));
        } else if (argv.table) {
          const tableFormat = {
            columns: {
              2: {
                'alignment': 'right'
              },
              3: {
                'alignment': 'right'
              }
            },
            drawHorizontalLine : function(i, s) {
              if (i === 0 || i === 1 || i === s)
                return true;
            }
          };
          var m = rp.response.log;
          var title = [
            'Time',
            'Tenant',
            'Username',
            'Component',
            'Result',
            'Message'
          ];
          var data = [title];

          for (let i = 0; i < m.length; i++) {
            var d = new Date(m[i].timestamp * 1000);
            var r;

            r = m[i].result;
            if (r === 0) {
              r = 'success'.green;
            } else {
              r = 'FAILURE'.red.bold;
            }

            m[i].message = m[i].message.replace(/[\x00-\x1F\x7F-\x9F]/g, "…").substring(0, 100);
            data.push([d.toLocaleString(),
              m[i].universe, m[i].username, m[i].subsystem,
              r, m[i].message]);
          }

          console.log(table(data, tableFormat));
        } else {
            var m = rp.response.log

            for (let i = 0; i < m.length; i++) {
                process.stdout.write(
                  printf("%23s %15s %7s %s %s %s\n",
                    "[" + (new Date(m[i].timestamp * 1000)).toLocaleString() + "]",
                    m[i].subsystem, m[i].result === 0 ? 'success' : 'FAILURE',
                    m[i].universe, m[i].username, m[i].message)
                );
            }
        }
      });
  } else {
    return usage("Unknown sub-command. Must be extract.");
  }

  return;
}

function coronerLog(argv, config) {
  abortIfNotLoggedIn(config);
  var coroner = coronerClientArgv(config, argv);

  var universe = argv.universe;
  if (!universe)
    universe = Object.keys(config.config.universes)[0];

  var action = argv._[1];

  if (action === 'list') {
    coroner.control2(universe, 'shml',
      {
        'action': 'list'
      },
      function(error, rp) {
        if (error)
          errx(error);

        console.log(JSON.stringify(rp.response.logs, null, 2));
      });
  } else if (action === 'deactivate') {
    coroner.control2(universe, 'shml',
      {
        'action': 'deactivate',
        'form': {
          'name' : argv._[2]
        }
      },
      function(error, rp) {
        if (error)
          errx(error);

        console.log((argv._[2] + ' is deactivated.').success);
    });
  } else if (action === 'activate') {
    coroner.control2(universe, 'shml',
      {
        'action': 'activate',
        'form': {
          'name' : argv._[2]
        }
      },
      function(error, rp) {
        if (error)
          errx(error);

        console.log((argv._[2] + ' is activated.').success);
    });
  } else if (action === 'extract') {
    var q = {
        'action': 'extract',
        'form': {
          'name' : argv._[2]
        }
    };

    if (argv.universe)
      q.form.universe = argv.universe;

    coroner.control2(universe, 'shml', q,
      function(error, rp) {
        if (error)
          errx(error);

        if (argv.json) {
          console.log(JSON.stringify(rp, null, 2));
        } else if (argv.table) {
          for (let log in rp.response) {
            const tableFormat = {
              columns: {
                1: {
                  'alignment': 'right'
                },
                2: {
                  'alignment': 'right'
                }
              },
              drawHorizontalLine : function(i, s) {
                if (i === 0 || i === 1 || i === s)
                  return true;
              }
            };
            var m = rp.response[log];
            var title = [
              'Date',
              'Tenant',
              'Result',
              'Message'
            ];
            var data = [title];

            for (let i = 0; i < m.length; i++) {
              var d = new Date(m[i].timestamp * 1000);
              var r;

              r = m[i].result;
              if (r === 'success') {
                r = r.green;
              } else if (r == 'failure') {
                r = r.red;
              }

              m[i].message = m[i].message.replace(/[\x00-\x1F\x7F-\x9F]/g, "…").substring(0, 100);
              data.push([d.toLocaleString(),
                m[i].universe,
                r, m[i].message]);
            }

            console.log(log.bold);
            console.log(table(data, tableFormat));
          }
        } else {
          for (let log in rp.response) {
            var m = rp.response[log];

            for (let i = 0; i < m.length; i++) {
              process.stdout.write((new Date(m[i].timestamp * 1000)).toISOString() + " ");
              if (m[i].message[m[i].message.length - 1] === '\n') {
                process.stdout.write(m[i].message);
              } else {
                console.log(m[i].message);
              }
            }
          }
        }
      });
  } else {
    return usage("Unknown sub-command. Must be list or extract.");
  }

  return;
}

function coronerLatency(argv, config) {
  abortIfNotLoggedIn(config);
  var coroner = coronerClientArgv(config, argv);

  var universe = argv.universe;
  if (!universe)
    universe = Object.keys(config.config.universes)[0];

  var action = argv._[1];

  if (action === 'list') {
    coroner.control2(universe, 'histogram',
      {
        'action': 'list'
      },
      function(error, rp) {
        if (error)
          errx(error);

        var hs = rp.response.histograms;
        for (var i = 0; i < hs.length; i++) {
          if (argv._[2] && hs[i].name.match(argv._[2]) === null)
            continue;

          var l = printf("%3d [%8s] ", i + 1, hs[i].active ? "active" : "inactive" ) +
              hs[i].name;

          if (hs[i].active === true) {
            l = l.bold + " [" + hs[i].buffer[0] + ", " + hs[i].buffer[1] + "]";
          }

          console.log(l);
        }
        return;
    });
  } else if (action === 'activate') {
    var samples = 4096;

    if (argv.samples)
      samples = argv.samples;

    coroner.control2(universe, 'histogram',
      {
        'action': 'activate',
        'form': {
          'name' : argv._[2],
          'samples' : samples
        }
      },
      function(error, rp) {
        var ji = 0;

        if (error)
          errx(error);

        var hs = rp.response.histograms;
        for (var hi in hs) {
          if (hs[hi].status === 'error') {
            console.log(printf("%3d %s has not been activated (%s)",
                ++ji, hi, hs[hi].message).error);
          } else {
            console.log(printf("%3d %s has been activated.",
                ++ji, hi.success));
          }
        }

        if (ji === 0) {
          console.error('No histograms activated.'.error);
          process.exit(1);
        }

        return;
    });
  } else if (action === 'deactivate') {
    coroner.control2(universe, 'histogram',
      {
        'action': 'deactivate',
        'form': {
          'name' : argv._[2]
        }
      },
      function(error, rp) {
        var ji = 0;

        if (error)
          errx(error);

        var hs = rp.response.histograms;
        for (var hi in hs) {
          if (hs[hi].status === 'error') {
            console.log(printf("%3d %s has not been activated (%s)",
                ++ji, hi, hs[hi].message).error);
          } else {
            console.log(printf("%3d %s has been deactivated.",
                ++ji, hi.success));
          }
        }

        if (ji === 0) {
          console.error('No histograms deactivated.'.error);
          process.exit(1);
        }

        return;
    });
  } else if (action === 'extract') {
    coroner.control2(universe, 'histogram',
      {
        'action': 'extract',
        'form': {
          'name' : argv._[2]
        }
      },
      function(error, rp) {
        var ji = 0;

        if (error)
          errx(error);

        var hs = rp.response.histograms;

        if (argv.raw) {
          for (var i in hs) {
            for (var ji = 0; ji < hs[i].values.length; ji++)
              console.log(hs[i].values[ji]);
          }
        } else {
          console.log(JSON.stringify(hs,null,2));
        }
        return;
    });
  }
}

function coronerReport(argv, config) {
  var options = null;
  var project, universe, pid, un, target;

  abortIfNotLoggedIn(config);
  var coroner = coronerClientArgv(config, argv);

  universe = argv.universe;
  if (!universe)
    universe = Object.keys(config.config.universes)[0];

  project = argv.project;

  /* The sub-command. */
  var action = argv._[1];

  var bpg = coronerBpgSetup(coroner, argv);
  var model = bpg.get();

  /* Find the universe with the specified name. */
  for (var i = 0; i < model.universe.length; i++) {
    if (model.universe[i].get('name') === universe) {
      un = target = model.universe[i];
    }
  }

  for (var i = 0; i < model.project.length; i++) {
    if (model.project[i].get('name') === project &&
        model.project[i].get('universe') === un.get('id')) {
      pid = model.project[i].get('pid');
      break;
    }
  }

  if (action == 'list') {
    /* Print all report objects. */
    if (!model.report) {
      console.log('No scheduled reports found.'.blue);
      return;
    }

    model.report.sort(function(a, b) {
      var a_d = a.get('id');
      var b_d = b.get('id');

      return (a_d > b_d) - (a_d < b_d);
    });

    for (var i = 0; i < model.report.length; i++) {
      var report = model.report[i];
      var widgets;

      if (pid && report.get('project') != pid)
        continue;

      try {
        widgets = JSON.stringify(JSON.parse(model.report[i].get('widgets')));
      } catch (error) {
        widgets = 'invalid: ' + model.report[i].get('widgets');
      }

      console.log(('[' + printf("%2d", report.get('id')) + '] ' +
          report.get('title')).bold);

      console.log('Recipients: ' + report.get('rcpt'));
      console.log('Period: ' + report.get('period'));
      console.log('Day: ' + report.get('day'));
      console.log('Hour: ' + report.get('hour'));
      console.log('Timezone: ' + report.get('timezone'));
      console.log('Widgets: ' + widgets);
      console.log('');
    }

    return;
  }

  if (action === 'delete') {
    var id = argv._[2];

    if (!id)
      errx('Usage: morgue report delete <id>');

    if (!universe || !project)
      errx('Must specify a project or infer a universe');

    for (var i = 0; i < model.report.length; i++) {
      if (model.report[i].get('id') == id) {
        console.log(('Deleting report [' +
            model.report[i].get('title') + ']...').yellow);
        bpg.delete(model.report[i]);
        bpg.commit();
        return;
      }
    }

    errx('Report not found');
  }

  if (action === 'send') {
    var id = argv._[2];
    var rcpt = argv._[3];

    if (!id || !rcpt)
      errx('Usage: morgue report send <id> <e-mail>');

    coroner.reportSend(p.universe, p.project,
      {
        'action': 'send',
        'form': {
          'id': id,
          'rcpt' : rcpt
        }
      },
      function(error, rp) {
        if (error)
          errx(error);

        console.log('Report scheduled for immediate sending.'.blue);
        return;
    });
  }

  if (action === 'create') {
    var title = argv.title;
    var day = argv.day;
    var period = argv.period;
    var timezone = argv.timezone;
    var hour = argv.hour;
    var histogram = argv.histogram;
    var widgets = {};
    var limit = argv.limit;
    var aq = argvQuery(argv);
    var rcpt = '';
    var include_users = false;

    if (!universe || !project)
      errx('Must specify a project or infer a universe');

    if (!limit)
      limit = 5;

    if (!argv.rcpt)
      errx('must provide a recipient list with --rcpt');

    if (Array.isArray(argv.rcpt)) {
      rcpt = argv.rcpt.join(' ');
    } else {
      rcpt += argv.rcpt;
    }

    widgets.top = [];
    widgets.top[0] = { attributes : [] };

    if (Array.isArray(argv.histogram)) {
      for (var i = 0; i < argv.histogram.length; i++) {
        widgets.top[0].attributes.push(argv.histogram[i]);
      }
    } else {
        widgets.top[0].attributes.push(argv.histogram);
    }

    widgets.feed = {};
    widgets.feed.limit = limit;

    if (aq.query && aq.query.filter) {
      /* Don't filter on timestamp. */
      for (var i = 0; i < aq.query.filter.length; i++)
        delete(aq.query.filter[i].timestamp);

      widgets.filter = aq.query.filter;
    }

    if (!title)
      errx('must provide a report title with --title');

    if (!period) {
      console.log('Warning: no period specified, defaulting to weekly'.yellow);
      period = 'week';
    }

    if (!timezone) {
      timezone = moment_tz.tz.guess();
      console.log(('Warning: no timezone specified, defaulting to ' + timezone).yellow);
    }

    if (!hour) {
      console.log('Warning: no hour specified, defaulting to 9AM'.yellow);
      hour = 9;
    }

    if (!day) {
      day = 1;

      if (period !== 'day')
        console.log('Warning: no day specified, defaulting to Monday'.yellow);
    }

    if (argv['include-users'])
      include_users = true;

    var report = bpg.new('report');
    report.set('id', 0);
    report.set('project', pid);
    report.set('owner', config.config.uid);
    report.set('title', title);
    report.set('rcpt', rcpt); /* XXX */
    report.set('day', day);
    report.set('include_users', include_users ? 1 : 0);
    report.set('period', period);
    report.set('timezone', timezone);
    report.set('hour', hour);
    report.set('widgets', JSON.stringify(widgets));

    if (argv.metadata)
      report.set('metadata', argv.metadata);

    bpg.create(report);
    bpg.commit();

    console.log('Report successfully created.'.blue);
  }
}

function coronerControl(argv, config) {
  abortIfNotLoggedIn(config);
  var coroner = coronerClientArgv(config, argv);

  if (argv.smr) {
    coroner.control({ 'action': 'graceperiod' }, function(error, r) {
      if (error) {
        var message = error.message ? error.message : error;

        if (error === 'invalid token')
          message += ': try logging in again.';

        errx(message);
      }

      console.log('Success'.blue);
    });
  }
}

function mkdir_p(path) {
  try {
    fs.mkdirSync(path);
  } catch (e) {
    if (e.code !== 'EEXIST')
      throw e;
  }
}

function contentDisposition(http_result) {
  var cd = {};

  if (!http_result || typeof http_result !== 'object' ||
      !http_result.headers || typeof http_result.headers !== 'object') {
    return {};
  }

  http_result.headers['content-disposition'].split(";").forEach(function(k) {
    var i, v;

    k = k.trim();
    i = k.indexOf("=");
    v = true;

    if (i !== -1) {
      v = k.slice(i + 1);
      if (v[0] === v[v.length - 1])
        v = v.slice(1, v.length - 1);
      k = k.slice(0, i);
    }
    cd[k] = v;
  });

  return cd;
}

function getFname(http_result, outpath, outdir, n_objects, oid, resource) {
  var fname = outpath;
  var cd = contentDisposition(http_result);
  var bname;

  if (outdir || n_objects > 1) {
    bname = cd["filename"] || objToPath(oid, resource);
    if (outpath)
      fname = sprintf("%s/%s", outpath, bname);
    else
      fname = bname;
  } else if (fname === "-") {
    /* Treat as standard output. */
    fname = null;
  } else if (!fname) {
    /* Use path provided by content-disposition, if available. */
    fname = cd["filename"] || objToPath(oid, resource);
  }

  return fname;
}

function objectRangeOk(first, last) {
  var f = oidFromString(first);
  var l = oidFromString(last);

  if (f < 0)
    return err(sprintf("first(%s) is less than zero", first));
  if (l < 0)
    return err(sprintf("last(%s) is less than zero", last));
  if (f > l)
    return err(sprintf("first(%s) is greater than last(%s)", first, last));
  return true;
}

function pushFirstToLast(objects, first, last) {
  var f = oidFromString(first);
  var l = oidFromString(last);
  for (; f <= l; f++) {
    objects.push(oidToString(f));
  }
}

function argvPushObjectRanges(objects, argv) {
  var i, f, l, r;

  if (argv.first && argv.last) {
    if (Array.isArray(argv.first) ^ Array.isArray(argv.last))
      return err("first and last must be specified the same number of times");

    if (Array.isArray(argv.first) === true) {
      f = argv.first;
      l = argv.last;
    } else {
      f = [argv.first];
      l = [argv.last];
    }
    if (f.length !== l.length)
      return err("first and last must be specified the same number of times");

    for (i = 0; i < f.length; i++) {
      if (objectRangeOk(f, l) === false)
        return false;
      pushFirstToLast(objects, f[i], l[i]);
    }
  }

  if (argv.objrange) {
    r = argv.objrange;
    if (Array.isArray(argv.objrange) === false)
      r = [argv.objrange];

    for (i = 0; i < r.length; i++) {
      f, l = r[i].split(",");
      if (objectRangeOk(f, l) === false)
        return false;
      pushFirstToLast(objects, f, l);
    }
  }
  return true;
}

function outpathCheck(argv, n_objects) {
  var r, st;

  r = {};
  r.path = argv.output;
  if (!r.path && argv.o)
    r.path = argv.o;
  if (!r.path && argv.outdir)
    r.path = argv.outdir;
  r.has = typeof r.path === 'string' && r.path !== '-';

  if (!r.has)
    return r;

  try { st = fs.statSync(r.path); } catch (e) {}
  if (n_objects > 1) {
    if (!r.has) {
      errx('Must specify output directory for multiple objects.');
    }
    if (st && st.isDirectory() === false) {
      errx("Specified path exists and is not a directory.");
    }
    mkdir_p(r.path);
  } else if (n_objects === 1) {
    if (st && st.isFile() === false) {
      errx("Specified path exists and is not a file.");
    }
  } else {
    errx('Must specify at least one object to get.');
  }
  return r;
}

function coronerGet(argv, config) {
  var coroner, objects, out, p, params, tasks, st, success;

  abortIfNotLoggedIn(config);
  p = coronerParams(argv, config);
  objects = argv._.slice(2);
  tasks = [];
  coroner = coronerClientArgv(config, argv);
  argvPushObjectRanges(objects, argv);

  out = outpathCheck(argv, objects.length);
  params = {};
  if (argv.resource)
    params.resource = argv.resource;

  success = 0;
  objects.forEach(function(oid) {
    tasks.push(coroner.promise('http_fetch', p.universe, p.project, oid, params).then(function(hr) {
      var fname = getFname(hr, out.path, argv.outdir, objects.length, oid, params.resource);
      success++;
      if (fname) {
        fs.writeFileSync(fname, hr.bodyData);
        console.log(sprintf('Wrote %ld bytes to %s', hr.bodyData.length, fname).success);
      } else {
        process.stdout.write(hr.bodyData);
      }
    }).catch(function(e) {
      /* Allow ignoring (and printing) failures for testing purposes. */
      var fname = getFname(null, out.path, argv.outdir, objects.length, oid, params.resource);
      if (!argv.ignorefail || !out.has) {
        e.message = sprintf("%s: %s", fname, e.message);
        return Promise.reject(e);
      }
      err(sprintf('%s: %s', fname, e.message));
      return Promise.resolve();
    }));
  });

  Promise.all(tasks).then(function() {
    if (out.has)
      console.log(sprintf('Fetched %d of %d objects.', success, objects.length).success);
  }).catch(function(e) {
    if (argv.debug)
      console.log("e = ", e);
    errx(e.message);
  });
}

function coronerDescribe(argv, config) {
  abortIfNotLoggedIn(config);

  var options = {};
  var query = {};
  var p;
  var filter = null;

  var coroner = coronerClientArgv(config, argv);

  if (argv._.length < 2) {
    return usage("Missing universe, project arguments.");
  }

  if (argv.table) {
    options.table = argv.table;
  }

  p = coronerParams(argv, config);
  if (Array.isArray(argv._) === true && argv._[2])
    filter = argv._[2];

  coroner.describe(p.universe, p.project, options, function (error, result) {
    var cd, i;
    var ml = 0;

    if (error) {
      var message = 'Error: ';
      if (error.message) {
        message += error.message;
      } else {
        message += error;
      }

      if (error === 'invalid token')
        message = message + ': try logging in again.';

      errx(message);
    }

    cd = result.describe;
    for (i = 0; i < cd.length; i++) {
      let it = cd[i];

      if (it.name.length > ml)
        ml = it.name.length;
    }

    cd.sort(function(a, b) {
      if (a.state === "disabled" && b.state === "enabled")
        return 1;
      if (a.state === "enabled" && b.state === "disabled")
        return -1;

      if (a.custom === true && b.custom === false)
        return 1;
      if (a.custom === false && b.custom === true)
        return -1;

      return a.name.localeCompare(b.name);
    });

    if (argv.json) {
      console.log(JSON.stringify(cd, null, 2));
      return;
    }

    var unused = 0;
    for (i = 0; i < cd.length; i++) {
      let it = cd[i];
      var name, description;

      if (filter && it.name.match(filter) === null)
        continue;

      if (argv.u && it.custom === false)
        continue;

      if (!argv.a && it.statistics && it.statistics.used === false) {
        if (it.custom === false) {
          unused++;
          continue;
        }
      }

      name = printf("%*s", it.name, ml);
      if (!it.state || (it.state && it.state === 'enabled')) {
        if (it.custom === true) {
          if (it.statistics && it.statistics.used === false) {
            process.stdout.write((name + ': [unused] ' + it.description).grey);
          } else {
            process.stdout.write(name.blue + ': ' + it.description);
          }
        } else {
          if (it.statistics && it.statistics.used === false) {
            process.stdout.write((name + ': [unused] ' + it.description).grey);
          } else {
            process.stdout.write(name.yellow + ': ' + it.description);
          }
        }

        if (it.format)
          process.stdout.write(' ['.grey + it.format.grey + ']'.grey);

      } else if (it.state === 'disabled') {
        process.stdout.write((name + ': [disabled] (Seen at ' + new Date(it.seen * 1000) + " with a value of \"" + it.value + "\")").grey);
      }

      if (argv.l && it.filter) {
        var sp = Array(ml).join(" ");
        process.stdout.write('\n');

        process.stdout.write(printf("%*s: ", "Group", ml).grey + it.group + '\n');

        process.stdout.write(printf("%*s:\n", "Filter", ml).grey);
        for (var j = 0; j < it.filter.length; j++) {
          process.stdout.write(sp + it.filter[j] + '\n');
        }

        process.stdout.write(printf("%*s:\n", "Aggregate", ml).grey);
        for (var j = 0; j < it.filter.length; j++) {
          process.stdout.write(sp + it.filter[j] + '\n');
        }
      }
      process.stdout.write('\n');
    }

    if (unused > 0) {
      console.log(('\nHiding ' + unused + ' unused attributes (-a to list all).').bold.grey);
    }
  });
}

function genModifyRequest(to_set, to_clear) {
  var request = {};

  if (to_set) {
    request._set = {};
    if (Array.isArray(to_set) == true) {
      argv.set.forEach(function(o) {
        /* Make sure to handle the case where multiple =s are in the value. */
        var kvs = o.split('=');
        var key = kvs.shift();
        var val = kvs.join('=');
        if (key && val) {
          request._set[key] = val;
        } else {
          throw new Error("Invalid set '" + o + "', must be key=val form");
        }
      });
    } else {
      var [key, val] = to_set.split('=');
      if (key && val) {
        request._set[key] = val;
      } else {
        throw new Error("Invalid set '" + argv.set + "', must be key=val form");
      }
    }
  }

  if (to_clear) {
    request._clear = [];
    if (Array.isArray(to_clear) == false) {
      request._clear.push(to_clear);
    } else {
      to_clear.forEach(function(o) {
        request._clear.push(o);
      });
    }
  }

  return request;
}

function enqueueModify(submitter, argv, params, obj, req) {
  var u = params.universe;
  var p = params.project;

  return submitter.promise('modify_object', u, p, obj, null, req).then(function(r) {
    params.success++;
    if (argv.verbose) {
      console.log(sprintf("Queued modification for %s.", r.object).success);
    }
  }).catch(function(e) {
    if (!argv.ignorefail) {
      e.message = sprintf("%s: %s", obj, e.message);
      return Promise.reject(e);
    }
    err(sprintf("%s: %s", obj, e.message));
    return Promise.resolve();
  });
}

function coronerModify(argv, config) {
  abortIfNotLoggedIn(config);
  var submitter = coronerClientArgvSubmit(config, argv);
  var querier = coronerClientArgv(config, argv);
  var p = coronerParams(argv, config);
  var request = genModifyRequest(argv.set, argv.clear);
  var n_objects;
  var aq;
  var objects = [];
  var tasks = [];

  if (argv._.length < 2) {
    return usage("Missing universe, project arguments.");
  }

  if (Object.keys(request).length === 0) {
    return usage("Empty request, specify at least one set or clear.");
  }

  argvPushObjectRanges(objects, argv);
  for (var i = 2; i < argv._.length; i++)
    objects.push(argv._[i]);

  for (var i = 0; i < objects.length; i++) {
    tasks.push(enqueueModify(submitter, argv, p, objects[i], request));
  }
  p.success = 0;
  n_objects = tasks.length;

  var success_cb = function() {
    if (n_objects === 0) {
      errx('No matching objects.');
    }
    console.log(('Modification successfully queued for ' +
      p.success + ' of ' + n_objects + ' objects.').success);
  }

  if (n_objects === 0) {
    /* Object must be returned for query to be chainable. */
    if (!argv.select && !argv.template)
      argv.template = 'select';
    aq = argvQuery(argv);

    querier.promise('query', p.universe, p.project, aq.query).then(function(r) {
      var rp = new crdb.Response(r.response);

      rp = rp.unpack();
      rp['*'].forEach(function(o) {
        tasks.push(enqueueModify(submitter, argv, p, oidToString(o.object), request));
      });
      n_objects = tasks.length;
      return Promise.all(tasks);
    }).then(() => success_cb()).catch(std_failure_cb);
  } else {
    Promise.all(tasks).
      then(() => success_cb()).catch(std_failure_cb);
  }
}

function attachmentUsage(error_str) {
  if (typeof error_str === 'string')
    err(error_str + '\n');
  console.log("Usage: morgue attachment <add|get|list|delete> ...".error);
  console.log("");
  console.log("  morgue attachment add [options] <[universe/]project> <oid> <filename>".blue);
  console.log("");
  console.log("    --content-type=CT    Specify Content-Type for attachment.");
  console.log("                         The server may auto-detect this.");
  console.log("    --attachment-name=N  Use this name for the attachment name.");
  console.log("                         Default is the same as the filename.");
  console.log("");
  console.log("  morgue attachment get [options] <[universe/]project> <oid>".blue);
  console.log("");
  console.log("    Must specify one of:");
  console.log("    --attachment-id=ID   Attachment ID to delete.");
  console.log("    --attachment-name=N  Attachment name to delete.");
  console.log("    --attachment-inline  Attachment is inline.");
  console.log("");
  console.log("  morgue attachment list [options] <[universe/]project> <oid>".blue);
  console.log("");
  console.log("  morgue attachment delete [options] <[universe/]project <oid>".blue);
  console.log("");
  console.log("    Must specify one of:");
  console.log("    --attachment-id=ID   Attachment ID to delete.");
  console.log("    --attachment-name=N  Attachment name to delete.");
  process.exit(1);
}

function attachmentAdd(argv, config, params) {
  var body, coroner, fname, name, object, p, u;
  var opts = {
    /* Data is user-provided, and must be passed through as is. */
    binary: true,
    /* Rely on automatic mime-type detection if not specified. */
    content_type: null,
  };

  if (!config.submissionEndpoint) {
    errx('No submission endpoint found.');
  }
  coroner = coronerClientArgvSubmit(config, argv);

  if (argv._.length < 2) {
    if (argv._.length < 1) {
      attachUsage('Must specify object ID to attach to.');
    } else {
      attachUsage('Must specify file name to attach.');
    }
  }

  object = argv._.shift();
  fname = argv._.shift();
  name = path.basename(argv.attachment_name || fname);
  body = fs.readFileSync(fname);

  if (argv.content_type) {
    opts.content_type = argv.content_type;
  }

  u = params.universe;
  p = params.project;
  coroner.promise('attach', u, p, object, name, null, opts, body).then((r) => {
    console.log(sprintf("Attached '%s' to object %s as id %s.",
      r.attachment_name, r.object, r.attachment_id).success);
  }).catch(std_failure_cb);
}

function attachmentGet(argv, config, params) {
  var coroner, oid, out, p, resource, u;

  if (argv._.length != 1)
    attachmentUsage("Must specify object id.");

  out = outpathCheck(argv, 1);
  if (argv["attachment-name"]) {
    params.attachment_name = argv["attachment-name"];
    resource = params.attachment_name;
  } else if (argv["attachment-id"]) {
    params.attachment_id = argv["attachment-id"];
    resource = "_attachment-" + params.attachment_id;
  } else {
    attachmentUsage("Must specify attachment by name or id.");
  }
  if (argv["attachment-inline"]) {
    params.attachment_inline = true;
  }

  coroner = coronerClientArgv(config, argv);
  oid = argv._[0];
  u = params.universe;
  p = params.project;
  coroner.promise('http_fetch', u, p, oid, params).then(function(hr) {
    var fname = getFname(hr, out.path, argv.outdir, 1, oid, resource);
    if (fname) {
      fs.writeFileSync(fname, hr.bodyData);
      console.log(sprintf('Wrote %ld bytes to %s', hr.bodyData.length, fname).success);
    } else {
      process.stdout.write(hr.bodyData);
    }
  }).catch(function(e) {
    var fname = getFname(null, out.path, argv.outdir, 1, oid, resource);
    err(sprintf("%s: %s", fname, e.message));
  });
}

function attachmentList(argv, config, params) {
  var coroner, object, p, u;

  if (argv._.length < 1) {
    attachmentUsage('Must specify object ID to attach to.');
  }

  coroner = coronerClientArgv(config, argv);
  object = argv._.shift();
  p = params.project;
  u = params.universe;
  coroner.promise('attachments', u, p, object, null).then((r) => {
    var jr = JSON.parse(r);
    if (jr.attachments.length === 0) {
      console.log(sprintf("No attachments for %s obj %s", p, object));
      return;
    }
    console.log(sprintf("%s obj %s attachments:", p, object));
    jr.attachments.forEach(function(a) {
      console.log(sprintf("  id %s name \"%s\" size %d type \"%s\"%s",
        a.id, a.name, a.size, a.content_type, a.inline ? " (inline)" : ""));
    });
  }).catch(std_failure_cb);
}

function attachmentDelete(argv, config, params) {
  var coroner, p, u;
  var delparams = {};
  var req = [{}];

  coroner = coronerClientArgv(config, argv);
  if (argv.sync) {
    delparams.sync = true;
    if (!argv.timeout) {
      /* Set longer 5 minute timeout in case of heavy load. */
      coroner.timeout = 300 * 1000;
    }
  }

  req[0].id = argv._.shift();
  if (argv["attachment-name"])
    req[0].attachment_name = argv["attachment-name"];
  else if (argv["attachment-id"])
    req[0].attachment_id = argv["attachment-id"];
  else
    attachmentUsage("Must specify attachment by name or id.");

  p = params.project;
  u = params.project;
  coroner.promise('delete_objects', u, p, req, delparams).
    then(std_success_cb).catch(std_failure_cb);
}

function coronerAttachment(argv, config) {
  abortIfNotLoggedIn(config);
  var fn, object, params, subcmd;
  var coroner = coronerClientArgv(config, argv);
  var subcmds = {
    add: attachmentAdd,
    list: attachmentList,
    get: attachmentGet,
    delete: attachmentDelete,
  };

  if (argv._.length < 3)
    attachmentUsage("Not enough arguments specified.");

  argv._.shift();
  /* Extract u/p at this point since they'll be in the correct position. */
  params = coronerParams(argv, config);
  subcmd = argv._.shift();
  fn = subcmds[subcmd];
  if (!fn)
    attachmentUsage("No such subcommand " + subcmd);

  if (typeof params.universe !== 'string' || typeof params.project !== 'string')
    attachmentUsage();

  argv._.shift();
  fn(argv, config, params);
}

function put_benchmark(coroner, argv, files, p) {
  var tasks = [];
  var samples = [];
  var objects = [];
  var concurrency = 1;
  var n_samples = 32;
  var submitted = 0;
  var success = 0;

  process.stderr.write('Warming up...'.blue + '\n');

  if (argv.samples)
    n_samples = parseInt(argv.samples);

  if (argv.concurrency)
    concurrency = parseInt(argv.concurrency);

  process.stderr.write('Injecting: '.yellow);
  var start = process.hrtime();

  var submit_cb = function(i) {
    var fi = i % files.length;
    /* A previous call completed the full run.  Resolve. */
    if (submitted === n_samples)
      return Promise.resolve();
    submitted++;
    var st = process.hrtime();

    if (argv.multipart) {
      return coroner.promise('put_form', files[fi].path, [], p).
        then((r) => success_cb(r, i, st)).catch((e) => failure_cb(files[fi].path, e, i, st));
    } else {
      return coroner.promise('put', files[fi].body, p, argv.compression).
        then((r) => success_cb(r, i, st)).catch((e) => failure_cb(files[fi].path, e, i, st));
    }
  }
  var success_cb = function(r, i, st) {
    samples.push(nsToUs(process.hrtime()) - st);
    process.stderr.write('.'.blue);
    success++;
    if (argv.printids)
      objects.push(r.object);
    return submit_cb(i);
  }
  var failure_cb = function(path, e, i, st) {
    samples.push(nsToUs(process.hrtime()) - st);
    err(sprintf("%s: %s", path, e));
    return submit_cb(i);
  }

  /*
   * Kick off the initial tasks for each "thread".  These will continue to
   * spawn new tasks until the total number of submits reaches n_samples.
   * Once that happens, the final .then() below will run.
   */
  for (var i = 0; i < concurrency; i++) {
    tasks.push(submit_cb(i));
  }

  Promise.all(tasks).then((r) => {
    var failed = n_samples - success;
    console.log('\n');
    printSamples(submitted, samples, start, process.hrtime(), concurrency);
    if (argv.printids)
      console.log(sprintf('Object IDs: %s', JSON.stringify(objects)).blue);
    if (failed === 0)
      return;
    errx(sprintf("%d of %d submissions failed.", failed, n_samples));
  }).catch((e) => {
    errx(e.message);
  });
}

function coronerPut(argv, config) {
  abortIfNotLoggedIn(config);
  const form = argv.form_data;
  var formats = { 'btt' : true, 'minidump' : true, 'json' : true, 'symbols' : true };
  var p;
  var supported_compression = {'gzip' : true, 'deflate' : true};
  var attachments = [];

  if (!config.submissionEndpoint) {
    errx('No submission endpoint found.');
  }

  if (!argv.format || !formats[argv.format]) {
    errx('Format must be one of btt, json, symbols or minidump');
  }

  if (argv.compression && !supported_compression[argv.compression]) {
    errx('Supported compression are gzip and deflate');
  }

  p = coronerParams(argv, config);
  p.format = argv.format;
  if (p.format === 'symbols' && argv.tag) {
    p.tag = argv.tag;
  }
  if (p.format === 'minidump') {
    if (argv.kv)
      p.kvs = argv.kv;
    if (argv.attachment) {
      /*
       * Attachment mode: This doesn't really make sense to do with multiple
       * objects in the same run, but it works.
       */
      attachments = argv.attachment;
      if (!Array.isArray(attachments))
        attachments = [attachments];
    }
  }

  if (argv.sync) {
    p.sync = true;
  }

  if (argv.reuse) {
    p.http_opts = { forever: true };
  }

  var files = [];

  /*
   * Obviously super inefficient, but this is primarily for testing
   * and benchmarking purposes.
   */
  for (var i = 2; i < argv._.length; i++) {
    try {
      var body = fs.readFileSync(argv._[i]);
    } catch (error) {
      errx('Failed to open file: ' + argv._[i]);
    }

    files.push({ path: argv._[i], body: body });
  }

  if (files.length === 0) {
    errx('One or more files must be specified.');
  }

  var coroner = coronerClientArgvSubmit(config, argv);

  var submitted = 0;
  var success = 0;
  var tasks = [];

  if (argv.benchmark) {
    return put_benchmark(coroner, argv, files, p);
  }

  var success_cb = function(r, path) {
    if (r.fingerprint) {
      console.log(sprintf("%s: Success: %s, fingerprint: %s.", path,
        r.unique ? "Unique" : "Not unique", r.fingerprint).success);
    } else {
      console.log(sprintf("%s: Success.", path).success);
    }
    success++;
  }
  var failure_cb = function(path, e) {
    var j;
    var errstr = sprintf("%s: %s", path, e.message);
    if (e.response_obj.body) {
      try {
        j = JSON.parse(e.response_obj.body);
        if (j && j.error && j.error.message)
          errstr += sprintf(" (error %d: %s)", j.error.code, j.error.message);
      } catch (e) {}
    }
    err(errstr);
  }
  for (var i = 0; i < files.length; i++) {
    var path = files[i].path;
    if (form || attachments.length > 0 || argv.multipart) {
      tasks.push(coroner.promise('put_form', path, attachments, p).
        then((r) => success_cb(r, path)).catch((e) => failure_cb(path, e)));
    } else {
      tasks.push(coroner.promise('put', files[i].body, p, argv.compression)
        .then((r) => success_cb(r, path)).catch((e) => failure_cb(path, e)));
    }
  }

  Promise.all(tasks).then((r) => {
    var failed = tasks.length - success;
    if (failed === 0) {
      console.log('Success.'.success);
      return;
    }
    errx(sprintf("%d of %d submissions failed.", failed, tasks.length));
  }).catch((e) => {
    errx(e.message);
  });
}

function samplingParams(coroner, action, argv, config) {
  var params = coronerParams(argv, config);
  params.action = action;
  if (argv.group)
    argv.fingerprint = argv.group;
  if (argv.fingerprint) {
    params.fingerprints = argv.fingerprint;
    if (!Array.isArray(params.fingerprints)) {
      params.fingerprints = [params.fingerprints];
    }
  }
  if (argv.universe) {
    params.universe = argv.universe;
  }
  if (argv.project) {
    var a = argv.project.split("/");

    params.project = a[0];
    if (a.length === 2) {
      params.universe = a[0];
      params.project = a[1];
    }
  }
  params.token = coroner.config.token;
  return params;
}

function samplingPost(coroner, params) {
  return coroner.promise('post', '/api/sampling', null, params, null);
}

function samplingBucketFor(buckets, count) {
  var b, i;
  var total = 0;

  for (i = 0; i < buckets.length; i++) {
    b = buckets[i];
    total += b.count;
    if (total > count)
      break;
  }
  if (i === buckets.length)
    return null;

  return b;
}

function strHashCode(str) {
  var hash = 0, i, chr;
  if (str.length === 0) return hash;
  for (i = 0; i < str.length; i++) {
    chr   = str.charCodeAt(i);
    hash  = ((hash << 5) - hash) + chr;
    hash |= 0; /* convert to 32-bit int */
  }
  return hash;
}

function samplingStatusProject(argv, config, universe, project) {
  var name = sprintf("%s/%s", universe.name, project.name);
  var top_line = "";
  var backoffs = project.backoffs;
  var buckets;
  var last;
  var next;
  var next_time;
  var now;
  var bucket;
  var group;
  var groups;
  var max_groups;
  var i;

  if (project.error) {
    console.log(sprintf("%s: %s", name, project.error).error);
    return;
  }

  if (!backoffs) {
    console.log(sprintf("%s: Sampling not configured.", name));
    return;
  }

  if (!backoffs.groups || backoffs.groups.length === 0) {
    console.log(sprintf("%s: No groups yet.", name));
    return;
  }

  if (argv.a || argv.all) {
    max_groups = -1;
  } else {
    max_groups = parseInt(argv["max-groups"]);
    if (isNaN(max_groups))
      max_groups = 16;
  }

  buckets = sprintf("reset interval %s, buckets:",
    secondsToTimespec(backoffs.reset_interval));
  backoffs.backoffs.forEach((bucket) => {
    buckets += sprintf(" %d/%s", bucket.count, secondsToTimespec(bucket.interval));
  });
  top_line = sprintf("%d groups tracking", backoffs.groups.length);
  if (backoffs.missing_symbols > 0) {
    top_line += sprintf(" (%d objects missing symbols, of which %d are private)",
      backoffs.missing_symbols, backoffs.private_missing_symbols);
  }

  if (argv.verbose && backoffs.accepts) {
    top_line += sprintf(" (accepts %d rejects %d misses %d failures %d)",
      backoffs.accepts, backoffs.rejects, backoffs.misses, backoffs.failures);
  }

  now = Math.round((new Date()).valueOf() / 1000);
  console.log(sprintf("%s:", name));
  console.log(sprintf("  %s", buckets));
  console.log(sprintf("  %s:", top_line));
  groups = backoffs.groups.sort((a, b) => {
    if (a.count !== b.count)
      return b.count - a.count;
    if (a.last_accept !== b.last_accept)
      return b.last_accept - a.last_accept;
    return strHashCode(a.id) - strHashCode(b.id);
  });

  for (i = 0; i < groups.length; i++) {
    if (max_groups === 0) {
      break;
    } else if (i === max_groups) {
      console.log(sprintf("    ... truncating %d groups ...",
        groups.length - max_groups));
      break;
    }

    group = groups[i];
    last = new Date(group.last_accept * 1000);
    bucket = samplingBucketFor(backoffs.backoffs, group.count);
    if (!bucket) {
      next = "after reset";
    } else {
      next_time = group.last_accept + bucket.interval;
      if (next_time < now) {
        next = "at any time";
      } else {
        next = sprintf("after %s", secondsToTimespec(next_time - now));
      }
    }
    console.log(sprintf("    \"%s\": %d objects, last accept %s, next %s",
      group.id ? group.id : "unknown", group.count, last.toString(), next));
  }
}

function samplingStatus(coroner, argv, config) {
  var params = samplingParams(coroner, 'status', argv, config);

  samplingPost(coroner, params).then((r) => {
    var first, last;

    if (r.universes) {
      if (r.universes.length === 0) {
        console.log("No groups yet.");
      } else {
        r.universes.forEach((universe) => {
          if (universe.projects.length === 0) {
            console.log(sprintf("%s: No groups yet.", universe.name));
          } else {
            universe.projects.forEach((project) => {
              samplingStatusProject(argv, config, universe, project);
            });
          }
        });
      }
    } else {
      errx("Sampling not configured.");
    }
  }).catch(std_failure_cb);
}

function samplingReset(coroner, argv, config) {
  var params = samplingParams(coroner, 'reset', argv, config);

  samplingPost(coroner, params).then(std_success_cb).catch(std_failure_cb);
}

function samplingUsage(str) {
  if (str)
    err(str + "\n");
  console.error("Usage: morgue sampling <status|reset> [options]");
  console.error("");
  console.error("Options for either status or reset:");
  console.error("  --fingerprint=group             Specify a fingerprint to apply to.");
  console.error("                                  Without this, applies to all.");
  console.error("  --project=[universe/]project    Specify a project to apply to.");
  console.error("                                  Without this, applies to all.");
  console.error("");
  console.error("Options for status only:");
  console.error("  --max-groups=N                  Specify max number of groups to display");
  console.error("                                  per project.  Default is 16.  0 displays");
  console.error("                                  no groups; < 0 displays all.");
  console.error("  -a, --all                       Display all groups.");
  process.exit(1);
}

/**
 * @brief Implements the sampling command.
 */
function coronerSampling(argv, config) {
  abortIfNotLoggedIn(config);
  var coroner;
  var fn;
  var subcmd;
  var subcmd_map = {
    status: samplingStatus,
    reset: samplingReset,
  };

  argv._.shift();
  if (argv._.length === 0) {
    return samplingUsage("No request specified.");
  }
  if (argv._.length >= 2) {
    return samplingUsage("No arguments accepted for this command.");
  }

  subcmd = argv._.shift();
  if (subcmd === "--help" || subcmd === "help")
    return samplingUsage();

  fn = subcmd_map[subcmd];
  if (fn) {
    coroner = coronerClientArgv(config, argv);
    return fn(coroner, argv, config);
  }

  samplingUsage("Invalid sampling subcommand '" + subcmd + "'.");
}

function serviceUsageFn(str) {
  if (str)
    err(str + "\n");
  console.error("Usage: morgue service <list|status>");
}

function serviceList(argv, config, opts) {
  opts.state.coroner.promise('svclayer', 'list', null, null)
    .then(std_json_cb).catch(std_failure_cb);
}

function serviceTokenCommand(argv, config, opts) {
  const p = {token: opts.state.coroner.config.token};
  opts.state.coroner.promise('svclayer', opts.state.subcmd, p, null)
    .then(std_json_cb).catch(std_failure_cb);
}

function coronerService(argv, config) {
  subcmdProcess(argv, config, {
    usageFn: serviceUsageFn,
    subcmds: {
      list: serviceList,
      status: serviceTokenCommand,
      rescan: serviceTokenCommand,
    },
  });
}

/**
 * @brief: Implements the symbol list command.
 */
function coronerSymbol(argv, config) {
  abortIfNotLoggedIn(config);

  const query = { 'form' : {} };
  var action = argv._[2];
  var filter;

  if (argv.tag) {
    if (Array.isArray(argv.tag)) {
      query.form.tags = argv.tag;
    } else {
      query.form.tags = [argv.tag];
    }
  }

  if (argv.filter) {
    filter = argv.filter;
  }

  var coroner = coronerClientArgv(config, argv);

  if (argv._.length < 2) {
    return usage("Missing project and universe arguments.");
  }

  var p = coronerParams(argv, config);

  if (action === 'status' || action == 'summary' || !action) {
    query.action = 'summary';
    action = 'summary';
  } else if (action === 'list') {
    query.action = 'symbols';
    query.form.values = [
      "debug_file",
      "debug_identifier",
      "archive_id",
      "file_size",
      "upload_time",
      "extract_time",
      "convert_time"
    ];
  } else if (action === 'archives') {
    query.action = 'archives';
  } else if (action === 'missing') {
    query.action = 'missing_symbols';

  } else {
    errx('Usage: morgue symbol <project> [archives | list | missing | summary]');
  }

  coroner.symfile(p.universe, p.project, query, function (err, result) {
    if (err) {
      errx(err.message);
    }

    var output = null;

    if (argv.debug)
      return;

    if (argv.json) {
      console.log(JSON.stringify(result));
      return;
    }

    if (argv.output)
      output = argv.output;
    if (argv.o)
      output = argv.o;

    if (output) {
      var json = JSON.stringify(result);

      fs.writeFileSync(output, json);
      return;
    }

    if (action === 'summary') {
      const tableFormat = {
        columns: {
          2: {
            'alignment': 'right'
          }
        }
      };
      var response = result.response.summary;
      var title = [
        'First Update',
        'Most Recent Update',
        'Count'
      ];
      var data = [title];

      if (response.archives && response.archives.count) {
        data[1] = [
          new Date(response.archives.first_updated_time * 1000),
          new Date(response.archives.last_updated_time * 1000),
          response.archives.count
        ];

        console.log('Archives'.bold);
        console.log(table(data, tableFormat));
      }

      if (response.symbols && response.symbols.count) {
        data[1] = [
          new Date(response.symbols.first_updated_time * 1000),
          new Date(response.symbols.last_updated_time * 1000),
          response.symbols.count
        ];

        console.log('Symbols'.bold);
        console.log(table(data, tableFormat));
      }

      if (response.missing_symbols && response.missing_symbols.count) {
        data[1] = [
          new Date(response.missing_symbols.first_crash_time * 1000),
          new Date(response.missing_symbols.last_crash_time * 1000),
          response.missing_symbols.count
        ];

        console.log('Missing Symbols'.bold);
        console.log(table(data, tableFormat));
      }

      return;
    }

    if (action === 'archives') {
      const tableFormat = {
        drawHorizontalLine: (index, size) => {
          return index === 0 || index === 1 || index === size - 1 || index === size;
        },
        columns: {
          2 : {
            'alignment' : 'right'
          },
          4 : {
            'alignment' : 'right'
          },
          5 : {
            'alignment' : 'right'
          },
          6 : {
            'alignment' : 'right'
          },
          7 : {
            'width' : 80,
            'wrapWord' : true
          }
        }
      };

      var response = result.response.archives;
      var title = [
        'A',
        'Upload Date',
        'Size',
        'Status',
        'Symbols',
        'Duplicates',
        'Invalid',
        'Errors'
      ];

      for (var i = 0; i < response.length; i++) {
        var files = response[i].files;
        var data = [title];

        files.sort(function(a, b) {
          return (a.upload_time > b.upload_time) - (b.upload_time > a.upload_time);
        });

        for (var j = 0; j < files.length; j++) {
          var file = files[j];
          var label = '--';
          var dt;

          if (!argv.a) {
            dt = ta.ago(file.upload_time * 1000);
          } else {
            dt = new Date(file.upload_time * 1000);
          }

          if (file.errors.length > 0) {
            label = file.errors.join('. ');
          }

          data.push([
            file.archive_id === 'ffffffffffffffff' ? '--' : file.archive_id,
            dt,
            Math.ceil(file.file_size / 1024) + 'KB',
            file.status,
            file.new_symbols,
            file.duplicate_symbols,
            file.invalid_symbols,
            label
          ]);
        }

        data.push(title);
        if (data.length > 2) {
          console.log('Tag: '.yellow + response[i].tag);
          console.log(table(data, tableFormat));
        }
      }
    }

    if (action === 'missing') {
      const tableFormat = {
        drawHorizontalLine: (index, size) => {
          return index === 0 || index === 1 || index === size - 1 || index === size;
        },
        columns: {
          0 : {
            'alignment' : 'right'
          }
        }
      };

      var response = result.response.archives;
      var title = [
        'First appearance',
        'Debug File',
        'Debug Identifier'
      ];

      {
        var files = result.response.missing_symbols;
        var data = [title];

        files.sort(function(a, b) {
          return (a.timestamp > b.timestamp) - (b.timestamp > a.timestamp);
        });

        for (var j = 0; j < files.length; j++) {
          var file = files[j];
          var dt;

          if (!argv.a) {
            dt = ta.ago(file.timestamp * 1000);
          } else {
            dt = new Date(file.timestamp * 1000);
          }

          data.push([dt, file.debug_file, file.debug_id]);
        }

        data.push(title);
      }

      console.log(table(data, tableFormat));
    }

    if (action === 'list') {
      const tableFormat = {
        drawHorizontalLine: (index, size) => {
          return index === 0 || index === 1 || index === size - 1 || index === size;
        },
        columns: {
          4 : {
            'alignment' : 'right'
          },
          5 : {
            'alignment' : 'right'
          },
          6 : {
            'alignment' : 'right'
          }
        }
      };

      var tags = result.response.symbols;
      var titlePrint = false;
      for (var i = 0; i < tags.length; i++) {
        var title = [
          'A',
          'Upload Date',
          'Debug File',
          'GUID',
          'Size',
          'Extraction',
          'Conversion'
        ];
        var data = [ title ];

        tags[i].files.sort(function(a, b) {
          return (a.upload_time > b.upload_time) - (b.upload_time > a.upload_time);
        });

        for (var j = 0; j < tags[i].files.length; j++) {
          var file = tags[i].files[j];
          var dt;

          if (filter) {
            var string = JSON.stringify(file);
            if (string.indexOf(filter) === -1)
              continue;
          }

          if (!argv.a) {
            dt = ta.ago(file.upload_time * 1000);
          } else {
            dt = new Date(file.upload_time * 1000);
          }

          data.push([
            file.archive_id === 'ffffffffffffffff' ? '--' : file.archive_id,
            dt,
            file.debug_file,
            file.debug_identifier,
            Math.ceil(file.file_size / 1024) + 'KB',
            file.extract_time > 0 ? (file.extract_time + 'ms') : '--',
            file.convert_time > 0 ? (file.convert_time + 'ms') : '--'
          ]);
        }

        data.push(title);

        if (data.length > 2) {
          console.log('Tag: '.yellow + tags[i].tag);
          console.log(table(data, tableFormat));
        }
      }
    }
  });
}

function coronerScrubber(argv, config) {
  var options = null;
  var project, universe, pid, un, target;

  abortIfNotLoggedIn(config);
  var coroner = coronerClientArgv(config, argv);

  var p = coronerParams(argv, config);

  /* The sub-command. */
  var action = argv._[2];

  if (action === undefined) {
    errx('Usage: morgue scrubber <[universe/]project> list | create | modify | delete');
  }
  universe = p.universe;
  project = p.project;

  var bpg = coronerBpgSetup(coroner, argv);
  var model = bpg.get();

  /* Find the universe with the specified name. */
  for (var i = 0; i < model.universe.length; i++) {
    if (model.universe[i].get('name') === universe) {
      un = target = model.universe[i];
    }
  }

  for (var i = 0; i < model.project.length; i++) {
    if (model.project[i].get('name') === project &&
        model.project[i].get('universe') === un.get('id')) {
      pid = model.project[i].get('pid');
      break;
    }
  }

  if (!pid)
    errx('project not found');

  if (action == 'list') {
    /* Print all scrubbers. */

    if (!model.scrubber) {
      console.log('No scrubber found.'.blue);
      return;
    }

    for (var i = 0; i < model.scrubber.length; i++) {
      var scrubber = model.scrubber[i];
      var widgets;

      if (scrubber.get('project') != pid)
        continue;

      console.log(('[' + scrubber.get('id') + '] ' +
          scrubber.get('name')).bold);

      console.log('        regexp: ' + scrubber.get('regexp'));
      console.log('       builtin: ' + scrubber.get('builtin'));
      console.log('        format: ' + scrubber.get('format'));
      console.log('        target: ' + scrubber.get('target'));
      console.log('        enable: ' + scrubber.get('enable'));
    }

    return;
  }

  if (action === 'delete') {
    var id = argv._[3];

    if (!id)
      errx('Usage: morgue scrubber <[universe/]project> delete <id>');

    for (var i = 0; i < model.scrubber.length; i++) {
      if (model.scrubber[i].get('id') == id) {
        console.log(('Deleting scrubber [' +
            model.scrubber[i].get('name') + ']...').yellow);
        bpg.delete(model.scrubber[i]);
        try {
          bpg.commit();
        } catch (em) {
          errx(em);
        }
        return;
      }
    }

    errx('Scrubber not found');
  }

  if (action === 'create') {
    var name = argv.name;
    var regexp = argv.regexp;
    var builtin = argv.builtin;
    var format = argv.format;
    var target = argv.target;
    var enable = argv.enable;

    if (!builtin || builtin !== 'all') {
      if (!regexp && !builtin)
        errx('must provide either regexp or builtin');
      if (regexp && builtin)
        errx('either regexp or builtin is provided but not both');

      if (!name)
        errx('must provide a scrubber name with --name');

      if (enable === undefined)
        errx('must provide a scrubber enable with --enable');
    }

    if (regexp === undefined)
      regexp = null;
    if (builtin === undefined)
      builtin = null;
    if (format === undefined)
      format = 'all';
    if (target === undefined)
      target = 'all';

    if (builtin === 'all') {
      var builtin_scrubbers = [
        { name: 'social_security', builtin: 'ssn' },
        { name: 'credit_card', builtin: 'ccn' },
        { name: 'encryption_key', builtin: 'key' },
        { name: 'environment_variable', builtin: 'env' },
      ];

      if (enable === undefined)
        enable = 1;
      for (var i = 0; i < builtin_scrubbers.length; i++) {
        var scrubber = bpg.new('scrubber');

        scrubber.set('id', 0);
        scrubber.set('project', pid);
        scrubber.set('name', builtin_scrubbers[i].name);
        scrubber.set('regexp', null);
        scrubber.set('builtin', builtin_scrubbers[i].builtin);
        scrubber.set('format', format);
        scrubber.set('target', target);
        scrubber.set('enable', enable);

        bpg.create(scrubber);
        try {
          bpg.commit();
        } catch (em) {
          console.log(builtin_scrubbers[i].name + ' ' +  em);
        }
      }
    } else {
      var scrubber = bpg.new('scrubber');

      scrubber.set('id', 0);
      scrubber.set('project', pid);
      scrubber.set('name', name);
      scrubber.set('regexp', regexp);
      scrubber.set('builtin', builtin);
      scrubber.set('format', format);
      scrubber.set('target', target);
      scrubber.set('enable', enable);

      bpg.create(scrubber);
      try {
        bpg.commit();
      } catch (em) {
        errx(em);
      }
    }

    console.log('Scrubber successfully created.'.blue);
  }

  if (action === 'modify') {
    var scrubber;
    var id = argv._[3];

    if (!id)
      errx('Usage: morgue scrubber <[universe/]project> modify <id>');

    if (!argv.name && !argv.regexp && !argv.builtin &&
        argv.format === undefined  && argv.target === undefined  &&
        argv.enable === undefined) {
      errx('no scrubber member is specified');
    }

    for (var i = 0; i < model.scrubber.length; i++) {
      if (model.scrubber[i].get('id') == id) {
        scrubber = model.scrubber[i];
        break;
      }
    }

    if (!scrubber)
      errx('Scrubber not found');

    var delta = {};
    if (argv.name)
      delta.name = argv.name;
    if (argv.regexp)
      delta.regexp = argv.regexp;
    if (argv.builtin)
      errx('builtin is not modifiable');
    if (argv.format)
      delta.format = argv.format;
    if (argv.target)
      delta.target = argv.target;
    if (argv.enable !== undefined)
      delta.enable = argv.enable;

    bpg.modify(scrubber, delta);
    try {
      bpg.commit();
    } catch (em) {
      errx(em);
    }

    console.log('Scrubber successfully modified.'.blue);
  }
}

/*
 * Takes a time specifier and returns the number of seconds.
 */
function timespecToSeconds(age_val) {
  var unit = {
    'y' : 3600 * 24 * 365,
    'M' : 3600 * 24 * 30,
    'w' : 3600 * 24 * 7,
    'd' : 3600 * 24,
    'h' : 3600,
    'm' : 60,
    's' : 1,
  };
  var age, pre, age_string, iu;

  if (typeof age_val === 'number')
    return age_val;

  age = parseFloat(age_val);
  pre = String(age);
  age_string = String(age_val);
  iu = age_string.substring(pre.length, age_string.length);
  if (!unit[iu])
    throw new Error("Unknown interval unit '" + iu + "'");
  return parseInt(age * unit[iu]);
}

/*
 * Takes a value in seconds and returns a time specifier.
 */
function secondsToTimespec(age_val) {
  var age = parseInt(age_val);
  var ts = {};

  /* Handle special zero case. */
  if (age === 0)
    return "0s";

  ts['y'] = Math.floor(age / (3600 * 24 * 365));
  age -= (ts['y'] * 3600 * 24 * 365);
  ts['M'] = Math.floor(age / (3600 * 24 * 30));
  age -= (ts['M'] * 3600 * 24 * 30);
  ts['w'] = Math.floor(age / (3600 * 24 * 7));
  age -= (ts['w'] * 3600 * 24 * 7);
  ts['d'] = Math.floor(age / (3600 * 24));
  age -= (ts['d'] * 3600 * 24);
  ts['h'] = Math.floor(age / 3600);
  age -= ts['h'] * 3600;
  ts['m'] = Math.floor(age / 60);
  age -= ts['m'] * 60;
  ts['s'] = age;

  return Object.keys(ts).reduce(function(str, key) {
    if (ts[key] !== 0)
      str += ts[key] + key;
    return str;
  }, "");
}

/* Some subcommands don't make sense with folds etc. */
function argvQueryFilterOnly(argv) {
  if (argv.select || argv.filter || argv.fingerprint || argv.age || argv.time) {
    /* Object must be returned for query to be chainable. */
    if (!argv.select && !argv.template) {
      argv.select = 'object';
    }
    return argvQuery(argv);
  }
  return null;
}

function parseSortTerm(term) {
  var ordering = "ascending";
  var name = term;

  if (term[0] === "-") {
    ordering = "descending";
    name = term.slice(1);
  }

  return {name: name, ordering: ordering};
}

function argvQuery(argv) {
  var query = {};
  var d_age = null;

  if (argv['raw-query']) {
    return { query: JSON.parse(argv['raw-query']) };
  }

  if (argv.reverse)
    reverse = -1;

  if (argv.template)
    query.template = argv.template;

  if (argv.limit)
    query.limit = argv.limit;

  if (argv.offset)
    query.offset = argv.offset;

  query.filter = [{}];
  if (argv.filter) {
    var i;

    if (Array.isArray(argv.filter) === false)
      argv.filter = [argv.filter];

    for (i = 0; i < argv.filter.length; i++) {
      var r = argv.filter[i];
      var expr = [];

      r = r.split(',');
      if (r.length < 2) {
        errx('Filter must be of form <column>,<operation>[,<value>].');
      }

      if (!query.filter[0][r[0]])
        query.filter[0][r[0]] = [];

      /* Some operators don't require an argument. */
      if (r.length == 2)
        expr = [r[1]];
      else if (r.length == 3)
        expr = [r[1], r[2]];

      query.filter[0][r[0]].push(expr);
    }
  }

  if (argv.sort) {
    if (Array.isArray(argv.sort) === false)
      argv.sort  = [argv.sort];

    query.order = argv.sort.map(parseSortTerm);
  }

  if (!query.filter[0].timestamp)
    query.filter[0].timestamp = [];

  if (argv.time) {
    if (query.filter[0].timestamp && query.filter[0].timestamp.length > 0)
      errx('Cannot mix --time and timestamp filters');

    var tm = chrono.parse(argv.time);
    var ts_attr = 'timestamp';
    var ts_s, ts_e;

    if (argv.debug)
      console.log('tm = ', JSON.stringify(tm, null, 4));

    if (tm.length === 0)
      errx('invalid time specifier "' + argv.time + '"');

    if (tm.length > 1) {
      if (tm.length === 2) {
        /* See whether it parsed as two starts and no ends. */
        if (tm[0].start && tm[1].start && !tm[0].end && !tm[1].end) {
          ts_s = tm[0].start.date();
          ts_e = tm[1].start.date();
        }
      }
      if (!ts_s)
        errx('only a single date or range is permitted.'.error);
    } else {
      if (!tm[0].start)
        errx('date specification lacks start date'.error);

      if (!tm[0].end)
        errx('date specification lacks end date'.error);

      ts_s = tm[0].start.date();
      ts_e = tm[0].end.date();
    }

    /* Treat zero start time as greater than zero to exclude unset values. */
    ts_s = parseInt(ts_s / 1000);
    if (ts_s === 0)
      ts_s = 1;
    ts_e = parseInt(ts_e / 1000);

    /* If user specifies a timestamp attribute, use it. */
    if (argv["timestamp-attribute"] && argv["timestamp-attribute"].length > 0)
      ts_attr = argv["timestamp-attribute"];

    query.filter[0][ts_attr] = [
      [ 'at-least', ts_s ],
      [ 'less-than', ts_e ]
    ];

    d_age = null;
  }

  if (argv.factor) {
    query.group = [ argv.factor ];
  }

  if (argv.template === 'select') {
  } else if (argv.select) {
    if (!query.select)
      query.select = [];

    if (Array.isArray(argv.select) === true) {
      for (let i = 0; i < argv.select.length; i++) {
        query.select.push(argv.select[i]);
      }
    } else {
      query.select = [ argv.select ];
    }
  } else if (argv.table === 'objects') {
    query.fold = {
      'timestamp' : [['range'], ['bin']]
    };
  }

  /*
   * The fingerprint argument is a convenience function for filtering by
   * a group.
   */
  if (argv.fingerprint) {
    var length, op, ar;

    if (Array.isArray(argv.fingerprint) === true) {
      errx('Only one fingerprint argument can be specified.');
    }

    length = String(argv.fingerprint).length;
    if (length === 64) {
      op = 'equal';
      ar = argv.fingerprint;
    } else {
      op = 'regular-expression';
      ar = '^' + argv.fingerprint;
    }

    if (!query.filter[0].fingerprint)
      query.filter[0].fingerprint = [];
    query.filter[0].fingerprint.push([op, ar]);
  }

  if (argv.age) {
    if (query.filter[0].timestamp && query.filter[0].timestamp.length > 0)
      errx('Cannot mix --age and timestamp filters');

    d_age = argv.age;
  } else if (!query.filter[0].timestamp || query.filter[0].timestamp.length == 0) {
    d_age = '1M';
  }

  if (d_age) {
    var now = Date.now();
    var target = parseInt(now / 1000) - timespecToSeconds(d_age);
    var oldest = Math.floor(target);

    query.filter[0].timestamp = [
      [ 'at-least', oldest ]
    ];

    range_start = oldest;
    range_stop = Math.floor(now / 1000);

    if (query.fold && query.fold.timestamp) {
      var ft = query.fold.timestamp;
      var i;

      for (i = 0; i < ft.length; i++) {
        if (ft[i][0] === 'bin') {
          ft[i] = ft[i].concat([32, range_start, range_stop]);
        }
      }
    }
  }

  if (argv.table === 'objects') {
    if (!query.filter[0].timestamp || query.filter[0].timestamp.length === 0)
      query.filter[0].timestamp.push([ 'greater-than', 0 ]);
  }

  return { query: query, age: d_age };
}

function bpgPost(bpg, request, callback) {
  var json, msg, response;

  if (typeof request === 'string')
    request = JSON.parse(request);

  response = bpg.post(request);
  json = JSON.parse(response.body);
  msg = json.results[0].string || json.results[0].text;
  if (msg !== 'success') {
    callback(msg);
  } else {
    callback(null, json);
  }
}

/*
 * This is meant primarily for debugging & testing; it could be extended to
 * offer a CLI-structured way to represent BPG commands.
 */
function coronerBpg(argv, config) {
  abortIfNotLoggedIn(config);
  var json, request, response;
  var coroner = coronerClientArgv(config, argv);
  var bpg = coronerBpgSetup(coroner, argv);

  if (argv._[1]) {
    if (!argv._[2]) {
      return usage("morgue bpg list <type>");
    }

    request = JSON.stringify({
      "actions" : [
        {
          "action" : "get",
          "type" : argv._[2]
        }
      ]
    });
  } else if (argv.raw) {
    request = argv.raw;
    if (!request && argv._.length >= 2)
      request = argv._[1];
  } else {
    return usage("morgue bpg [--raw | list <type>]");
  }

  if (!request) {
    return usage("Missing command argument.");
  }

  bpgPost(bpg, request, function(e, r) {
    if (e) {
      err(e);
      return;
    }
    console.log(JSON.stringify(r,null,2));
  });
}

function subcmdProcess(argv, config, opts) {
  var subcmd;
  var fn = null;

  abortIfNotLoggedIn(config);
  argv._.shift();
  if (argv._.length === 0) {
    return opts.usageFn("No request specified.");
  }

  subcmd = argv._[0];
  if (subcmd === "--help" || subcmd == "help")
    return opts.usageFn();

  opts.state = {
    coroner: coronerClientArgv(config, argv),
    subcmd: subcmd,
  };
  if (opts.setupFn)
    opts.setupFn(config, argv, opts, subcmd)

  fn = opts.subcmds[subcmd];
  if (fn) {
    return fn(argv, config, opts);
  }

  opts.usageFn("Invalid subcommand '" + subcmd + "'.");
}

function attributeUsageFn(str) {
  if (str)
    err(str + "\n");
  console.error("Usage: morgue attribute <create|delete> <project> <name> [options]");
  console.error("");
  console.error("Options for create (all but format are required):");
  console.error("  --type=T         Specify type.");
  console.error("  --description=D  Specify description.");
  console.error("  --format=F       Specify formatting hint.");
  process.exit(1);
}

function attributeSetupFn(config, argv, opts, subcmd) {
  if (argv.length < 3) {
    return attributeUsageFn("Incomplete command.");
  }

  opts.params = {
    attrname: argv._[2],
  };
  if (!opts.params.attrname)
    return attributeUsageFn("Missing attribute name.");

  opts.state.bpg = coronerBpgSetup(opts.state.coroner, argv);
  opts.state.model = opts.state.bpg.get();
  opts.state.context = coronerParams(argv, config);

  const ctx = opts.state.context;
  opts.state.universe = opts.state.model.universe.find((univ) => {
    return univ.fields.name === ctx.universe;
  });
  if (!opts.state.universe)
    return attributeUsageFn(`Universe ${ctx.universe} not found.`);
  opts.state.project = opts.state.model.project.find((proj) => {
    return proj.fields.universe === opts.state.universe.fields.id &&
      proj.fields.name === ctx.project;
  });
  if (!opts.state.project) {
    return attributeUsageFn( `Project ${ctx.universe}/${ctx.project} not found.`);
  }

  if (subcmd !== 'create') {
    opts.state.attribute = opts.state.model.attribute.find((attrib) => {
      return attrib.fields.name === opts.params.attrname;
    });
    if (!opts.state.attribute)
      return attributeUsageFn("Attribute not found.");
    opts.state.attr_key = {
      project: opts.state.attribute.fields.project,
      name: opts.state.attribute.fields.name,
    };
  }
}

function bpgCbFn(name, type) {
  return (e, r) => {
    if (e) {
      console.error(`${name} ${type} failed: ${e}`);
      return;
    }
    console.log(`${name} ${type} succeeded!`);
  };
}

function bpgSingleRequest(request) {
  return JSON.stringify({ actions: [ request ] });
}

function attributeSet(argv, config, opts) {
  const state = opts.state;
  if (!argv.description) {
    return attributeUsageFn("Must specify new description.");
  }

  const request = bpgSingleRequest({
    action: "modify",
    type: "configuration/attribute",
    key: state.attr_key,
    fields: {
      description: argv.description,
    },
  });

  bpgPost(state.bpg, request, bpgCbFn('Attribute', 'update'));
}

function attributeDelete(argv, config, opts) {
  const state = opts.state;
  const request = bpgSingleRequest({
    action: "delete",
    type: "configuration/attribute",
    key: state.attr_key,
  });
  bpgPost(state.bpg, request, bpgCbFn('Attribute', 'delete'));
}

function attributeCreate(argv, config, opts) {
  const state = opts.state;

  if (!argv.type) return attributeUsageFn("Must specify type.");
  if (!argv.description) return attributeUsageFn("Must specify description.");

  const request = bpgSingleRequest({
    action: "create",
    type: "configuration/attribute",
    object: {
      name: opts.params.attrname,
      project: state.project.fields.pid,
      type: argv.type,
      description: argv.description,
      format: argv.format,
    },
  });

  bpgPost(state.bpg, request, bpgCbFn('Attribute', 'create'));
}

function coronerAttribute(argv, config) {
  subcmdProcess(argv, config, {
    usageFn: attributeUsageFn,
    setupFn: attributeSetupFn,
    subcmds: {
      //set: attributeSet, - not supported
      create: attributeCreate,
      delete: attributeDelete,
    },
  });
}

/*
 * Print frames in j, relative to availability in k. Different functions
 * are bolded accordingly.
 */
function printFrame(fr_a, fr_b) {
  var pcs = '';
  var ln = 0;

  for (var j = 0; j < fr_a.length; j++) {
    if (j > 0) {
      pcs += ' ← ';
      ln += 3;
    }

    ln += fr_a[j].length;
    if (ln > 80) {
      if (j > 0)
        pcs += '\n        ';

      ln = 0;
    }

    if (j < fr_b.length) {
      if (fr_a[j] !== fr_b[j]) {
        if (fr_b.indexOf(fr_a[j]) <= 0) {
          pcs += fr_a[j].red.bold;
        } else {
          pcs += fr_a[j].yellow;
        }
      } else {
        pcs += fr_a[j];
      }
    } else {
      pcs += fr_a[j].red.bold;
    }
  }

  return pcs;
}

function coronerSimilarity(argv, config) {
  abortIfNotLoggedIn(config);
  var query, p;
  var fp_filter;

  if (levenshtein === null)
    errx('morgue similary is unavailable on your host');

  var coroner = coronerClientArgv(config, argv);

  if (argv._.length < 2) {
    return usage("Missing project, universe arguments.");
  }

  if (argv.share && !argv.fingerprint) {
    return usage("--share flag requires --fingerprint");
  }

  if (argv.fingerprint) {
    fp_filter = argv.fingerprint;
    delete argv.fingerprint;
  }

  p = coronerParams(argv, config);

  var aq = argvQuery(argv);
  query = aq.query;
  var d_age = aq.age;
  var data = '';
  var le = {};
  var limited;

  query.group = [ 'fingerprint' ];
  query.fold = {
    'callstack' : [['head']]
  };

  coroner.query(p.universe, p.project, query, function (err, result) {
    if (err) {
      errx(err.message);
    }

    var rp = new crdb.Response(result.response);
    rp = rp.unpack();

    /*
     * If a limit is provided, then this specifies that scoring should be
     * constrained to the top N groups.
     */
    if (argv.limit) {
      var sr = [];

      /* Squash into an array. */
      for (var fingerprint in rp) {
        rp[fingerprint].fingerprint = fingerprint;
        sr.push(rp[fingerprint]);
      }

      /* Sort the array. */
      sr.sort(function(a, b) {
        return (a.count < b.count) - (a.count > b.count);
      });

      /* Now, we create a map of fingerprints that belong here. */
      limited = {};
      for (var i = 0; i < argv.limit && i < sr.length; i++) {
        limited[sr[i].fingerprint] = true;
      }
    }

    /*
     * The first step is to build a map of all fingerprints. Every fingerprint
     * will consist of an array of strings.
     */
    for (var fingerprint in rp) {
      var frj = rp[fingerprint]['head(callstack)'];

      if (!frj || !frj[0])
        continue;

      var fr = JSON.parse(frj).frame;

      /* If threshold is specified, callstack length must exceed. */
      if (argv.threshold && fr.length < argv.threshold)
        continue;

      /*
       * Last but not least, someone may wish to truncate the array.
       */

      le[fingerprint] = { callstack: fr };

      if (argv.truncate) {
        le[fingerprint].target = fr.slice(0, argv.truncate + 1);
      } else {
        le[fingerprint].target = fr;
      }

      le[fingerprint].scores = {};
    }

    /*
     * Now, we have the centralized mapping. From here, we can validate
     * similarity. For every group, for every group, compute the levenshtein
     * distance.
     */
    for (var fj_a in le) {
      /* If a limit exists, then only bother with the group if it's there. */
      if (limited && !limited[fj_a])
        continue;

      /*
       * If a fingerprint is specified, print the details for that
       * fingerprint.
       */
      if (fp_filter && fj_a.indexOf(fp_filter) < 0)
        continue;

      for (var fj_b in le) {
        if (fj_b === fj_a)
          continue;

        le[fj_a].scores[fj_b] = levenshtein(le[fj_a].target,
            le[fj_b].target);
      }
    }

    /*
     * We have no computed the edit distance to every group. Let's sort
     * and we're ready to print.
     */
    for (var fj in le) {
      var source = le[fj];
      var label = '';
      var pr = false;
      if (fp_filter && argv.share)
        var triage_url = coroner.endpoint + '/p/' + p.project + '/triage?aperture=[["relative",' +
          '["floating","all"]],[["fingerprint",["regular-expression","';

      label +=  'Target: '.bold.yellow + fj + '\n' +
        '      ' + JSON.stringify(source.callstack) + '\n' + 'Similar:'.bold;

      for (fj_a in source.scores) {
        /* Skip entry if edit distance is too large. */
        if (argv.distance && source.scores[fj_a] > argv.distance)
          continue;

          /* If a union threshold is provided, compute and filter. */
        if (argv.intersect && intersect(le[fj_a].callstack, source.callstack).length < argv.intersect)
          continue;

        if (pr === false) {
          pr = true;
          console.log(label);
          if (fp_filter && argv.share)
            triage_url += fj;
        }

        var s = printf("  %3d %s", source.scores[fj_a],
          printFrame(le[fj_a].callstack, source.callstack));
        if (fp_filter && argv.share)
          triage_url += '|' + fj_a;
        console.log(s);
      }
      if (pr === true) {
        if (fp_filter && argv.share) {
          triage_url += '"]]]]';
          console.log("\nLink: ".bold.green + triage_url);
        }
        process.stdout.write('\n');

      }
    }
  });
}

function coronerFlamegraph(argv, config) {
  abortIfNotLoggedIn(config);
  var query, p;
  var unique = argv.unique;
  var reverse = argv.reverse;

  var coroner = coronerClientArgv(config, argv);

  if (argv._.length < 2) {
    return usage("Missing project, universe arguments.");
  }

  p = coronerParams(argv, config);

  var aq = argvQuery(argv);
  query = aq.query;
  var d_age = aq.age;
  var data = '';

  query.fold = {
    'callstack' : [['histogram']]
  };

  coroner.query(p.universe, p.project, query, function (err, result) {
    if (err) {
      errx(err.message);
    }

    var child = spawn(flamegraph);
    var rp = new crdb.Response(result.response);
    rp = rp.unpack();

    if (!rp['*']) {
      errx("No results found.");
    }

    var samples = rp['*']['histogram(callstack)'];

    for (var i = 0; i < samples.length; i++) {
      var callstack;

      try {
        callstack = JSON.parse(samples[i][0]).frame;
      } catch (error) {
        continue;
      }

      var count = samples[i][1];
      var line = '';

      if (argv.reverse) {
        for (var j = 0; j < callstack.length; j++) {
          if (j != 0)
            line += ';';

          line += callstack[j];
        }
      } else {
        for (var j = callstack.length - 1; j >= 0; j--) {
          if (j != callstack.length - 1)
            line += ';';

          line += callstack[j];
        }
      }

      if (unique) {
        line += ' 1';
      } else {
        line += ' ' + count;
      }

      child.stdin.write(line + '\n');
    }

    child.stdin.end();

    if (argv.o) {
      try {
        fs.accessSync(argv.o);
        errx('File ' + argv.o + ' already exists.');
      } catch (error) {
        /* We are fine, not replacing a file probably. */
      }

      var stream = fs.createWriteStream(argv.o);
      child.stdout.pipe(stream);
    } else {
      child.stdout.on('data', (data) => {
        process.stdout.write(data + '');
      });
    }
  });
}

function coronerNuke(argv, config) {
  abortIfNotLoggedIn(config);

  var coroner = coronerClientArgv(config, argv);
  var query, project, universe, un, target;
  var ru;

  var coronerd = {
    url: coroner.endpoint,
    session: { token: '000000000' }
  };
  var opts = {};
  var bpg = {};

  if (coroner.config && coroner.config.token)
    coronerd.session.token = coroner.config.token;

  if (argv.debug)
    opts.debug = true;

  bpg = new BPG.BPG(coronerd, opts);

  if (argv.universe)
    universe = argv.universe;
  if (argv.project)
    project = argv.project;

  var model = bpg.get();

  if (universe) {
    /* Find the universe with the specified name. */
    for (var i = 0; i < model.universe.length; i++) {
      if (model.universe[i].get('name') === universe) {
        un = target = model.universe[i];
      }
    }
  }

  if (!un) {
    errx('Universe not found.');
  }

  if (project) {
    target = null;
    for (var i = 0; i < model.project.length; i++) {
      if (model.project[i].get('name') === project &&
          model.project[i].get('universe') === un.get('id')) {
        target = model.project[i];
        break;
      }
    }
  }

  if (target === null) {
    errx('No such object.');
  }

  bpg.delete(target, { cascade: true });

  try {
    bpg.commit();
  } catch (em) {
    errx(em);
  }

  console.log('Success'.blue);
  return;
}

function coronerSet(argv, config) {
  abortIfNotLoggedIn(config);
  var query;
  var p;

  var coroner = coronerClientArgv(config, argv);

  if (argv._.length < 2) {
    return usage("Missing project, universe arguments");
  }

  p = coronerParams(argv, config);

  if (!argv.table) {
    argv.table = 'objects';
  }

  var aq = argvQuery(argv);
  query = aq.query;

  delete(query.fold);
  delete(query.factor);

  if (!argv.time && !argv.age) {
    for (var i = 0; i < query.filter.length; i++) {
      delete(query.filter[i].timestamp);
    }
  }

  var set = {};
  for (var i = 0; i < argv._.length; i++) {
    if (argv._[i].indexOf('=') === -1)
      continue;

    var kv = argv._[i].split('=');

    set[kv[0]] = kv[1];
  }

  query.set = set;

  if (argv.table)
    query.table = argv.table;

  coroner.query(p.universe, p.project, query, function (err, result) {
    if (err) {
      errx(err.message);
    }

    console.log('Success.'.success);
    return;
  });

  return;
}

/**
 * @brief: Implements the clean command.
 */
function coronerClean(argv, config) {
  abortIfNotLoggedIn(config);
  var query;
  var p;

  var coroner = coronerClientArgv(config, argv);

  if (argv._.length < 2) {
    return usage("Missing project, universe arguments");
  }

  p = coronerParams(argv, config);

  if (!argv.table) {
    argv.table = 'objects';
  }

  var aq = argvQuery(argv);
  query = aq.query;
  var d_age = aq.age;

  query.group = ["fingerprint"];
  query.order = [{"name":";count","ordering":"descending"}];

  /* First, extract the top N fingerprint objects. */
  coroner.query(p.universe, p.project, query, function (err, result) {
    var fingerprint = [];
    var keep = 3;

    if (argv.keep)
      keep = parseInt(argv.keep);

    if (keep === 0)
      errx('--keep must be greater than 0');

    if (err) {
      errx(err.message);
    }

    var rp = new crdb.Response(result.response);
    for (var i = 0; i < rp.json.values.length; i++)
      fingerprint.push(rp.json.values[i][0]);

    /* Now, we construct a selection query for all objects matching these. */
    delete(query.group);
    delete(query.fold);
    delete(query.order);

    query.limit = 10000;
    query.order = [{"name":"timestamp","ordering":"descending"}];

    query.select = ["fingerprint", "_deleted", "timestamp", "object.size"];
    if (!query.filter[0]["fingerprint"])
      query.filter[0]["fingerprint"] = [];
    query.filter[0]["fingerprint"].push(["regular-expression",
      fingerprint.join("|")]);

    coroner.query(p.universe, p.project, query, function (err, result) {
      var groups = {};
      var targets = [];
      var saved = 0;
      var deleted = 0;

      if (err) {
        errx(err.message);
      }

      var rp = new crdb.Response(result.response);
      rp = rp.unpack();

      /* At this point, we construct a map for every single fingerprint. */

      var objects = rp['*'];
      for (var i = 0; i < objects.length; i++) {
        var fp = objects[i].fingerprint;
        var deleted = objects[i]._deleted;
        var total = 0;

        if (deleted === 1) {
          continue;
        }

        if (!groups[fp])
          groups[fp] = [];

        groups[fp].push([objects[i].id, objects[i]['object.size']]);
      }

      /* Now go through every and delete all but N. */
      for (var j in groups) {
        if (groups[j].length <= keep) {
          continue;
        }

        total += groups[j].length;

        var update = groups[j].slice(keep, groups[j].length);

        /* Compute disk saving and flatten. */
        for (var k = keep; k < groups[j].length; k++) {
          deleted++;
          saved += groups[j][k][1] / 1024;
        }

        groups[j] = update;

        for (var k = 0; k < update.length; k++)
          targets.push(update[k][0]);
      }

      process.stderr.write(deleted + ' / ' + total + ' objects deleted across ' +
          Object.keys(groups).length + ' fingerprint(s) saving at least ' + Math.floor(saved / 1024) + 'MB.\n');

      if (argv.output) {
        for (var i = 0; i < targets.length; i++)
          process.stdout.write(targets[i] + ' ');

        process.stdout.write('\n');
      }

      return;
    });
  });
}

/**
 * @brief: Implements the list command.
 */
function coronerList(argv, config) {
  abortIfNotLoggedIn(config);
  var query;
  var p;

  var coroner = coronerClientArgv(config, argv);

  if (argv._.length < 2) {
    return usage("Missing project, universe arguments");
  }

  p = coronerParams(argv, config);

  if (!argv.table) {
    argv.table = 'objects';
  }

  var aq = argvQuery(argv);
  query = aq.query;
  var d_age = aq.age;

  function fold(query, attribute, label) {
    var argv, i;

    if (!query.fold)
      query.fold = {};

    if (Array.isArray(attribute) === false) {
      attribute = [ attribute ];
    }

    for (i = 0; i < attribute.length; i++) {
      var modifiers, j;

      modifiers = attribute[i].split(',');
      argv = modifiers[0];
      modifiers.shift();

      for (j = 0; j < modifiers.length; j++) {
        modifiers[j] = parseInt(modifiers[j]);
        if (isNaN(modifiers[j]) === true) {
          errx('Modifiers must be integers.');
        }
      }

      if (!query.fold[argv])
        query.fold[argv] = [];

      query.fold[argv].push([label].concat(modifiers));
    }
  }

  const folds = [
    [argv.last, 'last'],
    [argv.first, 'first'],
    [argv.tail, 'tail'],
    [argv.head, 'head'],
    [argv.object, 'object'],
    [argv.histogram, 'histogram'],
    [argv.distribution, 'distribution'],
    [argv.unique, 'unique'],
    [argv.mean, 'mean'],
    [argv.sum, 'sum'],
    [argv.quantize, 'bin'],
    [argv.bin, 'bin'],
    [argv.range, 'range'],
  ];

  /* Apply requested folds to query */
  folds.forEach(function(attr_op) {
    const [attr, op] = attr_op;
    if (attr)
      fold(query, attr, op);
  });

  if (argv.table != 'objects') {
    query.table = argv.table;
  }

  if (argv.set) {
    var set = argv.set;

    if (!Array.isArray(set))
      set = [argv.set];

    query.set = {};
    set.forEach((s) => {
      var kv = s.split("=");
      query.set[kv[0]] = kv[1];
    });
  }

  if (argv.clear) {
    var clear = argv.clear;

    if (!Array.isArray(clear))
      clear = [argv.clear];

    if (!query.set)
      query.set = {};
    clear.forEach((c) => {
      query.set[c] = null;
    });
  }

  if (argv.query) {
    var pp = JSON.stringify(query);

    console.log(pp);
    if (!argv.raw)
      return;
  }

  if (argv.benchmark) {
    var start, end;
    var concurrency = 1;
    var samples = [];
    var n_samples = 8;
    var requests = 0;
    var i;

    if (argv.concurrency)
      concurrency = parseInt(argv.concurrency);

    if (argv.samples)
      n_samples = argv.samples;

    var start = process.hrtime();

    for (i = 0; i < concurrency; i++) {
      (function queryPr() {
        requests++;

        coroner.query(p.universe, p.project, query, function (err, result) {
          samples.push(result._.latency);

          if (--n_samples == 0) {
            printSamples(requests, samples, start, process.hrtime(),
                concurrency);
            return;
          }

          coroner.query(p.universe, p.project, query, queryPr);
        });
      })();
    }
  } else {
    coroner.query(p.universe, p.project, query, function (err, result) {
      if (err) {
        errx(err.message);
      }

      if (argv.raw) {
        var pp;

        try {
          pp = JSON.stringify(result);
        } catch (err) {
          pp = result;
        }

        console.log(pp);
        return;
      }

      if (query.set) {
        if (result.response.result === 'success')
          console.log('Success'.blue);
        else
          console.log('result:\n' + JSON.stringify(result.response));
      } else {

        var rp = new crdb.Response(result.response);

        if (argv.json) {
          var results = rp.unpack();

          console.log(JSON.stringify(results, null, 2));
          return;
        }

        coronerPrint(query, rp, result.response, null, result._.runtime);

        var date_label;
        if (d_age) {
          date_label = 'as of ' + d_age + ' ago';
        } else {
          date_label = 'with a time range of ' + argv.time;
        }
      }

      if (argv.verbose) {
        console.log('Timing:'.yellow);

        var o = '';
        var aggs = result._.runtime.aggregate;
        if ('time' in aggs)
          aggs = aggs.time
        else if ('pre_sort' in aggs)
          aggs = aggs.pre_sort + aggs.post_sort;

        o += '     Rows: '.yellow + result._.runtime.filter.rows + '\n';
        o += '   Filter: '.yellow + result._.runtime.filter.time + 'us (' +
          Math.ceil(result._.runtime.filter.time /
            result._.runtime.filter.rows * 1000) + 'ns / row)\n';
        o += '    Group: '.yellow + result._.runtime.group_by.time + 'us (' +
          Math.ceil(result._.runtime.group_by.time /
            result._.runtime.group_by.groups) + 'us / group)\n';
        o += 'Aggregate: '.yellow + aggs + 'us\n';
        o += '     Sort: '.yellow + result._.runtime.sort.time + 'us\n';
        if (result._.runtime.set) {
          o += '      Set: '.yellow + result._.runtime.set.time + 'us\n';
        }
        o += '    Total: '.yellow + result._.runtime.total_time + 'us';
        console.log(o + '\n');
      }

      var footer = result._.user + ': ' +
          result._.universe + '/' + result._.project + ' ' + date_label +
            ' [' + result._.latency + ']';
      console.log(footer.blue);
    });
  }
}


function uint128ToUuid(uint128) {
  const uuid_sizes = [8, 4, 4, 4, 12];
  const uint128_pattern = /^[0-9a-f]{32,32}$/;
  var parts = [];

  if (!uint128_pattern.test(uint128))
    return uint128;

  for (var i = 0, step = 0, size = uuid_sizes[i];
      i < uuid_sizes.length;
      i++, size = uuid_sizes[i], step += size)
    parts.push(uint128.slice(step, step + size));

  return parts.join("-");
}

function fieldFormat(st, format) {
  var rd = {
    'memory_address' : function() {
      return printf("%#lx", st);
    },
    'kilobytes' : function() {
      return st + ' kB';
    },
    'megabytes' : function() {
      return st + ' MB';
    },
    'gigabytes' : function() {
      return st + ' GB';
    },
    'bytes' : function() {
      return st + ' B';
    },
    'ipv4': function() {
      return ip.fromLong(parseInt(st));
    },
    'unix_timestamp' : function() {
        return String(new Date(parseInt(st) * 1000));
    },
    'seconds' : function() {
      return st + ' sec';
    },
    'uuid' : function() {
      return uint128ToUuid(st);
    }
  };

  if (rd[format])
    return rd[format]();

  return st;
}

function rangePrint(field, factor) {
  console.log(field[0] + " - " + field[1] + " (" +
      (field[1] - field[0]) + ")");
}

function binPrint(field, factor, ff) {
  var data = {};
  var j = 0;
  var i;
  var format = "%20s %20s";

  if (field.length === 0)
    return false;

  for (i = 0; i < field.length; i++) {
    var label;

    if (field[i].length === 0)
      continue;

    label = printf(format, fieldFormat(field[i][0], ff),
       fieldFormat(field[i][1], ff));
    data[label] = field[i][2];
    j++;
  }

  if (j === 0)
    return false;

  process.stdout.write('\n');
  console.log(histogram(data, {
    'sort' : false,
    'width' : 10,
    'bar' : '\u2586'
  }));

  return true;
}

function histogramPrint(field, unused, format) {
  var data = {};
  var j = 0;
  var i;

  for (i = 0; i < field.length; i++) {
    if (field[i].length === 0)
      continue;

    data[fieldFormat(field[i][0], format)] = field[i][1];
    j++;
  }

  if (j === 0)
    return false;

  process.stdout.write('\n');
  console.log(histogram(data, {
    'sort' : true,
    'bar' : '\u2586',
    'width' : 40,
  }));

  return true;
}

function distributionPrint(field, unused, format) {
  const distribution = field[0];
  const data = distribution.vals;
  const tail_sum = distribution.tail || 0;
  const total_sum = tail_sum + data.reduce((s, v) => s + v[1], 0);

  console.log(distribution.keys + " keys total, with a count of " + total_sum);
  histogramPrint(data, unused, format);
}

function unaryPrint(field, unused, format) {
  console.log(fieldFormat(field[0], format));
  return true;
}

function noFormatPrint(field, unused, format) {
  console.log(field[0]);
  return true;
}

function callstackPrint(cs) {
  var callstack;
  var frames, i, length;

  if (!cs || cs.length === 0) {
    console.log('');
    return;
  }

  try {
    callstack = JSON.parse(cs);
  } catch (error) {
    if (callstackError === false) {
      bt.report(error);
      callstackError = true;
    }

    console.log(' ' + cs);
    return;
  }

  frames = callstack.frame;
  if (frames === undefined) {
    console.log(cs);
    return;
  }

  process.stdout.write('\n    ');

  length = 4;

  if (!ARGV.verbose && !ARGV.l) {
    var options = { dynamic: true };
    var label = new Callstack(frames);

    if (ARGV.collapse)
      options.dynamic = true;
    if (ARGV.suffix) {
      options.suffix = ARGV.suffix;
      options.dynamic = false;
    }

    frames = label.render(options);
  }

  for (i = 0; i < frames.length; i++) {
    length += frames[i].length + 4;

    if (i !== 0 && length >= 76) {
      process.stdout.write('\n    ');
      length = frames[i].length + 4;
    }

    if (i === frames.length - 1) {
      process.stdout.write(frames[i]);
    } else {
      process.stdout.write(frames[i] + ' ← ');
    }
  }

  process.stdout.write('\n');
}

function objectPrint(g, object, renderer, fields, runtime) {
  var string = String(g);
  var field, start, stop, sa;

  if (string.length > 28) {
    string = printf("%-28s...", string.substring(0, 28));
  } else {
    string = printf("%-31s", string);
  }

  process.stdout.write(string.factor + ' ');

  /* This means that no aggregation has occurred. */
  if (object.length) {
    var i;
    var a;

    process.stdout.write('\n');

    for (i = 0; i < object.length; i++) {
      var ob = object[i];
      let label = printf("#%-7x ", ob.object);

      process.stdout.write(label.green.bold);

      if (ob.timestamp) {
        process.stdout.write(new Date(ob.timestamp * 1000) + '     ' +
            ta.ago(ob.timestamp * 1000).bold + '\n');
      } else {
        process.stdout.write('\n');
      }

      for (a in ob) {
        if (a === 'object')
          continue;

        if (a === 'timestamp')
          continue;

        if (a === 'callstack')
          continue;

        console.log('  ' + a.yellow.bold + ': ' + fieldFormat(ob[a], fields[a]));
      }

      /*
       * If a callstack is present then render it in a pretty fashion.
       */
      if (ob.callstack) {
        process.stdout.write(('  ' + fields[a] + ':').yellow.bold);
        callstackPrint(ob.callstack);
      }
    }

    return;
  }

  var timestamp_bin = object['bin(timestamp)'];
  if (timestamp_bin) {
    bar(timestamp_bin, range_start, range_stop);
    process.stdout.write(' ');
  }

  var timestamp_range = object['range(timestamp)'];
  if (timestamp_range) {
    start = new Date(timestamp_range[0] * 1000);
    stop = new Date(timestamp_range[1] * 1000);
    sa = ta.ago(stop) + '\n';

    process.stdout.write(sa.success);
  }

  if (timestamp_range) {
    console.log('First Occurrence: '.label + start);
    if (timestamp_range[0] !== timestamp_range[1])
      console.log(' Last Occurrence: '.label + stop);
  }

  if (object.count) {
      var label = object.count + '';

      if (runtime && runtime.filter && runtime.filter.rows > 0) {
        label += printf(" (%.2f%%)",
            (object.count / runtime.filter.rows) * 100);
      }

      console.log('     Occurrences: '.yellow.bold + label);
  }

  for (field in object) {
    var match;

    if (field === 'count')
      continue;

    match = field.indexOf('(');
    if (match > -1) {
      match = field.substring(0, match);
    }

    /*
     * This is terribly ugly. We special-case management of timestamp for
     * pretty-printing purposes.
     */
    if (field.indexOf('timestamp') > -1 && (field.indexOf('bin(') > -1 ||
        field.indexOf('range(') > -1)) {
      continue;
    }

    if (fields[field] === 'callstack') {
      process.stdout.write(field.label.yellow.bold + ':');
      callstackPrint(object[field]);
      continue;
    }

    process.stdout.write(field.label + ': '.yellow.bold);

    if (!renderer[match]) {
      console.log(object[field]);
      continue;
    }

    if (renderer[match](object[field], field.label, fields[field]) === false)
      console.log(object[field]);
  }
}

function coronerPrint(query, rp, raw, columns, runtime) {
  var results = rp.unpack();
  var fields = rp.fields();
  var g;
  var renderer = {
    first: unaryPrint,
    last: unaryPrint,
    head: unaryPrint,
    tail: unaryPrint,
    unique: noFormatPrint,
    mean: noFormatPrint,
    object: noFormatPrint,
    sum: unaryPrint,
    histogram: histogramPrint,
    distribution: distributionPrint,
    quantize: binPrint,
    bin: binPrint,
    range: rangePrint,
  };

  for (g in results) {
    objectPrint(g, results[g], renderer, fields, runtime);
    process.stdout.write('\n');
  }

  return;
}

function loginComplete(coroner, argv, err, cb) {
  if (err) {
    errx("Unable to authenticate: " + err.message + ".");
  }

  saveConfig(coroner, function(err) {
    if (err) {
      errx("Unable to save config: " + err.message + ".");
    }

    console.log('Logged in'.success + ' ' +
      ('[' + coroner.config.token + ']').grey);

    if (cb) {
      cb(coroner, argv);
    }

    return coroner;
  });

  return;
}

/**
 * @brief Implements the login command.
 */
function coronerLogin(argv, config, cb) {
  const endpoint = argv._[1];

  if (!endpoint) {
    return usage("Expected endpoint argument.");
  }

  const coroner = coronerClient(config, !!argv.k, argv.debug, endpoint,
    argv.timeout);

  /*
   * If a token is supplied, immediately to go login path.
   */
  if (argv.token) {
    return coroner.login_token(argv.token, function(err) {
      loginComplete(coroner, argv, err, cb);
    });
  }

  promptLib.get([{
      name: 'username',
      message: 'User',
      required: true,
    }, {
      message: 'Password',
      name: 'password',
      replace: '*',
      hidden: true,
      required: true
  }], function (err, result) {
    if (err) {
      if (err.message === "canceled") {
        return;
      } else {
        throw err;
      }
    }

    coroner.login(result.username, result.password, function(err) {
      return coroner.login(result.username, result.password, function(err) {
        loginComplete(coroner, argv, err, cb);
      });
    });
  });
}

function unpackQueryObjects(objects, qresult) {
  var rp = new crdb.Response(qresult.response);
  rp = rp.unpack();

  if (rp['*']) {
    rp['*'].forEach(function(o) {
      objects.push(oidToString(o.object));
    });
  }
}

function symboldClient(argv, config) {
  const coroner = coronerClientArgv(config, argv);
  const symboldClient = new symbold.SymboldClient(coroner);
  argv._.shift();
  symboldClient.routeMethod(argv);
}


function callstackUsage(str) {
  if (str)
    err(str + "\n");
  console.error("Usage: morgue callstack <subcommand>:");
  console.error("   morgue callstack evaluate <project> [--name=name] <object>|<filename>");
  console.error("     Evaluate a specific object/file.");
  console.error("");
  console.error("   morgue callstack get <--name=name>");
  console.error("     Retrieve the ruleset for the optional name.");
  console.error("");
  process.exit(1);
}

function coronerCallstackParams(argv, p, action) {
  var csparams = Object.assign({
    action: action,
    name: argv.format || "minidump",
    fulljson: true,
  }, p);
  if (argv.language)
    csparams.language = argv.language;
  if (argv.platform)
    csparams.platform = argv.platform;
  return csparams;
}

function coronerCallstackEval(argv, coroner, p) {
  const csparams = coronerCallstackParams(argv, p, "evaluate");
  var data, params, obj;

  if (argv._.length != 1) {
    return callstackUsage("evaluate: Must specify one object.");
  }

  obj = argv._[0];

  if (fs.existsSync(obj)) {
    data = JSON.parse(fs.readFileSync(obj, 'utf8'));
    coroner.promise('post', '/api/callstack', csparams, data, null).then((csr) => {
      console.log(JSON.stringify(csr, null, 4));
    }).catch(std_failure_cb);
    return;
  }

  /*
   * Fetch the json resource, then submit it to /api/callstack, dumping the
   * JSON response.
   */
  params = {resource: "json.gz"};

  coroner.promise('http_fetch', p.universe, p.project, obj, params).then((hr) => {
    try {
      data = JSON.parse(zlib.gunzipSync(hr.bodyData).toString("utf8"));
    } catch (e) {
      data = JSON.parse(hr.bodyData);
    }

    return coroner.promise('post', '/api/callstack', csparams, data, null).then((csr) => {
        console.log(JSON.stringify(csr, null, 4));
      }).catch(std_failure_cb);
  }).catch(std_failure_cb);
}

function coronerCallstackGet(argv, coroner, p) {
  const csparams = coronerCallstackParams(argv, p, "get");

  coroner.promise('get', '/api/callstack', csparams).then((csr) => {
    var json = JSON.parse(csr.toString("utf8"));
    console.log(JSON.stringify(json, null, 4));
  }).catch(std_failure_cb);
}

/**
 * @brief Implements the callstack command.
 */
function coronerCallstack(argv, config) {
  var coroner, fn, p, subcmd;

  const subcmd_map = {
    evaluate: coronerCallstackEval,
    eval: coronerCallstackEval,
    get: coronerCallstackGet,
  };

  argv._.shift();
  if (argv._.length === 0) {
    return callstackUsage("No request specified.");
  }

  subcmd = argv._[0];
  if (subcmd === "--help" || subcmd === "help" || subcmd === "-h")
    return callstackUsage();

  coroner = coronerClientArgv(config, argv);
  p = coronerParams(argv, config);
  argv._.shift(); /* remove subcmd */
  argv._.shift(); /* remove project */

  fn = subcmd_map[subcmd];
  if (fn) {
    return fn(argv, coroner, p);
  }

  callstackUsage("Invalid callstack subcommand '" + subcmd + "'.");
}

function deduplicationUsage(str) {
  if (str)
    err(str + "\n");
  console.error("Usage: morgue deduplication <subcommand>:");
  console.error("   morgue deduplication add <universe>/<project> <--name=name> <--rules=rules_file> <--priority=priority>");
  console.error("     Add deduplication rules to the project.");
  console.error("");
  console.error("   morgue deduplication delete <universe>/<project> <--name=name>");
  console.error("     Remove the deduplication rule from the project.");
  console.error("");
  console.error("   morgue deduplication modify <universe>/<project> <--name=name> [--rules=<rules_file>] [--priority=<priority>]");
  console.error("     Modify deduplication rules from the project.");
  console.error("");
  process.exit(1);
}

function coronerDeduplicationAdd(argv, coroner, p, bpg, rules) {
  if (fs.existsSync(argv.rules)) {
    const data = JSON.parse(fs.readFileSync(argv.rules, 'utf8'));
    rules.set('rules', JSON.stringify(data));

    let priority = -1;
    if (argv.priority && parseInt(argv.priority) != 0)
      priority = parseInt(argv.priority);
    rules.set('priority', priority);
    bpg.create(rules);
    bpg.commit();
    console.log(`Rule ${argv.name} created`.blue);
  } else {
    return deduplicationUsage(`Unknown file ${argv.rules}`);
  }
}

function coronerDeduplicationDelete(argv, coroner, p, bpg, rules) {
  bpg.delete(rules);
  bpg.commit();
  console.log(`Rule ${argv.name} deleted`.blue);
}

function coronerDeduplicationModify(argv, coroner, p, bpg, rules) {
  var delta = {};

  if (argv.priority && parseInt(argv.priority) != 0)
    delta.priority = parseInt(argv.priority);

  if (argv.rules !== undefined && fs.existsSync(argv.rules)) {
    const data = JSON.parse(fs.readFileSync(argv.rules, 'utf8'));
    delta.rules = JSON.stringify(data);
  }
  bpg.modify(rules, delta);
  bpg.commit();
  console.log(`Rule ${argv.name} modified`.blue);
}

function coronerDeduplicationList(argv, coroner, p, bpg, rules) {
  const model = bpg.get();

  const printDeduplicationList = function(data, verbose) {

    let table_data = [
      [ 'Name', 'Priority', 'Languages', 'Plaforms', 'Rules' ],
    ];

    for (let i = 0; i < data.length; i++) {
      const el = data[i]
      const parsed_rules = JSON.parse(el.rules);
      table_data = table_data.concat([[
        el.name,
        el.priority,
        el.languages,
        el.platforms,
        parsed_rules.length
      ]]);
    }

    console.log(table(table_data));

    if (verbose === true) {

      const verbose_table_data = [[
        'Action',
        'Function',
        'Platform',
        'Object',
        'Replacement'
      ]]

      for (let i = 0; i < data.length; i++) {
        const parsed_rules = JSON.parse(data[i].rules);
        const mapped = parsed_rules.map(function(e) {
          const arr = [
            e.actions,
            e.function,
            e.platform,
            e.object,
            e.replacement,
          ];
          return arr;
        })
        const to_print = verbose_table_data.concat(mapped);
        console.log(table(to_print));
      }

    }
  };

  if (argv.name !== undefined) {
    let found = undefined;

    for (let i = 0; i < model.deduplication.length; i++) {
      const el = model.deduplication[i].fields
      if (el.name == argv.name) {
        found = el;
        break;
      }
    }

    if (found === undefined) {
      return;
    }

    printDeduplicationList([found], argv.verbose);
  } else {
    let fields = model.deduplication.map((e) => e.fields);
    fields.sort((l, r) => l.priority - r.priority);

    printDeduplicationList(fields, argv.verbose);
  }
}

/**
 * @brief Implements the deduplication command.
 */
function coronerDeduplication(argv, config) {
  var coroner, fn, p, subcmd;

  const subcmd_map = {
    add: coronerDeduplicationAdd,
    delete: coronerDeduplicationDelete,
    modify: coronerDeduplicationModify,
    list: coronerDeduplicationList,
  };

  argv._.shift();
  if (argv._.length === 0) {
    return deduplicationUsage("No request specified.");
  }

  subcmd = argv._[0];
  if (subcmd === "--help" || subcmd === "help" || subcmd === "-h")
    return deduplicationUsage();

  coroner = coronerClientArgv(config, argv);
  p = coronerParams(argv, config);
  argv._.shift(); /* remove subcmd */
  argv._.shift(); /* remove project */

  const bpg = coronerBpgSetup(coroner, argv);

  const model = bpg.get('project')

  let pid = null;

  for (let i = 0; i < model.project.length; i++) {
    const el = model.project[i];
    if (el.fields.name == p.project) {
      pid = el.fields.pid;
      break;
    }
  }

  if (pid === null) {
    return deduplicationUsage(`Unknown project ${p.project}`);
  }

  let owner = coroner.config.user.uid;
  if (argv.owner !== undefined)
    owner = parseInt(argv.owner);

  let rules = bpg.new('deduplication');

  if (argv.name !== undefined)
    rules.set('name', argv.name);
  rules.set('id', 0);
  rules.set('project', pid);
  rules.set('rules', '');
  rules.set('languages', 'c');
  rules.set('enabled', 1);
  rules.set('owner', owner);
  // rules.set('priority', priority);
  if(argv.platform)
    rules.set('platforms', argv.platform);

  fn = subcmd_map[subcmd];
  if (fn) {
    try {
      return fn(argv, coroner, p, bpg, rules);
    } catch(e) {
      return deduplicationUsage(e);
    }
  }

  deduplicationUsage("Invalid deduplication subcommand '" + subcmd + "'.");
}

/**
 * @brief Implements the delete command.
 */
function coronerDelete(argv, config) {
  var aq, coroner, o, p;
  var tasks = [];
  var chunklen = argv.chunklen || 16384;
  var params = {};
  var physical_only = argv["physical-only"];
  var crdb_only = argv["crdb-only"];

  abortIfNotLoggedIn(config);

  aq = argvQueryFilterOnly(argv);
  coroner = coronerClientArgv(config, argv);
  p = coronerParams(argv, config);
  o = argv._.slice(2);
  argvPushObjectRanges(o, argv);

  if (o.length === 0 && !(aq && aq.query)) {
    errx('Must specify objects to be deleted.');
  }

  if (argv.sync) {
    params.sync = true;
    if (!argv.timeout) {
      /* Set longer 5 minute timeout in case of heavy load. */
      coroner.timeout = 300 * 1000;
    }
  }

  if (!argv.all) {
    params.subsets = [];
    if (!crdb_only)
      params.subsets.push("physical");
    else
      params.subsets.push("crdb");
  }

  var delete_fn = function() {
    var n_objects = o.length;
    if (n_objects === 0)
      return Promise.reject(new Error("No matching objects."));
    while (o.length > 0) {
      var objs = o.splice(0, Math.min.apply(Math, [o.length, chunklen]));
      tasks.push(coroner.promise('delete_objects', p.universe, p.project,
        objs, params));
    }
    process.stderr.write(sprintf('Deleting %d objects in %d requests...',
      n_objects, tasks.length).blue + '\n');

    return Promise.all(tasks);
  }

  if (aq && aq.query) {
    coroner.promise('query', p.universe, p.project, aq.query).then(function(r) {
      unpackQueryObjects(o, r);
      return delete_fn();
    }).then(std_success_cb).catch(std_failure_cb);
  } else {
    delete_fn().then(std_success_cb).catch(std_failure_cb);
  }
}

function coronerRepair(argv, config) {
  abortIfNotLoggedIn(config);
  var params = coronerParams(argv, config);
  var coroner = coronerClientArgv(config, argv);

  if (argv._.length < 2) {
    return usage("Missing universe, project arguments.");
  }

  coroner = coronerClientArgv(config, argv);

  params.action = 'reload';
  params.recovery = true;

  coroner.promise('control', params)
    .then((result) =>
      console.log(('Reprocessing request #' + result.id + ' queued.').success))
    .catch(std_failure_cb);
}

/**
 * @brief Implements the reprocess command.
 */
function coronerReprocess(argv, config) {
  abortIfNotLoggedIn(config);
  var params = coronerParams(argv, config);
  var coroner;
  var n_objects;
  var aq = {};

  if (argv._.length < 2) {
    return usage("Missing universe, project arguments.");
  }

  params.action = 'reload';
  if (argv.first)
    params.first = oidToString(argv.first);
  if (argv.last)
    params.last = oidToString(argv.last);

  aq = argvQueryFilterOnly(argv);
  coroner = coronerClientArgv(config, argv);

  /* Check for a query parameter to be sent. */
  n_objects = argv._.length - 2;

  if (n_objects > 0 && aq && aq.query) {
    return usage("Cannot specify both a query and a set of objects.");
  }

  var success_cb = function(result) {
    console.log(('Reprocessing request #' + result.id + ' queued.').success);
  }

  if (aq && aq.query) {
    params.objects = [];
    coroner.promise('query', params.universe, params.project, aq.query).then(function(r) {
      unpackQueryObjects(params.objects, r);
      if (params.objects.length === 0)
        return Promise.reject(new Error("No matching objects."));
      return coroner.promise('control', params);
    }).then((result) => success_cb(result)).catch(std_failure_cb);
  } else {
    if (n_objects > 0) {
      /* May specify just --first or --last, or just all objects. */
      params.objects = argv._.slice(2);
    }
    coroner.promise('control', params).
      then((result) => success_cb(result)).catch(std_failure_cb);
  }
}

function retentionUsage(str) {
  if (str)
    err(str + "\n");
  console.error("Usage: morgue retention <list|set|clear> <name> [options]");
  console.error("");
  console.error("Options for set/clear:");
  console.error("  --type=T         Specify retention type (default: project)");
  console.error("                   valid: instance, universe, project");
  console.error("");
  console.error("Options for set:");
  console.error("  --max-age=N      Specify time limit for objects, in seconds");
  process.exit(1);
}

function bpgObjectFind(objects, type, val, field) {
  if (!objects[type])
    return null;

  if (!field) {
    if (type === "project")
      field = "pid";
    else
      field = "id";
  }

  /* Shortcut to simply return the first value. */
  if (val === null)
    return objects[type][0];

  return objects[type].find(function(o) {
    return o.get(field) === val;
  });
}

function retentionTypeFor(parent_type) {
  if (parent_type === "universe")
    return "universe_retention";
  if (parent_type === "project")
    return "project_retention";
  if (parent_type === "instance")
    return "instance_retention";
  throw new Error("Invalid parent type '" + parent_type + "'");
}

function retentionParent(objects, parent_type, name) {
  return bpgObjectFind(objects, parent_type, name, "name");
}

function retentionSet(bpg, objects, argv, config) {
  var act_obj = {};
  var rules = [{
    criteria: [{type: "object-age", op: "at-least"}],
    actions: [{type: "delete-all"}],
  }];
  var rtn_ptype = argv.type || "project";
  var rtn_type = retentionTypeFor(rtn_ptype);
  var rtn_pname = null;
  var rtn_parent = null;
  var rtn_parent_id = null;
  var obj = null;
  var max_age = argv["max-age"];
  var physical_only = argv["physical-only"];

  if (!max_age) {
    return retentionUsage("Max age is a required argument.");
  }
  if (max_age === "null") {
    /* Special internal value meaning clear the rules. */
    rules = [];
  } else {
    try {
      rules[0].criteria[0].time = timespecToSeconds(max_age).toString();
    } catch (e) {
      return retentionUsage("Invalid max age '" + max_age + "': " + e.message);
    }
  }

  if (physical_only) {
    rules[0].actions[0].subsets = ["physical"];
  }

  if (rtn_type === "instance_retention") {
    if (argv._.length > 0) {
      return retentionUsage("Instances do not have names.");
    }
  } else {
    if (argv._.length != 1) {
      return retentionUsage("Must specify namespace name.");
    }
    rtn_pname = argv._[0];
  }

  /* Determine whether a create or update is needed. */
  if (rtn_pname) {
    var id_attr = rtn_ptype === "project" ? "pid" : "id";
    rtn_parent = retentionParent(objects, rtn_ptype, rtn_pname);
    if (!rtn_parent) {
      return retentionUsage("Unknown " + rtn_ptype + " '" + rtn_pname + "'.");
    }
    rtn_parent_id = rtn_parent.get(id_attr);
    obj = bpgObjectFind(objects, rtn_type, rtn_parent_id, rtn_ptype);
  } else {
    obj = bpgObjectFind(objects, rtn_type, null);
  }

  act_obj.type = "configuration/" + rtn_type;
  if (!obj) {
    act_obj.action = "create";
    act_obj.object = { id: 0, rules: JSON.stringify(rules) };
    if (rtn_parent_id) {
      act_obj.object[rtn_ptype] = rtn_parent_id;
    }
  } else {
    act_obj.action = "modify";
    act_obj.fields = { rules: JSON.stringify(rules) };
    if (rtn_parent_id) {
      act_obj.key = {};
      act_obj.key[rtn_ptype] = rtn_parent_id;
    }
  }

  bpgPost(bpg, { actions: [act_obj] }, function(e, r) {
    if (e) {
      err(e);
      return;
    }
    console.log((r.results[0].text || r.results[0].string).success);
  });
}

function retentionClear(bpg, objects, argv, config) {

  /* Currently, this is essentially set(max-age="null"). */
  if (argv["max-age"]) {
    return retentionUsage("Clear does not take --max-age.");
  }
  argv["max-age"] = "null";

  return retentionSet(bpg, objects, argv, config);
}

function retentionNoString(reason, argv) {
  if (!argv || !argv.debug)
    return null;
  return "max age: unspecified (" + reason + ")";
}

function retentionToString(r_obj, argv) {
  var rules = r_obj.get("rules");
  var json = JSON.parse(rules);
  var rule;
  var action;
  var criterion;
  var s;

  if (Array.isArray(json) === false || json.length === 0)
    return retentionNoString("no rule", argv);
  rule = json[0];
  if (Array.isArray(rule.criteria) === false || rule.criteria.length === 0)
    return retentionNoString("no criterion");
  criterion = rule.criteria[0];
  if (Array.isArray(rule.actions) === false || rule.actions.length === 0)
    return retentionNoString("no actions");
  action = rule.actions[0];

  if (!action.type || action.type !== "delete-all")
    return retentionNoString("wrong action");
  if (!criterion.type || criterion.type !== "object-age")
    return retentionNoString("wrong criterion");

  s = "max age: " + secondsToTimespec(criterion.time);
  if (action.subsets && action.subsets.indexOf("physical") != -1)
    s += ", physical only";

  return s;
}

function retentionList(bpg, objects, argv, config) {
  var r;
  var count = 0;
  var before = 0;

  if (argv._.length > 0) {
    return retentionUsage("List does not take any arguments.");
  }

  if ((r = objects["instance_retention"])) {
    var str = retentionToString(r[0], argv);
    if (str)
      console.log("Instance-level: " + str);
  }

  if ((r = objects["universe_retention"])) {
    before = count;
    r.forEach(function(r_obj) {
      var universe = bpgObjectFind(objects, "universe", r_obj.get("universe"));
      var str = retentionToString(r_obj, argv);
      if (str) {
        if (count === before)
          console.log("Universe-level:");
        count++;
        console.log("  " + universe.get("name") + ": " + str);
      }
    });
  }

  if ((r = objects["project_retention"])) {
    before = count;
    r.forEach(function(r_obj) {
      var project = bpgObjectFind(objects, "project", r_obj.get("project"));
      var str = retentionToString(r_obj, argv);
      if (str) {
        if (count === before)
          console.log("Project-level:");
        count++;
        console.log("  " + project.get("name") + ": " + str);
      }
    });
  }

  if (count === 0) {
    console.log("No retention policies in effect.");
  }
}

function usageRetentionStatus(str) {
  if (str)
    console.log(str.error);
  console.log("Usage: retention status [--type universe|project] [name]".error);
  console.log("Specifying a type requires a name without a slash.");
  return;
}

function critToString(c) {
  var str = c.type;
  var expiry_ts;
  var expiry_time = 0;

  if (c.type === "object-age") {
    var n_o = c.next_object;
    str += " " + c.op + " " + c.value + ";";
    if (n_o.namespace !== null) {
      str += " next namespace " + n_o.namespace + " oid " + n_o.object_id;
      expiry_ts = parseInt(n_o.expiry_time);
      if (expiry_ts && expiry_ts > 0) {
        expiry_time = new Date(expiry_ts * 1000);
        str += " expires at " + expiry_time.toString();
      } else {
        str += " no expiry";
      }
    } else {
      str += " idle, awaiting new objects";
    }
  }
  return str;
}

function retentionSkip(obj, level, name) {
  if (level === "universe" && name === "users")
    return true;
  if (typeof name === 'string' && name.indexOf("_") === 0)
    return true;
  return false;
}

function retentionSublevel(level) {
  if (level === "instance")
    return "universe";
  else if (level === "universe")
    return "project";
  else
    return null;
}

function retentionStatusDump(argv, obj, name, level, indent) {
  var action, crit, header, i, rule, s;
  var spaces = '';

  if (retentionSkip(obj, level, name))
    return;

  for (i = 0; i < indent; i++)
    spaces += ' ';
  header = spaces + level;
  if (name)
    header += " " + name;
  if (obj.state !== "not installed" || !argv.recursive || argv.debug)
    console.log(header + ": policy state: " + obj.state);
  spaces += '  ';

  if (obj.state !== "not installed") {
    rule = obj.rules[0];
    crit = rule.criteria[0];
    action = rule.actions[0];
    if (action.type === 'delete-all' && crit.type === 'object-age') {
      s = critToString(crit);
      if (action.subsets && action.subsets.indexOf("physical") != -1)
        s += " (physical only)";
      console.log(spaces + s);
    }
  }
  if (typeof obj.children === 'object') {
    var keys = Object.keys(obj.children);
    var sublevel = retentionSublevel(level);
    for (i = 0; sublevel !== null && i < keys.length; i++) {
      retentionStatusDump(argv, obj.children[keys[i]], keys[i], sublevel, indent + 2);
    }
  }
}

/**
 * retention status [--type universe|project] [name]
 * -> api/control?action=rpstatus, parse response JSON
 */
function retentionStatus(coroner, argv, config) {
  var params = { action: 'rpstatus' };
  var name = argv._[0];
  var type = argv.type;
  var level = "instance";

  if (argv.recursive)
    params.recursive = true;

  if (argv._.length > 1)
    return usageRetentionStatus();

  if (type != undefined) {
    if (type !== 'project' && type !== 'universe')
      return usageRetentionStatus();
    if (name === undefined)
      return usageRetentionStatus();
    if (name.indexOf("/") != -1)
      return usageRetentionStatus("Type specified, so name must not contain /");
  }

  if (name !== undefined) {
    var p = coronerParams({"_":[null, name]}, config);
    var tmp;
    /* coronerParams parses name; check type for any needed overrides. */
    if (type === 'project') {
      p.project = name;
    } else if (type === 'universe') {
      p.universe = name;
      delete p.project;
    }
    if (p.project !== undefined)
      level = "project";
    else if (p.universe !== undefined)
      level = "universe";
    Object.assign(params, p);
  }

  coroner.promise('control', params).then(function (r) {
    if (argv.raw)
      console.log(JSON.stringify(r, null, 4));
    else
      retentionStatusDump(argv, r, null, level, 0);
  }).catch(std_failure_cb);
}

/**
 * @brief Implements the retention command.
 */
function coronerRetention(argv, config) {
  abortIfNotLoggedIn(config);
  var coroner;
  var bpg;
  var subcmd;
  var fn = null;
  var subcmd_map = {
    set: retentionSet,
    list: retentionList,
    clear: retentionClear,
  };

  argv._.shift();
  if (argv._.length == 0) {
    return retentionUsage("No request specified.");
  }

  subcmd = argv._.shift();
  if (subcmd === "--help" || subcmd == "help")
    return retentionUsage();

  coroner = coronerClientArgv(config, argv);
  /* Special case for retention status which doesn't use BPG. */
  if (subcmd === 'status')
    return retentionStatus(coroner, argv, config);

  bpg = coronerBpgSetup(coroner, argv);

  fn = subcmd_map[subcmd];
  if (fn) {
    return fn(bpg, bpg.get(), argv, config);
  }

  retentionUsage("Invalid retention subcommand '" + subcmd + "'.");
}

function main() {
  var argv = minimist(process.argv.slice(2), {
    "boolean": ['k', 'debug', 'v', 'version'],
    /* Don't convert arguments that are often hex strings. */
    "string" : [ "first", "last", "fingerprint", "attachment-id", "_" ]
  });

  ARGV = argv;

  if (argv.v || argv.version) {
    console.log(packageJson.version);
    process.exit(1);
  }

  if (argv.endpoint) {
    endpoint = argv.endpoint;
  }

  if (argv.token) {
    endpointToken = argv.token;
  }

  var commandName = argv._[0];
  var command = commands[commandName];
  if (!command) return usage();

  promptLib.message = '';
  promptLib.delimiter = ':';
  promptLib.colors = false;
  promptLib.start();

  colors.setTheme({
    error: [ 'red', 'bold' ],
    success: [ 'blue', 'bold' ],
    factor: [ 'bold' ],
    label : [ 'bold', 'yellow' ],
    dim: [ '' ]
  });

  loadConfig(function(err, config) {
    if (err && err.code !== 'ENOENT') {
      errx("Unable to read configuration: " + err.message + ".");
    }

    command(argv, config);
  });
}

//-- vim:ts=2:et:sw=2
