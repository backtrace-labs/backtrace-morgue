/*
 * Helper functions for building queries from CLI args.
 */
const chrono = require("chrono-node");

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
  if (argv.select || argv.filter || argv.fingerprint || argv.age || argv.time || argv['select-wildcard']) {
    /* Object must be returned for query to be chainable. */
    if (!argv.select && !argv['select-wildcard'] && !argv.template) {
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

function parseFilter(input) {
  let [attribute, op, value, flags] = input.split(",");
  if (!attribute || !op) {
    errx("Filter must be of form <column>,<operation>[,<value>].");
  }

  if (attribute == "_tx" && value && typeof value === "string") {
    // Convert 0x hex values
    var rr = value.split("x");
    if (rr.length === 2) {
      value = parseInt(rr[1], 16);
    }
  }

  /* Some operators don't require an argument. */
  if (!value) {
    return {
      attribute,
      filter: [op],
    };
  } else if (!flags) {
    return {
      attribute,
      filter: [op, value],
    };
  } else {
    return {
      attribute,
      filter: [op, value, parseFilterFlags(input)],
    };
  }
}

function argvQueryPrefold(argv, implicitTimestampOps) {
  var query = {};
  var d_age = null;
  let ts_attr = 'timestamp';

  if (argv['raw-query']) {
    return { query: JSON.parse(argv['raw-query']) };
  }

  if (argv.table === 'unique_aggregations' ||
      argv.table === 'unique_aggregations_coarse') {
    ts_attr = '_end_timestamp';
  }

  /* If user specifies a timestamp attribute, use it. */
  if (argv["timestamp-attribute"] && argv["timestamp-attribute"].length > 0)
    ts_attr = argv["timestamp-attribute"];

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
      const { attribute, filter } = parseFilter(argv.filter[i]);
      if (!query.filter[0][attribute]) {
        query.filter[0][attribute] = [];
      }

      query.filter[0][attribute].push(filter);
    }
  }

  if (argv.sort) {
    if (Array.isArray(argv.sort) === false)
      argv.sort  = [argv.sort];

    query.order = argv.sort.map(parseSortTerm);
  }

  if (!query.filter[0][ts_attr] && implicitTimestampOps)
    query.filter[0][ts_attr] = [];

  if (argv.time) {
    if (query.filter[0][ts_attr] && query.filter[0][ts_attr].length > 0)
      errx('Cannot mix --time and timestamp filters');

    var tm = chrono.parse(argv.time);
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
  } else if (argv.select || argv['select-wildcard']) {
    if (argv.select) {
      if (!query.select)
        query.select = [];

      if (Array.isArray(argv.select) === true) {
        for (let i = 0; i < argv.select.length; i++) {
          query.select.push(argv.select[i]);
        }
      } else {
        query.select = [argv.select];
      }
    }

    if (argv['select-wildcard']) {
      if (!query.select_wildcard) {
        query.select_wildcard = {};
      }

      var wildcards = Array.isArray(argv['select-wildcard']) ? argv['select-wildcard'] : [argv['select-wildcard']];
      for (let i = 0; i < wildcards.length; i++) {
        query.select_wildcard[wildcards[i]] = true;
      }
    }
  } else if (argv.table === 'objects' && implicitTimestampOps) {
    if (!query.fold)
      query.fold = {}
    query.fold[ts_attr] = [['range'], ['bin']]
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
    if (query.filter[0][ts_attr] && query.filter[0][ts_attr].length > 0)
      errx('Cannot mix --age and timestamp filters');

    d_age = argv.age;
  } else if (!query.filter[0][ts_attr] || query.filter[0][ts_attr].length == 0) {
    d_age = '1M';
  }

  if (d_age && implicitTimestampOps) {
    var now = Date.now();
    var target = parseInt(now / 1000) - timeCli.timespecToSeconds(d_age);
    var oldest = Math.floor(target);

    query.filter[0][ts_attr] = [
      [ 'at-least', oldest ]
    ];

    range_start = oldest;
    range_stop = Math.floor(now / 1000);

    if (query.fold && query.fold[ts_attr] && implicitTimestampOps) {
      var ft = query.fold[ts_attr];
      var i;

      for (i = 0; i < ft.length; i++) {
        if (ft[i][0] === 'bin') {
          ft[i] = ft[i].concat([32, range_start, range_stop]);
        }
      }
    }
  }

  if (argv.table === 'objects') {
    if (!query.filter[0][ts_attr] || query.filter[0][ts_attr].length === 0 &&
      implicitTimestampOps) {
      if (!query.filter[0][ts_attr]) {
        query.filter[0][ts_attr] = [];
      }
      query.filter[0][ts_attr].push([ 'greater-than', 0 ]);
    }
  }

  return { query: query, age: d_age };
}

/*
 * Generate a query from argv.
 *
 * if implicitTimestampOps is false, don't add anything to do with timestamp.
 * this is used by alerts among other things to allow for the user to enter
 * queries without having to know the JSON syntax.
 */
function argvQuery(argv, implicitTimeOps=false, doFolds=false) {
  const { query, age } = argvQueryPrefold(argv, implicitTimeOps);

  if (!doFolds) {
    return { query, age };
  }

  /*
   * This was originally lifted from morgue.js and not refactored because it's
   * fragile.
   */
  function fold(query, attribute, label) {
    var argv, i;

    if (!query.fold)
      query.fold = {};

    if (Array.isArray(attribute) === false) {
      attribute = [ attribute ];
    }

    for (i = 0; i < attribute.length; i++) {
      var modifiers, j;

      modifiers = attribute[i].split(',');
      argv = modifiers[0];
      modifiers.shift();

      for (j = 0; j < modifiers.length; j++) {
        modifiers[j] = parseInt(modifiers[j]);
        if (isNaN(modifiers[j]) === true) {
          errx('Modifiers must be integers.');
        }
      }

      if (!query.fold[argv])
        query.fold[argv] = [];

      query.fold[argv].push([label].concat(modifiers));
    }
  }

  const folds = [
    [argv.last, 'last'],
    [argv.first, 'first'],
    [argv.tail, 'tail'],
    [argv.head, 'head'],
    [argv.object, 'object'],
    [argv.histogram, 'histogram'],
    [argv.distribution, 'distribution'],
    [argv.unique, 'unique'],
    [argv.mean, 'mean'],
    [argv.min, 'min'],
    [argv.max, 'max'],
    [argv.sum, 'sum'],
    [argv.quantize, 'bin'],
    [argv.bin, 'bin'],
    [argv.range, 'range'],
    [argv.count, 'count'],
  ];

  /* Apply requested folds to query */
  folds.forEach(function(attr_op) {
    const [attr, op] = attr_op;
    if (attr)
      fold(query, attr, op);
  });

  return { query, age };
}



module.exports = {
  argvQuery,
  argvQueryFilterOnly,
  parseFilter,
};

//-- vim:ts=2:et:sw=2
