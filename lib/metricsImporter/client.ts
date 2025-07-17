const request = require('@cypress/request');
const urlJoin = require('url-join');

class MetricsImporterClient {
  constructor(url, coronerLocation, coronerToken) {
    this.url = url;
    this.coronerLocation = coronerLocation;
    this.coronerToken = coronerToken;
  }

  /*
   * Make a request to metrics-importer.
   *
   * @param method: lower-case HTTP method
   * @param path: Relative URL to hit.
   * @param body: Optional body. Will be sent as JSON.
   * @param qs: Optional URL parameters.
   *
   * Returns a promise that resolves to the JSON-decoded response.
   */
  request(method, path, body = null, qs = {}) {
    return new Promise((resolve, reject) => {
      const url = urlJoin(this.url, path);
      let options = {
        url,
        method: method.toUpperCase(),
        headers: {
          "X-Coroner-Location": this.coronerLocation,
          "X-Coroner-Token": this.coronerToken,
        },
        qs,
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

  async checkSource({ project, sourceId, query }) {
    return await this.request("get",
      `/projects/${ project }/sources/${ sourceId}/check`,
      /* No body. */
      null,
      { query },
    );
  }

  async createImporter({ project, sourceId, name, query, metric, metricGroup,
    startAt, delay, enabled = true }) {
    const body = {
      project,
      sourceId,
      name,
      startAt,
      query,
      metric,
      metricGroup,
      delay,
      enabled,
    };
    const url = `/projects/${ project }/importers`;
    return await this.request("post", url, body);
  }

  async logs({ project, sourceId = null, importerId = null, limit = 1000 }) {
    let params = { limit };
    if (sourceId) {
      params.sourceId = sourceId;
    }
    if (importerId) {
      params.importerId = importerId;
    }
    const url = `/projects/${ project }/logs`;
    return await this.request('get', url, null, params);
  }
}

/*
 * Make a MetricsImporterClient from a CoronerClient.
 */
async function metricsImporterClientFromCoroner(coroner) {
  const serviceUrl = await coroner.find_service("metrics-importer");
  return new MetricsImporterClient(serviceUrl,
    coroner.endpoint, coroner.config.token);
}

module.exports = {
  MetricsImporterClient,
  metricsImporterClientFromCoroner
};
