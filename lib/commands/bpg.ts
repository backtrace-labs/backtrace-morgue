import * as config from '../config';
import {err} from '../cli/errors';
import {abortIfNotLoggedIn, coronerClientArgv, coronerBpgSetup} from '../cli/context';
import {bpgPost} from '../cli/bpg-helpers';
import {usage} from '../cli/util';

function coronerBpg(argv: any, config: config.Config): any {
  abortIfNotLoggedIn(config);
  let json, request, response;
  const coroner = coronerClientArgv(config, argv);
  const bpg = coronerBpgSetup(coroner, argv);

  if (argv._[1]) {
    if (!argv._[2]) {
      return usage('morgue bpg list <type>');
    }

    request = JSON.stringify({
      actions: [
        {
          action: 'get',
          type: argv._[2],
        },
      ],
    });
  } else if (argv.raw) {
    request = argv.raw;
    if (!request && argv._.length >= 2) request = argv._[1];
  } else {
    return usage('morgue bpg [--raw | list <type>]');
  }

  if (!request) {
    return usage('Missing command argument.');
  }

  bpgPost(bpg, request, (e, r) => {
    if (e) {
      err(e);
      return;
    }
    console.log(JSON.stringify(r, null, 2));
  });
}

export const commands: Record<string, (argv: any, config: config.Config) => any> = {
  bpg: coronerBpg,
};
