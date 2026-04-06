import * as config from '../config';
import {errx, err} from '../cli/errors';
import {coronerBpgSetup, coronerParams} from '../cli/context';
import {bpgPost, bpgSingleRequest, bpgCbFn, subcmdProcess} from '../cli/bpg-helpers';

function viewUsageFn(str) {
  if (str) {
    err(str + '\n');
  }
  console.error(
    'Usage: morgue view <create|delete> <project> <name> <queries> <payload>',
  );
  process.exit(1);
}

function viewSetupFn(config, argv, opts, subcmd) {
  if (argv.length < 4) {
    return attributeUsageFn('Incomplete command.');
  }

  opts.params = {
    attrname: argv._[2],
  };
  if (!opts.params.attrname) return viewUsageFn('Missing attribute name.');

  opts.state.bpg = coronerBpgSetup(opts.state.coroner, argv);
  opts.state.model = opts.state.bpg.get();
  opts.state.context = coronerParams(argv, config);

  const ctx = opts.state.context;
  opts.state.universe = opts.state.model.universe.find(univ => {
    return univ.fields.name === ctx.universe;
  });
  if (!opts.state.universe)
    return viewUsageFn(`Universe ${ctx.universe} not found.`);
  opts.state.project = opts.state.model.project.find(
    proj =>
      proj.fields.universe === opts.state.universe.fields.id &&
      proj.fields.name === ctx.project,
  );
  if (!opts.state.project) {
    return viewUsageFn(`Project ${ctx.universe}/${ctx.project} not found.`);
  }

  if (subcmd !== 'create') {
    // First search for a view by its query name.
    opts.state.query = opts.state.model.query.find(
      query => query.fields.name === opts.params.attrname,
    );
    // If not found, search for a view using the dashboard query name.
    if (!opts.state.query) {
      opts.state.query = opts.state.model.query.find(
        query => query.fields.name === '%dashboard% ' + opts.params.attrname,
      );
    }
    if (!opts.state.query) return viewUsageFn('View not found.');
    opts.state.attr_key = {
      project: opts.state.query.fields.project,
      name: opts.state.query.fields.name,
    };
  }
}

function attributeUsageFn(str: any): never {
  const formats = [
    'none',
    'commit',
    'semver',
    'callstack',
    'hostname',
    'bytes',
    'kilobytes',
    'megabytes',
    'gigabytes',
    'nanoseconds',
    'milliseconds',
    'seconds',
    'unix_timestamp',
    'js_timestamp',
    'gps_timestamp',
    'memory_address',
    'labels',
    'commit',
    'sha256',
    'uuid',
    'ipv4',
    'ipv6',
  ];

  const types = [
    'bitmap',
    'uint8',
    'uint16',
    'uint32',
    'uint64',
    'uint128',
    'uuid',
    'dictionary',
  ];

  if (str) err(str + '\n');
  console.error(
    'Usage: morgue attribute <create|delete> <project> <name> [options]',
  );
  console.error('');
  console.error('Options for create (all but format are required): ');
  console.error('  --description=D  Specify description.');
  console.error('  --type=T         Specify type. Can be of the following: ');
  console.error('                     ' + types.join(', '));
  console.error(
    '  --format=F       Specify formatting hint. Can be of the following: ',
  );
  console.error(
    '                     ' + formats.slice(0, 10).join(', ') + ', ',
  );
  console.error('                     ' + formats.slice(10).join(', '));

  process.exit(1);
}

