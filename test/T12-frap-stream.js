var net = require('net')
  , expect = require('chai').expect
  , assert = require('assert')
  , Frap = require('..')
  , PORT = 7000

describe("Frap send/recv frame stream", function(){
  var ssk, csk, frap, send_msg, recv_msg

  before(function(){
    ssk = net.createServer(function(sk){
            sk.on('end', function(){ sk.end() })
            sk.pipe(sk)
          }).listen(PORT)
  })

  before(function(done){
    csk = net.connect(PORT, function(){
            frap = new Frap(csk, {emit: 'basic'})
            done()
          })
  })

  after(function(){
    ssk.close()
  })

  it("frap should be connected", function(next){
    assert(frap, "frap not defined")
    next()
  })

  it("send/recv msg", function(next){
    var strings = []
    frap.on('header', function(framelen){
      var rstream = frap.createReadFrameStream(framelen)
      rstream.setEncoding('utf8')
      rstream.on('data', function(str) { strings.push(str) })
      rstream.on('close', function(){
        var string = strings.join("")
        recv_msg = JSON.parse( string )
        next()
      })
    })

    send_msg = {hello: 'world'}
    var buf = new Buffer(JSON.stringify(send_msg), 'utf8')
    var wstream = frap.createWriteFrameStream( buf.length )
    for (var i=0; i<buf.length; i++) {
      wstream.write( buf.slice(i, i+1) )
    }
  })

  it("recv_msg should equal send_msg", function(){
    expect(send_msg).to.deep.equal(recv_msg)
    frap.end()
  })
})