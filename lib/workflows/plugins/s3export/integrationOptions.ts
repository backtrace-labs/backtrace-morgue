import * as cliOptions from '../../../cli/options';
import assignDeep from 'assign-deep';
import { skipNotDefinedKeys } from '../../utils';

/**
 * Schema:
 *
 * ```
 * {
 *   "bucketPath": string,
 *   "credentials": {
 *     "awsAccessKeyId": string,
 *     "awsSecretAccessKey": string
 *   },
 *   "region": string,
 *   "delimiter": string,
 *   "header": boolean,
 *   "attributeList": string[]
 * }
 * ```
 */
export function integrationOptions(options) {
  return assignDeep(
    {},
    options,
    skipNotDefinedKeys({
      attributeList: cliOptions.convertMany(
        "options.attributeList",
        options.attributeList,
        true
      ),
      header: cliOptions.convertBool("options.header", options.header, null),
    })
  );
}

