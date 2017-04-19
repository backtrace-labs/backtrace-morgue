#!/usr/bin/env node

const CRDB = require('../lib/crdb.js');
const fs = require('fs');
const moment = require('moment');
const btoa = require('btoa');

'use strict';

const now = parseInt(Date.now() / 1000);
const lastWeek = now - (24 * 3600 * 7);

/* Configuration singleton. */
var config;

const events = {
  'other' : [{
    'name' : 'report'
  }],
  'title' : [{
    'name' : 'report',
    'payload' : { 'route' : 'title' }
  }],
  'top' : [{
    'name' : 'report',
    'payload' : { 'route' : 'top' }
  }],
  'activity' : [{
    'name' : 'report',
    'payload' : { 'route' : 'activity' }
  }]
};

for (var et in events) {
  events[et] = btoa(JSON.stringify(events[et]));
}

function href(st, event) {
  var url = 'http://test:9999/dashboard/' + config.universe + '/project/' + config.project + '?granularity=week';
  var ev = events[event];

  if (!ev)
    ev = events.other;

  url += '&_t=' + ev;

  return '<a href="' + url + '">' + st + '</a>';
}

function sumHistogram(title, h, sum, scale_user) {
  var scale = 80;
  var colorMap = {};
  var colorIndex = 0;
  var i;
  var buffer = '';
  var divisor = 0;
  var array = [];

  if (scale_user)
    scale = scale_user;

  for (i in h)
    array.push([parseInt(i), h[i]]);

  array.sort(function(a, b) {
    return (a[0] > b[0]) - (a[0] < b[0]);
  });

  buffer += '<h3>' + title + '</h3>';
  buffer += '<table style="width: 100%; height: ' + scale + 'px; font-weight: 300; table-layout: fixed; margin-bottom: 20px; border-collapse: collapse"><tr>';

  for (var i = 0; i < array.length; i++) {
    var bs = 0;

    if (h[i]) {
      for (var a in h[i]) {
        bs += h[i][a];
      }

      if (bs > divisor)
        divisor = bs;
    }
  }

  if (divisor === 0)
    divisor = 1;

  for (var i = 0; i < array.length; i++) {
    var height;
    var bs = 0;

    if (h[i]) {
      for (var a in h[i]) {
        bs += h[i][a];
      }
    }

    /* Scale height to total. */
    height = parseInt(bs / divisor * scale);
    if (bs > 0 && height < 5)
      height = 5;

    var element = `
<td valign="bottom" style="padding: 0 5px 0 0; width: 10%; font-weight: 300; margin: 0; text-align: left">
<table style="width: 100%; font-weight: 300; margin-bottom: 0; border-collapse: collapse">
<tr style="font-weight: 300"><td style="font-size: 0; padding: 0; margin: 0; line-height: 0;"></td></tr>
<tr style="font-weight: 300"><td class="box baseline" height="` + height + `px" style="font-size: 0; padding: 0; font-weight: 300; margin: 0; line-height: 0; background-color: #ffa07a; text-align: left">&#160;</td><center><small></small></center></tr></table></td>`;

    buffer += element;
  }

  buffer += '</tr>';

  function getDateOfWeek(w, y) {
      var d = (1 + (w - 1) * 7);
      return new Date(y, 0, d);
  }

  var year = moment().format('YYYY');
  var year_a = year;
  var year_b = year;

  if (array.length === 0)
    return '';

  if (array[0][0] > array[array.length - 1][0])
    year_a--;

  buffer += `
</tr></table>
<table width="100%">
<tr style="font-weight: 300">
    <td valign="top" class="label" style="font-size: 14px; color: #848296; padding: 10px 0 0; width: 14%; border-right: none; font-weight: 300; margin: 0; text-align: left">
      ` + moment(getDateOfWeek(array[0][0], year_b)).format('MMMM') + `
    </td>

    <td valign="top" class="label" style="font-size: 14px; color: #848296; padding: 10px 0 0; width: 14%; border-right: none; font-weight: 300; margin: 0; text-align: right">
      ` + moment(getDateOfWeek(array[array.length - 1][0], year_b)).format('MMMM') + `
    </td>

</tr></table>`;

  return buffer;
}


