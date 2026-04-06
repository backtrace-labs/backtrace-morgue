import * as config from '../config';
import {err, errx, chalk, success_color} from '../cli/errors';
import {abortIfNotLoggedIn, coronerClientArgv, coronerParams} from '../cli/context';
import {subcmdProcess, std_json_cb, std_failure_cb} from '../cli/bpg-helpers';

const red = chalk.red;

function serviceUsageFn(str: any): any {
  if (str) err(str + '\n');
  console.error('Usage: morgue service <list|status>');
}

function serviceList(argv, config, opts): Promise<any> {
  return opts.state.coroner
    .promise('svclayer', 'list', null, null)
    .then(std_json_cb)
    .catch(std_failure_cb);
}

function serviceTokenCommand(argv, config, opts): Promise<any> {
  const p = {token: opts.state.coroner.config.token};
  return opts.state.coroner
    .promise('svclayer', opts.state.subcmd, p, null)
    .then(std_json_cb)
    .catch(std_failure_cb);
}

function coronerService(argv: any, config: any) {
  subcmdProcess(argv, config, {
    usageFn: serviceUsageFn,
    subcmds: {
      list: serviceList,
      status: serviceTokenCommand,
      rescan: serviceTokenCommand,
    },
  });
}

function statusUsage(error_str: any): never {
  if (typeof error_str === 'string') err(error_str + '\n');
  console.log(red('Usage: morgue status <type> ...'));
  process.exit(1);
}

function statusReload(argv, config, params, coroner) {
  const p = {
    action: 'status',
    token: coroner.config.token,
  };

  coroner
    .promise('post', '/api/control', null, p, null)
    .then(rsp => {
      console.log(JSON.stringify(rsp, null, 4));
    })
    .catch(std_failure_cb);
}

/**
 * @brief Implements the status command.
 */
function coronerStatus(argv: any, config: any) {
  abortIfNotLoggedIn(config);
  let fn, object, params, subcmd;
  const coroner = coronerClientArgv(config, argv);
  const subcmds = {
    reload: statusReload,
  };

  if (argv._.length < 2) statusUsage('Not enough arguments specified.');

  argv._.shift();
  /* Extract u/p at this point since they'll be in the correct position. */
  params = coronerParams(argv, config);
  subcmd = argv._.shift();
  fn = subcmds[subcmd];
  if (!fn) statusUsage('No such subcommand ' + subcmd);

  argv._.shift();
  fn(argv, config, params, coroner);
}

function coronerControl(argv: any, config: any): any {
  abortIfNotLoggedIn(config);
  const coroner = coronerClientArgv(config, argv);

  if (argv.smr) {
    coroner.control({action: 'graceperiod'}, (error, r) => {
      if (error) {
        let message = error.message ? error.message : error;

        if (error === 'invalid token') message += ': try logging in again.';

        errx(message);
      }

      console.log(success_color('Success'));
    });
  }
}

export const commands: Record<string, (argv: any, config: config.Config) => any> = {
  service: coronerService,
  status: coronerStatus,
  control: coronerControl,
};
