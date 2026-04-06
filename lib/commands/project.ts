import type {
  ProjectCreateCommand,
  ProjectsListCommand,
} from '../cli/generated/types';
import {errx} from '../cli/errors';
import {
  abortIfNotLoggedIn,
  coronerClientFromGlobal,
  coronerBpgFromGlobal,
} from '../cli/context';
import {bpgSingleRequest, bpgPost, bpgCbFn, bpgPostAsync} from '../cli/bpg-helpers';

function projectCreate(cmd: ProjectCreateCommand, config: any): any {
  abortIfNotLoggedIn(config);

  const coroner = coronerClientFromGlobal(config, cmd.globalOptions);
  const bpg = coronerBpgFromGlobal(coroner, cmd.globalOptions);

  const project = cmd.name;
  if (!project) {
    errx('Missing project name');
  }

  if (!config || !config.config) {
    errx('Invalid config');
  }

  const validationRe = /^[a-zA-Z0-9-]+$/;
  const validProjName = validationRe.test(project);
  if (!validProjName) {
    errx('Illegal name only use a-z, A-Z, 0-9, or "-"');
  }

  if (!config.config.user || !config.config.user.uid) {
    errx('Invalid user');
  }
  const user = config.config.user.uid;

  if (!config.config.universe || !config.config.universe.id) {
    errx('Invalid universe');
  }
  const universe = config.config.universe.id;

  const request = bpgSingleRequest({
    action: 'create',
    type: 'configuration/project',
    object: {
      pid: 0,
      deleted: 0,
      name: project,
      owner: user,
      universe: universe,
    },
  });

  bpgPost(bpg, request, bpgCbFn('Project', 'create'));
}

async function projectsList(cmd: ProjectsListCommand, config: any): Promise<any> {
  abortIfNotLoggedIn(config);

  const coroner = coronerClientFromGlobal(config, cmd.globalOptions);
  const bpg = coronerBpgFromGlobal(coroner, cmd.globalOptions);

  if (!config || !config.config) {
    errx('Invalid config');
  }

  if (!config.config.universe || !config.config.universe.id) {
    errx('Invalid universe');
  }

  const projects: any = await bpgPostAsync(
    bpg,
    bpgSingleRequest({
      action: 'get',
      type: 'configuration/project',
    }),
  );
  const users: any = await bpgPostAsync(
    bpg,
    bpgSingleRequest({
      action: 'get',
      type: 'configuration/users',
    }),
  );

  const userIdMap: any = {};
  users.forEach(u => (userIdMap[u.uid] = u));

  console.log('Projects:');
  console.log(
    projects
      .map(
        (p, i) =>
          `${i + 1}: name=${p.name}, owner=${userIdMap[p.owner]?.username}`,
      )
      .join('\n'),
  );
}

export const handlers: Record<string, (cmd: any, config: any) => any> = {
  'project.create': projectCreate,
  'projects.list': projectsList,
};