function valueHistogram(title, h, limit) {
var buffer = '';
var scale = 64;
var sorted = [];
var sum = 0;

buffer += '<h5 style="text-align: right">' + title + '</h5>';
buffer += '<table style="width: 100%; font-size: 14px; font-weight: 300; table-layout: fixed; margin-bottom: 20px; border-collapse: collapse">';

for (var k in h) {
  sorted.push([k, h[k]]);
  sum += h[k];
}

sorted.sort(function(a, b) {
  return (a[1] < b[1]) - (a[1] > b[1]);
});

for (var i = 0; i < sorted.length; i++) {
  var bar = '<td width="100px"><table><tr><td style="background-color: #ffa07a" width="' + parseInt(sorted[i][1] / sum * 100) + 'px">&nbsp;</td></tr></table></td>';

  buffer += '<tr>';
  buffer += '<td style="text-align: right; padding-right: 5px"><small>' + sorted[i][0] + '</small></td>' + bar +
    '<td width="40px" style="text-align: right"><small>' + sorted[i][1] + '</small></td>';
  buffer += '</tr>';

  if (limit && i === limit - 1) {
    buffer += '<tr><td colspan="3" style="text-align: right"><small>' + href('... and more', 'top') + '</small></td></tr>';
    break;
  }
}

/* Translate into a sorted array. */
buffer += '</table>';

return buffer;
}

