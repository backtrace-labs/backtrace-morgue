'use strict';

const request = require('sync-request'),
       printf = require('printf'),
        clone = require('clone');

function isPrimary(field) {
  var i;
  var primary = false;

  for (i = 0; i < field.constraints.length; i++) {
    if (field.constraints[i] === 'primary')
      primary = true;
    if (String(field.constraints[i]).indexOf('references ') > 0)
      primary = false;
  }

  return primary;
}

/*
 * Generates the key field for an object. If a parent is present, then the
 * key used is that of the parent's primary fields. Otherwise, it uses
 * fields from existing object.
 */
function generateKey(object) {
  var source = object;
  var field;

  if (object._parent)
    source = object._parent;

  object._key = {};

  for (field in object._type) {
    var a = object._type[field].constraints;
    if (a.indexOf('primary') === -1)
      continue;

    object._key[field] = source.get(field);
  }
}

class BPGObject {
  constructor(t, name) {
    this._typeName = name;
    this._type = t;
    this.fields = {};
  }

  fork() {
    var object = clone(this);

    /*
     * Clone the parent object, it is immutable outside of
     * of BPG lifecycle interface.
     */
    object._parent = clone(this);
    return object;
  }

  remove(field) {
    delete this.fields[field];
  }

  get(field) {
    if (String(field).substring(0, 2) !== '__' && this.fields[field] === undefined)
      throw Error('unknown field ' + field);
    return this.fields[field];
  }

  set(field, value) {
    var expectedType, type;

    if (String(field).substring(0, 2) === '__')
      return;

    if (this._type[field] === undefined)
      throw Error('unknown field name "' + field + '"');

    type = this._type[field].type;
    if (type === 'text') {
      expectedType = 'string';
    } else if (type === 'integer') {
      expectedType = 'number';
    } else if (type === 'blob') {
      expectedType = 'string';
    } else {
      throw Error('unknown type "' + type + '"');
    }

    if (value !== null && typeof(value) !== expectedType) {
      throw Error('type mismatch on field "' + field + '": ' +
        typeof(value) + ' != ' + expectedType);
    }

    this.fields[field] = value;
  }
}

class BPG {
  constructor(coronerd) {
    this.coronerd = coronerd;
    this.refresh();
    this.id = {};
    this.queue = [];
  }

  refresh(token) {
    var url = this.coronerd.url + '/api/bpg';
    var response, json, f;

    if (this.coronerd.session)
      url += '?token=' + this.coronerd.session.token;

    response = request('POST', url, { json : {
      'actions' : [
        {
          'action' : 'schema',
           'model' : 'configuration'
        }
      ]
    }});

    json = JSON.parse(response.body);
    this.types = json.results[0].result;
  }

  primary(type) {
    var id;

    if (this.id[type] === undefined)
      this.id[type] = 0;

    id = this.id[type]++;
    return id;
  }

  new(type) {
    if (!this.types[type])
      throw Error('unknown type "' + type + '"');

    return new BPGObject(this.types[type], type);
  }

  enqueue(a, object, fields, options) {
    var key;

    if (a !== 'create' &&
        a !== 'modify' &&
        a !== 'delete') {
      throw Error('unknown action');
    }

    /*
     * Construct key object from parent, otherwise construct from
     * child.
     */
    generateKey(object);
    key = object._key;
    if (options && options.key)
      key = options.key;

    if (fields) {
      this.queue.push({
        action: a,
          type: 'configuration/' + object._typeName,
           key: key,
        fields: fields
      });
    } else {
      this.queue.push({
        action: a,
          type: 'configuration/' + object._typeName,
           key: key,
        object: object.fields
      });
    }
  }

  create(object, options) {
    this.enqueue('create', object, null, options);
  }

  modify(object, fields, options) {
    this.enqueue('modify', object, fields, options);
  }

  delete(object, options) {
    this.enqueue('delete', object, null, options);
  }

  get() {
    var url = this.coronerd.url + '/api/bpg';
    var response, json, f, i;
    var queue = [];
    var types = [];

    this.objects = {};

    if (this.coronerd.session)
      url += '?token=' + this.coronerd.session.token;

    for (f in this.types) {
      queue.push({ action: 'get', type: 'configuration/' + f});
      types.push(f);
    }

    response = request('POST', url, { json : {
      'actions' : queue
    }});

    json = JSON.parse(response.body);
    for (i = 0; i < json.results.length; i++) {
      var j;
      for (j = 0; j < json.results[i].result.length; j++) {
        var result = json.results[i].result[j];
        var bo, field;

        if (!this.objects[types[i]])
          this.objects[types[i]] = [];

        bo = new BPGObject(this.types[types[i]], types[i]);

        for (field in result) {
          bo.set(field, result[field]);
        }

        this.objects[types[i]].push(bo);
      }
    }

    return this.objects;
  }

  commit() {
    var url = this.coronerd.url + '/api/bpg';
    var response, json, f;
    var queue = this.queue;

    this.queue = [];

    if (this.coronerd.session)
      url += '?token=' + this.coronerd.session.token;

    response = request('POST', url, { json : { 'actions' : queue }});
    json = JSON.parse(response.body);
    if (json.results[0].text !== 'success') {
      throw Error(json.results[0].text);
    }
  }
}

function blobText(text) {
  var string = '';
  var i;

  for (i = 0; i < text.length; i++) {
    string += printf('%.02x', text[i].charCodeAt(0));
  }

  return string;
}

module.exports.BPG = BPG;
module.exports.blobText = blobText;

//-- vim:ts=2:et:sw=2