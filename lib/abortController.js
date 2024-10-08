class Emitter {
  constructor() {
    Object.defineProperty(this, "listeners", {
      value: {},
      writable: true,
      configurable: true,
    });
  }
  addEventListener(type, callback, options) {
    if (!(type in this.listeners)) {
      this.listeners[type] = [];
    }
    this.listeners[type].push({ callback, options });
  }
  removeEventListener(type, callback) {
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
  dispatchEvent(event) {
    if (!(event.type in this.listeners)) {
      return;
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

class AbortSignal extends Emitter {
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
    Object.defineProperty(this, "aborted", {
      value: false,
      writable: true,
      configurable: true,
    });
    Object.defineProperty(this, "onabort", {
      value: null,
      writable: true,
      configurable: true,
    });
    Object.defineProperty(this, "reason", {
      value: undefined,
      writable: true,
      configurable: true,
    });
  }
  toString() {
    return "[object AbortSignal]";
  }
  dispatchEvent(event) {
    if (event.type === "abort") {
      this.aborted = true;
      if (typeof this.onabort === "function") {
        this.onabort.call(this, event);
      }
    }

    super.dispatchEvent(event);
  }
}

class AbortController {
  constructor() {
    // Compared to assignment, Object.defineProperty makes properties non-enumerable by default and
    // we want Object.keys(new AbortController()) to be [] for compat with the native impl
    Object.defineProperty(this, "signal", {
      value: new AbortSignal(),
      writable: true,
      configurable: true,
    });
  }
  abort(reason) {
    let event = {
      type: "abort",
      bubbles: false,
      cancelable: false,
    };

    let signalReason = reason;
    if (signalReason === undefined) {
      signalReason = new Error("This operation was aborted");
      signalReason.name = "AbortError";
    }
    this.signal.reason = signalReason;

    this.signal.dispatchEvent(event);
  }
  toString() {
    return "[object AbortController]";
  }
}

if (!global.AbortController) {
  global.AbortController = AbortController;
}
