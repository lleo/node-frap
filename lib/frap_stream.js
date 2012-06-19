var events = require('events')
  , Stream = require('stream')
  , util = require('util')
  , assert = require('assert')
  , log = console.log
  , format = util.format
  , inspect = util.inspect

var logf = function() { log(format.apply(this, arguments)) }

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

  this.pause_cnt = 0
  this.resume_cnt = 0
  this.data_cnt = 0
  
  this.readable = true
  
  var self = this
  function frapOnPart(buf, off) {
    var received = self.sofar + buf.length
    if (received > self.framelen) {
      //throw new Error(format("framelen exceeded: framelen=%d; received=%d;",
      //                       self.framelen, received))
      self.emit('error', format("framelen exceeded: framelen=%d; received=%d;",
                                self.framelen, received))
      return
    }

    if (off !== self.sofar) log("WTF!")

    //logf("RFrameStream: this.framelen=%d; this.sofar=%d; off=%d; buf.length=%d;",
    //      self.framelen, self.sofar, off, buf.length)

    self.data_cnt += 1
    self.sofar += buf.length
    self.emit('data', buf, off)

    if (received === self.framelen) {
      self.emit('end')
      self.destroy()
    }
  }
  function frapOnError(e) {
    //logf("RFrameStream: 'error' e=%s;", e)
    self.emit('error', e)
    self.destroy()
  }
  
  this.frap_listeners = {
    'part'  : frapOnPart
  , 'error' : frapOnError
  }

  Object.keys(this.frap_listeners).forEach(function(ev){
    self.frap.on(ev, self.frap_listeners[ev])
  })

}
RFrameStream.VERBOSE = 0

util.inherits(RFrameStream, Stream)

//RFrameStream.prototype.put =
//function RFrameStrem__put(buf) {
//  log("rstream: put() called")
//  this.data_cnt += 1
//  this.emit('data', buf)
//}

RFrameStream.prototype.setEncoding =
function RFrameStream__setEncoding(encoding) {
  this._defaultEncoding = encoding
}

RFrameStream.prototype.pause = 
function RFrameStream__pause(encoding) {
  //log("rstream: pause() called")
  this.pause_cnt += 1
  this.frap.sk.pause()
}

RFrameStream.prototype.resume =
function RFrameStream__resume(encoding) {
  //log("rstream: resume() called")
  this.resume_cnt += 1
  this.frap.sk.resume()
}

RFrameStream.prototype.destroy =
function RFrameStream__destroy() {
  //log("rstream: destroy() called")
  //log((new Error("RFrameStream__destroy:")).stack)
  if (!this.frap) {
    //log("destroy() called: already destroyed")
    return
  }

  //logf("RFrameStream__destroy: counts pause=%d; resume=%d; data=%d;"
  //      , this.pause_cnt, this.resume_cnt, this.data_cnt)

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
  this.hdr_sent = false

  this.pause_cnt = 0
  this.resume_cnt = 0
  this.write_cnt = 0
  this.wrote_cnt = 0 //number of write() returns true
  this.drain_cnt = 0

  this.writable = true

  var self = this
  this.frap_listeners = {
    drain: function onDrain() {
      self.drain_cnt += 1
      //logf("WFrameStream: onDrain drain_cnt=%d", self.drain_cnt)
      self.emit('drain')
    }
  , error: function onError(e) {
      //log(format("wstream: 'error' e=%s;", e));
      self.emit('error', e)
    }
  , close: function onClose(had_error)  {
      log("wstream: 'close'; calling WFrameStream__end");
      self.end()
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
  this._defaultEncoding = encoding
}

WFrameStream.prototype.pause = 
function WFrameStream__pause() {
  //log("wstream: pause() called")
  this.pause_cnt += 1
  this.frap.sk.pause()
}

WFrameStream.prototype.resume =
function WFrameStream__resume() {
  //log("wstream: resume() called")
  this.resume_cnt += 1
  this.frap.sk.resume()
}

WFrameStream.prototype.write =
function WFrameStream__write(buf, enc) {
  assert.ok(this.writable)
  if (toString.call(buf) === '[object String]') {
    enc = enc || this._defaultEncoding
    buf = new Buffer(buf, enc)
  }
  //log(format("wstream: write() called: buf.length=%d;", buf.length))

  if (this.sofar + buf.length > this.framelen) {
    //throw new Error("tried to send to much")
    this.emit('error', "tried to send to beyond the end of the frame")
    return
  }

  this.sofar += buf.length

  var rv, hdrbuf
  if (!this.hdr_sent) {
    hdrbuf = new Buffer(4)
    hdrbuf.writeUInt32BE(this.framelen, 0)
    this.hdr_sent = true
    this.frap.sk.write(hdrbuf)

    /* * this copy is waaayy bad for large writes DUH! * */
    //hdrbuf = new Buffer(4+buf.length)
    //hdrbuf.writeUInt32BE(this.framelen, 0)
    //buf.copy(hdrbuf, 4)
    //this.hdr_sent = true
    //buf = hdrbuf
  }

  this.write_cnt += 1
  rv = this.frap.sk.write(buf)
  if (rv) this.wrote_cnt += 1

  if (this.sofar === this.framelen) {
    //log("WFrameStream__write: complete; calling WFrameStream__end")
    this.end()
  }

  return rv
  //return true
}

WFrameStream.prototype.end =
function WFrameStream__end(d, enc) {
  //log("WFrameStream__end: called")
  //log((new Error("WFrameStream__end: looking at the stack")).stack)
  if (this.isended) return

  if (arguments.length > 0) {
    var args = Array.prototype.slice.call(arguments)
    this.write.apply(this, args)
  }

  if (this.sofar < this.framelen) {
    //throw new Error("wstream ended before frame completly written")
    this.emit('error', "wstream ended before frame completly written")
    return
  }

  //logf("WFrameStream__end: counts pause=%d; resume=%d; write=%d; wrote=%d;",
  //     this.pause_cnt, this.resume_cnt, this.write_cnt, this.wrote_cnt)

  var self = this
  Object.keys(this.frap_listeners).forEach(function(k){
    self.frap.removeListener(k, self.frap_listeners[k])
  })

  this.writable = false
  this.isended = true
  this.emit('close'
            , this.pause_cnt
            , this.resume_cnt
            , this.write_cnt
            , this.wrote_cnt
            , this.drain_cnt)
}

WFrameStream.prototype.destroy =
function WFrameStream__destroy() {
  log("wstream: destroy() called; calling WFrameStream__end")
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
