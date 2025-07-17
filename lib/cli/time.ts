/*
 * Date/time helpers for translating to/from the CLI args format.
 *
 * We support y/M/d/h/m/s units, in decreasing order (m is minutes,
 * M is months).
 */

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
  if (iu.length === 0)
    iu = 's';
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

function parseTimeInt(x) {
  let i = parseInt(x);
  if (i === NaN || String(i) !== x) {
    i = timespecToSeconds(x);
  }
  return i;
}

module.exports = {
  parseTimeInt,
  timespecToSeconds,
  secondsToTimespec
};
