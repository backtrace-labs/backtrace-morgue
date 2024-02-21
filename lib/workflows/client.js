const { BaseServiceClient } = require("../baseServiceClient");
const { err } = require("../cli/errors");

class WorkflowsClient extends BaseServiceClient {
  static async fromCoroner(coroner) {
    const serviceUrl = await coroner.find_service("workflows");
    return new WorkflowsClient(
      serviceUrl,
      coroner.endpoint,
      coroner.config.token,
      coroner.insecure
    );
  }

  getIntegration(universe, project, id) {
    return this.request({
      method: "GET",
      path: `/universes/${universe}/projects/${project}/integrations/${id}`,
    });
  }

  getIntegrations(universe, project) {
    return this.request({
      method: "GET",
      path: `/universes/${universe}/projects/${project}/integrations`,
    });
  }

  createIntegration(universe, project, integration) {
    return this.request({
      method: "POST",
      path: `/universes/${universe}/projects/${project}/integrations`,
      body: integration,
    });
  }

  updateIntegration(universe, project, id, integration) {
    return this.request({
      method: "PUT",
      path: `/universes/${universe}/projects/${project}/integrations/${id}`,
      body: integration,
    });
  }

  deleteIntegration(universe, project, id) {
    return this.request({
      method: "DELETE",
      path: `/universes/${universe}/projects/${project}/integrations/${id}`,
    });
  }

  getAlert(universe, project, id) {
    return this.request({
      method: "GET",
      path: `/universes/${universe}/projects/${project}/alerts/${id}`,
    });
  }

  getAlerts(universe, project) {
    return this.request({
      method: "GET",
      path: `/universes/${universe}/projects/${project}/alerts`,
    });
  }

  createAlert(universe, project, alert) {
    return this.request({
      method: "POST",
      path: `/universes/${universe}/projects/${project}/alerts`,
      body: alert,
    });
  }

  updateAlert(universe, project, id, alert) {
    return this.request({
      method: "PUT",
      path: `/universes/${universe}/projects/${project}/alerts/${id}`,
      body: alert,
    });
  }

  deleteAlert(universe, project, id) {
    return this.request({
      method: "DELETE",
      path: `/universes/${universe}/projects/${project}/alerts/${id}`,
    });
  }

  getConnection(universe, id) {
    return this.request({
      method: "GET",
      path: `/universes/${universe}/connections/${id}`,
    });
  }

  getConnections(universe) {
    return this.request({
      method: "GET",
      path: `/universes/${universe}/connections`,
    });
  }

  createConnection(universe, connection) {
    return this.request({
      method: "POST",
      path: `/universes/${universe}/connections`,
      body: connection,
    });
  }

  updateConnection(universe, id, connection) {
    return this.request({
      method: "PUT",
      path: `/universes/${universe}/connections/${id}`,
      body: connection,
    });
  }

  deleteConnection(universe, id) {
    return this.request({
      method: "DELETE",
      path: `/universes/${universe}/connections/${id}`,
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
