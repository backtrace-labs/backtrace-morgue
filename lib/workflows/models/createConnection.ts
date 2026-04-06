import * as cliOptions from '../../cli/options';
import assignDeep from 'assign-deep';
import {skipNotDefinedKeys} from '../utils';

export class CreateConnection {
  pluginId: any;
  name: any;
  options: any;

  constructor({pluginId, name, options}: any) {
    this.pluginId = pluginId;
    this.name = name;
    this.options = options;
  }

  static fromCmd(
    fields: {name: string; plugin: string},
    init: any,
    options: any,
  ) {
    return new CreateConnection(
      assignDeep(
        init,
        skipNotDefinedKeys({
          name: cliOptions.convertOne('name', fields.name || init.name),
          pluginId: cliOptions.convertOne(
            'plugin',
            fields.plugin || init.pluginId,
          ),
          options,
        }),
      ),
    );
  }
}
