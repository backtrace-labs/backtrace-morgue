#!/usr/bin/env node

'use strict';

const CoronerClient = require('../lib/coroner.js');
const crdb      = require('../lib/crdb.js');
const BPG       = require('../lib/bpg.js');
const Report    = require('../lib/report.js');
const minimist  = require('minimist');
const os        = require('os');
const ip        = require('ip');
const bar       = require('./bar.js');
const timeago   = require('time-ago');
const histogram = require('./histogram.js');
const printf    = require('printf');
const moment    = require('moment');
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

var flamegraph = path.join(__dirname, "..", "assets", "flamegraph.pl");

var callstackError = false;
var error = colors.red;
var ta = timeago();
var range_start = null;
var range_stop = null;
var endpoint;
var endpointToken;
var reverse = 1;
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
  var m = msg.toString();
  if (m.slice(0, 5) !== "Error")
    m = "Error: " + m;
  console.log(m.error);
  return false;
}

function errx(msg) {
  err(msg);
  process.exit(1);
}

/* Standardized success/failure callbacks. */
function std_success_cb(r) {
  console.log('Success'.blue);
}

function std_failure_cb(e) {
  errx(e.message);
}

function objToPath(oid, resource) {
  var str = oid;

  if (typeof oid !== 'string')
   str = oidToString(oid);

  if (resource)
    str += ":" + resource;
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

var commands = {
  bpg: coronerBpg,
  error: coronerError,
  list: coronerList,
  flamegraph: coronerFlamegraph,
  control: coronerControl,
  ls: coronerList,
  describe: coronerDescribe,
  get: coronerGet,
  put: coronerPut,
  login: coronerLogin,
  modify: coronerModify,
  nuke: coronerNuke,
  delete: coronerDelete,
  reprocess: coronerReprocess,
  retention: coronerRetention,
  symbol: coronerSymbol,
  setup: coronerSetup,
  report: coronerReport
};

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
    config: config.config
  });
}

