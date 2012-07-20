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
  , u = require('underscore')

function _concat(bufs) {
  if (bufs.length === 1) return bufs[0]

  var tot=0, i
  for (i=0; i<bufs.length; i++) { tot += bufs[i].length }

  var nbuf= new Buffer(tot), off=0
  for (i=0; i< bufs.length; i++) {
    bufs[i].copy(nbuf, off)
    off += bufs[i].length
  }

  return nbuf
}

var concat = Buffer.hasOwnProperty('concat') ? Buffer.concat : _concat

var DEFAULT_OPTIONS = { noframes: false }

var INIT_PARSER_STATE =
{ state   : 'frame'   //'frame', 'data', 'header'
, hdrbuf  : undefined //partial header buffer only valid in 'header' state
, framelen: undefined //framelen for current receiveing frame
, pos     : 0         //current position in the frame
, nreads  : 0         //number of 'data' events for current frame
, buffer  : undefined //current Buffer being parsed
, bufidx  : 0 }       //index into current Buffer

var Frap = function Frap(sk, opt) {
  Stream.call(this)

  opt = u.defaults(opt||{}, DEFAULT_OPTIONS)

  assert(typeof opt.noframes === 'boolean', "noframes not of type 'boolean'")

  this.sk = sk

  //input state
  this.paused = false
  this.eventq = new Dequeue()

  //input parser state
  this.ps = u.clone(INIT_PARSER_STATE)

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
    if (Frap.VERBOSE) log("Frap: onSkData: state=%s; buf.length=%d;", self.ps.state, buf.length)
    self._parse(buf)
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

  if (!opt.noframes) self.enableEmitFrame()
}
Frap.VERBOSE = 0

exports = module.exports = Frap
Frap.Frap = Frap
Frap.RFrameStream = RFrameStream
Frap.WFrameStream = WFrameStream

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
  var self = this
  //this._resume() plays pending event whcih can call this.pause() etcetra
  // ultimately causing a stack explosion
  //process.nextTick(function(){ self._resume() })
  this._resume()
  return
}

Frap.prototype._resume =
function Frap___resume() {
  if (Frap.VERBOSE) log("Frap___resume: called; this.paused=%j", this.paused)
  this.paused = false

  //try to replay event queued during pause
  // NOTE: even with a pause, an already received buffer can contain several
  //       emittable events.
  while (this.eventq.length > 0) {
    var evt = this.eventq.shift()
    this._dispatch.apply(this, evt)
    if (Frap.VERBOSE) log("Frap__resume: dispatching event event=%s", evt[0])
    if (this.paused) break //an event can cause this to pause again
  }

  //if we have not been re-paused, resume the socket
  if (!this.paused) {
    if (Frap.VERBOSE) log("Frap__resume: resuming socket")
    this.sk.resume()
  }

  return
}
Frap.prototype._submit =
function Frap___submit(event, arg1, arg2) {
  if (Frap.VERBOSE) log("Frap___submit: this.paused=%j; event=%s", this.paused, event)
  if (this.paused) {
    this.eventq.push([event, arg1, arg2])
    return
  }
  this._dispatch(event, arg1, arg2)
}

