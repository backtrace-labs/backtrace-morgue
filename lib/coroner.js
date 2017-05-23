"use strict";

const http = require('http');
const https = require('https');
const qs = require('querystring');
const url = require('url');
const StreamSink = require('streamsink');
var request = require('request');
var fs = require('fs')

module.exports = CoronerClient;

function CoronerClient(options) {
  this.endpoint = options.endpoint;
  this.insecure = !!options.insecure;
  this.config = options.config || {};
  this.debug = !!options.debug;
  this.timeout = options.timeout || 2000;
}

CoronerClient.prototype.promise = function(name) {
  var fn = this[name];
  if (typeof fn !== 'function')
    return null;
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
CoronerClient.prototype.http_get = function(path, params, callback) {
  const self = this;
  var options = url.parse(this.endpoint);

  var httpLib;
  if (options.protocol === 'https:') {
    httpLib = https;
  } else if (options.protocol === 'http:' || !options.protocol) {
    httpLib = http;
  } else {
    callback(new Error("Unsupported protocol: " + options.protocol));
    return;
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

  var fullPath;

  fullPath = path;
  options.path = fullPath + '?' + qs.stringify(fullParams);
  options.method = "GET";
  options.rejectUnauthorized = !this.insecure;

  if (this.debug) {
    console.error("GET " + options.path);
  }

  var req = httpLib.request(options, onResponse);
  req.on('error', callback);
  req.setTimeout(self.timeout, function() {
    req.abort();
    callback(new Error("request timed out"));
  });
  req.end();

  function onResponse(resp) {
    if (resp.statusCode !== 200) {
      callback(new Error("HTTP " + resp.statusCode + ": " + resp.statusMessage));
      return;
    }

    var sink = new StreamSink();
    sink.on('finish', onFinish);
    resp.on('error', callback);
    resp.pipe(sink);

    function onFinish() {
      var text = sink.toBuffer();
      if (self.debug) {
        console.error("\nResponse:\n");
        console.error(text);
      }
      callback(null, Object.assign({ bodyData: text }, resp));
    }
  }
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

CoronerClient.prototype.fetch = function(universe, project, object, resource, callback) {
  if (!resource)
    resource = "raw";

  var params = {
    universe: universe,
    project: project,
    object: object,
    resource: resource
  };

  this.get("/api/get", params, callback);
};

CoronerClient.prototype.post = function(path, params, body, opt, callback) {
  const self = this;
  var options = url.parse(this.endpoint);

  var httpLib;
  if (options.protocol === 'https:') {
    httpLib = https;
  } else if (options.protocol === 'http:' || !options.protocol) {
    httpLib = http;
  } else {
    callback(new Error("Unsupported protocol: " + options.protocol));
    return;
  }

  var kvs;
  if (params && params.kvs) {
    kvs = params.kvs.split(",");
    kvs.forEach(function(kv) {
      var pair = kv.split(":");
      if (pair.length == 2) {
	      params[pair[0]] = pair[1];
      }
    });
    delete params.kvs;
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

  var payload;
  var contentType;
  var fullPath;

  if (body) {
    if (fullParams) {
      fullPath = path + "?" + qs.stringify(fullParams);
    } else {
      fullPath = path;
    }

    if (!opt || !opt.binary) {
      payload = JSON.stringify(body);
      contentType = "application/json";
    } else if (opt.binary === true) {
      payload = body;
      contentType = "application/octet-stream";
    }
  } else {
    fullPath = path;
    payload = qs.stringify(fullParams);
    contentType = "application/x-www-form-urlencoded";
  }

  options.path = fullPath;
  options.method = "POST";
  options.headers = {
    "Content-Length": payload.length,
    "Content-Type": contentType,
  };
  if (opt && opt.compression) {
    options.headers["Content-Encoding"] = opt.compression;
  }
  options.rejectUnauthorized = !this.insecure;

  if (this.debug) {
    console.error("POST " + options.protocol + '://' + options.host +
        options.path);
    console.error(payload);
  }

  var req = httpLib.request(options, onResponse);
  req.on('error', callback);
  req.setTimeout(self.timeout, function() {
    req.abort();
    callback(new Error("request timed out"));
  });
  req.write(payload);
  req.end();

  function onResponse(resp) {
    if (resp.statusCode !== 200) {
      callback(new Error("HTTP " + resp.statusCode + ": " + resp.statusMessage));
      return;
    }

    var sink = new StreamSink();
    sink.on('finish', onFinish);
    resp.on('error', callback);
    resp.pipe(sink);

    function onFinish() {
      var text = sink.toString('utf8');
      if (self.debug) {
        console.error("\nResponse:\n");
        console.error(text);
      }
      var json;
      try {
        json = JSON.parse(text);
      } catch (err) {
        //console.log('got bad JSON: ', text);
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
    }
  }
};

CoronerClient.prototype.post_form = function(dumpfile, attachments, params, callback) {
  const self = this;
  var options = url.parse(this.endpoint);

  if (options.protocol && options.protocol !== 'https:' && options.protocol !== 'http:') {
    callback(new Error("Unsupported protocol: " + options.protocol));
    return;
  }

  var token = null;
  if (this.config && this.config.token) {
    token = this.config.token;
  } else if (params.token) {
    token = params.token;
  }

  var fullPath = options.protocol  + '//' + options.host;
  if (this.debug) {
    console.error("POST " + fullPath);
  }

  var req = request.post(fullPath, function onResponse(err, httpResponse, body) {
    if (err) {
      console.error('upload failed:', err);
    }
    if (self.debug) {
      console.error("\nResponse:\n");
      console.error(body);
    }
    var json;
    try {
      json = JSON.parse(body);
    } catch (err) {
      callback(new Error("Server sent invalid JSON: " + err.message));
      return;
    }
    if (json.error) {
      let msg = json.error.message ? json.error.message : json.error;
      callback(new Error(msg));
      return;
    }
    callback(null, json);
  });
  var form = req.form();
  form.append('universe', params.universe);
  form.append('project', params.project);
  form.append('token', token);
  form.append('format', params.format);
  var kvs;
  if (params && params.kvs) {
    if (this.debug) {
      console.log("Key-values: " + params.kvs);
    }
    kvs = params.kvs.split(",");
    kvs.forEach(function(kv) {
      var pair = kv.split(":");
      if (pair.length == 2) {
        form.append(pair[0],pair[1]);
      }
    });
    delete params.kvs;
  }
  form.append('upload_file_minidump', fs.createReadStream(dumpfile), {filename: dumpfile});
  if (attachments) {
    attachments.forEach(function(attach_file) {
      form.append('attachment', fs.createReadStream(attach_file), {filename: attach_file});
    });
  }
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

CoronerClient.prototype.describe = function(universe, project, callback) {
  var params = {
    action: 'describe',
    universe: universe,
    project: project,
  };

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

  if (p.objects !== null) {
    /* Tolerate caller arrays of number vs arrays of string etc */
    var objs = p.objects.map(function(x) {
      return (typeof x === 'number') ? x.toString(16) : x.toString();
    });
    p.objects = objs;
  }

  this.post("/api/delete", {}, p, null, callback);
};

function extend(o, src) {
  for (var key in src) o[key] = src[key];
  return o;
}

//-- vim:ts=2:et:sw=2
