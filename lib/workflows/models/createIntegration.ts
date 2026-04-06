import * as cliOptions from '../../cli/options';
import assignDeep from 'assign-deep';
import {skipNotDefinedKeys} from '../utils';

export class CreateIntegration {
  pluginId: any;
  watcherName: any;
  state: any;
  synchronizeIssues: any;
  synchronizeIssuesOnAdd: any;
  options: any;
  connectionId: any;

  constructor({
    pluginId,
    watcherName,
    state,
    synchronizeIssues,
    synchronizeIssuesOnAdd,
    options,
    connectionId,
  }: any) {
    this.pluginId = pluginId;
    this.watcherName = watcherName;
    this.state = state;
    this.synchronizeIssues = synchronizeIssues;
    this.synchronizeIssuesOnAdd = synchronizeIssuesOnAdd;
    this.options = options;
    this.connectionId = connectionId;
  }

  static fromCmd(
    fields: {
      name: string;
      plugin: string;
      state?: string;
      synchronizeIssues?: string;
      synchronizeIssuesOnAdd?: string;
      connection?: string;
    },
    init: any,
    options: any,
  ) {
    return new CreateIntegration(
      assignDeep(
        init,
        skipNotDefinedKeys({
          pluginId: cliOptions.convertOne(
            'plugin',
            fields.plugin || init.pluginId,
          ),
          watcherName: cliOptions.convertOne(
            'name',
            fields.name || init.watcherName,
          ),
          state: cliOptions.convertAtMostOne(
            'state',
            fields.state || init.state,
          ),
          synchronizeIssues: cliOptions.convertBool(
            'synchronize-issues',
            fields.synchronizeIssues || init.synchronizeIssues,
            null,
          ),
          synchronizeIssuesOnAdd: cliOptions.convertBool(
            'synchronize-issues-on-add',
            fields.synchronizeIssuesOnAdd || init.synchronizeIssuesOnAdd,
            null,
          ),
          connectionId: cliOptions.convertAtMostOne(
            'connection',
            fields.connection || init.connectionId,
          ),
          options,
        }),
      ),
    );
  }
}
