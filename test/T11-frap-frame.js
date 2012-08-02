var net = require('net')
  , expect = require('chai').expect
  , assert = require('assert')
  , Frap = require('..')
  , PORT = 7000

describe("Frap send/recv frame", function(){
  var ssk, csk, frap, send_msg, recv_msg

  //timeout(10000)
  console.log(require('util').inspect(global))

  before(function(){
    ssk = net.createServer(function(sk){
            sk.on('end', function(){ sk.end() })
            sk.pipe(sk)
          }).listen(PORT)
  })

  before(function(done){
    csk = net.connect(PORT, function(){
            frap = new Frap(csk, {emit: 'frame'})
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
    frap.on('frame', function(bufs){
      var buf = Buffer.concat(bufs)
      recv_msg = JSON.parse( buf.toString('utf8') )
      next()
    })

    send_msg = {hello: 'world'}
    var buf = new Buffer(JSON.stringify(send_msg), 'utf8')
    frap.sendFrame([buf])
  })

  it("recv_msg should equal send_msg", function(){
    expect(send_msg).to.deep.equal(recv_msg)
    frap.end()
  })
})