function renderGroup(result, options) {
  var buffer = '';
  var limit = 5;

  /* We first apply the defined sort order. Right now, it is last occurrence. */
  result.sort(function(a, b) {
    var a_t = a[1]['range(timestamp)'][1];
    var b_t = b[1]['range(timestamp)'][1];

    return (a_t < b_t) - (a_t > b_t);
  });

  if (options && options.group && options.group.limit)
    limit = options.group.limit;

  if (limit > result.length)
    limit = result.length;

  if (limit < result.length) {
    buffer += 'Displaying ' + limit + ' of ' + result.length + ' errors.<br><br>';
  }

  for (var i = 0; i < limit; i++) {
    var d = result[i][1];
    var callstack = d['head(callstack)'][0];
    var callstack_limit = 5;
    const frame_limit = 29;

  buffer += '<table style="border-radius: 4px; width: 100%; font-size: 14px; font-weight: 300; table-layout: fixed; margin-bottom: 20px; box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1); border-spacing: 0; border: 1px solid #ffa07a;" cellpadding="5px">';


    /* Header. */
    buffer += '<tr style="background: #ffa07a">';

    buffer += '<td width="250px">';

    var last = d['range(timestamp)'][1] * 1000;
    var hostname = d['unique(hostname)'][0];

    buffer += '<span style="font-weight: 700; font-size: 12px">' + (new Date(last)) + '</span>';

    buffer += '</td>';
    buffer += '<td><div align="right">';

    buffer += '<span style="color: #050505; padding: 3px; border-radius: 4px; font-weight: 700; font-size: 10px; background: #fadaa3">' + d.count + ' occurrences' +
      '</span>';

    buffer += '&nbsp;&nbsp;';
    buffer += '<span style="color: #050505; padding: 3px; border-radius: 4px; font-weight: 700; font-size: 10px; background: #fadaa3">' + hostname + ' hosts' +
      '</span>';

    buffer += '</div></td>';
    buffer += '</tr>';

    buffer += '<tr>';

    /* Render callstack. */
    if (options && options.callstack && options.callstack.limit)
      callstack_limit = options.callstack.limit;

    /* Increase callstack length to take into account attributes. */
    if (callstack_limit < Object.keys(d).length - 2)
      callstack_limit = Object.keys(d).length - 2;

    try {
      callstack = JSON.parse(callstack);
      callstack = callstack.frame;
    } catch (e) {
      callstack = d['head(callstack)'][0];
    }

    if (callstack && callstack.length) {
      if (callstack_limit > callstack.length)
        callstack_limit = callstack.length;
    } else {
      callstack_limit = 0;
    }

    buffer += '<td style="background: #f2f1ef" valign="top">';
    for (var j = 0; j < callstack_limit; j++) {
      var frame = callstack[j];

      if (frame.length > frame_limit) {
        frame = String(frame).substring(0, frame_limit) + '&hellip;';
      }

      buffer += '<span style="font-size: 12px; font-family: monospace;">' + frame + '</span></span>';

      if (j < callstack_limit - 1)
        buffer += ' &rarr; <br>';
    }

    if (callstack_limit > 0 && callstack_limit < callstack.length)
        buffer += ' &rarr; &hellip;';

    buffer += '</td>';

    /* Attributes. */
    buffer += '<td valign="top" width="100%">';

    buffer += '<table width="100%"><tr><td><strong>Attributes</strong></td><td><strong>Value</strong></td></tr>';
    for (var j in d) {
      if (j === 'count' || j.indexOf('hostname') > -1 || j.indexOf('callstack') > -1 ||
          j.indexOf('timestamp') > -1) {
        continue;
      }

      if (!d[j] || d[j] === '' || d[j].length === 0)
        continue;

      var nr_s = j.indexOf('(');
      var nr_e = j.indexOf(')');
      var label = j;

      if (nr_s >= 0 && nr_e >= 0 && nr_s < nr_e) {
        label = String(j).substring(nr_s + 1, nr_e);
      }

      var value;
      if (j.indexOf('histogram(') > -1) {
        var hl = d[j].length;

        d[j].sort(function(a, b) {
          return (a[1] < b[1]) - (a[1] > b[1]);
        });

        value = '';

        var overrun_bucket = 0;
        for (var k = 0; k < d[j].length; k++) {
          var bucket = d[j][k];
          var bl = bucket[0];
          var lv = bucket[1];

          if (k > 2) {
            overrun_bucket++;
            continue;
          }

          if (bl.length > 12) {
            bl = String(bl).substring(0, 12) + '&hellip;';
          } else if (bl.length === 0) {
            bl = 'none';
          }

          value += bl + ' &mdash; ' + lv + '<br>';
        }

        if (overrun_bucket > 0) {
          value += href('<small>&hellip; and ' + overrun_bucket + ' more.</small>', 'activity');
        }
      } else {
        value = d[j];
      }

      buffer += '<tr><td valign="top">' + label + '</td><td valign="top">' + value + '</td></tr>';
    }

    buffer += '</table>';
    buffer += '</td>';

    /* End of group. */
    buffer += '</tr>';
    buffer += '</table>';
  }

  if (limit < result.length) {
    buffer += '&hellip; and ' + (result.length - limit) + ' more errors.<br>';
  }

  return buffer;
}

function eventsInc(weekCount, day, application) {
  if (!weekCount[day])
    weekCount[day] = {};

  if (!weekCount[day][application])
    weekCount[day][application] = 0;

  weekCount[day][application]++;
  return;
}

function classifiersInc(c, classifiers) {
  var cp;

  if (!classifiers)
    return;

  cp = classifiers.split(' ');

  for (var i = 0; i < cp.length; i++) {
    if (!c[cp[i]])
      c[cp[i]] = 0;

    c[cp[i]]++;
  }
}

class Report {
  constructor(coroner, universe, project, options) {
    this.options = options;
    this.coroner = coroner;
    this.universe = universe;
    this.project = project;
    config = this;
  }

