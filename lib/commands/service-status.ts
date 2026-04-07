import type {Config} from '../config';
import {err, errx, chalk, success_color} from '../cli/errors';
import {abortIfNotLoggedIn, coronerClientFromGlobal} from '../cli/context';
import {std_json_cb, std_failure_cb} from '../cli/bpg-helpers';
import type {
  ServiceListCommand,
  ServiceStatusCommand,
  ServiceRescanCommand,
  StatusReloadCommand,
  ControlCommand,
  CommandHandler,
  CommandHandlerMap,
} from '../cli/generated/types';

function serviceList(cmd: ServiceListCommand, config: Config): Promise<any> {
  abortIfNotLoggedIn(config);
  const coroner = coronerClientFromGlobal(config, cmd.globalOptions);
  return coroner
    .promise('svclayer', 'list', null, null)
    .then(std_json_cb)
    .catch(std_failure_cb);
}

function serviceTokenCommand(kind: string, cmd: {globalOptions: any}, config: Config): Promise<any> {
  abortIfNotLoggedIn(config);
  const coroner = coronerClientFromGlobal(config, cmd.globalOptions);
  const subcmd = kind.split('.')[1]; // 'service.status' -> 'status', 'service.rescan' -> 'rescan'
  const p = {token: coroner.config.token};
  return coroner
    .promise('svclayer', subcmd, p, null)
    .then(std_json_cb)
    .catch(std_failure_cb);
}

function serviceStatus(cmd: ServiceStatusCommand, config: Config): Promise<any> {
  return serviceTokenCommand(cmd.kind, cmd, config);
}

function serviceRescan(cmd: ServiceRescanCommand, config: Config): Promise<any> {
  return serviceTokenCommand(cmd.kind, cmd, config);
}

function statusReload(cmd: StatusReloadCommand, config: Config): void {
  abortIfNotLoggedIn(config);
  const coroner = coronerClientFromGlobal(config, cmd.globalOptions);

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

function coronerControl(cmd: ControlCommand, config: Config): any {
  abortIfNotLoggedIn(config);
  const coroner = coronerClientFromGlobal(config, cmd.globalOptions);

  if (cmd.smr) {
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

export const handlers = {
  'service.list': serviceList,
  'service.status': serviceStatus,
  'service.rescan': serviceRescan,
  'status.reload': statusReload,
  'control': coronerControl,
} satisfies Partial<CommandHandlerMap>;
