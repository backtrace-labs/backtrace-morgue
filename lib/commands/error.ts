import * as config from '../config';

function coronerError(argv: any, config: any): any {
  if (argv._.length < 2) {
    throw new Error('Missing error string');
  }

  throw Error(argv._[1]);
}

export const commands: Record<string, (argv: any, config: config.Config) => any> = {
  error: coronerError,
};
