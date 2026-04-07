import * as fs from 'fs';
import * as zlib from 'zlib';
import * as path from 'path';
import printf from 'printf';
import {sprintf} from 'extsprintf';
import chalk from 'chalk';
import * as config from '../config';
import type {Config} from '../config';
import {errx, err, success_color} from '../cli/errors';
import {
  abortIfNotLoggedIn,
  coronerClientFromGlobal,
  coronerClientSubmitFromGlobal,
  parseProjectArg,
} from '../cli/context';
import {std_success_cb, std_failure_cb} from '../cli/bpg-helpers';
import {usage, oidToString, oidFromString, objToPath, nsToUs, printSamples} from '../cli/util';
import {fieldFormat} from '../cli/print';
import {eHasCode} from '../util';
import type {
  GetCommand,
  PutCommand,
  DescribeCommand,
  AttachmentAddCommand,
  AttachmentGetCommand,
  AttachmentListCommand,
  AttachmentDeleteCommand,
  CommandHandler,
} from '../cli/generated/types';

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

export function pushObjectRanges(
  objects: any[],
  first?: string,
  last?: string,
): any {
  if (first && last) {
    let f: string[], l: string[];
    if (Array.isArray(first) !== Array.isArray(last))
      return err('first and last must be specified the same number of times');

    if (Array.isArray(first)) {
      f = first;
      l = last as any;
    } else {
      f = [first];
      l = [last];
    }
    if (f.length !== l.length)
      return err('first and last must be specified the same number of times');

    for (let i = 0; i < f.length; i++) {
      if (objectRangeOk(f, l) === false) return false;
      pushFirstToLast(objects, f[i], l[i]);
    }
  }

  return true;
}

