/* globals Buffer */

var Dequeue = require('dequeue')
  , util = require('util')
  , format = util.format
  , Stream = require('stream')
  , assert = require('assert')
  , u = require('underscore')

function _concat(bufs, len) {
  if (bufs.length === 0) return new Buffer(0)
  if (bufs.length === 1) return bufs[0]

  var nbuf = new Buffer(len)

  for (var i=0, npos=0; i<bufs.length; npos += bufs[i++].length)
    bufs[i].copy(nbuf, npos)

  return nbuf
}

var concat = Buffer.hasOwnProperty('concat') ? Buffer.concat : _concat

exports = module.exports = FrapReader

var DEFAULT_OPTIONS = { emit: 'data' }

function FrapReader(opt) {
  Stream.call(this)

  opt = u.defaults(opt||{}, DEFAULT_OPTIONS)

  if (toString.call(opt) === '[object Object]' && opt.emit &&
      (opt.emit === 'data' || opt.emit === 'frame' || opt.emit === 'basic'))
    this.emit_level = opt.emit
  else
    this.emit_level = FrapReader.DEFAULT_EMIT_LEVEL

  //reader state
  this.paused = false
  this.parsedq = new Dequeue()

  //parser state
  this.p = {}
  this.p.flen = 0 //frame length
  this.p.hpos = 0 //current position in the header
  this.p.fpos = 0 //current position in the frame

  var self = this, bufs=[]
  switch(this.emit_level) {
    case 'data':
    this.on('frame', function(bufs, framelen){
      if (self.listeners('data').length > 0) {
        //micro-optimization to avoid concat
        var buf = concat(bufs, framelen)
        if (self.defaultEncoding)
          self.emit('data', buf.toString(self.defaultEncoding))
        else
          self.emit('data', buf)
      }
    })
    //fallthru intentionally
    case 'frame':
    this.on('part', function(pbuf, pos, framelen){
      bufs.push(pbuf)
      if (pos + pbuf.length === framelen) {
        self.emit('frame', bufs, framelen)
        bufs = []
      }
    })
  }
}

util.inherits(FrapReader, Stream)

var _default_emit_level = 'basic'
Object.defineProperty(FrapReader, 'DEFAULT_EMIT_LEVEL',
                      { get: function() { return _default_emit_level }
                      , set: function(v) {
                          if (v==='data' || v==='frame' || v==='basic')
                            _default_emit_level = v
                          return _default_emit_level
                        }
                      })

//Parser Routine
//
FrapReader.prototype.digest = function digest(buf) {
  this.parse(buf)
  if (this.paused) return false
  return this.dispatch()
}

FrapReader.prototype.parse = function parse(buf) {
  var idx = 0

  while (idx < buf.length) {
    switch (this.p.hpos) { //header is big-endian uint32
      case 0:
      this.p.flen |= buf[idx] << 24
      this.p.hpos += 1
      idx += 1
      break;

      case 1:
      this.p.flen |= buf[idx] << 16
      this.p.hpos += 1
      idx += 1
      break;

      case 2:
      this.p.flen |= buf[idx] << 8
      this.p.hpos += 1
      idx += 1
      break;

      case 3:
      this.p.flen |= buf[idx]
      this.p.hpos += 1
      idx += 1

      this._submit('header', this.p.flen)
      if (this.p.flen === 0) { //support zero-length frames
        this._submit('part', 0, new Buffer(0), 0)
        this.p.hpos = 0
      }
      break;

      default:
      var pbuf
        , rem = this.p.flen - this.p.fpos //remainder of frame
        , rst = buf.length - idx          //rest of buffer
        , len = rem < rst ? rem : rst

      pbuf = buf.slice(idx, idx+len)
      this._submit('part', this.p.flen, pbuf, this.p.fpos)

      this.p.fpos += len
      idx += len

      assert.ok(this.p.fpos <= this.p.flen, format("NOT %d <= %d", this.p.fpos, this.p.flen))
      if (this.p.fpos === this.p.flen) {
        this.p.flen = 0
        this.p.hpos = 0
        this.p.fpos = 0
      }
    } //switch
  } //while

  //return ??
} //parse

//Event Routines
//
FrapReader.prototype._submit = function _submit(event, framelen, pbuf, pos) {
  // when event == 'header' pbuf and pos are undefined
  this.parsedq.push([event, framelen, pbuf, pos])
  return
}

FrapReader.prototype.dispatchOne = dispatchOne
function dispatchOne(event, framelen, pbuf, pos) {
  switch (event) {
    case 'header':
    this.emit('header', framelen)
    break;

    case 'part':
    this.emit('part', pbuf, pos, framelen)

    //HACK ALERT!!!
    // need a way outside of 'part' event to signal that a frame is complete
    // but immediately after that last 'part' event
    if (pbuf.length+pos === framelen) this.emit('fin')

    break;

    default:
    throw new Error("dispatch: Unknown event "+ event)
  }
}

FrapReader.prototype.dispatch = function dispatch() {
  if (this.paused) return false

  while (this.parsedq.length > 0) {
    var evt = this.parsedq.shift()
      , event    = evt[0]
      , framelen = evt[1]
      , pbuf     = evt[2]
      , pos      = evt[3]

    this.dispatchOne(event, framelen, pbuf, pos)

    //someone could pause the reader during an emit() call
    if (this.paused) break
  }

  //if everything dispatched return true
  return this.parsedq.length === 0
}

//Stream Routines
//

FrapReader.prototype.setEncoding = function (encoding) {
  this.defaultEncoding = encoding
}

FrapReader.prototype.write = function (buf, enc) {
  if (toString.call(buf) === '[object String]') {
    buf = new Buffer(buf, enc)
  }
  assert(Buffer.isBuffer(buf), "arg to write() must be a Buffer")
  return this.digest(buf)
}

FrapReader.prototype.pause = function() {
  this.paused = true
}

FrapReader.prototype.resume = function() {
  this.paused = false
  var emptied = this.dispatch()
  //if (!emptied) this.paused = true
  return emptied
}
