var util = require('util')
  , assert = require('assert')
  , format = util.format
  , inspect = util.inspect
  , FrapReader = require('./frap_reader')
  , frap_stream = require('./frap_stream')
  , ReadFrameStream = frap_stream.ReadFrameStream
  , WriteFrameStream = frap_stream.WriteFrameStream
  , Dequeue = require('dequeue')
  , Stream = require('stream')
  , u = require('underscore')
  , log = console.log

var DEFAULT_OPTIONS = { emit: 'data' }

var Frap = function Frap(sk, opt) {
  opt = u.defaults(opt||{}, DEFAULT_OPTIONS)
  FrapReader.call(this, opt)

  this.sk = sk

  //writing flags
  this.writing = false
  this.draining = false

  //Stream API
  this.readable = true
  this.writable = true

  this.wstream = undefined
  this.rstream = undefined

  var self = this

  function onSkData(buf) {
    if (Frap.VERBOSE) log("Frap: onSkData: buf.length=%d;", buf.length)
    self.parse(buf)
    self.dispatch()
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
    self.destroySoon()
  }
  function onSkClose(had_error) {
    if (Frap.VERBOSE) log("Frap: onSkClose: had_error=%j", had_error)
    self.destroy()
  }
  this.sk.once('end', onSkEnd)
  this.sk.once('close', onSkClose)
}
Frap.VERBOSE = 0

util.inherits(Frap, FrapReader)

exports = module.exports = Frap
Frap.Frap = Frap
Frap.ReadFrameStream = ReadFrameStream
Frap.WriteFrameStream = WriteFrameStream
Frap.FrapReader = FrapReader

Frap.prototype.pause =
function Frap__pause() {
  if (Frap.VERBOSE) log("Frap__pause: this.paused=%j", this.paused)
  Frap.super_.prototype.pause.call(this)
  this.sk.pause()
}

Frap.prototype.resume =
function Frap__resume() {
  Frap.super_.prototype.resume.call(this)
  if (!this.paused) this.sk.resume()
}

// STREAM API
//
Frap.prototype.end = function Frap__end(buf, enc) {
  if (this.didEnd) return
  this.didEnd = true

  if (Frap.VERBOSE) log("Frap__end: called")

  var rv = true
  if (buf)  rv = this.write(buf, enc)

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

  if (this.wstream) this.wstream.destroy()
  if (this.rstream) this.rstream.destroy()

  //delete this.sk

  this.emit('close')
}

Frap.prototype.destroySoon = function Frap__destroySoon() {
  if (this.didDestroySoon || this.didDestroy) return
  this.didDestroySoon = true

  var self = this
  if (this.draining) {
    this.once('drain', function(){ self.destroy() })
    return
  }
  if (this.wstream) {
    this.wstream.once('close', function(){ self.destroy() })
    return
  }
  self.destroy()
}

Frap.prototype.pipe = function Frap__pipe(dst) {
  var src = this

  if (!(dst instanceof Frap)) {
    if (Frap.VERBOSE) log("Frap__pipe: using Stream.prototype.pipe")
    //Stream.prototype.pipe.call(src, dst)
    //Frap.super_ is FrapReader and FrapReader isa Stream
    Frap.super_.prototype.pipe.call(src, dst)
    return
  }

  function pipeOnHeader(framelen){
    var rstream = src.createReadFrameStream(framelen)
      , wstream = dst.createWriteFrameStream(framelen)

    rstream.once('end', function(){
      if (Frap.VERBOSE) log("Frap__pipe: pipeOnHeader: rstream once 'end': src.pause()")
      src.pause()
    })

    rstream.once('close', function(){
      //We use destroySoon() cuz it waits on any pending writes.
      // if we used destroy() event listeners would build up on the socket
      // waiting on 'drain' events. destroySoon() waits till socket 'drain'
      // listeners expire, before a new one can be set.
      if (Frap.VERBOSE) log("Frap__pipe: pipeOnHeader: rstream.once 'close': wstream.destroySoon()")
      wstream.destroySoon()
    })

    wstream.once('close', function(){
      if (Frap.VERBOSE) log("Frap__pipe: pipeOnHeader: wstream.once 'close': src.resume()")
      src.resume()
    })

    rstream.pipe(wstream)
  } //pipeOnHeader
  src.on('header', pipeOnHeader)

  function cleanup() {
    if (Frap.VERBOSE) log("Frap__pipe: cleanup: removing pipeOnHeader")
    src.removeListener('header', pipeOnHeader)
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
    dst.destroySoon()
  }
  src.once('close', pipeOnClose)

  //FIXME: need pipeOnError

  this.emit('pipe')
}

Frap.prototype.write = function Frap__write(buf, enc){
  if (toString.call(buf) === '[object String]') {
    buf = new Buffer(buf, enc)
  }

  var rv = this.sendFrame(buf)

  return rv
}

// sendFrame(buf0, buf1, ..., bufN)   //send a list of bufs
// sendFrame([buf0, buf1, ..., bufN]) //send a single array of bufs
Frap.prototype.sendFrame = function sendFrameSkDirect() {
  assert.ok(this.writable)
  var bufs = Array.prototype.slice.call(arguments)

  if (bufs.length === 1 && Array.isArray(bufs[0])) {
    bufs = bufs[0]
  }

  assert(bufs.length > 0, "WTF trying to send less than 1 buf")
  //if (bufs.length < 1) return

  var i, framelen = 0
  for (i=0; i<bufs.length; i++) { framelen += bufs[i].length }

  var sent
    , hdrbuf = new Buffer(4)

  hdrbuf.writeUInt32BE(framelen, 0)
  sent = this.sk.write(hdrbuf)

  for (i=0; i<bufs.length; i++) {
    sent = this.sk.write(bufs[i])
    if (Frap.VERBOSE) log("Frap__sendFrame: wrote busf[%d].length=%d; => %j", i, bufs[i].length, sent)
  }

  if (!sent) {
    if (!this.draining) {
      var self = this
      this.draining = true
      if (Frap.VERBOSE) log("Frap__sendFrame: set once 'drain'")
      this.sk.once('drain', function(){
        if (Frap.VERBOSE) log("Frap__sendFrame: drained")
        self.writing = false
        self.draining = false
        self.emit('drain')
      })
    }
  }
  else
    this.writing = false

  return sent
}

Frap.prototype.createWriteFrameStream =
function Frap__createWriteFrameStream(framelen) {
  assert(this.wstream == null, "currently writing a frame")

  this.writing = true
  var wstream = new WriteFrameStream(this, framelen)

  this.wstream = wstream
  var self = this
  this.wstream.once('close', function() {
    self.wstream = undefined
    self.writing = false
  })

  return wstream
}

Frap.prototype.createReadFrameStream =
function Frap__createReadFrameStream(framelen) {
  assert(this.rstream == null, "currently reading a frame")

  var rstream = new ReadFrameStream(this, framelen)

  this.rstream = rstream
  var self = this
  this.rstream.once('end', function(err) {
    self.rstream = undefined
  })

  this.once('fin', function(){ self.rstream.destroy() })

  return rstream
}
