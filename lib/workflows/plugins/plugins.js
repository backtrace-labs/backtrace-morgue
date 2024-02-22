const assignDeep = require("assign-deep");

// These functions will be executed for create/update of integration/connection.
// Use these if CLI arg parser doesn't parse the values correctly
// (e.g. plugin requires an array, but parser returns one element for one arg and an array for two)
const PLUGINS = {
  s3export: {
    integration: require("./s3export/integrationOptions"),
  },
};

const options = (key) => (pluginId) => {
  const plugin = PLUGINS[pluginId];
  const fn = (plugin && plugin[key]) || ((v) => v);
  return (argv, init) =>
    argv.options || init.options
      ? fn(assignDeep({}, init.options || {}, argv.options || {}))
      : undefined;
};

const integrationOptions = options("integration");
const connectionOptions = options("connection");

module.exports = { integrationOptions, connectionOptions };
