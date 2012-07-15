#!/usr/bin/env node

var net = require('net')
  , assert = require('assert')
  , log = console.log
  , format = require('util').format
  , inspect = require('util').inspect
  , Frap = require('frap').Frap
  //, Frap = require('frap').SimpleFrap
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
  , default: 0
  , help: "add a property to the json object this bytes big; 0 disables"
  })
  .option('simple', {
    flag: true
  , default: false
  , help: "use SimpleFrap instead of Frap"
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

var Frap
if (opt.simple) {
  Frap = require('frap').SimpleFrap
  if (VERBOSE>1) Frap.VERBOSE += 1
}
else {
  Frap = require('frap').Frap
  if (VERBOSE>1) /* -vv */ Frap.VERBOSE += 1
  if (VERBOSE>2) { //-vvv
    Frap.RFrameStream.VERBOSE += 1
    Frap.WFrameStream.VERBOSE += 1
  }
}

var gen = (function(){ //just for a closure scope
  var i=0
  return function _gen() {
    return (new Array(opt.datasize+1)).join('X')
  }
})() //end scope

var sk = net.createConnection(opt.port, function() {

  var id = format("%s:%d", sk.remoteAddress, sk.remotePort)
    , frap = new Frap(sk)

  var t0 = Date.now()
    , tot = 0
    , nsent = 0
    , nrecv = 0

  function onFrame(buf){
    tot += buf.length
    var s = buf.toString('utf8')
    nrecv += 1
    if (nrecv === opt.nfrms) {
      //log("%s> received all sent: %d === %d; calling sk.end()", id, nsent, nrecv)
      log("bytes per second: %d", tot / ((Date.now()-t0)/1000))
      sk.end()
    }
  }
  frap.on('frame', onFrame)

  var i=0
    , buf = new Buffer(gen(), 'utf8')
  function send() {
    var o, str, sent
    while (i<opt.nfrms) {
      i += 1

      sent = frap.sendFrame(buf)
      if (!sent) {
        frap.on('drain', function(){
          nsent += 1
          send()
        })
        break //while
      }
      nsent += 1
    } //while
  }
  send()

})
