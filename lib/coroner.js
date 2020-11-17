"use strict";

const qs = require('querystring');
const url = require('url');
const urlJoin = require('url-join');
const path = require('path');
var request = require('request');
var fs = require('fs')

module.exports = CoronerClient;

function CoronerClient(options) {
  this.endpoint = options.endpoint;
  this.insecure = !!options.insecure;
  this.config = options.config || {};
  this.debug = !!options.debug;
  this.timeout = options.timeout || 30000;
}

function check_uri_supported(endpoint) {
  var uri = url.parse(endpoint);

  if (uri.protocol === 'https:') {
  } else if (uri.protocol === 'http:' || !uri.protocol) {
  } else {
    throw new Error("Unsupported protocol " + uri.protocol);
  }
  return uri;
}

function debug_response(resp, body) {
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

function onResponse(coroner, callback, opts, err, resp, body) {
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

function form_add_kvs(options, kvs) {
  if (!kvs)
    return;

  if (typeof kvs === 'string')
    kvs = kvs.split(",");
  kvs.forEach(function(kv) {
    var pair = kv.split(":");
    if (pair.length === 2)
      options.formData[pair[0]] = pair[1];
  });
}

function form_add_file(options, file) {
  if (file !== null) {
    options.formData.upload_file = {
      value: fs.createReadStream(file),
      options: { filename: file},
    };
  }
}

function form_add_attachments(options, attachments) {
  if (!attachments)
    return;

  if (!Array.isArray(attachments))
    attachments = [attachments];

  let prefix = () => options.no_attachment_prefix ? '' : 'attachment_';

  attachments.forEach(function(aobj) {
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

CoronerClient.prototype.promise = function(name) {
  var fn = this[name];
  if (typeof fn !== 'function')
    throw new Error("Invalid or unknown function name");
  var boundfn = fn.bind(this);

  /* Discard the name from the argument vector before passing it on. */
  var args = [].slice.call(arguments);
  args.shift();

  return new Promise(function(resolve, reject) {
    args.push(function(error, result) {
      if (error) {
        reject(error);
      } else {
        resolve(result);
      }
    });
    boundfn.apply(null, args);
  });
}

/*
 * For a full HTTP GET result, use http_get, which returns response context
 * alongside the body.
 *
 * If the caller only cares about error & response body, use get.
 */
CoronerClient.prototype.http_get = function(path, params, opts, callback) {
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
    return onResponse(self, callback, null, err, resp, body);
  });
};

CoronerClient.prototype.get = function(path, params, callback) {
  return this.http_get(path, params, function(error, http_result) {
    if (error) {
      callback(error);
    } else {
      callback(null, http_result.bodyData);
    }
  });
};

CoronerClient.prototype.http_fetch = function(universe, project, object, params, callback) {
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
};

CoronerClient.prototype.fetch = function(universe, project, object, resource, callback) {
  return this.http_fetch(universe, project, object, resource, function(error, http_result) {
    if (error) {
      callback(error);
    } else {
      callback(null, http_result.bodyData);
    }
  });
};

CoronerClient.prototype.modify_object = function(universe, project, oid, params, request, callback) {
  var p = Object.assign({
    universe: universe,
    project: project,
    object: oid,
    format: 'json',
    resource: '_kv',
  }, params || {});
  return this.post("/api/post", p, request, null, callback);
}

CoronerClient.prototype.list = function(universe, project, object, params, callback) {
  var p = Object.assign({
    universe: universe,
    project: project,
    object: object,
  }, params || {});

  return this.get("/api/list", p, callback);
}

CoronerClient.prototype.attachments = function(universe, project, object, params, callback) {
  var p = Object.assign({
    view: "attachments",
  }, params || {});
  return this.list(universe, project, object, params, callback);
}

CoronerClient.prototype.attach = function(universe, project, object, name, params, opt, body, callback) {
  var p = Object.assign({
    universe: universe,
    project: project,
    object: object,
    attachment_name: name,
  }, params || {});

  return this.post("/api/post", p, body, opt, callback);
}

CoronerClient.prototype.post = function(path, params, body, opt, callback) {
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
      kvs.forEach(function(kv) {
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
};

CoronerClient.prototype.svclayer = function(action, params, opts, callback) {
  const body_params = Object.assign({ action: action }, params);
  this.post('/api/svclayer', {}, body_params, opts, callback);
}

CoronerClient.prototype.post_form = function(file, attachments, params, callback) {
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
};

CoronerClient.prototype.login_token = function(token, callback) {
  var self = this;

  var params = { token: token };
  self.post("/api/login", params, null, null, function(err, json) {
    if (err) return callback(err);
    if (!json.token) return callback(new Error("login response missing token"));
    self.config = json;
    callback();
  });
};

CoronerClient.prototype.login = function(username, password, callback) {
  var self = this;

  var params = {
    username: username,
    password: password,
  };
  self.post("/api/login", params, null, null, function(err, json) {
    if (err) return callback(err);
    if (!json.token) return callback(new Error("login response missing token"));
    self.config = json;
    callback();
  });
};

CoronerClient.prototype.describe = function(universe, project, options, callback) {
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

  this.post("/api/query", params, {}, null, callback);
};

CoronerClient.prototype.control = function(action, callback) {
  if (action)
    action.token = this.config.token;

  this.post("/api/control", null, action, null, callback);
};

CoronerClient.prototype.put_form = function(dumpfile, attachments, options, callback) {

  this.post_form(dumpfile, attachments, options, callback);
};

CoronerClient.prototype.put = function(object, options, compression, callback) {

  this.post("/api/post", options, object, { binary: true, compression: compression }, callback);
};

CoronerClient.prototype.query = function(universe, project, query, callback) {
  var params = {
    universe: universe,
    project: project,
  };
  this.post("/api/query", params, query, null, callback);
};

CoronerClient.prototype.queries = function(universe, project, action, payload, callback) {
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
};

CoronerClient.prototype.control2 = function(universe, action, form, callback) {
  var params = {
    universe: universe
  };
  this.post("/api/control/" + action, params, form, null, callback);
};
CoronerClient.prototype.reportSend = function(universe, project, form, callback) {
  var params = {
    universe: universe,
    project: project,
  };
  this.post("/api/report", params, form, null, callback);
};
CoronerClient.prototype.symfile = function(universe, project, tag, callback) {
  var params = {
    universe: universe,
    project: project,
  };
  this.post("/api/symfile", params, tag, null, callback);
};

CoronerClient.prototype.delete_objects = function(universe, project, objects, params, callback) {
  var p = Object.assign({
    universe: universe,
    project: project,
    objects: objects,
  }, params);

  if (Array.isArray(p.objects)) {
    /* Tolerate caller arrays of number vs arrays of string etc */
    var objs = p.objects.map(function(x) {
      switch(typeof x) {
        case 'number': return x.toString(16);
        case 'object': return x;
        default: return x.toString();
      }
    });
    p.objects = objs;
  }

  this.post("/api/delete", {}, p, null, callback);
};

/*
 * Find a service from its name.
 */
CoronerClient.prototype.find_service = async function (name) {
  /*
   * Config comes from current.json and may be stale. get a new one
   * to find the most recent location of the service.
   *
   * The {} here is very important: it's preserving bug compatibility with
   * get which currently only injects auth params if there's an object to
   * inject them into.
   */
  const config = JSON.parse(await this.promise("get", "/api/config", {}));
  const serviceEntry = config.services.filter(x => x.name === name)[0];
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

function extend(o, src) {
  for (var key in src) o[key] = src[key];
  return o;
}

//-- vim:ts=2:et:sw=2
