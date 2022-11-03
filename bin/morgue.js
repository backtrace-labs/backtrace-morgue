#!/usr/bin/env node

'use strict';

const axios     = require('axios');
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
const printf    = require('printf');
const moment    = require('moment');
const moment_tz = require('moment-timezone');
const fs        = require('fs');
const mkdirp    = require('mkdirp');
const promptLib = require('prompt');
const path      = require('path');
const table     = require('table').table;
const bt        = require('backtrace-node');
const spawn     = require('child_process').spawn;
const url       = require('url');
const util      = require('util');
const packageJson = require(path.join(__dirname, "..", "package.json"));
const sprintf   = require('extsprintf').sprintf;
const chrono = require('chrono-node');
const zlib      = require('zlib');
const symbold = require('../lib/symbold.js');
const createCsvWriter = require('csv-writer').createObjectCsvWriter;
const Slack = require('slack-node');
const metricsImporterCli = require('../lib/metricsImporter/cli.js');
const alertsCli = require("../lib/alerts/cli");
const timeCli = require('../lib/cli/time');
const queryCli = require('../lib/cli/query');
const { chalk, err, error_color, errx, success_color, warn } = require('../lib/cli/errors');
const bold = chalk.bold;
const cyan = chalk.cyan;
const grey = chalk.grey;
const yellow = chalk.yellow;
const blue = chalk.blue;
const green = chalk.green;
const label_color = yellow.bold;

var flamegraph = path.join(__dirname, "..", "assets", "flamegraph.pl");

var callstackError = false;
var range_start = null;
var range_stop = null;
var endpoint;
var endpointToken;
var reverse = 1;
var ARGV;
const configDir = process.env.MORGUE_CONFIG_DIR ||
  path.join(os.homedir(), ".morgue");
const configFile = path.join(configDir, "current.json");

bt.initialize({
  timeout: 5000,
  endpoint: "https://backtrace.sp.backtrace.io:6098",
  token: "2cfca2efffd862c7ad7188be8db09d8697bd098a3561cd80a56fe5c4819f5d14",
  attributes: {
    version: packageJson.version,
  },
  enableMetricsSupport: false
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

/* Standardized success/failure callbacks. */
function std_success_cb(r) {
  console.log(success_color('Success'));
}

function std_json_cb(r) {
  console.log(success_color('Success:'));
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

  process.stdout.write(grey(sprintf("# %12s %12s %12s %12s %12s %12s %12s\n",
    "Concurrency", "Requests", "Time", "Minimum", "Average",
    "Maximum", "Throughput")));
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
  actions: coronerActions,
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
  cts: coronerCts,
  ci: coronerCI,
  token: coronerToken,
  session: coronerSession,
  access: coronerAccessControl,
  limit: coronerLimit,
  set: coronerSet,
  get: coronerGet,
  put: coronerPut,
  login: coronerLogin,
  logout: coronerLogout,
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
  status: coronerStatus,
  user: coronerUser,
  merge: coronerMerge,
  unmerge: coronerUnmerge,
  "metrics-importer": metricsImporterCmd,
  stability: coronerStability,
  alerts: alertsCmd,
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

    if (Array.isArray(coroner.config.endpoints.post)) {
      var ep = coroner.config.endpoints.post;
      var fu = url.parse(coroner.endpoint);
      var i = Math.max(0, ep.findIndex(ep => ep.protocol === "https"));

      config.submissionEndpoint = ep[i].protocol + '://' +
        fu.hostname + ':' + ep[i].port + '/post';
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

  /* Do this one first so superuser isn't set up before this is. */
  const cons_l = model.listener.find((l) => {
    return l.get('type') === 'http/console';
  });
  if (cons_l) {
    const dns_name = cons_l.get('dns_name');
    if (!dns_name || dns_name.length === 0)
      return coronerSetupDns(coroner, bpg, cons_l);
  }

  if (!model.universe || model.universe.length === 0)
    return coronerSetupUniverse(coroner, bpg);

  if (!model.users || model.users.length === 0)
    return coronerSetupUser(coroner, bpg);

  process.stderr.write(
    'Please use a web browser to complete setup:\n');
  process.stderr.write(cyan.bold(coroner.endpoint + '/config/' + model.universe[0].get('name') + '\n'));
  return;
}

function coronerSetupDns(coroner, bpg, cons_l) {
  console.log(bold('Specify DNS name users will use to reach the server'));
  console.log(
    'We must specify this so that services accessing the server via SSL\n' +
    'can reach it without skipping validation.\n');

  promptLib.get([
    {
      name: 'dns_name',
      description: 'DNS name',
      pattern: /^(([a-zA-Z0-9]|[a-zA-Z0-9][a-zA-Z0-9\-]*[a-zA-Z0-9])\.)*([A-Za-z0-9]|[A-Za-z0-9][A-Za-z0-9\-]*[A-Za-z0-9])$/,
      type: 'string',
      required: true,
    }
  ], (error, result) => {
    var model = bpg.get();

    if (!result || !result.dns_name) {
      errx('No DNS name provided.');
    }

    bpg.modify(cons_l, { dns_name: result.dns_name });
    bpg.commit();

    return coronerSetupNext(coroner, bpg);
  });
}

function coronerSetupUser(coroner, bpg) {
  console.log(bold('Create an administrator'));
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
  console.log(bold('Create an organization'));
  console.log(
    'We must configure the organization that is using the object store.\n' +
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

  process.stderr.write(bold('Determining system state...'));

  coroner.get('/api/is_configured', '', function(error, response) {
    response = parseInt(response + '');

    if (response === 0) {
      process.stderr.write(red('unconfigured\n'));
      return coronerSetupStart(coroner, argv);
    } else {
      process.stderr.write(green('configured\n\n'));

      console.log(bold('Please login to continue setup.'));
      return coronerLogin(argv, config, coronerSetupStart);
    }
  });
}

function userUsage(error_str) {
  if (typeof error_str === 'string')
    err(error_str + '\n');
  console.log("Usage: morgue user reset [options]");
  console.log("Valid options:");
  console.log("  --password=P   Specify password to use for reset.");
  console.log("  --universe=U   Specify universe scope.");
  console.log("  --user=USER    Specify user to reset password for");
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
      console.log(success_color("User successfully modified."));
    } catch(e) {
      return Promise.reject(e);
    }
  });

  sequence(tasks).catch((e) => {
    err(e.toString());
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
  console.log(util.inspect(o, {showHidden: false, depth: null}));
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
    console.log(success_color('Success.'));
  });
}

function coronerMerge(argv, config) {
  return _coronerMerge(argv, config, 'merge');
}

function coronerUnmerge(argv, config) {
  return _coronerMerge(argv, config, 'unmerge');
}

/*
 * Usage: ci <project> --run=<attribute> --tag=<branch> <value> --slack=<base> --target=<channel>
 *
 * coroner ci cts run sbahra-123 --slack=292191/12392139/119212912 --target=#build
 */
function coronerCI(argv, config) {
  abortIfNotLoggedIn(config);
  var coroner = coronerClientArgv(config, argv);
  let message = '';
  let slack;

  let universe = argv.universe;
  if (!universe) {
    universe = Object.keys(config.config.universes)[0];
  }

  let project = argv._[1];
  let value = argv._[2];
  let attribute = argv.run;

  /* Get a summary of issues found by tool for a given run. */
  let query = queryCli.argvQuery(argv);
  let q_v = query.query;
  q_v.filter[0][attribute] = [ [ "equal", value ] ];
  q_v.filter[0]['fingerprint;issues;state'] = [ [ "regular-expression", "open|progress" ] ];
  q_v.group = ["tool"];
  q_v.fold = {};
  q_v.fold.fingerprint = [[ "unique" ]];

  if (!argv.terminal && argv.slack && argv.target) {
    slack = new Slack();
    slack.setWebhook('https://hooks.slack.com/services/' + argv.slack);
  }

  coroner.query(universe, project, q_v, function(err, result) {
    if (err) {
      errx(err.message);
    }

    var rp = new crdb.Response(result.response);
    rp = rp.unpack();

    let total_f = 0;
    let total_c = 0;
    for (let j in rp) {
      total_f += rp[j]['unique(fingerprint)'][0];
      total_c += rp[j].count;
    }

    delete q_v.filter[0][attribute];
    q_v.filter[0]['fingerprint;issues;tags'] = [["contains", argv.tag]];
    q_v.fold.classifiers = [[ "distribution" ]];
    delete q_v.group;

    coroner.query(universe, project, q_v, function(err, result) {
      if (err) {
        errx(err.message);
      }

      var rp = new crdb.Response(result.response);
      rp = rp.unpack();

      let fields = [];

      fields.push({title:"",short:false,value:""});

      let open_count = 0;
      if (rp && rp['*'] && rp['*'].count > 0) {
        open_count = rp['*'].count;

        fields.push({
          title: "Failure",
          value: open_count + ' regressions introduced in `' +
              argv.tag + '` in an open state.\n'
        });

        let d_v = rp['*']['distribution(classifiers)'][0].vals;

        for (var i = 0; i < d_v.length; i++) {
          if (d_v[i][0].length > 32)
            d_v[i][0] = d_v[i][0].substring(0, 16) + '...';

          fields.push({ title: "`" + d_v[i][0] + "`", value: d_v[i][1] + "", "short" : true });
        }
      } else {
        fields.push({
          title: "Success",
          value: "No open regressions found."
        });
      }

      message += 'Found ' + total_c + ' errors across ' + total_f + ' open issues.\n';

      function c_url(a, o, v) {
        return config.endpoint + "/p/" + project + "/triage?time=month&filters=((" +
          a + "%2C" + o + "%2C" + v + ")%2C(fingerprint%3Bissues%3Bstate%2Cregex%2Copen%7Cprogress))";
      }

      fields.push({title:"",short:false,value:""});

      if (argv.author) {
        fields.push({
          title: "Author",
          short: true,
          value: argv.author
        });
      }

      if (argv.build) {
        fields.push({
          title: "Build",
          short: true,
          value: argv.build + ""
        });
      }

      if (total_f > 0 || open_count > 0) {
        fields.push({
          title: "Actions",
          short: false,
          value:
            "<" + c_url("fingerprint%3Bissues%3Btags", "contains", argv.tag) + "|View regressions> | " +
            "<" + c_url(argv.run, "equal", value) + "|View all defects>"
        });
      }

      if (! argv.terminal) {
        if (slack) {
          if (argv.author) {
            slack.webhook({
              channel: '@' + argv.author,
              username: 'Backtrace',
              attachments: [
                {
                  color : open_count > 0 ? "#FF0000" : "good",
                  footer: "Backtrace",
                  footer_icon: "https://backtrace.io/images/icon.png",
                  author_name: value,
                  ts: parseInt(Date.now() / 1000),
                  fields: fields,
                  text: message
                }
              ]
            }, function (e, r) {
            });
          }

          slack.webhook({
            channel: argv.target,
            username: 'Backtrace',
            attachments: [
              {
                color : open_count > 0 ? "#FF0000" : "good",
                footer: "Backtrace",
                footer_icon: "https://backtrace.io/images/icon.png",
                author_name: value,
                ts: parseInt(Date.now() / 1000),
                fields: fields,
                text: message
              }
            ]
          }, function (e, r) {
          });
        }
      } else {
        console.log(JSON.stringify({msg: message, fields: fields}));
      }
    });
  });
}

/*
 * Usage: cts <project> <attribute> <target>
 *
 * Sets marker for uniquely introduced issues.
 */
function coronerCts(argv, config) {
  /* First extract a list of all fingerprint values for the given target. */
  abortIfNotLoggedIn(config);
  var coroner = coronerClientArgv(config, argv);

  let universe = argv.universe;
  if (!universe)
    universe = Object.keys(config.config.universes)[0];

  let project = argv._[1];
  let attribute = argv._[2];
  let value = argv._[3];

  let query = queryCli.argvQuery(argv);
  let q_v = query.query;
  q_v.filter[0][attribute] = [ [ "equal", value ] ];
  q_v.filter[0]["fingerprint;issues;tags"] = [ [ "not-contains", value ] ];
  q_v.group = ["fingerprint"];
  q_v.fold = {};
  q_v.fold[attribute] = [[ "count" ]];

  if (argv.query) {
    console.log(JSON.stringify(q_v, null, 2));
    return;
  }

  let fingerprint = {};

  coroner.query(universe, project, q_v, function(err, result) {
    if (err) {
      errx(err.message);
    }

    var rp = new crdb.Response(result.response);
    rp = rp.unpack();

    for (var k in rp) {
      fingerprint[k] = true;
    }

    /* Now we have suspect fingerprints. Eliminate those not unique to the run. */
    delete(q_v.filter[0][attribute]);
    q_v.fold[attribute] = [ [ "distribution", 8192 ] ];
    coroner.query(universe, project, q_v, function(err, result) {
      if (err) {
        errx(err.message);
      }

      var rp = new crdb.Response(result.response);
      rp = rp.unpack();

      for (var k in rp) {
        if (!fingerprint[k])
          continue;

        var dt = rp[k]["distribution(" + attribute + ")"][0];
        if (dt.keys > 1)
          delete fingerprint[k];
      }

      /* Construct a query to set tags for each of these issues. */
      delete(q_v.group);
      delete(q_v.fold);

      let n_issues = Object.keys(fingerprint).length;
      if (n_issues === 0) {
        console.log('No new issues introduced.');
        return;
      } else {
        console.log('Setting tag ' + value + ' on ' + n_issues + ' issues.');
      }

      let filter_string = '';
      let first = true;

      for (var k in fingerprint) {
        if (first === false)
          filter_string += '|';
        filter_string += '^' + k + "$";
        first = false;
      }

      q_v.filter[0].fingerprint = [ [ "regular-expression", filter_string ] ];
      delete q_v.filter[0].timestamp;
      q_v.set = {"tags" :  value + ""};
      q_v.table = "issues";
      q_v.select = ["tags"];
      delete q_v.filter[0]["fingerprint;issues;tags"];
      q_v.filter[0]["tags"] = [ [ "not-contains", value ] ];

      coroner.query(universe, project, q_v, function(error, result) {
        if (err) {
          errx(err.message);
        }
      });
      return;
    });
  });
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

      console.log(success_color('Logged out.'));
  });
}

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

  let team = bpg.new('team');
  team.set('name', teamName);
  team.set('universe', universeId);
  team.set('id', 0);
  bpg.create(team);
  bpg.commit();
}

