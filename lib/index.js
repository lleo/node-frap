
var Frap = require('./frap')
//merge(exports, frap)
exports = module.exports = Frap
exports.Channel = require('./channel').Channel
exports.SimpleFrap = require('./simple_frap').SimpleFrap


/**
 * Merge object b with object a.
 *
 *     var a = { foo: 'bar' }
 *       , b = { bar: 'baz' }
 *     
 *     utils.merge(a, b)
 *     // => { foo: 'bar', bar: 'baz' }
 *
 * @param {Object} a
 * @param {Object} b
 * @return {Object}
 * @api public
 */
function merge(a, b){
  if (a === b) return
  if (a === null || typeof(a) !== 'object' ||
      b === null || typeof(b) !== 'object'    ) return
  
  Object.keys(b).forEach(function(k){
    if (!a.hasOwnProperty(k)) {
      a[k] = b[k]
    }
  })
  return a
}
