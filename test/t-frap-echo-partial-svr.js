#!/usr/bin/env node

var net = require('net')
  , util = require('util')
  , fs = require('fs')
  , log = console.log
  , format = util.format
  , inspect = util.inspect
  , Frap = require('frap').Frap
  , repl = require('repl')
  , nomnom = require('nomnom')

var opts = nomnom.script('t-frap-echo-partial-svr')
  .option('verbose', {
    abbr: 'v'
  , flag: true
  , help: 'show more output'
  })
  .option('port', {
    abbr: 'p'
  , flag: false
  , default: 7000
  , help: 'listen port'
  })
  .parse()

process.on('SIGINT', function () {
  log('caught SIGINT')
  process.exit(0)
})

//REALTIME MONITORING
var root = { svrid : "localhost:"+opts.port }
net.createServer(function(sk){
  //spawned when another terminal `socat STDIN ./repl.sk`
  // or better yet `socat READLINE ./repl.sk`
  var replobj
    , prompt = root.svrid+' > '
    , myeval
    , useGlobal=true
    , ignoreUndefined
  
  replobj = repl.start(prompt, sk, myeval, useGlobal, ignoreUndefined)
  replobj.context.root = root
  
//}).listen(7001)
}).listen('./t-frap-echo-partial-svr.repl.sk')
process.on('exit', function() {
  fs.unlinkSync('./t-frap-echo-partial-svr.repl.sk')
})

var svr = {port: opts.port, verbose: opts.verbose}
root.svr = svr

svr.client = {}
svr.sk = net.createServer()

svr.sk.listen(svr.port)

svr.sk.on('listening', function() {
  log("listening to port "+svr.port)
})

svr.sk.on('connection', function(sk) {
  var ident = sk.remoteAddress+":"+sk.remotePort
  svr.client[ident] = {}
  svr.client[ident].sk = sk
  svr.client[ident].frap = new Frap(sk, true)

  var npartials = 0
  var cont_partial_cb = function(buf, start, end, framelen){
    npartials += 1
    if (svr.verbose) {
      log(format("recv: buf.length=%d; start=%d; end=%d; framelen=%d;",
                  buf.length, start, end, framelen))
    }
    if ( svr.client[ident].frap.sendPartial(buf) ) {
      svr.client[ident].frap.removeListener('partial', cont_partial_cb)
      //process.stdout.write('\n')
    }
  }
  var first_partial_cb = function(buf, start, end, framelen){
    npartials += 1
    if (svr.verbose) {
      log(format("recv: buf.length=%d; start=%d; end=%d; framelen=%d;",
                  buf.length, start, end, framelen))
    }
    svr.client[ident].frap.sendHeader(framelen)
    svr.client[ident].frap.sendPartial(buf)
    svr.client[ident].frap.on('partial', cont_partial_cb)
  }
  svr.client[ident].frap.once('partial', first_partial_cb)

  svr.client[ident].frap.on('full', function(buf, nreads) {
    log(format("recv: frame.length=%d; nreads=%d; npartials=%d;",
                buf.length, nreads, npartials))
    npartials=0
  })

  svr.client[ident].sk.on('end', function() {
    svr.client[ident].sk.end()
    log(ident+" disconnected")
    delete svr.client[ident]
  })
})

svr.sk.on('error', function(err) {
  log("server sk error:", err)
})