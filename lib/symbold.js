var request = require('request');

/**
 * Symbold morgue client
 */
class SymboldClient {
  constructor(coronerdClient) {
    // in this case we still want to use variable name endpoint
    // because in other services/funcitons we used this to retrieve
    // url to coronerd endpoint
    this.coronerdClient = coronerdClient;
    this.symboldEndpoint = `${coronerdClient.endpoint}/api/symbold`;

    this.routing = {
      symbolServer: this.symbolServer,
      whitelist: this.whiteList,
      blacklist: this.blackList,
      skiplist: this.skipList,
      status: this.status,
      help: this.showSymbolServerUsage,
    };
  }

  routeMethod(argv) {
    const handlerName = argv._.shift();
    if (!handlerName) {
      return this.showSymbolServerUsage();
    }
    const handler = this.routing[handlerName.toLowerCase()];
    if (!handler) {
      return this.showSymbolServerUsage();
    }

    handler.apply(this, [argv]);
  }

  status(argv) {
    const universeProject = argv._.shift();
    if (!universeProject) {
      this.showSymbolServerUsage();
    }
    const [universe, project] = universeProject.split('/');
    if (!universe) {
      return this.showSymbolServerUsage('Missing universe name');
    }
    const url = `/status/universe/${universe}${
      project ? `/project/${project}` : ''
    }`;

    this.get(url);
  }

  whiteList(argv) {
    this.routeSymbolItem('whitelist', argv);
  }

  blackList(argv) {
    this.routeSymbolItem('blacklist', argv);
  }

  skipList(argv) {
    this.routeSymbolItem('skiplist', argv);
  }

  routeSymbolItem(type, argv) {
    const method = argv._.shift();
    if (!method) {
      return this.showSymbolServerUsage();
    }
    // do we want to add create/edit options?
    switch (method) {
      case 'remove': {
        const symbolServerId = argv._.shift();
        this.removeElement(type, symbolServerId, argv.itemId);
        break;
      }
      case 'add': {
        if (type === 'skiplist') {
          this.showSymbolServerUsage(`Unknown command`);
        }
        const symbolServerId = argv._.shift();
        this.addElement(type, symbolServerId, argv.name);
        break;
      }
      default: {
        const symbolServerId = parseInt(method);
        if (!isNaN(symbolServerId)) {
          const symbolServerid = parseInt(method);
          this.getElement(type, symbolServerid, argv.page, argv.take);
        } else {
          this.showSymbolServerUsage(`Cannot find a correct method`);
        }
      }
    }
  }

  removeElement(type, elementId) {
    const url = `/${type}/${elementId}`;
    this.remove(url);
  }

  addElement(type, symbolServerId, symbolName) {
    const url = `/${type}/${symbolServerId}`;

    this.post(url, { model: [symbolName] });
  }

  getElement(type, symbolServerId, page = 0, take = 10) {
    const url = `/${type}/${symbolServerId}?page=${page}&take=${take}`;
    this.get(url);
  }

