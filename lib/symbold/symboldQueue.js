class SymboldQueue {
  constructor(client) {
    this.symboldClient = client;
  }

  routeMethod(argv) {
    const method = argv._.shift();
    if (!method) {
      return this.showQueueUsage();
    }
    switch (method) {
      case 'list':
      case 'get': {
        this.getAllEvents();
        break;
      }
      case 'create':
      case 'add': {
        const universeProject = argv._.shift();
        const missingSymbols = argv._.shift();
        const objectId = argv._.shift();
        this.add(universeProject, objectId, missingSymbols);
        break;
      }
      case 'size': {
        this.getSize();
        break;
      }
      case 'symbols': {
        this.getMissingSymbols();
        break;
      }
      default: {
        this.showQueueUsage(`Cannot find a correct method`);
      }
    }
  }

  getMissingSymbols() {
    this.symboldClient.get('/queue/missingSymbols');
  }

  getAllEvents() {
    this.symboldClient.get('/queue/events');
  }

  getSize() {
    this.symboldClient.get('/queue/events/count');
  }

  getSymbols() {
    this.symboldClient.get('/queue/missingSymbols');
  }

  add(universeProject, objectId, missingSymbols) {
    if (!universeProject) {
      return this.showQueueUsage('Missing universe and project name');
    }
    const [universeName, projectName] = universeProject.split('/');
    if (!objectId || isNaN(objectId)) {
      return this.showQueueUsage('objectId is not defined');
    }
    if (!missingSymbols) {
      return this.showQueueUsage('missing symbols are not defined');
    }

    const url = `/queue/add`;

    this.symboldClient.post(url, {
      objectId: parseInt(objectId),
      missingSymbols: [missingSymbols],
      universeName,
      projectName,
    });
  }

  showQueueUsage(err) {
    if (err) {
      console.warn(`
        ${err} \n
        `);
    }

    console.warn(`
    Note: Morgue Queue command can be executed only by Backtrace admins or super users.
      Usage: morgue symbold queue <subcommand:      
      
      morgue symbold queue <get | list> 
          returns all symbold events
      
      morgue symbold queue <add | create> <universe/project> <missingSymbol> <object_id> 
          create new symbold event on the top of the queue
      
      morgue symbold queue size
          returns queue size
      
      morgue symbold queue symbols
          returns all list of missing_symbols          
      `);
  }
}

module.exports.SymboldQueue = SymboldQueue;