function coronerClientArgv(config, argv) {
  return coronerClient(config, !!argv.k, !!argv.debug, config.endpoint,
    argv.timeout);
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

function coronerReport(argv, config) {
  var options = null;
  var layout = argv.layout;

  abortIfNotLoggedIn(config);
  var coroner = coronerClientArgv(config, argv);

}

function coronerReport(argv, config) {
  var options = null;
  var layout = argv.layout;

  if (!layout)
    layout = argv.l;

  abortIfNotLoggedIn(config);
  var coroner = coronerClientArgv(config, argv);

  var p = coronerParams(argv, config);
  var output = 'report.html';

  if (argv.o) {
    try {
      fs.accessSync(argv.o);
      errx('File ' + argv.o + ' already exists.');
    } catch (error) {
      /* We are fine, not replacing a file probably. */
    }

    output = argv.o;
  }

  if (layout) {
    try {
      options = JSON.parse(fs.readFileSync(layout));
    } catch (error) {
      errx(error);
    }
  }

  var report = new Report(coroner, p.universe, p.project, options);
  report.generate(output);
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

function getFname(outpath, outdir, n_objects, oid, resource) {
  var fname = outpath;
  if (outdir || n_objects > 1)
    fname = sprintf("%s/%s", outpath, objToPath(oid, resource));
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

function coronerGet(argv, config) {
  var coroner, has_outpath, objects, p, outpath, tasks, rf;

  abortIfNotLoggedIn(config);
  p = coronerParams(argv, config);
  objects = argv._.slice(2);
  tasks = [];
  coroner = coronerClientArgv(config, argv);
  argvPushObjectRanges(objects, argv);

  outpath = argv.output;
  if (!outpath && argv.o)
    outpath = argv.o;
  if (!outpath && argv.outdir)
    outpath = argv.outdir;
  has_outpath = typeof outpath === 'string';

  if (objects.length > 1) {
    if (!has_outpath) {
      errx('Must specify output directory for multiple objects.');
    }
    mkdir_p(outpath);
  }

  if (objects.length === 0) {
    errx('Must specify at least one object to get.');
  }

  if (argv.resource)
      rf = argv.resource;

  objects.forEach(function(oid) {
    tasks.push(coroner.promise('fetch', p.universe, p.project, oid, rf).then(function(r) {
      var fname = getFname(outpath, argv.outdir, objects.length, oid, rf);
      if (fname) {
        fs.writeFileSync(fname, r);
        console.log(sprintf('Wrote %ld bytes to %s', r.length, fname).success);
      } else {
        process.stdout.write(r);
      }
    }).catch(function(e) {
      /* Allow ignoring (and printing) failures for testing purposes. */
      var fname = getFname(outpath, argv.outdir, objects.length, oid, rf);
      if (!argv.ignorefail || !has_outpath) {
        e.message = sprintf("%s: %s", fname, e.message);
        return Promise.reject(e);
      }
      err(sprintf('%s: %s', fname, e.message));
      return Promise.resolve();
    }));
  });

  Promise.all(tasks).then(function() {
    if (has_outpath)
      console.log('Success'.success);
  }).catch(function(e) {
    errx(e.message);
  });
}

function coronerDescribe(argv, config) {
  abortIfNotLoggedIn(config);

  var query = {};
  var p;
  var filter = null;

  var coroner = coronerClientArgv(config, argv);

  if (argv._.length < 2) {
    return usage("Missing universe, project arguments.");
  }

  p = coronerParams(argv, config);
  if (Array.isArray(argv._) === true && argv._[2])
    filter = argv._[2];

  coroner.describe(p.universe, p.project, function (error, result) {
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
      if (a.custom === true && b.custom === false)
        return 1;
      if (a.custom === false && b.custom === true)
        return -1;

      return a.name.localeCompare(b.name);
    });


    if (argv.json) {
      console.log(JSON.stringify(cd, null, 2));
      process.exit(0);
    }

    var unused = 0;
    for (i = 0; i < cd.length; i++) {
      let it = cd[i];
      var name, description;

      if (filter && it.name.match(filter) === null)
        continue;

      if (!argv.a && it.statistics && it.statistics.used === false) {
        unused++;
        continue;
      }

      name = printf("%*s", it.name, ml);
      if (it.custom === true) {
        if (it.statistics && it.statistics.used === false) {
          process.stdout.write((name + ': ' + it.description).grey);
        } else {
          process.stdout.write(name.blue + ': ' + it.description);
        }
      } else {
        if (it.statistics && it.statistics.used === false) {
          process.stdout.write((name + ': ' + it.description).grey);
        } else {
          process.stdout.write(name.yellow + ': ' + it.description);
        }
      }
      if (it.format)
        process.stdout.write(' ['.grey + it.format.grey + ']'.grey);
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

function coronerModify(argv, config) {
  abortIfNotLoggedIn(config);
  var submitter = coronerClientArgvSubmit(config, argv);
  var querier = coronerClientArgv(config, argv);
  var p = coronerParams(argv, config);
  var request = genModifyRequest(argv.set, argv.clear);
  var n_objects;
  var aq;
  var tasks = [];

  if (argv._.length < 2) {
    return usage("Missing universe, project arguments.");
  }

  if (Object.keys(request).length === 0) {
    return usage("Empty request, specify at least one set or clear.");
  }

  for (var i = 2; i < argv._.length; i++) {
    tasks.push(submitter.promise('modify_object', p.universe, p.project,
      argv._[i], null, request));
  }
  n_objects = tasks.length;

  var success_cb = function() {
    if (n_objects === 0) {
      errx('No matching objects.');
    }
    console.log(('Modification queued for ' + n_objects + ' objects.').success);
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
        tasks.push(submitter.promise('modify_object', p.universe, p.project,
          oidToString(o.object), null, request));
      });
      n_objects = tasks.length;
      return Promise.all(tasks);
    }).then(() => success_cb()).catch(std_failure_cb);
  } else {
    Promise.all(tasks).
      then(() => success_cb()).catch(std_failure_cb);
  }
}

function coronerPut(argv, config) {
  abortIfNotLoggedIn(config);
  const form = argv.form_data;
  var formats = { 'btt' : true, 'minidump' : true, 'json' : true, 'symbols' : true };
  var p;
  var concurrency = 1;
  var n_samples = 32;
  var supported_compression = {'gzip' : true, 'deflate' : true};

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
  if (p.format === 'minidump' && argv.kv) {
    p.kvs = argv.kv;
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

  if (argv.concurrency)
    concurrency = parseInt(argv.concurrency);

  var submitted = 0;
  var success = 0;
  var tasks = [];

  if (argv.benchmark) {
    process.stderr.write('Warming up...'.blue + '\n');

    if (argv.samples)
      n_samples = parseInt(argv.samples);

    submitted = 0;

    var samples = [];

    process.stderr.write('Injecting: '.yellow);
    var start = process.hrtime();

    var submit_cb = function(i) {
      var fi = i % files.length;
      /* A previous call completed the full run.  Resolve. */
      if (submitted === n_samples)
        return Promise.resolve();
      submitted++;
      var st = process.hrtime();
      return coroner.promise('put', files[fi].body, p, argv.compression).
        then((r) => success_cb(r, i, st)).catch((e) => failure_cb(e, i, st));
    }
    var success_cb = function(r, i, st) {
      samples.push(nsToUs(process.hrtime()) - st);
      process.stderr.write('.'.blue);
      success++;
      return submit_cb(i);
    }
    var failure_cb = function(e, i, st) {
      samples.push(nsToUs(process.hrtime()) - st);
      err(e);
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
      if (failed === 0)
        process.exit(0);
      errx(sprintf("%d of %d submissions failed.", failed, n_samples));
    }).catch((e) => {
      errx(e.message);
    });
  } else {
    var success_cb = function(r, path) {
      console.log(path);
      success++;
    }
    var failure_cb = function(e) {
      err(e.message);
    }
    for (var i = 0; i < files.length; i++) {
      var path = files[i].path;
      if (form) {
        tasks.push(coroner.promise('put_form', path, null, p).
          then((r) => success_cb(r, path)).catch((e) => failure_cb(e)));
      } else {
        tasks.push(coroner.promise('put', files[i].body, p, argv.compression)
          .then((r) => success_cb(r, path)).catch((e) => failure_cb(e)));
      }
    }

    Promise.all(tasks).then((r) => {
      var failed = n_samples - success;
      if (failed === 0) {
        console.log('Success.'.success);
        process.exit(0);
      }
      errx(sprintf("%d of %d submissions failed.", failed, n_samples));
    }).catch((e) => {
      errx(e.message);
    });
  }
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

  if (action === 'list') {
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
  } else if (action === 'status' || !action) {
    query.action = 'archives';
  } else {
    errx('Usage: morgue symbol <project> [list | status]');
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

    if (action === 'status' || !action) {
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

  age = parseInt(age_val);
  pre = String(age);
  age_string = String(age_val);
  iu = age_string.substring(pre.length, age_string.length);
  if (!unit[iu])
    throw new Error("Unknown interval unit '" + iu + "'");
  return age * unit[iu];
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
  if (argv.select || argv.filter || argv.fingerprint || argv.age) {
    /* Object must be returned for query to be chainable. */
    if (!argv.select && !argv.template)
      argv.template = 'select';
    return argvQuery(argv);
  }
  return null;
}

function argvQuery(argv) {
  var query = {};
  var d_age = '1M';

  if (argv.reverse)
    reverse = -1;

  if (argv.template)
    query.template = argv.template;

  query.filter = [{}];
  if (argv.filter) {
    var i;

    if (Array.isArray(argv.filter) === false)
      argv.filter = [argv.filter];

    for (i = 0; i < argv.filter.length; i++) {
      var r = argv.filter[i];

      r = r.split(',');
      if (r.length < 3) {
        errx('Filter must be of form <column>,<operation>,<value>.');
      }

      if (!query.filter[0][r[0]])
        query.filter[0][r[0]] = [];
      query.filter[0][r[0]].push([r[1], r[2]]);
    }
  }

  if (!query.filter[0].timestamp)
    query.filter[0].timestamp = [];
  query.filter[0].timestamp.push([ 'greater-than', 0 ]);

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
  } else {
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

  if (argv.age)
    d_age = argv.age;

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

  return { query: query, age: d_age };
}

function bpgPost(bpg, request, callback) {
  var response;
  var json;

  if (typeof request === 'string')
    request = JSON.parse(request);

  response = bpg.post(request);
  json = JSON.parse(response.body);
  if (json.results[0].string !== 'success') {
    var e = json.results[0].string;
    if (!e)
      e = json.results[0].text;
    callback(e);
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

  if (!argv.raw) {
    return usage("Only raw commands are supported.");
  }

  request = argv.raw;
  if (!request && argv._.length >= 2)
    request = argv._[1];

  if (!request) {
    return usage("Missing command argument.");
  }

  bpgPost(bpg, request, function(e, r) {
    if (e) {
      err(e);
      return;
    }
    console.log(r);
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
  process.exit(0);
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
    [argv.tail, 'tail'],
    [argv.head, 'head'],
    [argv.object, 'object'],
    [argv.histogram, 'histogram'],
    [argv.unique, 'unique'],
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

  if (argv.query) {
    var pp = JSON.stringify(query);

    console.log(pp);
    if (!argv.raw)
      process.exit(0);
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
            process.exit(0);
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
        process.exit(0);
      }

      var rp = new crdb.Response(result.response);

      if (argv.json) {
        var results = rp.unpack();

        console.log(JSON.stringify(results, null, 2));
        process.exit(0);
      }

      coronerPrint(query, rp, result.response,
          argv.sort, argv.limit);

      var footer = result._.user + ': ' +
          result._.universe + '/' + result._.project + ' as of ' + d_age +
            ' ago [' + result._.latency + ']';
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

function objectPrint(g, object, renderer, fields) {

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
        process.stdout.write('  callstack:'.yellow.bold);
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
    console.log('Date: '.label + start);
    if (timestamp_range[0] !== timestamp_range[1])
      console.log('      ' + stop);
  }

  if (object.count)
      console.log('Occurrences: '.yellow.bold + object.count);

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
      process.stdout.write('callstack:'.yellow.bold);
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

function range_compare(a, b, sort) {
  return reverse * ((a[1][sort][1] < b[1][sort][1]) -
      (a[1][sort][1] > b[1][sort][1]));
}

function unique_compare(a, b, sort) {
  return reverse * ((a[1][sort][0] < b[1][sort][0]) -
      (a[1][sort][0] > b[1][sort][0]));
}

function id_compare(a, b) {
  return reverse * ((a < b) - (a > b));
}

function coronerPrint(query, rp, raw, sort, limit, columns) {
  var results = rp.unpack();
  var fields = rp.fields();
  var g;
  var renderer = {
    head: unaryPrint,
    tail: unaryPrint,
    unique: noFormatPrint,
    object: noFormatPrint,
    sum: unaryPrint,
    histogram: histogramPrint,
    quantize: binPrint,
    bin: binPrint,
    range: rangePrint,
  };

  if (sort) {
    var array = [];
    var i, sf, transform;

    for (g in results) {
      array.push([g, results[g]]);
    }

    if (array.length === 0) {
      console.log('No results.');
      return;
    }

    transform = id_compare;

    /* Determine sort factor. */
    if (array[0][1]['range(' + sort + ')']) {
      transform = range_compare;
      sf = 'range(' + sort + ')';
    } else if (array[0][1]['unique(' + sort + ')']) {
      transform = unique_compare;
      sf = 'unique(' + sort + ')';
    } else if (array[0][1]['sum(' + sort + ')']) {
      transform = unique_compare;
      sf = 'sum(' + sort + ')';
    }

    array.sort(function(a, b) {
      return transform(a, b, sf);
    });

    var length = array.length;
    if (limit && limit < length)
      length = limit;

    for (i = 0; i < length; i++) {
      objectPrint(array[i][0], array[i][1], renderer, fields);
      process.stdout.write('\n');
    }

    return;
  }

  for (g in results) {
    objectPrint(g, results[g], renderer, fields);
    if (limit && --limit === 0)
      break;
    process.stdout.write('\n');
  }

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
        process.exit(0);
      } else {
        throw err;
      }
    }

    coroner.login(result.username, result.password, function(err) {
      if (err) {
        errx("Unable to authenticate: " + err.message + ".");
      }

      saveConfig(coroner, function(err) {
        if (err) {
          errx("Unable to save config: " + err.message + ".");
        }

        console.log('Logged in.'.success);

        if (cb) {
          cb(coroner, argv);
        }
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

/**
 * @brief Implements the delete command.
 */
function coronerDelete(argv, config) {
  var aq, coroner, o, p;

  abortIfNotLoggedIn(config);

  aq = argvQueryFilterOnly(argv);
  coroner = coronerClientArgv(config, argv);
  p = coronerParams(argv, config);
  o = argv._.slice(2);
  argvPushObjectRanges(o, argv);

  if (o.length === 0 && !(aq && aq.query)) {
    errx('Must specify objects to be deleted.');
  }

  if (aq && aq.query) {
    coroner.promise('query', p.universe, p.project, aq.query).then(function(r) {
      unpackQueryObjects(o, r);
      if (o.length === 0)
        return Promise.reject(new Error("No matching objects."));
      process.stderr.write(sprintf('Deleting %d objects...', o.length).blue + '\n');
      return coroner.promise('delete_objects', p.universe, p.project, o, {});
    }).then(std_success_cb).catch(std_failure_cb);
  } else {
    process.stderr.write(sprintf('Deleting %d objects...', o.length).blue + '\n');
    coroner.promise('delete_objects', p.universe, p.project, o, {}).
      then(std_success_cb).catch(std_failure_cb);
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

  if (rtn_type === "instance") {
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
    act_obj.object = { rules: JSON.stringify(rules) };
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
    console.log(r);
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
  var criterion;

  if (Array.isArray(json) === false || json.length === 0)
    return retentionNoString("no rule", argv);
  rule = json[0];
  if (Array.isArray(rule.criteria) === false || rule.criteria.length === 0)
    return retentionNoString("no criterion");
  criterion = rule.criteria[0];
  if (!criterion.type || criterion.type !== "object-age")
    return retentionNoString("wrong criterion");

  return "max age: " + secondsToTimespec(criterion.time);
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

  if (n_objects > 0 && aq.query) {
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
    /* Don't convert fingerprint or non-optional arguments. */
    "string" : [ "fingerprint", "_" ]
  });

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
