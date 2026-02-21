import axios from 'axios';
import urlJoin from 'url-join';

export class MetricsImporterClient {
  url: any;
  coronerLocation: any;
  coronerToken: any;

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
  async request(method, path, body = null, qs = {}) {
    const url = urlJoin(this.url, path);
    const options: any = {
      url,
      method: method.toUpperCase(),
      headers: {
        'X-Coroner-Location': this.coronerLocation,
        'X-Coroner-Token': this.coronerToken,
      },
      params: qs,
      data: body,
    };

    try {
      const response = await axios(options);
      return response.data;
    } catch (error: any) {
      if (error.response) {
        const resp = error.response;
        const body = resp.data;
        if (resp.status >= 400) {
          if (body && body.error && body.error.message) {
            throw new Error(
              `HTTP status ${resp.status}: ${body.error.message}`,
            );
          } else {
            throw new Error(`HTTP status ${resp.status}`);
          }
        }
      }
      throw error;
    }
  }

  async checkSource({project, sourceId, query}) {
    return await this.request(
      'get',
      `/projects/${project}/sources/${sourceId}/check`,
      /* No body. */
      null,
      {query},
    );
  }

  async createImporter({
    project,
    sourceId,
    name,
    query,
    metric,
    metricGroup,
    startAt,
    delay,
    enabled = true,
  }) {
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
    const url = `/projects/${project}/importers`;
    return await this.request('post', url, body);
  }

  async logs({project, sourceId = null, importerId = null, limit = 1000}) {
    const params: any = {limit};
    if (sourceId) {
      params.sourceId = sourceId;
    }
    if (importerId) {
      params.importerId = importerId;
    }
    const url = `/projects/${project}/logs`;
    return await this.request('get', url, null, params);
  }
}

/*
 * Make a MetricsImporterClient from a CoronerClient.
 */
export async function metricsImporterClientFromCoroner(coroner) {
  const serviceUrl = await coroner.find_service('metrics-importer');
  return new MetricsImporterClient(
    serviceUrl,
    coroner.endpoint,
    coroner.config.token,
  );
}
