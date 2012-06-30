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
var opt = nomnom.script('t-frap-echo-pipe-svr')
  .option('verbose', {
    abbr: 'v'
  , flag: true
  , help: 'show more output'
  , callback: function() {
      VERBOSE += 1
      if (VERBOSE>1) { //if verbose already turned on
        //enable library verbosity
        Frap.VERBOSE += 1
        Frap.RFrameStream.VERBOSE += 1
        Frap.WFrameStream.VERBOSE += 1
      }
    }
  })
  .option('port', {
    abbr: 'p'
  , flag: false
  , "default": 7000
  , help: 'listen port'
  })
  .option('stats', {
    abbr: 'S'
  , flag: false
  , default: true
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
}
process.on('SIGUSR1', function(){
  log( stats.toString({values: 'both'}) )
})

process.on('SIGINT', function () {
  log('caught SIGINT')
  log( stats.toString({values: 'both'}))
  process.exit(0)
})


//REALTIME MONITORING
var root = {
  svrid : "localhost:"+opt.port
, frap: frap
, stats: stats
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
  if (VERBOSE)
    log("listening to port "+svr.port)
})

svr.sk.on('connection', function(sk) {
  var ident = sk.remoteAddress+":"+sk.remotePort
  if (VERBOSE)
    log(ident+" connected")

  svr.client[ident] = {}
  svr.client[ident].sk = sk
  svr.client[ident].frap = new Frap(sk, false)

  var part_done
  svr.client[ident].frap.on('begin', function(rstream, framelen){
    if (opt.stats) {
      //Setup stats
      stats.get('frame_sz').set(framelen)

      part_done = stats.get('tbfp').start()
      rstream.on('data', function(buf, off){
        part_done()
        if (buf.length+off !== framelen) //if this is not the last part
          part_done = stats.get('tbfp').start()

        stats.get('part_sz').set(buf.length)
      })

      var done = stats.get('ttcf').start()
      rstream.on('end', function(buf, off){
        part_done()
      })
    }

    //Setup echo pipe
    var wstream = svr.client[ident].frap.createWriteStream(framelen)
    rstream.pipe(wstream)
  })

  svr.client[ident].sk.on('end', function() {
    //svr.client[ident].sk.end()
    if (VERBOSE)
      log(ident+" disconnected")
    ;delete svr.client[ident]
  })
})

svr.sk.on('error', function(err) {
  log("server sk error:", err)
})