function coronerTeamDelete({bpg, argv, model}) {
  const teamName = argv._[3];

  let team = model.team.find(function(t) {
    return t.get('name') == teamName;
  });
  if (team === undefined) {
    err("Team not found");
    return;
  }
  bpg.delete(team);
  bpg.commit();
}

function coronerTeamList({argv, universeId, model}) {
  model.team.filter(t => t.get('universe') == universeId).forEach(t => {
    console.log(t.get('name'));
  });
}

function coronerTeamUserAdd({bpg, argv, universeId, model}) {
  const teamName = argv._[3];
  const userName = argv._[4];

  const team = model.team.find(function(t) {
    return t.get('name') == teamName;
  });
  if (team === undefined) {
    err("Team not found");
    return;
  }

  const user = model.users.find(function(u) {
    return u.get('username') == userName;
  });
  if (user === undefined) {
    err("User not found");
    return;
  }

  let tm = bpg.new('team_member');
  tm.set('team', team.get('id'));
  tm.set('user', user.get('uid'));
  bpg.create(tm);
  bpg.commit();
}

function coronerTeamUserDelete({bpg, argv, universeId, model}) {
  const teamName = argv._[3];
  const userName = argv._[4];

  let team = model.team.find(function(t) {
    return t.get('name') == teamName;
  });
  if (team === undefined) {
    err("Team not found");
    return;
  }

  const user = model.users.find(function(u) {
    return u.get('username') == userName;
  });
  if (user === undefined) {
    err("User not found");
    return;
  }

  const tm = model.team_member.find(function(tm) {
    return tm.get('user') == user.get('uid') && tm.get('team') == team.get('tid');
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
  let team = model.team.find(function(t) {
    return t.get('name') == teamName;
  });
  if (team === undefined) {
    err("Team not found");
    return;
  }
  const teamId = team.get('id');

  const idToUser = function() {
    let ret = {}
    const arr = model.users.map(u => [u.get('uid'), u.get('username')]);
    arr.forEach((a) => ret[a[0]] = a[1])
    return ret
  }();

  console.log(blue("Team members:"))
  model.team_member.filter(tm => tm.get('team') == teamId).forEach(function(tm) {
    const name = idToUser[tm.get('user')] || '<unknown_name>';
    console.log(` - ${name}`);
  });

  console.log(blue("\nTeam is a member of projects:"));
  model.project_member_team.filter(pm => pm.get('team') == teamId).forEach(pm => {
    const projectBpg = model.project.find(p => p.get('pid') == pm.get('project'));
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
  if (project === undefined)
    errx(`project not found: ${projectName}`.red);

  const id = idSupply[mode](suppliedName);

  if (role === undefined)
    errx('need to supply role'.red);
  if (role.match(/(guest|member|admin)/) == false)
    errx('unknown role'.red);

  let add = bpg.new(`project_member_${mode}`);
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
  if (project === undefined)
    errx(`project not found: ${projectName}`.red);

  let bpgObject = model[`project_member_${mode}`].find(pm => pm.get(mode) == id && pm.get('project') == project.get('pid'));
  if (bpgObject === undefined)
    errx(`${mode} not found for project ${projectName}`);

  bpg.delete(bpgObject);
  bpg.commit();
}

function coronerProjectAccessDetails({argv, model}) {
  const projectName = argv._[2];
  const project = model.project.find(p => p.get('name') == projectName);
  if (project === undefined)
    errx(`project not found: ${projectName}`.red);

  const users = model.project_member_user.filter(pm => pm.get('project') == project.get('pid'));
  const teams = model.project_member_team.filter(pm => pm.get('project') == project.get('pid'));

  if (users.length == 0 && teams.length == 0) {
    console.log(`Project ${projectName} has no access control`);
    return;
  }

  console.log('Teams:')
  teams.forEach(pm => {
    const team = model.team.find(t => t.get('id') == pm.get('team'))
    if (team === undefined)
      errx(`Team ${pm.get('team')} not found`)
    console.log(`${team.get('name')} - ${pm.get('role')}`);
  })
  console.log("--\n")
  console.log('Users:')
  users.forEach(pm => {
    const user = model.users.find(u => u.get('uid') == pm.get('user'))
    if (user === undefined)
      errx(`User ${pm.get('user')} not found`)
    console.log(`${user.get('username')} - ${pm.get('role')}`);
  })
  console.log("--\n")
}

/**
 * @brief Implements the limit command.
 */
function coronerAccessControl(argv, config) {
  var options = null;

  abortIfNotLoggedIn(config);
  var coroner = coronerClientArgv(config, argv);

  let universe = argv.universe;
  if (!universe)
    universe = Object.keys(config.config.universes)[0];

  let bpg = coronerBpgSetup(coroner, argv);
  let model = bpg.get();

  let universeId;
  /* Find the universe with the specified name. */
  for (let i = 0; i < model.universe.length; i++) {
    if (model.universe[i].get('name') === universe) {
      const un = model.universe[i];
      universeId = un.get('id');
    }
  }
  if (universeId === undefined) {
    errx("Universe not found".red);
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
      team: (suppliedName) => {
        const t = model.team.find(t => t.get('name') == suppliedName);
        if (t === undefined)
          errx(`team not found: ${suppliedName}`.red);
        return t.get('id');
      },
      user: (suppliedName) => {
        const u = model.users.find(u => u.get('username') == suppliedName);
        if (u === undefined)
          errx(`user not found: ${suppliedName}`.red);
        return u.get('uid');
      }
    };

    const params = {
      bpg: bpg,
      argv: argv,
      model: model,
      idSupply: idSupply,
    }

    const actionHandlers = {
      'add-team': (ps) => coronerProjectAddTeamUser(Object.assign({mode: 'team'}, ps)),
      'remove-team': (ps) => coronerProjectRemoveTeamUser(Object.assign({mode: 'team'}, ps)),
      'add-user': (ps) => coronerProjectAddTeamUser(Object.assign({mode: 'user'}, ps)),
      'remove-user': (ps) => coronerProjectRemoveTeamUser(Object.assign({mode: 'user'}, ps)),
      'details': coronerProjectAccessDetails,
    }

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

    coroner.http_get('/api/limits', {universe: universe, token: coroner.config.token}, null, function(error, result) {
      if (error)
        errx(error + '');

      var rp = JSON.parse(result.bodyData);

      for (var uni in rp) {
        if (un && un.get('name') !== uni)
          continue;

        var st = printf("%3d %16s limit=%d,counter=%d,rejected=%d",
            rp[uni].id, bold(uni),
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
	break;
      }
    }

    if (!un)
      errx('universe not found');

    if (action === 'reset') {
      var limit;

      console.log('Resetting limits for [' + un.get('id') + '/' + un.get('name') + ']...');

      for (var i = 0; i < model.limits.length; i++) {
        if (model.limits[i].get('universe') === un.get('id')) {
          limit = model.limits[i];
          break;
        }
      }

      if (!limit)
        errx('Specified universe has no limits.');

      bpg.delete(limit);
      bpg.commit();
      bpg.create(limit);
      bpg.commit();
      return;
    }

    if (action === 'delete') {
      var limit;

      if (!un)
        errx('Usage: morgue limit delete --universe=<universe>');

      for (var i = 0; i < model.limits.length; i++) {
        if (model.limits[i].get('universe') === un.get('id')) {
          limit = model.limits[i];
        }
      }

      if (!limit)
        errx('Limit not found.');

      console.log(('Deleting limit [' +
          yellow(limit.get('universe') + ']...')));
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

      console.log(success_color('Limit successfully created.'));
      return;
    }

    errx('Unknown subcommand.');
  }
}

function tenantURL(config, tn) {
  /*
   * If there is no current universe, return the URL unchanged.
   * If this were just a split on ., it'd probably change the root domain
   * in this case.
   */
  if (!config.config.universe)
    return config.endpoint;

  const uname = config.config.universe.name;
  let pattern = uname;
  let replacement = tn;

  const tsep = config.config.tenant_separator;
  if (tsep) {
    /*
     * Since the universe name and separator are known, go ahead and be
     * stricter.
     *
     * For example, this would prevent localhost from becoming otherhost if
     * moving from universe local to universe other.
     */
    pattern += tsep;
    replacement += tsep;
  }

  return config.endpoint.replace(pattern, replacement);
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

    console.log(success_color('Invitation successfully deleted.'));
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

    console.log(success_color('Invitation successfully created for ' + email));

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

      process.stderr.write(blue('Persisting...'));

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

        process.stderr.write(success_color('done\n'));
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
        console.log(success_color('\nSuccess.'));
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
        console.log(success_color('\nSuccess.'));
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

        console.log(success_color('Tenant successfully deleted.'));
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

    console.log('Tenant successfully created at ' +
      success_color(tenantURL(config, name)));
    console.log(blue('Wait a few minutes for propagation to complete.'));
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
      console.log(success_color('No API tokens found.'));
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

      console.log(bold(token.get('id')));
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

      console.log(bold(token.get('id')));
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
        yellow(token.get('id') + ']...')));
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

    console.log(success_color('API token successfully created.'));
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
              r = success_color('success');
            } else {
              r = error_color('FAILURE');
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

        console.log(success_color((argv._[2] + ' is deactivated.')));
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

        console.log(success_color((argv._[2] + ' is activated.')));
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
                r = green(r);
              } else if (r == 'failure') {
                r = red(r);
              }

              m[i].message = m[i].message.replace(/[\x00-\x1F\x7F-\x9F]/g, "…").substring(0, 100);
              data.push([d.toLocaleString(),
                m[i].universe,
                r, m[i].message]);
            }

            console.log(bold(log));
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
            l = bold(l) + " [" + hs[i].buffer[0] + ", " + hs[i].buffer[1] + "]";
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
            err(sprintf("%3d %s has not been activated (%s)",
                ++ji, hi, hs[hi].message));
          } else {
            console.log(printf("%3d %s has been activated.",
                ++ji, success_color(hi)));
          }
        }

        if (ji === 0) {
          err('No histograms activated.');
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
            err(sprintf("%3d %s has not been activated (%s)",
                ++ji, hi, hs[hi].message));
          } else {
            console.log(printf("%3d %s has been deactivated.",
                ++ji, success_color(hi)));
          }
        }

        if (ji === 0) {
          err('No histograms deactivated.');
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
      console.log(success_color('No scheduled reports found.'));
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
          bold(report.get('title'))));

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
            yellow(model.report[i].get('title') + ']...')));
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

        console.log(success_color('Report scheduled for immediate sending.'));
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
    var aq = queryCli.argvQuery(argv);
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
      warn('no period specified, defaulting to weekly');
      period = 'week';
    }

    if (!timezone) {
      timezone = moment_tz.tz.guess();
      warn('no timezone specified, defaulting to ' + timezone);
    }

    if (!hour) {
      warn('no hour specified, defaulting to 9AM');
      hour = 9;
    }

    if (!day) {
      day = 1;

      if (period !== 'day')
        warn('no day specified, defaulting to Monday');
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

    console.log(success_color('Report successfully created.'));
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

      console.log(success_color('Success'));
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
        if (hr.headers["content-encoding"] === "gzip" && (params.resource === "json.gz" || params.resource === "txt.gz")) {
          let unzippedBodyData;
          try {
            unzippedBodyData = zlib.gunzipSync(hr.bodyData);
          }
          catch (error) {
            console.log('Unable to decompress json data');
          }
          if (unzippedBodyData) hr.bodyData = unzippedBodyData;
        }
        fs.writeFileSync(fname, hr.bodyData);
        console.log(success_color(sprintf('Wrote %ld bytes to %s', hr.bodyData.length, fname)));
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
      console.log(success_color(sprintf('Fetched %d of %d objects.', success, objects.length)));
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

  if (argv.r)
    options.disabled = true;

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
            process.stdout.write(grey((name + ': [unused] ' + it.description)));
          } else {
            process.stdout.write(blue(name) + ': ' + it.description);
          }
        } else {
          if (it.statistics && it.statistics.used === false) {
            process.stdout.write(grey(name + ': [unused] ' + it.description));
          } else {
            process.stdout.write(yellow(name) + ': ' + it.description);
          }
        }

        if (it.format)
          process.stdout.write(grey(` [${it.format}]`));

      } else if (it.state === 'disabled') {
        process.stdout.write(grey(name + ': [disabled] (Seen at ' + new Date(it.seen * 1000) + " with a value of \"" + it.value + "\")"));
      }

      if (argv.l && it.filter) {
        var sp = Array(ml).join(" ");
        process.stdout.write('\n');

        process.stdout.write(grey(sprintf("%*s: ", "Group", ml)) + it.group + '\n');

        process.stdout.write(grey(sprintf("%*s:\n", "Filter", ml)));
        for (var j = 0; j < it.filter.length; j++) {
          process.stdout.write(sp + it.filter[j] + '\n');
        }

        process.stdout.write(grey(sprintf("%*s:\n", "Aggregate", ml)));
        for (var j = 0; j < it.filter.length; j++) {
          process.stdout.write(sp + it.filter[j] + '\n');
        }
      }
      process.stdout.write('\n');
    }

    if (unused > 0) {
      console.log(grey.bold('\nHiding ' + unused + ' unused attributes (-a to list all).'));
    }
  });
}

