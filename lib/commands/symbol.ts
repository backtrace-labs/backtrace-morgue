import type {Config} from '../config';
import * as fs from 'fs';
import {table, TableUserConfig} from 'table';
import * as ta from 'time-ago';
import type {SymbolCommand,
  CommandHandler,
} from '../cli/generated/types';
import {errx, chalk, success_color} from '../cli/errors';
import {
  abortIfNotLoggedIn,
  coronerClientFromGlobal,
  parseProjectArg,
} from '../cli/context';
import {usage} from '../cli/util';

const bold = chalk.bold;
const yellow = chalk.yellow;

/**
 * @brief: Implements the symbol list command.
 */
function handleSymbol(cmd: SymbolCommand, config: Config): any {
  abortIfNotLoggedIn(config);

  const query: any = {form: {}};
  let action = cmd.action;
  let filter = cmd.filter;

  if (cmd.tag) {
    if (Array.isArray(cmd.tag)) {
      query.form.tags = cmd.tag;
    } else {
      query.form.tags = [cmd.tag];
    }
  }

  const coroner = coronerClientFromGlobal(config, cmd.globalOptions);

  const p = parseProjectArg(cmd.project, config);

  if (action === 'status' || action === 'summary' || !action) {
    query.action = 'summary';
    action = 'summary';
  } else if (action === 'list') {
    query.action = 'symbols';
    query.form.values = [
      'debug_file',
      'debug_identifier',
      'archive_id',
      'file_size',
      'upload_time',
      'extract_time',
      'convert_time',
    ];
  } else if (action === 'archives') {
    query.action = 'archives';
  } else if (action === 'missing') {
    query.action = 'missing_symbols';
  } else {
    errx(
      'Usage: morgue symbol <project> [archives | list | missing | summary]',
    );
  }

  coroner.symfile(p.universe, p.project, query, (err, result) => {
    if (err) {
      errx(err.message);
    }

    let output = null;

    if (cmd.globalOptions.debug) return;

    if (cmd.json) {
      console.log(JSON.stringify(result));
      return;
    }

    if (cmd.output) output = cmd.output;

    if (output) {
      const json = JSON.stringify(result);

      fs.writeFileSync(output, json);
      return;
    }

    if (action === 'summary') {
      const tableFormat: TableUserConfig = {
        columns: {
          2: {
            alignment: 'right',
          },
        },
      };
      var response = result.response.summary;
      var title = ['First Update', 'Most Recent Update', 'Count'];
      var data = [title];

      if (response.archives && response.archives.count) {
        data[1] = [
          new Date(response.archives.first_updated_time * 1000),
          new Date(response.archives.last_updated_time * 1000),
          response.archives.count,
        ];

        console.log(bold('Archives'));
        console.log(table(data, tableFormat));
      }

      if (response.symbols && response.symbols.count) {
        data[1] = [
          new Date(response.symbols.first_updated_time * 1000),
          new Date(response.symbols.last_updated_time * 1000),
          response.symbols.count,
        ];

        console.log(bold('Symbols'));
        console.log(table(data, tableFormat));
      }

      if (response.missing_symbols && response.missing_symbols.count) {
        data[1] = [
          new Date(response.missing_symbols.first_crash_time * 1000),
          new Date(response.missing_symbols.last_crash_time * 1000),
          response.missing_symbols.count,
        ];

        console.log(bold('Missing Symbols'));
        console.log(table(data, tableFormat));
      }

      return;
    }

    if (action === 'archives') {
      const tableFormat: TableUserConfig = {
        drawHorizontalLine: (index, size) => {
          return (
            index === 0 || index === 1 || index === size - 1 || index === size
          );
        },
        columns: {
          2: {
            alignment: 'right',
          },
          4: {
            alignment: 'right',
          },
          5: {
            alignment: 'right',
          },
          6: {
            alignment: 'right',
          },
          7: {
            width: 80,
            wrapWord: true,
          },
        },
      };

      var response = result.response.archives;
      var title = [
        'A',
        'Upload Date',
        'Size',
        'Status',
        'Symbols',
        'Duplicates',
        'Invalid',
        'Errors',
      ];

      for (var i = 0; i < response.length; i++) {
        var files = response[i].files;
        var data = [title];

        files.sort((a, b) => {
          return (
            +(Number(a.upload_time) > Number(b.upload_time)) -
            +(Number(b.upload_time) > Number(a.upload_time))
          );
        });

        for (var j = 0; j < files.length; j++) {
          var file = files[j];
          let label = '--';
          var dt;

          dt = ta.ago(file.upload_time * 1000);

          if (file.errors.length > 0) {
            label = file.errors.join('. ');
          }

          data.push([
            file.archive_id === 'ffffffffffffffff' ? '--' : file.archive_id,
            dt,
            Math.ceil(file.file_size / 1024) + 'KB',
            file.status,
            file.new_symbols,
            file.duplicate_symbols,
            file.invalid_symbols,
            label,
          ]);
        }

        data.push(title);
        if (data.length > 2) {
          console.log(yellow('Tag: ') + response[i].tag);
          console.log(table(data, tableFormat));
        }
      }
    }

    if (action === 'missing') {
      const tableFormat: TableUserConfig = {
        drawHorizontalLine: (index, size) => {
          return (
            index === 0 || index === 1 || index === size - 1 || index === size
          );
        },
        columns: {
          0: {
            alignment: 'right',
          },
        },
      };

      var response = result.response.archives;
      var title = ['First appearance', 'Debug File', 'Debug Identifier'];

      {
        var files = result.response.missing_symbols;
        var data = [title];

        files.sort((a, b) => {
          return +(a.timestamp > b.timestamp) - +(b.timestamp > a.timestamp);
        });

        for (var j = 0; j < files.length; j++) {
          var file = files[j];
          var dt;

          dt = ta.ago(file.timestamp * 1000);

          data.push([dt, file.debug_file, file.debug_id]);
        }

        data.push(title);
      }

      console.log(table(data, tableFormat));
    }

    if (action === 'list') {
      const tableFormat: TableUserConfig = {
        drawHorizontalLine: (index, size) => {
          return (
            index === 0 || index === 1 || index === size - 1 || index === size
          );
        },
        columns: {
          4: {
            alignment: 'right',
          },
          5: {
            alignment: 'right',
          },
          6: {
            alignment: 'right',
          },
        },
      };

      const tags = result.response.symbols;
      const titlePrint = false;
      for (var i = 0; i < tags.length; i++) {
        var title = [
          'A',
          'Upload Date',
          'Debug File',
          'GUID',
          'Size',
          'Extraction',
          'Conversion',
        ];
        var data = [title];

        tags[i].files.sort((a, b) => {
          return (
            +(Number(a.upload_time) > Number(b.upload_time)) -
            +(Number(b.upload_time) > Number(a.upload_time))
          );
        });

        for (var j = 0; j < tags[i].files.length; j++) {
          var file = tags[i].files[j];
          var dt;

          if (filter) {
            const string = JSON.stringify(file);
            if (string.indexOf(filter) === -1) continue;
          }

          dt = ta.ago(file.upload_time * 1000);

          data.push([
            file.archive_id === 'ffffffffffffffff' ? '--' : file.archive_id,
            dt,
            file.debug_file,
            file.debug_identifier,
            Math.ceil(file.file_size / 1024) + 'KB',
            file.extract_time > 0 ? file.extract_time + 'ms' : '--',
            file.convert_time > 0 ? file.convert_time + 'ms' : '--',
          ]);
        }

        data.push(title);

        if (data.length > 2) {
          console.log(yellow('Tag: ') + tags[i].tag);
          console.log(table(data, tableFormat));
        }
      }
    }
  });
}

export const handlers: Record<string, CommandHandler> = {
  symbol: handleSymbol,
};
