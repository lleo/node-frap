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
  , stats = require('stats')

var VERBOSE = 0
var opts = nomnom.script('t-frap-echo-pipe-svr')
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
  .parse()

if (VERBOSE)
  log("PID=%d", process.pid)

// Setup stats
var sts = stats.getStats()
sts.createStat('ttcf', stats.Timer) //time-to-complete-frame
sts.createStat('time_btw_part', stats.Timer)
sts.createStat('part_sz', stats.Value)
sts.createStat('frame_sz', stats.Value)
sts.createHOG('ttcf SemiLogMS', sts.get('ttcf'), stats.SemiLogMS)
sts.createHOG('time_btw_part SemiLogMS', sts.get('time_btw_part'), stats.SemiLogMS)
sts.createHOG('part_sz LogBytes' , sts.get('part_sz' ), stats.LogBytes)
sts.createHOG('frame_sz LogBytes', sts.get('frame_sz'), stats.LogBytes)

process.on('SIGUSR1', function(){
  log( sts.toString({values: 'both'}) )
})

process.on('SIGINT', function () {
  log('caught SIGINT')
  log( sts.toString({values: 'both'}))
  process.exit(0)
})


//REALTIME MONITORING
var root = {
  svrid : "localhost:"+opts.port
, frap: frap
, stats: sts
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

var svr = {port: opts.port, verbose: opts.verbose}
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
    //Setup stats
    sts.get('frame_sz').set(framelen)

    part_done = sts.get('time_btw_part').start()
    rstream.on('data', function(buf, off){
      part_done()
      if (buf.length+off !== framelen) //if this is not the last part
        part_done = sts.get('time_btw_part').start()
        
      sts.get('part_sz').set(buf.length)
    })

    var done = sts.get('ttcf').start()
    rstream.on('end', function(buf, off){
      done()
    })

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