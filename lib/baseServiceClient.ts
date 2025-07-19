/*
 * provides a base that can be subclassed by specific
 * service clients, as well as other helpers useful when writing services.
 *
 *This is intended for the CLI use case, so errors aren't as
 * helpful as they could be.  If we want to separate this into a library,
 * we'll need to clean it up some.
 *
 * To write a service client with this interface,  subclass this class, pass the
 * parameters up to the constructor, and then use this.request to make requests.
 * The class will handle authenticating and specification of the
 * `X-Coronerd-Location` header, and offers
 * functions to aid in pagination which we will extend on a case-by-case basis
 * as we need them.
 */
import request from '@cypress/request';
import urlJoin from 'url-join';

export class BaseServiceClient {
  url: any;
  coronerLocation: any;
  coronerToken: any;
  defaultQs: any;
  insecure: boolean;

  /*
   * @param url: The base URL of the service.
   * @param coronerLocation: the URL to the Coronerd instance.
   * !@param coronerToken: The token to use to authenticate with Coronerd and
   *        the service.
   * @param insecure: set to true if the user passed `-k` or otherwise
   *        requested that SSL certs not be verified.
   */
  constructor(url, coronerLocation, coronerToken, insecure=false) {
    this.url = url;
    this.coronerLocation = coronerLocation;
    this.coronerToken = coronerToken;
    this.defaultQs = {};
    this.insecure = insecure;
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
   * parameters which are set to undefined or null.  This allows one to pass
   * optional CLI args directly through to the service without having to go
   * through the trouble of making sure they aren't included, since minimist is
   * too minimal to provide defaults and other validation.
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
      let options: any = {
        url,
        method: method.toUpperCase(),
        headers: {
          "X-Coroner-Location": this.coronerLocation,
          "X-Coroner-Token": this.coronerToken,
        },
        qs: actualQs,
        json: true,
        strictSSL: !this.insecure,
      };
      if (body) {
        options.body = body;
      }
      request(options, (err, resp, body) => {
        if (err) {
          reject(err);
        } else {
          this.handleResponse(resp, body).then(resolve).catch(reject);
        }
      });
    });
  }

  /*
   * Implements pagination against services using the page_token scheme:
   * { "values": [ ... ], "next_page_token": "token" }
   *
   * This scheme is used by Rust services which have additional requirements
   * that make limit-offset pagination unsuitable.
   */
  async *tokenPager({ method, path, body=null, qs: any = {} }) {
    /*
     * Clone this so that if we passed something the caller will still use, we
     * won't corrupt their state.
     */
    var qs = { ... qs };
    let batch: any = await this.request({ method, path, body, qs });
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

  async handleResponse(resp, body) {
    if (resp.statusCode >= 400) {
      if (body && body.error && body.error.message) {
        throw new Error(
          `HTTP status ${resp.statusCode}: ${body.error.message}`
        );
      } else {
        throw new Error(`HTTP status ${resp.statusCode}`);
      }
    } else {
      return body;
    }
  }
}
