#!/usr/bin/env node

'use strict';

const CoronerClient = require('../lib/coroner.js');
const crdb      = require('../lib/crdb.js');
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
const bt        = require('backtrace-node');
const url       = require('url');
const packageJson = require(path.join(__dirname, "..", "package.json"));

var callstackError = false;
var error = colors.red;
var ta = timeago();
var range_start = null;
var range_stop = null;
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

function usage() {
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
  error: coronerError,
  list: coronerList,
  control: coronerControl,
  ls: coronerList,
  describe: coronerDescribe,
  get: coronerGet,
  put: coronerPut,
  login: coronerLogin,
  delete: coronerDelete,
  symbol: coronerSymbol,
};

main();

function coronerError(argv, config) {
  if (argv._.length < 2) {
    console.error("Missing error string".error);
    process.exit(1);
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

  console.error('Must login first.'.error);
  process.exit(1);
}

function coronerControl(argv, config) {
  abortIfNotLoggedIn(config);

  var coroner = new CoronerClient({
    insecure: !!argv.k,
    debug: !!argv.debug,
    config: config.config,
    endpoint: config.endpoint,
    timeout: argv.timeout
  });

  if (argv.smr) {
    coroner.control({ 'action': 'graceperiod' }, function(error, r) {
      if (error) {
        var message = 'Error: ';
        if (error.message) {
          message += error.message;
        } else {
          message += error;
        }

        if (error === 'invalid token')
          message = message + ': try logging in again.';

        console.log(message.error);
        process.exit();
      }

      console.log('Success'.blue);
    });
  }
}

function coronerGet(argv, config) {
  var p, object, rf;

  abortIfNotLoggedIn(config);
  p = coronerParams(argv, config);
  object = argv._[2];

  const insecure = !!argv.k;
  const debug = argv.debug;
  var coroner = new CoronerClient({
    insecure: insecure,
    debug: debug,
    config: config.config,
    endpoint: config.endpoint,
    timeout: argv.timeout
  });

  if (argv.resource)
      rf = argv.resource;

  coroner.fetch(p.universe, p.project, object, rf, function(error, result) {
    var output = null;

    if (argv.output)
      output = argv.output;
    if (argv.o)
      output = argv.o;

    if (output) {
      fs.writeFileSync(output, result);
      console.log(output);
      return;
    }

    process.stdout.write(result);
  });
}

function coronerDescribe(argv, config) {
  abortIfNotLoggedIn(config);

  var query = {};
  var p;
  var filter = null;

  const insecure = !!argv.k;
  const debug = argv.debug;

  var coroner = new CoronerClient({
    insecure: insecure,
    debug: debug,
    config: config.config,
    endpoint: config.endpoint,
    timeout: argv.timeout,
  });

  if (argv._.length < 2) {
    console.error("Missing project and universe arguments".error);
    return usage();
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

      console.log(message.error);
      process.exit();
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

    for (i = 0; i < cd.length; i++) {
      let it = cd[i];
      var name, description;

      if (filter && it.name.match(filter) === null)
        continue;

      name = printf("%*s", it.name, ml);
      if (it.custom === true) {
        process.stdout.write(name.blue + ': ' + it.description);
      } else {
        process.stdout.write(name.yellow + ': ' + it.description);
      }
      if (it.format)
        process.stdout.write(' ['.grey + it.format.grey + ']'.grey);
      process.stdout.write('\n');
    }
  });
}

