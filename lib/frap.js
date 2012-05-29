var events = require('events')
  , util = require('util')
  , assert = require('assert')
  , log = console.log
  , format = util.format
  , frap_stream = require('./frap_stream')

var Frap = exports.Frap = function Frap(sk, emit_partials) {
  events.EventEmitter.call(this)
  this.socket = sk
  //this._cur_recv = {state: "frame", buffer: undefined, sofar: 0}
  
  Object.defineProperty(this, 'emit_partials', {
    value: emit_partials ? true : false
  })
  Object.defineProperty(this, 'sk', { value: sk })
  Object.defineProperty(this, 'socket', { get: function(){ return this.sk } })
  Object.defineProperty(this, 'id', {
    get: function() {
      return "Frap<"
        + this.socket.remoteAddress
        + ":"
        + this.socket.remotePort
        + ">"
    }
  })

  this.socket.on("data", onData.bind(this))
}

util.inherits(Frap, events.EventEmitter)

Frap.prototype.startFrame = function Frap__startFrame(framelen) {
  if (this._stream)
    throw new Error("in the middle of sending another frame")

  this._stream = new FrapStream(this, framelen)

  return this._stream
}

// sendFrame(buf0, buf1, ..., bufN)
Frap.prototype.send = function send() {
  var bufs;
  if (arguments.length === 0) return
  if (arguments.length === 1 && Array.isArray(arguments[0])) {
    log("bufs is an array")
    bufs = arguments[0]
  }
  else {
    log("bufs is arguments")
    //bufs = Array.prototype.slice.call(arguments)
    bufs = arguments
  }
  
  var tot = 0
  for (var i=0; i<bufs.length; i++) {
    assert.ok(bufs[i] instanceof Buffer)
    tot += bufs[i].length
  }

  log("tot =", tot)
  var hdrbuf = new Buffer(4)
  hdrbuf.writeUInt32BE(tot, 0)
  
  this.socket.write(hdrbuf)

  for (i=0; i<bufs.length; i++) {
    this.socket.write(bufs[i])
  }
}

Frap.prototype.sendHeader = function sendHeader(framelen) {
  if (this._cur_send)
    throw new Error("in the middle of sending another frame")

  this._cur_send = {framelen: framelen, sofar: 0}

  var wbuf = new Buffer(4)

  wbuf.writeUInt32BE(framelen, 0)

  this.socket.write(wbuf)

  return false
}

Frap.prototype.sendPartial = function sendPartial(buf) {
  if (!this._cur_send)
    throw new Error("have not sent header yet")

  if (this._cur_send.sofar + buf.length > this._cur_send.framelen) {
    throw new Error(format("sendPartial: trying to send to much data framelen=%d; sofar+buflen=%d;", this._cur_send.framelen, this._cur_send.sofar + buf.length))
  }

  this.socket.write(buf)

  this._cur_send.sofar += buf.length

  if (this._cur_send.framelen === this._cur_send.sofar) {
    //finished
    delete this._cur_send
    return true
  }
  return false
}

Frap.prototype.createWriteStream =
function Frap__createWriteStream(framelen) {
  this.sendHeader(framlen)
  return new frap_stream.WFrameStream(this, framelen)
}

Frap.prototype.createReadStream =
function Frap__createReadStream(framelen) {
  return new frap_stream.RFrameStream(this, framelen)
}

function onData(buf) {
  //log(format("onData: this._cur_recv.state=%s; buf.length=%d;",
  //    this._cur_recv.state, buf.length))
  if (!this._cur_recv) {
    this._cur_recv = {
      state: "frame"
    , buffer: undefined
    , stream: undefined
    , sofar: 0
    , nreads: 0}
  }
  this._cur_recv.nreads += 1
  switch (this._cur_recv.state) {
    case "frame":
      this.readFrame(buf)
      break;
    case "data":
      this.readData(buf)
      break;
    case "header":
      this.readHeader(buf)
    default:
      throw new Error("unknown state '"+this._cur_recv.state+"'")
      break;
  }
}

Frap.prototype.readHeader = function Frap__readHeader(buf) {
  var nbuf = new Buffer(this._cur_recv.buffer.length + buf.length)
  this._cur_recv.buffer.copy(nbuf) //1, 2, or 3 bytes copied
  buf.copy(nbuf, this._cur_recv.buffer.length)
  delete this._cur_recv
  this.readFrame(nbuf)
}

