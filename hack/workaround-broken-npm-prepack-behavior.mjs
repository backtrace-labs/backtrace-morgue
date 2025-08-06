#!/usr/bin/env node

// Source: https://github.com/cspotcode/workaround-broken-npm-prepack-behavior
//
// When you install a dependency from git, npm should run the prepack script.
// This script is responsible for "packing" the source code into an npm module.
// git clone -> prepack to build it -> pack into a tarball
//
// yarn and pnpm do this. npm has a bug and does not.
//
// This script will run prepack only when prepare is being invoked by npm to set up a git dependency,
// not for any other reason, such as cloning your project and running npm install.

import {spawnSync} from 'child_process';
import {isAbsolute, normalize, relative} from 'path';

import process from 'node:process';

const scriptName = process.argv[2];
const {
    npm_config_local_prefix,
    npm_config_cache,
    npm_package_resolved,
    npm_package_json,
    npm_node_execpath,
    npm_execpath
} = process.env;

function main() {
    if(isInstallingAsGitDepInNpm()) {
        console.log(`Detected installation as git dependency; running \`npm ${scriptName}\``);
        npmRun(scriptName);
    } else {
        console.log(`Not a git dependency installation; skipping \`npm ${scriptName}\``);
    }
}

function isInstallingAsGitDepInNpm() {
    if(!npm_config_cache) return false;
    const normalizedNpmConfigCache = normalize(npm_config_cache);

    // Check if any of these paths are within npm's cache directory
    for(const path of [npm_package_json, npm_package_resolved, npm_config_local_prefix]) {
        if (!path) continue;
        // If local prefix is subdirectory of cache, assume we're being installed as
        // a git dep
        const normalized = normalize(path);
        const rel = relative(normalizedNpmConfigCache, normalized);
        if(!isAbsolute(rel) && !rel.startsWith('..')) return true;
    }
}

function npmRun(scriptName) {
    let res = spawnSync(npm_node_execpath, [npm_execpath, 'run', scriptName], {
        stdio: 'inherit',
    });
    process.exit(typeof res.status === 'number' ? res.status : 1);
}

main();
