import printf from 'printf';
import moment_tz from 'moment-timezone';
import type {
  ReportListCommand,
  ReportCreateCommand,
  ReportDeleteCommand,
  ReportSendCommand,
} from '../cli/generated/types';
import {errx, chalk, success_color, warn} from '../cli/errors';
import {
  abortIfNotLoggedIn,
  coronerClientFromGlobal,
  coronerBpgFromGlobal,
  parseProjectArg,
} from '../cli/context';
import {buildQuery} from '../cli/query';

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

  return {un, pid};
}

function handleReportList(cmd: ReportListCommand, config: any): any {
  abortIfNotLoggedIn(config);
  const coroner = coronerClientFromGlobal(config, cmd.globalOptions);
  const p = parseProjectArg(cmd.project, config);

  const bpg = coronerBpgFromGlobal(coroner, cmd.globalOptions);
  const model = bpg.get();

  const {pid} = findProjectPid(model, p.universe, p.project);

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
}

function handleReportCreate(cmd: ReportCreateCommand, config: any): any {
  abortIfNotLoggedIn(config);
  const coroner = coronerClientFromGlobal(config, cmd.globalOptions);
  const p = parseProjectArg(cmd.project, config);

  const universe = p.universe;
  const project = p.project;

  if (!universe || !project)
    errx('Must specify a project or infer a universe');

  const bpg = coronerBpgFromGlobal(coroner, cmd.globalOptions);
  const model = bpg.get();

  const {pid} = findProjectPid(model, universe, project);

  const title = cmd.title;
  let day = cmd.day;
  let period = cmd.period;
  let timezone = cmd.timezone;
  let hour = cmd.hour;
  let widgets: any = {};
  let limit = 5;
  const aq = buildQuery(cmd.queryOptions);
  let reportRcpt = '';
  let include_users = false;

  if (!cmd.rcpt || cmd.rcpt.length === 0) errx('must provide a recipient list with --rcpt');

  if (Array.isArray(cmd.rcpt)) {
    reportRcpt = cmd.rcpt.join(' ');
  } else {
    reportRcpt += cmd.rcpt;
  }

  widgets.top = [];
  widgets.top[0] = {attributes: []};

  if (cmd.queryOptions.histogram) {
    if (Array.isArray(cmd.queryOptions.histogram)) {
      for (var i = 0; i < cmd.queryOptions.histogram.length; i++) {
        widgets.top[0].attributes.push(cmd.queryOptions.histogram[i]);
      }
    } else {
      widgets.top[0].attributes.push(cmd.queryOptions.histogram);
    }
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
    hour = '9';
  }

  if (!day) {
    day = '1';

    if (period !== 'day') warn('no day specified, defaulting to Monday');
  }

  if (cmd.includeUsers) include_users = true;

  var report = bpg.new('report');
  report.set('id', 0);
  report.set('project', pid);
  report.set('owner', config.config.uid);
  report.set('title', title);
  report.set('rcpt', reportRcpt);
  report.set('day', day);
  report.set('include_users', include_users ? 1 : 0);
  report.set('period', period);
  report.set('timezone', timezone);
  report.set('hour', hour);
  report.set('widgets', JSON.stringify(widgets));

  bpg.create(report);
  bpg.commit();

  console.log(success_color('Report successfully created.'));
}

function handleReportDelete(cmd: ReportDeleteCommand, config: any): any {
  abortIfNotLoggedIn(config);
  const coroner = coronerClientFromGlobal(config, cmd.globalOptions);
  const p = parseProjectArg(cmd.project, config);

  const universe = p.universe;
  const project = p.project;

  if (!universe || !project)
    errx('Must specify a project or infer a universe');

  const bpg = coronerBpgFromGlobal(coroner, cmd.globalOptions);
  const model = bpg.get();

  const id = cmd.id;

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

function handleReportSend(cmd: ReportSendCommand, config: any): any {
  abortIfNotLoggedIn(config);
  const coroner = coronerClientFromGlobal(config, cmd.globalOptions);
  const p = parseProjectArg(cmd.project, config);

  const universe = p.universe;
  const project = p.project;

  coroner.reportSend(
    universe,
    project,
    {
      action: 'send',
      form: {
        id: cmd.id,
        rcpt: cmd.email,
      },
    },
    (error, rp) => {
      if (error) errx(error);

      console.log(success_color('Report scheduled for immediate sending.'));
      return;
    },
  );
}

export const handlers: Record<string, (cmd: any, config: any) => any> = {
  'report.list': handleReportList,
  'report.create': handleReportCreate,
  'report.delete': handleReportDelete,
  'report.send': handleReportSend,
};
