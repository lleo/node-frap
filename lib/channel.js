var util = require('util')
  , assert = require('assert')
  , log = console.log
  , inspect = util.inspect
  , format = util.format
  , Frap = require('frap').Frap
//  , EventEmitter = require('events').EventEmitter
  , EventEmitter2 = require('eventemitter2').EventEmitter2

var Channel = exports.Channel = function Channel(sk) {
//  EventEmitter.call(this)
  EventEmitter2.call(this)

  Object.defineProperty(this, 'sk', { value: sk })
  Object.defineProperty(this, 'socket', { get: function(){ return this.sk } })
  Object.defineProperty(this, 'frap', { value: new Frap(this.sk) })
  Object.defineProperty(this, 'id', {
    get: function() {
      return 'Channel<'
        + this.socket.remoteAddress
        + ":"
        + this.socket.remotePort
        + ">"
    }
  })
  
  this.frap.on('full', onFrame.bind(this))
}

//util.inherits(Channel, EventEmitter)
util.inherits(Channel, EventEmitter2)

function onFrame(buf) {
  //read u16 - bigendian; offset 0; == string length
  var off = 0
    , len = buf.readUInt16BE(off)
  
  off += 2
  
  //read buf - utf8 string encoding
  var topic = buf.toString('utf8', off, off+len)
    , rem = buf.slice(off+len)
  
  this.emit(topic, rem)
  //this.emit("data", topic, rem)
}

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
  
  this.frap.send(hdrBuf, strBuf, buf)
}
