#!/usr/bin/env node

var net = require('net')
  , log = console.log
  , util = require('util')
  , format = util.format
  , inspect = util.inspect
  , frap = require('..')
  , Frap = frap.Frap
  , Channel = frap.Channel
  , nomnom = require('nomnom')

var opts = nomnom.script('t-chan-cli')
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
  .option('topic', {
    abbr: 't'
  , flag: false
  , required: true
  , help: 'channel topic'
  })
  .option('message', {
    position: 0
  , type: 'string'
  , required: true
  , help: 'message to send'
  })
  .option('bufsz', {
    abbr: 's'
  , default: Math.pow(10,6)
  })
  .parse()

var cli = {
  port: opts.port
, verbose: opts.verbose
, topic: opts.topic || 'unset'
, bufsz: opts.bufsz
, msg: opts.message || 'no message'
}

cli.sk = net.createConnection(cli.port)

cli.sk.on('connect', function() {
  cli.chan = new Channel(cli.sk)

  cli.chan.send(cli.topic, cli.msg)

  cli.chan.on('bye', function(buf){
    log("'bye' msg:", buf.toString())
    delete cli.chan
    cli.sk.end()
    delete cli.sk
  })
})
