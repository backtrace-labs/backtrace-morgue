const { BaseServiceClient } = require("../baseServiceClient");
const { err } = require("../cli/errors");

const urlBuilder = (...parts) => {
  return "/" + parts.filter((p) => p !== undefined).join("/");
};

const integrationsApiPath = (universe, project, id) => {
  return urlBuilder(
    "universes",
    universe,
    "projects",
    project,
    "integrations",
    id
  );
};

const alertsApiPath = (universe, project, id) => {
  return urlBuilder("universes", universe, "projects", project, "alerts", id);
};

const connectionsApiPath = (universe, id) => {
  return urlBuilder("universes", universe, "connections", id);
};

class WorkflowsClient extends BaseServiceClient {
  constructor(url, coronerLocation, coronerToken, insecure = false) {
    super(url, coronerLocation, coronerToken, insecure);
  }

  static async fromCoroner(coroner) {
    const serviceUrl = await coroner.find_service("workflows");
    return new WorkflowsClient(
      serviceUrl,
      coroner.endpoint,
      coroner.config.token,
      coroner.insecure
    );
  }

  static isAvailable(coroner) {
    return coroner.has_service("workflows")
  }

  getIntegration(universe, project, id) {
    return this.request({
      method: "GET",
      path: integrationsApiPath(universe, project, id),
    });
  }

  getIntegrations(universe, project) {
    return this.request({
      method: "GET",
      path: integrationsApiPath(universe, project),
    });
  }

  createIntegration(universe, project, integration) {
    return this.request({
      method: "POST",
      path: integrationsApiPath(universe, project),
      body: integration,
    });
  }

  updateIntegration(universe, project, id, integration) {
    return this.request({
      method: "PUT",
      path: integrationsApiPath(universe, project, id),
      body: integration,
    });
  }

  deleteIntegration(universe, project, id) {
    return this.request({
      method: "DELETE",
      path: integrationsApiPath(universe, project, id),
    });
  }

  getAlert(universe, project, id) {
    return this.request({
      method: "GET",
      path: alertsApiPath(universe, project, id),
    });
  }

  getAlerts(universe, project) {
    return this.request({
      method: "GET",
      path: alertsApiPath(universe, project),
    });
  }

  createAlert(universe, project, alert) {
    return this.request({
      method: "POST",
      path: alertsApiPath(universe, project),
      body: alert,
    });
  }

  updateAlert(universe, project, id, alert) {
    return this.request({
      method: "PUT",
      path: alertsApiPath(universe, project, id),
      body: alert,
    });
  }

  deleteAlert(universe, project, id) {
    return this.request({
      method: "DELETE",
      path: alertsApiPath(universe, project, id),
    });
  }

  getConnection(universe, id) {
    return this.request({
      method: "GET",
      path: connectionsApiPath(universe, id),
    });
  }

  getConnections(universe) {
    return this.request({
      method: "GET",
      path: connectionsApiPath(universe),
    });
  }

  createConnection(universe, connection) {
    return this.request({
      method: "POST",
      path: connectionsApiPath(universe),
      body: connection,
    });
  }

  updateConnection(universe, id, connection) {
    return this.request({
      method: "PUT",
      path: connectionsApiPath(universe, id),
      body: connection,
    });
  }

  deleteConnection(universe, id) {
    return this.request({
      method: "DELETE",
      path: connectionsApiPath(universe, id),
    });
  }

  async handleResponse(resp, body) {
    if (body.error) {
      err(body.error);
      if (body.errorData) {
        err(JSON.stringify(body.errorData, null, "\t"));
      }

      process.exit(1);
    } else if (body.success) {
      return body.body;
    }

    return super.handleResponse(resp, body);
  }
}

module.exports = WorkflowsClient;
