import axios from 'axios';
import {table} from 'table';
import {spawn} from 'child_process';
import * as fs from 'fs';
import * as config from '../config';
import * as crdb from '../crdb';
import * as queryCli from '../cli/query';
import {errx} from '../cli/errors';
import {abortIfNotLoggedIn, coronerClientArgv, coronerParams} from '../cli/context';
import {usage} from '../cli/util';
import {flamegraphScript} from '../cli/constants';

const similarityParams = ['threshold', 'intersection', 'distance', 'truncate'];
const similarityDefaultFilter = [{timestamp: [['at-least', '1.']]}];

async function coronerSimilarity(argv: any, config: any): Promise<any> {
  abortIfNotLoggedIn(config);

  const similarityService = config.config.services.find(service => {
    return service.name === 'similarity';
  });

  if (!similarityService || !similarityService.endpoint) {
    errx('morgue similarity is unavailable on your host');
  }

  const coroner = coronerClientArgv(config, argv);
  const similarityEndpoint = similarityService.endpoint.startsWith('http')
    ? similarityService.endpoint
    : `${coroner.endpoint}${similarityService.endpoint}`;

  if (argv._.length < 2) {
    return usage('Missing project, universe arguments.');
  }

  let fingerprint;
  if (argv.fingerprint) {
    fingerprint = argv.fingerprint;
    delete argv.fingerprint;
  }
  const project = coronerParams(argv, config).project;
  const xCoronerToken = config.config.token;
  const xCoronerLocation = config.endpoint;

  // Default options
  const candidacyOptions = {
    type: 'distance',
    truncate: 100,
    distance: 10,
    intersection: 1,
    threshold: 1,
  };
  const limit = argv.limit || 20;
  const filter = argv.filter || similarityDefaultFilter;

  similarityParams.forEach(param => {
    if (argv[param]) {
      candidacyOptions[param] = argv[param];
    }
  });

  let body;
  let url;

  // If we have fingerprint, get candidates. Otherwise get project summary.
  const requestType = fingerprint ? 'candidates' : 'summary';
  if (requestType === 'candidates') {
    body = {
      project,
      fingerprint,
      candidacy: [candidacyOptions],
      limit,
    };
    url = `${similarityEndpoint}/candidates`;
  } else {
    body = {
      project,
      candidacy: candidacyOptions,
      filter,
      limit,
    };
    url = `${similarityEndpoint}/summary`;
  }

  let results;
  try {
    results = await axios.post(url, body, {
      headers: {
        'x-coroner-token': xCoronerToken,
        'x-coroner-location': xCoronerLocation,
      },
    });
  } catch (err) {
    errx(err);
  }

  if (argv.json) {
    console.log(JSON.stringify(results.data, null, 2));
    return;
  }
  results = results.data;
  if (results.error) {
    return errx(results.error);
  } else {
    results = results.results;
  }

  // Render results
  switch (requestType) {
    case 'candidates': {
      const meta = results[0].meta;
      let disqualified = 0;
      Object.keys(meta.disqualified).forEach(k => {
        disqualified += meta.disqualified[k];
      });
      console.log('\n Disqualified: ', disqualified);
      const disqual_table = [
        ['by Threshold', 'by Intersection', 'by Distance'],
        [
          meta.disqualified.byThreshold,
          meta.disqualified.byIntersection,
          meta.disqualified.byDistance,
        ],
      ];
      console.log(table(disqual_table));
      console.log('\n Qualified: ', meta.qualified);
      const candidates = results[0].candidates;
      let canidate_data = [['Distance', 'Fingerprint', 'Dates', 'Count']];
      candidates.forEach(candidate => {
        const dates = candidate.dates.map(date => {
          return new Date(date * 1000).toDateString();
        });
        canidate_data = canidate_data.concat([
          [
            candidate.distance,
            candidate.fingerprint.substring(0, 7),
            dates.join(' - '),
            candidate.count,
          ],
        ]);
      });
      console.log(table(canidate_data));
      break;
    }
    case 'summary': {
      const data = results;
      let summary_data = [
        [
          'Fingerprint',
          'Dates',
          'Count',
          'Candidates',
          'Instances',
          '0',
          '1',
          '2',
          '3',
          '4+',
        ],
      ];
      data.forEach(d => {
        const dates = d.dates.map(date => {
          return new Date(date * 1000).toDateString();
        });
        summary_data = summary_data.concat([
          [
            d.fingerprint.substring(0, 7),
            dates.join(' - '),
            d.count,
            d.candidates,
            d.candidateInstances,
            d.groupedByDistance[0],
            d.groupedByDistance[1],
            d.groupedByDistance[2],
            d.groupedByDistance[3],
            d.groupedByDistance[4],
          ],
        ]);
      });
      console.log('\n');
      console.log(table(summary_data));
      break;
    }
    default: {
      errx('unknown type of similarity request');
    }
  }
}

function coronerFlamegraph(argv: any, config: any): any {
  abortIfNotLoggedIn(config);
  let query, p;
  const unique = argv.unique;
  const reverse = argv.reverse;

  const coroner = coronerClientArgv(config, argv);

  if (argv._.length < 2) {
    return usage('Missing project, universe arguments.');
  }

  p = coronerParams(argv, config);

  const aq = queryCli.argvQuery(argv);
  query = aq.query;
  const d_age = aq.age;
  const data = '';

  query.fold = {
    callstack: [['histogram']],
  };

  coroner.query(p.universe, p.project, query, (err, result) => {
    if (err) {
      errx(err.message);
    }

    const child = spawn(flamegraphScript);
    const response = new crdb.Response(result.response);
    const rp: any = response.unpack();

    if (!rp['*']) {
      errx('No results found.');
    }

    const samples = rp['*']['histogram(callstack)'];

    for (let i = 0; i < samples.length; i++) {
      var callstack;

      try {
        callstack = JSON.parse(samples[i][0]).frame;
      } catch (error) {
        continue;
      }

      const count = samples[i][1];
      let line = '';

      if (argv.reverse) {
        for (var j = 0; j < callstack.length; j++) {
          if (j != 0) line += ';';

          line += callstack[j];
        }
      } else {
        for (var j = callstack.length - 1; j >= 0; j--) {
          if (j != callstack.length - 1) line += ';';

          line += callstack[j];
        }
      }

      if (unique) {
        line += ' 1';
      } else {
        line += ' ' + count;
      }

      child.stdin.write(line + '\n');
    }

    child.stdin.end();

    if (argv.o) {
      try {
        fs.accessSync(argv.o);
        errx('File ' + argv.o + ' already exists.');
      } catch (error) {
        /* We are fine, not replacing a file probably. */
      }

      const stream = fs.createWriteStream(argv.o);
      child.stdout.pipe(stream);
    } else {
      child.stdout.on('data', data => {
        process.stdout.write(data + '');
      });
    }
  });
}

export const commands: Record<string, (argv: any, config: config.Config) => any> = {
  similarity: coronerSimilarity,
  flamegraph: coronerFlamegraph,
};
