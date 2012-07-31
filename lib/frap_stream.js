var events = require('events')
  , Stream = require('stream')
  , util = require('util')
  , assert = require('assert')
  , log = console.log
  , format = util.format
  , inspect = util.inspect

exports.ReadFrameStream = ReadFrameStream
function ReadFrameStream(frap, framelen) {
  Stream.call(this)

  this.frap = frap
  this.framelen = framelen

  this.paused = false
  this.readable = true

  var self = this
  function onPart(buf, pos) {
    self.emit('data', buf, pos)
  }
  this.onPart = onPart
  this.frap.on('part', onPart)

}

util.inherits(ReadFrameStream, Stream)

ReadFrameStream.prototype.setEncoding =
function ReadFrameStream__setEncoding(encoding) {
  this.defaultEncoding = encoding
}

ReadFrameStream.prototype.pause =
function ReadFrameStream__pause(encoding) {
  this.paused = true
  this.frap.pause()
}

ReadFrameStream.prototype.resume =
function ReadFrameStream__resume(encoding) {
  this.paused = false
  this.frap.resume()
}

ReadFrameStream.prototype.destroy =
function ReadFrameStream__destroy() {
  this.frap.removeListener('part', this.onPart)

  this.emit('end')

  this.emit('close')
}

exports.WriteFrameStream = WriteFrameStream
function WriteFrameStream(frap, framelen) {
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

util.inherits(WriteFrameStream, Stream)

WriteFrameStream.prototype.setEncoding =
function WriteFrameStream__setEncoding(encoding) {
  this.defaultEncoding = encoding
}

WriteFrameStream.prototype.write =
function WriteFrameStream__write(buf, enc) {
  assert.ok(this.writable)
  if (toString.call(buf) === '[object String]') {
    enc = enc || this.defaultEncoding
    buf = new Buffer(buf, enc)
  }

  if (this.pos + buf.length > this.framelen) {
    this.emit('error', "tried to send to beyond the end of the frame")
    return false
  }

  var flushed, hdrbuf
  if (!this.hdr_sent) {
    hdrbuf = new Buffer(4)
    hdrbuf.writeUInt32BE(this.framelen, 0)
    this.hdr_sent = true
    flushed = this.frap.sk.write(hdrbuf)
  }

  flushed = this.frap.sk.write(buf)

  this.pos += buf.length

  var self = this
  if (!flushed) {
    this.draining = true
    this.frap.sk.once('drain', function() {
      self.draining = false
      self.emit('drain')
    })
  }

  //do I need to do this?
  if (this.pos === this.framelen) {
    this.end()
  }

  return flushed
}

WriteFrameStream.prototype.end =
function WriteFrameStream__end(buf, enc) {
  if (this.didEnd) return
  this.didEnd = true

  assert(arguments.length === 0, "writing on end not supported")
  //var flushed
  //if (arguments.length > 0) {
  //  flushed = this.write(buf, enc)
  //}

  //assert.ok(this.pos === this.framelen)
  if (this.pos < this.framelen) {
    this.emit('error', "wstream ended before frame completly written")
    return
  }

  this.writable = false
}

WriteFrameStream.prototype.destroy =
function WriteFrameStream__destroy() {
  if (this.doingDestroySoon) {
    log("WriteFrameStream__destroy: called while this.doingDestroySoon set")
    return
  }
  if (this.didDestroy) return
  this.didDestroy = true

  this.end() //probably redundant but so what

  this.emit('close')
}

WriteFrameStream.prototype.destroySoon =
function WriteFrameStream__destroySoon() {
  if (this.didDestroySoon) return
  this.didDestroySoon = true

  var self = this
  if (this.draining) {
    this.doingDestroySoon = true
    this.once('drain', function(){
      self.doingDestroySoon = false
      self.destroy()
    })
  }
  else {
    self.destroy()
  }
}
