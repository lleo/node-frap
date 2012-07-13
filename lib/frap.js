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
  , Dequeue = require('dequeue')
  , Stream = require('stream')

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

var Frap = function Frap(sk, noframes) {
  //EventEmitter.call(this)
  Stream.call(this)

  if (arguments.length === 1 || noframes === undefined)
    noframes = false //default value

  assert(typeof noframes === 'boolean', "noframes not of type 'boolean'")

  this.sk = sk
  this.noframes = noframes

  this.paused = false
  this.eventq = []

  this.f_state    = "frame"   //parser state
  this.f_hdrbuf   = undefined //partial header buffer
  this.f_framelen = undefined //framelen for current receiveing frame
  this.f_pos      = 0         //current position in the frame
  this.f_nreads   = 0         //number of 'data' events for current frame

  this.id = "Frap<" + this.sk.remoteAddress + ":" + this.sk.remotePort + ">"

  //this.pending_frames = [] //Pending Write
  this.pending_frames = new Dequeue() //Pending Write

  //Stream API
  this.readable = true
  this.writable = true

  var self = this

  function onSkData(buf) {
    if (Frap.VERBOSE) log("Frap: onSkData: self.f_state=%s; buf.length=%d;", self.f_state, buf.length)

    self.f_nreads += 1
    switch (self.f_state) {
      case "frame":
        self._readFrame(buf)
        break;
      case "data":
        self._readData(buf)
        break;
      case "header":
        self._readHeader(buf)
        break;
      default:
        throw new Error("unknown state '"+self.f_state+"'")
        break;
    }
  }

  function onSkError(err) {
    if (Frap.VERBOSE) log("Frap: onSkError:", err)
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
  
  function onSkEnd() {
    if (Frap.VERBOSE) log("Frap: onSkEnd:")
    self.end()
  }
  function onSkClose(had_error) {
    if (Frap.VERBOSE) log("Frap: onSkClose: had_error=%j", had_error)
    self.destroy()
  }
  this.sk.once('end', onSkEnd)
  this.sk.once('close', onSkClose)

  if (!this.noframes) self.enableEmitFrame()
}
Frap.VERBOSE = 0

exports = module.exports = Frap
Frap.Frap = Frap
Frap.RFrameStream = RFrameStream
Frap.WFrameStream = WFrameStream

//util.inherits(Frap, EventEmitter)
util.inherits(Frap, Stream)

Frap.prototype.pause =
function Frap__pause() {
  if (Frap.VERBOSE) log("Frap__pause: this.paused=%j", this.paused)
  this.paused = true
  this.sk.pause()
}

//is this really a try_resume ? should the return value be significant?
Frap.prototype.resume =
function Frap__resume() {
  if (Frap.VERBOSE) log("Frap__resume: called; this.paused=%j", this.paused)
  this.paused = false

  //try to replay event queued during pause
  // NOTE: even with a pause, an already received buffer can contain several
  //       emittable events.
  while (this.eventq.length > 0) {
    var evt = this.eventq.shift()
    this._dispatchEvent.apply(this, evt)
    //if (Frap.VERBOSE) log("Frap__resume: dispatching event event=%s", evt[0])
    if (this.paused) break //an event can cause this to pause again
  }

  //if we have not been re-paused, resume the socket
  if (!this.paused) {
    if (Frap.VERBOSE) log("Frap__resume: resuming socket")
    this.sk.resume()
  }

  return !this.paused
}

Frap.prototype._submitEvent =
function Frap___submitEvent(event, arg1, arg2) {
  //if (Frap.VERBOSE) log("Frap___submitEvent: this.paused=%j; event=%s", this.paused, event)
  if (this.paused) {
    this.eventq.push([event, arg1, arg2])
    return
  }
  this._dispatchEvent(event, arg1, arg2)
}

Frap.prototype._dispatchEvent =
function Frap___dispatchEvent(event, arg1, arg2) {
  //if (Frap.VERBOSE) log("Frap___dispatchEvent: this.paused=%j; event=%s", this.paused, event)
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
      var bufs = arg1
        , framelen = arg2
      this.emit('frame', bufs, framelen)
      if (this.listeners('data').length > 0) {
        //this concat can be very expensive; only do it if someone is listening
        var fbuf = concat(bufs, framelen)
        //FIXME: if I implement setEncoding() I have to toString() this buf :P
        this.emit('data', fbuf)
      }
      break;
    default:
      throw new Error(format("_dispatchEvent: Unknown event %s", event))
  }
}


