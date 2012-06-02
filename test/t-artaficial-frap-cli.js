#!/usr/bin/env node

var net = require('net')
  , log = console.log
  , util = require('util')
  , format = util.format
  , inspect = util.inspect
  , frap = require('frap')
  , Frap = frap.Frap
  , nomnom = require('nomnom')


//frap.setVerbosity(2)

var logf = function() { log(format.apply(this, arguments)) }

var VERBOSE = 0
var opts = nomnom.script('t-frap-cli')
  .option('verbose', {
    abbr: 'v'
  , flag: true
  , help: 'show more output'
  , callback: function() {
      Frap.VERBOSE++
      VERBOSE++
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
  , help: 'size in bytes of each buffer send'
  })
  .option('msg', {
    abbr: 'm'
  , default: "hello world"
  , help: 'message to send; default: "hello world"'
  })
  .option('bytes_per_write', {
    abbr: 'b'
  , default: undefined
  , help: 'number of bytes per write: default undefined (means whole buffer)'
  })
  .option('delay', {
    abbr: 'd'
  , default: undefined
  , help: 'delay between writes: default undefined (means no delay)'
  })
  .parse()

var cli = {
  port    : opts.port
, verbose : VERBOSE
, nbufs   : opts.nbufs
, bufsz   : opts.bufsz
, bpw     : opts.bytes_per_write
, delay   : opts.delay
, ended   : false
}

cli.sk = net.createConnection(cli.port)

cli.sk.on('connect', function() {
  if (VERBOSE) log("connected")

  var buf, t0

  cli.frap = new Frap(cli.sk)

  cli.frap.recvFrame(function(err, buf){
    if (err) throw err
    if (VERBOSE) logf("cli.frap.recvFrame cb: buf.length=%d;", buf.length)

//    var d = Date.now() - t0
//      , tp = (cli.nbufs * cli.bufsz) / (d / 1000) / 1024 
//    if (VERBOSE) {
//      logf(format("delta = %s ms", d.toPrecision(6)))
//      logf(format("thruput = %s kB/s", tp.toFixed(2)))
//    }

    log("received:", buf.toString('ascii'))

    setTimeout(function(){
      if (!cli.ended) {
        cli.ended = true
        cli.sk.end()
      }
    }, 500)
  })

  buf = new Buffer((4+cli.bufsz) * cli.nbufs)
  buf.fill(88) //88 == 'X'
  for (var o=0; o<buf.length; o+=cli.bufsz+4) {
    buf.writeUInt32BE(cli.bufsz, o)
  }

  t0 = Date.now()

  if (cli.bpw && cli.delay) {
    if (VERBOSE>1) logf("bpw = %d; delay=%d;", cli.bpw, cli.delay)
    slowSend(cli.sk, buf, cli.bpw, cli.delay, function(){
      if (VERBOSE) log("slowSend done")
    })
  }
  else {
    cli.sk.write(buf)
  }
})

cli.sk.on('error', function(err) {
  log("error:", err)
})

cli.sk.on('end', function() {
  log("socket end")
  delete cli.frap
  cli.sk.end()
  delete cli.sk
})

function slowSend(sk, buf, nb, wait, cb) { //nb == number of bytes to per send
  var off=0
  function send() {
    var end = off+nb
    if (end > buf.length) { end = buf.length }
    if (off === end) {
      if (VERBOSE) log("off === end")
      return
    }
    var rv = sk.write(buf.slice(off, end))
    off += nb
    if (off > buf.length) {
      cb()
      return
    }
    setTimeout(send, wait)
  }
  send()
}