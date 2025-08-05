export interface CallstackOptions {
  suffix?: number;
  dynamic?: boolean;
}

function parseFrame(frame: string, options?: any): string[] {
  /* Templates are stripped by default. */
  frame = frame.replace(/<.*>/, "<…>");

  /* Dangling template is also stripped. */
  frame = frame.replace(/<.*/, "<…>");

  /* Strip parameters. */
  frame = frame.replace(/\(.*/, "");

  /* Now, split up the callstack label into class components. */
  const classes = frame.split('::');

  return classes;
}
 
function parse(frames: string[]): string[][] {
  const r: string[][] = [];

  for (let i = 0; i < frames.length; i++) {
    r.push(parseFrame(frames[i]));
  }

  return r;
}

export class Callstack {
  frames: string[];
  parsed: string[][];

  constructor(frames: string[]) {
    this.frames = frames;

    /* We will begin tokenization step now. */
    this.parsed = parse(frames);
  }

  render(options?: CallstackOptions): string[] {
    const r: string[] = [];

    for (let i = 0; i < this.parsed.length; i++) {
      const frame = this.parsed[i];
      let label: string;

      /* If a limit is set on the class suffix, then use that. */
      if (options && options.suffix) {
        let begin = 0;

        if (frame.length > options.suffix) {
          begin = frame.length - options.suffix;
          label = '…::' + frame.slice(begin, frame.length).join('::');
        } else {
          label = frame.join('::');
        }
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

//-- vim:ts=2:et:sw=2