// STREAM API
//
Frap.prototype.write = function Frap__write(buf, enc){
  if (toString.call(buf) === '[object String]') {
    buf = new Buffer(buf, enc)
  }

  var rv = this.sendFrame(buf)

  return rv
}

Frap.prototype.end = function Frap__end(buf, enc) {
  if (this.didEnd) return
  this.didEnd = true

  if (Frap.VERBOSE) log("Frap__end: called")

  var rv = true
  if (buf) {
    rv = this.write(buf, enc)
  }

  var self = this
  Object.keys(this.sk_listeners).forEach(function(k){
    self.sk.removeListener(k, self.sk_listeners[k])
  })

  this.readable = false
  this.writable = false

  this.emit('end')

  return rv
}

// STREAM API
//
Frap.prototype.destroy = function Frap__destroy() {
  if (this.didDestroy) return
  this.didDestroy = true

  if (Frap.VERBOSE) log("Frap__destroy: called")

  this.end()

  //delete pending frames
  if (this._wstream) {
    this._wstream.destroy()
    this._wstream = undefined
  }
  if (this._rstream) {
    this._rstream.destroy()
    this._rstream = undefined
  }
  this.pending_frames.empty()

  delete this.sk

  this.emit('close')
}

// working on makeing Frap a Stream; not done yet
Frap.prototype.destroySoon = function Frap__destroySoon() {
  if (this.didDestroySoon || this.didDestroy) return
  this.didDestroySoon = true

  var self = this
  if (this.pending_frames.length > 0 || this._wstream) {
    this.once('drain', function(){ self.destroy() })
  }
  else {
    process.nextTick(function(){ self.destroy() })
  }
}

Frap.prototype.pipe = function Frap__pipe(dst) {
  var src = this

  if (!(dst instanceof Frap)) {
    if (Frap.VERBOSE) log("Frap__pipe: using Stream.pipe")
    Frap.super_.prototype.pipe.call(src, dst)
    return
  }

  function pipeOnBegin(rstream, framelen){
    var wstream = dst.createWriteStream(framelen)

    rstream.once('end', function(){
      if (Frap.VERBOSE) log("Frap__pipe: pipeOnBegin: rstream once 'end': src.pause()")
      src.pause()
    })

    rstream.once('close', function(){
      //We use destroySoon() cuz it waits on any pending writes
      if (Frap.VERBOSE) log("Frap__pipe: pipeOnBegin: rstream.once 'close': wstream.destroySoon()")
      wstream.destroySoon()
    })

    wstream.once('close', function(){
      if (Frap.VERBOSE) log("Frap__pipe: pipeOnBegin: wstream.once 'close': src.resume()")
      src.resume()
    })

    rstream.pipe(wstream)
  }

  src.on('begin', pipeOnBegin)

  function cleanup() {
    if (Frap.VERBOSE) log("Frap__pipe: cleanup: removing pipeOnBegin")
    src.removeListener('begin', pipeOnBegin)
  }

  var didPipeOnEnd = false
  function pipeOnEnd() {
    if (didPipeOnEnd) return
    didPipeOnEnd = true

    if (Frap.VERBOSE) log("Frap__pipe: pipeOnEnd: called")

    cleanup()

    dst.end()
  }
  src.once('end', pipeOnEnd)

  var didPipeOnClose = false
  function pipeOnClose() {
    if (didPipeOnClose) return
    didPipeOnClose = true

    if (Frap.VERBOSE) log("Frap__pipe: pipeOnClose: called")

    pipeOnEnd()
    dst.destroy()
  }
  src.once('close', pipeOnClose)
  
  //FIXME: need pipeOnError
}

