import * as fs from 'fs';
import * as zlib from 'zlib';
import * as path from 'path';
import printf from 'printf';
import {sprintf} from 'extsprintf';
import chalk from 'chalk';
import * as config from '../config';
import {errx, err, success_color} from '../cli/errors';
import {abortIfNotLoggedIn, coronerClientArgv, coronerClientArgvSubmit, coronerParams} from '../cli/context';
import {std_success_cb, std_failure_cb} from '../cli/bpg-helpers';
import {usage, oidToString, oidFromString, objToPath, nsToUs, printSamples} from '../cli/util';
import {fieldFormat} from '../cli/print';
import {eHasCode} from '../util';

const grey = chalk.grey;
const yellow = chalk.yellow;
const blue = chalk.blue;
const green = chalk.green;

function mkdir_p(path: any): any {
  try {
    fs.mkdirSync(path);
  } catch (e) {
    if (!eHasCode(e, 'EEXISST')) throw e;
  }
}

function contentDisposition(http_result: any): any {
  const cd: any = {};

  if (
    !http_result ||
    typeof http_result !== 'object' ||
    !http_result.headers ||
    typeof http_result.headers !== 'object'
  ) {
    return {};
  }

  http_result.headers['content-disposition'].split(';').forEach(k => {
    let i, v;

    k = k.trim();
    i = k.indexOf('=');
    v = true;

    if (i !== -1) {
      v = k.slice(i + 1);
      if (v[0] === v[v.length - 1]) v = v.slice(1, v.length - 1);
      k = k.slice(0, i);
    }
    cd[k] = v;
  });

  return cd;
}

function getFname(http_result, outpath, outdir, n_objects, oid, resource) {
  let fname = outpath;
  const cd = contentDisposition(http_result);
  let bname;

  if (outdir || n_objects > 1) {
    bname = cd['filename'] || objToPath(oid, resource);
    if (outpath) fname = sprintf('%s/%s', outpath, bname);
    else fname = bname;
  } else if (fname === '-') {
    /* Treat as standard output. */
    fname = null;
  } else if (!fname) {
    /* Use path provided by content-disposition, if available. */
    fname = cd['filename'] || objToPath(oid, resource);
  }

  return fname;
}

function objectRangeOk(first: any, last: any): any {
  const f = oidFromString(first);
  const l = oidFromString(last);

  if (f < 0) return err(sprintf('first(%s) is less than zero', first));
  if (l < 0) return err(sprintf('last(%s) is less than zero', last));
  if (f > l)
    return err(sprintf('first(%s) is greater than last(%s)', first, last));
  return true;
}

function pushFirstToLast(objects, first, last) {
  let f = oidFromString(first);
  const l = oidFromString(last);
  for (; f <= l; f++) {
    objects.push(oidToString(f));
  }
}

export function argvPushObjectRanges(objects: any, argv: any): any {
  let i, f, l, r;

  if (argv.first && argv.last) {
    if (Array.isArray(argv.first) !== Array.isArray(argv.last))
      return err('first and last must be specified the same number of times');

    if (Array.isArray(argv.first) === true) {
      f = argv.first;
      l = argv.last;
    } else {
      f = [argv.first];
      l = [argv.last];
    }
    if (f.length !== l.length)
      return err('first and last must be specified the same number of times');

    for (i = 0; i < f.length; i++) {
      if (objectRangeOk(f, l) === false) return false;
      pushFirstToLast(objects, f[i], l[i]);
    }
  }

  if (argv.objrange) {
    r = argv.objrange;
    if (Array.isArray(argv.objrange) === false) r = [argv.objrange];

    for (i = 0; i < r.length; i++) {
      const parts = r[i].split(',');
      f = parts[0];
      l = parts[1];
      if (objectRangeOk(f, l) === false) return false;
      pushFirstToLast(objects, f, l);
    }
  }
  return true;
}

