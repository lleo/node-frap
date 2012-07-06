var log = console.log
//  , EventEmitter = require('events').EventEmitter
  , EventEmitter = require('eventemitter2').EventEmitter2
  , util = require('util')
  , assert = require('assert')
  , format = util.format
  , inspect = util.inspect
  , frap_stream = require('./frap_stream')
  , RFrameStream = frap_stream.RFrameStream
  , WFrameStream = frap_stream.WFrameStream

var Frap = function Frap(sk, emit_frames) {
  EventEmitter.call(this)

  if (arguments.length === 1 || emit_frames === undefined)
    emit_frames = true //default value

  assert(typeof emit_frames === 'boolean', "emit_frames not of type 'boolean'")

  this.sk = sk
  this.emit_frames = emit_frames

  this.paused = false
  this.eventq = []

  this.f_state    = "frame"   //parser state
  this.f_hdrbuf   = undefined //partial header buffer
  this.f_framelen = undefined //framelen for current receiveing frame
  this.f_pos      = 0         //current position in the frame
  this.f_nreads   = 0         //number of 'data' events for current frame

  this.id = "Frap<" + this.sk.remoteAddress + ":" + this.sk.remotePort + ">"

  this.pending_frames = [] //Pending Write
//  this.sending = false

  var self = this

  function onSkData(buf) {
    if (Frap.VERBOSE)
      log("onSkData: self.f_state=%s; buf.length=%d;", self.f_state, buf.length)

    self.f_nreads += 1
    switch (self.f_state) {
      case "frame":
        self.readFrame(buf)
        break;
      case "data":
        self.readData(buf)
        break;
      case "header":
        self.readHeader(buf)
        break;
      default:
        throw new Error("unknown state '"+self.f_state+"'")
        break;
    }
  }

  function onSkEnd() {
    if (Frap.VERBOSE) log("Frap: sk onEnd:")
    self.emit('end')
  }
  function onSkClose(had_error) {
    if (Frap.VERBOSE) log("Frap: sk onClose:", had_error)
    self.emit('close', had_error)
  }
  function onSkError(err) {
    if (Frap.VERBOSE) log("Frap: sk onError:", err)
    self.emit('error', err)
  }

  //listen to socket 'data', 'end', 'error', and 'close'
  this.sk_listeners = {
    'data'  : onSkData
  , 'end'   : onSkEnd
  , 'close' : onSkClose
  , 'error' : onSkError
  }
  Object.keys(this.sk_listeners).forEach(function(k){
    self.sk.on(k, self.sk_listeners[k])
  })
  
  if (this.emit_frames) self.enableEmitFrame()
}
Frap.VERBOSE = 0

exports = module.exports = Frap
Frap.Frap = Frap
Frap.RFrameStream = RFrameStream
Frap.WFrameStream = WFrameStream

util.inherits(Frap, EventEmitter)

Frap.prototype.pause =
function Frap__pauze() {
  this.paused = true
  this.sk.pause()
}

//is this really a try_resume ? should the return value be significant?
Frap.prototype.resume =
function Frap__resume() {
  this.paused = false

  //try to replay event queued during pause
  // NOTE: even with a pause, an already received buffer can contain several
  //       emittable events.
  while (this.eventq.length > 0) {
    var evt = this.eventq.shift()
    this.dispatchEvent.apply(this, evt)
    if (this.paused) break //an event can cause this to pause again
  }

  //if we have not been re-paused, resume the socket
  if (!this.paused) this.sk.resume()

  return !this.paused
}

Frap.prototype.submitEvent =
function Frap__submitEvent(event, arg1, arg2) {
  if (this.paused) {
    this.eventq.push([event, arg1, arg2])
    return
  }
  this.dispatchEvent(event, arg1, arg2)
}

Frap.prototype.dispatchEvent =
function Frap__dispatchEvent(event, arg1, arg2) {
  switch (event) {
    case 'begin':
      var framelen = arg1
        , rstream = this.createReadStream(framelen)
      this.emit('begin', rstream, framelen)
      break;
    case 'part':
      var pbuf = arg1
        , pos = arg2
      this.emit('part', pbuf, pos)
      break;
    case 'frame':
      var fbuf = arg1
      this.emit('frame', fbuf)
      break;
    default:
      throw new Error("dispatchEvent: Unknown event %s", args[0])
  }
}


