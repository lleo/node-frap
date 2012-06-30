#!/usr/bin/env node

var net = require('net')
  , assert = require('assert')
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
  .option('stats', {
    abbr: 'S'
  , flag: false
  , default: true
  , help: 'turn on stats collection and report via SIGUSR1'
  })
  .parse()

process.on('SIGUSR1', function(){
  if (opt.stats)
    log( sts.toString({values: 'both'}) )
})

process.on('SIGINT', function () {
  log('caught SIGINT')
  if (opt.stats)
    log( sts.toString({value: 'both'}) )
  process.nextTick(function(){ process.exit(0) })
})
process.on('uncaughtException', function(err){
  log("caught:", err)
  process.nextTick(function(){ process.exit(1) })
})

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

if (opt.stats) {
  cli.sk.on('connect', function() {
    stats.createStat('sk recv size', statsmod.Value)
    stats.createStat('sk recv gap', statsmod.Timer, {units:'bytes'})
    stats.createHog('sk recv size semi', 'sk recv size', statsmod.SemiBytes)
//    stats.createHog('sk recv size log', 'sk recv size', statsmod.LogBytes)
    stats.createHog('sk recv gap', 'sk recv gap', statsmod.SemiLogMS)

    var sk_tm
    cli.sk.on('data', function(buf) {
      if (sk_tm) sk_tm()
      sk_tm = stats.get('sk recv gap').start()
      stats.get('sk recv size').set(buf.length)
    })
    
    assert(cli.frap, "cli.frap not set")
    stats.createStat('frap recv gap', statsmod.Timer)
    stats.createStat('frap part size', statsmod.Value, {units:'bytes'})
    stats.createHog('frap recv size', 'sk recv size', statsmod.SemiBytes)
    stats.createHog('frap recv gap', 'sk recv gap', statsmod.SemiLogMS)
    
    var frap_tm, cur_framelen
    cli.frap.on('begin', function(rstream, framelen){
      cur_framelen = framelen
      frap_tm = stats.get('frap recv gap').start()
    })
    cli.frap.on('part', function(buf, sofar){
      if (buf.length + sofar === cur_framelen) {
        //last buf
        frap_tm()
      }
      else {
        frap_tm()
        frap_tm = stats.get('frap recv gap').start()
      }
      stats.get('frap part size').set(buf.length)
    })
  })
  cli.sk.once('end', function() {
    log(stats.toString({values:'both'}))
  })
}
