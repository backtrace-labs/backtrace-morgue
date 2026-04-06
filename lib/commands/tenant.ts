import printf from 'printf';
import * as config from '../config';
import {errx, chalk, success_color} from '../cli/errors';
import {abortIfNotLoggedIn, coronerClientArgv, coronerBpgSetup, tenantURL} from '../cli/context';

const blue = chalk.blue;

function coronerTenant(argv: any, config: any): any {
  const options = null;
  var universe;

  abortIfNotLoggedIn(config);
  const coroner = coronerClientArgv(config, argv);

  const usageText =
    'Usage: morgue tenant <list | create | delete>\n' +
    '\n' +
    '  create <name>: Create a tenant with the specified name.\n' +
    '  delete <name>: Delete a tenant with the specified name.\n' +
    '           list: List all tenants on your instance.\n';

  if (argv.h || argv.help) {
    console.log(usageText);
    return;
  }

  universe = argv.universe;
  if (!universe) universe = Object.keys(config.config.universes)[0];

  /* The sub-command. */
  const action = argv._[1];

  const bpg = coronerBpgSetup(coroner, argv);
  const model = bpg.get();

  if (action === 'list') {
    console.log(printf('%4s %-20s %s', 'ID', 'Tenant', 'URL'));

    for (var i = 0; i < model.universe.length; i++) {
      const id = model.universe[i].get('id');
      var name = model.universe[i].get('name');
      const url = tenantURL(config, name);

      console.log(printf('%4d %-20s %s', id, name, url));
    }

    return;
  }

  if (action === 'delete') {
    var name = argv._[2];

    if (!name) errx('Usage: morgue tenant delete <tenant name>');

    for (var i = 0; i < model.universe.length; i++) {
      if (model.universe[i].get('name') == name) {
        bpg.delete(model.universe[i], {cascade: true});
        try {
          bpg.commit();
        } catch (e) {
          errx(e + '');
        }

        console.log(success_color('Tenant successfully deleted.'));
        return;
      }
    }

    errx('tenant not found.');
    return;
  }

  if (action === 'create') {
    var name = argv._[2];

    if (!name) errx('Usage: morgue tenant create <tenant name>');

    var universe = bpg.new('universe');
    universe.set('id', 0);
    universe.set('name', name);
    bpg.create(universe);

    try {
      bpg.commit();
    } catch (e) {
      errx(e + '');
    }

    console.log(
      'Tenant successfully created at ' +
        success_color(tenantURL(config, name)),
    );
    console.log(blue('Wait a few minutes for propagation to complete.'));
    return;
  }

  errx(usageText);
}

export const commands: Record<string, (argv: any, config: any) => any> = {
  tenant: coronerTenant,
};
