/*
 * A simple subcommand router. Routes commands to subcommands, eating arguments
 * off the front.
 *
 * We dont' do anything involved here, i.e. no command specific help. This just
 * takes a (possibly nested) object of functions, figures out where the command
 * is going, and sends it there.
 */

/*
 * Commands is:
 * {
 *   command: function,
 *   command2: {
 *     subcommand: function,
 *   }
 * }
 *
 * Displays usage on failure.
 */
async function route(commands, usage, args) {
  let route = commands;
  let next;

  while (typeof route == 'object') {
    next = args._[0];
    args._.shift();
    if (!next) {
      route = null;
      break;
    }
    route = route[next];
  }

  if (!route) {
    console.error(usage);
    process.exit(1);
  }

  await route(args);
}

module.exports = {
  route
};
