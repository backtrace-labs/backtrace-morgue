import type {
  SymboldSymbolserverListCommand,
  SymboldSymbolserverDetailsCommand,
  SymboldSymbolserverLogsCommand,
  SymboldSymbolserverLogsFilterCommand,
  SymboldSymbolserverAddCommand,
  SymboldSymbolserverUpdateCommand,
  SymboldSymbolserverDeleteCommand,
  SymboldSymbolserverDisableCommand,
  SymboldSymbolserverEnableCommand,
} from '../cli/generated/types';
import {errx} from '../cli/errors';

export class SymboldSymbolServer {
  symboldClient: any;

  constructor(client) {
    this.symboldClient = client;
  }

  listServers(cmd: SymboldSymbolserverListCommand) {
    const universeProject = cmd.project;
    const [universe, project] = universeProject.split('/');
    if (!universe) {
      errx('Missing universe name');
    }

    const page = cmd.page ?? '0';
    const take = cmd.take ?? '10';
    const proj_url = project ? `/project/${project}` : '';
    const params = `page=${page}&take=${take}`;
    const url = `/symbolserver/universe/${universe}${proj_url}?${params}`;
    this.symboldClient.get(url);
  }

  getDetails(cmd: SymboldSymbolserverDetailsCommand) {
    const symbolServerId = cmd.id;
    if (this.symboldClient.debug) {
      console.log(
        `Trying to fetch symbol server detais. Symbol server id: ${symbolServerId}`,
      );
    }
    if (isNaN(Number(symbolServerId))) {
      errx('Symbol server ID must be a number');
    }

    const url = `/symbolserver/details/${symbolServerId}`;
    this.symboldClient.get(url);
  }

  getLogs(cmd: SymboldSymbolserverLogsCommand) {
    const symbolServerId = cmd.id;
    const page = cmd.page ?? '0';
    const take = cmd.take ?? '10';
    if (this.symboldClient.debug) {
      console.log('Trying to fetch symbol server logs. Parameters');
      console.log({symbolServerId, page, take});
    }
    if (isNaN(Number(symbolServerId))) {
      errx('Symbol server ID must be a number');
    }

    const url = `/logs/symbolserver/${symbolServerId}?page=${page}&take=${take}`;
    this.symboldClient.get(url);
  }

  getLogsByFilter(cmd: SymboldSymbolserverLogsFilterCommand) {
    const symbolServerId = cmd.id;
    const filter = cmd.filter;
    const page = cmd.page ?? '0';
    const take = cmd.take ?? '10';
    if (this.symboldClient.debug) {
      console.log('Trying to fetch symbol server logs. Parameters');
      console.log({symbolServerId, page, take, filter});
    }
    if (isNaN(Number(symbolServerId))) {
      errx('Symbol server ID must be a number');
    }
    if (!filter) {
      errx('Filter is required');
    }
    const url = `/logs/symbolserver/${symbolServerId}/text?page=${page}&take=${take}&text=${filter}`;
    this.symboldClient.get(url);
  }

  addServer(cmd: SymboldSymbolserverAddCommand) {
    const universeProject = cmd.project;
    const symbolServerUrl = cmd.url;

    if (this.symboldClient.debug) {
      console.log('Method parameters:');
      console.log({universeProject, symbolServerUrl, cmd});
    }
    const [universe, project] = universeProject.split('/');
    if (!universe) {
      errx('Missing universe name');
    }

    const serverCredentials = this.buildServerCredentials(cmd);
    const proxy = this.buildProxy(cmd);

    const data = {
      url: symbolServerUrl,
      name: cmd.name,
      force: cmd.force === 'true',
      numberOfConcurrentDownload: cmd.concurrentdownload,
      retryLimit: cmd.retrylimit,
      retryTimeout: cmd.retrytimeout,
      timeout: cmd.timeout,
      whitelist: cmd.whitelist === 'true',
      serverCredentials,
      proxy,
      retain: cmd.retain,
    };
    if (this.symboldClient.debug) {
      console.log('Symbol server data');
      console.log(data);
    }
    const url = `/symbolserver/universe/${universe}${
      project ? `/project/${project}` : ''
    }`;

    this.symboldClient.post(url, data);
  }

