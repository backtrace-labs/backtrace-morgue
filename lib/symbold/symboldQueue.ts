import type {
  SymboldQueueListCommand,
  SymboldQueueAddCommand,
  SymboldQueueSizeCommand,
  SymboldQueueSymbolsCommand,
} from '../cli/generated/types';

export class SymboldQueue {
  symboldClient: any;

  constructor(client) {
    this.symboldClient = client;
  }

  listEvents(_cmd: SymboldQueueListCommand) {
    if (this.symboldClient.debug) {
      console.log('Trying to fetch all events in symbold queue');
    }
    this.symboldClient.get('/queue/events');
  }

  add(cmd: SymboldQueueAddCommand) {
    if (this.symboldClient.debug) {
      console.log('Trying to add new event to symbold queue.');
    }
    const universeProject = cmd.project;
    if (!universeProject) {
      if (this.symboldClient.debug) {
        console.log('Missing universe/project name in parameters');
      }
      return this.showQueueUsage('Missing universe and project name');
    }
    const [universeName, projectName] = universeProject.split('/');
    const objectId = cmd.oid;
    if (!objectId || isNaN(Number(objectId))) {
      if (this.symboldClient.debug) {
        console.log('ObjectId is NaN');
      }
      return this.showQueueUsage('objectId is not defined');
    }
    const missingSymbols = cmd.symbol;
    if (!missingSymbols) {
      if (this.symboldClient.debug) {
        console.log('Missing symbols array is empty');
      }
      return this.showQueueUsage('missing symbols are not defined');
    }

    const url = '/queue/add';

    this.symboldClient.post(url, {
      objectId: parseInt(objectId),
      missingSymbols: [missingSymbols],
      universeName,
      projectName,
    });
  }

  getSize(_cmd: SymboldQueueSizeCommand) {
    if (this.symboldClient.debug) {
      console.log('Trying to queue size');
    }
    this.symboldClient.get('/queue/events/count');
  }

  getMissingSymbols(_cmd: SymboldQueueSymbolsCommand) {
    if (this.symboldClient.debug) {
      console.log('Trying to fetch missing symbols from queue');
    }
    this.symboldClient.get('/queue/missingSymbols');
  }

  showQueueUsage(err?: any) {
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
