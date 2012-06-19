#!/usr/bin/env node

var net = require('net')
  , log = console.log
  , format = require('util').format
  , inspect = require('util').inspect
  , Frap = require('frap').Frap
  , nomnom = require('nomnom')
  , u = require('underscore')
  , logf = useful = require('useful').logf

//var logf = function() { log(format.apply(this, arguments)) }

var VERBOSE=0
var opt = nomnom.script('t-frap-cli')
  .option('verbose', {
    abbr: 'v'
  , flag: true
  , help: 'show more output'
  , callback: function() {
    VERBOSE += 1
    if (VERBOSE) {
      Frap.VERBOSE += 1
      Frap.RFrameStream.VERBOE += 1
      Frap.WFrameStream.VERBOE += 1
    }
  }
  })
  .option('port', {
    abbr: 'p'
  , flag: false
  , default: 7000
  , help: 'connect port'
  })
//  .option('time', {
//    abbr: 't'
//  , flag: false
//  , default: 1
//  , help: 'number of seconds to run hammer test'
//  })
  .option('iters', {
    abbr: 'i'
  , flag: false
  , default: 1000
  , help: 'number of iterations of test to run'
  })
  .parse()


var cli = {
  iters: opt.iters
, frap: undefined
, outstanding: []
}

var gen = (function(){ //just for a closure scope
  var i=0
  return function _gen() {
    var o = { cmd: "noop"
            , seq: i
            , obj: {fee: "foo", fie: "bar", foe: "baz", fum: "biz"} }
    i += 1
    return o
  }
})() //end scope

function start_sending() {
  logf("start_sending: iters=%d", cli.iters)
  var i=0, t0
  function _sent() {
    if (i < cli.iters) {
      _send()
    }
    else {
      var d = Date.now() - t0
        , send_per_sec = (cli.iters/d)*1000
      log("_sent: sending ended;")
      log(" seconds   = %d", d/1000)
      log(" sends/sec = %d", send_per_sec)
      setTimeout(function(){
        log("_sent: calling: frap.end()")
        cli.frap.end()
      }, 1000)
    }
  }
  function _send() {
    var o = gen(), str = JSON.stringify(o), buf = new Buffer(str, 'ascii')
    cli.frap.send(buf, _sent)
    cli.outstanding[o.seq] = o
    i += 1
  }
  t0 = Date.now()
  _send()
}

cli.sk = net.createConnection(opt.port, function() {
  cli.frap = new Frap(cli.sk, true)

  cli.frap.on('frame', function(buf){
    var o = JSON.parse(buf.toString())
    if (cli.outstanding[o.seq]) {
      //logf("received known o = %j", o)
      delete cli.outstanding[o.seq]
    }
    else {
      logf("unknown seq=%d", o.seq)
    }
  })

  cli.frap.on('error', function(err){
    log("error:", err)
    cli.sk.end()
  })
  
  start_sending(cli.frap, cli.iters)
})

//cli.sk.on('connect', function() {
//  cli.frap = new Frap(clisk, true)
//
//  cli.frap.on('frame', function(buf){
//    var o = JSON.parse(buf.toString())
//    if (cli.outstanding[o.seq]) {
//      delete cli.outstanding[o.seq]
//    }
//    else {
//      logf("unknown seq=%d", o.seq)
//    }
//  })
//
//  cli.frap.on('error', function(err){
//    log("error:", err)
//    cli.sk.end()
//  })
//  
//  start_sending(cli.frap, cli.iters)
//})

cli.sk.on('error', function(err) {
  log("error:", err)
})

cli.sk.once('end', function() {
  log("end")
  delete cli.frap
  cli.sk.end()
  delete cli.sk
})