function outpathCheck(argv: any, n_objects: any): any {
  let r, st;

  r = {} as any;
  r.path = argv.output;
  if (!r.path && argv.o) r.path = argv.o;
  if (!r.path && argv.outdir) r.path = argv.outdir;
  r.has = typeof r.path === 'string' && r.path !== '-';

  if (!r.has) return r;

  try {
    st = fs.statSync(r.path);
  } catch (e) {}
  if (n_objects > 1) {
    if (!r.has) {
      errx('Must specify output directory for multiple objects.');
    }
    if (st && st.isDirectory() === false) {
      errx('Specified path exists and is not a directory.');
    }
    mkdir_p(r.path);
  } else if (n_objects === 1) {
    if (st && st.isFile() === false) {
      errx('Specified path exists and is not a file.');
    }
  } else {
    errx('Must specify at least one object to get.');
  }
  return r;
}

function coronerGet(argv: any, config: any): any {
  let coroner, objects, out, p, params, tasks, st, success;

  abortIfNotLoggedIn(config);
  p = coronerParams(argv, config);
  objects = argv._.slice(2);
  tasks = [];
  coroner = coronerClientArgv(config, argv);
  argvPushObjectRanges(objects, argv);

  out = outpathCheck(argv, objects.length);
  params = {};
  if (argv.resource) params.resource = argv.resource;

  success = 0;
  objects.forEach(oid => {
    tasks.push(
      coroner
        .promise('http_fetch', p.universe, p.project, oid, params)
        .then(hr => {
          const fname = getFname(
            hr,
            out.path,
            argv.outdir,
            objects.length,
            oid,
            params.resource,
          );
          success++;
          if (fname) {
            if (
              hr.headers['content-encoding'] === 'gzip' &&
              (params.resource === 'json.gz' || params.resource === 'txt.gz')
            ) {
              let unzippedBodyData;
              try {
                unzippedBodyData = zlib.gunzipSync(hr.bodyData);
              } catch (error) {
                console.log('Unable to decompress json data');
              }
              if (unzippedBodyData) hr.bodyData = unzippedBodyData;
            }
            fs.writeFileSync(fname, hr.bodyData);
            console.log(
              success_color(
                sprintf('Wrote %ld bytes to %s', hr.bodyData.length, fname),
              ),
            );
          } else {
            process.stdout.write(hr.bodyData);
          }
        })
        .catch(e => {
          /* Allow ignoring (and printing) failures for testing purposes. */
          const fname = getFname(
            null,
            out.path,
            argv.outdir,
            objects.length,
            oid,
            params.resource,
          );
          if (!argv.ignorefail || !out.has) {
            e.message = sprintf('%s: %s', fname, e.message);
            return Promise.reject(e);
          }
          err(sprintf('%s: %s', fname, e.message));
          return Promise.resolve();
        }),
    );
  });

  Promise.all(tasks)
    .then(() => {
      if (out.has)
        console.log(
          success_color(
            sprintf('Fetched %d of %d objects.', success, objects.length),
          ),
        );
    })
    .catch(e => {
      if (argv.debug) console.log('e = ', e);
      errx(e.message);
    });
}

