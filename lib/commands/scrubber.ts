import * as config from '../config';
import {errx, chalk, success_color} from '../cli/errors';
import {abortIfNotLoggedIn, coronerClientArgv, coronerBpgSetup, coronerParams} from '../cli/context';

const bold = chalk.bold;
const yellow = chalk.yellow;

function coronerScrubber(argv: any, config: any): any {
  const options = null;
  var project, universe, pid, un, target;

  abortIfNotLoggedIn(config);
  const coroner = coronerClientArgv(config, argv);

  const p = coronerParams(argv, config);

  /* The sub-command. */
  const action = argv._[2];

  if (action === undefined) {
    errx(
      'Usage: morgue scrubber <[universe/]project> list | create | modify | delete',
    );
  }
  universe = p.universe;
  project = p.project;

  const bpg = coronerBpgSetup(coroner, argv);
  const model = bpg.get();

  /* Find the universe with the specified name. */
  for (var i = 0; i < model.universe.length; i++) {
    if (model.universe[i].get('name') === universe) {
      un = target = model.universe[i];
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

  if (action == 'list') {
    /* Print all scrubbers. */

    if (!model.scrubber) {
      console.log(success_color('No scrubber found.'));
      return;
    }

    for (var i = 0; i < model.scrubber.length; i++) {
      var scrubber = model.scrubber[i];
      var widgets;

      if (scrubber.get('project') != pid) continue;

      console.log(bold('[' + scrubber.get('id') + '] ' + scrubber.get('name')));

      console.log('        regexp: ' + scrubber.get('regexp'));
      console.log('       builtin: ' + scrubber.get('builtin'));
      console.log('        format: ' + scrubber.get('format'));
      console.log('        target: ' + scrubber.get('target'));
      console.log('        enable: ' + scrubber.get('enable'));
    }

    return;
  }

  if (action === 'delete') {
    var id = argv._[3];

    if (!id) errx('Usage: morgue scrubber <[universe/]project> delete <id>');

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

  if (action === 'create') {
    const name = argv.name;
    let regexp = argv.regexp;
    let builtin = argv.builtin;
    let format = argv.format;
    var target = argv.target;
    let enable = argv.enable;

    if (!builtin || builtin !== 'all') {
      if (!regexp && !builtin) errx('must provide either regexp or builtin');
      if (regexp && builtin)
        errx('either regexp or builtin is provided but not both');

      if (!name) errx('must provide a scrubber name with --name');

      if (enable === undefined)
        errx('must provide a scrubber enable with --enable');
    }

    if (regexp === undefined) regexp = null;
    if (builtin === undefined) builtin = null;
    if (format === undefined) format = 'all';
    if (target === undefined) target = 'all';

    if (builtin === 'all') {
      const builtin_scrubbers = [
        {name: 'social_security', builtin: 'ssn'},
        {name: 'credit_card', builtin: 'ccn'},
        {name: 'encryption_key', builtin: 'key'},
        {name: 'environment_variable', builtin: 'env'},
      ];

      if (enable === undefined) enable = 1;
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

  if (action === 'modify') {
    var scrubber;
    var id = argv._[3];

    if (!id) errx('Usage: morgue scrubber <[universe/]project> modify <id>');

    if (
      !argv.name &&
      !argv.regexp &&
      !argv.builtin &&
      argv.format === undefined &&
      argv.target === undefined &&
      argv.enable === undefined
    ) {
      errx('no scrubber member is specified');
    }

    for (var i = 0; i < model.scrubber.length; i++) {
      if (model.scrubber[i].get('id') == id) {
        scrubber = model.scrubber[i];
        break;
      }
    }

    if (!scrubber) errx('Scrubber not found');

    const delta: any = {};
    if (argv.name) delta.name = argv.name;
    if (argv.regexp) delta.regexp = argv.regexp;
    if (argv.builtin) errx('builtin is not modifiable');
    if (argv.format) delta.format = argv.format;
    if (argv.target) delta.target = argv.target;
    if (argv.enable !== undefined) delta.enable = argv.enable;

    bpg.modify(scrubber, delta);
    try {
      bpg.commit();
    } catch (em) {
      errx(em);
    }

    console.log(success_color('Scrubber successfully modified.'));
  }
}

export const commands: Record<string, (argv: any, config: config.Config) => any> = {
  scrubber: coronerScrubber,
};
