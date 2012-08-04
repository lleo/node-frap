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
  , log = console.log

var Frap = function Frap(sk, opt) {
  FrapReader.call(this, opt)

  this.sk = sk

  //writing flags
  this.srcDrainWatcher = undefined
  Object.defineProperty(this, 'draining',
                        {get: function() {
                           return this.srcDrainWatcher != null
                         }
                        })

  Object.defineProperty(this, 'writing',
                        { get: function() {
                            return this.draining || this.wstream != null
                          }
                        })

  //Stream API
  this.readable = true
  this.writable = true

  this.wstream = undefined
  this.rstream = undefined

  var self = this

  function onSkData(buf) {
    self.digest(buf)
  }

  function onSkError(err) {
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
    self.destroySoon()
  }
  function onSkClose(had_error) {
    self.destroy()
  }
  this.sk.once('end', onSkEnd)
  this.sk.once('close', onSkClose)
}

util.inherits(Frap, FrapReader)

exports = module.exports = Frap
Frap.Frap = Frap
Frap.ReadFrameStream = ReadFrameStream
Frap.WriteFrameStream = WriteFrameStream
Frap.FrapReader = FrapReader

Frap.prototype.pause =
function Frap__pause() {
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

  var rv = true
  if (buf)  rv = this.write(buf, enc)

  var self = this
  Object.keys(this.sk_listeners).forEach(function(k){
    self.sk.removeListener(k, self.sk_listeners[k])
  })

  this.readable = false
  this.writable = false

  this.sk.end()

  this.emit('end')

  return rv
}

// STREAM API
//
Frap.prototype.destroy = function Frap__destroy() {
  if (this.didDestroy) return
  this.didDestroy = true

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
    return Frap.super_.prototype.pipe.call(src, dst)
  }

  function pipeOnHeader(framelen){
    var rstream = src.createReadFrameStream(framelen)
      , wstream = dst.createWriteFrameStream(framelen)

    rstream.once('end', function(){
      src.pause()
    })

    rstream.once('close', function(){
      //wstream.destroySoon() //strangely faster WTF?!?
      wstream.destroy()
    })

    wstream.once('close', function(){
      src.resume()
    })

    rstream.pipe(wstream)
  } //pipeOnHeader
  src.on('header', pipeOnHeader)

  function cleanup() {
    src.removeListener('header', pipeOnHeader)
  }

  var didPipeOnEnd = false
  function pipeOnEnd() {
    if (didPipeOnEnd) return
    didPipeOnEnd = true

    cleanup()

    dst.end()
  }
  src.once('end', pipeOnEnd)

  var didPipeOnClose = false
  function pipeOnClose() {
    if (didPipeOnClose) return
    didPipeOnClose = true

    pipeOnEnd()
    dst.destroySoon()
  }
  src.once('close', pipeOnClose)

  //FIXME: need pipeOnError

  this.emit('pipe')
  return dst
}

Frap.prototype.write = function Frap__write(buf, enc){
  if (toString.call(buf) === '[object String]') {
    buf = new Buffer(buf, enc)
  }

  var sent = this.sendFrame(buf)

  return sent
}

// sendFrame(buf0, buf1, ..., bufN)   //send a list of bufs
Frap.prototype.sendFrame = function sendFrame() {
  assert.ok(this.writable)

  var i, framelen = 0
  for (i=0; i<arguments.length; i++) { framelen += arguments[i].length }

  var sent = this.sendHeader(framelen)

  //for zero length frames
  if (arguments.length === 0)
    sent = this.sendPart(new Buffer(0))
  else
    for (i=0; i<arguments.length; i++) {
      sent = this.sendPart(arguments[i])
    }

  //this is not necessary as sendHeader or sendPart would have done it
  //if (!sent) this.setSrcDrainWatcher()

  return sent
}

Frap.prototype.setSrcDrainWatcher = function setSrcDrainWatcher() {
  if (this.draining) return

  var self = this
  this.srcDrainWatcher = function(){
    self.srcDrainWatcher = undefined
    self.emit('drain')
  }
  this.sk.once('drain', this.srcDrainWatcher)
}

Frap.prototype.sendHeader = function sendHeader(framelen) {
  assert.ok(this.writable)
  var sent, hdrbuf = new Buffer(4)

  hdrbuf.writeUInt32BE(framelen, 0)
  sent = this.sk.write(hdrbuf)

  if (!sent) this.setSrcDrainWatcher()

  return sent
}

Frap.prototype.sendPart = function sendPart(buf) {
  assert.ok(this.writable)
  var sent = this.sk.write(buf)
  if (!sent) this.setSrcDrainWatcher()
  return sent
}

Frap.prototype.createWriteFrameStream =
function Frap__createWriteFrameStream(framelen) {
  assert(this.wstream == null, "currently writing a frame")

  var wstream = new WriteFrameStream(this, framelen)

  this.wstream = wstream
  var self = this
  this.wstream.once('close', function() {
    self.wstream = undefined
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
