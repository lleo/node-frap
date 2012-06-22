#!/usr/bin/env node

var net = require('net')
  , log = console.log
  , format = require('util').format
  , Frap = require('frap').Frap
  , nomnom = require('nomnom')

var VERBOSE=0
var opts = nomnom.script('t-frap-cli')
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
  .parse()

var cli = {
  port: opts.port
, verbose: opts.verbose
, nbufs: opts.nbufs
, bufsz: opts.bufsz
, fresh: opts.fresh
}

cli.sk = net.createConnection(cli.port)

cli.sk.on('connect', function() {
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
  delete cli.frap
  cli.sk.end()
  delete cli.sk
})

