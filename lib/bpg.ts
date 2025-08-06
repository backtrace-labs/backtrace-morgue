'use strict';

import printf from 'printf';
import clone from 'clone';
import request from 'sync-request';
import chalk from 'chalk';

interface FieldConstraint {
  type?: string;
  constraints: string[];
}

interface FieldType {
  [fieldName: string]: FieldConstraint;
}

interface BPGObjectOptions {
  populate?: boolean;
  key?: any;
  cascade?: boolean;
}

interface CoronerdConfig {
  url: string;
  session?: {
    token: string;
  };
  [key: string]: any;
}

function isPrimary(field: FieldConstraint): boolean {
  let i: number;
  let primary = false;

  for (i = 0; i < field.constraints.length; i++) {
    if (field.constraints[i] === 'primary') primary = true;
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
function generateKey(object: BPGObject): void {
  let source = object;
  let field: string;
  let hasPrimary = false;

  if (object._parent) source = object._parent;

  object._key = {};

  for (field in object._type) {
    const a = object._type[field].constraints;
    if (a.indexOf('primary') > -1) {
      hasPrimary = true;
      break;
    }
  }

  for (field in object._type) {
    const a = object._type[field].constraints;

    if (hasPrimary === true) {
      if (a.indexOf('primary') === -1) continue;
    } else if (
      a.indexOf('unique') === -1 &&
      a.indexOf('autoincrement') === -1
    ) {
      continue;
    }

    object._key[field] = source.get(field);
  }
}

class BPGObject {
  _typeName: string;
  _type: FieldType;
  fields: {[key: string]: any};
  _parent?: BPGObject;
  _key?: {[key: string]: any};

  constructor(t: FieldType, name: string) {
    this._typeName = name;
    this._type = t;
    this.fields = {};
  }

  fork(): BPGObject {
    const object = clone(this);

    /*
     * Clone the parent object, it is immutable outside of
     * of BPG lifecycle interface.
     */
    object._parent = clone(this);
    return object;
  }

  remove(field: string): void {
    delete this.fields[field];
  }

  get(field: string): any {
    if (
      String(field).substring(0, 2) !== '__' &&
      this.fields[field] === undefined
    )
      throw Error('unknown field ' + field);
    return this.fields[field];
  }

  set(field: string, value: any, options?: BPGObjectOptions): void {
    let expectedType: string, type: string;

    if (!options) options = {};

    /*
     * If populating from server input, just set internal string values.
     * This allows fetching such fields, but not setting.
     */
    if (String(field).substring(0, 2) === '__') {
      if ('populate' in options) {
        this.fields[field] = value;
      }
      return;
    }

    if (this._type[field] === undefined)
      throw Error('unknown field name "' + field + '"');

    type = this._type[field].type!;
    if (type === 'text') {
      expectedType = 'string';
    } else if (type === 'integer') {
      expectedType = 'number';
    } else if (type === 'blob') {
      expectedType = 'string';
    } else {
      throw Error('unknown type "' + type + '"');
    }

    if (value !== null && typeof value !== expectedType) {
      throw Error(
        'type mismatch on field "' +
          field +
          '": ' +
          typeof value +
          ' != ' +
          expectedType,
      );
    }

    this.fields[field] = value;
  }

  populate(result: any): void {
    let field: string;
    for (field in result) {
      this.set(field, result[field], {populate: true});
    }
  }

  /*
   * Builder-like method that allows to return itself, e.g.
   *
   * obj = bpg.new('project').withFields({'id': 0, 'name': 'my-name' })
   *
   */
  withFields(fields: any): BPGObject {
    if (typeof fields !== 'object') {
      throw Error('withFields expect an object');
    }

    for (const field in fields) {
      this.set(field, fields[field]);
    }

    return this;
  }
}

export class BPG {
  coronerd: CoronerdConfig;
  id: {[key: string]: number};
  queue: any[];
  opts: any;
  types: {[key: string]: FieldType};
  objects: {[key: string]: BPGObject[]};

  constructor(coronerd: CoronerdConfig, opts?: any) {
    this.coronerd = coronerd;
    this.id = {};
    this.queue = [];
    this.opts = opts ? opts : {};
    this.types = {};
    this.objects = {};
    this.refresh();
  }

  post(payload: any): any {
    let url = this.coronerd.url + '/api/bpg';
    const full_payload = {json: payload};

    if (this.coronerd.session) url += '?token=' + this.coronerd.session.token;

    if (this.opts.debug) {
      console.error('POST ' + url);
      console.error(JSON.stringify(full_payload, null, 4));
    }

    const response = request('POST', url, full_payload);

    if (this.opts.debug) {
      console.error('\nResponse:\n');
      console.error(response.body.toString('utf8'));
    }
    return response;
  }

  refresh(token?: string): void {
    let response: any, json: any, f: any;

    response = this.post({
      actions: [
        {
          action: 'schema',
          model: 'configuration',
        },
      ],
    });

    json = JSON.parse(response.body);
    if (json.error && json.error.message) throw new Error(json.error.message);
    if (Array.isArray(json.results) === false)
      throw new Error('invalid BPG response');
    this.types = json.results[0].result;
  }

  primary(type: string): number {
    let id: number;

    if (this.id[type] === undefined) this.id[type] = 0;

    id = this.id[type]++;
    return id;
  }

  new(type: string): BPGObject {
    if (!this.types[type]) throw Error('unknown type "' + type + '"');

    return new BPGObject(this.types[type], type);
  }

  enqueue(
    a: string,
    object: BPGObject,
    fields: any,
    options?: BPGObjectOptions,
  ): void {
    let cascade = false;
    let key: any;

    if (a !== 'create' && a !== 'modify' && a !== 'delete') {
      throw Error('unknown action');
    }

    if (fields !== null && typeof fields !== 'object')
      throw Error('fields must be a dict');
    /*
     * Construct key object from parent, otherwise construct from
     * child.
     */
    generateKey(object);
    key = object._key;
    if (options && options.key) key = options.key;

    if (options && options.cascade) cascade = options.cascade;

    if (fields) {
      this.queue.push({
        action: a,
        type: 'configuration/' + object._typeName,
        key: key,
        cascade: cascade,
        fields: fields,
      });
    } else {
      this.queue.push({
        action: a,
        type: 'configuration/' + object._typeName,
        key: key,
        cascade: cascade,
        object: object.fields,
      });
    }
  }

  create(object: BPGObject, options?: BPGObjectOptions): void {
    this.enqueue('create', object, null, options);
  }

  modify(object: BPGObject, fields: any, options?: BPGObjectOptions): void {
    this.enqueue('modify', object, fields, options);
  }

  delete(object: BPGObject, options?: BPGObjectOptions): void {
    this.enqueue('delete', object, null, options);
  }

  get(): {[key: string]: BPGObject[]} {
    let response: any, json: any, f: string, i: number;
    const queue: any[] = [];
    const types: string[] = [];

    this.objects = {};

    for (f in this.types) {
      queue.push({action: 'get', type: 'configuration/' + f});
      types.push(f);
    }

    response = this.post({actions: queue});

    json = JSON.parse(response.body);
    if (json.error && json.error.code === 5) {
      console.log(
        chalk.bold.blue(
          'Run setup one more time to receive setup instructions',
        ),
      );
      process.exit(0);
    }

    for (i = 0; i < json.results.length; i++) {
      let j: number;
      for (j = 0; j < json.results[i].result.length; j++) {
        let bo: BPGObject;

        if (!this.objects[types[i]]) this.objects[types[i]] = [];

        bo = new BPGObject(this.types[types[i]], types[i]);
        bo.populate(json.results[i].result[j]);

        this.objects[types[i]].push(bo);
      }
    }

    return this.objects;
  }

  commit(): void {
    let response: any, json: any, f: any, i: number;
    const queue = this.queue;

    this.queue = [];

    response = this.post({actions: queue});
    json = JSON.parse(response.body);
    for (i = 0; i < json.results.length; i++) {
      if (json.results[i].text !== 'success') {
        throw Error(json.results[i].text);
      }
    }
  }

  commitWithResponse(): any {
    const queue = this.queue;

    this.queue = [];

    const response = this.post({actions: queue});
    const json = JSON.parse(response.body);
    for (let i = 0; i < json.results.length; i++) {
      if (json.results[i].text !== 'success') {
        throw Error(json.results[i].text);
      }
    }
    return json;
  }
}

export function blobText(text: string): string {
  let string = '';
  let i: number;

  for (i = 0; i < text.length; i++) {
    string += printf('%.02x', text[i].charCodeAt(0));
  }

  return string;
}

//-- vim:ts=2:et:sw=2
