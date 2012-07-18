#!/usr/bin/env node

var net = require('net')
  , nomnom = require('nomnom')
  , log = console.log


var opt = nomnom.script('raw-echo.js')
  .option('port', {
    abbr: 'p'
  , flag: false
  , default: 7000
  , help: 'connect port; default 7000'
  })
  .parse()

var svr = net.createServer(function(sk){
  var id = sk.remoteAddress + ":" + sk.remotePort
  log("connect %s", id)
  sk.pipe(sk)
  sk.on('close', function(){ log("closed %s", id) })
}).listen(opt.port)

log("listening on %d", opt.port)