Frap.prototype.readFrame = function Frap__readFrame(buf, off) {
  off = !off ? 0 : off

  if (buf.length-off < 4) { //it is not even big enough to contain the frame hdr
    this._cur_recv.buffer = buf
    this._cur_recv.state = "header"
    return
  }
  
  var framelen = buf.readUInt32BE(off)
    , nbuf = new Buffer(framelen)
    , datalen = buf.length - off - 4

  //log(format("readFrame: datalen=%d; framelen=%d; off=%d;",
  //            datalen, framelen, off))

  this._rstream = this.createReadStream(framelen)
  this.emit('frame', this._rstream, framelen)

  var pbuf
  if (datalen === framelen) { //whole frame came in first read
    //log(format("datalen === framelen; %d === %d", datalen, framelen))
    buf.copy(nbuf, 0, off+4) //copy datalen from buf to nbuf

    pbuf = buf.slice(off+4)
    this.emit('part', pbuf, off)
    delete this._rstream

    //TBD{
    this.emit('full', nbuf, this._cur_recv.nreads)
    delete this._cur_recv
    //TBD}
  }
  else if (datalen > framelen) { //first read bigger than one frame
    //log(format("datalen > framelen; %d > %d", datalen, framelen))
    buf.copy(nbuf, 0, off+4, off+4+framelen)

    pbuf = buf.slice(off+4, off+4+framelen)
    this.emit('part', pbuf, off)
    delete this._rstream

    //TBD{
    this.emit('full', nbuf, this._cur_recv.nreads)
    this._cur_recv.nreads = 0
    //TBD}
    this.readFrame(buf, off+4+framelen)
  }
  else if (datalen < framelen) { //first read smaller than on fram
    //log(format("datalen < framelen; %d < %d", datalen, framelen))
    buf.copy(nbuf, 0, off+4) //copy everything in buf to nbuf

    pbuf = buf.slice(off+4)
    this.emit('part', pbuf, off)

    //TBD{
    if (this.emit_partials) {
      var start = 0
        , end = buf.length - 4
        , partial = nbuf.slice(start, end)
      this.emit('partial', partial, start, end, framelen)
    }
    this._cur_recv.buffer = nbuf
    this._cur_recv.sofar  = datalen
    //TBD}

    this._cur_recv.state  = "data"
  }
}

Frap.prototype.readData = function Frap__readData(buf) {
  var framebuf = this._cur_recv.buffer
    , sofar = this._cur_recv.sofar
    , framelen = framebuf.length
    , rem = framelen - sofar

  var start, end, partial
  if (buf.length === rem) {
    //TBD{
    this._cur_recv.buffer = undefined
    this._cur_recv.sofar = undefined
    buf.copy(framebuf, sofar)
    if (this.emit_partials) {
      start = sofar
      end = start + buf.length
      partial = framebuf.slice(start, end)
      this.emit('partial', partial, start, end, framelen)
    }
    this.emit('full', framebuf, this._cur_recv.nreads)
    //TBD}
    delete this._cur_recv

    this.emit('part', buf, sofar)
  }
  else if (buf.length > rem) {
    log("Frap.readData: buf.length > rem")

    this._cur_recv.buffer = undefined
    this._cur_recv.sofar = undefined
    //buf.copy(framebuf, sofar, 0, framebuf.length-sofar)
    buf.copy(framebuf, sofar, 0, rem)
    this.emit('full', framebuf, this._cur_recv.nreads)
    this._cur_recv.nreads = 0

    if (this.emit_partials) {
      start = sofar
      end = start + (framebuf.length - sofar)
      partial = framebuf.slice(start, end)
      this.emit('partial', partial, start, end, framelen)
    }
    this._cur_recv.state = "frame"

    var pbuf = buf.slice(0, rem)
    this.emit('part', pbuf, sofar)

    this.readFrame(buf, framebuf.length-sofar)
  }
  else if (buf.length < rem) {
    buf.copy(framebuf, sofar)
    this._cur_recv.sofar += buf.length
    if (this.emit_partials) {
      start = sofar
      end = start + buf.length
      partial = framebuf.slice(start, end)
      this.emit('partial', partial, start, end, framelen)
    }
    
    this.emit('part', buf, sofar)
  }
}

