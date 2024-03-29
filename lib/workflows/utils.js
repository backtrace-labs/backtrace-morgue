const fs = require("fs");
const cliOptions = require("../cli/options");

/**
 * If `--raw` is specified, raw JSON is printed.
 *
 * Otherwise, `pretty` is executed on `obj`.
 * If `obj` is an array, `pretty` is executed on each element separately.
 */
function output(obj, argv, pretty) {
  if (cliOptions.convertBool("raw", argv.raw, false)) {
    console.log(JSON.stringify(obj, null, "  "));
  } else if (Array.isArray(obj)) {
    obj.forEach(pretty);
  } else {
    pretty(obj);
  }
}

/**
 * Loads initial config from file if `--from-file` is specified, or from stdin.
 */
function loadInit(argv) {
  const filePath = cliOptions.convertAtMostOne("from-file", argv["from-file"]);
  if (filePath) {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  }

  if (!process.stdin.isTTY) {
    return JSON.parse(fs.readFileSync(process.stdin.fd, "utf8"));
  }

  return {};
}

function getPluginId(argv, init) {
  return cliOptions.convertOne(
    "plugin",
    argv.plugin || argv.pluginId || init.pluginId
  );
}

/**
 * Returns objects without keys that have undefined or null value.
 */
function skipNotDefinedKeys(obj) {
  const result = {};
  for (const key in obj) {
    if (obj[key] == undefined) {
      continue;
    }

    result[key] = obj[key];
  }
  return result;
}

module.exports = {
  output,
  loadInit,
  skipNotDefinedKeys,
  getPluginId,
};
