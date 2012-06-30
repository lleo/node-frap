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
  this.sofar = 0

  this.pause_cnt = 0
  this.resume_cnt = 0
  this.data_cnt = 0
  
  this.readable = true
  
  var self = this
  function onPart(buf, off) {
    var received = self.sofar + buf.length
    if (received > self.framelen) {
      //throw new Error(format("framelen exceeded: framelen=%d; received=%d;",
      //                       self.framelen, received))
      self.emit('error', format("framelen exceeded: framelen=%d; received=%d;",
                                self.framelen, received))
      return
    }

    if (off !== self.sofar) log("WTF!")

    //log("RFrameStream: this.framelen=%d; this.sofar=%d; off=%d; buf.length=%d;",
    //      self.framelen, self.sofar, off, buf.length)

    self.data_cnt += 1
    self.sofar += buf.length
    self.emit('data', buf, off)

    if (received === self.framelen) {
      self.emit('end')
      self.destroy()
    }
  }
  function onError(e) {
    //log("RFrameStream: 'error' e=%s;", e)
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

  //log("RFrameStream__destroy: counts pause=%d; resume=%d; data=%d;"
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
  this.wrote_cnt = 0
  this.drain_cnt = 0

  this.writable = true

  var self = this
  this.frap_listeners = {
    error: function onError(e) {
      //log(format("wstream: 'error' e=%s;", e));
      self.emit('error', e)
    }
  , end: function onEnd() {
    self.end()
  }
  , close: function onClose(had_error) {
      self.close()
    }
  }
  this.sk_listeners = {
    drain: function onDrain() {
      self.drain_cnt += 1
      //log("WFrameStream: onDrain drain_cnt=%d", self.drain_cnt)
      self.emit('drain')
    }
  }

  Object.keys(this.frap_listeners).forEach(function(k){
    self.frap.on(k, self.frap_listeners[k])
  })
  Object.keys(this.sk_listeners).forEach(function(k){
    self.frap.sk.on(k, self.sk_listeners[k])
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

  var flushed, hdrbuf
  if (!this.hdr_sent) {
    hdrbuf = new Buffer(4)
    hdrbuf.writeUInt32BE(this.framelen, 0)
    this.hdr_sent = true
    this.frap.sk.write(hdrbuf)
  }

  this.write_cnt += 1
  flushed = this.frap.sk.write(buf)

  if (this.sofar === this.framelen) {
    //log("WFrameStream__write: complete; calling WFrameStream__end")
    this.end()

    var self = this
    if (flushed) {
      this.wrote_cnt += 1
      this.close()
    }
    else {
      //waiting on sk 'drain' event also causes wstream.close() to to
      // be called asynchronously (ie no stack explosion)
      this.frap.sk.once('drain', function(){
        self.wrote_cnt += 1
        self.close()
      })
    }
  }

  return flushed
}

WFrameStream.prototype.end =
function WFrameStream__end() {
  //log("WFrameStream__end: called")
  //if (arguments.length > 0) throw new Error("writing on end not supported")
  assert(arguments.length === 0, "writing on end not supported")

  if (this.isended) return

  if (this.sofar < this.framelen) {
    //throw new Error("wstream ended before frame completly written")
    this.emit('error', "wstream ended before frame completly written")
    return
  }

  //log("WFrameStream__end: counts pause=%d; resume=%d; write=%d; wrote=%d;",
  //    this.pause_cnt, this.resume_cnt, this.write_cnt, this.wrote_cnt)

  var self = this
  Object.keys(this.frap_listeners).forEach(function(k){
    self.frap.removeListener(k, self.frap_listeners[k])
  })
  Object.keys(this.sk_listeners).forEach(function(k){
    self.frap.sk.removeListener(k, self.sk_listeners[k])
  })

  this.writable = false
  this.isended = true
}

WFrameStream.prototype.close =
function WFrameStream__close() {
  //log("WFrameStream__close: called")
  //log((new Error("WFrameStream__close: looking at the stack")).stack)

  this.end() //probably redundent but so what

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
  this.close()
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