// sendFrame(buf0, buf1, ..., bufN, [cb])   //send a list of bufs
// sendFrame([buf0, buf1, ..., bufN], [cb]) //send a single array of bufs
Frap.prototype.sendFrame = function Frap__sendFrame() {
  var self = this
    , bufs = Array.prototype.slice.call(arguments)

  var cb
  if (bufs.length > 1 && typeof bufs[bufs.length-1] === 'function') {
    cb = bufs.pop()
  }

  if (bufs.length === 1 && Array.isArray(bufs[0])) {
    bufs = bufs[0]
  }

  var sent = false
  function frameSent(ondrain) {
    if (cb) cb()
    if (self.pending_frames.length > 0) {
      //if (Frap.VERBOSE) log("Frap__sendFrame: onFrameSent: shifting off pending_frames")
      var ent = self.pending_frames.shift()
      sent = self._sendFrame(ent[0], ent[1])
      return
    }
    if (ondrain) self.emit('drain')
  }

  if (this._wstream) { //currently writing
    //if (Frap.VERBOSE) log("Frap__sendFrame: pushing onto pending_frames")
    this.pending_frames.push([bufs, frameSent])
    return false
  }

  return this._sendFrame(bufs, frameSent)
}

Frap.prototype._sendFrame = function Frap___sendFrame(bufs, frameSent) {
  assert(Array.isArray(bufs), "bufs must be an Array")
  assert(typeof frameSent === 'function', "frameSent must be a function")

  var framelen = 0
  for (var i=0; i<bufs.length; i++) {
    assert(Buffer.isBuffer(bufs[i]), "every element of bufs must be a Buffer")
    framelen += bufs[i].length
  }

  if (Frap.VERBOSE) log("Frap___sendFrame: framelen=%d;", framelen)

  var self = this
    , i = 0
    , wstream = this.createWriteStream(framelen)

//  wstream.once('close', cb)

  var sent, ondrain=false
  function writeFrameBufs() {
    sent=true //either first time or on 'drain' event
    while (sent && i<bufs.length) {
      sent = wstream.write(bufs[i])
      i += 1
    }

    if (sent === false) {
      wstream.once('drain', function(){
        ondrain=true
        writeFrameBufs()
      })
    }
    else { // i === bufs.length
      wstream.destroy() //emits 'close' which frees self._wstream
      frameSent(ondrain)
    }

    return sent
  }

  return writeFrameBufs() //true means it was sent immediately
} //end: send