function coronerDescribe(argv: any, config: any): any {
  abortIfNotLoggedIn(config);

  const options: any = {};
  const query: any = {};
  let p;
  let filter = null;

  const coroner = coronerClientArgv(config, argv);

  if (argv._.length < 2) {
    return usage('Missing universe, project arguments.');
  }

  if (argv.r) options.disabled = true;

  if (argv.table) {
    options.table = argv.table;
  }

  p = coronerParams(argv, config);
  if (Array.isArray(argv._) === true && argv._[2]) filter = argv._[2];

  coroner.describe(p.universe, p.project, options, (error, result) => {
    let cd, i;
    let ml = 0;

    if (error) {
      let message = 'Error: ';
      if (error.message) {
        message += error.message;
      } else {
        message += error;
      }

      if (error === 'invalid token')
        message = message + ': try logging in again.';

      errx(message);
    }

    cd = result.describe;
    for (i = 0; i < cd.length; i++) {
      const it = cd[i];

      if (it.name.length > ml) ml = it.name.length;
    }

    cd.sort((a, b) => {
      if (a.state === 'disabled' && b.state === 'enabled') return 1;
      if (a.state === 'enabled' && b.state === 'disabled') return -1;

      if (a.custom === true && b.custom === false) return 1;
      if (a.custom === false && b.custom === true) return -1;

      return a.name.localeCompare(b.name);
    });

    if (argv.json) {
      console.log(JSON.stringify(cd, null, 2));
      return;
    }

    let unused = 0;
    for (i = 0; i < cd.length; i++) {
      const it = cd[i];
      var name, description;

      if (filter && it.name.match(filter) === null) continue;

      if (argv.u && it.custom === false) continue;

      if (!argv.a && it.statistics && it.statistics.used === false) {
        if (it.custom === false) {
          unused++;
          continue;
        }
      }

      name = printf('%*s', it.name, ml);
      if (!it.state || (it.state && it.state === 'enabled')) {
        if (it.custom === true) {
          if (it.statistics && it.statistics.used === false) {
            process.stdout.write(grey(name + ': [unused] ' + it.description));
          } else {
            process.stdout.write(blue(name) + ': ' + it.description);
          }
        } else {
          if (it.statistics && it.statistics.used === false) {
            process.stdout.write(grey(name + ': [unused] ' + it.description));
          } else {
            process.stdout.write(yellow(name) + ': ' + it.description);
          }
        }

        if (it.format) process.stdout.write(grey(` [${it.format}]`));
      } else if (it.state === 'disabled') {
        process.stdout.write(
          grey(
            name +
              ': [disabled] (Seen at ' +
              new Date(it.seen * 1000) +
              ' with a value of "' +
              it.value +
              '")',
          ),
        );
      }

      if (argv.l && it.filter) {
        const sp = Array(ml).join(' ');
        process.stdout.write('\n');

        process.stdout.write(
          grey(sprintf('%*s: ', 'Group', ml)) + it.group + '\n',
        );

        process.stdout.write(grey(sprintf('%*s:\n', 'Filter', ml)));
        for (var j = 0; j < it.filter.length; j++) {
          process.stdout.write(sp + it.filter[j] + '\n');
        }

        process.stdout.write(grey(sprintf('%*s:\n', 'Aggregate', ml)));
        for (var j = 0; j < it.filter.length; j++) {
          process.stdout.write(sp + it.filter[j] + '\n');
        }
      }
      process.stdout.write('\n');
    }

    if (unused > 0) {
      console.log(
        grey.bold(
          '\nHiding ' + unused + ' unused attributes (-a to list all).',
        ),
      );
    }
  });
}

function attachmentUsage(error_str?: any): never {
  if (typeof error_str === 'string') err(error_str + '\n');
  console.log('Usage: morgue attachment <add|get|list|delete> ...');
  console.log('');
  console.log(
    '  morgue attachment add [options] <[universe/]project> <oid> <filename>',
  );
  console.log('');
  console.log('    --content-type=CT    Specify Content-Type for attachment.');
  console.log('                         The server may auto-detect this.');
  console.log(
    '    --attachment-name=N  Use this name for the attachment name.',
  );
  console.log('                         Default is the same as the filename.');
  console.log('');
  console.log('  morgue attachment get [options] <[universe/]project> <oid>');
  console.log('');
  console.log('    Must specify one of:');
  console.log('    --attachment-id=ID   Attachment ID to delete.');
  console.log('    --attachment-name=N  Attachment name to delete.');
  console.log('    --attachment-inline  Attachment is inline.');
  console.log('');
  console.log('  morgue attachment list [options] <[universe/]project> <oid>');
  console.log('');
  console.log('  morgue attachment delete [options] <[universe/]project <oid>');
  console.log('');
  console.log('    Must specify one of:');
  console.log('    --attachment-id=ID   Attachment ID to delete.');
  console.log('    --attachment-name=N  Attachment name to delete.');
  process.exit(1);
}

