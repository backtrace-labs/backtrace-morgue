"use strict";

const http = require('http');
const https = require('https');
const qs = require('querystring');
const url = require('url');
const StreamSink = require('streamsink');

module.exports = CoronerClient;

function CoronerClient(options) {
  this.endpoint = options.endpoint;
  this.insecure = !!options.insecure;
  this.config = options.config || {};
  this.debug = !!options.debug;
  this.timeout = options.timeout || 2000;
}

CoronerClient.prototype.get = function(path, params, callback) {
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
      callback(null, text);
    }
  }
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
        callback(new Error("Server sent invalid JSON: " + err.message));
        return;
      }
      if (json.error) {
        let msg = json.error.message ? json.error.message : String(json.error);
        callback(new Error(msg));
        return;
      }
      callback(null, json);
    }
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

CoronerClient.prototype.delete_objects = function(universe, project, objects, params, callback) {
  var p = Object.assign({
    universe: universe,
    project: project,
    objects: objects,
  }, params);

  if (p.objects !== null && typeof p.objects['join'] === 'function') {
    var objs = p.objects;

    /* Tolerate caller arrays of number vs arrays of string etc */
    if (typeof objs[0] === 'number') {
      objs = p.objects.map(function(x) { return x.toString(16) });
    }
    p.objects = objs.join();
  }

  this.get("/api/delete", p, callback);
};

function extend(o, src) {
  for (var key in src) o[key] = src[key];
  return o;
}

//-- vim:ts=2:et:sw=2
