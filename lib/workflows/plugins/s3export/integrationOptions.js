const cliOptions = require("../../../cli/options");
const assignDeep = require("assign-deep");
const { skipNotDefinedKeys } = require("../../utils");

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
function integrationOptions(options) {
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

module.exports = integrationOptions;
