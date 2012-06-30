#!/usr/bin/env node

var net = require('net')
  , assert = require('assert')
  , log = console.log
  , format = require('util').format
  , Frap = require('frap').Frap
  , nomnom = require('nomnom')

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
  .option('host', {
    abbr: 'H'
  , flag: false
  , default: '127.0.0.1'
  , help: 'connect host'
  })
  .option('port', {
    abbr: 'P'
  , flag: false
  , default: 7000
  , help: 'connect port'
  })
  .option('nbufs', {
    abbr: 'n'
  , default: 1
  , help: 'number of buf to send default:1'
  })
  .option('bufsz', {
    abbr: 's'
  , default: Math.pow(10,7)
  , help: 'size in bytes of each buffer send; default:10000000'
  })
  .option('fresh', {
    abbr: 'f'
  , flag: true
  , default: false
  , help: 'alloc fresh Buffer for each nbuf'
  })
  .option('stats', {
    default: true
  , help: 'turn on stats collection and report via SIGUSR1'
  })
  .parse()

log("PID=%d", process.pid)

var cli = {
  port: opt.port
, host: opt.host
, verbose: opt.verbose
, nbufs: opt.nbufs
, bufsz: opt.bufsz
, fresh: opt.fresh
}

var stats, statsmod
if (opt.stats) {
  statsmod = require('stats')
  stats = statsmod.getStats()
}

log("cli.sk = net.connect(%d, '%s')", cli.port, cli.host)

cli.sk = net.connect(cli.port, cli.host, function() {
  log("connected")
  cli.frap = new Frap(cli.sk)

  cli.frap.on('frame', function(buf){
    log(format("cli.frap.on 'frame': buf.length=%d;", buf.length))
    var d = Date.now() - t0
      , tp = (cli.nbufs * cli.bufsz) / (d / 1000) / 1024 
    log("Time-to-recv = %d ms", d)
    log("thruput = %s kB/s", tp.toFixed(2))

    buf = undefined

    cli.sk.end()
    //setTimeout(function(){
    //  log("Timeout called")
    //  //cli.sk.end()
    //  //cli.sk.destroySoon()
    //}, 500)
  })

  var bufs = [], buf, t0
  for (var i=0; i<cli.nbufs; i++) {
    if (cli.fresh) {
      buf = new Buffer(cli.bufsz)
      buf.fill(88) //88 == 'X'
    }
    else {
      if (!buf) {
        buf = new Buffer(cli.bufsz)
        buf.fill(88) //88 == 'X'
      }
    }
    bufs.push(buf)
  }

  t0 = Date.now()
  cli.frap.once('drain', function() {
    var d = Date.now() - t0
    log("Time-to-send = %d ms", d)
  })
  cli.frap.send(bufs)
  bufs = []
})

cli.sk.on('error', function(err) {
  log("error:", err)
})

cli.sk.once('end', function() {
  log("end")
  //cli.sk.end()
})

cli.sk.once('close', function() {
  log("close")
  delete cli.frap
  delete cli.sk
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