  /**
   * Possible methods that user can perform on symbold symbol servers
   */
  symbolServer(argv) {
    const method = argv._.shift();
    if (!method) {
      return this.showSymbolServerUsage();
    }
    // do we want to add create/edit options?
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
      case 'remove': {
        var symbolServerId = argv._.shift();
        this.deleteSymbolServer(symbolServerId);
        break;
      }
      default:
        this.showSymbolServerUsage();
    }
  }

  deleteSymbolServer(symbolServerId) {
    if (!symbolServerId) {
      return this.showSymbolServerUsage('Missing symbolserverid');
    }

    const url = `/symbolserver/${symbolServerId}`;
    this.remove(url);
  }

  getSymbolServerLogs(symbolServerId, page = 0, take = 10) {
    if (!symbolServerId) {
      return this.showSymbolServerUsage('Missing symbolserverid');
    }

    const url = `/logs/symbolserver/${symbolServerId}?page=${page}&take=${take}`;
    this.get(url);
  }

  getSymbolServerDetails(symbolServerId) {
    if (!symbolServerId) {
      return this.showSymbolServerUsage('Missing symbolserverid');
    }
    const url = `/symbolserver/details/${symbolServerId}`;
    this.get(url);
  }

  getSymbolServers(universeProject) {
    const [universe, project] = universeProject.split('/');
    if (!universeProject || !universe) {
      return showSymbolServerUsage('Missing universe name');
    }

    const url = `/symbolserver/universe/${universe}${
      project ? `/project/${project}` : ''
    }`;
    this.get(url);
  }

  remove(url, callback) {
    request.delete(
      `${this.symboldEndpoint}${url}`,
      {
        headers: this.getCoronerdHeaders(),
      },
      (err, res) => {
        if (callback) {
          callback(err, res);
        }
        if (err) {
          throw err;
        }
        if (res.statusCode >= 300) {
          console.warn(res.body);
          return;
        }
        console.log('Success');
      }
    );
  }

  post(url, data, callback) {
    console.log(data);
    request.post(
      `${this.symboldEndpoint}${url}`,
      {
        body: JSON.stringify(data),
        headers: {
          ...{ 'Content-Type': 'application/json' },
          ...this.getCoronerdHeaders(),
        },
      },
      (err, res) => {
        if (callback) {
          callback(err, res);
        }
        if (err) {
          throw err;
        }
        if (res.statusCode >= 300) {
          console.warn(res.body);
          return;
        }
        console.log(
          `Success. Repsonse data: ${JSON.stringify(res.body, null, 2)}`
        );
      }
    );
  }

  get(url, callback) {
    request.get(
      `${this.symboldEndpoint}${url}`,
      {
        headers: this.getCoronerdHeaders(),
      },
      (err, res) => {
        if (callback) {
          callback(err, res);
          return;
        }
        if (err) {
          throw err;
        }
        if (res.statusCode >= 300) {
          console.warn(res.body);
          return;
        }

        const data = JSON.parse(res.body);
        console.log(JSON.stringify(data, null, 4));
      }
    );
  }

  getCoronerdHeaders() {
    return {
      'X-Coroner-Token': this.coronerdClient.config.token,
      'X-Coroner-Location': this.coronerdClient.endpoint,
    };
  }

  showSymbolServerUsage(err) {
    if (err) {
      console.warn(`${err} \n`);
    }
    console.warn(`
    Usage: morgue symbold <subcommand>:
        morgue symbold symbolServer list <universe>/<project> 
            list all universe/project symbol server
        
        morgue symbold symbolServer details <symbolServerId>
            return a detailed information about symbol server
        
        morgue symbold symbolServer log <symbolServerId> <--page=page> <--take=take>
            return first <take> logs from page <page>
        
        morgue symbold symbolServer remove <symbolServerId>
            remove symbol server with id <symbolServerId>
        
        morgue symbold status
            return symbol server status <univereName>/<projectName>
        
        morgue symbold whitelist <symbolServerId>
            return symbol server with id <symbolServerId> white list
        
        morgue symbold whitelist remove <symbolServerId> <--itemId=itemId> 
            remove element from white list

        morgue symbold whitelist add <symbolServerId> <--name=symbolName>
            add element to symbol server white list

        morgue symbold blacklist <symbolServerId>
            return symbol server with id <symbolServerId> black list
        
        morgue symbold blacklist <symbolServerId> --remove <--id=itemId> 
            remove element from black list

        morgue symbold blacklist <symbolServerId> <--name=symbolName>
            add element to symbol server black list

        morgue symbold skiplist <symbolServerId>
            return symbol server with id <symbolServerId> skip list
        
        morgue symbold skiplist <symbolServerId> --remove <--id=itemId> 
            remove element from skip list

        morgue symbold skiplist <symbolServerId> <--name=symbolName>
            add element to symbol server skip list
        
`);
  }
}

module.exports.SymboldClient = SymboldClient;
