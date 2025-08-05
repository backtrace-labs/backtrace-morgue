import * as cliOptions from '../../cli/options';
import assignDeep from 'assign-deep';
import { skipNotDefinedKeys, getPluginId } from '../utils';

export class CreateConnection {
  pluginId: any;
  name: any;
  options: any;

  constructor({ pluginId, name, options }: any) {
    this.pluginId = pluginId;
    this.name = name;
    this.options = options;
  }

  static fromArgv(argv, init, options) {
    return new CreateConnection(
      assignDeep(
        init,
        skipNotDefinedKeys({
          name: cliOptions.convertOne("name", argv.name || init.name),
          pluginId: getPluginId(argv, init),
          options,
        })
      )
    );
  }
}