function attributeSetupFn(config, argv, opts, subcmd): any {
  if (argv.length < 3) {
    return attributeUsageFn('Incomplete command.');
  }

  opts.params = {
    attrname: argv._[2],
  };
  if (!opts.params.attrname) return attributeUsageFn('Missing attribute name.');

  opts.state.bpg = coronerBpgSetup(opts.state.coroner, argv);
  opts.state.model = opts.state.bpg.get();
  opts.state.context = coronerParams(argv, config);

  const ctx = opts.state.context;
  opts.state.universe = opts.state.model.universe.find(univ => {
    return univ.fields.name === ctx.universe;
  });
  if (!opts.state.universe)
    return attributeUsageFn(`Universe ${ctx.universe} not found.`);
  opts.state.project = opts.state.model.project.find(proj => {
    return (
      proj.fields.universe === opts.state.universe.fields.id &&
      proj.fields.name === ctx.project
    );
  });
  if (!opts.state.project) {
    return attributeUsageFn(
      `Project ${ctx.universe}/${ctx.project} not found.`,
    );
  }

  if (subcmd !== 'create') {
    opts.state.attribute = opts.state.model.attribute.find(attrib => {
      return attrib.fields.name === opts.params.attrname;
    });
    if (!opts.state.attribute) return attributeUsageFn('Attribute not found.');
    opts.state.attr_key = {
      project: opts.state.attribute.fields.project,
      name: opts.state.attribute.fields.name,
    };
  }
}

function attributeSet(argv, config, opts): any {
  const state = opts.state;
  if (!argv.description) {
    return attributeUsageFn('Must specify new description.');
  }

  const request = bpgSingleRequest({
    action: 'modify',
    type: 'configuration/attribute',
    key: state.attr_key,
    fields: {
      description: argv.description,
    },
  });

  bpgPost(state.bpg, request, bpgCbFn('Attribute', 'update'));
}

function viewCreate(argv, config, opts) {
  const state = opts.state;

  if (!argv.queries) return viewUsageFn('Must specify queries.');
  if (!argv.payload) return viewUsageFn('Must specify payload.');
  if (!state.project.fields && !state.project.fields.pid)
    return viewUsageFn('Invalid Project.');
  if (!config.config.uid) return viewUsageFn('Invalid user.');

  // json parse or keep input as json
  const queries =
    typeof argv.queries === 'string' ? JSON.parse(argv.queries) : argv.queries;
  const payload =
    typeof argv.payload === 'string' ? JSON.parse(argv.payload) : argv.payload;
  // update name
  payload.name = opts.params.attrname;

  const request = bpgSingleRequest({
    action: 'create',
    type: 'configuration/query',
    object: {
      name: opts.params.attrname,
      project: state.project.fields.pid,
      owner: config.config.uid,
      queries: JSON.stringify(queries),
      payload: JSON.stringify(payload),
    },
  });

  bpgPost(state.bpg, request, bpgCbFn('View', 'create'));
}

function viewDelete(argv, config, opts) {
  const state = opts.state;
  const request = bpgSingleRequest({
    action: 'delete',
    type: 'configuration/query',
    key: state.attr_key,
  });
  bpgPost(state.bpg, request, bpgCbFn('View', 'delete'));
}

function attributeDelete(argv, config, opts) {
  const state = opts.state;
  const request = bpgSingleRequest({
    action: 'delete',
    type: 'configuration/attribute',
    key: state.attr_key,
  });
  bpgPost(state.bpg, request, bpgCbFn('Attribute', 'delete'));
}

function attributeCreate(argv, config, opts): any {
  const state = opts.state;

  if (!argv.type) return attributeUsageFn('Must specify type.');
  if (!argv.description) return attributeUsageFn('Must specify description.');

  const request = bpgSingleRequest({
    action: 'create',
    type: 'configuration/attribute',
    object: {
      name: opts.params.attrname,
      project: state.project.fields.pid,
      type: argv.type,
      description: argv.description,
      format: argv.format,
    },
  });

  bpgPost(state.bpg, request, bpgCbFn('Attribute', 'create'));
}

function coronerAttribute(argv: any, config: any) {
  subcmdProcess(argv, config, {
    usageFn: attributeUsageFn,
    setupFn: attributeSetupFn,
    subcmds: {
      //set: attributeSet, - not supported
      create: attributeCreate,
      delete: attributeDelete,
    },
  });
}

function coronerView(argv: any, config: any) {
  subcmdProcess(argv, config, {
    usageFn: viewUsageFn,
    setupFn: viewSetupFn,
    subcmds: {
      create: viewCreate,
      delete: viewDelete,
    },
  });
}

export const commands: Record<string, (argv: any, config: config.Config) => any> = {
  attribute: coronerAttribute,
  view: coronerView,
};
