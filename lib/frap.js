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

var Frap = exports.Frap = function Frap(sk, emit_frames) {
  EventEmitter.call(this)

  if (arguments.length === 1 || emit_frames === undefined)
    emit_frames = true //default value

  assert(typeof emit_frames === 'boolean', "emit_frames not of type 'boolean'")

  this.sk = sk
  this.emit_frames = emit_frames

  this.f_state    = "frame"   //parser state
  this.f_hdrbuf   = undefined //partial header buffer
  this.f_framelen = undefined //framelen for current receiveing frame
  this.f_pos      = 0         //current position in the frame
  this.f_nreads   = 0         //number of 'data' events for current frame

  this.id = "Frap<" + this.sk.remoteAddress + ":" + this.sk.remotePort + ">"

  this.pending = []
  this.sending = false

  var self = this
  function onFrameSent() {
    if (self.pending.length > 0) {
      self._sendFrame( self.pending.shift() )
    }
    else {
      self.sending = false
      self.emit('drain')
    }
  }
  self.on('_frameSent', onFrameSent)

  function onData(buf) {
    if (Frap.VERBOSE)
      log("onData: self.f_state=%s; buf.length=%d;", self.f_state, buf.length)

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

  function onEnd()            {
    if (Frap.VERBOSE) log("Frap: sk onEnd:")
    self.emit('end')
  }
  function onClose(had_error) {
    if (Frap.VERBOSE) log("Frap: sk onClose:", had_error)
    self.emit('close', had_error)
  }
  function onError(err)       {
    if (Frap.VERBOSE) log("Frap: sk onError:", err)
    self.emit('error', err)
  }

  //listen to socket 'data', 'end', 'error', 'close', and maybe 'drain'
  this.sk_listeners = {
    'data'  : onData
  , 'end'   : onEnd
  , 'close' : onClose
  , 'error' : onError
  }
  Object.keys(this.sk_listeners).forEach(function(k){
    self.sk.on(k, self.sk_listeners[k])
  })
  
  if (this.emit_frames) self.enableEmitFrame()
}
Frap.VERBOSE = 0
Frap.RFrameStream = RFrameStream
Frap.WFrameStream = WFrameStream

util.inherits(Frap, EventEmitter)

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

  if (this.sending) { //currently writing
    this.pending.push(bufs)
    return false
  }

  this.sending = true

  return this._sendFrame(bufs)
}

var _send_depth = 0, _send_call=0
Frap.prototype._sendFrame = function Frap___sendFrame(bufs) {
  _send_depth++
  _send_call++
  var self = this

  var framelen = 0
  for (var i=0; i<bufs.length; i++) {
    assert.ok(bufs[i] instanceof Buffer)
    framelen += bufs[i].length
  }

  //if (Frap.VERBOSE) log("Frap___send: framelen=%d;", framelen)
  log("_send_depth=%d; _send_call=%d: pending=%d;",
      _send_depth, _send_call, this.pending.length)


  var i = 0, wstream = this.createWriteStream(framelen)

  wstream.once('close', function(){ self.emit('_frameSent') })

  function _write_more() {
    flushed=true //either first time or on 'drain' event
    while (flushed && i<bufs.length) {
      //log("Frap__send: calling wstream.write(bufs[%d])", i)
      flushed = wstream.write(bufs[i])
      i += 1
    }

    if (i < bufs.length) { //still have writes pending
      //last write MUST have not flushed, else we'd have finished writting
      wstream.once('drain', _write_more)
    }

    return flushed
  }

  var rv = _write_more() //true means it was sent immediately



  _send_depth--
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
          self.emit('frame', buf)
        }
        else {
          self.emit('frame', concat(bufs))
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
  //assert.strictEqual(this._wstream, undefined, "currently writing a frame")
  
  var wstream = new WFrameStream(this, framelen)

  //this._wstream = wstream
  //var self = this
  //this._wstream.once('close', function() {
  //  delete self._wstream
  //})
  
  return wstream
}

Frap.prototype.createReadStream =
function Frap__createReadStream(framelen) {
  //if (this._rstream) throw new Error("currently reading a frame")
  
  //this._rstream = new RFrameStream(this, framelen)
  var rstream = new RFrameStream(this, framelen)

  //rstream.once('end', function() {
  //  rstream.destroy()
  //})

  //var self = this
  //this._rstream.once('end', function(err) {
  //  delete self._rstream
  //})

  //return this._rstream
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

  var rstream = this.createReadStream(framelen)
  this.emit('begin', rstream, framelen)

  var pbuf
  if (datalen === framelen) { //whole frame came in first read
    if (Frap.VERBOSE)
      log("readFrame: datalen === framelen; %d === %d", datalen, framelen)

    pbuf = buf.slice(4)
    this.emit('part', pbuf, 0)

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
    this.emit('part', pbuf, 0)

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
      this.emit('part', pbuf, 0)
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

    this.emit('part', buf, pos)

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
    this.emit('part', pbuf, pos)

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

    this.emit('part', buf, pos)

    //this.f_state    = "data"
    //this.f_hdrbuf   = undefined
    //this.f_framelen = framelen
    this.f_pos += buf.length
    //this.f_nreads   = 0
  }
}
