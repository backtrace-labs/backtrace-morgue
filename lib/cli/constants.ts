/*
 * Shared constants used across CLI commands.
 */

import * as os from 'os';
import * as path from 'path';

export const configDir =
  process.env.MORGUE_CONFIG_DIR || path.join(os.homedir(), '.morgue');
export const configFile = path.join(configDir, 'current.json');
export const BACKTRACE_ROLES = ['admin', 'member', 'guest'];
export const flamegraphScript = path.join(
  __dirname,
  '..',
  '..',
  'assets',
  'flamegraph.pl',
);
