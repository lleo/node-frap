#!/usr/bin/env node

process.argv[0] = 't-frap-echo-svr'

var net = require('net')
  , util = require('util')
  , fs = require('fs')
  , log = console.log
  , format = util.format
  , inspect = util.inspect
  , Frap = require('..')
  , repl = require('repl')
  , nomnom = require('nomnom')

var VERBOSE = 0
var opt = nomnom.script('t-frap-echo-svr')
  .option('verbose', {
    abbr: 'v'
  , flag: true
  , help: 'show more output'
  , callback: function() {
      VERBOSE += 1
    }
  })
  .option('port', {
    abbr: 'p'
  , flag: false
  , default: 7000
  , help: 'listen port; default 7000'
  })
  .option('stats', {
    abbr: 'S'
  , flag: true
  , default: false
  , help: 'turn on stats collection and report via SIGUSR1'
  })
  .parse()

if (opt.stats) {
  log("PID=%d", process.pid)

  // Setup stats
  var statsmod = require('stats')

  var stats = statsmod.getStats()
  stats.createStat('ttcf', statsmod.Timer) //time-to-complete-frame
  stats.createStat('tbfp', statsmod.Timer)
  stats.createStat('part_sz', statsmod.Value)
  stats.createStat('frame_sz', statsmod.Value)
  stats.createHOG('ttcf SemiLogMS', stats.get('ttcf'), statsmod.SemiLogMS)
  stats.createHOG('tbfp SemiLogMS', stats.get('tbfp'), statsmod.SemiLogMS)
  stats.createHOG('part_sz LogBytes' , stats.get('part_sz' ), statsmod.LogBytes)
  stats.createHOG('frame_sz LogBytes', stats.get('frame_sz'), statsmod.LogBytes)

  process.on('SIGUSR1', function(){
    log( stats.toString({values: 'both'}) )
  })
}

process.on('SIGINT', function () {
  log('caught SIGINT')
  if (opt.stats)
    log( stats.toString({value: 'both'}) )
  process.exit(0)
})

// REALTIME MONITORING
var root = {
  svrid : "localhost:"+opt.port
, stats : stats
}
net.createServer(function(sk){
  //spawned when another terminal `socat STDIN ./repl.sk`
  // or better yet `socat READLINE ./repl.sk`
  repl.start(root.svrid+' > ', sk).context.root = root
//}).listen(7001)
}).listen('./t-frap-echo-svr.repl.sk')
process.on('exit', function(){
  fs.unlinkSync('./t-frap-echo-svr.repl.sk')
})
process.on('uncaughtException', function(err){
  log("uncaught", err)
  process.nextTick(function(){process.exit(1)})
})

var svr = {port: opt.port, verbose: opt.verbose}
root.svr = svr

svr.client = {}
svr.sk = net.createServer()

svr.sk.listen(svr.port)

svr.sk.on('listening', function() {
  log("listening to port "+svr.port)
})

svr.sk.on('connection', function(sk) {
  var ident = sk.remoteAddress+":"+sk.remotePort
  if (VERBOSE)
    log(ident+" connected")

  var frap = new Frap(sk)

  //just for the repl
  svr.client[ident] = {}
  svr.client[ident].sk = sk
  svr.client[ident].frap = frap

  //stats
  if (stats) {
    var part_done
    svr.client[ident].frap.on('begin', function(rstream, framelen){
      stats.get('frame_sz').set(framelen)

      part_done = stats.get('tbfp').start()

      rstream.on('data', function(buf, off){
        part_done()
        if (buf.length+off !== framelen) //if this is not the last part
          part_done = stats.get('tbfp').start()
      })

      var done = stats.get('ttcf').start()
      rstream.on('end', function(buf, off){
        done()
      })
    })
    svr.client[ident].frap.on('part', function(buf, off){
      stats.get('part_sz').set(buf.length)
    })
  }

  svr.client[ident].frap.on('data', function(buf){
    //log(format("FRAP: %s sent: buf.length=%d;", ident, buf.length))
    svr.client[ident].frap.sendFrame(buf)
    buf = undefined
  })

  svr.client[ident].sk.on('close', function() {
    svr.client[ident].sk.end()
    if (VERBOSE)
      log(format("%s disconnected", ident))
    delete svr.client[ident]
  })
})

svr.sk.on('error', function(err) {
  log("server sk error:", err)
})