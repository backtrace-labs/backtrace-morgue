import type {
  SymboldQueueListCommand,
  SymboldQueueAddCommand,
  SymboldQueueSizeCommand,
  SymboldQueueSymbolsCommand,
} from '../cli/generated/types';
import {errx} from '../cli/errors';

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
    const [universeName, projectName] = universeProject.split('/');
    const objectId = cmd.oid;
    if (isNaN(Number(objectId))) {
      if (this.symboldClient.debug) {
        console.log('ObjectId is NaN');
      }
      errx('Object ID must be a number');
    }
    const missingSymbols = cmd.symbol;

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

}
