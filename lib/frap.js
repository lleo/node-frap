var events = require('events')
  , util = require('util')
  , assert = require('assert')
  , log = console.log
  , format = util.format
  , inspect = util.inspect
  , frap_stream = require('./frap_stream')
  , RFrameStream = frap_stream.RFrameStream
  , WFrameStream = frap_stream.WFrameStream

var logf = function() { log(format.apply(this, arguments)) }

var Frap = exports.Frap = function Frap(sk) {
  events.EventEmitter.call(this)

  this.sk = sk
  Object.defineProperty(this, 'id', {
    get: function() {
      return "Frap<"
        + this.sk.remoteAddress
        + ":"
        + this.sk.remotePort
        + ">"
    }
  })

  this.sk.on("data", onData.bind(this))
  
  // just proof that this works
  //if (Frap.VERBOSE) { logf("Frap.VERBOSE=%d;", Frap.VERBOSE) }
}
Frap.VERBOSE = 0

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

  if (Frap.VERBOSE>1) logf("bufs.length=%d; tot=%d;", bufs.length, tot)
  
  var wrote, i=0, sofar=0, wstream = this.createWriteStream(tot, cb)
  ;(function do_write() {
    if (Frap.VERBOSE)
      logf("wstream do_write' wrote=%s; i=%d; bufs.length=%d;",
            wrote, i, bufs.length)
    do {
      wrote = wstream.write(bufs[i])
      sofar += bufs[i].length
      //logf("wrote=%s; i=%d; sofar=%d;", wrote, i, sofar)
      i += 1

      if (!wrote && i < bufs.length) {
        //log("do_write: arming wstream.once('drain')")
        wstream.once('drain', do_write)
      }
    } while (wrote && i < bufs.length)
  })()

  return this
}

Frap.prototype.recvFrame =
function Frap__recvFrame(cb) { //cb(err, buf)
  var self = this

  self.on('frame', function (rstream, framelen) {
    var framebuf, onPart, onError, nreads=0
    if (Frap.VERBOSE) logf("recvFrame: 'frame' event; framelen=%d;", framelen)

    framebuf = new Buffer(framelen)

    onPart = function(buf, off){
      if (Frap.VERBOSE)
        logf("recvFrame: 'part' event: buf.length=%d; off=%d; nreads=%d;",
              buf.length, off, nreads)

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

//Frap.prototype.sendHeader = function sendHeader(framelen) {
//  if (this._cur_send)
//    throw new Error("in the middle of sending another frame")
//
//  this._cur_send = {framelen: framelen, sofar: 0}
//
//  var wbuf = new Buffer(4)
//
//  wbuf.writeUInt32BE(framelen, 0)
//
//  var rv = this.sk.write(wbuf)
//
//  return rv
//}

//Frap.prototype.sendPartial = function sendPartial(buf) {
//  if (!this._cur_send)
//    throw new Error("have not sent header yet")
//
//  if (this._cur_send.sofar + buf.length > this._cur_send.framelen) {
//    throw new Error(format("sendPartial: trying to send to much data framelen=%d; sofar+buflen=%d;", this._cur_send.framelen, this._cur_send.sofar + buf.length))
//  }
//
//  var rv = this.sk.write(buf)
//
//  this._cur_send.sofar += buf.length
//
//  if (this._cur_send.framelen === this._cur_send.sofar) {
//    //finished
//    delete this._cur_send
//  }
//
//  return rv
//}

Frap.prototype.createWriteStream =
function Frap__createWriteStream(framelen, cb) {
  if (this._wstream) throw new Error("currently writing a frame")
  
  //this.sendHeader(framelen)
  
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
  if (!this._cur_recv) {
    this._cur_recv = {
      state: "frame"        //initial state is "frame"
    , buffer: undefined     //is partial header buffer
    , framelen: undefined   //populated when header is parsed
    , sofar: 0              //bytes of current frame received
    , nreads: 0             //number of onData calls
    }
  }

  if (Frap.VERBOSE)
    logf("onData: this._cur_recv.state=%s; buf.length=%d;",
          this._cur_recv.state, buf.length)

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
      break;
    default:
      throw new Error("unknown state '"+this._cur_recv.state+"'")
      break;
  }
}

Frap.prototype.readHeader = function Frap__readHeader(buf) {
  var nbuf = new Buffer(this._cur_recv.buffer.length + buf.length)

  this._cur_recv.buffer.copy(nbuf) //1, 2, or 3 bytes copied
  buf.copy(nbuf, this._cur_recv.buffer.length)

  this._cur_recv.buffer = undefined

  this.readFrame(nbuf)
}

Frap.prototype.readFrame = function Frap__readFrame(buf) {
  var off = 0
  if (buf.length-off < 4) { //it is not even big enough to contain the frame hdr
    this._cur_recv.buffer = buf
    this._cur_recv.state = "header"
    return
  }
  
  var framelen = this._cur_recv.framelen = buf.readUInt32BE(off)
    , datalen = buf.length - off - 4

  if (Frap.VERBOSE)
    logf("readFrame: datalen=%d; framelen=%d; off=%d;", datalen, framelen, off)

  var rstream = this.createReadStream(framelen)
  this.emit('frame', rstream, framelen)

  var pbuf
  if (datalen === framelen) { //whole frame came in first read
    if (Frap.VERBOSE)
      logf("readFrame: datalen === framelen; %d === %d", datalen, framelen)

    pbuf = buf.slice(off+4)
    this.emit('part', pbuf, off)

    delete this._cur_recv
  }
  else if (datalen > framelen) { //first read bigger than one frame
    if (Frap.VERBOSE)
      logf("readFrame: datalen > framelen; %d > %d", datalen, framelen)

    pbuf = buf.slice(off+4, off+4+framelen)
    this.emit('part', pbuf, off)

    this._cur_recv.nreads = 0

    this.readFrame(buf.slice(off+4+framelen))
  }
  else if (datalen < framelen) { //first read smaller than one frame
    if (Frap.VERBOSE)
      logf("readFrame: datalen < framelen; %d < %d", datalen, framelen)

    if (datalen > 0) {
      pbuf = buf.slice(off+4)
      this.emit('part', pbuf, off)
    }

    this._cur_recv.sofar  = datalen
    this._cur_recv.state  = "data"
  }
}

Frap.prototype.readData = function Frap__readData(buf) {
  var sofar    = this._cur_recv.sofar
    , framelen = this._cur_recv.framelen
    , rem      = framelen - sofar

  var start, end
  if (buf.length === rem) {
    if (Frap.VERBOSE)
      logf("readData: buf.length === rem; %d === %d", buf.length, rem)

    this._cur_recv.sofar = undefined   //FIXME shouldn't this be 0

    delete this._cur_recv

    this.emit('part', buf, sofar)
  }
  else if (buf.length > rem) {
    if (Frap.VERBOSE)
      logf("readData: buf.length > rem; %d > %d", buf.length, rem)

    this._cur_recv.nreads = 0
    this._cur_recv.state = "frame"

    var pbuf = buf.slice(0, rem)
    this.emit('part', pbuf, sofar)

    this.readFrame(buf.slice(rem))
  }
  else if (buf.length < rem) {
    if (Frap.VERBOSE)
      logf("readData: buf.length < rem; %d < %d", buf.length, rem)

    this._cur_recv.sofar += buf.length
    this.emit('part', buf, sofar)
  }
}
