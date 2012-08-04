#!/usr/bin/env node

var net = require('net')
  , assert = require('assert')
  , log = console.log
  , Frap = require('..')
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
  , default: 10
  , help: "add a property to the json object this bytes big; default 10"
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
        frap.end()
      }
    })
  }

  var i=0
    , buf = new Buffer(gen(), 'utf8')
    , sent = true
    , start = Date.now()

  //for (i=0; i<opt.nfrms; i++) {
  //  sent = frap.write(buf)
  //}
  //if (!sent) {
  //  frap.on('drain', function(){
  //    TTS = Date.now() - start
  //    if (opt.norecv) frap.end()
  //  })
  //}
  //else {
  //  TTS = Date.now() - start
  //  if (opt.norecv) frap.end()
  //}
  function send() {
    var nsent=0
    sent=true
    while (sent && i<opt.nfrms) {
      i += 1; nsent += 1
      sent = frap.write(buf)
    }
    //log("nsent=%d",nsent)
    if (i<opt.nfrms) frap.once('drain', send)
    else {
      TTS = Date.now() - start
      if (opt.norecv) frap.end()
    }
  }
  send()
})