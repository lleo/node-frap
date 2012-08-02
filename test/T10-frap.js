var net = require('net')
  , expect = require('chai').expect
  , assert = require('assert')
  , Frap = require('..')
  , PORT = 7000

describe("Frap send/recv data", function(){
  var ssk, csk, frap, send_msg, recv_msg

  before(function(){
    ssk = net.createServer(function(sk){
            sk.on('end', function(){ sk.end() })
            sk.pipe(sk)
          }).listen(PORT)
  })

  before(function(done){
    csk = net.connect(PORT, function(){
            frap = new Frap(csk)
            frap.setEncoding('utf8')
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
    frap.on('data', function(msg){
      recv_msg = JSON.parse( msg )
      next()
    })

    send_msg = {hello: 'world'}
    frap.write(JSON.stringify(send_msg), 'utf8')
  })

  it("recv_msg should equal send_msg", function(){
    expect(send_msg).to.deep.equal(recv_msg)
    frap.end()
  })
})