function coronerPut(argv, config) {
  abortIfNotLoggedIn(config);
  const insecure = !!argv.k;
  const debug = argv.debug;
  var formats = { 'btt' : true, 'minidump' : true, 'json' : true, 'symbols' : true };
  var p;
  var concurrency = 1;
  var n_samples = 32;
  var supported_compression = {'gzip' : true, 'deflate' : true};
  var kvs = null;

  if (!config.submissionEndpoint) {
    console.error('Error: no submission endpoint found'.error);
    process.exit(1);
  }

  if (!argv.format || !formats[argv.format]) {
    console.error('Error: format must be one of btt, json, symbols or minidump'.error);
    process.exit(1);
  }

  if (argv.compression && !supported_compression[argv.compression]) {
    console.error('Error: supported compression are gzip and deflate'.error);
    process.exit(1);
  }

  if (argv.kv) {
    kvs = argv.kv;
  }

  p = coronerParams(argv, config);
  p.format = argv.format;
  if (p.format === 'symbols' && argv.tag) {
    p.tag = argv.tag;
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
      console.error(('Error: failed to open file: ' + argv._[i]).error);
      process.exit(1);
    }

    files.push({ path: argv._[i], body: body });
  }

  if (files.length === 0) {
    console.error('Error: one or more files must be specified'.error);
    process.exit(1);
  }

  var coroner = new CoronerClient({
    insecure: insecure,
    debug: debug,
    config: config.config,
    endpoint: config.submissionEndpoint,
    timeout: argv.timeout,
  });

  if (argv.concurrency)
    concurrency = parseInt(argv.concurrency);

  var submitted = 0;
  var success = 0;

  if (argv.benchmark) {
    process.stderr.write('Warming up...'.blue + '\n');

    if (argv.samples)
      n_samples = parseInt(argv.samples);

    submitted = 0;

    var samples = [];

    process.stderr.write('Injecting: '.yellow);
      var start = process.hrtime();

      for (var i = 0; i < concurrency; i++) {
        (function qp(of) {
          var bind = of % files.length;
          var s_st = nsToUs(process.hrtime());

          coroner.put(files[bind].body, p, argv.compression, function(error, result) {
              samples.push(nsToUs(process.hrtime()) - s_st);

              if (error) {
                console.error((error + '').error)
              } else if (!(submitted % 10)) {
                process.stderr.write('.'.blue);
                success++;
              }

              submitted++;
              if (submitted === n_samples) {
                process.stderr.write('.'.blue + '\n');
                printSamples(submitted, samples, start, process.hrtime(),
                    concurrency);
                process.exit(0);
              }

              qp(of + 1);
          });
        })(i);
      }
  } else {
    for (var i = 0; i < files.length; i++) {
      (function () {
        var bind = i;

        coroner.put(files[bind].body, p, argv.compression, function(error, result) {
            if (error) {
              console.error((error + '').error)
            } else {
              console.log(files[bind].path);
              success++;
            }

            submitted++;
            if (submitted === files.length) {
              if (success === files.length)
                console.log('Success'.blue);

              if (!argv.benchmark)
                process.exit(0);
            }
        });
      })();
    }
  }

}

/**
 * @brief: Implements the symbol list command.
 */
function coronerSymbol(argv, config) {
  abortIfNotLoggedIn(config);

  const insecure = !!argv.k;
  const debug = argv.debug;

  var coroner = new CoronerClient({
    insecure: insecure,
    debug: debug,
    config: config.config,
    endpoint: config.endpoint,
    timeout: argv.timeout,
  });

  if (argv._.length < 2) {
    console.error("Missing project and universe arguments".error);
    return usage();
  }

  var p = coronerParams(argv, config);

  var tag = [];
  if (argv.tag) {
    tag.push(argv.tag);
  } else {
    tag.push('*');
  };

  coroner.symfile(p.universe, p.project, tag, function (err, result) {
    if (err) {
      console.error(("Error: " + err.message).error);
      process.exit(1);
    }

    var output = null;

    if (argv.output)
      output = argv.output;
    if (argv.o)
      output = argv.o;

    var json = JSON.stringify(result);
    if (output) {
      fs.writeFileSync(output, json);
      console.log(output);
      return;
    }

    process.stdout.write(json);
  });
}

/**
 * @brief: Implements the list command.
 */
