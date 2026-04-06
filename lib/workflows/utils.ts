import * as fs from 'fs';

/**
 * If `raw` is true, raw JSON is printed.
 *
 * Otherwise, `pretty` is executed on `obj`.
 * If `obj` is an array, `pretty` is executed on each element separately.
 */
export function output(obj, raw: boolean, pretty) {
  if (raw) {
    console.log(JSON.stringify(obj, null, '  '));
  } else if (Array.isArray(obj)) {
    obj.forEach(pretty);
  } else {
    pretty(obj);
  }
}

/**
 * Loads initial config from file if `fromFile` is specified, or from stdin.
 */
export function loadInit(fromFile?: string) {
  if (fromFile) {
    return JSON.parse(fs.readFileSync(fromFile, 'utf8'));
  }

  if (!process.stdin.isTTY) {
    return JSON.parse(fs.readFileSync(process.stdin.fd, 'utf8'));
  }

  return {};
}

/**
 * Returns objects without keys that have undefined or null value.
 */
export function skipNotDefinedKeys(obj) {
  const result = {};
  for (const key in obj) {
    if (obj[key] == undefined) {
      continue;
    }

    result[key] = obj[key];
  }
  return result;
}
