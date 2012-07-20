var util = require('util')
  , assert = require('assert')
  , log = console.log
  , inspect = util.inspect
  , format = util.format
  , Frap = require('frap').Frap
//  , EventEmitter = require('events').EventEmitter
  , EventEmitter = require('eventemitter2').EventEmitter2

var Channel = exports.Channel = function Channel(sk) {
//  EventEmitter.call(this)
  EventEmitter.call(this)

  this.sk = sk
  this.frap = new Frap(sk)
  this.id = 'Channel<'
    + this.sk.remoteAddress
    + ":"
    + this.sk.remotePort
    + ">"

  var self = this
  this.onData = function onData(buf) {
    //read u16 - bigendian; offset 0; == string length
    var off = 0, len = buf.readUInt16BE(off)
    off += 2

    //read buf - utf8 string encoding
    var topic = buf.toString('utf8', off, off+len)
      , rem = buf.slice(off+len)

    self.emit(topic, rem)
    //self.emit("data", topic, rem)
  }

  this.frap.on('data', this.onData)
}

//util.inherits(Channel, EventEmitter)
util.inherits(Channel, EventEmitter)

function isString(o) { return toString.call(o) === '[object String]' }

Channel.prototype.send = function send(topic, buf, enc) {
  assert.ok(isString(topic))
  if (isString(buf)) {
    buf = new Buffer(buf, enc)
  }
  assert.ok(Buffer.isBuffer(buf))
  
  var strBuf = new Buffer(topic, 'utf8')
    , hdrBuf = new Buffer(2)
  
  hdrBuf.writeUInt16BE(strBuf.length, 0)
  
  this.frap.sendFrame(hdrBuf, strBuf, buf)
}
