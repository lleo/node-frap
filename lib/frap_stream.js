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

  this.pause_cnt = 0
  this.resume_cnt = 0
  this.data_cnt = 0
  
  this.readable = true
  
  var self = this
  function onPart(buf, off) {
    var npos = self.pos + buf.length
    if (npos > self.framelen) {
      self.emit('error', new Error(format("framelen exceeded: framelen=%d; npos=%d; self.pos=%d; buf.length=%d; off=%d;", self.framelen, npos, self.pos, buf.length, off)))
      return
    }

    if (off !== self.pos) log("WTF!")

    //log("RFrameStream: this.framelen=%d; this.pos=%d; off=%d; buf.length=%d;",
    //      self.framelen, self.pos, off, buf.length)

    self.emit('data', buf, off)

    self.pos += buf.length

    if (self.pos === self.framelen) {
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

  this.frap.pause()
}

RFrameStream.prototype.resume =
function RFrameStream__resume(encoding) {
  //log("rstream: resume() called")
  this.resume_cnt += 1

  this.frap.resume()
}

RFrameStream.prototype.destroy =
function RFrameStream__destroy() {
  if (RFrameStream.VERBOSE)
    log("RFrameStream__destroy: called")
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

  this.write_cnt = 0
  this.wrote_cnt = 0
  this.drain_cnt = 0

  this.writable = true

  var self = this
  this.frap_listeners = {
    error: function onError(e) {
      //log("WFrameStream: frap 'error' e=%s;", e);
      self.emit('error', e)
    }
  , end: function onEnd() {
      //log("WFrameStream: frap 'end'");
      self.end()
    }
  , close: function onClose(had_error) {
      //log("WFrameStream: frap 'close' has_error=%j;", has_error);
      self.close()
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
    enc = enc || this._defaultEncoding
    buf = new Buffer(buf, enc)
  }
  //log("WFrameStream: write() called: buf.length=%d;", buf.length)

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
  }

  this.write_cnt += 1
  flushed = this.frap.sk.write(buf)

  this.pos += buf.length

  var self = this
  if (!flushed) {
    //log("WFrameStream__write: write not flushed; waiting on 'drain'")
    this.frap.sk.once('drain', function() {
      //log("WFrameStream__write: 'drain' event")
      self.emit('drain')
    })
  }

  if (this.pos === this.framelen) {
    if (flushed) {
      // so that write will complete before 'finished' event fires
      process.nextTick(function(){
        self.wrote_cnt += 1
        self.finished(false)
      })
    }
    else {
      //log("frame write complete; write not flushed; waiting on 'drain'")

      function onDrainFinish() {
        //log("onDrainFinish: frame write complete; 'drain' event")
        self.wrote_cnt += 1
        self.finished(true)
      }
      this.frap.sk.once('drain', onDrainFinish)
    }
  }

  return flushed
}

WFrameStream.prototype.finished = function (ondrain) {
  this.destroy()
  this.emit('finished', ondrain)
  //this.emit('finished', this.write_cnt
  //                    , this.wrote_cnt
  //                    , this.drain_cnt)

}

WFrameStream.prototype.end =
function WFrameStream__end() {
  if (this.isended) return
  this.isended = true

  assert(arguments.length === 0, "writing on end not supported")

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

WFrameStream.prototype.close =
function WFrameStream__close() {
  if (this.isclosed) return
  this.isclosed = true

  this.end() //probably redundent but so what

  this.emit('close')
}

WFrameStream.prototype.destroy =
function WFrameStream__destroy() {
  if (this.isdestroyed) return
  this.isdestroyed = true

  this.close()

  delete this.frap
}

WFrameStream.prototype.destroySoon =
function WFrameStream__destroySoon() {
  var self = this
  process.nextTick(function(){
    self.destroy()
  })
}
