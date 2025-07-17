import * as qs from 'querystring';
import * as url from 'url';
import urlJoin from 'url-join';
import * as path from 'path';
import * as zlib from 'zlib';
import * as fs from 'fs';
import * as request from '@cypress/request';

interface CoronerConfig {
  endpoint: string;
  insecure?: boolean;
  config?: any;
  debug?: boolean;
  timeout?: number;
}

interface RequestCallback {
  (error: Error | null, result?: any): void;
}

interface ResponseObject {
  statusCode: number;
  statusMessage: string;
  headers: any;
  debug?: boolean;
  bodyData?: any;
  response_obj?: any;
}

function check_uri_supported(endpoint: string) {
  var uri = url.parse(endpoint);

  if (uri.protocol === 'https:') {
  } else if (uri.protocol === 'http:' || !uri.protocol) {
  } else {
    throw new Error("Unsupported protocol " + uri.protocol);
  }
  return uri;
}

function debug_response(resp: any, body: any) {
  console.error("\nResponse: HTTP " + resp.statusCode + " " + resp.statusMessage +
    "; headers:\n", JSON.stringify(resp.headers, null, 4));
  console.error("Body (" + body.length + " bytes):\n");
  /*
   * Limit body output to first 1KB of characters, then trim off any
   * non-printable characters.  This is defined here as those that wouldn't
   * typically appear in source code.  Only include an ellipsis if the
   * original is modified.
   */
  var compressed = false;
  var text;
  try {
    text = zlib.gunzipSync(body);
    compressed = true;
  } catch (e) {
    text = body;
  }
  if (text.length > 1024) {
    text = text.substr(0, 1024);
  }
  text = text.replace(/[^\t\n\x20-\x7E].*/gm, '');
  if (text.length != body.length)
    text += " ... (trimmed)";
  if (compressed)
    text = "(gzip-compressed body ...)\n" + text;
  console.error(text);
}

function onResponse(coroner: CoronerClient, callback: RequestCallback, opts: any, err: any, resp: any, body: any) {
  var json, msg, text;

  /*
   * Traditional error callbacks don't allow for additional context to be
   * supplied via arguments, so simply pass on the response object as an
   * attribute of the error object.  Also, forward the raw body via the
   * response object.
   */
  if (err) {
    err.response_obj = resp;
    callback(err);
    return;
  }
  resp.debug = coroner.debug;
  resp.bodyData = body;

  if (coroner.debug || (opts && opts.json))
    text = body.toString('utf8');

  if (coroner.debug) {
    debug_response(resp, text);
  }

  if (resp.statusCode !== 200) {
    err = new Error("HTTP " + resp.statusCode + ": " + resp.statusMessage);
    err.response_obj = resp;
    callback(err);
    return;
  }

  if (opts && opts.json) {
    try {
      json = JSON.parse(text);
    } catch (err) {
      if (coroner.debug)
        console.log("Got bad JSON: ", text);
      callback(new Error("Server sent invalid JSON: " + err.message));
      return;
    }
    if (json.error) {
      var msg = json.error.message;
      /* Send the full contents in case the caller needs it. */
      if (!msg)
        msg = JSON.stringify(json);
      callback(new Error(msg));
      return;
    }
    callback(null, json);
  } else {
    callback(null, resp);
  }
}

function form_add_kvs(options: any, kvs: any) {
  if (!kvs)
    return;

  if (typeof kvs === 'string')
    kvs = kvs.split(",");
  kvs.forEach(function(kv: string) {
    var pair = kv.split(":");
    if (pair.length === 2)
      options.formData[pair[0]] = pair[1];
  });
}

function form_add_file(options: any, file: string | null) {
  if (file !== null) {
    options.formData.upload_file = {
      value: fs.createReadStream(file),
      options: { filename: file},
    };
  }
}

function form_add_attachments(options: any, attachments: any) {
  if (!attachments)
    return;

  if (!Array.isArray(attachments))
    attachments = [attachments];

  let prefix = () => options.no_attachment_prefix ? '' : 'attachment_';

  attachments.forEach(function(aobj: any) {
    var aname;
    if (typeof aobj === 'string') {
      aobj = { filename: aobj };
    } else if (typeof aobj !== 'object' || !aobj.filename) {
      throw new Error("Invalid attachment object type (" + aobj + ")");
    }
    aname = aobj.name || path.basename(aobj.filename);
    options.formData[prefix() + aname] = {
      value: fs.createReadStream(aobj.filename),
      options: aobj,
    };
  });
}

function extend(o: any, src: any) {
  for (var key in src) o[key] = src[key];
  return o;
}

