export class SymboldSymbolItem {
  type: any;
  symboldClient: any;

  constructor(type, client) {
    this.type = type;
    this.symboldClient = client;
  }
  routeMethod(argv) {
    const method = argv._.shift();
    if (!method) {
      return this.showSymbolItemUsage();
    }
    switch (method) {
      case "delete":
      case "remove": {
        const argument = argv._.shift();

        if (argument === "all" && this.type === "skiplist") {
          const symbolServerId = argv._.shift();
          this.removeAll(symbolServerId);
        } else if (argument === "filter" && this.type === "skiplist") {
          const symbolServerId = argv._.shift();
          const text = argv._.shift();
          this.removeByText(symbolServerId, text);
        } else {
          console.log(argument);
          this.removeElement(argument);
        }
        break;
      }
      case "find": {
        if (this.type !== "skiplist") {
          this.showSymbolItemUsage("Invalid command");
        }
        const symbolServerId = argv._.shift();
        const text = argv._.shift();
        this.findByText(symbolServerId, text, argv.page, argv.take);
        break;
      }
      case "get":
      case "list": {
        const symbolServerid = argv._.shift();
        this.getElement(symbolServerid, argv.page, argv.take);
        break;
      }
      case "create":
      case "add": {
        if (this.type === "skiplist") {
          this.showSymbolItemUsage(`Unknown command`);
        }
        const symbolServerId = argv._.shift();
        this.addElement(symbolServerId, argv.name);
        break;
      }
      default: {
        this.showSymbolItemUsage(`Cannot find a correct method`);
      }
    }
  }

  removeByText(symbolServerId, text) {
    if (this.symboldClient.debug) {
      console.log(`Method parameters:`);
      console.log({ symbolServerId, text });
    }
    if (!symbolServerId || isNaN(symbolServerId)) {
      return this.showSymbolItemUsage(`Missing symbol server id`);
    }
    if (!text) {
      return this.showSymbolItemUsage(
        `Cannot remove symbols when filter isn't defined`
      );
    }
    const url = `/skiplist/${symbolServerId}/text/${encodeURIComponent(text)}`;
    this.symboldClient.remove(url);
  }

  findByText(symbolServerId, text, page = 0, take = 10) {
    if (this.symboldClient.debug) {
      console.log(`Filter parameters: `);
      console.log({ symbolServerId, text, page, take });
    }
    if (!symbolServerId || isNaN(symbolServerId)) {
      return this.showSymbolItemUsage(`Missing symbol server id`);
    }
    if (!text) {
      return this.showSymbolItemUsage(`Search filter isn't defined'`);
    }
    const url = `/skiplist/${symbolServerId}/text/${text}?page=${page}&take=${take}`;
    if (this.symboldClient.debug) {
      console.log(`Sending request to api. Request parameters: ${url}`);
    }
    this.symboldClient.get(url);
  }

  removeAll(symbolServerId) {
    if (!symbolServerId || isNaN(symbolServerId)) {
      if (this.symboldClient.debug) {
        console.log(`symbol server id is NaN`);
      }
      return this.showSymbolItemUsage(`Missing symbol server id`);
    }
    const url = `/skiplist/${symbolServerId}/all`;
    this.symboldClient.remove(url);
  }

  removeElement(elementId) {
    if (!elementId || isNaN(elementId)) {
      if (this.symboldClient.debug) {
        console.log(`symbol server id is NaN`);
      }
      return this.showSymbolItemUsage(`Missing symbol item id`);
    }
    const url = `/${this.type}/${elementId}`;
    this.symboldClient.remove(url);
  }

  addElement(symbolServerId, symbolName) {
    if (this.symboldClient.debug) {
      console.log(`Method parameters`);
      console.log({ symbolServerId, symbolName });
    }

    if (!symbolServerId || isNaN(symbolServerId)) {
      if (this.symboldClient.debug) {
        console.log(`symbol server id is NaN`);
      }
      return this.showSymbolItemUsage(`Missing symbol server id`);
    }
    if (!symbolName) {
      if (this.symboldClient.debug) {
        console.log(`Symbol name is undefined`);
      }
      return this.showSymbolItemUsage(
        "Empty symbol name. Did you use --name parameter?"
      );
    }
    const url = `/${this.type}/${symbolServerId}`;

    this.symboldClient.post(url, { model: [symbolName] });
  }

  getElement(symbolServerId, page = 0, take = 10) {
    if (this.symboldClient.debug) {
      console.log(`Method parameters`);
      console.log({ symbolServerId, page, take });
    }
    if (!symbolServerId || isNaN(symbolServerId)) {
      return this.showSymbolItemUsage(`Missing symbol server id`);
    }
    const url = `/${this.type}/${symbolServerId}?page=${page}&take=${take}`;
    this.symboldClient.get(url);
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
      this.type === "skiplist"
        ? `morgue symbold ${this.type} find [symbolServerId] [filter] <--page=...> <--take=...>
        find all elements from skip list that match filter
        `
        : ""
    }
    morgue symbold ${this.type} <remove | delete> [symbolItemId] 
        remove element from ${this.type}
    ${
      this.type === "skiplist"
        ? `morgue symbold ${this.type} <remove | delete> all [symbolServerId] 
        delete all skip list entries
        `
        : ""
    }
    ${
      this.type === "skiplist"
        ? `morgue symbold ${this.type} <remove | delete> filter [symbolServerId] [filter]
        delete all elements from skip list that match filter
        `
        : ""
    }
    ${
      this.type !== "skiplist"
        ? `morgue symbold ${this.type} <add | create> [symbolServerId] [--name=symbolName]
        add element to symbol server ${this.type}
        `
        : ""
    }`);
  }
}
