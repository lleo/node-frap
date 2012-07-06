#!/usr/bin/env node

var net = require('net')
  , assert = require('assert')
  , log = console.log
  , format = require('util').format
  , inspect = require('util').inspect
  , Frap = require('frap').Frap
  , nomnom = require('nomnom')
  , u = require('underscore')

Frap.WFrameStream.VERBOSE += 1

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
      Frap.RFrameStream.VERBOSE += 1
      Frap.WFrameStream.VERBOSE += 1
    }
  }
  })
  .option('port', {
    abbr: 'p'
  , flag: false
  , default: 7000
  , help: 'connect port; default 7000'
  })
  .option('iters', {
    abbr: 'i'
  , flag: false
  , default: 1000
  , help: 'number of iterations of test to run'
  })
  .option('stats', {
    abbr: 'S'
  , flag: true
  , default: false
  , help: 'turn on stats collection and report via SIGUSR1'
  })
  .parse()

process.on('SIGINT', function () {
  log('caught SIGINT')
  if (opt.stats)
    log( stats.toString({values: 'both'}) )
  process.nextTick(function(){ process.exit(0) })
})
//process.on('uncaughtException', function(err){
//  log("caught:", err)
//  process.nextTick(function(){ process.exit(1) })
//})

var cli = {
  iters: opt.iters
, frap: undefined
, sent: 0
, recv: 0
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

cli.sk = net.createConnection(opt.port, function() {
  //cli.sk.setMaxListeners(20)
  //cli.sk.setNoDelay()

  cli.id = format("%s:%d", cli.sk.remoteAddress, cli.sk.remotePort)
  cli.frap = new Frap(cli.sk)

  function onDrain() {
    log("%s> frap drain", cli.id)
    log("h-small.js: calling sk.end() in frap.on 'drain'")
    //cli.sk.end()
  }
  cli.frap.on('drain', onDrain)

  function onFrame(buf){
    var o = JSON.parse(buf.toString())
    cli.recv += 1
    if (cli.recv % 10000 === 0) {
      log("cli.recv = %d", cli.recv)
    }
    if (cli.recv === cli.iters) {
      log("%s> received all sent: %d === %d", cli.id, cli.sent, cli.iters)
      cli.sk.end()
    }
  }
  cli.frap.on('frame', onFrame)

  function onError(err){
    log("%s> error:", cli.id, err)
    log("%s> calling sk.end() in frap.on('error', ...)", cli.id)
    cli.sk.end()
  }
  cli.frap.on('error', onError)

  var o, str, buf, i, t0, sent
  for (i=0; i<cli.iters; i++) {
    o = gen()
    str = JSON.stringify(o)
    buf = new Buffer(str, 'utf8')

    sent = cli.frap.sendFrame(buf)
    cli.sent += 1

    if (VERBOSE) log("sendFrame returned %j", sent)
  }
  log("%s> sending done", cli.id)
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
  log("%s> calling sk.end() in sk.once('end', ...)", cli.id)
  if (cli.intervalid) clearInterval(cli.intervalid)
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
  var statsmod = require('stats')
    , stats = statsmod.getStats()

  process.on('SIGUSR1', function(){
    log( sts.toString({values: 'both'}) )
  })

  stats.createStat('sk recv size', statsmod.Value)
  stats.createStat('sk recv gap', statsmod.Timer, {units:'bytes'})
  stats.createHog('sk recv size semi', 'sk recv size', statsmod.SemiBytes)
  //stats.createHog('sk recv size log', 'sk recv size', statsmod.LogBytes)
  stats.createHog('sk recv gap', 'sk recv gap', statsmod.SemiLogMS)

  stats.createStat('frap recv gap', statsmod.Timer)
  stats.createStat('frap part size', statsmod.Value, {units:'bytes'})
  stats.createHog('frap part size', 'frap part size', statsmod.SemiBytes)
  stats.createHog('frap recv gap', 'frap recv gap', statsmod.SemiLogMS)

  cli.sk.on('connect', function() {
    var sk_tm
    cli.sk.on('data', function(buf) {
      if (sk_tm) sk_tm()
      sk_tm = stats.get('sk recv gap').start()
      stats.get('sk recv size').set(buf.length)
    })

    assert(cli.frap, "cli.frap not set")
    var frap_tm, cur_framelen
    cli.frap.on('begin', function(rstream, framelen){
      cur_framelen = framelen
      frap_tm = stats.get('frap recv gap').start()
    })
    cli.frap.on('part', function(buf, pos){
      if (pos + buf.length === cur_framelen) {
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
