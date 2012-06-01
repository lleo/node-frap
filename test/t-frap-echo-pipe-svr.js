#!/usr/bin/env node

var net = require('net')
  , util = require('util')
  , fs = require('fs')
  , log = console.log
  , format = util.format
  , inspect = util.inspect
  , frap = require('frap')
  , Frap = frap.Frap
  , repl = require('repl')
  , nomnom = require('nomnom')

var VERBOSE = 0
var opts = nomnom.script('t-frap-echo-pipe-svr')
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
  , help: 'listen port'
  })
  .parse()

process.on('SIGINT', function () {
  log('caught SIGINT')
  process.exit(0)
})

//REALTIME MONITORING
var root = {
  svrid : "localhost:"+opts.port
, frap: frap
}
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
}).listen('./t-frap-echo-pipe-svr.repl.sk')
process.on('exit', function() {
  fs.unlinkSync('./t-frap-echo-pipe-svr.repl.sk')
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

  svr.client[ident].frap.on('frame', function(rstream, framelen){
    var wstream = svr.client[ident].frap.createWriteStream(framelen)
    rstream.pipe(wstream)
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