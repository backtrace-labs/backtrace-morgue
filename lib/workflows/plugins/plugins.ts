import assignDeep from 'assign-deep';
import * as s3export from './s3export/integrationOptions';

// These functions will be executed for create/update of integration/connection.
// Use these if CLI arg parser doesn't parse the values correctly
// (e.g. plugin requires an array, but parser returns one element for one arg and an array for two)
const PLUGINS = {
  s3export: {
    integration: s3export.integrationOptions
  },
};

const options = (key) => (pluginId) => {
  const plugin = PLUGINS[pluginId];
  const fn = (plugin && plugin[key]) || ((v) => v);
  return (argv, init = { "options": null }) =>
    argv.options || init.options
      ? fn(assignDeep({}, init.options || {}, argv.options || {}))
      : undefined;
};

export const integrationOptions = options("integration");
export const connectionOptions = options("connection");
