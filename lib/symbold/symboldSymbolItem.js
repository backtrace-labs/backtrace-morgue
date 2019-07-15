class SymboldSymbolItem {
  constructor(type, client) {
    this.type = type;
    this.symboldClient = client;
  }
  routeMethod(argv) {
    const method = argv._.shift();
    if (!method) {
      return this.showSymbolItemUsage();
    }
    // do we want to add create/edit options?
    switch (method) {
      case 'remove': {
        const symbolServerId = argv._.shift();
        this.removeElement(symbolServerId, argv.itemid);
        break;
      }
      case 'add': {
        if (this.type === 'skiplist') {
          this.showSymbolItemUsage(`Unknown command`);
        }
        const symbolServerId = argv._.shift();
        this.addElement(symbolServerId, argv.name);
        break;
      }
      default: {
        const symbolServerId = parseInt(method);
        if (!isNaN(symbolServerId)) {
          const symbolServerid = parseInt(method);
          this.getElement(symbolServerid, argv.page, argv.take);
        } else {
          this.showSymbolItemUsage(`Cannot find a correct method`);
        }
      }
    }
  }

  removeElement(elementId) {
    const url = `/${this.type}/${elementId}`;
    this.symboldClient.remove(url);
  }

  addElement(symbolServerId, symbolName) {
    const url = `/${this.type}/${symbolServerId}`;

    this.symboldClient.post(url, { model: [symbolName] });
  }

  getElement(symbolServerId, page = 0, take = 10) {
    const url = `/${this.type}/${symbolServerId}?page=${page}&take=${take}`;
    this.symboldClient.get(url);
  }

  showSymbolItemUsage(err) {
    if (err) {
      console.warn(`${err} \n`);
    }

    console.warn(`
    Usage: morgue symbold ${this.type} <subcommand:

    morgue symbold ${this.type} [symbolServerId] [--page=...] [--take=...]
        return symbol server with id <symbolServerId> ${this.type}
    
    morgue symbold ${this.type} remove [symbolServerId] [--itemId=...] 
        remove element from ${this.type}

        ${
          this.type !== 'skiplist'
            ? `morgue symbold ${
                this.type
              } add [symbolServerId] [--name=symbolName]
        add element to symbol server ${this.type}`
            : ''
        }
        
    `);
  }
}

module.exports.SymboldSymbolItem = SymboldSymbolItem;
