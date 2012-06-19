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

var Frap = exports.Frap = function Frap(sk, emit_frames) {
  events.EventEmitter.call(this)

  this.sk = sk

  this.f_state    = "frame"   //parser state
  this.f_hdrbuf   = undefined //partial header buffer
  this.f_framelen = undefined //framelen for current receiveing frame
  this.f_sofar    = 0         //bytes received for current frame sofar
  this.f_nreads   = 0         //number of 'data' events for current frame

  this.id = "Frap<"
    + this.sk.remoteAddress
    + ":"
    + this.sk.remotePort
    + ">"

  var self = this
  function sk_onData(buf) {
    if (Frap.VERBOSE)
      logf("onData: self.f_state=%s; buf.length=%d;",
            self.f_state, buf.length)

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

  function sk_onEnd()            { self.emit('end') }
  function sk_onError(err)       { self.emit('error', err) }
  function sk_onClose(had_error) { self.emit('close', had_error) }
  function sk_onDrain()          { self.emit('drain') }

  //listen to socket 'data', 'end', 'error', 'close', and maybe 'drain'
  this.sk_listeners = {
    'data'  : sk_onData
  , 'end'   : sk_onEnd
  , 'close' : sk_onClose
  , 'drain' : sk_onDrain
  }
  Object.keys(this.sk_listeners).forEach(function(k){
    self.sk.on(k, self.sk_listeners[k])
  })
  
  if (emit_frames) self.enableEmitFrame()
}
Frap.VERBOSE = 0
Frap.RFrameStream = RFrameStream
Frap.WFrameStream = WFrameStream

util.inherits(Frap, events.EventEmitter)

Frap.prototype.end = function Frap__end() {
  //log((new Error("Frap__end: looking at stack")).stack)
  var self = this
  Object.keys(this.sk_listeners).forEach(function(k){
    self.sk.removeListener(k, self.sk_listeners[k])
  })
  self.sk.end()
}

// sendFrame(buf0, buf1, ..., bufN, [cb])   //send a list of bufs
// sendFrame([buf0, buf1, ..., bufN], [cb]) //send a single array of bufs
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

  if (Frap.VERBOSE) logf("bufs.length=%d; tot=%d;", bufs.length, tot)

  function _cleanup() {
    //nothing for now
  }

  var flushed, i=0, wstream = this.createWriteStream(tot, _cleanup)

  function _write_more() {
    flushed = true
    while (i<bufs.length) {
      //logf("Frap__send: calling wstream.write(bufs[%d])", i)

      //will cause an wstream.end() here on last buf in bufs
      //  aka (i === buf.length-1).
      //wstream.end() will emit a 'close' event
      //all this is regardless of whether the write() flushed
      flushed = wstream.write(bufs[i])
      i += 1
      if (!flushed) break
    }

    if (i < bufs.length) { //still have writes pending
      //last write MUST have not flushed, else we'd have finished writting
      // so we expect a 'drain'
      wstream.once('drain', _write_more) //continue writing on 'drain'
      return false //regardless
    }
    else { //no pending writes
      if (flushed) { //no pending drains
        //das ist alles
        //Never do callback immediately, cuz of danger of recusive send calls
        if (cb) process.nextTick(cb)
        return true
      }
      else {
        //do callback on 'drain'
        if (cb) wstream.on('drain', cb)
        return false
      }
    }
  }

  return _write_more() //true means it was sent immediately
} //end: send

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
    if (Frap.VERBOSE) logf("onBegin: framelen=%d;", framelen)

    var bufs = []

    rstream.on('data', function _onData(buf, off) {
      if (Frap.VERBOSE)
        logf("rstream.on 'data': buf.length=%d; off=%d;", buf.length, off)

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
function Frap__createWriteStream(framelen, cb) {
  if (this._wstream) throw new Error("currently writing a frame")
  
  this._wstream = new WFrameStream(this, framelen)

  var self = this
  this._wstream.once('close', function() {
    delete self._wstream
    if (cb) cb()
  })
  
  return this._wstream
}

Frap.prototype.createReadStream =
function Frap__createReadStream(framelen) {
  if (this._rstream) throw new Error("currently reading a frame")
  
  this._rstream = new RFrameStream(this, framelen)

  var self = this
  this._rstream.once('end', function(err) {
    delete self._rstream
  })

  return this._rstream
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
    , sofar = this.f_sofar

  if (Frap.VERBOSE)
    logf("readFrame: datalen=%d; framelen=%d;", datalen, framelen)

  var rstream = this.createReadStream(framelen)
  this.emit('begin', rstream, framelen)

  var pbuf
  if (datalen === framelen) { //whole frame came in first read
    if (Frap.VERBOSE)
      logf("readFrame: datalen === framelen; %d === %d", datalen, framelen)

    pbuf = buf.slice(4)
    this.emit('part', pbuf, sofar)

    //delete this._cur_recv //relying on onData to fire
    this.f_state    = "frame"
    this.f_hdrbuf   = undefined
    this.f_framelen = undefined
    this.f_sofar    = 0
    this.f_nreads   = 0
  }
  else if (datalen > framelen) { //first read bigger than one frame
    if (Frap.VERBOSE)
      logf("readFrame: datalen > framelen; %d > %d", datalen, framelen)

    pbuf = buf.slice(4, 4+framelen)
    this.emit('part', pbuf, sofar)

    //this.f_header   = "frame"
    //this.f_hdrbuf   = undefined
    this.f_framelen = undefined
    //this.f_sofar    = 0
    this.f_nreads   = 0

    this.readFrame(buf.slice(4+framelen))
  }
  else if (datalen < framelen) { //first read smaller than one frame
    if (Frap.VERBOSE)
      logf("readFrame: datalen < framelen; %d < %d", datalen, framelen)

    if (datalen > 0) {
      pbuf = buf.slice(4)
      this.emit('part', pbuf, sofar)
    }

    this.f_state    = "data"
    //this.f_hdrbuf   = undefined
    //this.f_framelen = framelen
    this.f_sofar    = datalen
    this.f_nreads   = 0
  }
}

Frap.prototype.readData = function Frap__readData(buf) {
  var sofar    = this.f_sofar
    , framelen = this.f_framelen
    , rem      = framelen - sofar

  var start, end
  if (buf.length === rem) {
    if (Frap.VERBOSE)
      logf("readData: buf.length === rem; %d === %d", buf.length, rem)

    this.emit('part', buf, sofar)

    //delete this._cur_recv //relying on onData to fire
    this.f_state    = "frame"
    this.f_hdrbuf   = undefined
    this.f_framelen = undefined
    this.f_sofar    = 0
    this.f_nreads   = 0
  }
  else if (buf.length > rem) {
    if (Frap.VERBOSE)
      logf("readData: buf.length > rem; %d > %d", buf.length, rem)

    var pbuf = buf.slice(0, rem)
    this.emit('part', pbuf, sofar)

    this.f_state    = "frame"
    //this.f_hdrbuf   = undefined
    this.f_framelen = undefined
    this.f_sofar    = 0
    //this.f_nreads   = 0

    this.readFrame(buf.slice(rem))
  }
  else if (buf.length < rem) {
    if (Frap.VERBOSE)
      logf("readData: buf.length < rem; %d < %d", buf.length, rem)

    this.emit('part', buf, sofar)

    //this.f_state    = "data"
    //this.f_hdrbuf   = undefined
    //this.f_framelen = framelen
    this.f_sofar += buf.length
    //this.f_nreads   = 0
  }
}
