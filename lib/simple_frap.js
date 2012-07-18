var log = console.log
  , EventEmitter = require('events').EventEmitter
  , util = require('util')
  , assert = require('assert')
  , format = util.format
  , inspect = util.inspect
  , Dequeue = require('dequeue')
  , u = require('underscore')

function _concat(bufs) {
  var tot=0, i, nbuf, off=0

  for (i=0; i<bufs.length; i++) { tot += bufs[i].length }

  nbuf = new Buffer(tot)
  for (i=0; i< bufs.length; i++) {
    bufs[i].copy(nbuf, off)
    off += bufs[i].length
  }

  return nbuf
}

var concat = Buffer.hasOwnProperty('concat') ? Buffer.concat : _concat

var INIT_PARSER_STATE = 
{ state   : 'frame'   //'frame', 'data', 'header'
, hdrbuf  : undefined //partial header buffer only valid in 'header' state
, framelen: undefined //framelen for current receiveing frame
, pos     : 0         //current position in the frame
, nreads  : 0         //number of 'data' events for current frame
, buffer  : undefined //current Buffer being parsed
, bufidx  : 0 }       //index into current Buffer

var SimpleFrap = function SimpleFrap(sk) {
  EventEmitter.call(this)

  this.sk = sk
  this.ps  = u.clone(INIT_PARSER_STATE)
  this.frame = { framelen: 0, bufs: [] }

  this.draining = false
  this.writing = false

  var self = this

  function onSkData(buf) {
    if (SimpleFrap.VERBOSE) log("Frap: onSkData: state=%s; buf.length=%d;", self.ps.state, buf.length)
    self._parse(buf)
  }

  function onSkError(err) {
    if (SimpleFrap.VERBOSE) log("Frap: onSkError:", err)
    self.emit('error', err)
    self.destroy()
  }

  //listen to socket 'data', 'end', 'error', and 'close'
  this.sk_listeners = {
    'data'  : onSkData
  , 'error' : onSkError
  }

  Object.keys(this.sk_listeners).forEach(function(k){
    self.sk.on(k, self.sk_listeners[k])
  })

}
SimpleFrap.VERBOSE = 0

util.inherits(SimpleFrap, EventEmitter)

exports = module.exports = SimpleFrap.SimpleFrap = SimpleFrap

SimpleFrap.prototype.sendFrame = function(buf) {
  var self = this
    , hdrbuf = new Buffer(4)

  hdrbuf.writeUInt32BE(buf.length,0)
  this.sk.write(hdrbuf)

  sent = this.sk.write(buf)
  if (!sent && !this.draining) {
    this.draining = true
    this.sk.once('drain', function(){
      self.draining = false
      self.emit('drain')
    })
  }

  return sent
}

SimpleFrap.prototype._submit = function(event, arg1, arg2) {
  if (SimpleFrap.VERBOSE) log("SimpelFrap._submit: event=%s; arg1=%s; arg2=%s;", event, arg1, arg2)

  switch (event) {
    case 'header':
      if (SimpleFrap.VERBOSE) log("SimpleFrap._submit: header: framelen=%d", arg1)
      this.frame.framelen = arg1
      break;
    case 'part':
      var pbuf = arg1
        , pos = arg2
      //this.emit('part', pbuf, pos)
      if (SimpleFrap.VERBOSE) log("SimpleFrap._submit: part: pbuf.length=%d; pos=%d;", pbuf.length, pos)
      assert(Buffer.isBuffer(pbuf), "SimpleFrap._submit: pbuf must be a buffer")
      this.frame.bufs.push(pbuf)
      if (pos+pbuf.length === this.frame.framelen) {
        var buf = concat(this.frame.bufs, this.frame.framelen)
        this.emit('frame', buf)
        this.emit('data', buf)
        this.frame.framelen = 0
        this.frame.bufs = []
      }
      break;
    default:
      throw new Error(format("_dispatch: Unknown event %s", event))
  }

}

//Parser Routines
//
SimpleFrap.prototype._parse = function SimpleFrap___parse(buf) {
  assert(Buffer.isBuffer(buf), "WTF! buf not a Buffer")
  this.ps.nreads += 1
  this.ps.buffer = buf
  this.ps.bufidx = 0

  while (this.ps.buffer && this.ps.bufidx < this.ps.buffer.length) {
    switch (this.ps.state) {
      case 'frame':
        this._parseFrame()
        break;
      case 'data':
        this._parseData()
        break;
      case 'header':
        this._parseHeader()
        break;
      default:
        throw new Error("WTF! unknown state '"+this.ps.state+"'")
    } //switch
  } //while
}

SimpleFrap.prototype._parseHeader = function SimpleFrap___parseHeader() {
  var need = 4 - this.ps.hdrbuf.length
    , nbuf
  if (SimpleFrap.VERBOSE) log("SimpleFrap___parseHeader; need=%d; got=%d;", need, this.ps.buffer.length)
  if (this.ps.buffer.length >= need) {
    nbuf = new Buffer(4)
    this.ps.hdrbuf.copy(nbuf)
    this.ps.buffer.copy(nbuf, this.ps.hdrbuf.length, 0, need)
    this.ps.bufidx += need
    this.ps.framelen = nbuf.readUInt32BE(0)
    this._submit('header', this.ps.framelen)
    this.ps.state = 'data'
  }
  else {
    nbuf = new Buffer(this.ps.hdrbuf.length + this.ps.buffer.length)
    this.ps.hdrbuf.copy(nbuf)
    this.ps.buffer.copy(nbuf, this.ps.hdrbuf.length)
    this.ps.hdrbuf = nbuf
    this.ps.buffer = undefined
  }
}

