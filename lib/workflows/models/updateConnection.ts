import * as cliOptions from '../../cli/options';
import assignDeep from 'assign-deep';
import { skipNotDefinedKeys } from '../utils';

export class UpdateConnection {
  name: any;
  options: any;

  constructor({ name, options }: any) {
    this.name = name;
    this.options = options;
  }

  static fromArgv(argv, init, options) {
    return new UpdateConnection(
      assignDeep(
        init,
        skipNotDefinedKeys({
          name: cliOptions.convertAtMostOne("name", argv.name || init.name),
          options,
        })
      )
    );
  }
}
