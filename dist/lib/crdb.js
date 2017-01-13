"use strict";

var _createClass = function () { function defineProperties(target, props) { for (var i = 0; i < props.length; i++) { var descriptor = props[i]; descriptor.enumerable = descriptor.enumerable || false; descriptor.configurable = true; if ("value" in descriptor) descriptor.writable = true; Object.defineProperty(target, descriptor.key, descriptor); } } return function (Constructor, protoProps, staticProps) { if (protoProps) defineProperties(Constructor.prototype, protoProps); if (staticProps) defineProperties(Constructor, staticProps); return Constructor; }; }();

function _classCallCheck(instance, Constructor) { if (!(instance instanceof Constructor)) { throw new TypeError("Cannot call a class as a function"); } }

var Response = function () {
  /**
   * This instantiates a coroner object associated with the specified
   * end-point.
   */
  function Response(json) {
    _classCallCheck(this, Response);

    if (json.error) this.json = {};

    this.json = json;
  }

  _createClass(Response, [{
    key: 'unpackObject',
    value: function unpackObject() {
      var i;
      var json = this.json;
      var result = {};

      /*
       * The first step is to construct object arrays. This is a sequence of
       * arrays whose first element is group identifier.
       */
      for (i = 0; i < json.objects.length; i++) {
        var object = json.objects[i];
        var label = object[0];
        var rle = object[1];
        var target;
        var order = [];
        var j;

        if (result[label] === undefined) {
          target = result[label] = [];
        }

        /*
         * We expect a sequence of tuples consisting of a base and then sequence
         * length.
         */
        for (j = 0; j < rle.length; j++) {
          target.push({ 'object': rle[j][0] });

          if (rle[j].length === 2) {
            var k;

            /*
             * If run-length is provided, then materialize those objects.
             */
            for (k = 1; k <= rle[j][1]; k++) {
              target.push({ 'object': rle[j][0] + k });
            }
          }
        }
      }

      /*
       * At this point, the full object table has been constructed. Now we walk
       * through the values array. Values are also RLE-encoded by default,
       * and are attributed in object order.
       */
      for (i = 0; i < json.values.length; i = i + json.columns.length) {
        var j;

        for (j = 0; j < json.columns.length; j++) {
          var label = json.columns[j % json.columns.length][0];
          var key = json.values[i + j][0];
          var values = json.values[i + j];
          var counter = 0;
          var k;

          if (result[key] === undefined) {
            console.log('Unknown key: ' + key);
            continue;
          }

          for (k = 1; k < values.length; k++) {
            var base = values[k][0];
            var r;

            for (r = 0; r < values[k][1]; r++) {
              result[key][counter][label] = base;
              counter++;
            }
          }
        }
      }

      return result;
    }
  }, {
    key: 'fields',
    value: function fields() {
      var i;

      if (this._fields) return this._fields;

      this._fields = {};

      for (i = 0; i < this.json.columns.length; i++) {
        this._fields[this.json.columns[i][0]] = this.json.columns[i][1];
      }return this._fields;
    }

    /**
     * If object projection is occurring then cache per-column RLE
     * state.
     */

  }, {
    key: 'unpack',
    value: function unpack() {
      var result = {};
      var i, cursor;

      /*
       * If the objects array exists then object materialization is requested.
       */
      if (this.json.objects) return this.unpackObject();

      /* Now we extract every column value. */
      for (i = 0; i < this.json.values.length; i++) {
        var field = this.json.values[i];
        var factor = field[0];
        var j;
        var count = null;

        if (field.length > 2) {
          count = field[2];
        }

        if (result[factor] === undefined) {
          result[factor] = {};
          if (count) result[factor].count = count;
        }

        for (j = 0; j < this.json.columns.length; j++) {
          var label = this.json.columns[j][0];
          result[factor][label] = field[1][j];
        }
      }

      return result;
    }
  }, {
    key: 'row',
    value: function row(id) {
      var length = this.json.columns.length;
      var row = this.json.values[id];
      var result = {};
      var i;

      for (i = 0; i < length; i++) {
        var label = this.json.columns[i];

        if (this.json.columns[i].startsWith('unique(') === true) {
          result[label] = row[1][i][0];
        } else {
          result[label] = row[1][i];
        }
      }

      return [row[0], result];
    }
  }, {
    key: 'count',
    get: function get() {
      return this.json.objects.length;
    }
  }]);

  return Response;
}();

module.exports.Response = Response;

//-- vim:ts=2:et:sw=2