function attachmentUsage(error_str) {
  if (typeof error_str === 'string')
    err(error_str + '\n');
  console.log("Usage: morgue attachment <add|get|list|delete> ...");
  console.log("");
  console.log("  morgue attachment add [options] <[universe/]project> <oid> <filename>");
  console.log("");
  console.log("    --content-type=CT    Specify Content-Type for attachment.");
  console.log("                         The server may auto-detect this.");
  console.log("    --attachment-name=N  Use this name for the attachment name.");
  console.log("                         Default is the same as the filename.");
  console.log("");
  console.log("  morgue attachment get [options] <[universe/]project> <oid>");
  console.log("");
  console.log("    Must specify one of:");
  console.log("    --attachment-id=ID   Attachment ID to delete.");
  console.log("    --attachment-name=N  Attachment name to delete.");
  console.log("    --attachment-inline  Attachment is inline.");
  console.log("");
  console.log("  morgue attachment list [options] <[universe/]project> <oid>");
  console.log("");
  console.log("  morgue attachment delete [options] <[universe/]project <oid>");
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
    console.log(success_color(sprintf("Attached '%s' to object %s as id %s.",
      r.attachment_name, r.object, r.attachment_id)));
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
      console.log(success_color(sprintf('Wrote %ld bytes to %s', hr.bodyData.length, fname)));
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

  process.stderr.write(blue('Warming up...') + '\n');

  if (argv.samples)
    n_samples = parseInt(argv.samples);

  if (argv.concurrency)
    concurrency = parseInt(argv.concurrency);

  process.stderr.write(yellow('Injecting: '));
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
    process.stderr.write(blue('.'));
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
      console.log(blue(sprintf('Object IDs: %s', JSON.stringify(objects))));
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
  var formats = {
    'btt' : true,
    'minidump' : true,
    'json' : true,
    'symbols' : true,
    'symbols-proguard': true,
    'sourcemap': true
  };
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
  if (argv.symbolication_id !== undefined)
    p.symbolication_id = argv.symbolication_id;
  if (p.format ==='symbols-proguard') {
    p.format = 'proguard';
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

console.log(p)

  var success_cb = function(r, path) {
    if (r.fingerprint) {
      console.log(success_color(sprintf("%s: Success: %s, fingerprint: %s.", path,
        r.unique ? "Unique" : "Not unique", r.fingerprint)));
    } else {
      console.log(success_color(sprintf("%s: Success.", path)));
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
      console.log(success_color('Success.'));
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
    timeCli.secondsToTimespec(backoffs.reset_interval));
  backoffs.backoffs.forEach((bucket) => {
    buckets += sprintf(" %d/%s", bucket.count,
      timeCli.secondsToTimespec(bucket.interval));
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
        next = sprintf("after %s", timeCli.secondsToTimespec(next_time - now));
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

function parseBool(value) {
  if (typeof value === 'boolean') {
    return value;
  }
  if (typeof value === 'number') {
    return value != 0;
  }
  const recognized_bools = new Set(["yes", "true", "on", "1"]);
  return recognized_bools.has(value);
}

function samplingConfigFromArgv(argv) {
  /*
   * For now all we support is backoff; don't expose as an arg.
   */
  const type = 'backoff';

  let attributes = argv.attribute;
  if (attributes === undefined) {
    attributes = [];
  }
  if (!Array.isArray(attributes)) {
    attributes = [ attributes ];
  }

  let backoffsUnparsed = argv.backoff;
  if (backoffsUnparsed === undefined) {
    errx("At least one --backoff is required");
  }
  if (!Array.isArray(backoffsUnparsed)) {
    backoffsUnparsed = [ backoffsUnparsed ];
  }

  /*
   * Each backoff is count,interval.
   */
  let backoffs = [];
  for (let unparsed of backoffsUnparsed) {
    let split = unparsed.split(",");
    if (split.length !== 2) {
      errx("Usage of --backoff is --backoff count,interval");
    }
    let [countStr, intervalStr] = split;
    let interval = timeCli.parseTimeInt(intervalStr);
    let count = Number.parseInt(countStr);
    if (Number.isNaN(count)) {
      errx("Backoff counts must be valid integers");
    }
    backoffs.push({ count, interval });
  }

  /* Set the non-optional fields. */
  let config = {
    type,
    backoffs,
    object_attributes: attributes,
  };

  if (argv["reset-interval"] !== undefined) {
    if (Array.isArray(argv["reset-interval"])) {
      errx("Only one --reset-interval is allowed");
    }
    config.reset_interval = timeCli.parseTimeInt(argv["reset-interval"]);
  }

  config.missing_symbols = {};
  const keepWhitelisted = argv["process-whitelisted"];
  if (keepWhitelisted !== undefined) {
    config.missing_symbols.process_whitelisted = parseBool(keepWhitelisted);
  }
  const keepPrivate = argv["process-private"];
  if (keepPrivate !== undefined) {
    config.missing_symbols.process_private = parseBool(keepPrivate);
  }

  let bucketsUnparsed = argv.buckets;
  if (bucketsUnparsed !== undefined) {
    if (typeof bucketsUnparsed !== 'number') {
      errx("--buckets must be integer");
    }
    config.buckets = bucketsUnparsed;
  }

  const resetIntervalUnparsed = argv["reset-interval"];
  if (resetIntervalUnparsed !== undefined) {
    config.reset_interval = timeCli.parseTimeInt(resetIntervalUnparsed);
  }
  return config;
}

function samplingConfigure(coroner, argv, config) {
  let universe = argv.universe;
  if (!universe) {
    universe = Object.keys(config.config.universes)[0];
  }

  let project = argv.project;

  if (!universe) {
    errx("--universe is required");
  }

  if (!project) {
    errx("--project is required");
  }

  let bpg = coronerBpgSetup(coroner, argv);
  let model = bpg.get();

  /* Find universe. */
  let uid = 0;
  for (let u of model.universe) {
    if (u.get("name") === universe) {
      uid = u.get("id");
    }
  }

  if (uid == 0) {
    errx("Universe not found");
  }

  let pid = 0;
  for (let p of model.project) {
    if (p.get("universe") === uid && p.get("name") == project) {
      pid = p.get("pid");
    }
  }

  if (pid === 0) {
    errx("Project not found");
  }
  
  let disabled = argv.disable ? 1 : 0;

  let projectSampling = null;
  if (model.project_sampling) {
    for (let cfg of model.project_sampling) {
      if (cfg.get("project") === pid) {
        projectSampling = cfg;
      }
    }
  }

  if (argv.clear) {
    if (projectSampling) {
      bpg.delete(projectSampling);
      bpg.commit();
    }
    console.log(`Sampling configuration cleared. Project ${ project } will use coronerd.conf defaults.`);
    return;
  }

  let configurationObj = {};
  if (projectSampling) {
    configurationObj = JSON.parse(projectSampling.get("configuration"));
  }

  /*
   * Allow --disable by itself, by not trying to parse the config
   */
  if (disabled === 0) {
    configurationObj = samplingConfigFromArgv(argv);
  }

  const configuration = JSON.stringify(configurationObj);
  if (projectSampling) {
    bpg.modify(projectSampling, { disabled, configuration });
  } else {
    const obj = bpg.new("project_sampling").withFields({
      project: pid,
      configuration,
      disabled
    });
    bpg.create(obj);
  }

  bpg.commit();
  console.log("Sampling configuration applied");
  if (disabled == 1) {
    console.log(`Project ${ project } now has sampling explicitly disabled.
Changes in coronerd.conf will not enable sampling for this project.`);
    console.log(yellow("To use coronerd.conf defaults, use --clear instead"));
  }
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
    configure: samplingConfigure,
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

function statusUsage(error_str) {
  if (typeof error_str === 'string')
    err(error_str + '\n');
  console.log("Usage: morgue status <type> ...".error);
  process.exit(1);
}

function statusReload(argv, config, params, coroner) {
  const p = {
    action: 'status',
    token: coroner.config.token,
  };

  coroner.promise('post', '/api/control', null, p, null).then((rsp) => {
    console.log(JSON.stringify(rsp, null, 4));
  }).catch(std_failure_cb);
}

/**
 * @brief Implements the status command.
 */
function coronerStatus(argv, config) {
  abortIfNotLoggedIn(config);
  var fn, object, params, subcmd;
  var coroner = coronerClientArgv(config, argv);
  var subcmds = {
    reload: statusReload,
  };

  if (argv._.length < 2)
    statusUsage("Not enough arguments specified.");

  argv._.shift();
  /* Extract u/p at this point since they'll be in the correct position. */
  params = coronerParams(argv, config);
  subcmd = argv._.shift();
  fn = subcmds[subcmd];
  if (!fn)
    statusUsage("No such subcommand " + subcmd);

  argv._.shift();
  fn(argv, config, params, coroner);
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

        console.log(bold('Archives'));
        console.log(table(data, tableFormat));
      }

      if (response.symbols && response.symbols.count) {
        data[1] = [
          new Date(response.symbols.first_updated_time * 1000),
          new Date(response.symbols.last_updated_time * 1000),
          response.symbols.count
        ];

        console.log(bold('Symbols'));
        console.log(table(data, tableFormat));
      }

      if (response.missing_symbols && response.missing_symbols.count) {
        data[1] = [
          new Date(response.missing_symbols.first_crash_time * 1000),
          new Date(response.missing_symbols.last_crash_time * 1000),
          response.missing_symbols.count
        ];

        console.log(bold('Missing Symbols'));
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
          console.log(yellow('Tag: ') + response[i].tag);
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
          console.log(yellow('Tag: ') + tags[i].tag);
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
      console.log(success_color('No scrubber found.'));
      return;
    }

    for (var i = 0; i < model.scrubber.length; i++) {
      var scrubber = model.scrubber[i];
      var widgets;

      if (scrubber.get('project') != pid)
        continue;

      console.log(bold('[' + scrubber.get('id') + '] ' +
          scrubber.get('name')));

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
            yellow(model.scrubber[i].get('name') + ']...')));
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

    console.log(success_color('Scrubber successfully created.'));
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

    console.log(success_color('Scrubber successfully modified.'));
  }
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
      err(`${name} ${type} failed: ${e}`);
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
          pcs += red.bold(fr_a[j]);
        } else {
          pcs += yellow(fr_a[j]);
        }
      } else {
        pcs += fr_a[j];
      }
    } else {
      pcs += red.bold(fr_a[j]);
    }
  }

  return pcs;
}