function attachmentAdd(argv, config, params): any {
  let body, coroner, fname, name, object, p, u;
  const opts = {
    /* Data is user-provided, and must be passed through as is. */
    binary: true,
    /* Rely on automatic mime-type detection if not specified. */
    content_type: null,
  };

  if (!config.submissionEndpoint) {
    errx('No submission endpoint found.');
  }
  coroner = coronerClientArgvSubmit(config, argv);

  if (argv._.length < 2) {
    if (argv._.length < 1) {
      attachmentUsage('Must specify object ID to attach to.');
    } else {
      attachmentUsage('Must specify file name to attach.');
    }
  }

  object = argv._.shift();
  fname = argv._.shift();
  name = path.basename(argv.attachment_name || fname);
  body = fs.readFileSync(fname);

  if (argv.content_type) {
    opts.content_type = argv.content_type;
  }

  u = params.universe;
  p = params.project;
  coroner
    .promise('attach', u, p, object, name, null, opts, body)
    .then(r => {
      console.log(
        success_color(
          sprintf(
            "Attached '%s' to object %s as id %s.",
            r.attachment_name,
            r.object,
            r.attachment_id,
          ),
        ),
      );
    })
    .catch(std_failure_cb);
}

function attachmentGet(argv, config, params) {
  let coroner, oid, out, p, resource, u;

  if (argv._.length != 1) attachmentUsage('Must specify object id.');

  out = outpathCheck(argv, 1);
  if (argv['attachment-name']) {
    params.attachment_name = argv['attachment-name'];
    resource = params.attachment_name;
  } else if (argv['attachment-id']) {
    params.attachment_id = argv['attachment-id'];
    resource = '_attachment-' + params.attachment_id;
  } else {
    attachmentUsage('Must specify attachment by name or id.');
  }
  if (argv['attachment-inline']) {
    params.attachment_inline = true;
  }

  coroner = coronerClientArgv(config, argv);
  oid = argv._[0];
  u = params.universe;
  p = params.project;
  coroner
    .promise('http_fetch', u, p, oid, params)
    .then(hr => {
      const fname = getFname(hr, out.path, argv.outdir, 1, oid, resource);
      if (fname) {
        fs.writeFileSync(fname, hr.bodyData);
        console.log(
          success_color(
            sprintf('Wrote %ld bytes to %s', hr.bodyData.length, fname),
          ),
        );
      } else {
        process.stdout.write(hr.bodyData);
      }
    })
    .catch(e => {
      const fname = getFname(null, out.path, argv.outdir, 1, oid, resource);
      err(sprintf('%s: %s', fname, e.message));
    });
}

function attachmentList(argv, config, params) {
  let coroner, object, p, u;

  if (argv._.length < 1) {
    attachmentUsage('Must specify object ID to attach to.');
  }

  coroner = coronerClientArgv(config, argv);
  object = argv._.shift();
  p = params.project;
  u = params.universe;
  coroner
    .promise('attachments', u, p, object, null)
    .then(r => {
      const jr = JSON.parse(r);
      if (jr.attachments.length === 0) {
        console.log(sprintf('No attachments for %s obj %s', p, object));
        return;
      }
      console.log(sprintf('%s obj %s attachments:', p, object));
      jr.attachments.forEach(a => {
        console.log(
          sprintf(
            '  id %s name "%s" size %d type "%s"%s',
            a.id,
            a.name,
            a.size,
            a.content_type,
            a.inline ? ' (inline)' : '',
          ),
        );
      });
    })
    .catch(std_failure_cb);
}

