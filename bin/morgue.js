#!/usr/bin/env node

'use strict';

const CoronerClient = require('../lib/coroner.js');
const crdb      = require('../lib/crdb.js');
const minimist  = require('minimist');
const os        = require('os');
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
  endpoint: "https://yolo.sp.backtrace.io:6098",
  token: "73092adaab1f194c5db5449080d9fda5fab8e319f83fa60d25315d5ea082cfa1"
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
  console.error("There are more options available for querying. See documentation for details.");
  process.exit(1);
}

var commands = {
  error: coronerError,
  list: coronerList,
  ls: coronerList,
  describe: coronerDescribe,
  get: coronerGet,
  login: coronerLogin,
};

main();

function coronerError(argv, config) {
  if (argv._.length < 2) {
    console.error("Missing error string".error);
    process.exit(1);
  }

  throw Error(argv._[1]);
}

function saveConfig(coroner, callback) {
  makeConfigDir(function(err) {
    if (err) return callback(err);

    var config = {
      config: coroner.config,
      endpoint: coroner.endpoint,
    };
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

function coronerGet(argv, config) {
  var universe, project, object, rf;

  abortIfNotLoggedIn(config);

  if (Array.isArray(argv._) === true) {
    var split;

    split = argv._[1].split('/');
    if (split.length === 1) {
      /* Try to automatically derive a path from the one argument. */
      universe = config.config.universes[0];
      project = argv._[1];
    } else {
      universe = split[0];
      project = split[1];
    }

    object = argv._[2];
  }

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

  coroner.fetch(universe, project, object, rf, function(error, result) {
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
  var universe = null;
  var project = null;
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

  if (Array.isArray(argv._) === true) {
    var split;

    split = argv._[1].split('/');
    if (split.length === 1) {
      /* Try to automatically derive a path from the one argument. */
      universe = config.config.universes[0];
      project = argv._[1];
    } else {
      universe = split[0];
      project = split[1];
    }

    if (argv._[2])
      filter = argv._[2];
  }

  coroner.describe(universe, project, function (error, result) {
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

/**
 * @brief: Implements the list command.
 */
function coronerList(argv, config) {
  abortIfNotLoggedIn(config);

  var d_age = '1M';
  var query = {};
  var universe = null;
  var project = null;

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

  if (Array.isArray(argv._) === true) {
    var split;

    split = argv._[1].split('/');
    if (split.length === 1) {
      /* Try to automatically derive a path from the one argument. */
      universe = config.config.universes[0];
      project = argv._[1];
    } else {
      universe = split[0];
      project = split[1];
    }
  }

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

  if (argv.head)
    fold(query, argv.head, 'head', unaryPrint);
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

  coroner.query(universe, project, query, function (err, result) {
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
    coronerPrint(query, rp.unpack(), result.response,
        argv.sort, argv.limit);

    var footer = result._.user + ': ' +
        result._.universe + '/' + result._.project + ' as of ' + d_age +
          ' ago [' + result._.latency + ']';
    console.log(footer.blue);
  });
}

function rangePrint(field, factor) {
  console.log(field[0] + " - " + field[1] + " (" +
      (field[1] - field[0]) + ")");
}

function binPrint(field, factor) {
  var data = {};
  var j = 0;
  var i;
  var format = "%12d %12d";

  if (field.length === 0)
    return false;

  for (i = 0; i < field.length; i++) {
    var label;

    if (field[i].length === 0)
      continue;

    label = printf(format, field[i][0], field[i][1]);
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

function histogramPrint(field) {
  var data = {};
  var j = 0;
  var i;

  for (i = 0; i < field.length; i++) {
    if (field[i].length === 0)
      continue;

    data[field[i][0]] = field[i][1];
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

function unaryPrint(field) {
  console.log(field[0]);
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
      break;
    }

    process.stdout.write(frames[i] + ' ← ');
  }

  process.stdout.write('\n');
}

function objectPrint(g, object, columns) {
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

        console.log('  ' + a.yellow.bold + ': ' + ob[a]);
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

    if (field.indexOf('timestamp') > -1)
      continue;

    if (field.indexOf('callstack') > -1) {
      process.stdout.write('callstack:'.yellow.bold);
      callstackPrint(object[field]);
      continue;
    }

    process.stdout.write(field.label + ': '.yellow.bold);
    if (columns[match](object[field], field.label) === false)
      console.log('none');
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

function coronerPrint(query, results, raw, sort, limit, columns) {
  var g;
  var renderer = {
    head: unaryPrint,
    unique: unaryPrint,
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
    }

    array.sort(function(a, b) {
      return transform(a, b, sf);
    });

    var length = array.length;
    if (limit && limit < length)
      length = limit;

    for (i = 0; i < length; i++) {
      objectPrint(array[i][0], array[i][1], renderer);
      process.stdout.write('\n');
    }

    return;
  }

  for (g in results) {
    objectPrint(g, results[g], renderer);
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