  histograms(cb) {
    var self = this;
    var queries = [
      {
        "title" : null,
        "attributes" : [ "tag", "environment", "dc" ]
      }
    ];
    var results = [];

    for (var i = 0; i < queries.length; i++) {
      var query = {};

      query.filter = [{
        'timestamp': [
          [ 'at-least', lastWeek ]
        ]
      }];

      if (queries[i].filter) {
        for (var kk in queries[i].filter[0]) {
          query.filter[0][kk] = queries[i].filter[kk];
        }
      }

      query.fold = {};
      for (var k = 0; k < queries[i].attributes.length; k++) {
        query.fold[queries[i].attributes[k]] = [[ 'histogram' ]];      
      }

      (function(q) {
        self.coroner.query(self.universe, self.project, q, function(error, rp) {
          if (error) {
            results.push(null);
            return;
          }

          results.push(rp.response);
          if (results.length === queries.length)
            cb(results);
        });
      })(query);
    }
  }

  /* Extract event counts for last week and month. */
  activity(limit, cb) {
    var self = this;
    var query = {};

    query.filter = [];
    query.filter.push({
      'timestamp': [
        [ 'at-least', lastWeek ]
      ]
    });
    query.fold = { 'timestamp' : [['range']] };

    query.template = "unique";

    /* The feed has a separate filter. */
    self.coroner.query(self.universe, self.project, query, function(error, result) {
      var results = new CRDB.Response(result.response).unpack();
      var sorted = [];
      var i;

      for (var k in results) {
        sorted.push([k, results[k]]);
      }

      sorted.sort(function(a, b) {
          return (a[1].count < b[1].count) - (a[1].count > b[1].count);
      });

      cb(sorted);
    });
  }

  events(cb) {
    var self = this;
    const now = parseInt(Date.now() / 1000);
    const lastWeek = now - (24 * 3600 * 7);
    const lastMonth = now - (24 * 3600 * 7 * 4);
    const lastQuarter = now - (24 * 3600 * 7 * 4 * 3);
    var query = {};

    query.filter = [];

    query.filter.push({
      'timestamp': [
        [ 'at-least', lastQuarter ]
      ]
    });

    query.select = [ 'timestamp', 'application', 'classifiers', 'hostname', 'fingerprint' ];

    self.coroner.query(self.universe, self.project, query, function(error, result) {
      var results = new CRDB.Response(result.response).unpack();
      var histogram = [];
      var weekCount = [];
      var weekSum = 0;
      var hostsWeek = {};
      var hostsQuarter = {};
      var uniqueWeek = {};
      var uniqueQuarter = {};
      var quarterCount = [];
      var quarterSum = 0;
      var lastWeekCount = [];
      var uniquePrior = {};
      var hostsPrior = {};
      var lastWeekSum = 0;
      var classifierCount = {};
      var quarterClassifierCount = {};

      results = results['*'];

      /*
       * Now, translate the data into a histogram by day for the last week
       * and quarter.
       */
      var today = parseInt(Date.now() / 1000 / (3600 * 24)) * (3600 * 24);

      for (var i = 0; i < results.length; i++) {
        var application = results[i].application;
        var day = new Date(results[i].timestamp * 1000).getDay();
        var week = new Date(results[i].timestamp * 1000);

        week.setHours(0,0,0,0);
        week.setDate(week.getDate()+4-(week.getDay()||7));
        week = Math.ceil((((week-new Date(week.getFullYear(),0,1))/8.64e7)+1)/7);

        /* Do not include data from today. */
        if (results[i].timestamp >= today)
          continue;

        quarterSum++;

        eventsInc(quarterCount, week, application);
        classifiersInc(quarterClassifierCount, results[i].classifiers);

        if (results[i].hostname && !hostsQuarter[results[i].hostname])
          hostsQuarter[results[i].hostname] = true;

        if (results[i].fingerprint && !uniqueQuarter[results[i].fingerprint])
          uniqueQuarter[results[i].fingerprint] = true;

        if (results[i].timestamp > lastWeek) {
          if (results[i].hostname && !hostsWeek[results[i].hostname])
            hostsWeek[results[i].hostname] = true;

          if (results[i].fingerprint && !uniqueWeek[results[i].fingerprint])
            uniqueWeek[results[i].fingerprint] = true;
          
          eventsInc(weekCount, day, application);
          classifiersInc(classifierCount, results[i].classifiers);
          weekSum++;
        }

        if (results[i].timestamp >= lastWeek - (3600 * 24 * 7) &&
            results[i].timestamp < lastWeek) {
          eventsInc(lastWeekCount, day, application);

          if (results[i].hostname && !hostsWeek[results[i].hostname])
            hostsPrior[results[i].hostname] = true;

          if (results[i].fingerprint && !uniqueWeek[results[i].fingerprint])
            uniquePrior[results[i].fingerprint] = true;

          lastWeekSum++;
        }
      }

      cb({
        'histogram' : {
          'quarter' : quarterCount,
          'priorWeek' : lastWeekCount,
          'classifiers' : classifierCount,
          'quarterClassifiers' : quarterClassifierCount,
          'thisWeek' : weekCount
        },
        'count' : {
          'priorWeek' : lastWeekSum,
          'quarter' : quarterSum,
          'thisWeek' : weekSum
        },
        'hosts' : Object.keys(hostsWeek).length,
        'unique' : Object.keys(uniqueWeek).length,
        'hostsQuarter' : Object.keys(hostsQuarter).length,
        'uniqueQuarter' : Object.keys(uniqueQuarter).length,
        'hostsPrior' : Object.keys(hostsPrior).length,
        'uniquePrior' : Object.keys(uniquePrior).length
      });
    });

    return self;
  }

