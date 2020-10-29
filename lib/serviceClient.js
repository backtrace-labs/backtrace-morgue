/*
 * provides a service client that can be subclassed by specific
 * implementations, as well as other helpers useful when writing services.
 *
 *This is intended for the CLI use case, so errors aren't as
 * helpful as they could be.  If we want to separate this into a library,
 * we'll need to clean it up some.
 *
 * To use, subclass this class, pass the parameters up to the constructor,
 * and then use this.request to make requests. The class will handle
 * authenticating and manual url location.
 */
const request = require('request');
const urlJoin = require('url-join');

class ServiceClient {
  constructor(url, coronerLocation, coronerToken) {
    this.url = url;
    this.coronerLocation = coronerLocation;
    this.coronerToken = coronerToken;
    this.defaultQs = {};
  }

  /*
   * Set a set of default querystring parameters. This is used primarily to
   * inject universe/project.
   */
  setDefaultQs(qs) {
    this.defaultQs = qs;
  }


  /*
   * Make a request to the service.
   *
   * @param method: lower-case HTTP method
   * @param path: Relative URL to hit.
   * @param body: Optional body. Will be sent as JSON.
   * @param qs: Optional URL parameters.
   *
   * Returns a promise that resolves to the JSON-decoded response.
   *
   * For convenience when parsing CLI options, filters out any querystring
   * parameters which are set to undefined or null.
   */
  request({ method, path, body = null, qs = {} }) {
    let actualQs = {};
    for (const [k, v] of Object.entries({ ...qs, ... this.defaultQs })) {
      if (v === undefined || v == null) {
        continue;
      }
      actualQs[k] = v;
    }
    return new Promise((resolve, reject) => {
      const url = urlJoin(this.url, path);
      let options = {
        url,
        method: method.toUpperCase(),
        headers: {
          "X-Coroner-Location": this.coronerLocation,
          "X-Coroner-Token": this.coronerToken,
        },
        qs: actualQs,
        json: true,
      };
      if (body) {
        options.body = body;
      }
      request(options, (err, resp, body) => {
        if (err) {
          reject(err);
        } else {
          if (resp.statusCode >= 400) {
            if (body && body.error && body.error.message) {
              reject(`HTTP status ${resp.statusCode}: ${body.error.message}`);
            } else {
              reject(`HTTP status ${ resp.statusCode }`);
            }
          } else {
            resolve(body);
          }
        }
      });
    });
  }

  /*
   * Implements pagination against services using the page_token scheme:
   * { "values": [ ... ], "next_page_token": "token" }
   */
  async *tokenPager({ method, path, body=null, qs = {} }) {
    /*
     * Clone this so that if we passed somethingthe caller will still use, we
     * won't corrupt their state.
     */
    qs = { ... qs };
    let batch = await this.request({ method, path, body, qs });
    let token;
    while (batch.values.length > 0) {
      for (const i of batch.values) {
        yield i;
      }
      token = batch.next_page_token;
      if (!token) {
        break;
      }
      qs.page_token = token;
      batch = await this.request({ method, path, body, qs });
    }
  }
}

module.exports = {
  ServiceClient
};
