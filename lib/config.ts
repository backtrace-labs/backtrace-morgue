export type Config = Synthetic | ConfigFile;

export interface Synthetic {
  config: {token: string; universe?: {id?: number}};
  endpoint: string;
  submissionEndpoint: string;
}

export interface ConfigFile {
  config: ConfigMain;
  endpoint: string;
  submissionEndpoint: string;
}

export interface ConfigMain {
  token: string;
  config: ConfigMeta;
  endpoints: Endpoints;
  services: Service[];
  hostname: string;
  host: string;
  tenant_separator: string;
  role: string;
  username: string;
  email: string;
  uid: number;
  user: User;
  ephemeral: Ephemeral;
  universe: CurrentUniverse;
  universes: Universes;
  intercom: Intercom;
  users: BpgUser[];
  workflow: Workflow;
}

export interface ConfigMeta {
  version: string;
}

export interface Endpoints {
  [key: string]: Endpoint[];
}

export interface Endpoint {
  port: number;
  protocol: string;
  id: number;
}

export interface Service {
  name: string;
  endpoint: string;
}

export interface User {
  role: string;
  username: string;
  email: string;
  uid: number;
  superuser: number;
  active: number;
  method: string;
  universe: number;
  deleted: number;
  frontend_settings: string;
}

export interface Ephemeral {
  last_project_pid: number;
}

export interface CurrentUniverse {
  name: string;
  id: number;
  deleted: number;
}

export interface Universes {
  [key: string]: Universe;
}

export interface Universe {
  limits: Limits;
  projects: string[];
  projects_ext: ProjectExt[];
  has_projects: boolean;
}

export interface Limits {
  storage: Storage;
  metadata: Metadata;
}

export interface Storage {
  counter: number;
  rejected: number;
  limit: number;
}

export interface Metadata {
  flow: string;
  customerID: string;
  manualOverride: boolean;
  period: string;
  features: any[];
}

export interface ProjectExt {
  role: string;
  name: string;
  pid: number;
  universe: number;
  owner: number;
  deleted: number;
  watchers: any[];
  frontend_settings?: string;
  _tx: number;
  corrupted?: boolean;
}

export interface Intercom {
  user_hash: string;
  user_id: string;
  company_id: string;
}

export interface BpgUser {
  uid: number;
  email: string;
  username: string;
  method: string;
  password: any;
  metadata: string;
  active: number;
  superuser: number;
  universe: number;
  role?: string;
  deleted: number;
  __create: number;
  __modify: number;
  __namespace: Namespace;
  __state: State;
}

export interface Namespace {
  universe?: number;
}

export interface State {}

export interface Workflow {}