export class CoronerClient {
  endpoint: string;
  insecure: boolean;
  config: any;
  debug: boolean;
  timeout: number;
  _cached_config?: any;

  constructor(options: CoronerConfig) {
    this.endpoint = options.endpoint;
    this.insecure = !!options.insecure;
    this.config = options.config || {};
    this.debug = !!options.debug;
    this.timeout = options.timeout || 30000;
  }

  promise(name: string, ...args): any {
    const fn = this[name];
    if (typeof fn !== 'function')
      throw new Error("Invalid or unknown function name");
    const boundfn = fn.bind(this);

    /* Discard the name from the argument vector before passing it on. */
    const fnArgs = [].slice.call(arguments);
    args.shift();

    return new Promise(function(resolve, reject) {
      args.push(function(error: any, result: any) {
        if (error) {
          reject(error);
        } else {
          resolve(result);
        }
      });
      boundfn.apply(null, fnArgs);
    });
  }

  /*
   * For a full HTTP GET result, use http_get, which returns response context
   * alongside the body.
   *
   * If the caller only cares about error & response body, use get.
   */
  http_get(path: string, params: any, opts: any, callback?: RequestCallback): void {
    const self = this;

    if (typeof opts === 'function') {
      if (typeof callback !== 'undefined')
        throw new Error("Invalid usage: either opts or callback must be a function");
      callback = opts;
      opts = {};
    } else if (typeof callback !== 'function') {
      throw new Error("Invalid usage: either opts or callback must be a function");
    }

    var fullParams;
    if (params) {
      if (this.config && this.config.token) {
        fullParams = extend({token: this.config.token}, params);
      } else {
        fullParams = params;
      }
    } else {
      fullParams = null;
    }

    var options = Object.assign({
      uri: this.endpoint + path,
      qs: fullParams,
      strictSSL: !this.insecure,
      timeout: self.timeout,
      encoding: null,
    }, opts || {});

    if (this.debug) {
      console.error("GET " + options.uri + "?" + qs.stringify(options.qs));
    }

    request.get(options, (err, resp, body) => {
      return onResponse(self, callback!, null, err, resp, body);
    });
  }

  get(path: string, params: any, callback: RequestCallback): void {
    return this.http_get(path, params, function(error: any, http_result: any) {
      if (error) {
        callback(error);
      } else {
        callback(null, http_result.bodyData);
      }
    });
  }

  http_fetch(universe: string, project: string, object: string, params: any, callback: RequestCallback): void {
    var p_type = typeof params;
    if (p_type === 'string') {
      params = { resource: params };
    } else if (!params) {
      params = { resource: 'raw' };
    } else if (p_type !== 'object') {
      throw new Error("Invalid parameter object type '" + p_type + "'");
    }

    var p = Object.assign({
      universe: universe,
      project: project,
      object: object,
    }, params);

    return this.http_get("/api/get", p, callback);
  }

  fetch(universe: string, project: string, object: string, resource: any, callback: RequestCallback): void {
    return this.http_fetch(universe, project, object, resource, function(error: any, http_result: any) {
      if (error) {
        callback(error);
      } else {
        callback(null, http_result.bodyData);
      }
    });
  }

  modify_object(universe: string, project: string, oid: string, params: any, request: any, callback: RequestCallback): void {
    var p = Object.assign({
      universe: universe,
      project: project,
      object: oid,
      format: 'json',
      resource: '_kv',
    }, params || {});
    return this.post("/api/post", p, request, null, callback);
  }

  list(universe: string, project: string, object: string, params: any, callback: RequestCallback): void {
    var p = Object.assign({
      universe: universe,
      project: project,
      object: object,
    }, params || {});

    return this.get("/api/list", p, callback);
  }

  attachments(universe: string, project: string, object: string, params: any, callback: RequestCallback): void {
    var p = Object.assign({
      view: "attachments",
    }, params || {});
    return this.list(universe, project, object, params, callback);
  }

  attach(universe: string, project: string, object: string, name: string, params: any, opt: any, body: any, callback: RequestCallback): void {
    var p = Object.assign({
      universe: universe,
      project: project,
      object: object,
      attachment_name: name,
    }, params || {});

    return this.post("/api/post", p, body, opt, callback);
  }