Frap.prototype.end = function Frap__end() {
  //log((new Error("Frap__end: looking at stack")).stack)
  var self = this
  Object.keys(this.sk_listeners).forEach(function(k){
    self.sk.removeListener(k, self.sk_listeners[k])
  })
  self.sk.end()
}

// sendFrame(buf0, buf1, ..., bufN)   //send a list of bufs
// sendFrame([buf0, buf1, ..., bufN]) //send a single array of bufs
Frap.prototype.sendFrame = function Frap__sendFrame() {
  var self = this
    , bufs = Array.prototype.slice.call(arguments)

  if (bufs.length === 1 && Array.isArray(bufs[0])) {
    bufs = bufs[0]
  }

  if (this._wstream) { //currently writing
    this.pending_frames.push(bufs)
    return false
  }

  var sent
  function onFrameSent() {
    if (self.pending_frames.length > 0) {
      sent = self._sendFrame(self.pending_frames.shift())
      self.once('_frameSent', onFrameSent)
      return sent
    }
    self.emit('drain')
  }

  sent = this._sendFrame(bufs)
  this.once('_frameSent', onFrameSent)

  return sent
}

Frap.prototype._sendFrame = function Frap___sendFrame(bufs) {
  var self = this

  var framelen = 0
  for (var i=0; i<bufs.length; i++) {
    assert.ok(bufs[i] instanceof Buffer)
    framelen += bufs[i].length
  }

  //if (Frap.VERBOSE) log("Frap___send: framelen=%d;", framelen)

  var i = 0, wstream = this.createWriteStream(framelen)

  wstream.once('finished', function(){
    self.emit('_frameSent')
  })

  function writeFrameBufs() {
    flushed=true //either first time or on 'drain' event
    while (flushed && i<bufs.length) {
      flushed = wstream.write(bufs[i])
      i += 1
    }

    if (i < bufs.length) {
      //last write MUST have not flushed, else we'd have finished writting
      wstream.once('drain', writeFrameBufs)
    }

    return flushed
  }

  var rv = writeFrameBufs() //true means it was sent immediately

  return rv
} //end: send

Frap.prototype._sendPending = function Frap___sendPending() {
  
}

function concat(bufs) {
  var tot=0, i, nbuf, off=0

  for (i=0; i<bufs.length; i++) { tot += bufs[i].length }

  nbuf = new Buffer(tot)
  for (i=0; i< bufs.length; i++) {
    bufs[i].copy(nbuf, off)
    off += bufs[i].length
  }

  return nbuf
}

Frap.prototype.enableEmitFrame = function Frap__enableEmitFrame() {
  var self = this

  self.frame = {}
  
  function onBegin(rstream, framelen) {
    assert(self.frame !== undefined, "onBegin: self.frame is undefined")
    //if (Frap.VERBOSE) log("onBegin: framelen=%d;", framelen)

    var bufs = []

    rstream.on('data', function _onData(buf, off) {
      //if (Frap.VERBOSE)
      //  log("rstream.on 'data': buf.length=%d; off=%d;", buf.length, off)

      bufs.push(buf)

      if (off+buf.length === framelen) {
        //finished
        if (bufs.length == 1) { //micro optimization
          //self.emit('frame', buf)
          self.submitEvent('frame', buf)
        }
        else {
          //self.emit('frame', concat(bufs))
          self.submitEvent('frame', concat(bufs))
        }
      }
    })

    //rstream.on('error', function(err){
    //
    //})
  }

  self.frame.onBegin = onBegin

  self.on('begin', onBegin)
}

Frap.prototype.disableEmitFrame = function Frap__disableEmitFrame() {
  //self.removeListener('part', self.frame.onPart)
  self.removeListener('begin', self.frame.onBegin)
  ;delete self.frame
}

Frap.prototype.createWriteStream =
function Frap__createWriteStream(framelen) {
  assert(this._wstream == null, "currently writing a frame")
  
  var wstream = new WFrameStream(this, framelen)

  this._wstream = wstream
  var self = this
  this._wstream.once('finished', function() {
    //delete self._wstream
    self._wstream = undefined
  })
  
  return wstream
}

Frap.prototype.createReadStream =
function Frap__createReadStream(framelen) {
  assert.strictEqual(this._rstream, undefined, "currently reading a frame")
  
  var rstream = new RFrameStream(this, framelen)

  this._rstream = rstream
  var self = this
  this._rstream.once('end', function(err) {
    //delete self._rstream
    self._rstream = undefined
  })

  return rstream
}

