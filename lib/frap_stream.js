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
  
//  Object.defineProperty(this, 'frap',     _prop(frap    , false, true, true ))
//  Object.defineProperty(this, 'framelen', _prop(framelen, false, true, false))
//  Object.defineProperty(this, 'sofar',    _prop(0       , true, false, false))

  var readable = true
  Object.defineProperty(this, 'readable', {
    get: function() { return readable }
  , set: function(v) { return readable = ( v ? true : false ) }
  , enumerable: true
  , configurable: false
  })
  
  var onPart, onError, onClose, onEnd
  onPart = (function(buf) {
    var received = this.sofar + buf.length
    if (received > this.framelen) {
      throw new Error(format("framelen exceeded: framelen=%d; received=%d;",
                             this.framelen, received))
    }

    this.sofar += buf.length
    this.emit('data', buf)

    if (received === this.framelen) {
      this.emit('end')
      this.destroy()
    }
  }).bind(this)
  onError = (function(e) {
    //log(format("rstream: 'error' e=%s;", e))
    this.emit('error', e)
    this.destroy()
  }).bind(this)
  
  this.frap_listeners = {
    'part'  : onPart
  , 'error' : onError
  }

  var self = this
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
  this.frap.socket.pause()
}

RFrameStream.prototype.resume =
function RFrameStream__resume(encoding) {
  //log("rstream: resume() called")
  this.frap.socket.resume()
}

RFrameStream.prototype.destroy =
function RFrameStream__destroy(encoding) {
  //log("rstream: destroy() called")
  //log((new Error()).stack)
  if (this.destroyed) {
    //log("destroy() called: already destroyed")
    return
  }
  this.destroyed = true

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

  //Object.defineProperty(this, 'frap'    , _prop(frap    , false, true, true ))
  //Object.defineProperty(this, 'framelen', _prop(framelen, false, true, false))
  //Object.defineProperty(this, 'sofar'   , _prop(0       , true, false, false))

  var writable = true
  Object.defineProperty(this, 'writable', {
    get: function() { return writable }
  , set: function(v) { return writable = ( v ? true : false ) }
  , enumerable: true
  , configurable: false
  })

  this.frap_listeners = {
    error: (function onError(e) {
      //log(format("wstream: 'error' e=%s;", e));
      this.emit('error', e)
    }).bind(this)
  , close: (function onClose()  {
      //log("wstream: 'close'");
      this.end()
    }).bind(this)
  }

  this.socket_listeners = {
    drain: (function onDrain()  {
      //log("wstream: 'drain'");
      this.emit('drain')
    }).bind(this)
  }

  var self = this
  Object.keys(this.frap_listeners).forEach(function(k){
    self.frap.on(k, self.frap_listeners[k])
  })

  Object.keys(this.socket_listeners).forEach(function(k){
    self.frap.socket.on(k, self.socket_listeners[k])
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
  this.frap.socket.pause()
}

WFrameStream.prototype.resume =
function WFrameStream__resume() {
  //log("wstream: resume() called")
  this.frap.socket.resume()
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

  var rv = this.frap.sendPartial(buf)

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
