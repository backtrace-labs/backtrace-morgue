/*
 * BPG request helpers and standard callbacks.
 */

import {err, errx, success_color} from './errors';

/* Standardized success/failure callbacks. */
export function std_success_cb(r: any): any {
  console.log(success_color('Success'));
}

export function std_json_cb(r: any): any {
  console.log(success_color('Success:'));
  console.log(JSON.stringify(r, null, 4));
}

export function std_failure_cb(e: any): any {
  let msg = e.toString();

  if (e.response_obj && e.response_obj.bodyData) {
    try {
      const je = JSON.parse(e.response_obj.bodyData);

      if (je && je.error && je.error.message) {
        msg = je.error.message;
      }
    } catch (ex) {
      if (e.response_obj.debug) {
        console.log('Response:\n', e.response_obj.bodyData);
      }
      console.log('ex = ', ex);
    }
  }
  errx(msg);
}

export function bpgPost(bpg, request, callback) {
  let json, msg, response;

  if (typeof request === 'string') request = JSON.parse(request);

  response = bpg.post(request);
  json = JSON.parse(response.body);
  msg = json.results[0].string || json.results[0].text;
  if (msg !== 'success') {
    callback(msg);
  } else {
    callback(null, json);
  }
}

export function bpgPostAsync(bpg: any, request: any): Promise<any> {
  return new Promise((resolve, reject) => {
    let json, msg, response;

    if (typeof request === 'string') request = JSON.parse(request);

    response = bpg.post(request);
    json = JSON.parse(response.body);
    const results = json.results[0].result;
    msg = json.results[0].string || json.results[0].text;
    if (msg !== 'success') {
      reject(msg);
    } else {
      resolve(results);
    }
  });
}

export function bpgSingleRequest(request: any): string {
  return JSON.stringify({actions: [request]});
}

export function bpgCbFn(name: any, type: any): (e: any, r: any) => void {
  return (e, r) => {
    if (e) {
      err(`${name} ${type} failed: ${e}`);
      return;
    }
    console.log(`${name} ${type} succeeded!`);
  };
}

export function bpgObjectFind(objects, type, vals, fields?) {
  if (!objects[type]) return null;

  /* Shortcut to simply return the first value. */
  if (vals === null) return objects[type][0];

  /* If fields not specified, assume defaults. */
  const id_attr = type === 'project' ? 'pid' : 'id';
  if (!fields) {
    if (Array.isArray(vals)) {
      fields = [id_attr];
    } else {
      fields = id_attr;
    }
  }

  if (Array.isArray(fields)) {
    if (Array.isArray(vals) === false)
      throw new Error('Invalid bpgObjectFind usage');
    if (fields.length !== vals.length)
      throw new Error('Invalid bpgObjectFind usage');
  } else {
    fields = [fields];
    vals = [vals];
  }

  return objects[type].find(o => {
    for (const idx in vals) {
      if (o.get(fields[idx]) !== vals[idx]) return false;
    }
    return true;
  });
}