Frap.prototype.readHeader = function Frap__readHeader(buf) {
  var nbuf = new Buffer(this.f_hdrbuf.length + buf.length)

  this.f_hdrbuf.copy(nbuf) //1, 2, or 3 bytes copied
  buf.copy(nbuf, this.f_hdrbuf.length)

  this.f_state = "frame"
  this.f_hdrbuf = undefined

  this.readFrame(nbuf)
}

Frap.prototype.readFrame = function Frap__readFrame(buf) {
  if (buf.length < 4) { //it is not even big enough to contain the frame hdr
    this.f_hdrbuf = buf
    this.f_state = "header"
    return
  }
  
  var framelen = this.f_framelen = buf.readUInt32BE(0)
    , datalen = buf.length - 4

  if (Frap.VERBOSE)
    log("readFrame: datalen=%d; framelen=%d;", datalen, framelen)

  //var rstream = this.createReadStream(framelen)
  //this.emit('begin', rstream, framelen)
  this.submitEvent('begin', framelen)

  var pbuf
  if (datalen === framelen) { //whole frame came in first read
    if (Frap.VERBOSE)
      log("readFrame: datalen === framelen; %d === %d", datalen, framelen)

    pbuf = buf.slice(4)
    //this.emit('part', pbuf, 0)
    this.submitEvent('part', pbuf, 0)

    this.f_state    = "frame"
    this.f_hdrbuf   = undefined
    this.f_framelen = undefined
    this.f_pos      = 0
    this.f_nreads   = 0
  }
  else if (datalen > framelen) { //first read bigger than one frame
    if (Frap.VERBOSE)
      log("readFrame: datalen > framelen; %d > %d", datalen, framelen)

    pbuf = buf.slice(4, 4+framelen)
    //this.emit('part', pbuf, 0)
    this.submitEvent('part', pbuf, 0)

    //this.f_header   = "frame"
    //this.f_hdrbuf   = undefined
    this.f_framelen = undefined
    this.f_pos      = 0
    this.f_nreads   = 0

    this.readFrame(buf.slice(4+framelen))
  }
  else if (datalen < framelen) { //first read smaller than one frame
    if (Frap.VERBOSE)
      log("readFrame: datalen < framelen; %d < %d", datalen, framelen)

    if (datalen > 0) {
      pbuf = buf.slice(4)
      //this.emit('part', pbuf, 0)
      this.submitEvent('part', pbuf, 0)
    }

    this.f_state    = "data"
    //this.f_hdrbuf   = undefined
    //this.f_framelen = framelen
    this.f_pos      = datalen
    this.f_nreads   = 0
  }
}

Frap.prototype.readData = function Frap__readData(buf) {
  var pos      = this.f_pos
    , framelen = this.f_framelen
    , rem      = framelen - pos

  var start, end
  if (buf.length === rem) {
    if (Frap.VERBOSE)
      log("readData: buf.length === rem; %d === %d", buf.length, rem)

    //this.emit('part', buf, pos)
    this.submitEvent('part', buf, pos)

    this.f_state    = "frame"
    this.f_hdrbuf   = undefined
    this.f_framelen = undefined
    this.f_pos      = 0
    this.f_nreads   = 0
  }
  else if (buf.length > rem) {
    if (Frap.VERBOSE)
      log("readData: buf.length > rem; %d > %d", buf.length, rem)

    var pbuf = buf.slice(0, rem)
    //this.emit('part', pbuf, pos)
    this.submitEvent('part', pbuf, pos)

    this.f_state    = "frame"
    //this.f_hdrbuf   = undefined
    this.f_framelen = undefined
    this.f_pos      = 0
    //this.f_nreads   = 0

    this.readFrame(buf.slice(rem))
  }
  else if (buf.length < rem) {
    if (Frap.VERBOSE)
      log("readData: buf.length < rem; %d < %d", buf.length, rem)

    //this.emit('part', buf, pos)
    this.submitEvent('part', buf, pos)

    //this.f_state    = "data"
    //this.f_hdrbuf   = undefined
    //this.f_framelen = framelen
    this.f_pos += buf.length
    //this.f_nreads   = 0
  }
}
