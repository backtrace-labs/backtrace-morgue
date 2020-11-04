/*
 * Helper functions for building queries from CLI args.
 */
const timeCli = require('./time');
const { err, errx } = require('./errors');

function argvQuantizeUint(argv) {
  let q = argv["quantize-uint"];

  if (!q)
    return [];

  if (!Array.isArray(q))
    q = [ q ];

  return q.map(a => {
    let segs = a.split(",");

    if (segs.length < 3) {
      errx("Quantize column definition is of the form output_name,backing_column,size,[offset]");
    }

    let [name, backing, size, offset] = segs;
    if (offset === undefined || offset === null) {
      offset = "0";
    }

    size = timeCli.parseTimeInt(size);
    offset = timeCli.parseTimeInt(offset);

    return {
      name: name,
      type: "quantize_uint",
      quantize_uint: {
        backing_column: backing,
        size: size,
        offset: offset,
      }
    };
  });
}

function argvVcols(args) {
  return argvQuantizeUint(args);
}

/* Some subcommands don't make sense with folds etc. */
function argvQueryFilterOnly(argv) {
  if (argv.select || argv.filter || argv.fingerprint || argv.age || argv.time) {
    /* Object must be returned for query to be chainable. */
    if (!argv.select && !argv.template) {
      argv.select = 'object';
    }
    return argvQuery(argv);
  }
  return null;
}

function parseSortTerm(term) {
  var ordering = "ascending";
  var name = term;

  if (term[0] === "-") {
    ordering = "descending";
    name = term.slice(1);
  }

  return {name: name, ordering: ordering};
}

/*
 * Assumes that we start at the 4th argument, and returns a filter object.
 */
function parseFilterFlags(filter) {
  if (filter.length < 4) {
    return {};
  }

  let flags = {};
  const known_flags = new Set([ 'case_insensitive' ]);
  for (const f of filter.slice(3)) {
    const transformed = f.replace("-", "_");
    if (!known_flags.has(transformed)) {
      errx(`Unknown filter flag ${ f }`);
    }
    flags[transformed] = true;
  }
  return flags;
}