SimpleFrap.prototype._parseFrame = function SimpleFrap___parseFrame() {
  if (this.ps.buffer.length-this.ps.bufidx < 4) {
    if (SimpleFrap.VERBOSE) log("SimpleFrap___parseFrame: ps.buffer.length-ps.bufidx < 4; ps.buffer.length=%d; ps.bufidx=%d;", this.ps.buffer.length, this.ps.bufidx)
    //current buffer is not even big enough to contain the frame hdr
    this.ps.state = "header"
    this.ps.hdrbuf = new Buffer(this.ps.buffer.length-this.ps.bufidx)
    this.ps.buffer.copy(this.ps.hdrbuf, 0, this.ps.bufidx)
    this.ps.buffer = undefined
    return
  }
  
  this.ps.framelen = this.ps.buffer.readUInt32BE(this.ps.bufidx)
  this.ps.bufidx += 4
  var datalen = this.ps.buffer.length - this.ps.bufidx

  if (SimpleFrap.VERBOSE) log("SimpleFrap___readFrame: datalen=%d; framelen=%d;", datalen, this.ps.framelen)

  this._submit('header', this.ps.framelen)

  var pbuf
  if (datalen === this.ps.framelen) { //complete the frame
    if (SimpleFrap.VERBOSE) log("SimpleFrap___readFrame: datalen === framelen; %d === %d", datalen, this.ps.framelen)

    pbuf = this.ps.buffer.slice(this.ps.bufidx)
    this.ps.bufidx += datalen
    this._submit('part', pbuf, this.ps.pos)

    //this.ps.state    = 'frame'
    //this.ps.hdrbuf   = undefined
    this.ps.framelen = undefined
    this.ps.pos      = 0
    this.ps.nreads   = 0
  }
  else if (datalen > this.ps.framelen) { //complete the frame
    if (SimpleFrap.VERBOSE) log("SimpleFrap___readFrame: datalen > framelen; %d > %d", datalen, this.ps.framelen)

    pbuf = this.ps.buffer.slice(this.ps.bufidx, this.ps.bufidx+this.ps.framelen)
    this.ps.bufidx += this.ps.framelen
    this._submit('part', pbuf, this.ps.pos)

    //this.ps.header   = 'frame'
    //this.ps.hdrbuf   = undefined
    this.ps.framelen = undefined
    this.ps.pos      = 0
    this.ps.nreads   = 0
  }
  else if (datalen < this.ps.framelen) { //frame not fully received
    if (SimpleFrap.VERBOSE) log("SimpleFrap___readFrame: datalen < framelen; %d < %d", datalen, this.ps.framelen)

    if (datalen > 0) {
      pbuf = this.ps.buffer.slice(this.ps.bufidx)
      this.ps.bufidx += datalen //or pbuf.length
      this._submit('part', pbuf, 0)
    }

    this.ps.state    = 'data'
    //this.ps.hdrbuf   = undefined
    //this.ps.framelen = framelen
    this.ps.pos      = datalen
    //this.ps.nreads   = 0
  }
}

SimpleFrap.prototype._parseData = function SimpleFrap___parseData() {
  var rem = this.ps.framelen - this.ps.pos

  var datalen = this.ps.buffer.length - this.ps.bufidx
    , pbuf

  if (datalen === rem) { //complete the frame
    if (SimpleFrap.VERBOSE) log("SimpleFrap___readData: datalen === rem; %d === %d", datalen, rem)

    pbuf = this.ps.buffer.slice(this.ps.bufidx, this.ps.bufidx+rem)
    this.ps.bufidx += rem
    this._submit('part', pbuf, this.ps.pos)

    this.ps.state    = 'frame'
    //this.ps.hdrbuf   = undefined
    this.ps.framelen = undefined
    this.ps.pos      = 0
    this.ps.nreads   = 0
  }
  else if (datalen > rem) { //complete the frame
    if (SimpleFrap.VERBOSE) log("SimpleFrap___readData: datalen > rem; %d > %d", datalen, rem)

    var pbuf = this.ps.buffer.slice(this.ps.bufidx, this.ps.bufidx+rem)
    this.ps.bufidx += rem
    this._submit('part', pbuf, this.ps.pos)

    this.ps.state    = 'frame'
    //this.ps.hdrbuf   = undefined
    this.ps.framelen = undefined
    this.ps.pos      = 0
    this.ps.nreads   = 0
  }
  else if (datalen < rem) {
    if (SimpleFrap.VERBOSE) log("SimpleFrap___readData: datalen < rem; %d < %d", datalen, rem)

    pbuf = this.ps.buffer.slice(this.ps.bufidx, this.ps.bufidx+datalen)
    this.ps.bufidx += datalen
    this._submit('part', pbuf, this.ps.pos)
    this.ps.bufidx += datalen //really does not matter

    //this.ps.state    = 'data' //staying the same
    //this.ps.hdrbuf   = undefined
    //this.ps.framelen = framelen
    this.ps.pos += datalen
    //this.ps.nreads   = 0
  }
}