const similarityParams = ['threshold', 'intersection', 'distance', 'truncate'];
const similarityDefaultFilter = [{ timestamp: [['at-least', '1.']] }];
async function coronerSimilarity(argv, config) {
  abortIfNotLoggedIn(config);

  const similarityService = config.config.services.find(service => {
    return service.name === 'similarity';
  });

  if (!similarityService || !similarityService.endpoint) {
    errx('morgue similarity is unavailable on your host');
  }
  
  const coroner = coronerClientArgv(config, argv);
  const similarityEndpoint = similarityService.endpoint.startsWith('http') ?
      similarityService.endpoint :
      `${coroner.endpoint}${similarityService.endpoint}`;

  if (argv._.length < 2) {
    return usage("Missing project, universe arguments.");
  }

  let fingerprint;
  if (argv.fingerprint) {
    fingerprint = argv.fingerprint;
    delete argv.fingerprint;
  }
  const project = coronerParams(argv, config).project;
  const xCoronerToken = config.config.token;
  const xCoronerLocation = config.endpoint;
  
  // Default options
  const candidacyOptions = {
    type: 'distance',
    truncate: 100,
    distance: 10,
    intersection: 1,
    threshold: 1
  };
  const limit = argv.limit || 20;
  const filter = argv.filter || similarityDefaultFilter;

  similarityParams.forEach(param => {
    if (argv[param]) {
      candidacyOptions[param] = argv[param];
    }
  });

   let body;
   let url;
   
   // If we have fingerprint, get candidates. Otherwise get project summary.
   const requestType = fingerprint ? 'candidates' : 'summary';
   if (requestType === 'candidates') {
     body = {
      project,
      fingerprint,
      candidacy: [ candidacyOptions ],
      limit,
    };
    url = `${similarityEndpoint}/candidates`;
   } else {
     body = {
      project,
      candidacy: candidacyOptions,
      filter,
      limit,
    }
    url = `${similarityEndpoint}/summary`;
   }

   let results;
   try {
    results = await axios.post(url, body, { headers: {
      'x-coroner-token': xCoronerToken,
      'x-coroner-location': xCoronerLocation,  
    }});
   } catch(err) {
     errx(err);
   }

   if (argv.json) {
    console.log(JSON.stringify(results.data, null, 2));
    return;
   }
   results = results.data;
   if (results.error) {
    return errx(results.error);
   } else {
     results = results.results;
   }

   // Render results 
   switch(requestType) {
     case 'candidates': {
       const meta = results[0].meta; 
       let disqualified = 0;
       Object.keys(meta.disqualified).forEach(k => {
         disqualified += meta.disqualified[k];
        });
       console.log('\n Disqualified: ', disqualified);
       let disqual_table = [[
         'by Threshold',
         'by Intersection',
         'by Distance'
        ], [
          meta.disqualified.byThreshold,
          meta.disqualified.byIntersection,
          meta.disqualified.byDistance
        ]];
      console.log(table(disqual_table));
      console.log('\n Qualified: ', meta.qualified);
      const candidates = results[0].candidates;
      let canidate_data = [[
        'Distance',
        'Fingerprint',
        'Dates',
        'Count'
      ]];
      candidates.forEach(candidate => {
      const dates = candidate.dates.map(date => {
        return new Date(date * 1000).toDateString();
      });
      canidate_data = canidate_data.concat([[
        candidate.distance, 
        candidate.fingerprint.substring(0, 7),
        dates.join(' - '),
        candidate.count,
      ]]);
      });
      console.log(table(canidate_data));
      break;
     }
     case 'summary': {
       const data = results;
       let summary_data = [[
         'Fingerprint',
         'Dates',
         'Count',
         'Candidates',
         'Instances',
         '0',
         '1',
         '2',
         '3',
         '4+']];
       data.forEach(d => {
        const dates = d.dates.map(date => {
          return new Date(date * 1000).toDateString();
        });
        summary_data = summary_data.concat([[
          d.fingerprint.substring(0, 7),
          dates.join(' - '),
          d.count,
          d.candidates,
          d.candidateInstances,
          d.groupedByDistance[0],
          d.groupedByDistance[1],
          d.groupedByDistance[2],
          d.groupedByDistance[3],
          d.groupedByDistance[4],
        ]])
      });
      console.log('\n');
      console.log(table(summary_data));
      break; 
    }
    default: {
      errx('unknown type of similarity request');
    }
   };
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

  var aq = queryCli.argvQuery(argv);
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

  console.log(success_color('Success'));
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

  var aq = queryCli.argvQuery(argv);
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

    console.log(success_color('Success.'));
    return;
  });

  return;
}

