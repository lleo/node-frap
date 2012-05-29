var events = require('events')
  , Stream = require('stream')
  , util = require('util')
  , assert = require('assert')
  , log = console.log
  , format = util.format

function _prop(value, writable, enumerable, configurable) {
  return {
    value: value
  , writable: writable ? true : false
  , enumerable: enumerable ? true : false
  , configurable: configurable ? true : false
  }
}

var RFrameStream = exports.RFrameStream = function RFrameStream(frap, framelen) {
  var self = this
  Stream.call(self)
  
//  this.frap = frap
//  this.framelen = framlen
//  this.sofar = 0
  
  Object.defineProperty(self, 'frap',     _prop(frap    , false, true, true ))
  Object.defineProperty(self, 'framelen', _prop(framelen, false, true, false))
  Object.defineProperty(self, 'sofar',    _prop(0       , true, false, false))

  var readable = true
  Object.defineProperty(self, 'readable', {
    get: function() { return readable }
  , set: function(v) { return readable = ( v ? true : false ) }
  , enumerable: true
  , configurable: false
  })
  
  var onPartial, onError, onClose, onEnd
  onPartial = function(buf) {
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
    self.emit('error', e)
    self.destroy()
  }
  onClose = function() {
    self.emit('close')
    self.destroy()
  }
  onEnd   = function() {
    self.emit('end')
    self.destroy()
  }
  
  var frap_listeners = {
    'partial': onPartial
  , 'error'  : onError
  , 'close'  : onClose
  , 'end'    : onEnd
  }

  Object.defineProperty(self, 'frap_listeners', {value: frap_listeners})
  
  Object.keys(frap_listeners).forEach(function(ev){
    self.frap.on(ev, self.frap_listeners[ev])
  })
}

util.inherits(RFrameStream, Stream)

RFrameStream.prototype.setEncoding =
function RFrameStream__setEncoding(encoding) {
  this._defaultEncoding = encoding
}

RFrameStream.prototype.pause = 
function RFrameStream__pause(encoding) {
  this.frap.socket.pause()
}

RFrameStream.prototype.resume =
function RFrameStream__resume(encoding) {
  this.frap.socket.resume()
}

RFrameStream.prototype.destroy =
function RFrameStream__destroy(encoding) {
  Object.keys(self.frap_listeners).forEach(function(k){
    self.frap.removeListeners(k, self.frap_listeners[k])
  })
  delete this.frap
}

var WFrameStream = exports.WFrameStream = function WFrameStream(frap, framelen) {
  Stream.call(this)

  //this.frap = frap
  //this.framelen = framelen
  //this.sofar = 0

  Object.defineProperty(this, 'frap'    , _prop(frap    , false, true, true ))
  Object.defineProperty(this, 'framelen', _prop(framelen, false, true, false))
  Object.defineProperty(this, 'sofar'   , _prop(0       , true, false, false))

  var writable = true
  Object.defineProperty(this, 'writable', {
    get: function() { return writable }
  , set: function(v) { return writable = ( v ? true : false ) }
  , enumerable: true
  , configurable: false
  })

//  this.frap_listeners = {
//    drain: (function onDrain()  { this.emit('drain') }).bind(this)
//  , error: (function onError(e) { this.emit('error', e) }).bind(this)
//  , close: (function onClose()  { this.end() }).bind(this)
//  }
//  Object.keys(this.frap_listeners).forEach(function(k){
//    this.frap.on(k, this.frap_listeners[k])
//  })
}

util.inherits(WFrameStream, Stream)

WFrameStream.prototype.setEncoding =
function WFrameStream__setEncoding(encoding) {
  this._defaultEncoding = encoding
}

WFrameStream.prototype.pause = 
function WFrameStream__pause() {
  this.frap.socket.pause()
}

WFrameStream.prototype.resume =
function WFrameStream__resume() {
  this.frap.socket.resume()
}

WFrameStream.prototype.write =
function WFrameStream__write(buf, enc) {
  if (toString.call(buf) === '[object String]') {
    enc = enc || this._defaultEncoding
    buf = new Buffer(buf, enc)
  }

  if (this.sofar + buf.length > this.framelen) {
    throw new Error("tried to send to much")
  }

  this.sofar += buf.length

  var rv = this.frap.sendPartial(buf)

  if (this.sofar === this.framelen) {
    this.end()
  }

  return rv
}

WFrameStream.prototype.end =
function WFrameStream__end(d, enc) {
  if (this.isended) return

  if (arguments.length > 0) {
    var args = Array.prototype.slice.call(arguments)
    this.write.apply(this, args)
  }

//  Object.keys(this.frap_listeners).forEach(function(k){
//    this.frap.removeListener(k, this.frap_listeners[k])
//  })

  this.writable = false
  this.isended = true
  this.emit('close')
}

WFrameStream.prototype.destroy =
function WFrameStream__destroy() {
  this.end()
  delete this.frap
}

WFrameStream.prototype.destroySoon =
function WFrameStream__destroySoon() {
  var self = this
  process.nextTick(function(){
    self.destroy()
  })
}

