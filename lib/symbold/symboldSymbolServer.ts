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

export class SymboldSymbolServer {
  symboldClient: any;

  constructor(client) {
    this.symboldClient = client;
  }

  listServers(cmd: SymboldSymbolserverListCommand) {
    const universeProject = cmd.project;
    if (!universeProject) {
      return this.showSymbolServerUsage('Missing universe name');
    }
    const [universe, project] = universeProject.split('/');
    if (!universe) {
      return this.showSymbolServerUsage('Missing universe name');
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
    if (!symbolServerId || isNaN(Number(symbolServerId))) {
      return this.showSymbolServerUsage('Missing symbolserverid');
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
    if (!symbolServerId || isNaN(Number(symbolServerId))) {
      return this.showSymbolServerUsage('Missing symbolserverid');
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
    if (!symbolServerId || isNaN(Number(symbolServerId))) {
      return this.showSymbolServerUsage('Missing symbolserverid');
    }
    if (!filter) {
      return this.showSymbolServerUsage('Filter is not define!');
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
    if (!universeProject) {
      return this.showSymbolServerUsage('Missing universe name');
    }
    if (!symbolServerUrl) {
      return this.showSymbolServerUsage('url parameter is required');
    }
    const [universe, project] = universeProject.split('/');
    if (!universe) {
      return this.showSymbolServerUsage('Missing universe name');
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
    if (!id || isNaN(Number(id))) {
      if (this.symboldClient.debug) {
        console.log('Id is NaN');
      }
      return this.showSymbolServerUsage('id parameter is required');
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
    if (!symbolServerId || isNaN(Number(symbolServerId))) {
      return this.showSymbolServerUsage('Missing symbolserverid');
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
    if (!id || isNaN(Number(id))) {
      if (this.symboldClient.debug) {
        console.log('id is NaN');
      }
      return this.showSymbolServerUsage('id parameter is required');
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

  showSymbolServerUsage(err?: any) {
    if (err) {
      console.warn(`${err} \n`);
    }

    console.warn(`
    Usage: morgue symbold symbolserver:
        morgue symbold symbolserver list <[universe]/project> [--page=...] [--take=...]
            list universe/project symbol server

        morgue symbold symbolserver details <symbolserverid>
            return a detailed information about symbol server

        morgue symbold symbolserver logs <symbolserverid> [--page=...] [--take=...]
            return first [take] logs from page [page] for symbol server with id <symbolserverid>

        morgue symbold symbolserver logs <symbolserverid> filter <filter> [--page=...] [--take=...]
            return first [take] logs that match filter criteria from page [page] for symbol server with id <symbolserverid>

        morgue symbold symbolserver <delete | remove> <symbolServerId>
            remove symbol server with id <symbolServerId>

        morgue symbold symbolserver <create | add> <[universe]/project> <symbolserverurl>
            [--name=...] [--numberOfConcurrentDownload=...] [--retryLimit=...] [--retryTimeout=...] [--whitelist=...] [--force]
            [--servercredentials.username=...] [--servercredentials.password=...]
            [--aws.bucketname=...] [--aws.lowerfile=...] [--aws.lowerid=...] [aws.accesskey=...]  [--aws.usepdb=...]
            [aws.secret=...] [--proxy.host=...] [--proxy.port=...] [--proxy.username=...]  [--proxy.password=...]

            add new symbol server to symbold. Example:
            $ morgue symbold symbolserver add universe/project https://symbolServerUrl.com --retryLimit=4 --retryTimeout 40


        morgue symbold symbolserver update <symbolserverid>
            [--name=...] [--numberOfConcurrentDownload=...] [--retryLimit=...] [--retryTimeout=...] [--whitelist=...]
            [--servercredentials.username=...] [--servercredentials.password=...]
            [--aws.bucketname=...] [--aws.lowerfile=...] [--aws.lowerid=...]  [--aws.usepdb=...]
            [--proxy.host=...] [--proxy.port=...] [--proxy.username=...]  [--proxy.password=...]

            update symbol server with [symboldserverid] id. Example
            $ morgue symbold symbolserver update 1 --retryLimit=4 --retryTimeout 40

        morgue symbold symbolserver disable <symbolserverid>
            disable symbol server with id <symboldserverid> id

        morgue symbold symbolserver enable <symbolserverid>
            enable symbol server with <symbolserverid> id

	Note: Pagination via --page/--take starts with page 0.
    `);
  }
}
