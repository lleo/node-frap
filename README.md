Frap - Framing Wrapper
======================

### server.js
    var net = require('net')
      , Frap = require('frap').Frap
      , svr = {frap: {}}
    
    svr.sk = net.createServer().listen(7000)
    
    svr.sk.on('connection', function(sk){
      var frap = new Frap(sk)
      svr.frap[frap.id] = frap
      frap.on('frame', function(buf) {
        //simple echo
        frap.send(buf)
      })
      frap.on('end', function() {
        delete svr.frap[frap.id]
      })
    })
  
### client.js
    var net = require('net')
      , Frap = require('frap').Frap
      , cli = {}
    
    cli.msg = {cmd: "print", args: ["hello", "world"]}
    
    cli.sk = net.createConnection(7000, function() {
      cli.frap = new Frap(cli.sk)
    
      cli.frap.on('frame', function(buf) {
        var msg = JSON.parse(buf.toString('utf8'))
        console.log("recv:", msg)
        cli.frap.end()
      })
    
      cli.frap.sendFrame(new Buffer(JSON.stringify(cli.msg), 'utf8'))
    })

API
---

### Constructor

  frap = new Frap(src) //src could be a net.Socket or any read/write Stream

### Events
  frap.on('frame', function(rstream, framelen) {
    rstream.on('data', function(buf){ ... })
  })
  
  frap.receive(cb) //cb(err, buf)
    This creates a receiver FSM that accumulates a large buffer of all
    buffers from each new frame stream.

  frap.receiveOnce(cb)
    Same as above but doesn't rearm the FSM accumulator.

  wstream = frap.start(framelen)
    Can not call start till framelen bytes written to wstream

  frap.send(buf, cb) //cb(err) if (!err) SUCESS!
    Tries to send a buf all at once. Basically it is this:
      frap.send(buf) {
        wstream = frap.start(buf.length)
        wstream.on('close', cb)
        wstream.on('error', cb)
        wstream.write(buf)
      }
