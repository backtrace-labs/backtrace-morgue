import * as cliOptions from '../../cli/options';
import assignDeep from 'assign-deep';
import { skipNotDefinedKeys } from '../utils';

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

  static fromArgv(argv, init, options) {
    return new UpdateIntegration(
      assignDeep(
        init,
        skipNotDefinedKeys({
          state: cliOptions.convertAtMostOne("state", argv.state || init.state),
          synchronizeIssues: cliOptions.convertBool(
            "synchronize-issues",
            argv["synchronize-issues"] || init.synchronizeIssues,
            null
          ),
          synchronizeIssuesOnAdd: cliOptions.convertBool(
            "synchronize-issues-on-add",
            argv["synchronize-issues-on-add"] || init.synchronizeIssuesOnAdd,
            null
          ),
          connectionId: cliOptions.convertAtMostOne(
            "connection",
            argv.connectionId || init.connectionId
          ),
          options,
        })
      )
    );
  }
}