function argvQuery(argv) {
  var query = {};
  var d_age = null;

  if (argv['raw-query']) {
    return { query: JSON.parse(argv['raw-query']) };
  }

  if (argv.reverse)
    reverse = -1;

  if (argv.template)
    query.template = argv.template;

  if (argv.limit)
    query.limit = argv.limit;

  if (argv.offset)
    query.offset = argv.offset;

  query.filter = [{}];
  if (argv.filter) {
    var i;

    if (Array.isArray(argv.filter) === false)
      argv.filter = [argv.filter];

    for (i = 0; i < argv.filter.length; i++) {
      var r = argv.filter[i];
      var expr = [];

      r = r.split(',');
      if (r.length < 2) {
        errx('Filter must be of form <column>,<operation>[,<value>].');
      }

      if (r[0] == "_tx" && r.length == 3 && typeof r[2] === "string") {
        var rr = r[2].split("x");
        if (rr.length === 2) {
          r = [r[0], r[1], parseInt(rr[1], 16)];
        }
      }

      if (!query.filter[0][r[0]])
        query.filter[0][r[0]] = [];

      /* Some operators don't require an argument. */
      if (r.length == 2)
        expr = [r[1]];
      else if (r.length == 3)
        expr = [r[1], r[2]];
      else if (r.length == 4)
        expr = [r[1], r[2], parseFilterFlags(r)];


      query.filter[0][r[0]].push(expr);
    }
  }

  if (argv.sort) {
    if (Array.isArray(argv.sort) === false)
      argv.sort  = [argv.sort];

    query.order = argv.sort.map(parseSortTerm);
  }

  if (!query.filter[0].timestamp)
    query.filter[0].timestamp = [];

  if (argv.time) {
    if (query.filter[0].timestamp && query.filter[0].timestamp.length > 0)
      errx('Cannot mix --time and timestamp filters');

    var tm = chrono.parse(argv.time);
    var ts_attr = 'timestamp';
    var ts_s, ts_e;

    if (argv.debug)
      console.log('tm = ', JSON.stringify(tm, null, 4));

    if (tm.length === 0)
      errx('invalid time specifier "' + argv.time + '"');

    if (tm.length > 1) {
      if (tm.length === 2) {
        /* See whether it parsed as two starts and no ends. */
        if (tm[0].start && tm[1].start && !tm[0].end && !tm[1].end) {
          ts_s = tm[0].start.date();
          ts_e = tm[1].start.date();
        }
      }
      if (!ts_s)
        errx('only a single date or range is permitted.'.error);
    } else {
      if (!tm[0].start)
        errx('date specification lacks start date'.error);

      if (!tm[0].end)
        errx('date specification lacks end date'.error);

      ts_s = tm[0].start.date();
      ts_e = tm[0].end.date();
    }

    /* Treat zero start time as greater than zero to exclude unset values. */
    ts_s = parseInt(ts_s / 1000);
    if (ts_s === 0)
      ts_s = 1;
    ts_e = parseInt(ts_e / 1000);

    /* If user specifies a timestamp attribute, use it. */
    if (argv["timestamp-attribute"] && argv["timestamp-attribute"].length > 0)
      ts_attr = argv["timestamp-attribute"];

    query.filter[0][ts_attr] = [
      [ 'at-least', ts_s ],
      [ 'less-than', ts_e ]
    ];

    d_age = null;
  }

  if (argv.factor) {
    query.group = [ argv.factor ];
  }

  query.virtual_columns = argvVcols(argv);

  if (argv.template === 'select') {
  } else if (argv.select) {
    if (!query.select)
      query.select = [];

    if (Array.isArray(argv.select) === true) {
      for (let i = 0; i < argv.select.length; i++) {
        query.select.push(argv.select[i]);
      }
    } else {
      query.select = [ argv.select ];
    }
  } else if (argv.table === 'objects') {
    query.fold = {
      'timestamp' : [['range'], ['bin']]
    };
  }

  /*
   * The fingerprint argument is a convenience function for filtering by
   * a group.
   */
  if (argv.fingerprint) {
    var length, op, ar;

    if (Array.isArray(argv.fingerprint) === true) {
      errx('Only one fingerprint argument can be specified.');
    }

    length = String(argv.fingerprint).length;
    if (length === 64) {
      op = 'equal';
      ar = argv.fingerprint;
    } else {
      op = 'regular-expression';
      ar = '^' + argv.fingerprint;
    }

    if (!query.filter[0].fingerprint)
      query.filter[0].fingerprint = [];
    query.filter[0].fingerprint.push([op, ar]);
  }

  if (argv.age) {
    if (query.filter[0].timestamp && query.filter[0].timestamp.length > 0)
      errx('Cannot mix --age and timestamp filters');

    d_age = argv.age;
  } else if (!query.filter[0].timestamp || query.filter[0].timestamp.length == 0) {
    d_age = '1M';
  }

  if (d_age) {
    var now = Date.now();
    var target = parseInt(now / 1000) - timeCli.timespecToSeconds(d_age);
    var oldest = Math.floor(target);

    query.filter[0].timestamp = [
      [ 'at-least', oldest ]
    ];

    range_start = oldest;
    range_stop = Math.floor(now / 1000);

    if (query.fold && query.fold.timestamp) {
      var ft = query.fold.timestamp;
      var i;

      for (i = 0; i < ft.length; i++) {
        if (ft[i][0] === 'bin') {
          ft[i] = ft[i].concat([32, range_start, range_stop]);
        }
      }
    }
  }

  if (argv.table === 'objects') {
    if (!query.filter[0].timestamp || query.filter[0].timestamp.length === 0)
      query.filter[0].timestamp.push([ 'greater-than', 0 ]);
  }

  return { query: query, age: d_age };
}

module.exports = {
  argvQuery,
  argvQueryFilterOnly,
};