function attachmentDelete(argv, config, params) {
  let coroner, p, u;
  const delparams: any = {};
  const req: any[] = [{}];

  coroner = coronerClientArgv(config, argv);
  if (argv.sync) {
    delparams.sync = true;
    if (!argv.timeout) {
      /* Set longer 5 minute timeout in case of heavy load. */
      coroner.timeout = 300 * 1000;
    }
  }

  req[0].id = argv._.shift();
  if (argv['attachment-name']) req[0].attachment_name = argv['attachment-name'];
  else if (argv['attachment-id']) req[0].attachment_id = argv['attachment-id'];
  else attachmentUsage('Must specify attachment by name or id.');

  p = params.project;
  u = params.universe;
  coroner
    .promise('delete_objects', u, p, req, delparams)
    .then(std_success_cb)
    .catch(std_failure_cb);
}

function coronerAttachment(argv: any, config: any) {
  abortIfNotLoggedIn(config);
  let fn, object, params, subcmd;
  const coroner = coronerClientArgv(config, argv);
  const subcmds = {
    add: attachmentAdd,
    list: attachmentList,
    get: attachmentGet,
    delete: attachmentDelete,
  };

  if (argv._.length < 3) attachmentUsage('Not enough arguments specified.');

  argv._.shift();
  /* Extract u/p at this point since they'll be in the correct position. */
  params = coronerParams(argv, config);
  subcmd = argv._.shift();
  fn = subcmds[subcmd];
  if (!fn) attachmentUsage('No such subcommand ' + subcmd);

  if (typeof params.universe !== 'string' || typeof params.project !== 'string')
    attachmentUsage('Missing universe or project parameters');

  argv._.shift();
  return fn(argv, config, params);
}

function put_benchmark(coroner, argv, files, p): Promise<any> {
  const tasks = [];
  const samples = [];
  const objects = [];
  let concurrency = 1;
  let n_samples = 32;
  let submitted = 0;
  let success = 0;

  process.stderr.write(blue('Warming up...') + '\n');

  if (argv.samples) n_samples = parseInt(argv.samples);

  if (argv.concurrency) concurrency = parseInt(argv.concurrency);

  process.stderr.write(yellow('Injecting: '));
  const start = process.hrtime();

  const submit_cb = function (i) {
    const fi = i % files.length;
    /* A previous call completed the full run.  Resolve. */
    if (submitted === n_samples) return Promise.resolve();
    submitted++;
    const st = process.hrtime();

    if (argv.multipart) {
      return coroner
        .promise('put_form', files[fi].path, [], p)
        .then(r => success_cb(r, i, st))
        .catch(e => failure_cb(files[fi].path, e, i, st));
    } else {
      return coroner
        .promise('put', files[fi].body, p, argv.compression)
        .then(r => success_cb(r, i, st))
        .catch(e => failure_cb(files[fi].path, e, i, st));
    }
  };
  var success_cb = function (r, i, st) {
    samples.push(nsToUs(process.hrtime()) - st);
    process.stderr.write(blue('.'));
    success++;
    if (argv.printids) objects.push(r.object);
    return submit_cb(i);
  };
  var failure_cb = function (path, e, i, st) {
    samples.push(nsToUs(process.hrtime()) - st);
    err(sprintf('%s: %s', path, e));
    return submit_cb(i);
  };

  /*
   * Kick off the initial tasks for each "thread".  These will continue to
   * spawn new tasks until the total number of submits reaches n_samples.
   * Once that happens, the final .then() below will run.
   */
  for (let i = 0; i < concurrency; i++) {
    tasks.push(submit_cb(i));
  }

  return Promise.all(tasks)
    .then(r => {
      const failed = n_samples - success;
      console.log('\n');
      printSamples(submitted, samples, start, process.hrtime(), concurrency);
      if (argv.printids)
        console.log(blue(sprintf('Object IDs: %s', JSON.stringify(objects))));
      if (failed === 0) return;
      errx(sprintf('%d of %d submissions failed.', failed, n_samples));
    })
    .catch(e => {
      errx(e.message);
    });
}

