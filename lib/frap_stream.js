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
  function onPart(buf, pos) {
    if (self.pos + buf.length > self.framelen) {
      self.emit('error', new Error(format("framelen exceeded: framelen=%d; self.pos=%d; buf.length=%d; pos=%d;", self.framelen, self.pos, buf.length, pos)))
      return
    }

    self.emit('data', buf, pos)

    self.pos += buf.length

    if (self.pos === self.framelen) {
      self.destroy()
    }
  }

  this.onPart = onPart
  this.frap.on('part', onPart)
}
RFrameStream.VERBOSE = 0

util.inherits(RFrameStream, Stream)

RFrameStream.prototype.setEncoding =
function RFrameStream__setEncoding(encoding) {
  this.defaultEncoding = encoding
}

RFrameStream.prototype.pause = 
function RFrameStream__pause(encoding) {
  if (RFrameStream.VERBOSE) log("RFrameStream__pause: called")
  this.frap.pause()
}

RFrameStream.prototype.resume =
function RFrameStream__resume(encoding) {
  if (RFrameStream.VERBOSE) log("RFrameStream__resume: called")
  this.frap.resume()
}

RFrameStream.prototype.destroy =
function RFrameStream__destroy() {
  if (RFrameStream.VERBOSE) log("RFrameStream__destroy: called")

  if (!this.frap) {
    if (RFrameStream.VERBOSE) log("RFrameStream__destroy: already destroyed")
    return
  }

  this.frap.removeListener('part', this.onPart)

  this.emit('end')

  //delete this.frap
  this.frap = undefined

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

  this.didEnd = false
  this.didDestroy = false
  this.didDestroySoon = false
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
    flushed = this.frap.sk.write(hdrbuf)
    if (WFrameStream.VERBOSE) log("WFrameStream__write: wrote header hdrbuf.length=%d; flushed=%j", hdrbuf.length, flushed)
  }

  flushed = this.frap.sk.write(buf)
  if (WFrameStream.VERBOSE) log("WFrameStream__write: wrote buf.length=%d; flushed=%j", buf.length, flushed)

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
  //var flushed
  //if (arguments.length > 0) {
  //  flushed = this.write(buf, enc)
  //}

  assert.ok(this.pos === this.framelen)
  //if (this.pos < this.framelen) {
  //  this.emit('error', "wstream ended before frame completly written")
  //  return
  //}

  this.writable = false
}

WFrameStream.prototype.destroy =
function WFrameStream__destroy() {
  if (this.doingDestroySoon) {
    log("WFrameStream__destroy: called while this.doingDestroySoon set")
    return
  }
  if (this.didDestroy) return
  this.didDestroy = true

  if (WFrameStream.VERBOSE) log("WFrameStream__destroy: called")

  this.end() //probably redundant but so what

  this.emit('close')
}

WFrameStream.prototype.destroySoon =
function WFrameStream__destroySoon() {
  if (this.didDestroySoon) return
  this.didDestroySoon = true

  var self = this
  if (this.draining) {
    if (WFrameStream.VERBOSE) log("WFrameStream__destroySoon: waiting on wstream 'drain'")
    this.doingDestroySoon = false
    this.once('drain', function(){
      if (WFrameStream.VERBOSE) log("WFrameStream__destroySoon: wstream 'drain'")
      self.doingDestroySoon = false
      self.destroy()
    })
  }
  else {
    if (WFrameStream.VERBOSE) log("WFrameStream__destroySoon: calling destroy()")
    self.destroy()
  }
}
