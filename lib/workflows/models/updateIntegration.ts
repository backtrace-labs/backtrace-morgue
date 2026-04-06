import * as cliOptions from '../../cli/options';
import assignDeep from 'assign-deep';
import {skipNotDefinedKeys} from '../utils';

export class UpdateIntegration {
  state: any;
  synchronizeIssues: any;
  synchronizeIssuesOnAdd: any;
  options: any;
  connectionId: any;

  constructor({
    state,
    synchronizeIssues,
    synchronizeIssuesOnAdd,
    options,
    connectionId,
  }: any) {
    this.state = state;
    this.synchronizeIssues = synchronizeIssues;
    this.synchronizeIssuesOnAdd = synchronizeIssuesOnAdd;
    this.options = options;
    this.connectionId = connectionId;
  }

  static fromCmd(
    fields: {
      state?: string;
      synchronizeIssues?: string;
      synchronizeIssuesOnAdd?: string;
      connection?: string;
    },
    init: any,
    options: any,
  ) {
    return new UpdateIntegration(
      assignDeep(
        init,
        skipNotDefinedKeys({
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