  updateServer(cmd: SymboldSymbolserverUpdateCommand) {
    const id = cmd.id;
    if (this.symboldClient.debug) {
      console.log('Method parameters');
      console.log({id, cmd});
    }
    if (isNaN(Number(id))) {
      if (this.symboldClient.debug) {
        console.log('Id is NaN');
      }
      errx('Symbol server ID must be a number');
    }

    const serverCredentials = this.buildServerCredentials(cmd);
    const proxy = this.buildProxy(cmd);
    const data = {
      url: cmd.symbolServerUrl,
      name: cmd.name,
      numberOfConcurrentDownload: cmd.concurrentdownload,
      retryLimit: cmd.retrylimit,
      retryTimeout: cmd.retrytimeout,
      timeout: cmd.timeout,
      whiteList: cmd.whitelist === 'true',
      ignoreCredentials: !proxy && !serverCredentials,
      serverCredentials,
      proxy,
      retain: cmd.retain,
    };

    if (this.symboldClient.debug) {
      console.log('Symbol server update model:');
      console.log(data);
    }

    console.log(JSON.stringify(data));
    const url = `/symbolserver/${id}`;
    this.symboldClient.put(url, data);
  }

  deleteServer(cmd: SymboldSymbolserverDeleteCommand) {
    const symbolServerId = cmd.id;
    if (this.symboldClient.debug) {
      console.log(`Trying to delete symbol server with id ${symbolServerId}`);
    }
    if (isNaN(Number(symbolServerId))) {
      errx('Symbol server ID must be a number');
    }

    const url = `/symbolserver/${symbolServerId}`;
    this.symboldClient.remove(url);
  }

  disableServer(cmd: SymboldSymbolserverDisableCommand) {
    this.toggleSymbolServer('disable', cmd.id);
  }

  enableServer(cmd: SymboldSymbolserverEnableCommand) {
    this.toggleSymbolServer('enable', cmd.id);
  }

  private toggleSymbolServer(action: string, id: string) {
    if (this.symboldClient.debug) {
      console.log('Method parameters');
      console.log({action, id});
    }
    if (isNaN(Number(id))) {
      if (this.symboldClient.debug) {
        console.log('id is NaN');
      }
      errx('Symbol server ID must be a number');
    }

    const url = `/symbolserver/${id}/${action}`;
    this.symboldClient.put(url, {});
  }

  private buildServerCredentials(
    cmd: SymboldSymbolserverAddCommand | SymboldSymbolserverUpdateCommand,
  ) {
    let serverCredentials: any = undefined;
    if (cmd.servercredentialsUsername || cmd.servercredentialsPassword) {
      serverCredentials = {
        userName: cmd.servercredentialsUsername,
        password: cmd.servercredentialsPassword,
      };
    }
    if (cmd.awsAccesskey || cmd.awsSecret || cmd.awsBucketname) {
      serverCredentials = {
        userName: cmd.awsAccesskey,
        password: cmd.awsSecret,
        awsConnection: {
          bucketName: cmd.awsBucketname,
          lowerFile: cmd.awsLowerfile === 'true',
          lowerId: cmd.awsLowerid === 'true',
          usePdb: cmd.awsUsepdb === 'true',
        },
      };
    }
    return serverCredentials;
  }

  private buildProxy(
    cmd: SymboldSymbolserverAddCommand | SymboldSymbolserverUpdateCommand,
  ) {
    if (cmd.proxyHost || cmd.proxyPort) {
      return {
        host: cmd.proxyHost,
        port: cmd.proxyPort,
        username: cmd.proxyUsername,
        password: cmd.proxyPassword,
      };
    }
    return undefined;
  }

}
