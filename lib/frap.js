var events = require('events')
  , util = require('util')
  , assert = require('assert')
  , log = console.log
  , format = util.format
  , frap_stream = require('./frap_stream')
  , RFrameStream = frap_stream.RFrameStream
  , WFrameStream = frap_stream.WFrameStream

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

// sendFrame(buf0, buf1, ..., bufN, [cb])
Frap.prototype.send = function Frap__send() {
  var self = this
    , bufs = Array.prototype.slice.call(arguments)
    , cb
  if (typeof bufs[bufs.length-1] === 'function') {
    cb = bufs.pop()
  }
  if (bufs.length === 1 && Array.isArray(bufs[0])) {
    bufs = bufs[0]
  }
  
  var tot = 0
  for (var i=0; i<bufs.length; i++) {
    assert.ok(bufs[i] instanceof Buffer)
    tot += bufs[i].length
  }

  log(format("bufs.length=%d; tot=%d;", bufs.length, tot))
  
  var wrote, i=0, sofar=0, wstream = this.createWriteStream(tot, cb)
  ;(function do_write() {
    //log(format("wstream do_write' wrote=%s; i=%d; bufs.length=%d;",
    //  wrote, i, bufs.length))
    do {
      wrote = wstream.write(bufs[i])
      sofar += bufs[i].length
      //log(format("wrote=%s; i=%d; sofar=%d;", wrote, i, sofar))
      i += 1

      if (!wrote && i < bufs.length) {
        //log("do_write: arming wstream.once('drain')")
        wstream.once('drain', do_write)
      }
    } while (wrote && i < bufs.length)
  })()

  return this
}

Frap.prototype.sendHeader = function sendHeader(framelen) {
  if (this._cur_send)
    throw new Error("in the middle of sending another frame")

  this._cur_send = {framelen: framelen, sofar: 0}

  var wbuf = new Buffer(4)

  wbuf.writeUInt32BE(framelen, 0)

  var rv = this.socket.write(wbuf)

  return rv
}

Frap.prototype.sendPartial = function sendPartial(buf) {
  if (!this._cur_send)
    throw new Error("have not sent header yet")

  if (this._cur_send.sofar + buf.length > this._cur_send.framelen) {
    throw new Error(format("sendPartial: trying to send to much data framelen=%d; sofar+buflen=%d;", this._cur_send.framelen, this._cur_send.sofar + buf.length))
  }

  var rv = this.socket.write(buf)

  this._cur_send.sofar += buf.length

  if (this._cur_send.framelen === this._cur_send.sofar) {
    //finished
    delete this._cur_send
  }

  return rv
}

Frap.prototype.recvFrame =
function Frap__recvFrame(cb) { //cb(err, buf)
  var self = this
  self.on('frame', function (rstream, framelen) {
    var framebuf, onPart, onError, nreads=0
    log(format("recvFrame: 'frame' event; framelen=%d;", framelen))
    framebuf = new Buffer(framelen)
    onPart = function(buf, off){
      //log(format("recvFrame: 'part' event: buf.length=%d; off=%d; nreads=%d;", buf.length, off, nreads))
      nreads += 1
      buf.copy(framebuf, off)
      if (off+buf.length === framelen) {
        //finished
        self.removeListener('part', onPart)
        self.removeListener('error', onError)
        cb(null, framebuf, nreads)
      }
    }
    onError = function onError(err){
      self.removeListener('part', onPart)
      self.removeListener('error', onError)
      cb(err)
    }
    self.on('part', onPart)
    self.on('error', onError)
  })
}

Frap.prototype.createWriteStream =
function Frap__createWriteStream(framelen, cb) {
  if (this._wstream) throw new Error("currently writing a frame")
  
  this.sendHeader(framelen)
  
  this._wstream = new WFrameStream(this, framelen)

  var self = this
  this._wstream.once('close', function(err) {
    delete self._wstream
    if (cb) cb(err)
  })
  
  return this._wstream
}

Frap.prototype.createReadStream =
function Frap__createReadStream(framelen) {
  this._rstream = new RFrameStream(this, framelen)
  
  var self = this
  this._rstream.on('end', function(err) {
    delete self._rstream
  })
  
  return this._rstream
}

function onData(buf) {
  //log(format("onData: this._cur_recv.state=%s; buf.length=%d;",
  //    this._cur_recv.state, buf.length))
  if (!this._cur_recv) {
    this._cur_recv = {
      state: "frame"
    , buffer: undefined
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

  var rstream = this.createReadStream(framelen)
  this.emit('frame', rstream, framelen)

  var pbuf
  if (datalen === framelen) { //whole frame came in first read
    //log(format("datalen === framelen; %d === %d", datalen, framelen))
    buf.copy(nbuf, 0, off+4) //copy datalen from buf to nbuf

    pbuf = buf.slice(off+4)
    this.emit('part', pbuf, off)

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

