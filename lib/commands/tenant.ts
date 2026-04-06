import printf from 'printf';
import type {
  TenantCreateCommand,
  TenantDeleteCommand,
  TenantListCommand,
} from '../cli/generated/types';
import {errx, chalk, success_color} from '../cli/errors';
import {
  abortIfNotLoggedIn,
  coronerClientFromGlobal,
  coronerBpgFromGlobal,
  tenantURL,
} from '../cli/context';

const blue = chalk.blue;

function tenantList(cmd: TenantListCommand, config: any): any {
  abortIfNotLoggedIn(config);
  const coroner = coronerClientFromGlobal(config, cmd.globalOptions);
  const bpg = coronerBpgFromGlobal(coroner, cmd.globalOptions);
  const model = bpg.get();

  console.log(printf('%4s %-20s %s', 'ID', 'Tenant', 'URL'));

  for (let i = 0; i < model.universe.length; i++) {
    const id = model.universe[i].get('id');
    const name = model.universe[i].get('name');
    const url = tenantURL(config, name);

    console.log(printf('%4d %-20s %s', id, name, url));
  }
}

function tenantCreate(cmd: TenantCreateCommand, config: any): any {
  abortIfNotLoggedIn(config);
  const coroner = coronerClientFromGlobal(config, cmd.globalOptions);
  const bpg = coronerBpgFromGlobal(coroner, cmd.globalOptions);

  const name = cmd.name;
  if (!name) errx('Usage: morgue tenant create <tenant name>');

  const universe = bpg.new('universe');
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
}

function tenantDelete(cmd: TenantDeleteCommand, config: any): any {
  abortIfNotLoggedIn(config);
  const coroner = coronerClientFromGlobal(config, cmd.globalOptions);
  const bpg = coronerBpgFromGlobal(coroner, cmd.globalOptions);
  const model = bpg.get();

  const name = cmd.name;
  if (!name) errx('Usage: morgue tenant delete <tenant name>');

  for (let i = 0; i < model.universe.length; i++) {
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
}

export const handlers: Record<string, (cmd: any, config: any) => any> = {
  'tenant.create': tenantCreate,
  'tenant.delete': tenantDelete,
  'tenant.list': tenantList,
};
