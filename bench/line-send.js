#!/usr/bin/env node

var net = require('net')
  , nomnom = require('nomnom')
  , log = console.log

var opt = nomnom.script('raw-send.js')
  .option('port', {
    abbr: 'p'
  , flag: false
  , default: 7000
  , help: 'connect port; default 7000'
  })
  .option('nfrms', {
    abbr: 'n'
  , flag: false
  , default: 1000
  , help: 'number of frames to send; default 1000'
  })
  .option('datasize', {
    abbr: 'z'
  , flag: false
  , default: 0
  , help: "add a property to the json object this bytes big; 0 disables"
  })
  .parse()

var gen = (function(){ //just for a closure scope
  var i=0
  return function _gen() {
    return (new Array(opt.datasize+1)).join('X')
  }
})() //end scope


var EventEmitter = require('events').EventEmitter
function LineParser(src) {
  EventEmitter.call(this)

  this.s = ""

  var self = this
  src.on('data', function(buf){
    var si = 0, ei

    self.s += buf.toString('utf8')

    while((ei = self.s.indexOf("\n",si)) !== -1) {
      self.emit('line', self.s.substring(si, ei))
      si = ei+1
    }
    self.s = self.s.substring(si)
  })
  
  src.on('end', function(){
    self.emit('end')
  })
  src.on('close', function(){
    self.emit('close')
  })
}
require('util').inherits(LineParser, EventEmitter)

var sk = net.createConnection(opt.port, function() {
  var bytes_recv = 0
    , bytes_sent = 0
    , nsent = 0
    , nrecv = 0
    , all_sent = false
    , t0 = Date.now()

  lineparser = new LineParser(sk)
  lineparser.on('line', function(line){
    //log("line: %s", line)
    nrecv += 1
    //log("nsent=%d; nrecv=%d;", nsent, nrecv)
    if (all_sent && nrecv === nsent) {
      sk.end()
    }
  })

  sk.on('data', function(buf){
    bytes_recv += buf.length
    if (all_sent && bytes_recv === bytes_sent) {
      log("bytes per second: %d", bytes_recv / ((Date.now()-t0)/1000))
      //sk.end()
    }
  })

  var i=0
    , buf = new Buffer(gen()+"\n", 'utf8')
  function send() {
    var o, str, sent
    while ( i < opt.nfrms ) {
      bytes_sent += buf.length
      nsent += 1

      sent = sk.write(buf)
      //log("sk.write: buf.length=%d => %j", buf.length, sent)
      i += 1

      if (!sent) {
        sk.once('drain', send)
        return
      }
    } //while
    all_sent = true
  } //send

  send()
})