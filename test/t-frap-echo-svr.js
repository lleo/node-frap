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
  , stats = require('stats')

var VERBOSE = 0
var opts = nomnom.script('t-frap-echo-svr')
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
  , default: 7000
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
  log( sts.toString({value: 'both'}) )
  process.exit(0)
})

// REALTIME MONITORING
var root = {
  svrid : "localhost:"+opts.port
, stats : sts
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
  if (VERBOSE)
    log(ident+" connected")

  svr.client[ident] = {}
  svr.client[ident].sk = sk
  svr.client[ident].frap = new Frap(sk)

  //stats
  var part_done
  svr.client[ident].frap.on('begin', function(rstream, framelen){
    //Setup stats
    sts.get('frame_sz').set(framelen)

    part_done = sts.get('time_btw_part').start()
    rstream.on('data', function(buf, off){
      part_done()
      if (buf.length+off !== framelen) //if this is not the last part
        part_done = sts.get('time_btw_part').start()
    })

    var done = sts.get('ttcf').start()
    rstream.on('end', function(buf, off){
      done()
    })
  })
  svr.client[ident].frap.on('part', function(buf, off){
    sts.get('part_sz').set(buf.length)
  })

  svr.client[ident].frap.on('frame', function(buf){
    //log(format("FRAP: %s sent: buf.length=%d;", ident, buf.length))
    svr.client[ident].frap.send(buf)
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