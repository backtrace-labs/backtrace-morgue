import type {Config} from '../config';
import type {
  ScrubberListCommand,
  ScrubberCreateCommand,
  ScrubberModifyCommand,
  ScrubberDeleteCommand,
  CommandHandler,
} from '../cli/generated/types';
import {errx, chalk, success_color} from '../cli/errors';
import {
  abortIfNotLoggedIn,
  coronerClientFromGlobal,
  coronerBpgFromGlobal,
  parseProjectArg,
} from '../cli/context';

const bold = chalk.bold;
const yellow = chalk.yellow;

function findProjectPid(model: any, universe: string, project: string): {un: any; pid: any} {
  let un: any;
  let pid: any;

  for (var i = 0; i < model.universe.length; i++) {
    if (model.universe[i].get('name') === universe) {
      un = model.universe[i];
    }
  }

  for (var i = 0; i < model.project.length; i++) {
    if (
      model.project[i].get('name') === project &&
      model.project[i].get('universe') === un.get('id')
    ) {
      pid = model.project[i].get('pid');
      break;
    }
  }

  if (!pid) errx('project not found');

  return {un, pid};
}

function handleScrubberList(cmd: ScrubberListCommand, config: Config): any {
  abortIfNotLoggedIn(config);
  const coroner = coronerClientFromGlobal(config, cmd.globalOptions);
  const p = parseProjectArg(cmd.project, config);

  const bpg = coronerBpgFromGlobal(coroner, cmd.globalOptions);
  const model = bpg.get();

  const {pid} = findProjectPid(model, p.universe, p.project);

  if (!model.scrubber) {
    console.log(success_color('No scrubber found.'));
    return;
  }

  for (var i = 0; i < model.scrubber.length; i++) {
    var scrubber = model.scrubber[i];

    if (scrubber.get('project') != pid) continue;

    console.log(bold('[' + scrubber.get('id') + '] ' + scrubber.get('name')));

    console.log('        regexp: ' + scrubber.get('regexp'));
    console.log('       builtin: ' + scrubber.get('builtin'));
    console.log('        format: ' + scrubber.get('format'));
    console.log('        target: ' + scrubber.get('target'));
    console.log('        enable: ' + scrubber.get('enable'));
  }
}

function handleScrubberCreate(cmd: ScrubberCreateCommand, config: Config): any {
  abortIfNotLoggedIn(config);
  const coroner = coronerClientFromGlobal(config, cmd.globalOptions);
  const p = parseProjectArg(cmd.project, config);

  const bpg = coronerBpgFromGlobal(coroner, cmd.globalOptions);
  const model = bpg.get();

  const {pid} = findProjectPid(model, p.universe, p.project);

  const name = cmd.name;
  let regexp: string | null = cmd.regexp ?? null;
  let builtin: string | null = cmd.builtin ?? null;
  let format = cmd.format ?? 'all';
  let target = cmd.target ?? 'all';
  let enable = cmd.enable;

  if (!builtin || builtin !== 'all') {
    if (!regexp && !builtin) errx('must provide either regexp or builtin');
    if (regexp && builtin)
      errx('either regexp or builtin is provided but not both');

    if (!name) errx('must provide a scrubber name with --name');

    if (enable === undefined)
      errx('must provide a scrubber enable with --enable');
  }

  if (builtin === 'all') {
    const builtin_scrubbers = [
      {name: 'social_security', builtin: 'ssn'},
      {name: 'credit_card', builtin: 'ccn'},
      {name: 'encryption_key', builtin: 'key'},
      {name: 'environment_variable', builtin: 'env'},
    ];

    if (enable === undefined) enable = '1';
    for (var i = 0; i < builtin_scrubbers.length; i++) {
      var scrubber = bpg.new('scrubber');

      scrubber.set('id', 0);
      scrubber.set('project', pid);
      scrubber.set('name', builtin_scrubbers[i].name);
      scrubber.set('regexp', null);
      scrubber.set('builtin', builtin_scrubbers[i].builtin);
      scrubber.set('format', format);
      scrubber.set('target', target);
      scrubber.set('enable', enable);

      bpg.create(scrubber);
      try {
        bpg.commit();
      } catch (em) {
        console.log(builtin_scrubbers[i].name + ' ' + em);
      }
    }
  } else {
    var scrubber = bpg.new('scrubber');

    scrubber.set('id', 0);
    scrubber.set('project', pid);
    scrubber.set('name', name);
    scrubber.set('regexp', regexp);
    scrubber.set('builtin', builtin);
    scrubber.set('format', format);
    scrubber.set('target', target);
    scrubber.set('enable', enable);

    bpg.create(scrubber);
    try {
      bpg.commit();
    } catch (em) {
      errx(em);
    }
  }

  console.log(success_color('Scrubber successfully created.'));
}

function handleScrubberModify(cmd: ScrubberModifyCommand, config: Config): any {
  abortIfNotLoggedIn(config);
  const coroner = coronerClientFromGlobal(config, cmd.globalOptions);
  const p = parseProjectArg(cmd.project, config);

  const bpg = coronerBpgFromGlobal(coroner, cmd.globalOptions);
  const model = bpg.get();

  const {pid} = findProjectPid(model, p.universe, p.project);

  const id = cmd.id;

  if (
    !cmd.name &&
    !cmd.regexp &&
    !cmd.builtin &&
    cmd.format === undefined &&
    cmd.target === undefined &&
    cmd.enable === undefined
  ) {
    errx('no scrubber member is specified');
  }

  let scrubber: any;
  for (var i = 0; i < model.scrubber.length; i++) {
    if (model.scrubber[i].get('id') == id) {
      scrubber = model.scrubber[i];
      break;
    }
  }

  if (!scrubber) errx('Scrubber not found');

  const delta: any = {};
  if (cmd.name) delta.name = cmd.name;
  if (cmd.regexp) delta.regexp = cmd.regexp;
  if (cmd.builtin) errx('builtin is not modifiable');
  if (cmd.format) delta.format = cmd.format;
  if (cmd.target) delta.target = cmd.target;
  if (cmd.enable !== undefined) delta.enable = cmd.enable;

  bpg.modify(scrubber, delta);
  try {
    bpg.commit();
  } catch (em) {
    errx(em);
  }

  console.log(success_color('Scrubber successfully modified.'));
}

function handleScrubberDelete(cmd: ScrubberDeleteCommand, config: Config): any {
  abortIfNotLoggedIn(config);
  const coroner = coronerClientFromGlobal(config, cmd.globalOptions);
  const p = parseProjectArg(cmd.project, config);

  const bpg = coronerBpgFromGlobal(coroner, cmd.globalOptions);
  const model = bpg.get();

  const {pid} = findProjectPid(model, p.universe, p.project);

  const id = cmd.id;

  for (var i = 0; i < model.scrubber.length; i++) {
    if (model.scrubber[i].get('id') == id) {
      console.log(
        'Deleting scrubber [' +
          yellow(model.scrubber[i].get('name') + ']...'),
      );
      bpg.delete(model.scrubber[i]);
      try {
        bpg.commit();
      } catch (em) {
        errx(em);
      }
      return;
    }
  }

  errx('Scrubber not found');
}

export const handlers: Record<string, CommandHandler> = {
  'scrubber.list': handleScrubberList,
  'scrubber.create': handleScrubberCreate,
  'scrubber.modify': handleScrubberModify,
  'scrubber.delete': handleScrubberDelete,
};