async function coronerCleanFingerprints(argv, coroner, fingerprints, query, p) {
  query.limit = 10000;
  query.order = [{ name: "_tx", ordering: "descending" }];
  query.select = ["object.size"];

  let saved = 0;
  let selected = 0;
  let total = 0;
  let lowest_overall = 2**32;
  let highest_overall = 0;

  /*
   * Perform independent queries for each fingerprint.  This allows
   * argv.{keep,oldest} to reserve objects per fingerprint.  Objects
   * shouldn't switch fingerprints between queries.
   */
  for (const fp of fingerprints) {
    let oids = [];
    let reserved = [];
    let kept = 0;

    query.filter[0].fingerprint = [["equal", fp]];
    query.filter[0]._tx = [["greater-than", "0"]];
    for (;;) {
      let lowest_id = 2**32;
      const result = await coroner.query(p.universe, p.project, query);
      let rp = new crdb.Response(result.response);
      rp = rp.unpack();

      let objects = rp['*'];
      if (objects.length === 0)
        break;

      /* Update id trackers now before any array manipulation occurs. */
      if (objects[0].object > highest_overall)
        highest_overall = objects[0].object;
      lowest_id = objects[objects.length - 1].object;
      if (lowest_id < lowest_overall)
        lowest_overall = lowest_id;

      /*
       * If saving oldest N objects:
       * - prepend (unshift) the contents of the reserved array into objects,
       *   to preserve position in the overall queue
       * - splice the last N objects into the reserved array
       *
       * Then proceed as usual.  This will effectively reserve the oldest
       * objects when they appear, and they will ultimately not be
       * considered for deletion.
       */
      if (argv.oldest > 0) {
        objects.unshift(...reserved);
        const off = objects.length < argv.oldest ? 0 : (objects.length - argv.oldest);
        reserved = objects.splice(off, argv.oldest);
      }

      for (let i = 0; i < objects.length; i++) {
        if (kept < argv.keep) {
          kept++;
          continue;
        }

        selected++;
        oids.push(objects[i].id);
        saved += objects[i]["object.size"];
      }
      if (argv.output && oids.length > 0) {
        process.stdout.write(oids.join(" "));
        process.stdout.write('\n');
        oids = [];
      }

      total += objects.length;
      if (argv.verbose) {
        process.stderr.write(`${objects.length} objects processed, ` +
          `setting object <= ${lowest_id.toString(16)} ...\n`);
      }

      /* Paginate by updating the _tx filter. */
      query.filter[0]._tx = [["less-than", `${lowest_id}`]];
    }

    /* Include reserved objects in total at this point. */
    total += reserved.length;
    if (argv.verbose) {
      reserved = reserved.map((obj) => obj.id);
      process.stderr.write(`reserved(${reserved.length}]: ${reserved.join(" ")}\n`);
    }
  }

  const range = `${lowest_overall.toString(16)}..${highest_overall.toString(16)}`;
  process.stderr.write(`${selected}/${total} objects (range ${range}) ` +
    `across ${fingerprints.length} fingerprint(s), would save about ` +
    `${Math.floor(saved / 1024 / 1024)}MB.\n`);
}

async function coronerCleanAsync(argv, config) {
  abortIfNotLoggedIn(config);
  var query;
  var p;

  let coroner = coronerClientArgv(config, argv);
  coroner.sync_query = coroner.query;
  coroner.query = util.promisify(coroner.sync_query);

  if (argv._.length < 2) {
    return usage("Missing project, universe arguments");
  }

  /* Process --oldest, defaulting to 0. */
  argv.oldest = argv.oldest ? parseInt(argv.oldest) : 0;

  /* Process --keep, defaulting to 3 if no --oldest set. */
  if (argv.keep) {
    argv.keep = parseInt(argv.keep);
    if (argv.keep === 0)
      errx('--keep must be greater than 0');
  } else if (!argv.oldest) {
    argv.keep = 3;
  }

  p = coronerParams(argv, config);

  if (!argv.table) {
    argv.table = 'objects';
  }

  var aq = queryCli.argvQuery(argv);
  query = aq.query;
  var d_age = aq.age;

  /* Only consider non-deleted objects, period. */
  if (!query.filter)
    query.filter = [];
  if (!query.filter[0])
    query.filter[0] = {};
  query.filter[0]["_deleted"] = [["equal", "0"]];

  /* First, unless specified, extract the top N fingerprint objects. */
  let fingerprints = [];
  if (argv.fingerprint) {
    fingerprints = Array.isArray(argv.fingerprint) ? argv.fingerprint :
      [argv.fingerprint];
  }
  if (fingerprints.length === 0) {
    query.group = ["fingerprint"];
    query.order = [{"name":";count","ordering":"descending"}];

    let result = await coroner.query(p.universe, p.project, query);
    const rp = new crdb.Response(result.response);
    for (var i = 0; i < rp.json.values.length; i++)
      fingerprints.push(rp.json.values[i][0]);
  }

  /* Now, we construct selection queries for all objects matching these. */
  delete(query.group);
  delete(query.fold);
  delete(query.order);

  await coronerCleanFingerprints(argv, coroner, fingerprints, query, p);
}

/**
 * @brief: Implements the clean command.
 */
