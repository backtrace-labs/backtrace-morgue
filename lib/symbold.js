const request = require('request');
const symbolServer = require('./symbold/symboldSymbolServer');
const symbolItem = require('./symbold/symboldSymbolItem');

/**
 * Symbold morgue client
 */
class SymboldClient {
  constructor(coronerdClient) {
    this.coronerdClient = coronerdClient;
    this.symboldEndpoint = `${coronerdClient.endpoint}/api/symbold`;

    this.routing = {
      symbolserver: argv =>
        new symbolServer.SymboldSymbolServer(this).routeMethod(argv),
      whitelist: argv =>
        new symbolItem.SymboldSymbolItem('whitelist', this).routeMethod(argv),
      blacklist: argv =>
        new symbolItem.SymboldSymbolItem('blacklist', this).routeMethod(argv),
      skiplist: argv =>
        new symbolItem.SymboldSymbolItem('skiplist', this).routeMethod(argv),
      status: argv => this.status(argv),
      help: () => this.showSymbolServerUsage(),
    };
  }

  routeMethod(argv) {
    if (!this.coronerdClient || !this.coronerdClient.endpoint) {
      return this.showSymbolServerUsage('To use symbold command please login');
    }
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
    if (universeProject === 'help') {
      this.showStatusHelp();
      return;
    }
    if (!universeProject) {
      this.showSymbolServerUsage();
      return;
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
        console.log('Successfully delete data');
      }
    );
  }

  put(url, data, callback) {
    const requestHeaders = this.getCoronerdHeaders();
    requestHeaders['Content-Type'] = 'application/json';
    request.put(
      `${this.symboldEndpoint}${url}`,
      {
        body: JSON.stringify(data),
        headers: requestHeaders,
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
        const result = JSON.stringify(res.body, null, 2);
        if (result.length !== 0) {
          console.log(`Success. Response data: ${result}`);
        }
      }
    );
  }
  post(url, data, callback) {
    const requestHeaders = this.getCoronerdHeaders();
    requestHeaders['Content-Type'] = 'application/json';
    request.post(
      `${this.symboldEndpoint}${url}`,
      {
        body: JSON.stringify(data),
        headers: requestHeaders,
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
          `Success. Response data: ${JSON.stringify(res.body, null, 2)}`
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
          callback(err, res)``;
          return;
        }
        if (err) {
          console.log(`Cannot connect to symbol server : ${err.message}`);
          return;
        }
        if (res.statusCode >= 300) {
          console.warn(res.body);
          return;
        }

        try {
          const data = JSON.parse(res.body);
          console.log(JSON.stringify(data, null, 4));
        } catch (err) {
          console.log('Cannot display response.');
        }
      }
    );
  }

  getCoronerdHeaders() {
    return {
      'X-Coroner-Token': this.coronerdClient.config.token,
      'X-Coroner-Location': this.coronerdClient.endpoint,
    };
  }

  showStatusHelp(err) {
    if (err) {
      console.warn(`${err} \n`);
    }
    console.warn(`
      Usage: morgue symbold status <[universe]/project>
      returns symbold status for <[universe]/project> objects
      Example: \n
      $ morgue symbold status backtrace
  `);
  }

  showSymbolServerUsage(err) {
    if (err) {
      console.warn(`${err}`);
    }
    console.warn(`
      Usage: morgue symbold <subcommand>:
          morgue symbold <symbolserver | whitelist | blacklist | skiplist | status> <action>
      
      If you need detailed information please use help command. For example: 
        $ morgue symbold symbolserver help
  `);
  }
}

module.exports.SymboldClient = SymboldClient;
