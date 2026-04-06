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

    if (!symbolServerId || isNaN(Number(symbolServerId))) {
      if (this.symboldClient.debug) {
        console.log('symbol server id is NaN');
      }
      return this.showSymbolItemUsage('Missing symbol server id');
    }
    if (!symbolName) {
      if (this.symboldClient.debug) {
        console.log('Symbol name is undefined');
      }
      return this.showSymbolItemUsage(
        'Empty symbol name. Did you use --name parameter?',
      );
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
    if (!elementId || isNaN(Number(elementId))) {
      if (this.symboldClient.debug) {
        console.log('symbol server id is NaN');
      }
      return this.showSymbolItemUsage('Missing symbol item id');
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
    if (!symbolServerId || isNaN(Number(symbolServerId))) {
      return this.showSymbolItemUsage('Missing symbol server id');
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
    if (!symbolServerId || isNaN(Number(symbolServerId))) {
      return this.showSymbolItemUsage('Missing symbol server id');
    }
    if (!text) {
      return this.showSymbolItemUsage("Search filter isn't defined'");
    }
    const url = `/skiplist/${symbolServerId}/text/${text}?page=${page}&take=${take}`;
    if (this.symboldClient.debug) {
      console.log(`Sending request to api. Request parameters: ${url}`);
    }
    this.symboldClient.get(url);
  }

  removeAll(cmd: SymboldSkiplistRemoveAllCommand) {
    const symbolServerId = cmd.server_id;
    if (!symbolServerId || isNaN(Number(symbolServerId))) {
      if (this.symboldClient.debug) {
        console.log('symbol server id is NaN');
      }
      return this.showSymbolItemUsage('Missing symbol server id');
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
    if (!symbolServerId || isNaN(Number(symbolServerId))) {
      return this.showSymbolItemUsage('Missing symbol server id');
    }
    if (!text) {
      return this.showSymbolItemUsage(
        "Cannot remove symbols when filter isn't defined",
      );
    }
    const url = `/skiplist/${symbolServerId}/text/${encodeURIComponent(text)}`;
    this.symboldClient.remove(url);
  }

  showSymbolItemUsage(err?: any) {
    if (err) {
      console.warn(`
      ${err} \n
      `);
    }

    console.warn(`
    Usage: morgue symbold ${this.type} <subcommand:

    morgue symbold ${
      this.type
    } <list|get> [symbolServerId] <--page=...> <--take=...>
        return symbol server with id <symbolServerId> ${this.type}

    ${
      this.type === 'skiplist'
        ? `morgue symbold ${this.type} find [symbolServerId] [filter] <--page=...> <--take=...>
        find all elements from skip list that match filter
        `
        : ''
    }
    morgue symbold ${this.type} <remove | delete> [symbolItemId]
        remove element from ${this.type}
    ${
      this.type === 'skiplist'
        ? `morgue symbold ${this.type} <remove | delete> all [symbolServerId]
        delete all skip list entries
        `
        : ''
    }
    ${
      this.type === 'skiplist'
        ? `morgue symbold ${this.type} <remove | delete> filter [symbolServerId] [filter]
        delete all elements from skip list that match filter
        `
        : ''
    }
    ${
      this.type !== 'skiplist'
        ? `morgue symbold ${this.type} <add | create> [symbolServerId] [--name=symbolName]
        add element to symbol server ${this.type}
        `
        : ''
    }`);
  }
}
