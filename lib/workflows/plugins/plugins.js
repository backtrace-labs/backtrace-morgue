const assignDeep = require("assign-deep");

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
