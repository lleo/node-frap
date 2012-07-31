#!/usr/bin/env node

var net = require('net')
  , assert = require('assert')
  , log = console.log
  , Frap = require('..')
  , SimpleFrap = require('../lib/simple_frap').SimpleFrap
  , nomnom = require('nomnom')
  , u = require('underscore')

var VERBOSE=0
var opt = nomnom.script('frap-send')
  .option('verbose', {
    abbr: 'v'
  , flag: true
  , help: 'show more output'
  , callback: function() {
      VERBOSE += 1
      if (VERBOSE > 1) Frap.VERBOSE += 1
    }
  })
  .option('port', {
    abbr: 'p'
  , flag: false
  , default: 7000
  , help: "connect port; default 7000"
  })
  .option('nfrms', {
    abbr: 'n'
  , flag: false
  , default: 1000
  , help: "number of frames to send; default 1000"
  })
  .option('datasize', {
    abbr: 'z'
  , flag: false
  , default: 10
  , help: "add a property to the json object this bytes big; default 10"
  })
  .option('simple', {
    flag: true
  , default: false
  , help: "use SimpleFrap instead of Frap"
  })
  .option('norecv', {
    abbr: 'R'
  , flag: true
  , default: false
  , help: "don't bother to receive any data"
  })
  .parse()

assert.ok(opt.datasize > 0)

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

var Frap
if (opt.simple) {
  Frap = SimpleFrap
  if (VERBOSE>1) Frap.VERBOSE += 1
}
else {
  if (VERBOSE>1) /* -vv */ Frap.VERBOSE += 1
}

var gen = (function(){ //just for a closure scope
  var i=0
  return function _gen() {
    return (new Array(opt.datasize+1)).join('X')
  }
})() //end scope

var TTR, TTS
process.once('exit', function(){
  log("TTS=%d TTR=%d", TTS/1000, TTR/1000)
})


var sk = net.createConnection(opt.port, function()
{
  var frap = new Frap(sk)

  var bytes_recv = 0
    , bytes_sent = 0
    , all_sent = false
    , nsent = 0
    , nrecv = 0
    , t0 = Date.now()

  if (!opt.norecv) {
    frap.on('frame', function(bufs){
      nrecv += 1
      if (nrecv === opt.nfrms) {
        TTR = Date.now() - start
        sk.end()
      }
    })
  }

  var i
    , buf = new Buffer(gen(), 'utf8')
    , sent = true
    , start = Date.now()


  for (i=0; i<opt.nfrms; i++) {
    sent = frap.write(buf)
  }
  if (!sent) {
    frap.on('drain', function(){
      TTS = Date.now() - start
      if (opt.norecv) sk.end()
    })
  }
  else {
    TTS = Date.now() - start
    if (opt.norecv) sk.end()
  }
  //function send() {
  //  var o, str, sent
  //  while ( i < opt.nfrms ) {
  //    bytes_sent += buf.length + 4
  //    i += 1
  //
  //    sent = frap.sendFrame(buf)
  //    if (!sent) {
  //      frap.once('drain', function(){
  //        //log("frap drained")
  //        nsent += 1
  //        send()
  //      })
  //      return
  //    }
  //    nsent += 1
  //  } //while
  //  all_sent = true
  //  TTS = Date.now() - start
  //  if (opt.norecv) sk.end()
  //} //send
  //
  //send()
})