import printf from 'printf';
import {table, TableUserConfig} from 'table';
import {sprintf} from 'extsprintf';
import type {
  AuditExtractCommand,
  LogListCommand,
  LogActivateCommand,
  LogDeactivateCommand,
  LogExtractCommand,
  LatencyListCommand,
  LatencyActivateCommand,
  LatencyDeactivateCommand,
  LatencyExtractCommand,
} from '../cli/generated/types';
import {errx, err, chalk, success_color, error_color} from '../cli/errors';
import {abortIfNotLoggedIn, coronerClientFromGlobal} from '../cli/context';

const bold = chalk.bold;
const green = chalk.green;
const red = chalk.red;

function getUniverse(cmd: {globalOptions: {universe?: string}}, config: any): string {
  let universe = cmd.globalOptions.universe;
  if (!universe) universe = Object.keys(config.config.universes)[0];
  return universe;
}

function auditExtract(cmd: AuditExtractCommand, config: any): any {
  abortIfNotLoggedIn(config);
  const coroner = coronerClientFromGlobal(config, cmd.globalOptions);
  const universe = getUniverse(cmd, config);

  coroner.control2(
    universe,
    'audit',
    {
      action: 'extract',
    },
    (error, rp) => {
      if (error) errx(error);

      if (cmd.json) {
        console.log(JSON.stringify(rp, null, 2));
      } else if (cmd.table) {
        const tableFormat: TableUserConfig = {
          columns: {
            2: {
              alignment: 'right',
            },
            3: {
              alignment: 'right',
            },
          },
          drawHorizontalLine: function (i, s) {
            if (i === 0 || i === 1 || i === s) return true;
            return false;
          },
        };
        var m = rp.response.log;
        const title = [
          'Time',
          'Tenant',
          'Username',
          'Component',
          'Result',
          'Message',
        ];
        const data = [title];

        for (let i = 0; i < m.length; i++) {
          const d = new Date(m[i].timestamp * 1000);
          var r;

          r = m[i].result;
          if (r === 0) {
            r = success_color('success');
          } else {
            r = error_color('FAILURE');
          }

          m[i].message = m[i].message
            .replace(/[\x00-\x1F\x7F-\x9F]/g, '…')
            .substring(0, 100);
          data.push([
            d.toLocaleString(),
            m[i].universe,
            m[i].username,
            m[i].subsystem,
            r,
            m[i].message,
          ]);
        }

        console.log(table(data, tableFormat));
      } else {
        var m = rp.response.log;

        for (let i = 0; i < m.length; i++) {
          process.stdout.write(
            printf(
              '%23s %15s %7s %s %s %s\n',
              '[' + new Date(m[i].timestamp * 1000).toLocaleString() + ']',
              m[i].subsystem,
              m[i].result === 0 ? 'success' : 'FAILURE',
              m[i].universe,
              m[i].username,
              m[i].message,
            ),
          );
        }
      }
    },
  );
}

function logList(cmd: LogListCommand, config: any): any {
  abortIfNotLoggedIn(config);
  const coroner = coronerClientFromGlobal(config, cmd.globalOptions);
  const universe = getUniverse(cmd, config);

  coroner.control2(
    universe,
    'shml',
    {
      action: 'list',
    },
    (error, rp) => {
      if (error) errx(error);

      console.log(JSON.stringify(rp.response.logs, null, 2));
    },
  );
}

function logActivate(cmd: LogActivateCommand, config: any): any {
  abortIfNotLoggedIn(config);
  const coroner = coronerClientFromGlobal(config, cmd.globalOptions);
  const universe = getUniverse(cmd, config);

  coroner.control2(
    universe,
    'shml',
    {
      action: 'activate',
      form: {
        name: cmd.name,
      },
    },
    (error, rp) => {
      if (error) errx(error);

      console.log(success_color(cmd.name + ' is activated.'));
    },
  );
}

function logDeactivate(cmd: LogDeactivateCommand, config: any): any {
  abortIfNotLoggedIn(config);
  const coroner = coronerClientFromGlobal(config, cmd.globalOptions);
  const universe = getUniverse(cmd, config);

  coroner.control2(
    universe,
    'shml',
    {
      action: 'deactivate',
      form: {
        name: cmd.name,
      },
    },
    (error, rp) => {
      if (error) errx(error);

      console.log(success_color(cmd.name + ' is deactivated.'));
    },
  );
}

