const fs = require("fs");
const cliOptions = require("../cli/options");
const { errx } = require("../cli/errors");

function output(obj, argv, pretty) {
  if (cliOptions.convertBool("raw", argv.raw, false)) {
    console.log(JSON.stringify(obj, null, "  "));
  } else {
    pretty(obj);
  }
}

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

function errIfFalsy(value, message) {
  if (!value) {
    errx(message);
  }
}

module.exports = { output, loadInit, skipNotDefinedKeys, errIfFalsy };
