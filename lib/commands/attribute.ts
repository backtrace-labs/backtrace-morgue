import type {
  AttributeCreateCommand,
  AttributeDeleteCommand,
  ViewCreateCommand,
  ViewDeleteCommand,
} from '../cli/generated/types';
import * as config from '../config';
import {errx, err} from '../cli/errors';
import {abortIfNotLoggedIn, coronerClientFromGlobal, coronerBpgFromGlobal, parseProjectArg} from '../cli/context';
import {bpgPost, bpgSingleRequest, bpgCbFn} from '../cli/bpg-helpers';

function setupAttributeContext(config: any, globalOptions: any, project: string) {
  const coroner = coronerClientFromGlobal(config, globalOptions);
  const bpg = coronerBpgFromGlobal(coroner, globalOptions);
  const model = bpg.get();
  const ctx = parseProjectArg(project, config);

  const universe = model.universe.find(univ => univ.fields.name === ctx.universe);
  if (!universe) errx(`Universe ${ctx.universe} not found.`);

  const proj = model.project.find(
    p => p.fields.universe === universe.fields.id && p.fields.name === ctx.project,
  );
  if (!proj) errx(`Project ${ctx.universe}/${ctx.project} not found.`);

  return {bpg, model, universe, project: proj};
}

function attributeCreate(cmd: AttributeCreateCommand, config: any) {
  abortIfNotLoggedIn(config);

  if (!cmd.type) errx('Must specify type.');
  if (!cmd.description) errx('Must specify description.');

  const state = setupAttributeContext(config, cmd.globalOptions, cmd.project);

  const request = bpgSingleRequest({
    action: 'create',
    type: 'configuration/attribute',
    object: {
      name: cmd.name,
      project: state.project.fields.pid,
      type: cmd.type,
      description: cmd.description,
      format: cmd.format,
    },
  });

  bpgPost(state.bpg, request, bpgCbFn('Attribute', 'create'));
}

function attributeDelete(cmd: AttributeDeleteCommand, config: any) {
  abortIfNotLoggedIn(config);

  const state = setupAttributeContext(config, cmd.globalOptions, cmd.project);

  const attribute = state.model.attribute.find(
    attrib => attrib.fields.name === cmd.name,
  );
  if (!attribute) errx('Attribute not found.');

  const attr_key = {
    project: attribute.fields.project,
    name: attribute.fields.name,
  };

  const request = bpgSingleRequest({
    action: 'delete',
    type: 'configuration/attribute',
    key: attr_key,
  });

  bpgPost(state.bpg, request, bpgCbFn('Attribute', 'delete'));
}

function viewCreate(cmd: ViewCreateCommand, config: any) {
  abortIfNotLoggedIn(config);

  if (!cmd.queries) errx('Must specify queries.');
  if (!cmd.payload) errx('Must specify payload.');

  const state = setupAttributeContext(config, cmd.globalOptions, cmd.project);

  if (!state.project.fields || !state.project.fields.pid)
    errx('Invalid Project.');
  if (!config.config.uid) errx('Invalid user.');

  // json parse or keep input as json
  const queries =
    typeof cmd.queries === 'string' ? JSON.parse(cmd.queries) : cmd.queries;
  const payload =
    typeof cmd.payload === 'string' ? JSON.parse(cmd.payload) : cmd.payload;
  // update name
  payload.name = cmd.name;

  const request = bpgSingleRequest({
    action: 'create',
    type: 'configuration/query',
    object: {
      name: cmd.name,
      project: state.project.fields.pid,
      owner: config.config.uid,
      queries: JSON.stringify(queries),
      payload: JSON.stringify(payload),
    },
  });

  bpgPost(state.bpg, request, bpgCbFn('View', 'create'));
}

function viewDelete(cmd: ViewDeleteCommand, config: any) {
  abortIfNotLoggedIn(config);

  const state = setupAttributeContext(config, cmd.globalOptions, cmd.project);

  // First search for a view by its query name.
  let query = state.model.query.find(
    q => q.fields.name === cmd.name,
  );
  // If not found, search for a view using the dashboard query name.
  if (!query) {
    query = state.model.query.find(
      q => q.fields.name === '%dashboard% ' + cmd.name,
    );
  }
  if (!query) errx('View not found.');

  const attr_key = {
    project: query.fields.project,
    name: query.fields.name,
  };

  const request = bpgSingleRequest({
    action: 'delete',
    type: 'configuration/query',
    key: attr_key,
  });

  bpgPost(state.bpg, request, bpgCbFn('View', 'delete'));
}

export const handlers: Record<string, (cmd: any, config: any) => any> = {
  'attribute.create': attributeCreate,
  'attribute.delete': attributeDelete,
  'view.create': viewCreate,
  'view.delete': viewDelete,
};
