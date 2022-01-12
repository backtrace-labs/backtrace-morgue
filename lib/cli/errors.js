
/*
 * Error handling helpers.
 */

const chalk          = require('chalk');
const error_color    = chalk.red;
const success_color  = chalk.blue;
const warning_color  = chalk.yellow;

function err(msg) {
  if (msg) {
    var m = msg.toString();
    if (m.slice(0, 5) !== "Error")
      m = "Error: " + m;
    console.error(error_color(m));
  } else {
    console.error(error_color("Unknown error occured."));
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

function warn(msg) {
  var m = msg.toString();
  if (m.slice(0, 5) !== "Warning")
    m = "Warning: " + m;
  console.error(warning_color(m));
}

module.exports = { chalk, err, error_color, errx, success_color, warn, warning_color };