function coronerList(argv, config) {
  abortIfNotLoggedIn(config);

  var d_age = '1M';
  var query = {};
  var p;

  const insecure = !!argv.k;
  const debug = argv.debug;

  var coroner = new CoronerClient({
    insecure: insecure,
    debug: debug,
    config: config.config,
    endpoint: config.endpoint,
    timeout: argv.timeout,
  });

  if (argv._.length < 2) {
    console.error("Missing project and universe arguments".error);
    return usage();
  }

  p = coronerParams(argv, config);

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
        console.error('Error: filter must be of form <column>,<operation>,<value>'.red);
        process.exit();
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
      console.error('Error: only one fingerprint argument can be provided'.red);
      process.exit(1);
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
    var now = new Date();
    var unit = {
      'y' : 3600 * 24 * 365,
      'M' : 3600 * 24 * 30,
      'w' : 3600 * 24 * 7,
      'd' : 3600 * 24,
      'h' : 3600,
      'm' : 60,
      's' : 1
    };
    var age = parseInt(d_age);
    var pre = String(age);
    var age_string = String(d_age);
    var iu = age_string.substring(pre.length, age_string.length);
    var target = Date.now() - (age * unit[iu] * 1000);
    var oldest = Math.floor(target / 1000);

    query.filter[0].timestamp = [
      [ 'at-least', oldest ]
    ];

    range_start = oldest;
    range_stop = Math.floor(Date.now() / 1000);

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

  function fold(query, attribute, label, cb) {
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
          console.error('Error: modifiers must be integers.'.error);
          process.exit(1);
        }
      }

      if (!query.fold[argv])
        query.fold[argv] = [];

      query.fold[argv].push([label].concat(modifiers));
    }
  }

  if (argv.tail)
    fold(query, argv.tail, 'tail', unaryPrint);
  if (argv.head)
    fold(query, argv.head, 'head', unaryPrint);
  if (argv.object)
    fold(query, argv.object, 'object', noFormatPrint);
  if (argv.histogram)
    fold(query, argv.histogram, 'histogram', histogramPrint);
  if (argv.unique)
    fold(query, argv.unique, 'unique', unaryPrint);
  if (argv.sum)
    fold(query, argv.sum, 'sum', unaryPrint);
  if (argv.quantize)
    fold(query, argv.quantize, 'bin', binPrint);
  if (argv.bin)
    fold(query, argv.bin, 'bin', binPrint);
  if (argv.range)
    fold(query, argv.range, 'range', rangePrint);

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
        console.error(("Error: " + err.message).error);
        process.exit(1);
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

function objectPrint(g, object, columns, fields) {
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

    if (!columns[match]) {
      console.log(object[field]);
      continue;
    }

    if (columns[match](object[field], field.label, fields[field]) === false)
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
    unique: unaryPrint,
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
function coronerLogin(argv, config) {
  const endpoint = argv._[1];
  const insecure = !!argv.k;
  const debug = argv.debug;

  if (!endpoint) {
    console.error("Expected endpoint argument".error);
    return usage();
  }

  const coroner = new CoronerClient({
    endpoint: endpoint,
    insecure: insecure,
    debug: debug,
    timeout: argv.timeout,
  });

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
        console.error(("Unable to authenticate: " + err.message).error);
        process.exit(1);
      }

      saveConfig(coroner, function(err) {
        if (err) {
          console.error(("Unable to save config: " + err.message).error);
          process.exit(1);
        }

        console.log('Logged in.'.success);
      });
    });
  });
}

/**
 * @brief Implements the delete command.
 */
function coronerDelete(argv, config) {
  const endpoint = argv._[1];
  const insecure = !!argv.k;
  const debug = argv.debug;
  var o, p;

  abortIfNotLoggedIn(config);

  var coroner = new CoronerClient({
    insecure: insecure,
    debug: debug,
    config: config.config,
    endpoint: config.endpoint,
    timeout: argv.timeout,
  });

  if (argv._.length < 2) {
    console.error("Missing project and object ID arguments".error);
    return usage();
  }

  p = coronerParams(argv, config);
  o = argv._.slice(2);

  process.stderr.write('Deleting...'.blue + '\n');
  coroner.delete_objects(p.universe, p.project, o, {}, function(error, result) {
    if (error) {
      console.error((error + '').error);
    } else {
      console.log('Success'.blue);
    }
  });
}

function main() {
  var argv = minimist(process.argv.slice(2), {
    "boolean": ['k', 'debug', 'v', 'version'],
    "string" : [ "fingerprint" ]
  });

  if (argv.v || argv.version) {
    console.log(packageJson.version);
    process.exit(1);
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
      console.error(("Unable to read configuration: " + err.message).error);
      process.exit(1);
    }

    command(argv, config);
  });
}

//-- vim:ts=2:et:sw=2
