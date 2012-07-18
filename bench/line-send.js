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
  .option('norecv', {
    abbr: 'R'
  , flag: true
  , default: false
  , help: "don't bother to receive any data"
  })
  .parse()

process.on('uncaughtException', function(err){
  log("caught:", err)
  log("stack:", err.stack)
  process.exit(1)
})

process.on('SIGINT', function () {
  log('caught SIGINT')
  process.nextTick(function(){ process.exit(0) })
})

log(require('path').basename(process.argv[1]), process.argv.slice(2).join(' '))

var gen = (function(){ //just for a closure scope
  var i=0
  return function _gen() {
    return (new Array(opt.datasize+1)).join('X')
  }
})() //end scope


var EventEmitter = require('events').EventEmitter
function LineFilter(src) {
  EventEmitter.call(this)

  this.src = src
  this.s = ""

  var self = this
  src.on('data', function(buf){
    var bos = 0
      , si = self.s.length
      , ei

    self.s += buf.toString('utf8')

    while((ei = self.s.indexOf("\n",si)) !== -1) {
      self.emit('line', self.s.substring(bos, ei))
      bos = si = ei+1
    }
    self.s = self.s.substring(si)
  })

  function onDrain() { self.emit('drain') }
  function onEnd() { self.emit('end') }
  function onClose(had_error) { self.emit('close', had_error) }
  src.on('drain', onDrain)
  src.on('end', onEnd)
  src.on('close', onClose)
}
require('util').inherits(LineFilter, EventEmitter)
LineFilter.prototype.send = function(str) {
  str = str + "\n"
  return this.src.write(str, 'utf8')
}
LineFilter.prototype.end = function() { this.src.end() }

var TTS, TTR
process.once('exit', function(){
  log("TTS=%d TTR=%d", TTS/1000, TTR/1000)
})

var sk = net.createConnection(opt.port, function() {
  var lf = new LineFilter(sk)

  var start = Date.now()

  var bytes_recv = 0
    , bytes_sent = 0
    , all_sent = false
    , nsent = 0
    , nrecv = 0
    , t0 = Date.now()

  if (!opt.norecv) {
    lf.on('line', function(line){
    
      nrecv += 1
      if (nrecv === opt.nfrms) {
        TTR = Date.now() - start
        lf.end()
      }
    })
  }

  var i=0
    , str = gen()
  function send() {
    var o, sent
    while ( i < opt.nfrms ) {
      bytes_sent += Buffer.byteLength(str, 'utf8')
      i += 1

      sent = lf.send(str)
      if (!sent) {
        lf.once('drain', function(){
          nsent += 1
          send()
        })
        return
      }
      nsent += 1
    } //while
    all_sent = true
    TTS = Date.now() - start
    if (opt.norecv) lf.end()
  } //send

  send()
})