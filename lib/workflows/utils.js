const fs = require("fs");
const cliOptions = require("../cli/options");

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

  return undefined;
}

module.exports = { output, loadInit };
