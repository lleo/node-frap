#!/usr/bin/env node

var net = require('net')
  , log = console.log
  , util = require('util')
  , format = util.format
  , frap = require('..')
  , Frap = frap.Frap
  , Channel = frap.Channel
  , nomnom = require('nomnom')

var opts = nomnom.script('t-chan-svr')
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
  .option('topic', {
    abbr: 't'
  , flag: false
//  , required: true
  , help: 'channel topic'
  })
  .parse()

process.on('SIGINT', function () {
  log('caught SIGINT')
  process.exit(0)
})

var svr = {
  port: opts.port
, verbose: opts.verbose
, topic: opts.topic || 'unset'
, client: {}
}

svr.sk = net.createServer()
svr.sk.listen(svr.port)
svr.sk.on('connection', function(sk){
  var ident = sk.remoteAddress+":"+sk.remotePort
  svr.client[ident] = {}
  svr.client[ident].sk = sk
  svr.client[ident].chan = new Channel(sk)
  log("new Channel", ident)

  svr.client[ident].chan.onAny(function(buf){
    log("topic :", this.event)
    log("msg   :", buf.toString())
    svr.client[ident].chan.send('bye', 'seeya')
  })
  svr.client[ident].sk.on('end', function(){
    log("socket closed:", ident)
    delete svr.client[ident]
  })
})