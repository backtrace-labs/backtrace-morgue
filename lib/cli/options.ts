/*
 * validation and conversion helpers for CLI args.
 *
 * The convention is that option is the human-friendly option name (which is
 * hard to determine programatically) and value the value, i.e.:
 *
 * validateZeroOrOne("--alert-name", argv['alert-name'])
 */
import {err, errx} from './errors';

/*
 * validates that the specified option was specified exactly once.
 */
export function validateOne(option, value) {
  if (value === null || value === undefined) {
    err(`--${option} is required`);
    return false;
  }
  if (Array.isArray(value)) {
    err(`--${option} must have exactly one value`);
    return false;
  }
  return true;
}

/*
 * validates that the specified option was specified at most once.
 */
export function validateAtMostOne(option, value) {
  if (Array.isArray(value)) {
    err(`--${option} must have at most one value`);
    return false;
  }
  return true;
}

/*
 * validates that the specified option is an object
 */
export function validateObject(option, value) {
  if (!value || typeof value !== 'object') {
    err(`--${option} must be specified as an object, e.g. --${option}.prop`);
    return false;
  }
  return true;
}

/*
 * Given an option name and value, convert to a single value.
 * Will exit the process with an informative error if the conversion fails.
 */
export function convertOne(option, value) {
  if (!validateOne(option, value)) {
    process.exit(1);
  }
  return value;
}

export function convertAtMostOne(option, value) {
  if (!validateAtMostOne(option, value)) {
    process.exit(1);
  }
  return value;
}

/**
 * Asserts that `value` is an object.
 *
 * If `value` is falsy and `defaultValue` is specified, it will be used instead.
 */
export function convertObject(option, value, defaultValue = undefined) {
  if (defaultValue !== undefined && !value) {
    return defaultValue;
  }

  if (!validateObject(option, value)) {
    process.exit(1);
  }
  return value;
}

/*
 * Will convert an option to an array. Assumes that this array
 * will have at least one item by default. To change this, specify
 * the third optional argument as false.
 */
export function convertMany(option, value, allowEmpty = false) {
  if (allowEmpty && !value) {
    return [];
  }

  if (!value) {
    errx(`--${option} must be specified at least once`);
  }

  if (!Array.isArray(value)) {
    return [value];
  }

  return value;
}

const TRUTH_STRINGS = new Set(['yes', 'true', 'on', '1']);
const FALSE_STRINGS = new Set(['no', 'false', 'off', '0']);

export function convertBool(name, value, defaultValue = undefined) {
  let v;
  if (defaultValue !== undefined) {
    v = convertAtMostOne(name, value);
  } else {
    v = convertOne(name, value);
  }
  if (v === undefined) {
    return defaultValue;
  }
  if (typeof v === 'boolean') {
    return v;
  }
  if (TRUTH_STRINGS.has(v)) {
    return true;
  }
  if (FALSE_STRINGS.has(v)) {
    return false;
  }
  errx(`--${name}: unrecognized boolean option ${v}`);
}
