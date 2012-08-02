var sinon = require('sinon')
  , expect = require('chai').expect
  //, should = require('chai').should()
  , assert = require('assert')
  , inspect = require('util').inspect
  , log = console.log


describe("FrapReader", function(){
  var FrapReader = require('../lib/frap_reader')

  describe("single complete frame", function(){
    var single_frame
    before(function(){
      single_frame = new Buffer(14)
      single_frame.fill(88) //ascii 88 == 'X'
      single_frame.writeUInt32BE(10,0)
    })

    describe("parse all at once", function(){
      var rdr
      before(function(){
        rdr = new FrapReader()
      })

      describe("#parse", function(){
        it("the FrapReader should have no entries in the parsedq", function(){
          expect(rdr.parsedq.length).to.be.equal(0)
        })
        it("should not throw an exception", function(){
          rdr.parse(single_frame)
        })
        it("the FrapReader should have two entries in the parsedq", function(){
          expect(rdr.parsedq.length).to.be.equal(2)
        })
      })

      describe("#dispatch", function(){
        var header = sinon.spy()
          , part = sinon.spy()
          , frame = sinon.spy()
          , data = sinon.spy()

        before(function(){
          rdr.on('header', header)
          rdr.on('part', part)
          rdr.on('frame', frame)
          rdr.on('data', data)
        })

        it("should call #dispatch without errors", function(){
          rdr.dispatch() //calls all the stackedup events synchronously
        })

        it("'header' event should be called", function(){
          expect(header.called).to.be.true
        })

        it("'header' event should only be called only once", function(){
          expect(header.calledOnce).to.be.true
        })

        it("'header' event should have only one argument", function(){
          expect(header.getCall(0).args).to.have.length(1)
        })

        it("'header' event first argument should equal 10", function(){
          expect(header.getCall(0).args[0]).to.equal(10)
        })

        it("'part' event should be called", function(){
          expect(part.called).to.be.true
        })

        it("'part' event should only be called only once", function(){
          expect(part.calledOnce).to.be.true
        })

        it("'part' event shoule have three arguments", function(){
          expect(part.getCall(0).args).to.have.length(3)
        })

        it("'part' event first argument should be a Buffer", function(){
          expect(part.getCall(0).args[0]).to.be.instanceof(Buffer)
        })

        it("'part' event first argument should have .length 10", function(){
          expect(part.getCall(0).args[0].length).to.be.equal(10)
        })

        it("'part' event buf should contain string 'XXXXXXXXXX'", function(){
          expect(part.getCall(0).args[0].toString('ascii')).to.be
          .equal("XXXXXXXXXX")
        })

        it("'part' event second argument, pos, should be 0", function(){
          expect(part.getCall(0).args[1]).to.be.equal(0)
        })

        it("'part' event thrid argument, framelen, should be 10", function(){
          expect(part.getCall(0).args[2]).to.be.equal(10)
        })

        it("'frame' event should be emitted", function(){
          expect(frame.called).to.be.true
        })

        it("'frame' event should only be emitted once", function(){
          expect(frame.calledOnce).to.be.true
        })

        it("'frame' event should only have two arguments", function(){
          expect(frame.getCall(0).args).to.have.length(2)
        })

        it("'frame' event first argument, bufs, should be an Array", function(){
          expect(frame.getCall(0).args[0]).to.be.instanceof(Array)
        })

        it("'frame' event bufs should be length 1", function(){
          expect(frame.getCall(0).args[0]).to.have.length(1)
        })

        it("'frame' event bufs[0] should be instance of Buffer", function(){
          expect(frame.getCall(0).args[0][0]).to.be.instanceof(Buffer)
        })

        it("'frame' event bufs[0] should have .length of 10", function(){
          expect(frame.getCall(0).args[0][0].length).to.be.equal(10)
        })

        it("'frame' event bufs[0] should contain 'XXXXXXXXXX' string", function(){
          expect(frame.getCall(0).args[0].toString('ascii')).to.be
          .equal("XXXXXXXXXX")
        })

        it("'frame' event second argument, framelen, should be 10", function(){
          expect(frame.getCall(0).args[1]).to.be.equal(10)
        })

        it("'data' event should be emitted", function(){
          expect(data.called).to.be.true
        })

        it("'data' event should only be emitted once", function(){
          expect(data.calledOnce).to.be.true
        })

        it("'data' event should only have one argument", function(){
          expect(data.getCall(0).args).to.have.length(1)
        })

        it("'data' event first argument, buf, should be instance of Buffer", function(){
          expect(data.getCall(0).args[0]).to.be.instanceof(Buffer)
        })

        it("'data' event buf should have .length of 10", function(){
          expect(data.getCall(0).args[0].length).to.be.equal(10)
        })

        it("'data' event buf should contain 'XXXXXXXXXX' string", function(){
          expect(data.getCall(0).args[0].toString('ascii')).to.be
          .equal("XXXXXXXXXX")
        })

      }) //describe #dispatch
    }) //describe parse all at once

    describe("parse one byte at a time", function(){
      var rdr
      before(function(){
        rdr = new FrapReader()
      })

      describe("#parse", function(){
        it("the FrapReader should have no entries in the parsedq", function(){
          expect(rdr.parsedq.length).to.be.equal(0)
        })
        it("should not throw an exception", function(){
          for (var i=0; i<single_frame.length; i++) {
            rdr.parse( single_frame.slice(i, i+1) )
          }
        })
        it("the FrapReader should have two entries in the parsedq", function(){
          expect(rdr.parsedq.length).to.be.equal(11)
        })
      })

      describe("#dispatch", function(){
        var header = sinon.spy()
          , part = sinon.spy()
          , frame = sinon.spy()
          , data = sinon.spy()

        before(function(){
          rdr.on('header', header)
          rdr.on('part', part)
          rdr.on('frame', frame)
          rdr.on('data', data)
        })

        it("should call #dispatch without errors", function(){
          rdr.dispatch() //calls all the stackedup events synchronously
        })

        it("'header' event should be called", function(){
          expect(header.called).to.be.true
        })

        it("'header' event should only be called only once", function(){
          expect(header.calledOnce).to.be.true
        })

        it("'header' event should have only one argument", function(){
          expect(header.getCall(0).args).to.have.length(1)
        })

        it("'header' event first argument should equal 10", function(){
          expect(header.getCall(0).args[0]).to.equal(10)
        })

        it("'part' event should be called", function(){
          expect(part.called).to.be.true
        })

        it("'part' event should only be called 10 times", function(){
          expect(part.callCount).to.be.equal(10)
        })

        it("each 'part' event shoule have three arguments", function(){
          for (var i=0; i<10; i++) {
            expect(part.getCall(i).args).to.have.length(3)
          }
        })
        it("each 'part' event first argument should be a Buffer", function(){
          for (var i=0; i<10; i++) {
            expect(part.getCall(i).args[0]).to.be.instanceof(Buffer)
          }
        })
        it("each 'part' event first argument should have .length 1", function(){
          for (var i=0; i<10; i++) {
            expect(part.getCall(i).args[0].length).to.be.equal(1)
          }
        })
        it("each 'part' event buf should contain string 'X'", function(){
          for (var i=0; i<10; i++) {
            expect(part.getCall(i).args[0].toString('ascii')).to.be.equal("X")
          }
        })
        it("each 'part' event second argument, pos, should be i", function(){
          for (var i=0; i<10; i++) {
            expect(part.getCall(i).args[1]).to.be.equal(i)
          }
        })
        it("each 'part' event thrid argument, framelen, should be 10", function(){
          for (var i=0; i<10; i++) {
            expect(part.getCall(i).args[2]).to.be.equal(10)
          }
        })

        it("'frame' event should be emitted", function(){
          expect(frame.called).to.be.true
        })

        it("'frame' event should only be emitted once", function(){
          expect(frame.calledOnce).to.be.true
        })

        it("'frame' event should only have two arguments", function(){
          expect(frame.getCall(0).args).to.have.length(2)
        })

        it("'frame' event first argument, bufs, should be an Array", function(){
          expect(frame.getCall(0).args[0]).to.be.instanceof(Array)
        })

        it("'frame' event bufs should be length 10", function(){
          expect(frame.getCall(0).args[0]).to.have.length(10)
        })

        it("'frame' event bufs[0] should be instance of Buffer", function(){
          expect(frame.getCall(0).args[0][0]).to.be.instanceof(Buffer)
        })

        it("'frame' event bufs[0] should have .length of 1", function(){
          expect(frame.getCall(0).args[0][0].length).to.be.equal(1)
        })

        it("'frame' event bufs[0] should contain 'XXXXXXXXXX' string", function(){
          expect(frame.getCall(0).args[0][0].toString('ascii')).to.be
          .equal("X")
        })

        it("'frame' event second argument, framelen, should be 10", function(){
          expect(frame.getCall(0).args[1]).to.be.equal(10)
        })

        it("'data' event should be emitted", function(){
          expect(data.called).to.be.true
        })

        it("'data' event should only be emitted once", function(){
          expect(data.calledOnce).to.be.true
        })

        it("'data' event should only have one argument", function(){
          expect(data.getCall(0).args).to.have.length(1)
        })

        it("'data' event first argument, buf, should be instance of Buffer", function(){
          expect(data.getCall(0).args[0]).to.be.instanceof(Buffer)
        })

        it("'data' event buf should have .length of 10", function(){
          expect(data.getCall(0).args[0].length).to.be.equal(10)
        })

        it("'data' event buf should contain 'XXXXXXXXXX' string", function(){
          expect(data.getCall(0).args[0].toString('ascii')).to.be
          .equal("XXXXXXXXXX")
        })

      }) //describe #dispatch
    }) //describe byte at a time
  }) //describe single complete frame

  describe("three complete frames", function(){
    var triple_frame
    before(function(){
      triple_frame = new Buffer((4+10)*3)
      triple_frame.fill(88)
      triple_frame.writeUInt32BE(10,0)
      triple_frame.writeUInt32BE(10,14)
      triple_frame.writeUInt32BE(10,28)
    })

    describe("parse all at once", function(){
      var rdr
      before(function(){
        rdr = new FrapReader()
        rdr.setEncoding('ascii')
      })

      describe("#parse", function(){
        it("should not throw an exception", function(){
          assert.strictEqual(rdr.parsedq.length, 0)
          rdr.parse(triple_frame)
          assert.strictEqual(rdr.parsedq.length, 6)

        })
      })

      describe("#dispatch", function(){
        it("should emit 'header' & 'part'; 3 each", function(){
          var header = sinon.spy()
            , part = sinon.spy()
            , frame = sinon.spy()
            , data = sinon.spy()
            , i

          rdr.on('header', header)
          rdr.on('part', part)
          rdr.on('frame', frame)
          rdr.on('data', data)

          rdr.dispatch() //calls all the stackedup events synchronously

          assert.ok(header.called)
          assert.strictEqual(header.callCount, 3)

          for (i=0; i<3; i++) {
            assert.strictEqual(header.getCall(i).args.length, 1)
            assert.strictEqual(header.getCall(i).args[0], 10)
          }


          assert.ok(part.called)
          assert.strictEqual(part.callCount, 3)

          for (i=0; i<3; i++) {
            assert.strictEqual( part.getCall(i).args.length, 3 )
            assert.ok( Buffer.isBuffer( part.getCall(i).args[0] ) )
            assert.strictEqual( part.getCall(i).args[0].length, 10 )
            assert.strictEqual( part.getCall(i).args[1],  0 )
            assert.strictEqual( part.getCall(i).args[2],  10 )
            assert.strictEqual( part.getCall(i).args[0].toString('ascii')
                              , "XXXXXXXXXX")

          }

          assert.ok(frame.called)
          assert.strictEqual(frame.callCount, 3)
          for (i=0; i<3; i++) {
            assert.strictEqual(frame.getCall(i).args.length, 2)
            assert.ok( Array.isArray(frame.getCall(i).args[0]) )
            assert.strictEqual(frame.getCall(i).args[0].length, 1)
            assert.ok( Buffer.isBuffer(frame.getCall(i).args[0][0]) )
            assert.strictEqual(frame.getCall(i).args[0][0].length, 10)
            assert.strictEqual(frame.getCall(i).args[0][0].toString('ascii')
                              , "XXXXXXXXXX")
          }

          assert.ok(data.called)
          assert.strictEqual(data.callCount, 3)
          for (i=0; i<3; i++) {
            assert.strictEqual(data.getCall(i).args.length, 1)
            assert.strictEqual(data.getCall(i).args[0].length, 10)
            assert.strictEqual(data.getCall(i).args[0], "XXXXXXXXXX")
          }
        }) //it
      }) //describe #dispatch
    }) //describe parse all at once

    describe("parse byte at a time", function(){
      var rdr
      before(function(){
        rdr = new FrapReader()
        rdr.setEncoding('ascii')
      })

      describe("#parse", function(){
        it("should not throw an exception", function(){
          assert.strictEqual(rdr.parsedq.length, 0)
          for (var i=0; i < triple_frame.length; i++) {
            rdr.parse( triple_frame.slice(i, i+1) )
          }
          assert.strictEqual(rdr.parsedq.length, 33)
        })
      })

      describe("#dispatch", function(){
        it("should emit 1 'header' event & 10 'part' events length 1 each", function(){
          var header = sinon.spy()
            , part = sinon.spy()
            , frame = sinon.spy()
            , data = sinon.spy()
            , i, j

          rdr.on('header', header)
          rdr.on('part', part)
          rdr.on('frame', frame)
          rdr.on('data', data)

          rdr.dispatch() //calls all the stackedup events synchronously

          assert.ok(header.called)
          assert.strictEqual(header.callCount, 3)

          for (i=0; i<3; i++) {
            assert.strictEqual(header.getCall(i).args.length, 1)
            assert.strictEqual(header.getCall(i).args[0], 10)
          }

          assert.ok(part.called)
          assert.strictEqual(part.callCount, 30)
          for (j=0; j<30; j+=10)
            for (i=0; i<10; i++) {
              assert.strictEqual( part.getCall(i+j).args.length, 3)
              assert.ok( Buffer.isBuffer( part.getCall(i+j).args[0] ) )
              assert.strictEqual( part.getCall(i+j).args[0].length, 1 )
              assert.strictEqual( part.getCall(i+j).args[1], i )
              assert.strictEqual( part.getCall(i+j).args[2], 10 )
              assert.strictEqual( part.getCall(i+j).args[0].toString('ascii')
                                , "X" )
            }

          assert.ok(frame.called)
          assert.strictEqual(frame.callCount, 3)
          for (i=0; i<3; i++) {
            assert.strictEqual(frame.getCall(i).args.length, 2)
            assert.ok( Array.isArray(frame.getCall(i).args[0]) )
            assert.strictEqual(frame.getCall(i).args[0].length, 10)
            for (j=0; j<10; j++) {
              assert.ok( Buffer.isBuffer(frame.getCall(i).args[0][j]) )
              assert.strictEqual(frame.getCall(i).args[0][j].length, 1)
              assert.strictEqual(frame.getCall(i).args[0][j].toString('ascii')
                                , "X")
              assert.strictEqual(frame.getCall(i).args[1], 10)
            }
          }

          assert.ok(data.called)
          assert.strictEqual(data.callCount, 3)
          for (i=0; i<3; i++) {
            assert.strictEqual(data.getCall(i).args.length, 1)
            assert.strictEqual(data.getCall(i).args[0].length, 10)
            assert.strictEqual(data.getCall(i).args[0], "XXXXXXXXXX")
          }
        }) //it
      }) //describe #dispatch
    }) //describe byte at a time

  }) //describe single complete frame

}) //describe FrapReader
