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
  stats.createStat('sk_recv_sz', statsmod.Value) //size of each socket data buf
  stats.createHOG('sk_recv_sz SemiBytes', 'sk_recv_sz', statsmod.SemiBytes)
  stats.createStat('ttcf', statsmod.Timer) //time-to-complete-frame
  stats.createStat('tbfp', statsmod.Timer) //time-between-frame-parts
  stats.createStat('part_sz', statsmod.Value)
  stats.createStat('frame_sz', statsmod.Value)
  stats.createHOG('ttcf SemiLogMS', 'ttcf', statsmod.SemiLogMS)
  stats.createHOG('tbfp SemiLogMS', 'tbfp', statsmod.SemiLogMS)
  stats.createHOG('part_sz SemiBytes' , 'part_sz', statsmod.SemiBytes)
  stats.createHOG('frame_sz SemiBytes', 'frame_sz', statsmod.SemiBytes)

  process.on('SIGUSR1', function(){
    log( stats.toString({values: 'both'}) )
  })
}

process.on('SIGINT', function () {
  log('caught SIGINT')
  if (opt.stats) log( stats.toString({values: 'both'}))
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
  //if (err instanceof Error) {
  //  log(err.stack)
  //}

  process.exit(1)
  //process.nextTick(function(){process.exit(1)})
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
    , frap = new Frap(sk, false)

  if (VERBOSE) log("%s connected", ident)

  // just for the repl
  svr.client[ident] = {}
  svr.client[ident].sk = sk
  svr.client[ident].frap = frap

  frap.on('begin', function onBegin(rstream, framelen){

    rstream.once('end', function(){
      if (VERBOSE>1) log("rstrem.once 'end': pausing frap")
      frap.pause()
    })

    //Setup echo pipe
    var wstream = frap.createWriteStream(framelen)

    wstream.once('close', function(){
      if (VERBOSE>1) log("wstream.once 'finished': resuming frap")
      frap.resume()
    })

    rstream.pipe(wstream)
  })

  sk.on('end', function() {
    if (VERBOSE) log("%s disconnected", ident)
    delete svr.client[ident]
  })

  if (opt.stats) {
    sk.on('data', function(buf) {
      stats.get('sk_recv_sz').set(buf.length)
    })
    frap.on('begin', function(rstream, framelen){
      stats.get('frame_sz').set(framelen)
      
      var ttcf_done = stats.get('ttcf').start()
      rstream.once('end', function(){ ttcf_done() })

      var tbfp_done
      rstream.on('data', function(buf){
        stats.get('part_sz').set(buf.length)

        if (tbfp_done) tbfp_done()
        tbfp_done = stats.get('tbfp').start()
      })
    })
  }
})

svr.sk.on('error', function(err) {
  log("server sk error:", err)
})