var events = require('events')
  , Stream = require('stream')
  , util = require('util')
  , assert = require('assert')
  , log = console.log
  , format = util.format
  , inspect = util.inspect

var RFrameStream = exports.RFrameStream = function RFrameStream(frap, framelen) {
  Stream.call(this)
  
  this.frap = frap
  this.framelen = framelen
  this.pos = 0

  this.readable = true
  
  var self = this
  function onPart(buf, off) {
    var npos = self.pos + buf.length
    if (npos > self.framelen) {
      self.emit('error', new Error(format("framelen exceeded: framelen=%d; npos=%d; self.pos=%d; buf.length=%d; off=%d;", self.framelen, npos, self.pos, buf.length, off)))
      return
    }

    if (off !== self.pos) log("WTF!")

    if (RFrameStream.VERBOSE) log("RFrameStream: this.framelen=%d; this.pos=%d; off=%d; buf.length=%d;", self.framelen, self.pos, off, buf.length)

    self.emit('data', buf, off)

    self.pos += buf.length

    if (self.pos === self.framelen) {
      if (RFrameStream.VERBOSE) log("RFrameStream onPart: self.pos === self.framelen")
      self.destroy()
    }
  }

  function onError(e) {
    self.emit('error', e)
    self.destroy()
  }
  
  this.frap_listeners = {
    'part'  : onPart
  , 'error' : onError
  }

  Object.keys(this.frap_listeners).forEach(function(ev){
    self.frap.on(ev, self.frap_listeners[ev])
  })

}
RFrameStream.VERBOSE = 0

util.inherits(RFrameStream, Stream)

RFrameStream.prototype.setEncoding =
function RFrameStream__setEncoding(encoding) {
  this.defaultEncoding = encoding
}

RFrameStream.prototype.pause = 
function RFrameStream__pause(encoding) {
  //log("rstream: pause() called")
  this.frap.pause()
}

RFrameStream.prototype.resume =
function RFrameStream__resume(encoding) {
  //log("rstream: resume() called")
  this.frap.resume()
}

RFrameStream.prototype.destroy =
function RFrameStream__destroy() {
  if (RFrameStream.VERBOSE) log("RFrameStream__destroy: called")

  if (!this.frap) {
    if (RFrameStream.VERBOSE) log("RFrameStream__destroy: already destroyed")
    return
  }

  var self = this
  Object.keys(this.frap_listeners).forEach(function(k){
    self.frap.removeListener(k, self.frap_listeners[k])
  })

  this.emit('end')

  delete this.frap
  
  this.emit('close')
}

var WFrameStream = exports.WFrameStream = function WFrameStream(frap, framelen) {
  Stream.call(this)

  this.frap = frap
  this.framelen = framelen
  this.pos = 0
  this.hdr_sent = false
  this.draining = false

  this.writable = true

  var self = this
  this.frap_listeners = {
    error: function onError(e) {
      self.emit('error', e)
    }
  , end: function onEnd() {
      self.end()
    }
  , close: function onClose(had_error) {
      self.destroy()
    }
  }

  Object.keys(this.frap_listeners).forEach(function(k){
    self.frap.on(k, self.frap_listeners[k])
  })
}
WFrameStream.VERBOSE = 0

util.inherits(WFrameStream, Stream)

WFrameStream.prototype.setEncoding =
function WFrameStream__setEncoding(encoding) {
  this.defaultEncoding = encoding
}

WFrameStream.prototype.pause = 
function WFrameStream__pause() {
  log("WFrameStream: pause() called")
}

WFrameStream.prototype.resume =
function WFrameStream__resume() {
  log("WFrameStream: resume() called")
}

WFrameStream.prototype.write =
function WFrameStream__write(buf, enc) {
  assert.ok(this.writable)
  if (toString.call(buf) === '[object String]') {
    enc = enc || this.defaultEncoding
    buf = new Buffer(buf, enc)
  }

  if (this.pos + buf.length > this.framelen) {
    this.emit('error', "tried to send to beyond the end of the frame")
    return
  }

  var flushed, hdrbuf
  if (!this.hdr_sent) {
    hdrbuf = new Buffer(4)
    hdrbuf.writeUInt32BE(this.framelen, 0)
    this.hdr_sent = true
    if (WFrameStream.VERBOSE) log("WFrameStream__write: writing header hdrbuf.length=%d", hdrbuf.length)
    flushed = this.frap.sk.write(hdrbuf)
  }

  if (WFrameStream.VERBOSE) log("WFrameStream__write: writing buf.length=%d", buf.length)
  flushed = this.frap.sk.write(buf)

  this.pos += buf.length

  var self = this
  if (!flushed) {
    if (WFrameStream.VERBOSE) log("WFrameStream__write: write not flushed; waiting on sk 'drain'")
    this.draining = true
    this.frap.sk.once('drain', function() {
      if (WFrameStream.VERBOSE) log("WFrameStream__write: sk 'drain' event")
      self.draining = false
      self.emit('drain')
    })
  }

  //do I need to do this?
  if (this.pos === this.framelen) {
    if (WFrameStream.VERBOSE) log("WFrameStream__write: finished; calling end()")
    this.end()
  }

  return flushed
}

WFrameStream.prototype.end =
function WFrameStream__end(buf, enc) {
  if (this.didEnd) return
  this.didEnd = true

  if (WFrameStream.VERBOSE) log("WFrameStream__end: called")

  assert(arguments.length === 0, "writing on end not supported")
  var flushed
  if (arguments.length > 0) {
    flushed = this.write(buf, enc)
  }

  if (this.pos < this.framelen) {
    this.emit('error', "wstream ended before frame completly written")
    return
  }

  var self = this
  Object.keys(this.frap_listeners).forEach(function(k){
    self.frap.removeListener(k, self.frap_listeners[k])
  })

  this.writable = false
}

WFrameStream.prototype.destroy =
function WFrameStream__destroy() {
  if (this.didDestroySoon) return
  if (this.didDestroy) return
  this.didDestroy = true

  this.end() //probably redundant but so what

  if (WFrameStream.VERBOSE) log("WFrameStream__destroy: called")

  delete this.frap
  this.emit('close')
}

WFrameStream.prototype.destroySoon =
function WFrameStream__destroySoon() {
  if (this.didDestroySoon) return
  this.didDestroySoon = true

  var self = this
  if (this.draining) {
    if (WFrameStream.VERBOSE) log("WFrameStream__destroySoon: waiting on wstream 'drain'")
    this.once('drain', function(){
      if (WFrameStream.VERBOSE) log("WFrameStream__destroySoon: wstream 'drain'")
      self.destroy()
    })
  }
  else {
    self.destroy()
  }
}
