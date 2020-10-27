
/*
 * Error handling helpers.
 */

 function err(msg) {
  if (msg) {
    var m = msg.toString();
    if (m.slice(0, 5) !== "Error")
      m = "Error: " + m;
    console.log(m.error);
  } else {
    console.log("Unknown error occured.".error);
  }
  return false;
}

function errx(errobj, opts) {
  if (typeof errobj === 'object' && errobj.message) {
    if (typeof opts === 'object' && opts.debug)
      console.log("err = ", errobj);
    err(errobj.message);
  } else {
    err(errobj);
  }
  process.exit(1);
}

module.exports = { err, errx };