function logExtract(cmd: LogExtractCommand, config: any): any {
  abortIfNotLoggedIn(config);
  const coroner = coronerClientFromGlobal(config, cmd.globalOptions);
  const universe = getUniverse(cmd, config);

  const q: any = {
    action: 'extract',
    form: {
      name: cmd.name,
    },
  };

  if (cmd.globalOptions.universe) q.form.universe = cmd.globalOptions.universe;

  coroner.control2(universe, 'shml', q, (error, rp) => {
    if (error) errx(error);

    if (cmd.json) {
      console.log(JSON.stringify(rp, null, 2));
    } else if (cmd.table) {
      for (const log in rp.response) {
        const tableFormat: TableUserConfig = {
          columns: {
            1: {
              alignment: 'right',
            },
            2: {
              alignment: 'right',
            },
          },
          drawHorizontalLine: function (i, s) {
            if (i === 0 || i === 1 || i === s) return true;
            return false;
          },
        };
        var m = rp.response[log];
        const title = ['Date', 'Tenant', 'Result', 'Message'];
        const data = [title];

        for (let i = 0; i < m.length; i++) {
          const d = new Date(m[i].timestamp * 1000);
          var r;

          r = m[i].result;
          if (r === 'success') {
            r = green(r);
          } else if (r == 'failure') {
            r = red(r);
          }

          m[i].message = m[i].message
            .replace(/[\x00-\x1F\x7F-\x9F]/g, '…')
            .substring(0, 100);
          data.push([d.toLocaleString(), m[i].universe, r, m[i].message]);
        }

        console.log(bold(log));
        console.log(table(data, tableFormat));
      }
    } else {
      for (const log in rp.response) {
        var m = rp.response[log];

        for (let i = 0; i < m.length; i++) {
          process.stdout.write(
            new Date(m[i].timestamp * 1000).toISOString() + ' ',
          );
          if (m[i].message[m[i].message.length - 1] === '\n') {
            process.stdout.write(m[i].message);
          } else {
            console.log(m[i].message);
          }
        }
      }
    }
  });
}

function latencyList(cmd: LatencyListCommand, config: any): any {
  abortIfNotLoggedIn(config);
  const coroner = coronerClientFromGlobal(config, cmd.globalOptions);
  const universe = getUniverse(cmd, config);

  coroner.control2(
    universe,
    'histogram',
    {
      action: 'list',
    },
    (error, rp) => {
      if (error) errx(error);

      const hs = rp.response.histograms;
      for (let i = 0; i < hs.length; i++) {
        if (cmd.pattern && hs[i].name.match(cmd.pattern) === null) continue;

        let l =
          printf('%3d [%8s] ', i + 1, hs[i].active ? 'active' : 'inactive') +
          hs[i].name;

        if (hs[i].active === true) {
          l = bold(l) + ' [' + hs[i].buffer[0] + ', ' + hs[i].buffer[1] + ']';
        }

        console.log(l);
      }
      return;
    },
  );
}

function latencyActivate(cmd: LatencyActivateCommand, config: any): any {
  abortIfNotLoggedIn(config);
  const coroner = coronerClientFromGlobal(config, cmd.globalOptions);
  const universe = getUniverse(cmd, config);

  let samples = 4096;
  if (cmd.samples) samples = Number(cmd.samples);

  coroner.control2(
    universe,
    'histogram',
    {
      action: 'activate',
      form: {
        name: cmd.name,
        samples: samples,
      },
    },
    (error, rp) => {
      let ji = 0;

      if (error) errx(error);

      const hs = rp.response.histograms;
      for (const hi in hs) {
        if (hs[hi].status === 'error') {
          err(
            sprintf(
              '%3d %s has not been activated (%s)',
              ++ji,
              hi,
              hs[hi].message,
            ),
          );
        } else {
          console.log(
            printf('%3d %s has been activated.', ++ji, success_color(hi)),
          );
        }
      }

      if (ji === 0) {
        err('No histograms activated.');
        process.exit(1);
      }

      return;
    },
  );
}

function latencyDeactivate(cmd: LatencyDeactivateCommand, config: any): any {
  abortIfNotLoggedIn(config);
  const coroner = coronerClientFromGlobal(config, cmd.globalOptions);
  const universe = getUniverse(cmd, config);

  coroner.control2(
    universe,
    'histogram',
    {
      action: 'deactivate',
      form: {
        name: cmd.name,
      },
    },
    (error, rp) => {
      let ji = 0;

      if (error) errx(error);

      const hs = rp.response.histograms;
      for (const hi in hs) {
        if (hs[hi].status === 'error') {
          err(
            sprintf(
              '%3d %s has not been activated (%s)',
              ++ji,
              hi,
              hs[hi].message,
            ),
          );
        } else {
          console.log(
            printf('%3d %s has been deactivated.', ++ji, success_color(hi)),
          );
        }
      }

      if (ji === 0) {
        err('No histograms deactivated.');
        process.exit(1);
      }

      return;
    },
  );
}

function latencyExtract(cmd: LatencyExtractCommand, config: any): any {
  abortIfNotLoggedIn(config);
  const coroner = coronerClientFromGlobal(config, cmd.globalOptions);
  const universe = getUniverse(cmd, config);

  coroner.control2(
    universe,
    'histogram',
    {
      action: 'extract',
      form: {
        name: cmd.name,
      },
    },
    (error, rp) => {
      if (error) errx(error);

      const hs = rp.response.histograms;

      if (cmd.raw) {
        for (const i in hs) {
          for (var ji = 0; ji < hs[i].values.length; ji++)
            console.log(hs[i].values[ji]);
        }
      } else {
        console.log(JSON.stringify(hs, null, 2));
      }
      return;
    },
  );
}

export const handlers: Record<string, (cmd: any, config: any) => any> = {
  'audit.extract': auditExtract,
  'log.list': logList,
  'log.activate': logActivate,
  'log.deactivate': logDeactivate,
  'log.extract': logExtract,
  'latency.list': latencyList,
  'latency.activate': latencyActivate,
  'latency.deactivate': latencyDeactivate,
  'latency.extract': latencyExtract,
};
