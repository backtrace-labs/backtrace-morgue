'use strict';

var colors = require('colors');

/*
 * Shift data range to a new range according to middle points
 * of provided bins.
 */
function remap(data, start, stop) {
  var step;
  var r = [];
  var i;

  start = Math.floor(start);
  stop = Math.ceil(stop);

  step = (stop - start) / 32;

  for (i = 0; i < 32; i++) {
    r.push([start, start + i * step, 0]);
  }

  for (i = 0; i < data.length; i++) {
    var middle, offset;

    if (data[i][0] < start) continue;

    middle = (data[i][0] + data[i][1]) / 2;
    offset = Math.floor((middle - start) / step);
    r[offset][2] += data[i][2];
  }

  return r;
}

function bar(data, start, stop) {
  var i;
  var glyph = ['\u2581'.grey, '\u2581'.blue, '\u2582'.blue, '\u2583'.blue, '\u2584'.yellow, '\u2585'.yellow, '\u2586'.yellow, '\u2587'.red, '\u2588'.red];
  var ceiling = 0;
  var output = '';
  var step;

  /*
   * If a custom time range has been provided, then data may require
   * a remap.
    */
  if (start) {
    data = remap(data, start, stop);
  }

  step = data[0][1] - data[0][0];
  for (i = 0; i < data.length; i++) {
    if (data[i][2] > ceiling) ceiling = data[i][2];
  }

  for (i = 0; i < data.length; i++) {
    var offset;

    if (data[i][2] == 0) {
      offset = 0;
    } else {
      offset = data[i][2] / ceiling;
      offset = Math.floor(offset * (glyph.length - 1));
      if (offset == 0 && data[i][2] > 0) offset = 1;
    }

    output += glyph[offset];
  }

  process.stdout.write(output);
}

module.exports = bar;
//-- vim:ts=2:et:sw=2