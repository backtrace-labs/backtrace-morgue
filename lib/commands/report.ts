import printf from 'printf';
import moment_tz from 'moment-timezone';
import * as config from '../config';
import {errx, chalk, success_color, warn} from '../cli/errors';
import {abortIfNotLoggedIn, coronerClientArgv, coronerBpgSetup} from '../cli/context';
import * as queryCli from '../cli/query';

const bold = chalk.bold;
const yellow = chalk.yellow;

function coronerReport(argv: any, config: any): any {
  const options = null;
  let project, universe, pid, un, target;

  abortIfNotLoggedIn(config);
  const coroner = coronerClientArgv(config, argv);

  universe = argv.universe;
  if (!universe) universe = Object.keys(config.config.universes)[0];

  project = argv.project;

  /* The sub-command. */
  const action = argv._[1];

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

  if (action == 'list') {
    /* Print all report objects. */
    if (!model.report) {
      console.log(success_color('No scheduled reports found.'));
      return;
    }

    model.report.sort((a, b) => {
      const a_d = Number(a.get('id'));
      const b_d = Number(b.get('id'));

      return +(a_d > b_d) - +(a_d < b_d);
    });

    for (var i = 0; i < model.report.length; i++) {
      var report = model.report[i];
      var widgets;

      if (pid && report.get('project') != pid) continue;

      try {
        widgets = JSON.stringify(JSON.parse(model.report[i].get('widgets')));
      } catch (error) {
        widgets = 'invalid: ' + model.report[i].get('widgets');
      }

      console.log(
        '[' +
          printf('%2d', report.get('id')) +
          '] ' +
          bold(report.get('title')),
      );

      console.log('Recipients: ' + report.get('rcpt'));
      console.log('Period: ' + report.get('period'));
      console.log('Day: ' + report.get('day'));
      console.log('Hour: ' + report.get('hour'));
      console.log('Timezone: ' + report.get('timezone'));
      console.log('Widgets: ' + widgets);
      console.log('');
    }

    return;
  }

  if (action === 'delete') {
    var id = argv._[2];

    if (!id) errx('Usage: morgue report delete <id>');

    if (!universe || !project)
      errx('Must specify a project or infer a universe');

    for (var i = 0; i < model.report.length; i++) {
      if (model.report[i].get('id') == id) {
        console.log(
          'Deleting report [' + yellow(model.report[i].get('title') + ']...'),
        );
        bpg.delete(model.report[i]);
        bpg.commit();
        return;
      }
    }

    errx('Report not found');
  }

  if (action === 'send') {
    var id = argv._[2];
    var rcpt = argv._[3];

    if (!id || !rcpt) errx('Usage: morgue report send <id> <e-mail>');

    coroner.reportSend(
      universe,
      project,
      {
        action: 'send',
        form: {
          id: id,
          rcpt: rcpt,
        },
      },
      (error, rp) => {
        if (error) errx(error);

        console.log(success_color('Report scheduled for immediate sending.'));
        return;
      },
    );
  }

  if (action === 'create') {
    const title = argv.title;
    let day = argv.day;
    let period = argv.period;
    let timezone = argv.timezone;
    let hour = argv.hour;
    const histogram = argv.histogram;
    widgets = {};
    let limit = argv.limit;
    const aq = queryCli.argvQuery(argv);
    const reportRcpt = '';
    let include_users = false;

    if (!universe || !project)
      errx('Must specify a project or infer a universe');

    if (!limit) limit = 5;

    if (!argv.rcpt) errx('must provide a recipient list with --rcpt');

    if (Array.isArray(argv.rcpt)) {
      rcpt = argv.rcpt.join(' ');
    } else {
      rcpt += argv.rcpt;
    }

    widgets.top = [];
    widgets.top[0] = {attributes: []};

    if (Array.isArray(argv.histogram)) {
      for (var i = 0; i < argv.histogram.length; i++) {
        widgets.top[0].attributes.push(argv.histogram[i]);
      }
    } else {
      widgets.top[0].attributes.push(argv.histogram);
    }

    widgets.feed = {};
    widgets.feed.limit = limit;

    if (aq.query && aq.query.filter) {
      /* Don't filter on timestamp. */
      for (var i = 0; i < aq.query.filter.length; i++)
        delete aq.query.filter[i].timestamp;

      widgets.filter = aq.query.filter;
    }

    if (!title) errx('must provide a report title with --title');

    if (!period) {
      warn('no period specified, defaulting to weekly');
      period = 'week';
    }

    if (!timezone) {
      timezone = moment_tz.tz.guess();
      warn('no timezone specified, defaulting to ' + timezone);
    }

    if (!hour) {
      warn('no hour specified, defaulting to 9AM');
      hour = 9;
    }

    if (!day) {
      day = 1;

      if (period !== 'day') warn('no day specified, defaulting to Monday');
    }

    if (argv['include-users']) include_users = true;

    var report = bpg.new('report');
    report.set('id', 0);
    report.set('project', pid);
    report.set('owner', config.config.uid);
    report.set('title', title);
    report.set('rcpt', reportRcpt); /* XXX */
    report.set('day', day);
    report.set('include_users', include_users ? 1 : 0);
    report.set('period', period);
    report.set('timezone', timezone);
    report.set('hour', hour);
    report.set('widgets', JSON.stringify(widgets));

    if (argv.metadata) report.set('metadata', argv.metadata);

    bpg.create(report);
    bpg.commit();

    console.log(success_color('Report successfully created.'));
  }
}

export const commands: Record<string, (argv: any, config: config.Config) => any> = {
  report: coronerReport,
};
