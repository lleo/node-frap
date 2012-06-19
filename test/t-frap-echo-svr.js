#!/usr/bin/env node

process.argv[0] = 't-frap-echo-svr'

var net = require('net')
  , util = require('util')
  , fs = require('fs')
  , log = console.log
  , format = util.format
  , inspect = util.inspect
  , Frap = require('frap').Frap
  , repl = require('repl')
  , nomnom = require('nomnom')

var logf = function() { log(format.apply(this, arguments)) }

var VERBOSE = 0
var opts = nomnom.script('t-frap-echo-svr')
  .option('verbose', {
    abbr: 'v'
  , flag: true
  , help: 'show more output'
  , callback: function() {
      VERBOSE += 1
      if (VERBOSE) {
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
  repl.start(root.svrid+' > ', sk).context.root = root
//}).listen(7001)
}).listen('./t-frap-echo-svr.repl.sk')
process.on('exit', function(){
  fs.unlinkSync('./t-frap-echo-svr.repl.sk')
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
  
  svr.client[ident].frap.on('frame', function(buf){
    //log(format("FRAP: %s sent: buf.length=%d;", ident, buf.length))
    svr.client[ident].frap.send(buf)
    buf = undefined
  })
  
  svr.client[ident].sk.on('close', function() {
    svr.client[ident].sk.end()
    log(format("%s disconnected", ident))
    delete svr.client[ident]
  })
})

svr.sk.on('error', function(err) {
  log("server sk error:", err)
})