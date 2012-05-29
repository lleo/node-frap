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

var opts = nomnom.script('t-frap-echo-svr')
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
  svr.client[ident].frap = new Frap(sk)
  
  svr.client[ident].frap.on('full', function(data, nreads) {
    log(format("FRAP: %s sent: data.length=%d; nreads=%d", ident, data.length, nreads))
    svr.client[ident].frap.send(data) //echo svr
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