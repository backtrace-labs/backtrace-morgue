// AbortController polyfill for Node.js versions that don't have it built-in

interface EventListener {
  callback: Function;
  options?: {once?: boolean};
}

interface EventListeners {
  [type: string]: EventListener[];
}

interface AbortEvent {
  type: string;
  bubbles?: boolean;
  cancelable?: boolean;
  defaultPrevented?: boolean;
}

class Emitter {
  listeners: EventListeners;

  constructor() {
    Object.defineProperty(this, 'listeners', {
      value: {},
      writable: true,
      configurable: true,
    });
  }

  addEventListener(
    type: string,
    callback: Function,
    options?: {once?: boolean},
  ): void {
    if (!(type in this.listeners)) {
      this.listeners[type] = [];
    }
    this.listeners[type].push({callback, options});
  }

  removeEventListener(type: string, callback: Function): void {
    if (!(type in this.listeners)) {
      return;
    }
    const stack = this.listeners[type];
    for (let i = 0, l = stack.length; i < l; i++) {
      if (stack[i].callback === callback) {
        stack.splice(i, 1);
        return;
      }
    }
  }

  dispatchEvent(event: AbortEvent): boolean {
    if (!(event.type in this.listeners)) {
      return false;
    }
    const stack = this.listeners[event.type];
    const stackToCall = stack.slice();
    for (let i = 0, l = stackToCall.length; i < l; i++) {
      const listener = stackToCall[i];
      try {
        listener.callback.call(this, event);
      } catch (e) {
        Promise.resolve().then(() => {
          throw e;
        });
      }
      if (listener.options && listener.options.once) {
        this.removeEventListener(event.type, listener.callback);
      }
    }
    return !event.defaultPrevented;
  }
}

class AbortSignalPolyfill extends Emitter {
  aborted: boolean;
  onabort: ((event: AbortEvent) => void) | null;
  reason: any;

  constructor() {
    super();
    // Some versions of babel does not transpile super() correctly for IE <= 10, if the parent
    // constructor has failed to run, then "this.listeners" will still be undefined and then we call
    // the parent constructor directly instead as a workaround. For general details, see babel bug:
    // https://github.com/babel/babel/issues/3041
    // This hack was added as a fix for the issue described here:
    // https://github.com/Financial-Times/polyfill-library/pull/59#issuecomment-477558042
    if (!this.listeners) {
      Emitter.call(this);
    }

    // Compared to assignment, Object.defineProperty makes properties non-enumerable by default and
    // we want Object.keys(new AbortController().signal) to be [] for compat with the native impl
    Object.defineProperty(this, 'aborted', {
      value: false,
      writable: true,
      configurable: true,
    });
    Object.defineProperty(this, 'onabort', {
      value: null,
      writable: true,
      configurable: true,
    });
    Object.defineProperty(this, 'reason', {
      value: undefined,
      writable: true,
      configurable: true,
    });
  }

  toString(): string {
    return '[object AbortSignal]';
  }

  dispatchEvent(event: AbortEvent): boolean {
    if (event.type === 'abort') {
      this.aborted = true;
      if (typeof this.onabort === 'function') {
        this.onabort.call(this, event);
      }
    }

    return super.dispatchEvent(event);
  }
}

class AbortControllerPolyfill {
  signal: AbortSignalPolyfill;

  constructor() {
    // Compared to assignment, Object.defineProperty makes properties non-enumerable by default and
    // we want Object.keys(new AbortController()) to be [] for compat with the native impl
    Object.defineProperty(this, 'signal', {
      value: new AbortSignalPolyfill(),
      writable: true,
      configurable: true,
    });
  }

  abort(reason?: any): void {
    const event: AbortEvent = {
      type: 'abort',
      bubbles: false,
      cancelable: false,
    };

    let signalReason = reason;
    if (signalReason === undefined) {
      signalReason = new Error('This operation was aborted');
      signalReason.name = 'AbortError';
    }
    this.signal.reason = signalReason;

    this.signal.dispatchEvent(event);
  }

  toString(): string {
    return '[object AbortController]';
  }
}

// Only polyfill if not already available
if (typeof global !== 'undefined' && !('AbortController' in global)) {
  (global as any).AbortController = AbortControllerPolyfill;
}