  generate(path, cb) {
    var self = this;
    const now = moment().format('MMMM Do YYYY');
    const lastWeek = moment(((Date.now() / 1000) - (24 * 3600 * 7)) * 1000).format('MMMM Do YYYY');

    const header = `
<!DOCTYPE html>
<html style="font-weight: 300">
<head style="font-weight: 300">
  <meta charset="utf-8" style="font-weight: 300">
  <meta name="viewport" content="width=device-width, initial-scale=1" style="font-weight: 300">

  <style type="text/css" style="font-weight: 300">
    @import url(https://fonts.googleapis.com/css?family=Lato:300,700);
  </style>

  <style type="text/css" style="font-weight: 300">
    @media only screen and (max-device-width: 480px) {
      .mobile-full-width > th,
      .mobile-full-width > td {
          display: block;
          width: 100%;
      }
    }
  </style>
</head>
<body class="" style='font-size: 16px; color: #2f2936; padding: 0; font-family: "Lato", "Helvetica Neue", helvetica, sans-serif; -webkit-font-smoothing: antialiased; width: 100%; font-weight: 300; margin: 0; background-color: #eee'>

<table class="main" style='border-radius: 4px; font-size: 16px; color: #2f2936; border-collapse: separate; box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1); border-spacing: 0; max-width: 700px; font-family: "Lato", "Helvetica Neue", helvetica, sans-serif; border: 1px solid #c7d0d4; padding: 0; -webkit-font-smoothing: antialiased; width: 100%; font-weight: 300; margin: 15px auto; background-color: #fff'>
  <tr style="font-weight: 300">
    <td style="padding: 0; font-weight: 300; margin: 0; text-align: left">
      <div class="header" style="padding: 23px 0; font-size: 14px; font-weight: 300; border-bottom: 1px solid #dee7eb">


<div class="container" style="padding: 10px 20px; max-width: 600px; font-weight: 300; margin: 0 auto; text-align: left">

<table width="100%">
<tr>
<td width="50%"><img width="128px" src="https://backtrace.io/images/logo.png"></td>

<td width="100%" style="font-size: 14px; text-align: right">
<strong>Weekly summary for ` + href(self.project, 'title') + `</strong><br>
` + lastWeek + ` &mdash; ` + now + `
</td>
</tr></table>

</div></div>

<div class="container" style="padding: 10px 20px; max-width: 600px; font-weight: 300; margin: 0 auto; text-align: left">
`;

    self.events(function(result) {
      function weekHistogram(title, h, sum, scale_user) {
        var days = [
          'Sunday',
          'Monday',
          'Tuesday',
          'Wednesday',
          'Thursday',
          'Friday',
          'Saturday'
        ];
        var scale = 80;
        var colorMap = {};
        var colorIndex = 0;
        var i;
        var buffer = '';
        var divisor = 0;

        if (scale_user)
          scale = scale_user;

        buffer += '<h3>' + title + '</h3>';
        buffer += '<table style="width: 100%; height: ' + scale + 'px; font-weight: 300; table-layout: fixed; margin-bottom: 20px; border-collapse: collapse"><tr>';

        for (var i = 0; i < days.length; i++) {
          var bs = 0;

          if (h[i]) {
            for (var a in h[i]) {
              bs += h[i][a];
            }

            if (bs > divisor)
              divisor = bs;
          }
        }

        if (divisor === 0)
          divisor = 1;

        for (var i = 0; i < days.length; i++) {
          var height;
          var bs = 0;

          if (h[i]) {
            for (var a in h[i]) {
              bs += h[i][a];
            }
          }

          /* Scale height to total. */
          height = parseInt(bs / divisor * scale);
          if (bs > 0 && height < 5)
            height = 5;

          var element = `
<td valign="bottom" style="padding: 0 5px 0 0; width: 10%; font-weight: 300; margin: 0; text-align: left">
<table style="width: 100%; font-weight: 300; margin-bottom: 0; border-collapse: collapse">
<tr style="font-weight: 300"><td style="font-size: 0; padding: 0; margin: 0; line-height: 0;"></td></tr>
<tr style="font-weight: 300"><td class="box baseline" height="` + height + `px" style="font-size: 0; padding: 0; font-weight: 300; margin: 0; line-height: 0; background-color: #ffa07a; text-align: left">&#160;</td><center><small>` + bs + `</small></center></tr></table></td>`;

          buffer += element;
        }

        buffer += '</tr>';

        buffer += `
      <tr style="font-weight: 300">
          <td valign="top" class="label" style="font-size: 14px; color: #848296; padding: 10px 0 0; width: 14%; border-right: none; font-weight: 300; margin: 0; text-align: center">
            Sun
          </td>
        
          <td valign="top" class="label" style="font-size: 14px; color: #848296; padding: 10px 0 0; width: 14%; border-right: 10px solid #fff; font-weight: 300; margin: 0; text-align: center">
            Mon
          </td>
        
          <td valign="top" class="label" style="font-size: 14px; color: #848296; padding: 10px 0 0; width: 14%; border-right: 10px solid #fff; font-weight: 300; margin: 0; text-align: center">
            Tue
          </td>
        
          <td valign="top" class="label" style="font-size: 14px; color: #848296; padding: 10px 0 0; width: 14%; border-right: 10px solid #fff; font-weight: 300; margin: 0; text-align: center">
            Wed
          </td>
        
          <td valign="top" class="label" style="font-size: 14px; color: #848296; padding: 10px 0 0; width: 14%; border-right: 10px solid #fff; font-weight: 300; margin: 0; text-align: center">
            Thu
          </td>
        
          <td valign="top" class="label" style="font-size: 14px; color: #848296; padding: 10px 0 0; width: 14%; border-right: 10px solid #fff; font-weight: 300; margin: 0; text-align: center">
            Fri
          </td>
        
          <td valign="top" class="label" style="font-size: 14px; color: #848296; padding: 10px 0 0; width: 14%; border-right: 10px solid #fff; font-weight: 300; margin: 0; text-align: center">
            Sat
          </td>
      </tr></table>`;

        return buffer;
      }

      function topSummary(crashes, unique, hosts, title) {
        var buffer = '';
        var align = '';

        if (title) {
          buffer += '<span style="font-size: 16px; font-weight: 800">' + title + '</span><br>';
          align = 'valign="top"';
        }

        return '<td ' + align + 'width="25%" style="text-align: right; font-size: 20px; font-weight: 300; margin-top: 5px; margin-bottom: 5px">' + buffer + crashes + ' <small>crashes</small><br>' +
unique + ' <small>unique</small><br>' + hosts + ' <small>hosts</small>' + '</td>'
      }

      fs.writeFileSync('report.html',
        header +
        '<table><tr><td width="60%">' +
        weekHistogram('Errors seen last week',
          result.histogram.thisWeek,
          result.count.thisWeek)
        + '</td>' + topSummary(result.count.thisWeek, result.unique, result.hosts) +
        '</tr></table><h3>Trends</h3>' +
        /* Summary blocks. */
        '<table><tr>' +
        topSummary(result.count.priorWeek, result.uniquePrior, result.hostsPrior, 'Two weeks ago') +
        topSummary(result.count.quarter, result.uniqueQuarter, result.hostsQuarter, 'Last three months') + '<td>' +
        '<td style="padding-left: 20px; text-align: right">' +
        sumHistogram('',
          result.histogram.quarter,
          result.count.quarter, 70) + '</td>' +
        '</tr></table>'
      );

      /* Output an activity feed. */
      self.histograms(function(rc) {
        var tbuffer = '<h3>Summary</h3><table style="width: %100"><tr>';
        var total = 0;

        for (var ji = 0; ji < rc.length; ji++) {
          var r = new CRDB.Response(rc[ji]).unpack();
          var vh = r['*'];

          for (var hk in vh) {
            if (hk === 'count')
              continue;

            /* Construct a key-value object for plotting purposes. */
            var hd = {};
            for (var i = 0; i < vh[hk].length; i++) {
              var e = vh[hk][i];
              var le = e[0];

              if (!le || le.length === 0)
                le = "&mdash;";

              hd[le] = e[1];
            }

            if (i !== 0 && ((i % 2) == 0)) {
              tbuffer += '</tr><tr>';
            }

            var nr_s = hk.indexOf('(');
            var nr_e = hk.indexOf(')');
            var label = hk;

            if (nr_s >= 0 && nr_e >= 0 && nr_s < nr_e) {
              label = String(hk).substring(nr_s + 1, nr_e);
            }

            tbuffer += '<td valign="top" style="width: 50%; padding-right: 20px">';
            tbuffer += valueHistogram('Top ' + label, hd, 5);
            tbuffer += '</td>';
          }
        }

        if (i % 2)
          tbuffer += '</tr>';

        fs.appendFileSync('report.html',
          tbuffer +
        '<table style="width: 100%"><tr><td>' +
        '<h4 style="margin-bottom: 0">Classifier Summary</h4></td></tr><tr><td valign="top" style="width: 50%; border-right: 1px solid #dddddd; padding-right: 20px">' +
        valueHistogram('Last Week', result.histogram.classifiers, 5) +
        '</td><td valign="top" style="width: 50%; padding-right: 20px">' +
        valueHistogram('Last Quarter', result.histogram.quarterClassifiers, 5) +
        '</td></tr></table>');

        self.activity(null, function(result) {
          var buffer = renderGroup(result);

          fs.appendFileSync('report.html',
            '</div></div>' + '<table style="height: 1px; width: 100%; background-color: #dee7eb"></table>' +
            '<div class="container" style="padding: 10px 20px; max-width: 600px; font-weight: 300; margin: 0 auto; text-align: left">' +
            '<h3>Recent Activity</h3>' +
            buffer
          );
        });
      });

    });
  }
}

module.exports = Report;

//-- vim:ts=2:et:sw=2
