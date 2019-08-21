class SymboldSymbolServer {
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
        this.getSymbolServers(universeProject);
        break;
      }
      case 'details': {
        const symbolServerId = argv._.shift();
        this.getSymbolServerDetails(symbolServerId);
        break;
      }
      case 'logs': {
        const symbolServerId = argv._.shift();
        this.getSymbolServerLogs(symbolServerId, argv.page, argv.take);
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
    if (!id || isNaN(id)) {
      return this.showSymbolServerUsage('id parameter is required');
    }

    const url = `/symbolserver/${id}/${action}`;
    this.symboldClient.put(url, {});
  }

  updateSymbolServer(id, argv) {
    if (!id || isNaN(id)) {
      return this.showSymbolServerUsage('id parameter is required');
    }

    const serverCredentials = this.getServerCredentials(argv);
    const proxy = this.getProxy(argv);
    const data = {
      url: argv.symbolServerUrl,
      name: argv.name,
      force: argv.force === 'true',
      numberOfConcurrentDownload: argv.concurrentdownload,
      retryLimit: argv.retrylimit,
      retryTimeout: argv.retrytimeout,
      timeout: argv.timeout,
      whiteList: argv.whitelist === 'true',
      ignoreCredentials: !proxy && !serverCredentials,
      serverCredentials,
      proxy,
    };
    const url = `/symbolserver/${id}`;
    this.symboldClient.put(url, data);
  }

  createSymbolServer(universeProject, symbolServerUrl, argv) {
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
      force: argv.force === 'true',
      numberOfConcurrentDownload: argv.concurrentdownload,
      retryLimit: argv.retrylimit,
      retryTimeout: argv.retrytimeout,
      timeout: argv.timeout,
      whitelist: argv.whitelist === 'true',
      serverCredentials: this.getServerCredentials(),
      proxy: this.getProxy(),
    };
    const url = `/symbolserver/universe/${universe}${
      project ? `/project/${project}` : ''
    }`;

    this.symboldClient.post(url, data);
  }

  deleteSymbolServer(symbolServerId) {
    if (!symbolServerId || isNaN(symbolServerId)) {
      return this.showSymbolServerUsage('Missing symbolserverid');
    }

    const url = `/symbolserver/${symbolServerId}`;
    this.symboldClient.remove(url);
  }

  getSymbolServerLogs(symbolServerId, page = 0, take = 10) {
    if (!symbolServerId || isNaN(symbolServerId)) {
      return this.showSymbolServerUsage('Missing symbolserverid');
    }

    const url = `/logs/symbolserver/${symbolServerId}?page=${page}&take=${take}`;
    this.symboldClient.get(url);
  }

  getSymbolServerDetails(symbolServerId) {
    if (!symbolServerId || isNaN(symbolServerId)) {
      return this.showSymbolServerUsage('Missing symbolserverid');
    }

    const url = `/symbolserver/details/${symbolServerId}`;
    this.symboldClient.get(url);
  }

  getSymbolServers(universeProject) {
    if (!universeProject) {
      return this.showSymbolServerUsage('Missing universe name');
    }
    const [universe, project] = universeProject.split('/');
    if (!universeProject || !universe) {
      return this.showSymbolServerUsage('Missing universe name');
    }

    const url = `/symbolserver/universe/${universe}${
      project ? `/project/${project}` : ''
    }`;
    this.symboldClient.get(url);
  }

  showSymbolServerUsage(err) {
    if (err) {
      console.warn(`${err} \n`);
    }

    console.warn(`
    Usage: morgue symbold symbolserver:
        morgue symbold symbolserver list <[universe]/project> 
            list all universe/project symbol server
        
        morgue symbold symbolserver details <symbolserverid>
            return a detailed information about symbol server
        
        morgue symbold symbolserver logs <symbolserverid> [--page=...] [--take=...]
            return first [take] logs from page [page] for symbol server with id <symbolserverid>
        
        morgue symbold symbolserver <delete | remove> <symbolServerId>
            remove symbol server with id <symbolServerId>      

        morgue symbold symbolserver <create | add> <[universe]/project> <symbolserverurl>
            [--name=...] [--numberOfConcurrentDownload=...] [--retryLimit=...] [--retryTimeout=...] [--whitelist=...] [--force]
            [--servercredentials.name=...] [--servercredentials.password=...]
            [--aws.bucketname=...] [--aws.lowerfile=...] [--aws.lowerid=...]  [--aws.usepdb=...]
            [--proxy.host=...] [--proxy.port=...] [--proxy.username=...]  [--proxy.password=...]

            add new symbol server to symbold. Example:
            $ morgue symbold symbolserver add universe/project https://symbolServerUrl.com --retryLimit=4 --retryTimeout 40
            

        morgue symbold symbolserver update <symbolserverid>
            [--name=...] [--numberOfConcurrentDownload=...] [--retryLimit=...] [--retryTimeout=...] [--whitelist=...]
            [--servercredentials.name=...] [--servercredentials.password=...]
            [--aws.bucketname=...] [--aws.lowerfile=...] [--aws.lowerid=...]  [--aws.usepdb=...]
            [--proxy.host=...] [--proxy.port=...] [--proxy.username=...]  [--proxy.password=...]

            update symbol server with [symboldserverid] id. Example
            $ morgue symbold symbolserver update 1 --retryLimit=4 --retryTimeout 40
        
        morgue symbold symbolserver disable <symbolserverid>
            disable symbol server with id <symboldserverid> id
        
        morgue symbold symbolserver enable <symbolserverid>
            enable symbol server with <symbolserverid> id
        
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
        awcConnection: {
          bucketName: argv.aws.bucketname,
          lowerFile: argv.aws.lowerfile,
          lowerId: argv.aws.lowerid,
          usePdb: argv.aws.usepdb,
        },
      };
    }

    return serverCredentials;
  }

  getProxy(argv) {
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

module.exports.SymboldSymbolServer = SymboldSymbolServer;
