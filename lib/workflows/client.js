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

  getIntegration(universe, project, idOrName) {
    return this.request({
      method: "GET",
      path: `/universes/${universe}/projects/${project}/integrations/${idOrName}`,
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

  updateIntegration(universe, project, idOrName, integration) {
    return this.request({
      method: "PUT",
      path: `/universes/${universe}/projects/${project}/integrations/${idOrName}`,
      body: integration,
    });
  }

  deleteIntegration(universe, project, idOrName) {
    return this.request({
      method: "DELETE",
      path: `/universes/${universe}/projects/${project}/integrations/${idOrName}`,
    });
  }

  getAlert(universe, project, idOrName) {
    return this.request({
      method: "GET",
      path: `/universes/${universe}/projects/${project}/alerts/${idOrName}`,
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

  updateAlert(universe, project, idOrName, alert) {
    return this.request({
      method: "PUT",
      path: `/universes/${universe}/projects/${project}/alerts/${idOrName}`,
      body: alert,
    });
  }

  deleteAlert(universe, project, idOrName) {
    return this.request({
      method: "DELETE",
      path: `/universes/${universe}/projects/${project}/alerts/${idOrName}`,
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
