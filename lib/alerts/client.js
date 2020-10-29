const serviceClient = require('../serviceClient');

class AlertsClient extends serviceClient.ServiceClient {
  constructor(url, coronerLocation, coronerToken) {
    super(url, coronerLocation, coronerToken);
  }

  async createTarget(body) {
    return await this.request({ method: "POST", path: "/targets", body });
  }

  async getTarget(id) {
    return await this.request({ method: "GET", path: `/targets/${id}` });
  }

  /* Returns an async iterator. */
  listTargets() {
    return this.tokenPager({ method: "GET", path: "/targets" });
  }

  async updateTarget(id, body) {
    return await this.request({ method: "put", path: `/targets/${id}`, body });
  }

  async deleteTarget(id) {
    return await this.request({ method: "DELETE", path: `/targets/${id}` });
  }

  async createAlert(body) {
    return await this.request({ method: "POST", path: "/alerts", body });
  }

  async getALert(id) {
    return this.request({ method: "GET", path: `/alerts/${id}` });
  }

  /* Returns an async iterator. */
  listAlerts() {
    return this.tokenPager({ method: "GET", path: "/alerts" });
  }

  async updateAlert(id, body) {
    return await this.request({ method: "PUT", path: `/alerts/${id}`, body });
  }

  async deleteAlert(id) {
    return this.request({ method: "DELETE", path: `/alerts/${id}` });
  }
}

async function alertsClientFromCoroner(coroner) {
  const serviceUrl = await coroner.find_service("alerts");
  return new AlertsClient(serviceUrl,
    coroner.endpoint, coroner.config.token);
}

module.exports = {
  AlertsClient,
  alertsClientFromCoroner,
};
