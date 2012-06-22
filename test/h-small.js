#!/usr/bin/env node

var net = require('net')
  , log = console.log
  , format = require('util').format
  , inspect = require('util').inspect
  , Frap = require('frap').Frap
  , nomnom = require('nomnom')
  , u = require('underscore')

var VERBOSE=0
var opt = nomnom.script('t-frap-cli')
  .option('verbose', {
    abbr: 'v'
  , flag: true
  , help: 'show more output'
  , callback: function() {
    VERBOSE += 1
    if (VERBOSE>1) {
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
  log("%s> start_sending: iters=%d", cli.id, cli.iters)

  var o, str, buf, i, t0
  for (i=0; i<cli.iters; i++) {
    o = gen()
    str = JSON.stringify(o)
    buf = new Buffer(str, 'utf8')

    cli.frap.send(buf)
    cli.outstanding[o.seq] = o
  }
  log("%s> sending done", cli.id)
}

cli.sk = net.createConnection(opt.port, function() {
  cli.id = format("%s:%d", cli.sk.remoteAddress, cli.sk.remotePort)
  cli.frap = new Frap(cli.sk)

  function onDrain() {
    log("%s> drain", cli.id)
    cli.sk.end()
  }
  cli.frap.on('drain', onDrain)

  function onFrame(buf){
    var o = JSON.parse(buf.toString())
    if (cli.outstanding[o.seq]) {
      if (VERBOSE)
        log("%s> received known o = %j", cli.id, o)
      delete cli.outstanding[o.seq]
    }
    else {
      log("%s> onFrame: unknown seq=%d", cli.id, o.seq)
    }
  }
  cli.frap.on('frame', onFrame)

  function onError(err){
    log("%s> error:", cli.id, err)
    cli.sk.end()
  }
  cli.frap.on('error', onError)

  start_sending(cli.frap, cli.iters)
})

function _end() {
  if (cli.isended) {
    log("%s> _end: already called", cli.id)
    return
  }
  delete cli.frap
  delete cli.sk
  cli.isended = true
}
cli.sk.once('end', function() {
  log("%s> end", cli.id)
  cli.sk.end()
  _end()
})

cli.sk.once('close', function(had_error) {
  log("%s> close: had_error=%j", cli.id, had_error)
  if (!cli.isended) {
    log("%s> close: calling _end", cli.id)
    _end()
  }
})