Frap.prototype._dispatch =
function Frap___dispatch(event, arg1, arg2) {
  if (Frap.VERBOSE) log("Frap___dispatch: this.paused=%j; event=%s", this.paused, event)
  switch (event) {
    case 'header':
      var framelen = arg1
        , rstream = this.createReadStream(framelen)
      this.emit('header', rstream, framelen)
      break;
    case 'part':
      var pbuf = arg1
        , pos = arg2
      this.emit('part', pbuf, pos)
      if (pbuf.length+pos === this.rstream.framelen)
        this.rstream.destroy()
      break;
    default:
      throw new Error(format("_dispatch: Unknown event %s", event))
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
  if (this.wstream) {
    this.wstream.destroy()
    this.wstream = undefined
  }
  if (this.rstream) {
    this.rstream.destroy()
    this.rstream = undefined
  }

  //delete this.sk

  this.emit('close')
}

// working on makeing Frap a Stream; not done yet
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
    Stream.prototype.pipe.call(src, dst)
    //Frap.super_.prototype.pipe.call(src, dst)
    //src.__proto__.__proto__.pipe(dst) //?
    return
  }

  function pipeOnHeader(rstream, framelen){
    var wstream = dst.createWriteStream(framelen)

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

// sendFrame(buf0, buf1, ..., bufN)   //send a list of bufs
// sendFrame([buf0, buf1, ..., bufN]) //send a single array of bufs
Frap.prototype.sendFrame = sendFrameSkDirect
//Frap.prototype.sendFrame = sendFrameWstreamDirect

function sendFrameSkDirect() {
  assert.ok(this.writable)
  assert.ok(!this.writing, "currently writing")
  var bufs = Array.prototype.slice.call(arguments)

  if (bufs.length === 1 && Array.isArray(bufs[0])) {
    bufs = bufs[0]
  }

  if (bufs.length < 1) return

  var framelen = 0, i
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
function sendFrameWstreamDirect() {
  assert.ok(this.writable)
  assert.ok(!this.writing, "currently writing")
  var bufs = Array.prototype.slice.call(arguments)

  if (bufs.length === 1 && Array.isArray(bufs[0])) {
    bufs = bufs[0]
  }

  if (bufs.length < 1) return

  var framelen = 0, i
  for (i=0; i<bufs.length; i++) { framelen += bufs[i].length }

  var sent, wstream = this.createWriteStream(framelen)

  for (i=0; i<bufs.length; i++) {
    sent = wstream.write(bufs[i])
  }

  var self = this
  wstream.once('close', function(){
    if (!sent) self.emit('drain')
  })

  wstream.destroySoon() //destroys after drain; else destroys immediatly

  return sent
}

Frap.prototype.enableEmitFrame = function Frap__enableEmitFrame() {
  var self = this

  self.frame = {}
  
  function onHeader(rstream, framelen) {
    assert(self.frame !== undefined, "onHeader: self.frame is undefined")
    //if (Frap.VERBOSE) log("onHeader: framelen=%d;", framelen)

    var bufs = []

    function _onData(buf, off) {
      //if (Frap.VERBOSE) log("rstream.on 'data': buf.length=%d; off=%d;", buf.length, off)

      bufs.push(buf)

      if (off+buf.length === framelen) {
        self.emit('frame', bufs, framelen)
        if (self.listeners('data').length > 0) {
          var fbuf = concat(bufs, framelen)
          //FIXME: if I implement setEncoding() I have to toString() this buf
          self.emit('data', fbuf)
        }
      }
    } //_onData

    rstream.on('data', _onData)
  } //onHeader

  self.frame.onHeader = onHeader

  self.on('header', onHeader)
}

Frap.prototype.disableEmitFrame = function Frap__disableEmitFrame() {
  self.removeListener('header', self.frame.onHeader)
  ;delete self.frame
}


Frap.prototype.createWriteStream =
function Frap__createWriteStream(framelen) {
  assert(this.wstream == null, "currently writing a frame")

  this.writing = true
  var wstream = new WFrameStream(this, framelen)

  this.wstream = wstream
  var self = this
  this.wstream.once('close', function() {
    self.wstream = undefined
    self.writing = false
  })

  return wstream
}

Frap.prototype.createReadStream =
function Frap__createReadStream(framelen) {
  assert(this.rstream == null, "currently reading a frame")
  
  var rstream = new RFrameStream(this, framelen)

  this.rstream = rstream
  var self = this
  this.rstream.once('end', function(err) {
    self.rstream = undefined
  })

  return rstream
}

//Parser Routines
//
Frap.prototype._parse = function Frap___parse(buf) {
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

Frap.prototype._parseHeader = function Frap___parseHeader() {
  var need = 4 - this.ps.hdrbuf.length
    , nbuf
  if (Frap.VERBOSE) log("Frap___parseHeader; need=%d; got=%d;", need, this.ps.buffer.length)
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

Frap.prototype._parseFrame = function Frap___parseFrame() {
  if (this.ps.buffer.length-this.ps.bufidx < 4) {
    if (Frap.VERBOSE) log("Frap___parseFrame: ps.buffer.length-ps.bufidx < 4; ps.buffer.length=%d; ps.bufidx=%d;", this.ps.buffer.length, this.ps.bufidx)
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

  if (Frap.VERBOSE) log("Frap___parseFrame: datalen=%d; framelen=%d;", datalen, this.ps.framelen)

  this._submit('header', this.ps.framelen)

  var pbuf
  if (datalen === this.ps.framelen) { //complete the frame
    if (Frap.VERBOSE) log("Frap___parseFrame: datalen === framelen; %d === %d", datalen, this.ps.framelen)

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
    if (Frap.VERBOSE) log("Frap___parseFrame: datalen > framelen; %d > %d", datalen, this.ps.framelen)

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
    if (Frap.VERBOSE) log("Frap___parseFrame: datalen < framelen; %d < %d", datalen, this.ps.framelen)

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

Frap.prototype._parseData = function Frap___parseData() {
  var rem = this.ps.framelen - this.ps.pos

  var datalen = this.ps.buffer.length - this.ps.bufidx
    , pbuf

  if (datalen === rem) { //complete the frame
    if (Frap.VERBOSE) log("Frap___parseData: datalen === rem; %d === %d", datalen, rem)

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
    if (Frap.VERBOSE) log("Frap___parseData: datalen > rem; %d > %d", datalen, rem)

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
    if (Frap.VERBOSE) log("Frap___parseData: datalen < rem; %d < %d", datalen, rem)

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
