/*
 * Error handling helpers.
 */

import chalk from 'chalk';

export { chalk };
export const error_color    = chalk.red;
export const success_color  = chalk.blue;
export const warning_color  = chalk.yellow;

export function err(msg: any): boolean {
  if (msg) {
    let m = msg.toString();
    if (m.slice(0, 5) !== "Error")
      m = "Error: " + m;
    console.error(error_color(m));
  } else {
    console.error(error_color("Unknown error occured."));
  }
  return false;
}

export function errx(errobj: any, opts?: { debug?: boolean }): never {
  if (typeof errobj === 'object' && errobj.message) {
    if (typeof opts === 'object' && opts.debug)
      console.log("err = ", errobj);
    err(errobj.message);
  } else {
    err(errobj);
  }
  process.exit(1);
}

export function warn(msg: any): void {
  let m = msg.toString();
  if (m.slice(0, 5) !== "Warning")
    m = "Warning: " + m;
  console.error(warning_color(m));
}