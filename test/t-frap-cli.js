#!/usr/bin/env node

var net = require('net')
  , log = console.log
  , format = require('util').format
  , Frap = require('frap').Frap
  , nomnom = require('nomnom')

var opts = nomnom.script('t-frap-cli')
  .option('verbose', {
    abbr: 'v'
  , flag: true
  , help: 'show more output'
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
  .parse()

var cli = {
  port: opts.port
, verbose: opts.verbose
, nbufs: opts.nbufs
, bufsz: opts.bufsz
}

cli.sk = net.createConnection(cli.port)

cli.sk.on('connect', function() {
  var buf, t0
  log("connected")
  cli.frap = new Frap(cli.sk)

  cli.frap.recvFrame(function(err, buf){
    if (err) throw err
    log(format("cli.frap.recvFrame cb: buf.length=%d;", buf.length))
    //log("data:", data.toString())
    var d = Date.now() - t0
      , tp = (cli.nbufs * cli.bufsz) / (d / 1000) / 1024 
    log(format("delta = %s ms", d.toPrecision(6)))
    log(format("thruput = %s kB/s", tp.toFixed(2)))
    
    setTimeout(function(){
      cli.sk.end()
    }, 500)
  })

  buf = new Buffer(cli.bufsz)
  buf.fill(88) //88 == 'X'
  
  var bufs = []
  for (var i=0; i<cli.nbufs; i++) {
    bufs.push(buf)
  }

  t0 = Date.now()

  cli.frap.send(bufs)
})

cli.sk.on('error', function(err) {
  log("error:", err)
})

cli.sk.on('end', function() {
  log("end")
  delete cli.frap
  cli.sk.end()
  delete cli.sk
})

