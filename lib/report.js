#!/usr/bin/env node

const CRDB = require('../lib/crdb.js');
const fs = require('fs');
const moment = require('moment');

'use strict';

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
  constructor(coroner, options) {
    this.options = options;
    this.coroner = coroner;
    this.universe = 'beeswax';
    this.project = 'fes';
  }

  /* Extract event counts for last week and month. */
  activity(limit, cb) {
    var self = this;
    const now = parseInt(Date.now() / 1000);
    const lastWeek = now - (24 * 3600 * 7);
    var query = {};

    query.filter = [];
    query.filter.push({
      'timestamp': [
        [ 'at-least', lastWeek ]
      ]
    });
    query.fold = { 'timestamp' : [['range']] };

    query.template = "unique";
    self.coroner.query(self.universe, self.project, query, function(error, result) {
      var results = new CRDB.Response(result.response).unpack();
      var sorted = [];

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
      var uniqueWeek = {};
      var quarterCount = [];
      var lastWeekCount = [];
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

        /* Do not include data from today. */
        if (results[i].timestamp >= today)
          continue;

        eventsInc(quarterCount, day, application);
        classifiersInc(quarterClassifierCount, results[i].classifiers);

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
          lastWeekSum++;
        }
      }

/*
      console.log('-- This last quarter');
      console.log(quarterCount);
      console.log(quarterClassifierCount);
      console.log('-- Week before last week');
      console.log(lastWeekCount);
      console.log(lastWeekSum);
      console.log('-- This last week');
      console.log(weekCount);
      console.log(weekSum);
      console.log(classifierCount);
      console.log('--');
*/

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
          'thisWeek' : weekSum
        },
        'hosts' : Object.keys(hostsWeek).length,
        'unique' : Object.keys(uniqueWeek).length
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

      h4 {
        text-align: center !important;
      }

      .box {
        background-color: #6C5FC7 !important;
      }

      .header td {
        text-align: center !important;
      }
    }
  </style>
</head>
<body class="" style='font-size: 16px; color: #2f2936; padding: 0; font-family: "Lato", "Helvetica Neue", helvetica, sans-serif; background-image: url(none); -webkit-font-smoothing: antialiased; width: 100%; font-weight: 300; margin: 0; background-color: #eee'>

<table class="main" style='border-radius: 4px; font-size: 16px; color: #2f2936; border-collapse: separate; box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1); border-spacing: 0; max-width: 700px; font-family: "Lato", "Helvetica Neue", helvetica, sans-serif; border: 1px solid #c7d0d4; padding: 0; -webkit-font-smoothing: antialiased; width: 100%; font-weight: 300; margin: 15px auto; background-color: #fff'>
  <tr style="font-weight: 300">
    <td style="padding: 0; font-weight: 300; margin: 0; text-align: left">
      <div class="header" style="padding: 23px 0; font-size: 14px; font-weight: 300; border-bottom: 1px solid #dee7eb">


<div class="container" style="padding: 10px 20px; max-width: 600px; font-weight: 300; margin: 0 auto; text-align: left">

<table width="100%">
<tr>
<td width="50%"><img width="128px" src="https://backtrace.io/images/logo.png"></td>

<td width="100%" style="font-size: 14px; text-align: right">
<strong>Weekly summary for ` + self.project + `</strong><br>
` + lastWeek + ` &mdash; ` + now + `
</td>
</tr></table>

</div></div>

<div class="container" style="padding: 10px 20px; max-width: 600px; font-weight: 300; margin: 0 auto; text-align: left">
`;

    self.events(function(result) {
      function valueHistogram(title, h, limit) {
        var buffer = '';
        var scale = 64;
        var sorted = [];

        buffer += '<h5 style="text-align: right">' + title + '</h5>';
        buffer += '<table class="graph" style="width: 100%; font-size: 14px; font-weight: 300; table-layout: fixed; margin-bottom: 20px; border-collapse: collapse">';

        for (var k in h)
          sorted.push([k, h[k]]);

        sorted.sort(function(a, b) {
          return (a[1] < b[1]) - (a[1] > b[1]);
        });

        for (var i = 0; i < sorted.length; i++) {
          buffer += '<tr>';
          buffer += '<td style="text-align: right; padding-right: 20px">' + sorted[i][0] + '</td><td style="text-align: right">' + sorted[i][1] + '</td>';
          buffer += '</tr>';

          if (limit && i === limit - 1) {
            buffer += '<tr><td></td><td style="text-align: right"><small>... and more</small></td></tr>';
            break;
          }
        }

        /* Translate into a sorted array. */
        buffer += '</table>';

        return buffer;
      }

      function weekHistogram(title, h, sum) {
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

        buffer += '<h3>' + title + '</h3>';
        buffer += '<table class="graph" style="width: 100%; height: ' + scale + 'px; font-weight: 300; table-layout: fixed; margin-bottom: 20px; border-collapse: collapse"><tr>';

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
<table class="box" style="width: 100%; font-weight: 300; margin-bottom: 0; border-collapse: collapse">
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

      function topSummary(result) {
        return '<td width="30%" style="text-align: right; font-size: 24px; font-weight: 300; margin-top: 5px; margin-bottom: 5px">' + result.count.thisWeek + ' <small>crashes</small><br>' +
result.unique + ' <small>unique</small><br>' +
result.hosts + ' <small>hosts</small>' + 
'</td>'

      }

      fs.writeFileSync('report.html',
        header +
        '<table><tr><td width="60%">' +
        weekHistogram('Errors seen last week',
          result.histogram.thisWeek,
          result.count.thisWeek)
        + '</td>' + topSummary(result) + '</tr></table>' +
        '<table style="width: 100%"><tr><td>' +
        '<h4 style="margin-bottom: 0">Classifier Summary</h4></td></tr><tr><td valign="top" style="width: 50%; border-right: 1px solid #dddddd; padding-right: 20px">' +
        valueHistogram('Last Week', result.histogram.classifiers, 5) +
        '</td><td valign="top" style="width: 50%; padding-right: 20px">' +
        valueHistogram('Last Quarter', result.histogram.quarterClassifiers, 5) +
        '</td></tr></table>'
      );

      /* Output an activity feed. */
      self.activity(null, function(result) {
        var buffer = '';

        fs.appendFileSync('report.html',
          '</div></div>' + '<table style="height: 1px; width: 100%; background-color: #dee7eb"></table>' +
          '<div class="container" style="padding: 10px 20px; max-width: 600px; font-weight: 300; margin: 0 auto; text-align: left">' +
          '<h3>Recent Activity</h3>' +
          buffer
        );
      });

    });
  }
}

module.exports = Report;

//-- vim:ts=2:et:sw=2
