import * as cliOptions from '../../cli/options';
import assignDeep from 'assign-deep';
import {parseFilter} from '../../cli/query';
import {skipNotDefinedKeys} from '../utils';

export class UpdateAlert {
  name: any;
  condition: any;
  state: any;
  filters: any;
  threshold: any;
  frequency: any;
  integrations: any;
  executionDelay: any;

  constructor({
    name,
    condition,
    state,
    filters,
    threshold,
    frequency,
    integrations,
    executionDelay,
  }: any) {
    this.name = name;
    this.condition = condition;
    this.state = state;
    this.filters = filters;
    this.threshold = threshold;
    this.frequency = frequency;
    this.integrations = integrations;
    this.executionDelay = executionDelay;
  }

  static fromCmd(
    fields: {
      name?: string;
      conditionName?: string;
      state?: string;
      filter?: string;
      threshold?: string;
      frequency?: string;
      integration?: string;
      executionDelay?: string;
    },
    init: any,
  ) {
    return new UpdateAlert(
      assignDeep(
        init,
        skipNotDefinedKeys({
          name: cliOptions.convertAtMostOne('name', fields.name || init.name),
          condition: cliOptions.convertObject(
            'condition',
            fields.conditionName || init.condition,
            {},
          ),
          state: cliOptions.convertAtMostOne(
            'state',
            fields.state || init.state,
          ),
          filters: fields.filter
            ? cliOptions
                .convertMany('filter', fields.filter, true)
                .map(parseFilter)
                .map(filter => ({type: 'attribute', ...filter}))
            : cliOptions.convertMany('filter', init.filters, true),
          threshold: cliOptions.convertAtMostOne(
            'threshold',
            fields.threshold ?? init.threshold,
          ),
          frequency: cliOptions.convertAtMostOne(
            'frequency',
            fields.frequency ?? init.frequency,
          ),
          integrations: cliOptions.convertMany(
            'integration',
            fields.integration ?? init.integrations,
            true,
          ),
          executionDelay: cliOptions.convertAtMostOne(
            'execution-delay',
            fields.executionDelay || init.executionDelay,
          ),
        }),
      ),
    );
  }
}