  post(path: string, params: any, body: any, opt: any, callback: RequestCallback): void {
    const self = this;
    var contentType, fullParams, kvs, payload;
    var uri = check_uri_supported(this.endpoint);
    var http_opts;

    if (!opt)
      opt = {};

    http_opts = opt.http_opts;

    if (params) {
      if (typeof(params.kvs) === 'string') {
        kvs = params.kvs.split(",");
        kvs.forEach(function(kv: string) {
          var pair = kv.split(":");
          if (pair.length == 2) {
            params[pair[0]] = pair[1];
          }
        });
        delete params.kvs;
      } else if (typeof(params.kvs) === 'object') {
        params = Object.assign(params, params.kvs);
        delete params.kvs;
      }

      if (params.http_opts) {
        http_opts = params.http_opts;
        delete params.http_opts;
      }

      if (path !== '/api/login' && this.config && this.config.token) {
        fullParams = extend({token: this.config.token}, params);
      } else {
        fullParams = params;
      }
    } else {
      fullParams = null;
    }

    var options = Object.assign({
      uri: uri.protocol + "//" + uri.host + path,
      strictSSL: !this.insecure,
      timeout: this.timeout,
      encoding: null,
      headers: {},
    }, http_opts || {});

    if (opt.compression) {
      options.headers["Content-Encoding"] = opt.compression;
    }

    if (body) {
      options.qs = fullParams;
      if ('content_type' in opt) {
        options.body = body;
        // Allow omitting content-type if present and null.
        if (opt.content_type)
          options.headers["Content-Type"] = opt.content_type;
      } else if (!opt.binary) {
        options.body = JSON.stringify(body);
        options.encoding = 'utf8';
        options.headers["Content-Type"] = "application/json";
      } else if (opt.binary === true) {
        options.body = body;
        options.headers["Content-Type"] = "application/octet-stream";
      }
    } else {
      options.body = qs.stringify(fullParams);
      options.headers["Content-Type"] = "application/x-www-form-urlencoded";
    }

    if (self.debug) {
      var opts = Object.assign({}, options);
      delete opts.uri;
      delete opts.headers;
      delete opts.body;
      console.error("POST " + options.uri + "?" + qs.stringify(options.qs));
      console.error("Headers: ", JSON.stringify(options.headers, null, 4));
      console.error("Options: ", JSON.stringify(opts, null, 4));
      console.error("Body (" + options.body.length + " bytes):");
      console.error(options.body);
    }

    request.post(options, (err, resp, body) => {
      return onResponse(self, callback, {json: true}, err, resp, body);
    });
  }

  svclayer(action: string, params: any, opts: any, callback: RequestCallback): void {
    const body_params = Object.assign({ action: action }, params);
    this.post('/api/svclayer', {}, body_params, opts, callback);
  }

  post_form(file: string | null, attachments: any, params: any, callback: RequestCallback): void {
    const self = this;
    var kvs;
    var uri = check_uri_supported(this.endpoint);
    var http_opts;
    var form_opts;

    if (this.config && this.config.token && !params.token)
      params.token = this.config.token;

    if (params) {
      if (params.form_opts) {
        form_opts = params.form_opts;
        delete params.form_opts;
      }
      if (params.http_opts) {
        http_opts = params.http_opts;
        delete params.http_opts;
      }

      if (params.kvs) {
        kvs = params.kvs;
        delete params.kvs;
      }
    }

    var options = Object.assign({
      uri: uri.protocol + "//" + uri.host + "/api/post",
      strictSSL: !this.insecure,
      timeout: this.timeout,
      encoding: null,
      qs: params,
      formData: {},
    }, http_opts || {});

    /* Set the form data in the order it should be sent. */
    form_add_kvs(options, kvs);
    if (!form_opts || !form_opts.hash_order) {
      form_add_file(options, file);
      form_add_attachments(options, attachments);
    } else {
      form_add_attachments(options, attachments);
      form_add_file(options, file);
    }

    if (this.debug) {
      console.error("MULTIPART POST " + options.uri + "?" + qs.stringify(options.qs));
      if (options.headers) {
        console.error("Headers: ", JSON.stringify(options.headers, null, 4));
      }
      console.error("Body:");
      for (var fkey in options.formData) {
        var fobj = options.formData[fkey];
        var sobj;
        if (typeof fobj === 'object' && fobj.options) {
          sobj = JSON.stringify(fobj.options);
        } else {
          sobj = JSON.stringify(fobj);
        }
        console.error("  " + fkey + ": " + sobj);
      }
    }

    request.post(options, (err, resp, body) => {
      return onResponse(self, callback, {json: true}, err, resp, body);
    });
  }

  login_token(token: string, callback: RequestCallback): void {
    var self = this;

    var params = { token: token };
    self.post("/api/login", params, null, null, function(err: any, json: any) {
      if (err) return callback(err);
      if (!json.token) return callback(new Error("login response missing token"));
      self.config = json;
      callback(null);
    });
  }