function coronerClean(argv, config) {
  coronerCleanAsync(argv, config).catch((err) => {
    console.error(err);
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

  let implicitTimeOps = true;
  if (argv["implicit-filters"] === false) {
    implicitTimeOps = false;
  }

  let csv = argv.csv;
  if (csv && !argv.select)
      return usage("--csv requires select parameters")

  p = coronerParams(argv, config);

  if (!argv.table) {
    argv.table = 'objects';
  }

  var aq = queryCli.argvQuery(argv, implicitTimeOps, /*doFolds=*/true);
  query = aq.query;
  var d_age = aq.age;

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
    console.log(JSON.stringify(query));
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
    coroner.query(p.universe, p.project, query, async function(err, result) {
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

      /*
       * Determine if we should print any data to stream to output
       * if limit option was used.
       */
      if (query.set) {
        if (result.response.result === 'success')
          console.log(success_color('Success'));
        else
          console.log('result:\n' + JSON.stringify(result.response));
      } else {
        var rp = new crdb.Response(result.response);

        if (argv.json) {
          var results = rp.unpack();

          console.log(JSON.stringify(results, null, 2));
          return;
        }

        await coronerPrint(
          query,
          rp,
          result.response,
          null,
          result._.runtime,
          csv
        );

        var date_label;
        if (d_age) {
          date_label = 'as of ' + d_age + ' ago';
        } else {
          date_label = 'with a time range of ' + argv.time;
        }
      }

      if (argv.verbose) {
        console.log(yellow('Timing:'));

        var o = '';
        var aggs = result._.runtime.aggregate;
        if ('time' in aggs)
          aggs = aggs.time
        else if ('pre_sort' in aggs)
          aggs = aggs.pre_sort + aggs.post_sort;

        o += yellow('     Rows: ') + result._.runtime.filter.rows + '\n';
        o += yellow('   Filter: ') + result._.runtime.filter.time + 'us (' +
          Math.ceil(result._.runtime.filter.time /
            result._.runtime.filter.rows * 1000) + 'ns / row)\n';
        o += yellow('    Group: ') + result._.runtime.group_by.time + 'us (' +
          Math.ceil(result._.runtime.group_by.time /
            result._.runtime.group_by.groups) + 'us / group)\n';
        o += yellow('Aggregate: ') + aggs + 'us\n';
        o += yellow('     Sort: ') + result._.runtime.sort.time + 'us\n';
        if (result._.runtime.set) {
          o += yellow('      Set: ') + result._.runtime.set.time + 'us\n';
        }
        o += yellow('    Total: ') + result._.runtime.total_time + 'us';
        console.log(o + '\n');
      }

      var footer = result._.user + ': ' +
          result._.universe + '/' + result._.project + ' ' + date_label +
            ' [' + result._.latency + ']';
      console.log(blue(footer));
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

  process.stdout.write(bold(string) + ' ');

  /* This means that no aggregation has occurred. */
  if (object.length) {
    var i;
    var a;

    process.stdout.write('\n');

    for (i = 0; i < object.length; i++) {
      var ob = object[i];
      let label = printf("#%-7x ", ob.object);

      process.stdout.write(green.bold(label));

      if (ob.timestamp) {
        process.stdout.write(new Date(ob.timestamp * 1000) + '     ' +
            bold(ta.ago(ob.timestamp * 1000)) + '\n');
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
        
          console.log('  ' + label_color(a) + ': ' + fieldFormat(ob[a], fields[a]));
      }

      /*
       * If a callstack is present then render it in a pretty fashion.
       */
      if (ob.callstack) {
        process.stdout.write(label_color(`  ${fields[a]}:`));
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

    process.stdout.write(success_color(sa));
  }

  if (timestamp_range) {
    console.log(label_color('First Occurrence: ') + start);
    if (timestamp_range[0] !== timestamp_range[1])
      console.log(label_color(' Last Occurrence: ') + stop);
  }

  if (object.count) {
      var label = object.count + '';

      if (runtime && runtime.filter && runtime.filter.rows > 0) {
        label += printf(" (%.2f%%)",
            (object.count / runtime.filter.rows) * 100);
      }

      console.log(label_color('     Occurrences: ') + label);
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

    process.stdout.write(label_color(`${field}: `));

    if (fields[field] === 'callstack') {
      callstackPrint(object[field]);
      continue;
    }

    if (!renderer[match]) {
      console.log(object[field]);
      continue;
    }

    if (renderer[match](object[field], label_color(field), fields[field]) === false)
      console.log(object[field]);
  }
}

async function coronerPrint(query, rp, raw, columns, runtime, csvPath) {
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
    min: noFormatPrint,
    max: noFormatPrint,
    object: noFormatPrint,
    sum: unaryPrint,
    histogram: histogramPrint,
    distribution: distributionPrint,
    quantize: binPrint,
    bin: binPrint,
    range: rangePrint,
  };
  let empty = results && results['*'] && results['*'].length === 0;

  /*
   * Write stream to save data to .csv file.
   * In case if user didn't use `csv` option, use undefined to prevent writing .csv files anywhere.
   */
  let csvWriter = undefined;

  if (csvPath && !empty) {
    let header = Object.keys(rp._fields).map(n => { return { id: n, title: n } });

    header = header.concat([{title: "object", id: "object"}, {title: "id", id: "id"}]);
    csvWriter = createCsvWriter({path: csvPath, header: header, append: true});
  }

  for (g in results) {
    if (csvWriter) {
      if (results[g])
        await csvWriter.writeRecords(results[g]);
    } else {
      objectPrint(g, results[g], renderer, fields, runtime);
    }

    if (!csvWriter)
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

    console.log(success_color('Logged in') + ' ' +
      grey('[' + coroner.config.token + ']'));

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

  const loginCb = (username, password) => {
    coroner.login(username, password, function(err) {
      loginComplete(coroner, argv, err, cb);
    })
  };

  if (process.env.MORGUE_USERNAME && process.env.MORGUE_PASSWORD) {
    loginCb(process.env.MORGUE_USERNAME, process.env.MORGUE_PASSWORD);
    return;
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

    loginCb(result.username, result.password);
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
  console.error("   morgue callstack evaluate <project> [--name=fmt] <object>|<filename>");
  console.error("     Evaluate a specific object/file.");
  console.error("");
  console.error("   morgue callstack get [project] [--language=language] <--name=name>");
  console.error("     Retrieve the ruleset for a specific name.");
  console.error("");
  process.exit(1);
}

function coronerCallstackParams(argv, p, action) {
  var csparams = Object.assign({
    action: action,
    fulljson: true,
  }, p);
  if (argv.name)
    csparams.name = argv.name;
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
    console.log(success_color(`Rule ${argv.name} created`));
  } else {
    return deduplicationUsage(`Unknown file ${argv.rules}`);
  }
}

function coronerDeduplicationDelete(argv, coroner, p, bpg, rules) {
  bpg.delete(rules);
  bpg.commit();
  console.log(success_color(`Rule ${argv.name} deleted`));
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
  console.log(success_color(`Rule ${argv.name} modified`));
}

function coronerDeduplicationList(argv, coroner, p, bpg, rules) {
  const model = bpg.get();

  const printDeduplicationList = function(data, verbose) {

    let table_data = [
      [ 'Name', 'Priority', 'Languages', 'Plaforms', 'Rules', 'Enabled'],
    ];

    for (let i = 0; i < data.length; i++) {
      const el = data[i]
      const parsed_rules = JSON.parse(el.rules);
      table_data = table_data.concat([[
        el.name,
        el.priority,
        el.languages,
        el.platforms,
        parsed_rules.length,
        el.enabled,
      ]]);
    }

    console.log(table(table_data));

    if (verbose === true) {

      const verbose_table_data = [[
        'Action',
        'Function',
        'Platform',
        'Object',
        'Replacement',
        'Attribute',
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
            e.attribute,
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

  aq = queryCli.argvQueryFilterOnly(argv);
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
    process.stderr.write(success_color(sprintf('Deleting %d objects in %d requests...',
      n_objects, tasks.length)) + '\n');

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
      console.log(success_color('Reprocessing request #' + result.id + ' queued.')))
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

  aq = queryCli.argvQueryFilterOnly(argv);
  coroner = coronerClientArgv(config, argv);

  /* Check for a query parameter to be sent. */
  n_objects = argv._.length - 2;

  if (n_objects > 0 && aq && aq.query) {
    return usage("Cannot specify both a query and a set of objects.");
  }

  var success_cb = function(result) {
    console.log(success_color('Reprocessing request #' + result.id + ' queued.'));
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
  console.error("Usage: morgue retention <list|set|status|clear> <name> [options]");
  console.error("");
  console.error("Options for set/clear:");
  console.error("  --type=T         Specify retention type (default: project)");
  console.error("                   valid: instance, universe, project");
  console.error("");
  console.error("Options for status:");
  console.error("  --type=T         Specify retention type (default depends on user access)");
  console.error("                   valid: universe, project");
  console.error("");
  console.error("Options for set:");
  console.error("  --dryrun         Show the command that will be issued, but don't send it.");
  console.error("  --rules=N        Specify number of rules to set, which may be referenced");
  console.error("                   by rule actions/criteria, zero-indexed.  If a rule is not");
  console.error("                   referenced, rule #0 (the first) will be assumed.");
  console.error("  --age=[R,]O,T[,TE]");
  console.error("                   Specifies the matching object age for rule R.");
  console.error("                   O is the match operation, which may be one of:");
  console.error("                     'at-least', 'range'");
  console.error("                   T is the time, and for range, TE is the end time.");
  console.error("  --max-age=[R,]N  Specify time limit for objects, N, in seconds, for rule R.");
  console.error("                   Same as --age=[R,]at-least,N.");
  console.error("  --compress[=R]   Specify that the rule compresses matching object data.");
  console.error("  --delete=[R,S]   Specify that rule R deletes subsets S (comma-separated).");
  console.error("                   By default, if no subset is specified, all are deleted.");
  console.error("                   Valid subsets:");
  console.error("                   - physical: Object's physical data.");
  console.error("                   - crdb: Object's attribute data.");
  console.error("  --physical-only[=R]");
  console.error("                   Same as --delete=[R,]physical.");
  console.error("                   Specifies that the policy only delete physical copies;");
  console.error("                   event data will be retained.");
  process.exit(1);
}

function bpgObjectFind(objects, type, vals, fields) {
  if (!objects[type])
    return null;

  /* Shortcut to simply return the first value. */
  if (vals === null)
    return objects[type][0];

  /* If fields not specified, assume defaults. */
  const id_attr = type === "project" ? "pid" : "id";
  if (!fields) {
    fields = [id_attr];
  }

  if (Array.isArray(fields)) {
    if (Array.isArray(vals) === false)
      throw new Error("Invalid bpgObjectFind usage");
    if (fields.length !== vals.length)
      throw new Error("Invalid bpgObjectFind usage");
  } else {
    fields = [fields];
    vals = [vals];
  }

  return objects[type].find(function(o) {
    for (let idx in vals) {
      if (o.get(fields[idx]) !== vals[idx])
        return false;
    }
    return true;
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
  /* If an universe/project was passed in, look up the universe first. */
  let fields = [];
  let vals = [];

  if (parent_type === "project") {
    const [u, p] = name.split("/");
    if (p) {
      name = p;
      const uobj = bpgObjectFind(objects, "universe", u, "name");
      if (!uobj)
        return null;

      fields.push("universe");
      vals.push(uobj.get("id"));
    }
  }

  fields.push("name");
  vals.push(name);
  return bpgObjectFind(objects, parent_type, vals, fields);
}

function addCriterion(rule, type, params) {
  rule.criteria.push(Object.assign({
    type
  }, params || {}));
}

function addAction(rule, type, params) {
  rule.actions.push(Object.assign({
    type
  }, params || {}));
}

function getRuleId(str) {
  const fields = str.split(",");
  return parseInt(fields[0]);
}

function checkRuleId(n_rules, field, str) {
  const fields = str.split(",");
  const ruleIdStr = fields.shift();
  const ruleId = parseInt(ruleIdStr);

  if (isNaN(ruleId) === true || ruleId < 0 || ruleId >= n_rules) {
    retentionUsage(`${field}: '${ruleIdStr}' is not >= 0 and < ${n_rules} rules`);
  }
  return [ruleId, fields];
}

function normalizeRetentionParam(param) {
  if (param === undefined)
    return [];
  if (Number.isInteger(param))
    return [`${param}`];
  /* Handle parameter set without a key, special case for 1 rule. */
  if (param === true)
    return ["0"];
  if (!Array.isArray(param))
    return [param];
  return param;
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

  /* If argv.rules is not specified, assume only one rule. */
  if (argv.rules === undefined)
    argv.rules = 1;

  /* Normalize inputs.  Make all parameters arrays of strings. */
  argv.age = normalizeRetentionParam(argv.age);
  argv.compress = normalizeRetentionParam(argv.compress);
  argv.delete = normalizeRetentionParam(argv.delete);

  /* Convert the old-style --max-age argument to new-style --age. */
  max_age = normalizeRetentionParam(max_age);
  for (let mage of max_age) {
    const fields = mage.split(",");
    if (fields.length === 1) {
      argv.age.push(`0,at-least,${mage}`);
    } else {
      const [ruleId, fields] = checkRuleId(argv.rules, "max-age", mage);
      argv.age.push(`${ruleId},at-least,${fields.join(",")}`);
    }
  }

  /* Convert the old-style --physical-only to new-style --delete. */
  physical_only = normalizeRetentionParam(physical_only);
  for (let po of physical_only) {
    const ruleId = getRuleId(po);
    if (isNaN(ruleId)) {
      argv.delete.push(`0,physical`);
    } else {
      argv.delete.push(`${ruleId},physical`);
    }
  }

  /*
   * Generate the rules.
   * Make sure every parameter, if specified for a rule, has a valid rule id.
   */
  rules = [];
  for (let i = 0; i < argv.rules; i++)
    rules[i] = { criteria: [], actions: [] };

  for (const a of argv.age) {
    const [ruleId, fields] = checkRuleId(argv.rules, "age", a);
    const [op, time, time_end] = fields;
    let params = { op, time: timeCli.timespecToSeconds(time).toString() };
    if (time_end)
      params.time_end = timeCli.timespecToSeconds(time_end).toString();
    addCriterion(rules[ruleId], "object-age", params);
  }
  for (const d of argv.delete) {
    const [ruleId, fields] = checkRuleId(argv.rules, "delete", d);
    const [subset] = fields;
    let params = {};
    if (subset)
      params.subsets = [subset];
    addAction(rules[ruleId], "delete-all", params);
  }
  for (const d of argv.compress) {
    const [ruleId, fields] = checkRuleId(argv.rules, "compress", d);
    addAction(rules[ruleId], "compress");
  }

  /* Require every rule to have an age parameter and at least one action. */
  for (let rule of rules) {
    if (!rule.criteria.some((c) => { return c.type === "object-age"; })) {
      return retentionUsage("Age is a required parameter for every rule.");
    }
    if (rule.actions.length === 0) {
      return retentionUsage("Must specify at least one action for every rule.");
    }
  }

  /* Determine the target policy being set. */
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
    const id_attr = rtn_ptype === "project" ? "pid" : "id";
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
    act_obj.key = {};
    if (rtn_parent_id) {
      act_obj.key[rtn_ptype] = rtn_parent_id;
    } else {
      act_obj.key.id = obj.get("id");
    }
  }

  if (argv.dryrun) {
    console.log(`# BPG command that would be executed:`);
    console.log(JSON.stringify({ actions: [act_obj] }, null, 4));
    return;
  }

  bpgPost(bpg, { actions: [act_obj] }, function(e, r) {
    if (e) {
      err(e);
      return;
    }
    console.log(success_color(r.results[0].text || r.results[0].string));
  });
}

function retentionClear(bpg, objects, argv, config) {

  /* Currently, this is essentially set(rules=0). */
  argv.rules = 0;
  return retentionSet(bpg, objects, argv, config);
}

function retentionNoString(reason, argv) {
  if (!argv || !argv.debug)
    return null;
  return "max age: unspecified (" + reason + ")";
}

function ageCritToString(crit) {
  const max_age = timeCli.secondsToTimespec(crit.value || crit.time);
  return `object-age ${crit.op} ${max_age}`;
}

function deleteActToString(act) {
  let actstr = "delete-all";
  if (act.subsets && act.subsets.indexOf("physical") != -1)
    actstr += "(physical-only)";
  return actstr;
}

function compressActToString(act) {
  let actstr = "compress";
  return actstr;
}

function ruleString(num, s) {
  return `rule #${num}: ${s}`;
}

function ruleToString(rule) {
  let s = "";

  if (Array.isArray(rule.criteria) === false || rule.criteria.length === 0)
    return "no criteria";

  if (Array.isArray(rule.actions) === false || rule.actions.length === 0)
    return "no actions";

  s = "criteria["
  s += rule.criteria.map((crit) => {
    if (crit.type === "object-age")
      return ageCritToString(crit);
    return "?";
  }).join(", ");
  s += "]"

  s += " actions[";
  s += rule.actions.map((act) => {
    if (act.type === "compress")
      return compressActToString(act);
    if (act.type === "delete-all")
      return deleteActToString(act);
    return "?";
  });
  s += "]";

  return s;
}

function retentionToStrings(r_obj, argv) {
  const rules = JSON.parse(r_obj.get("rules"));
  var rule;
  var s;

  if (Array.isArray(rules) === false || rules.length === 0)
    return null;

  return rules.map(ruleToString);
}

function retentionListRules(spaces, rules) {
  if (rules.length === 1) {
    /* If only one rule, just list it directly inline. */
    return ` ${rules[0]}`;
  }
  const rules_annotated = rules.map((r, n) => `rule #${n}: ${r}`);
  return `\n${spaces}${rules_annotated.join(`\n${spaces}`)}`;
}

function retentionListNamespaceRules(ns_obj, rules) {
  let s = `${ns_obj.get("name")}:`;

  return `  ${ns_obj.get("name")}:${retentionListRules("    ", rules)}`;
}

function retentionList(bpg, objects, argv, config) {
  var r;
  var count = 0;
  var before = 0;

  if (argv._.length > 0) {
    return retentionUsage("List does not take any arguments.");
  }

  if ((r = objects["instance_retention"])) {
    const rules = retentionToStrings(r[0], argv);
    if (rules) {
      console.log(`Instance-level:${retentionListRules("  ", rules)}`);
    }
  }

  if ((r = objects["universe_retention"])) {
    before = count;
    r.forEach(function(r_obj) {
      const universe = bpgObjectFind(objects, "universe", r_obj.get("universe"));
      const rules = retentionToStrings(r_obj, argv);
      if (rules) {
        if (count === before)
          console.log("Universe-level:");
        count++;
        console.log(retentionListNamespaceRules(universe, rules));
      }
    });
  }

  if ((r = objects["project_retention"])) {
    before = count;
    r.forEach(function(r_obj) {
      const project = bpgObjectFind(objects, "project", r_obj.get("project"));
      const rules = retentionToStrings(r_obj, argv);
      if (rules) {
        if (count === before)
          console.log("Project-level:");
        count++;
        console.log(retentionListNamespaceRules(project, rules));
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

function epochsec_to_datestr(sec) {
  return (new Date(sec * 1000)).toUTCString();
}

function shouldExpireStr(expiry_ts, recvtime, toff) {
  const calc_expiry = recvtime + toff + 1; /* include timer slop */
  if (expiry_ts === calc_expiry)
    return "expires as expected";

  return `should expire at ${epochsec_to_datestr(calc_expiry)}`;
}

function oiiToString(exp_data, verbosity) {
  const oii = exp_data.next_object;
  const toff = parseInt(exp_data.off);
  const recvtime = parseInt(oii.recvtime);
  let str = "";

  if (oii.namespace !== null) {
    str += `${oii.namespace} oid ${oii.object_id}`;
    if (verbosity >= 1) {
      let expiry_ts = parseInt(oii.expiry);
      if (expiry_ts && expiry_ts > 0) {
        str += ` expires at ${epochsec_to_datestr(expiry_ts)}`;
        if (!isNaN(recvtime) && verbosity >= 2) {
          str += ` (${shouldExpireStr(expiry_ts, recvtime, toff)})`;
        }
      } else {
        /* estimate expiry time if receive time available */
        if (recvtime && toff) {
          str += `, ${shouldExpireStr(null, recvtime, toff)}`;
        } else {
          str += ", no expiry";
        }
      }
    }
  }

  if (str.length === 0) {
    str = "idle, awaiting new objects";
  }

  if (verbosity >= 3 && oii.last_eval) {
    let leval = epochsec_to_datestr(parseInt(oii.last_eval));
    str += ` (last eval ${leval})`;
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

function ageCritStatus(crit) {
  return ageCritToString(crit);
}

function deleteActStatus(act) {
  return deleteActToString(act);
}

function compressStats(statobj) {
  let s = `${statobj.n_compressed}/${statobj.n_consumed} compressed`;
  s += ` ${statobj.n_input_bytes} to ${statobj.n_compressed_bytes} bytes`;
  s += ` (ratio ${(100 * statobj.n_compressed_bytes / statobj.n_input_bytes).toFixed(2)}%)`;
  return s;
}

function compressActStatus(act) {
  let s = "";
  if (act.last_id === 0) {
    s += "not yet run";
  } else {
    if (act.running_since) {
      s += `running since ${epochsec_to_datestr(act.running_since)}`;
      if (act.runstats) {
        s += ` (${compressStats(act.runstats)})`;
      }
    } else {
      s += "not running"
    }

    let last_completed = 0;
    if (act.total !== undefined && act.total.last_completed !== undefined)
      last_completed = act.total.last_completed;
    if (Number.isInteger(last_completed) && last_completed > 0) {
      s += `, last completed ${epochsec_to_datestr(last_completed)}`;
      s += `, ${compressStats(act.total)}`;
    } else if (act.running_since)
      s += `, never completed`;
    else
      s += `, never run`;
  }
  return `compress(${s})`;
}

function ruleTaskStatus(rule) {
  let items = [];
  let str = "";
  if (rule.enabled !== undefined)
    items.push(rule.enabled ? "enabled" : "disabled");
  if (rule.target !== undefined) {
    let target = rule.target;
    if (Number.isInteger(target))
      target = epochsec_to_datestr(target);
    items.push(`target ${target}`);
    items.push(`count ${rule.count}`);
  }
  if (rule.backoff)
    items.push("backoff");
  if (rule.pause_begin)
    items.push(`paused since ${epochsec_to_datestr(rule.pause_begin)}`);
  return "status[" + items.join(", ") + "]";
}

function ruleStatusInstances(rule, argv, exp_off, spaces) {
  let num_shown = 0;
  let num_excluded = 0;

  if (!argv.instances)
    return;

  if (!rule.next_object || !rule.next_object.instances)
    return;

  let instances = [];
  for (let i = 0; i < rule.next_object.instances.length; i++) {
    const noi = rule.next_object.instances[i];
    if (noi.namespace === rule.next_object.namespace) {
      num_excluded++;
      continue;
    }
    /* Skip namespaces that don't keep objects. */
    if (!argv.includeall) {
      if (noi.namespace.endsWith("/symbols")) {
        num_excluded++;
        continue;
      }
    }

    /*
     * Sort instances by expiry time, if they have one, and next by the
     * next receive time, if they have one.
     */
    const noi_expiry = parseInt(noi.expiry) || 0;
    const noi_recvtime = parseInt(noi.recvtime) || 0;
    if (noi_expiry === 0 && noi_recvtime === 0) {
      instances.push(noi);
      continue;
    }
    let index = 0;
    for (; index < instances.length; index++) {
      const inst_expiry = parseInt(instances[index].expiry);
      if (noi_expiry > 0) {
        if (inst_expiry === 0)
          break;
        if (noi_expiry <= inst_expiry)
          break;
        continue;
      } else if (inst_expiry > 0)
        continue;

      const inst_recvtime = parseInt(instances[index].recvtime);
      if (inst_recvtime === 0)
        break;
      if (noi_recvtime <= inst_recvtime)
        break;
    }
    instances.splice(index, 0, noi);
  }

  for (let i = 0; i < instances.length; i++) {
    const exp_data = { next_object: instances[i], off: exp_off };
    let s = oiiToString(exp_data, argv.verbose);
    if (s) {
      if (num_shown === 0)
        console.log(`${spaces}namespace instances:`);
      num_shown++;
      console.log(spaces + `-> ${s}`);
    }
  }
  if (num_shown != rule.next_object.instances.length && argv.verbose >= 2) {
    let diff = rule.next_object.instances.length - num_shown - num_excluded;
    if (diff !== 0)
      console.log(`${spaces}namespace instances: ${diff} not shown`);
  }
}

function ruleStatus(rule, argv, spaces) {
  const exp_data = rule.criteria.reduce((exp_data, crit) => {
    if (exp_data.off === 0) {
      exp_data.off = crit.value;
    } else if (exp_off > crit.value) {
      exp_data.off = crit.value;
    }
    if (crit.next_object)
      exp_data.next_object = crit.next_object;
    return exp_data;
  }, { off: 0, next_object: null });

  if (!exp_data.next_object)
    exp_data.next_object = rule.next_object;

  const top_status = oiiToString(exp_data, argv.verbose || 0);
  console.log(spaces + `rule: next_object[${top_status}]`);

  /* Indent rule metadata a bit. */
  spaces += "  ";

  let s = "criteria[";
  s += rule.criteria.map((crit) => {
    if (crit.type === "object-age")
      return ageCritStatus(crit);
    return "-";
  }).join(", ");
  s += "]";
  console.log(spaces + s);

  s = "actions[";
  s += rule.actions.map((act) => {
    if (act.type === "delete-all")
      return deleteActStatus(act);
    if (act.type === "compress")
      return compressActStatus(act);
    return "-";
  }).join(", ");
  s += "]";

  console.log(spaces + s);
  if (argv.verbose >= 3)
    console.log(spaces + `${ruleTaskStatus(rule)}`);
  ruleStatusInstances(rule, argv, exp_data.off, spaces);
}

function retentionStatusDump(argv, obj, name, level, indent) {
  var header, i;
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
    for (let rule of obj.rules) {
      ruleStatus(rule, argv, spaces);
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

async function metricsImporterCmd(argv, config) {
  abortIfNotLoggedIn(config);
  const coroner = coronerClientArgv(config, argv);
  const cli = await metricsImporterCli.metricsImporterCliFromCoroner(coroner);
  argv._.shift();
  await cli.routeMethod(argv);
}

function stabilityCreateMetric(coroner, argv, config) {
  let universe = argv.universe;
  if (!universe) {
    universe = Object.keys(config.config.universes)[0];
  }

  if (!universe) {
    errx("--universe is required");
  }

  const project = argv.project;
  if (!project) {
    errx("--project is required");
  }

  const metricGroupName = argv["metric-group"];
  if (!metricGroupName) {
    errx("--metric-group is required");
  }
  if (Array.isArray(metricGroupName)) {
    errx("Specify only one --metric-group");
  }

  const name = argv.name;
  if (!name) {
    errx("--name is required");
  }
  if (Array.isArray(name)) {
    errx("Only one --name allowed");
  }


  let attributes = argv.attribute;
  if (!attributes) {
    /*
     * 0 attributes are possible, though rare save for people integrating with
     * the submission API directly.
     */
    attributes = [];
  } else if (!Array.isArray(attributes)) {
    attributes = [ attributes ];
  }

  let bpg = coronerBpgSetup(coroner, argv);
  const model = bpg.get();

  if (!model.metric_group) {
    errx("No metric groups exist yet.");
  }

  /* Find universe. */
  let uid = 0;
  for (let u of model.universe) {
    if (u.get("name") === universe) {
      uid = u.get("id");
    }
  }

  if (uid == 0) {
    errx("Universe not found");
  }

  let pid = 0;
  for (let p of model.project) {
    if (p.get("universe") === uid && p.get("name") == project) {
      pid = p.get("pid");
      break;
    }
  }

  if (pid === 0) {
    errx("Project not found");
  }

  let metricGroupId = 0;
  for (let g of model.metric_group) {
    if (g.get("name") === metricGroupName &&
      g.get("project") === pid) {
        metricGroupId = g.get("id");
        break;
    }
  }

  if (metricGroupId === 0) {
    errx("Metric group not found");
  }

  let attributesObj = {};
  for (let a of attributes) {
    const parts = a.split(",");
    if (parts.length != 2) {
      errx("Usage of --attribute is name, value");
    }
    if (parts[1].length === 0) {
      errx("Attributes may not have empty values");
    }
    /*
     * This works because coronerd uses crdb_column_string_set, so no matter
     * the column type, the attribute can be a string. Otherwise, we'd have
     * to do a bunch of joins in order to do further validation.
     */
    attributesObj[parts[0]] = parts[1];
  }

  const obj = bpg.new("metric").withFields({
    metric_group: metricGroupId,
    name,
    attribute_values: JSON.stringify(attributesObj),
  });
  bpg.create(obj);
  bpg.commit();
  console.log("Metric created");
}

function coronerStability(argv, config) {
  const coroner = coronerClientArgv(config, argv);

  argv._.shift();
  if (argv._.length === 0) {
    errx("Subcommand missing. Valid subcommands: create-metric");
  }

  const commands = {
    "create-metric": stabilityCreateMetric,
  };

  const cmd = argv._.shift();
  const fn = commands[cmd];
  if (!fn) {
    errx("Unrecognized subcommand");
  }
  return fn(coroner, argv, config);
}

async function alertsCmd(argv, config) {
  abortIfNotLoggedIn(config);
  const coroner = coronerClientArgv(config, argv);
  const cli = await alertsCli.alertsCliFromCoroner(coroner, argv, config);
  argv._.shift();
  await cli.routeMethod(argv);
}

function projectIdFromFlags(config, model, argv) {
  let universe = argv.universe;
  if (!universe) {
    universe = Object.keys(config.config.universes)[0];
  }

  if (!universe) {
    errx("--universe is required");
  }

  const project = argv.project;
  if (!project) {
    errx("--project is required");
  }

  /* Find universe. */
  let uid = 0;
  for (let u of model.universe) {
    if (u.get("name") === universe) {
      uid = u.get("id");
    }
  }

  if (uid == 0) {
    errx("Universe not found");
  }

  let pid = 0;
  for (let p of model.project) {
    if (p.get("universe") === uid && p.get("name") == project) {
      pid = p.get("pid");
      break;
    }
  }

  if (pid === 0) {
    errx("Project not found");
  }

  return pid;
}

function actionsEnable(bpg, pid, ssa) {
  if (!ssa) {
    errx("No server_side_actions is configured for this project");
  }

  bpg.modify(ssa, { enabled: 1 });
  bpg.commit();

  console.log("Actions enabled for this project");
  return;
}

function actionsDisable(bpg, pid, ssa) {
  if (!ssa) {
    errx("No actions configuration for this project");
  }

  bpg.modify(ssa, { enabled: 0 });
  bpg.commit();

  console.log("Actions disabled for this project");
  return;
}

function actionsUpload(bpg, pid, ssa, path) {
  if (!path) {
    errx("Specify config file to upload");
  }

  const cfg = fs.readFileSync(path, "utf8");
  if (ssa) {
    bpg.modify(ssa, { configuration: cfg });
  } else {
    const tmp = bpg.new("server_side_actions").withFields({
      project: pid,
      configuration: cfg,
      enabled: 1
    });
    bpg.create(tmp);
  }
  bpg.commit();

  console.log("Configuration uploaded");
  return;
}

function actionsDelete(bpg, pid, ssa) {
  if (!ssa) {
    errx("No actions config exists for this project");
  }

  bpg.delete(ssa);
  bpg.commit();

  console.log("Actions configuration deleted");
}

function actionsGet(bpg, pid, ssa) {
  if (!ssa) {
    console.log("No actions configuration for this project");
    return;
  }

  console.log(
    `Actions are ${ ssa.get("enabled") ? "enabled" : "disabled" } for this project.`);
  console.log("JSON configuration is:");
  console.log(ssa.get("configuration"));
}

function coronerActions(argv, config) {
  const coroner = coronerClientArgv(config, argv);
  let bpg = coronerBpgSetup(coroner, argv);
  let model = bpg.get();

  const pid = projectIdFromFlags(config, model, argv);

  const cmd = argv._[1];
  if (!cmd) {
    errx("Command is required");
  }

  let ssa = model.server_side_actions;
  if (Array.isArray(ssa)) {
    const ind = ssa.findIndex(x => x.get("project") === pid);
    ssa = ind >= 0 ? ssa[ind] : undefined;
  }

  const commands = {
    disable: actionsDisable,
    enable: actionsEnable,
    upload: actionsUpload,
    delete: actionsDelete,
    get: actionsGet,
  };

  const fn = commands[cmd];
  if (!fn) {
    errx("Unrecognized command.");
  }

  fn(bpg, pid, ssa, /*path=*/argv._[2]);
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

  loadConfig(function(err, config) {
    if (err && err.code !== 'ENOENT') {
      errx("Unable to read configuration: " + err.message + ".");
    }

    /*
     * Wrap this in a promise, then rethrow the rejection. This lets us
     * support commands that use async/await without hanging the process or
     * dealing with Node changing the default behavior of unhandled rejections,
     * i.e. see https://github.com/nodejs/node/pull/33021
     * or just Promise.reject(5) in a Node shell.
     */
    Promise.resolve(command(argv, config)).catch(e => {
      /*
       * If we throw directly in this handler, we're just rejecting
       * the promise again. Move the error out to the event loop, instead.
       */
      setTimeout(() => {
        throw e;
      }, 0);
    });
  });
}

//-- vim:ts=2:et:sw=2
