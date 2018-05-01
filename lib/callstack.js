function parseFrame(frame, options) {

  /* Templates are stripped by default. */
  frame = frame.replace(/<.*>/, "<…>");

  /* Dangling template is also stripped. */
  frame = frame.replace(/<.*/, "<…>");

  /* Strip parameters. */
  frame = frame.replace(/\(.*/, "");

  /* Now, split up the callstack label into class components. */
  var classes = frame.split('::');

  return classes;
}
 
function parse(frames) {
  var r = [];

  for (var i = 0; i < frames.length; i++) {
    r.push(parseFrame(frames[i]));
  }

  return r;
}

class Callstack {
  constructor(frames) {
    this.frames = frames;

    /* We will begin tokenization step now. */
    this.parsed = parse(frames);
  }

  render(options) {
    var self = this;
    var r = [];

    for (var i = 0; i < this.parsed.length; i++) {
      var frame = this.parsed[i];
      var label;

      /* If a limit is set on the class suffix, then use that. */
      if (options && options.suffix) {
        var begin = 0;

        if (frame.length >= options.suffix)
          begin = frame.length - options.suffix;

        label = '…::' + frame.slice(begin, frame.length).join('::');
      } else if (options && options.dynamic && i > 1) {
        var previous = this.parsed[i - 1];

        label = '';

        for (var k = 0; k < frame.length; k++) {
          if (k < previous.length && previous[k] === frame[k]) {
            label += '…';
          } else {
            label += frame[k];
          }

          if (k != frame.length - 1)
            label += '::';
        }
      } else {
        label = frame.join('::');
      }

      r.push(label);
    }

    return r;
  }
}

module.exports = Callstack;

//-- vim:ts=2:et:sw=2
