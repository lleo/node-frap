var events = require('events')
  , Stream = require('stream')
  , util = require('util')
  , assert = require('assert')
  , log = console.log
  , format = util.format
  , inspect = util.inspect

function _prop(value, writable, enumerable, configurable) {
  return {
    value: value
  , writable: writable ? true : false
  , enumerable: enumerable ? true : false
  , configurable: configurable ? true : false
  }
}

var RFrameStream = exports.RFrameStream = function RFrameStream(frap, framelen) {
  Stream.call(this)
  
  this.frap = frap
  this.framelen = framelen
  this.sofar = 0
  
  var readable = true
  Object.defineProperty(this, 'readable', {
    get: function() { return readable }
  , set: function(v) { return readable = ( v ? true : false ) }
  , enumerable: true
  , configurable: false
  })
  
  var onPart, onError, onClose, onEnd, self = this
  onPart = function(buf) {
    var received = self.sofar + buf.length
    if (received > self.framelen) {
      throw new Error(format("framelen exceeded: framelen=%d; received=%d;",
                             self.framelen, received))
    }

    self.sofar += buf.length
    self.emit('data', buf)

    if (received === self.framelen) {
      self.emit('end')
      self.destroy()
    }
  }
  onError = function(e) {
    //log(format("rstream: 'error' e=%s;", e))
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

util.inherits(RFrameStream, Stream)

RFrameStream.prototype.put =
function RFrameStrem__put(buf) {
  //log("rstream: put() called")
  this.emit('data', buf)
}

RFrameStream.prototype.setEncoding =
function RFrameStream__setEncoding(encoding) {
  this._defaultEncoding = encoding
}

RFrameStream.prototype.pause = 
function RFrameStream__pause(encoding) {
  //log("rstream: pause() called")
  this.frap.sk.pause()
}

RFrameStream.prototype.resume =
function RFrameStream__resume(encoding) {
  //log("rstream: resume() called")
  this.frap.sk.resume()
}

RFrameStream.prototype.destroy =
function RFrameStream__destroy(encoding) {
  //log("rstream: destroy() called")
  //log((new Error()).stack)
  if (!this.frap) {
    //log("destroy() called: already destroyed")
    return
  }

  var self = this
  Object.keys(this.frap_listeners).forEach(function(k){
    self.frap.removeListener(k, self.frap_listeners[k])
  })

  delete this.frap
}

var WFrameStream = exports.WFrameStream = function WFrameStream(frap, framelen) {
  Stream.call(this)

  this.frap = frap
  this.framelen = framelen
  this.sofar = 0
  this.hdr_send = false

  var writable = true
  Object.defineProperty(this, 'writable', {
    get: function() { return writable }
  , set: function(v) { return writable = ( v ? true : false ) }
  , enumerable: true
  , configurable: false
  })

  var self = this
  this.frap_listeners = {
    error: function onError(e) {
      //log(format("wstream: 'error' e=%s;", e));
      self.emit('error', e)
    }
  , close: function onClose()  {
      //log("wstream: 'close'");
      self.end()
    }
  }

  this.socket_listeners = {
    drain: function onDrain()  {
      //log("wstream: 'drain'");
      self.emit('drain')
    }
  }

  Object.keys(this.frap_listeners).forEach(function(k){
    self.frap.on(k, self.frap_listeners[k])
  })

  Object.keys(this.socket_listeners).forEach(function(k){
    self.frap.sk.on(k, self.socket_listeners[k])
  })
}

util.inherits(WFrameStream, Stream)

WFrameStream.prototype.setEncoding =
function WFrameStream__setEncoding(encoding) {
  this._defaultEncoding = encoding
}

WFrameStream.prototype.pause = 
function WFrameStream__pause() {
  //log("wstream: pause() called")
  this.frap.sk.pause()
}

WFrameStream.prototype.resume =
function WFrameStream__resume() {
  //log("wstream: resume() called")
  this.frap.sk.resume()
}

WFrameStream.prototype.write =
function WFrameStream__write(buf, enc) {
  if (toString.call(buf) === '[object String]') {
    enc = enc || this._defaultEncoding
    buf = new Buffer(buf, enc)
  }
  //log(format("wstream: write() called: buf.length=%d;", buf.length))

  if (this.sofar + buf.length > this.framelen) {
    throw new Error("tried to send to much")
  }

  this.sofar += buf.length

  var rv, nbuf
  if (!this.hdr_sent) {
    nbuf = new Buffer(4+buf.length)
    nbuf.writeUInt32BE(this.framelen, 0)
    buf.copy(nbuf, 4)
    this.hdr_sent = true
    buf = nbuf
  }

  rv = this.frap.sk.write(buf)

  if (this.sofar === this.framelen) {
    //log("WFrameStream__write: complete")
    this.end()
  }

  return rv
}

WFrameStream.prototype.end =
function WFrameStream__end(d, enc) {
  //log("wstream: end() called")
  if (this.isended) return

  if (arguments.length > 0) {
    var args = Array.prototype.slice.call(arguments)
    this.write.apply(this, args)
  }

  var self = this
  Object.keys(this.frap_listeners).forEach(function(k){
    self.frap.removeListener(k, self.frap_listeners[k])
  })

  this.writable = false
  this.isended = true
  this.emit('close')
}

WFrameStream.prototype.destroy =
function WFrameStream__destroy() {
  //log("wstream: destroy() called")
  this.end()
  delete this.frap
}

WFrameStream.prototype.destroySoon =
function WFrameStream__destroySoon() {
  //log("wstream: destroySoon() called")
  var self = this
  process.nextTick(function(){
    self.destroy()
  })
}