Frap.prototype.enableEmitFrame = function Frap__enableEmitFrame() {
  var self = this

  self.frame = {}
  
  function onBegin(rstream, framelen) {
    assert(self.frame !== undefined, "onBegin: self.frame is undefined")
    //if (Frap.VERBOSE) log("onBegin: framelen=%d;", framelen)

    var bufs = []

    function _onData(buf, off) {
      //if (Frap.VERBOSE) log("rstream.on 'data': buf.length=%d; off=%d;", buf.length, off)
    
      bufs.push(buf)
    
      if (off+buf.length === framelen) {
        //finished
        self._submitEvent('frame', bufs, framelen)
      }
    }

    rstream.on('data', _onData)

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

  //if (Frap.VERBOSE) log("Frap__createWriteStream: called")
  
  var wstream = new WFrameStream(this, framelen)

  this._wstream = wstream
  var self = this
  this._wstream.once('close', function() {
    //if (Frap.VERBOSE) log("Frap__createWriteStream: wstream.once 'close':")
    self._wstream = undefined
  })

  return wstream
}

Frap.prototype.createReadStream =
function Frap__createReadStream(framelen) {
  assert(this._rstream == null, "currently reading a frame")
  
  var rstream = new RFrameStream(this, framelen)

  this._rstream = rstream
  var self = this
  this._rstream.once('end', function(err) {
    self._rstream = undefined
  })

  return rstream
}

Frap.prototype._readHeader = function Frap___readHeader(buf) {
  var nbuf = new Buffer(this.f_hdrbuf.length + buf.length)

  this.f_hdrbuf.copy(nbuf) //1, 2, or 3 bytes copied
  buf.copy(nbuf, this.f_hdrbuf.length)

  this.f_state = "frame"
  this.f_hdrbuf = undefined

  this._readFrame(nbuf)
}

Frap.prototype._readFrame = function Frap___readFrame(buf) {
  if (buf.length < 4) { //it is not even big enough to contain the frame hdr
    this.f_hdrbuf = buf
    this.f_state = "header"
    return
  }
  
  var framelen = this.f_framelen = buf.readUInt32BE(0)
    , datalen = buf.length - 4

  if (Frap.VERBOSE) log("Frap___readFrame: datalen=%d; framelen=%d;", datalen, framelen)

  this._submitEvent('begin', framelen)

  var pbuf
  if (datalen === framelen) { //whole frame came in first read
    if (Frap.VERBOSE) log("Frap___readFrame: datalen === framelen; %d === %d", datalen, framelen)

    pbuf = buf.slice(4)
    this._submitEvent('part', pbuf, 0)

    this.f_state    = "frame"
    this.f_hdrbuf   = undefined
    this.f_framelen = undefined
    this.f_pos      = 0
    this.f_nreads   = 0
  }
  else if (datalen > framelen) { //first read bigger than one frame
    if (Frap.VERBOSE) log("Frap___readFrame: datalen > framelen; %d > %d", datalen, framelen)

    pbuf = buf.slice(4, 4+framelen)
    this._submitEvent('part', pbuf, 0)

    //this.f_header   = "frame"
    //this.f_hdrbuf   = undefined
    this.f_framelen = undefined
    this.f_pos      = 0
    this.f_nreads   = 0

    this._readFrame(buf.slice(4+framelen))
  }
  else if (datalen < framelen) { //first read smaller than one frame
    if (Frap.VERBOSE) log("Frap___readFrame: datalen < framelen; %d < %d", datalen, framelen)

    if (datalen > 0) {
      pbuf = buf.slice(4)
      this._submitEvent('part', pbuf, 0)
    }

    this.f_state    = "data"
    //this.f_hdrbuf   = undefined
    //this.f_framelen = framelen
    this.f_pos      = datalen
    this.f_nreads   = 0
  }
}

Frap.prototype._readData = function Frap___readData(buf) {
  var pos      = this.f_pos
    , framelen = this.f_framelen
    , rem      = framelen - pos

  var start, end
  if (buf.length === rem) {
    if (Frap.VERBOSE) log("Frap___readData: buf.length === rem; %d === %d", buf.length, rem)

    this._submitEvent('part', buf, pos)

    this.f_state    = "frame"
    this.f_hdrbuf   = undefined
    this.f_framelen = undefined
    this.f_pos      = 0
    this.f_nreads   = 0
  }
  else if (buf.length > rem) {
    if (Frap.VERBOSE) log("Frap___readData: buf.length > rem; %d > %d", buf.length, rem)

    var pbuf = buf.slice(0, rem)
    this._submitEvent('part', pbuf, pos)

    this.f_state    = "frame"
    //this.f_hdrbuf   = undefined
    this.f_framelen = undefined
    this.f_pos      = 0
    //this.f_nreads   = 0

    this._readFrame(buf.slice(rem))
  }
  else if (buf.length < rem) {
    if (Frap.VERBOSE) log("Frap___readData: buf.length < rem; %d < %d", buf.length, rem)

    this._submitEvent('part', buf, pos)

    //this.f_state    = "data"
    //this.f_hdrbuf   = undefined
    //this.f_framelen = framelen
    this.f_pos += buf.length
    //this.f_nreads   = 0
  }
}
