import type {Config} from '../config';
import {err} from '../cli/errors';
import {abortIfNotLoggedIn, coronerClientFromGlobal, coronerBpgFromGlobal} from '../cli/context';
import {bpgPost} from '../cli/bpg-helpers';
import type {BpgListCommand,
  CommandHandler,
  CommandHandlerMap,
} from '../cli/generated/types';

function coronerBpgList(cmd: BpgListCommand, config: Config): any {
  abortIfNotLoggedIn(config);
  const coroner = coronerClientFromGlobal(config, cmd.globalOptions);
  const bpg = coronerBpgFromGlobal(coroner, cmd.globalOptions);

  let request: string;

  if (cmd.raw) {
    request = cmd.raw;
  } else {
    request = JSON.stringify({
      actions: [
        {
          action: 'get',
          type: cmd.type,
        },
      ],
    });
  }

  bpgPost(bpg, request, (e, r) => {
    if (e) {
      err(e);
      return;
    }
    console.log(JSON.stringify(r, null, 2));
  });
}

export const handlers = {
  'bpg.list': coronerBpgList,
} satisfies Partial<CommandHandlerMap>;
