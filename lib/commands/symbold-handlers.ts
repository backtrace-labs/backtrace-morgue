import type {Config} from '../config';
import {SymboldClient} from '../symbold';
import {SymboldSymbolServer} from '../symbold/symboldSymbolServer';
import {SymboldSymbolItem} from '../symbold/symboldSymbolItem';
import {SymboldQueue} from '../symbold/symboldQueue';
import {coronerClientFromGlobal} from '../cli/context';
import type {
  SymboldStatusCommand,
  SymboldSymbolserverListCommand,
  SymboldSymbolserverDetailsCommand,
  SymboldSymbolserverLogsCommand,
  SymboldSymbolserverLogsFilterCommand,
  SymboldSymbolserverAddCommand,
  SymboldSymbolserverUpdateCommand,
  SymboldSymbolserverDeleteCommand,
  SymboldSymbolserverDisableCommand,
  SymboldSymbolserverEnableCommand,
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
  SymboldQueueListCommand,
  SymboldQueueAddCommand,
  SymboldQueueSizeCommand,
  SymboldQueueSymbolsCommand,
  CommandHandler,
  CommandHandlerMap,
} from '../cli/generated/types';

function makeSymboldClient(cmd: {globalOptions: any}, config: Config): SymboldClient {
  const coroner = coronerClientFromGlobal(config, cmd.globalOptions);
  return new SymboldClient(coroner);
}

export const handlers = {
  'symbold.status': (cmd: SymboldStatusCommand, config: Config) => {
    const client = makeSymboldClient(cmd, config);
    return client.status(cmd);
  },

  // --- symbolserver ---

  'symbold.symbolserver.list': (cmd: SymboldSymbolserverListCommand, config: Config) => {
    const client = makeSymboldClient(cmd, config);
    const ss = new SymboldSymbolServer(client);
    return ss.listServers(cmd);
  },

  'symbold.symbolserver.details': (cmd: SymboldSymbolserverDetailsCommand, config: Config) => {
    const client = makeSymboldClient(cmd, config);
    const ss = new SymboldSymbolServer(client);
    return ss.getDetails(cmd);
  },

  'symbold.symbolserver.logs': (cmd: SymboldSymbolserverLogsCommand, config: Config) => {
    const client = makeSymboldClient(cmd, config);
    const ss = new SymboldSymbolServer(client);
    return ss.getLogs(cmd);
  },

  'symbold.symbolserver.logs.filter': (cmd: SymboldSymbolserverLogsFilterCommand, config: Config) => {
    const client = makeSymboldClient(cmd, config);
    const ss = new SymboldSymbolServer(client);
    return ss.getLogsByFilter(cmd);
  },

  'symbold.symbolserver.add': (cmd: SymboldSymbolserverAddCommand, config: Config) => {
    const client = makeSymboldClient(cmd, config);
    const ss = new SymboldSymbolServer(client);
    return ss.addServer(cmd);
  },

  'symbold.symbolserver.update': (cmd: SymboldSymbolserverUpdateCommand, config: Config) => {
    const client = makeSymboldClient(cmd, config);
    const ss = new SymboldSymbolServer(client);
    return ss.updateServer(cmd);
  },

  'symbold.symbolserver.delete': (cmd: SymboldSymbolserverDeleteCommand, config: Config) => {
    const client = makeSymboldClient(cmd, config);
    const ss = new SymboldSymbolServer(client);
    return ss.deleteServer(cmd);
  },

  'symbold.symbolserver.disable': (cmd: SymboldSymbolserverDisableCommand, config: Config) => {
    const client = makeSymboldClient(cmd, config);
    const ss = new SymboldSymbolServer(client);
    return ss.disableServer(cmd);
  },

  'symbold.symbolserver.enable': (cmd: SymboldSymbolserverEnableCommand, config: Config) => {
    const client = makeSymboldClient(cmd, config);
    const ss = new SymboldSymbolServer(client);
    return ss.enableServer(cmd);
  },

  // --- whitelist ---

  'symbold.whitelist.add': (cmd: SymboldWhitelistAddCommand, config: Config) => {
    const client = makeSymboldClient(cmd, config);
    const item = new SymboldSymbolItem('whitelist', client);
    return item.addElement(cmd);
  },

  'symbold.whitelist.remove': (cmd: SymboldWhitelistRemoveCommand, config: Config) => {
    const client = makeSymboldClient(cmd, config);
    const item = new SymboldSymbolItem('whitelist', client);
    return item.removeElement(cmd);
  },

  'symbold.whitelist.list': (cmd: SymboldWhitelistListCommand, config: Config) => {
    const client = makeSymboldClient(cmd, config);
    const item = new SymboldSymbolItem('whitelist', client);
    return item.listElements(cmd);
  },

  // --- blacklist ---

  'symbold.blacklist.add': (cmd: SymboldBlacklistAddCommand, config: Config) => {
    const client = makeSymboldClient(cmd, config);
    const item = new SymboldSymbolItem('blacklist', client);
    return item.addElement(cmd);
  },

  'symbold.blacklist.remove': (cmd: SymboldBlacklistRemoveCommand, config: Config) => {
    const client = makeSymboldClient(cmd, config);
    const item = new SymboldSymbolItem('blacklist', client);
    return item.removeElement(cmd);
  },

  'symbold.blacklist.list': (cmd: SymboldBlacklistListCommand, config: Config) => {
    const client = makeSymboldClient(cmd, config);
    const item = new SymboldSymbolItem('blacklist', client);
    return item.listElements(cmd);
  },

  // --- skiplist ---

  'symbold.skiplist.find': (cmd: SymboldSkiplistFindCommand, config: Config) => {
    const client = makeSymboldClient(cmd, config);
    const item = new SymboldSymbolItem('skiplist', client);
    return item.findByText(cmd);
  },

  'symbold.skiplist.remove': (cmd: SymboldSkiplistRemoveCommand, config: Config) => {
    const client = makeSymboldClient(cmd, config);
    const item = new SymboldSymbolItem('skiplist', client);
    return item.removeElement(cmd);
  },

  'symbold.skiplist.remove.all': (cmd: SymboldSkiplistRemoveAllCommand, config: Config) => {
    const client = makeSymboldClient(cmd, config);
    const item = new SymboldSymbolItem('skiplist', client);
    return item.removeAll(cmd);
  },

  'symbold.skiplist.remove.filter': (cmd: SymboldSkiplistRemoveFilterCommand, config: Config) => {
    const client = makeSymboldClient(cmd, config);
    const item = new SymboldSymbolItem('skiplist', client);
    return item.removeByText(cmd);
  },

  // --- queue ---

  'symbold.queue.list': (cmd: SymboldQueueListCommand, config: Config) => {
    const client = makeSymboldClient(cmd, config);
    const q = new SymboldQueue(client);
    return q.listEvents(cmd);
  },

  'symbold.queue.add': (cmd: SymboldQueueAddCommand, config: Config) => {
    const client = makeSymboldClient(cmd, config);
    const q = new SymboldQueue(client);
    return q.add(cmd);
  },

  'symbold.queue.size': (cmd: SymboldQueueSizeCommand, config: Config) => {
    const client = makeSymboldClient(cmd, config);
    const q = new SymboldQueue(client);
    return q.getSize(cmd);
  },

  'symbold.queue.symbols': (cmd: SymboldQueueSymbolsCommand, config: Config) => {
    const client = makeSymboldClient(cmd, config);
    const q = new SymboldQueue(client);
    return q.getMissingSymbols(cmd);
  },
} satisfies Partial<CommandHandlerMap>;
