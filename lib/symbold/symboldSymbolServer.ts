export class SymboldSymbolServer {
  symboldClient: any;

  constructor(client) {
    this.symboldClient = client;
  }

  routeMethod(argv) {
    const method = argv._.shift();
    if (!method) {
      return this.showSymbolServerUsage();
    }
    switch (method) {
      case 'list': {
        const universeProject = argv._.shift();
        this.getSymbolServers(universeProject, argv.page, argv.take);
        break;
      }
      case 'details': {
        const symbolServerId = argv._.shift();
        this.getSymbolServerDetails(symbolServerId);
        break;
      }
      case 'logs': {
        const symbolServerId = argv._.shift();
        const method = argv._.shift();
        if (method === 'filter') {
          const filter = argv._.shift();
          this.getSymbolServerLogsByFilter(
            symbolServerId,
            filter,
            argv.page,
            argv.take,
          );
        } else {
          this.getSymbolServerLogs(symbolServerId, argv.page, argv.take);
        }
        break;
      }
      case 'delete':
      case 'remove': {
        const symbolServerId = argv._.shift();
        this.deleteSymbolServer(symbolServerId);
        break;
      }
      case 'create':
      case 'add': {
        const universeProject = argv._.shift();
        const url = argv._.shift();
        this.createSymbolServer(universeProject, url, argv);
        break;
      }
      case 'update': {
        const symbolServerId = argv._.shift();
        this.updateSymbolServer(symbolServerId, argv);
        break;
      }
      case 'disable': {
        const symbolServerId = argv._.shift();
        this.toggleSymbolServer('disable', symbolServerId);
        break;
      }
      case 'enable': {
        const symbolServerId = argv._.shift();
        this.toggleSymbolServer('enable', symbolServerId);
        break;
      }
      case 'help': {
        this.showSymbolServerUsage();
        break;
      }
      default:
        this.showSymbolServerUsage();
    }
  }

  toggleSymbolServer(action, id) {
    if (this.symboldClient.debug) {
      console.log('Method parameters');
      console.log({action, id});
    }
    if (!id || isNaN(id)) {
      if (this.symboldClient.debug) {
        console.log('id is NaN');
      }
      return this.showSymbolServerUsage('id parameter is required');
    }

    const url = `/symbolserver/${id}/${action}`;
    this.symboldClient.put(url, {});
  }

  updateSymbolServer(id, argv) {
    if (this.symboldClient.debug) {
      console.log('Method parameters');
      console.log({id, argv});
    }
    if (!id || isNaN(id)) {
      if (this.symboldClient.debug) {
        console.log('Id is NaN');
      }
      return this.showSymbolServerUsage('id parameter is required');
    }

    const serverCredentials = this.getServerCredentials(argv);
    const proxy = this.getProxy(argv);
    const data = {
      url: argv.symbolServerUrl,
      name: argv.name,
      force: argv.force === 'true' || argv.whitelist === 1,
      numberOfConcurrentDownload: argv.concurrentdownload,
      retryLimit: argv.retrylimit,
      retryTimeout: argv.retrytimeout,
      timeout: argv.timeout,
      whiteList: argv.whitelist === 'true' || argv.whitelist === 1,
      ignoreCredentials: !proxy && !serverCredentials,
      serverCredentials,
      proxy,
      retain: argv.retain,
    };

    if (this.symboldClient.debug) {
      console.log('Symbol server update model:');
      console.log(data);
    }

    console.log(JSON.stringify(data));
    const url = `/symbolserver/${id}`;
    this.symboldClient.put(url, data);
  }

  createSymbolServer(universeProject, symbolServerUrl, argv) {
    if (this.symboldClient.debug) {
      console.log('Method parameters:');
      console.Console; // cstrahan: is this intentional?
      console.log({universeProject, symbolServerUrl, argv});
    }
    if (!universeProject) {
      return this.showSymbolServerUsage('Missing universe name');
    }

    if (!symbolServerUrl) {
      return this.showSymbolServerUsage('url parameter is required');
    }
    const [universe, project] = universeProject.split('/');
    if (!universeProject || !universe) {
      return this.showSymbolServerUsage('Missing universe name');
    }

    const data = {
      url: symbolServerUrl,
      name: argv.name,
      force: argv.force === 'true' || argv.force === 1,
      numberOfConcurrentDownload: argv.concurrentdownload,
      retryLimit: argv.retrylimit,
      retryTimeout: argv.retrytimeout,
      timeout: argv.timeout,
      whitelist: argv.whitelist === 'true' || argv.force === 1,
      serverCredentials: this.getServerCredentials(argv),
      proxy: this.getProxy(),
      retain: argv.retain,
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

  deleteSymbolServer(symbolServerId) {
    if (this.symboldClient.debug) {
      console.log(`Trying to delete symbol server with id ${symbolServerId}`);
    }
    if (!symbolServerId || isNaN(symbolServerId)) {
      return this.showSymbolServerUsage('Missing symbolserverid');
    }

    const url = `/symbolserver/${symbolServerId}`;
    this.symboldClient.remove(url);
  }

  getSymbolServerLogs(symbolServerId, page = 0, take = 10) {
    if (this.symboldClient.debug) {
      console.log('Trying to fetch symbol server logs. Parameters');
      console.log({symbolServerId, page, take});
    }
    if (!symbolServerId || isNaN(symbolServerId)) {
      return this.showSymbolServerUsage('Missing symbolserverid');
    }

    const url = `/logs/symbolserver/${symbolServerId}?page=${page}&take=${take}`;
    this.symboldClient.get(url);
  }

  getSymbolServerLogsByFilter(symbolServerId, filter, page = 0, take = 10) {
    if (this.symboldClient.debug) {
      console.log('Trying to fetch symbol server logs. Parameters');
      console.log({symbolServerId, page, take, filter});
    }
    if (!symbolServerId || isNaN(symbolServerId)) {
      return this.showSymbolServerUsage('Missing symbolserverid');
    }
    if (!filter) {
      return this.showSymbolServerUsage('Filter is not define!');
    }
    const url = `/logs/symbolserver/${symbolServerId}/text?page=${page}&take=${take}&text=${filter}`;
    this.symboldClient.get(url);
  }

  getSymbolServerDetails(symbolServerId) {
    if (this.symboldClient.debug) {
      console.log(
        `Trying to fetch symbol server detais. Symbol server id: ${symbolServerId}`,
      );
    }
    if (!symbolServerId || isNaN(symbolServerId)) {
      return this.showSymbolServerUsage('Missing symbolserverid');
    }

    const url = `/symbolserver/details/${symbolServerId}`;
    this.symboldClient.get(url);
  }

  getSymbolServers(universeProject, page, take) {
    if (!universeProject) {
      return this.showSymbolServerUsage('Missing universe name');
    }
    const [universe, project] = universeProject.split('/');
    if (!universeProject || !universe) {
      return this.showSymbolServerUsage('Missing universe name');
    }

    const proj_url = project ? `/project/${project}` : '';
    const params = `page=${page ? page : 0}&take=${take ? take : 10}`;
    const url = `/symbolserver/universe/${universe}${proj_url}?${params}`;
    this.symboldClient.get(url);
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

  getServerCredentials(argv) {
    let serverCredentials = undefined;
    if (!argv) {
      return serverCredentials;
    }
    if (argv.servercredentials) {
      serverCredentials = {
        userName: argv.servercredentials.username,
        password: argv.servercredentials.password,
      };
    }
    if (argv.aws) {
      serverCredentials = {
        userName: argv.aws.accesskey,
        password: argv.aws.secret,
        awsConnection: {
          bucketName: argv.aws.bucketname,
          lowerFile: argv.aws.lowerfile === 'true' || argv.aws.lowerfile === 1,
          lowerId: argv.aws.lowerid === 'true' || argv.aws.lowerid === 1,
          usePdb: argv.aws.usepdb === 'true' || argv.aws.usepdb === 1,
        },
      };
    }

    return serverCredentials;
  }

  getProxy(argv?: any) {
    return argv && argv.proxy
      ? {
          host: argv.proxy.host,
          port: argv.proxy.port,
          username: argv.proxy.username,
          password: argv.proxy.password,
        }
      : undefined;
  }
}
