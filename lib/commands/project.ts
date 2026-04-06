import * as config from '../config';
import * as BPG from '../bpg';
import {errx} from '../cli/errors';
import {abortIfNotLoggedIn, coronerClientArgv, coronerBpgSetup} from '../cli/context';
import {bpgSingleRequest, bpgPost, bpgCbFn, bpgPostAsync} from '../cli/bpg-helpers';

function coronerProject(argv: any, config: any): any {
  abortIfNotLoggedIn(config);

  const subcommand = argv._[1];

  const coroner = coronerClientArgv(config, argv);
  const bpg = coronerBpgSetup(coroner, argv);

  if (!subcommand) {
    errx(
      "Invalid project command. Try 'morgue project create <your-project-name>'",
    );
  }

  if (subcommand !== 'create') {
    errx(
      "Invalid project command. Try 'morgue project create <your-project-name>'",
    );
  }

  const project = argv._[2];
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

async function coronerProjects(argv: any, config: config.Config): Promise<any> {
  abortIfNotLoggedIn(config);

  const subcommand = argv._[1];

  const coroner = coronerClientArgv(config, argv);
  const bpg = coronerBpgSetup(coroner, argv);

  if (subcommand !== 'list') {
    errx("Invalid projects command. Try 'morgue project list'");
  }

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

export const commands: Record<string, (argv: any, config: config.Config) => any> = {
  project: coronerProject,
  projects: coronerProjects,
};