function coronerPut(argv: any, config: any): Promise<any> {
  abortIfNotLoggedIn(config);
  const form = argv.form_data;
  const formats = {
    btt: true,
    minidump: true,
    json: true,
    plcrash: true,
    symbols: true,
    'symbols-proguard': true,
    sourcemap: true,
  };
  let p;
  const supported_compression = {gzip: true, deflate: true};
  let attachments = [];

  if (!config.submissionEndpoint) {
    errx('No submission endpoint found.');
  }

  if (!argv.format || !formats[argv.format]) {
    errx('Format must be one of btt, json, plcrash, symbols or minidump');
  }

  if (argv.compression && !supported_compression[argv.compression]) {
    errx('Supported compression are gzip and deflate');
  }

  p = coronerParams(argv, config);
  p.format = argv.format;
  if (p.format === 'symbols' && argv.tag) {
    p.tag = argv.tag;
  }
  if (argv.symbolication_id !== undefined)
    p.symbolication_id = argv.symbolication_id;
  if (p.format === 'symbols-proguard') {
    p.format = 'proguard';
  }
  if (p.format === 'minidump') {
    if (argv.kv) p.kvs = argv.kv;
    if (argv.attachment) {
      /*
       * Attachment mode: This doesn't really make sense to do with multiple
       * objects in the same run, but it works.
       */
      attachments = argv.attachment;
      if (!Array.isArray(attachments)) attachments = [attachments];
    }
  }

  if (argv.sync) {
    p.sync = true;
  }

  if (argv.reuse) {
    p.http_opts = {forever: true};
  }

  const files = [];

  /*
   * Obviously super inefficient, but this is primarily for testing
   * and benchmarking purposes.
   */
  for (var i = 2; i < argv._.length; i++) {
    try {
      var body = fs.readFileSync(argv._[i]);
    } catch (error) {
      errx('Failed to open file: ' + argv._[i]);
    }

    files.push({path: argv._[i], body: body});
  }

  if (files.length === 0) {
    errx('One or more files must be specified.');
  }

  const coroner = coronerClientArgvSubmit(config, argv);

  const submitted = 0;
  let success = 0;
  const tasks = [];

  if (argv.benchmark) {
    return put_benchmark(coroner, argv, files, p);
  }

  console.log(p);

  const success_cb = function (r, path) {
    if (r.fingerprint) {
      console.log(
        success_color(
          sprintf(
            '%s: Success: %s, fingerprint: %s.',
            path,
            r.unique ? 'Unique' : 'Not unique',
            r.fingerprint,
          ),
        ),
      );
    } else {
      console.log(success_color(sprintf('%s: Success.', path)));
    }
    success++;
  };
  const failure_cb = function (path, e) {
    let j;
    let errstr = sprintf('%s: %s', path, e.message);
    if (e.response_obj.body) {
      try {
        j = JSON.parse(e.response_obj.body);
        if (j && j.error && j.error.message)
          errstr += sprintf(' (error %d: %s)', j.error.code, j.error.message);
      } catch (e) {}
    }
    err(errstr);
  };
  for (var i = 0; i < files.length; i++) {
    var path = files[i].path;
    if (form || attachments.length > 0 || argv.multipart) {
      tasks.push(
        coroner
          .promise('put_form', path, attachments, p)
          .then(r => success_cb(r, path))
          .catch(e => failure_cb(path, e)),
      );
    } else {
      tasks.push(
        coroner
          .promise('put', files[i].body, p, argv.compression)
          .then(r => success_cb(r, path))
          .catch(e => failure_cb(path, e)),
      );
    }
  }

  return Promise.all(tasks)
    .then(r => {
      const failed = tasks.length - success;
      if (failed === 0) {
        console.log(success_color('Success.'));
        return;
      }
      errx(sprintf('%d of %d submissions failed.', failed, tasks.length));
    })
    .catch(e => {
      errx(e.message);
    });
}

export const commands: Record<string, (argv: any, config: config.Config) => any> = {
  get: coronerGet,
  put: coronerPut,
  attachment: coronerAttachment,
  describe: coronerDescribe,
};