  login(username: string, password: string, callback: RequestCallback): void {
    var self = this;

    var params = {
      username: username,
      password: password,
    };
    self.post("/api/login", params, null, null, function(err: any, json: any) {
      if (err) return callback(err);
      if (!json.token) return callback(new Error("login response missing token"));
      self.config = json;
      callback(null);
    });
  }

  describe(universe: string, project: string, options: any, callback?: RequestCallback): void {
    let disabled = true;

    if (typeof(options) === 'function') {
      /* Backwards compatibility: old API didn't have options arg */
      callback = options;
      options = {};
    } else if (options && options.disabled === false) {
      disabled = false;
    }

    var params = Object.assign({
      action: 'describe',
      universe: universe,
      project: project,
      disabled: false
    }, options);

    this.post("/api/query", params, {}, null, callback!);
  }

  control(action: any, callback: RequestCallback): void {
    if (action)
      action.token = this.config.token;

    this.post("/api/control", null, action, null, callback);
  }

  put_form(dumpfile: string | null, attachments: any, options: any, callback: RequestCallback): void {
    this.post_form(dumpfile, attachments, options, callback);
  }

  put(object: any, options: any, compression: any, callback: RequestCallback): void {
    this.post("/api/post", options, object, { binary: true, compression: compression }, callback);
  }

  query(universe: string, project: string, query: any, callback: RequestCallback): void {
    var params = {
      universe: universe,
      project: project,
    };
    this.post("/api/query", params, query, null, callback);
  }

  queries(universe: string, project: string, action: string, payload: any, callback: RequestCallback): void {
    const params = {
      universe: universe,
    };

    payload = payload || {};
    Object.assign(payload, {project: project});

    const body = {
      action: action,
      form: payload
    };

    this.post("/api/queries", params, body, null, callback);
  }

  control2(universe: string, action: string, form: any, callback: RequestCallback): void {
    var params = {
      universe: universe
    };
    this.post("/api/control/" + action, params, form, null, callback);
  }

  reportSend(universe: string, project: string, form: any, callback: RequestCallback): void {
    var params = {
      universe: universe,
      project: project,
    };
    this.post("/api/report", params, form, null, callback);
  }

  symfile(universe: string, project: string, tag: any, callback: RequestCallback): void {
    var params = {
      universe: universe,
      project: project,
    };
    this.post("/api/symfile", params, tag, null, callback);
  }

  delete_objects(universe: string, project: string, objects: any, params: any, callback: RequestCallback): void {
    var p = Object.assign({
      universe: universe,
      project: project,
      objects: objects,
    }, params);

    if (Array.isArray(p.objects)) {
      /* Tolerate caller arrays of number vs arrays of string etc */
      var objs = p.objects.map(function(x: any) {
        switch(typeof x) {
          case 'number': return x.toString(16);
          case 'object': return x;
          default: return x.toString();
        }
      });
      p.objects = objs;
    }

    this.post("/api/delete", { universe }, p, null, callback);
  }

  delete_by_query(universe: string, project: string, query: any, params: any, callback: RequestCallback): void {
    var p = Object.assign({
      universe: universe,
      project: project,
      query: query,
    }, params);

    this.post("/api/delete", { universe }, p, null, callback);
  }

  async get_config(refresh?: boolean): Promise<any> { 
    if (!this._cached_config || refresh) {
      const config = JSON.parse(await this.promise("get", "/api/config", {}));
      this._cached_config = config
      return config
    }

    return this._cached_config;  
  }

  async has_service(name: string): Promise<boolean> {
    const config = await this.get_config(true)
    const serviceEntry = config.services.find((x: any) => x.name === name);
    return !!serviceEntry;
  }

  /*
   * Find a service from its name.
   */
  async find_service(name: string): Promise<string> {
    /*
     * Config comes from current.json and may be stale. get a new one
     * to find the most recent location of the service.
     *
     * The {} here is very important: it's preserving bug compatibility with
     * get which currently only injects auth params if there's an object to
     * inject them into.
     */
    const config = await this.get_config(true)
    const serviceEntry = config.services.find((x: any) => x.name === name);
    if (!serviceEntry) {
      throw new Error(`No ${ name } service is configured`);
    }
    const endpoint = serviceEntry.endpoint;
    if (!endpoint) {
      throw new Error(`Service ${ name } doesn't have an endpoint`);
    }
    /*
     * Frontend gets to assume that relative urls will work because it's
     * in a browser and pointed at the same domain. We can't, because this is
     * node.
     */
    const relative = endpoint.match(/https?:\/\//) === null;
    if (relative) {
      return urlJoin(this.endpoint, endpoint);
    } else {
      return endpoint;
    }
  }
}

//-- vim:ts=2:et:sw=2
