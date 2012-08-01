var events = require('events')
  , Stream = require('stream')
  , util = require('util')
  , assert = require('assert')

exports.ReadFrameStream = ReadFrameStream
function ReadFrameStream(frap, framelen) {
  Stream.call(this)

  this.frap = frap
  this.framelen = framelen
  this.pos = 0

  this.readable = true

  var self = this
  function onPart(buf, pos) {
    assert(buf.length+pos <= self.framelen, "attempted to stream more than framelen bytes")

    self.pos += buf.length

    if (self.defaultEncoding)
      self.emit('data', buf.toString(self.defaultEncoding))
    else
      self.emit('data', buf)
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
  this.frap.pause()
}

ReadFrameStream.prototype.resume =
function ReadFrameStream__resume(encoding) {
  this.frap.resume()
}

ReadFrameStream.prototype.destroy =
function ReadFrameStream__destroy() {
  this.frap.removeListener('part', this.onPart)

  assert(this.pos === this.framelen, "did not stream framelen bytes")

  this.emit('end')

  this.emit('close')
}

exports.WriteFrameStream = WriteFrameStream
function WriteFrameStream(frap, framelen) {
  Stream.call(this)

  this.frap = frap
  this.draining = false
  this.writable = true

  this.framelen = framelen
  this.pos = 0
//  this.hdr_sent = false

  var hdrbuf = new Buffer(4)
  hdrbuf.writeUInt32BE(framelen, 0)
  frap.sk.write(hdrbuf)
}

util.inherits(WriteFrameStream, Stream)

WriteFrameStream.prototype.write =
function WriteFrameStream__write(buf, enc) {
  assert.ok(this.writable)
  if (toString.call(buf) === '[object String]') {
    buf = new Buffer(buf, enc)
  }

//  if (!this.hdr_sent) {
//    hdrbuf = new Buffer(4)
//    hdrbuf.writeUInt32BE(this.framelen, 0)
//    this.hdr_sent = true
//    this.frap.sk.write(hdrbuf)
//  }

  assert(buf.length+this.pos <= this.framelen, "attempted to write more than framelen bytes")

  var flushed = this.frap.sk.write(buf)
  this.pos += buf.length

  var self = this
  if (!flushed) {
    this.draining = true
    this.frap.sk.once('drain', function() {
      self.draining = false
      self.emit('drain')
    })
  }

  return flushed
}

WriteFrameStream.prototype.end =
function WriteFrameStream__end(buf, enc) {
  if (buf) this.write(buf,enc)
  assert(this.pos === this.framelen, "did not send full framelen bytes")
  this.writable = false
}

WriteFrameStream.prototype.destroy =
function WriteFrameStream__destroy() {
  this.end()
  this.emit('close')
}

WriteFrameStream.prototype.destroySoon =
function WriteFrameStream__destroySoon() {
  var self = this
  if (this.draining) {
    this.once('drain', function(){
      self.destroy()
    })
  }
  else {
    process.nextTick(function(){
      self.destroy()
    })
  }
}
