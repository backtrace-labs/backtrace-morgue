import type {
  SymboldWhitelistAddCommand,
  SymboldWhitelistRemoveCommand,
  SymboldWhitelistListCommand,
  SymboldBlacklistAddCommand,
  SymboldBlacklistRemoveCommand,
  SymboldBlacklistListCommand,
  SymboldSkiplistFindCommand,
  SymboldSkiplistRemoveCommand,
  SymboldSkiplistRemoveAllCommand,
  SymboldSkiplistRemoveFilterCommand,
} from '../cli/generated/types';
import {errx} from '../cli/errors';

type ItemType = 'whitelist' | 'blacklist' | 'skiplist';

export class SymboldSymbolItem {
  type: ItemType;
  symboldClient: any;

  constructor(type: ItemType, client) {
    this.type = type;
    this.symboldClient = client;
  }

  addElement(
    cmd:
      | SymboldWhitelistAddCommand
      | SymboldBlacklistAddCommand,
  ) {
    const symbolServerId = cmd.server_id;
    const symbolName = cmd.name;
    if (this.symboldClient.debug) {
      console.log('Method parameters');
      console.log({symbolServerId, symbolName});
    }

    if (isNaN(Number(symbolServerId))) {
      if (this.symboldClient.debug) {
        console.log('symbol server id is NaN');
      }
      errx('Symbol server ID must be a number');
    }
    const url = `/${this.type}/${symbolServerId}`;

    this.symboldClient.post(url, {model: [symbolName]});
  }

  removeElement(
    cmd:
      | SymboldWhitelistRemoveCommand
      | SymboldBlacklistRemoveCommand
      | SymboldSkiplistRemoveCommand,
  ) {
    const elementId = cmd.id;
    if (isNaN(Number(elementId))) {
      if (this.symboldClient.debug) {
        console.log('symbol server id is NaN');
      }
      errx('Element ID must be a number');
    }
    const url = `/${this.type}/${elementId}`;
    this.symboldClient.remove(url);
  }

  listElements(
    cmd:
      | SymboldWhitelistListCommand
      | SymboldBlacklistListCommand,
  ) {
    const symbolServerId = cmd.server_id;
    const page = cmd.page ?? '0';
    const take = cmd.take ?? '10';
    if (this.symboldClient.debug) {
      console.log('Method parameters');
      console.log({symbolServerId, page, take});
    }
    if (isNaN(Number(symbolServerId))) {
      errx('Symbol server ID must be a number');
    }
    const url = `/${this.type}/${symbolServerId}?page=${page}&take=${take}`;
    this.symboldClient.get(url);
  }

  findByText(cmd: SymboldSkiplistFindCommand) {
    const symbolServerId = cmd.server_id;
    const text = cmd.filter;
    const page = cmd.page ?? '0';
    const take = cmd.take ?? '10';
    if (this.symboldClient.debug) {
      console.log('Filter parameters: ');
      console.log({symbolServerId, text, page, take});
    }
    if (isNaN(Number(symbolServerId))) {
      errx('Symbol server ID must be a number');
    }
    if (!text) {
      errx('Search filter is required');
    }
    const url = `/skiplist/${symbolServerId}/text/${text}?page=${page}&take=${take}`;
    if (this.symboldClient.debug) {
      console.log(`Sending request to api. Request parameters: ${url}`);
    }
    this.symboldClient.get(url);
  }

  removeAll(cmd: SymboldSkiplistRemoveAllCommand) {
    const symbolServerId = cmd.server_id;
    if (isNaN(Number(symbolServerId))) {
      if (this.symboldClient.debug) {
        console.log('symbol server id is NaN');
      }
      errx('Symbol server ID must be a number');
    }
    const url = `/skiplist/${symbolServerId}/all`;
    this.symboldClient.remove(url);
  }

  removeByText(cmd: SymboldSkiplistRemoveFilterCommand) {
    const symbolServerId = cmd.server_id;
    const text = cmd.filter;
    if (this.symboldClient.debug) {
      console.log('Method parameters:');
      console.log({symbolServerId, text});
    }
    if (isNaN(Number(symbolServerId))) {
      errx('Symbol server ID must be a number');
    }
    if (!text) {
      errx('Filter is required');
    }
    const url = `/skiplist/${symbolServerId}/text/${encodeURIComponent(text)}`;
    this.symboldClient.remove(url);
  }

}
