// Common interfaces for backtrace-morgue

export interface MorgueConfig {
  endpoint?: string;
  insecure?: boolean;
  debug?: boolean;
  token?: string;
  universe?: string;
  project?: string;
  timeout?: number;
}

export interface ProjectContext {
  universe: string;
  project: string;
  user?: any;
  password?: any;
  role?: any;
  coroner?: any;
  bpg?: any;
  model?: any;
  univ_obj?: any;
  user_obj?: any;
}

export interface MinimistArgs {
  _: string[];
  [key: string]: any;
}

export interface QueryFilter {
  query: any;
  age?: any;
}

export interface UniverseModel {
  universe: any;
  project: any;
  [key: string]: any;
}

export interface ServerResponse {
  statusCode: number;
  statusMessage: string;
  headers: any;
  bodyData?: any;
}

export interface AlertsConfig {
  universe?: string;
  project?: string;
  [key: string]: any;
}

export interface MetricsConfig {
  [key: string]: any;
}

export interface WorkflowConfig {
  [key: string]: any;
}