function outpathCheck(output: string | undefined, outdir: string | undefined, n_objects: number): any {
  let st;
  const r = {} as any;
  r.path = output;
  if (!r.path && outdir) r.path = outdir;
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

function handleGet(cmd: GetCommand, config: Config): any {
  abortIfNotLoggedIn(config);

  const p = parseProjectArg(cmd.project, config);
  const coroner = coronerClientFromGlobal(config, cmd.globalOptions);
  const objects: string[] = [cmd.object_id];
  pushObjectRanges(objects, cmd.first, cmd.last);

  const out = outpathCheck(cmd.output, cmd.outdir, objects.length);
  const params: any = {};
  if (cmd.resource) params.resource = cmd.resource;

  let success = 0;
  const tasks: Promise<any>[] = [];
  objects.forEach(oid => {
    tasks.push(
      coroner
        .promise('http_fetch', p.universe, p.project, oid, params)
        .then(hr => {
          const fname = getFname(
            hr,
            out.path,
            cmd.outdir,
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
          const fname = getFname(
            null,
            out.path,
            cmd.outdir,
            objects.length,
            oid,
            params.resource,
          );
          e.message = sprintf('%s: %s', fname, e.message);
          return Promise.reject(e);
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
      if (cmd.globalOptions.debug) console.log('e = ', e);
      errx(e.message);
    });
}

function handleDescribe(cmd: DescribeCommand, config: Config): any {
  abortIfNotLoggedIn(config);

  const options: any = {};
  const coroner = coronerClientFromGlobal(config, cmd.globalOptions);
  const p = parseProjectArg(cmd.project, config);
  const filter = cmd.substring || null;

  if (cmd.r) options.disabled = true;
  if (cmd.table) options.table = cmd.table;

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

    if (cmd.json) {
      console.log(JSON.stringify(cd, null, 2));
      return;
    }

    let unused = 0;
    for (i = 0; i < cd.length; i++) {
      const it = cd[i];
      var name, description;

      if (filter && it.name.match(filter) === null) continue;

      if (cmd.u && it.custom === false) continue;

      if (!cmd.a && it.statistics && it.statistics.used === false) {
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

      if (cmd.l && it.filter) {
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

function handleAttachmentAdd(cmd: AttachmentAddCommand, config: Config): any {
  abortIfNotLoggedIn(config);

  if (!config.submissionEndpoint) {
    errx('No submission endpoint found.');
  }

  const coroner = coronerClientSubmitFromGlobal(config, cmd.globalOptions);
  const p = parseProjectArg(cmd.project, config);

  const name = path.basename(cmd.attachmentName || cmd.filename);
  const body = fs.readFileSync(cmd.filename);

  const opts = {
    binary: true,
    content_type: cmd.contentType || null,
  };

  coroner
    .promise('attach', p.universe, p.project, cmd.oid, name, null, opts, body)
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

function handleAttachmentGet(cmd: AttachmentGetCommand, config: Config) {
  abortIfNotLoggedIn(config);

  const coroner = coronerClientFromGlobal(config, cmd.globalOptions);
  const p = parseProjectArg(cmd.project, config);
  const params: any = {};
  let resource: string;

  const out = outpathCheck(undefined, undefined, 1);

  if (cmd.attachmentName) {
    params.attachment_name = cmd.attachmentName;
    resource = params.attachment_name;
  } else if (cmd.attachmentId) {
    params.attachment_id = cmd.attachmentId;
    resource = '_attachment-' + params.attachment_id;
  } else {
    errx('Must specify attachment by name or id.');
    return;
  }

  coroner
    .promise('http_fetch', p.universe, p.project, cmd.oid, params)
    .then(hr => {
      const fname = getFname(hr, out.path, undefined, 1, cmd.oid, resource);
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
      const fname = getFname(null, out.path, undefined, 1, cmd.oid, resource);
      err(sprintf('%s: %s', fname, e.message));
    });
}

function handleAttachmentList(cmd: AttachmentListCommand, config: Config) {
  abortIfNotLoggedIn(config);

  const coroner = coronerClientFromGlobal(config, cmd.globalOptions);
  const p = parseProjectArg(cmd.project, config);

  coroner
    .promise('attachments', p.universe, p.project, cmd.oid, null)
    .then(r => {
      const jr = JSON.parse(r);
      if (jr.attachments.length === 0) {
        console.log(sprintf('No attachments for %s obj %s', p.project, cmd.oid));
        return;
      }
      console.log(sprintf('%s obj %s attachments:', p.project, cmd.oid));
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

function handleAttachmentDelete(cmd: AttachmentDeleteCommand, config: Config) {
  abortIfNotLoggedIn(config);

  const coroner = coronerClientFromGlobal(config, cmd.globalOptions);
  const p = parseProjectArg(cmd.project, config);
  const delparams: any = {};
  const req: any[] = [{}];

  if (cmd.globalOptions.timeout) {
    /* sync mode uses longer timeout */
  }

  req[0].id = cmd.oid;
  if (cmd.attachmentName) req[0].attachment_name = cmd.attachmentName;
  else if (cmd.attachmentId) req[0].attachment_id = cmd.attachmentId;
  else {
    errx('Must specify attachment by name or id.');
    return;
  }

  coroner
    .promise('delete_objects', p.universe, p.project, req, delparams)
    .then(std_success_cb)
    .catch(std_failure_cb);
}

function put_benchmark(coroner, cmd: PutCommand, files, p): Promise<any> {
  const tasks = [];
  const samples = [];
  const objects = [];
  let concurrency = 1;
  let n_samples = 32;
  let submitted = 0;
  let success = 0;

  process.stderr.write(blue('Warming up...') + '\n');

  if (cmd.samples) n_samples = parseInt(cmd.samples);
  if (cmd.concurrency) concurrency = parseInt(cmd.concurrency);

  process.stderr.write(yellow('Injecting: '));
  const start = process.hrtime();

  const submit_cb = function (i) {
    const fi = i % files.length;
    /* A previous call completed the full run.  Resolve. */
    if (submitted === n_samples) return Promise.resolve();
    submitted++;
    const st = process.hrtime();

    if (cmd.multipart) {
      return coroner
        .promise('put_form', files[fi].path, [], p)
        .then(r => success_cb(r, i, st))
        .catch(e => failure_cb(files[fi].path, e, i, st));
    } else {
      return coroner
        .promise('put', files[fi].body, p, cmd.compression)
        .then(r => success_cb(r, i, st))
        .catch(e => failure_cb(files[fi].path, e, i, st));
    }
  };
  var success_cb = function (r, i, st) {
    samples.push(nsToUs(process.hrtime()) - st);
    process.stderr.write(blue('.'));
    success++;
    if (cmd.printids) objects.push(r.object);
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
      if (cmd.printids)
        console.log(blue(sprintf('Object IDs: %s', JSON.stringify(objects))));
      if (failed === 0) return;
      errx(sprintf('%d of %d submissions failed.', failed, n_samples));
    })
    .catch(e => {
      errx(e.message);
    });
}

function handlePut(cmd: PutCommand, config: Config): Promise<any> {
  abortIfNotLoggedIn(config);

  const form = cmd.form_data;
  const formats = {
    btt: true,
    minidump: true,
    json: true,
    plcrash: true,
    symbols: true,
    'symbols-proguard': true,
    sourcemap: true,
  };
  const supported_compression = {gzip: true, deflate: true};
  let attachments: string[] = [];

  if (!config.submissionEndpoint) {
    errx('No submission endpoint found.');
  }

  if (!cmd.format || !formats[cmd.format]) {
    errx('Format must be one of btt, json, plcrash, symbols or minidump');
  }

  if (cmd.compression && !supported_compression[cmd.compression]) {
    errx('Supported compression are gzip and deflate');
  }

  const p: any = parseProjectArg(cmd.project, config);
  p.format = cmd.format;
  if (p.format === 'symbols' && cmd.tag) {
    p.tag = cmd.tag;
  }
  if (cmd.symbolicationId !== undefined)
    p.symbolication_id = cmd.symbolicationId;
  if (p.format === 'symbols-proguard') {
    p.format = 'proguard';
  }
  if (p.format === 'minidump') {
    if (cmd.kv) p.kvs = cmd.kv;
    if (cmd.attachment) {
      /*
       * Attachment mode: This doesn't really make sense to do with multiple
       * objects in the same run, but it works.
       */
      attachments = Array.isArray(cmd.attachment)
        ? cmd.attachment
        : [cmd.attachment];
    }
  }

  if (cmd.sync) {
    p.sync = true;
  }

  if (cmd.reuse) {
    p.http_opts = {forever: true};
  }

  /* Read the file(s) specified by the cmd.file argument. */
  const fileArg = cmd.file;
  const filePaths = Array.isArray(fileArg) ? fileArg : [fileArg];
  const files = [];

  for (const filePath of filePaths) {
    try {
      var body = fs.readFileSync(filePath);
    } catch (error) {
      errx('Failed to open file: ' + filePath);
    }
    files.push({path: filePath, body: body});
  }

  if (files.length === 0) {
    errx('One or more files must be specified.');
  }

  const coroner = coronerClientSubmitFromGlobal(config, cmd.globalOptions);

  let success = 0;
  const tasks = [];

  if (cmd.benchmark) {
    return put_benchmark(coroner, cmd, files, p);
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
    var filePath = files[i].path;
    if (form || attachments.length > 0 || cmd.multipart) {
      tasks.push(
        coroner
          .promise('put_form', filePath, attachments, p)
          .then(r => success_cb(r, filePath))
          .catch(e => failure_cb(filePath, e)),
      );
    } else {
      tasks.push(
        coroner
          .promise('put', files[i].body, p, cmd.compression)
          .then(r => success_cb(r, filePath))
          .catch(e => failure_cb(filePath, e)),
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

export const handlers: Record<string, CommandHandler> = {
  get: handleGet,
  put: handlePut,
  describe: handleDescribe,
  'attachment.add': handleAttachmentAdd,
  'attachment.get': handleAttachmentGet,
  'attachment.list': handleAttachmentList,
  'attachment.delete': handleAttachmentDelete,
};
