// Type declarations for modules without @types packages

declare module "time-ago" {
  /**
   * Converts a timestamp into a human-readable relative time string
   * @param timestamp - Unix timestamp in milliseconds or Date object
   * @returns A human-readable string like "5 minutes ago", "2 hours ago", etc.
   */
  export function ago(timestamp: number | Date): string;
}

// Use type defs from @types/request for @cypress/request.
declare module "@cypress/request" {
  import request = require("request");
  export = request;
}
