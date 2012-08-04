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
  function onPart(buf, pos, framelen) {
    assert.equal(framelen, self.framelen, "framelen this ReadFrameStream created with not the same as reported via 'part' event")
    assert.equal(pos, self.pos, "pos this ReadFrameStream thinks it is is not the same a reported by the 'part' event")
    assert(buf.length+pos <= framelen, "attempted to stream more than framelen bytes")

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
  this.writable = true
  this.frapDrainWatcher = undefined

  this.framelen = framelen
  this.pos = 0
//  this.hdr_sent = false

  this.frap.sendHeader(this.framelen)
}

util.inherits(WriteFrameStream, Stream)

WriteFrameStream.prototype.write =
function WriteFrameStream__write(buf, enc) {
  assert.ok(this.writable)
  if (toString.call(buf) === '[object String]') {
    buf = new Buffer(buf, enc)
  }

//  if (!this.hdr_sent) {
//    this.frap.sendHeader(this.framelen)
//    this.hdr_sent = true
//  }

  assert(buf.length+this.pos <= this.framelen, "attempted to write more than framelen bytes")

  var flushed = this.frap.sendPart(buf)
  this.pos += buf.length

  var self = this
  if (!flushed) {
    if (!this.frapDrainWatcher) {
      this.frapDrainWatcher = function() {
        self.frapDrainWatcher = undefined
        self.emit('drain')
      }
      this.frap.once('drain', this.frapDrainWatcher)
    }
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
  if (this.frapDrainWatcher)
    this.frap.removeListener('drain', this.frapDrainWatcher)
  this.emit('close')
}

WriteFrameStream.prototype.destroySoon =
function WriteFrameStream__destroySoon() {
  var self = this
  if (this.frapDrainWatcher) {
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
