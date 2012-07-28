var sinon = require('sinon')
  //, expect = require('chai').expect
  //, should = require('chai').should()
  , assert = require('assert')
  , inspect = require('util').inspect
  , log = console.log


describe("FrapReader", function(){
  var FrapReader = require('../lib/frap_reader')
    , rdr

  describe("single complete frame", function(){
    var single_frame
    before(function(){
      single_frame = new Buffer(14)
      single_frame.fill(88) //ascii 88 == 'X'
      single_frame.writeUInt32BE(10,0)
    })

    describe("parse all at once", function(){
      before(function(){
        rdr = new FrapReader()
      })

      describe("#parse", function(){
        it("should not throw an exception", function(){
          assert.strictEqual(rdr.parsedq.length, 0
                , "rdr.parsedq.length  must equal 0; before parse()")
          rdr.parse(single_frame)
          assert.strictEqual(rdr.parsedq.length, 2
                , "rdr.parsedq.length  must equal 2; after parse()")
        })
      })

      describe("#dispatch", function(){
        it("should emit 'header' & 'part' length 10", function(){
          var header = sinon.spy()
            , part = sinon.spy()

          rdr.on('header', header)
          rdr.on('part', part)

          rdr.dispatch() //calls all the stackedup events synchronously

          assert.ok(header.called, "should be called")
          assert.ok(header.calledOnce, "should only be called once")
          assert.strictEqual(header.getCall(0).args.length, 1
                   , "'header' event should have only one argument")
          assert.strictEqual(header.getCall(0).args[0], 10
                   , "'header' event first/only argument should equal 10")


          assert.ok(part.called, "should be called")
          assert.ok(part.calledOnce, "should only be called once")
          assert.ok( part.getCall(0).args.length === 3
                   , "'part' event should have 3 arguments")
          assert.ok( Buffer.isBuffer( part.getCall(0).args[0] )
                   , "'part' event first argument should be a Buffer")
          assert.ok( part.getCall(0).args[0].length === 10
                   , "'part' event first argument should have a .length of 10")
          assert.ok( part.getCall(0).args[1] === 0
                   , "'part' event second argument, pos, should equal 0")
          assert.ok( part.getCall(0).args[2] === 10
                   , "'part' event third argument, framelen, should equal 10")

          assert.equal( part.getCall(0).args[0].toString('ascii'), "XXXXXXXXXX"
                   , "'part' event first argument should equal 'XXXXXXXXXX'")

        }) //it
      }) //describe #dispatch
    }) //describe parse all at once

    describe("parse byte at a time", function(){
      before(function(){
        rdr = new FrapReader()
      })

      describe("#parse", function(){
        it("should not throw an exception", function(){
          assert.strictEqual(rdr.parsedq.length, 0
                , "rdr.parsedq.length  must equal 0; before parse()")
          for (var i=0; i < single_frame.length; i++) {
            rdr.parse( single_frame.slice(i, i+1) )
          }
          assert.strictEqual(rdr.parsedq.length, 11
                , "rdr.parsedq.length  must equal 11; after parse() calls")
        })
      })

      describe("#dispatch", function(){
        it("should emit 1 'header' event & 10 'part' events length 1 each"
          , function(){
          var header = sinon.spy()
            , part = sinon.spy()

          rdr.on('header', header)
          rdr.on('part', part)

          rdr.dispatch() //calls all the stackedup events synchronously

          assert.ok(header.called, "'header' should be emitted")
          assert.ok(header.calledOnce, "'header' should only be emitted once")
          assert.strictEqual(header.getCall(0).args.length, 1
                   , "'header' event should have only one argument")
          assert.strictEqual(header.getCall(0).args[0], 10
                   , "'header' event first/only argument should equal 10")


          assert.ok(part.called, "'part' should be emitted")
          assert.ok(part.callCount === 10
              , "'part' should be emitted 10 times")
          for (var i=0; i<part.callCount; i++) {
            assert.strictEqual( part.getCall(i).args.length, 3
              , "every 'part' event should have 3 arguments")
            assert.ok( Buffer.isBuffer( part.getCall(i).args[0] )
              , "every 'part' event first argument should be a Buffer")
            assert.strictEqual( part.getCall(i).args[0].length, 1
              , "every 'part' event first argument should have a .length of 1")
            assert.strictEqual( part.getCall(i).args[1], i
              , "every 'part' event second argument, pos, should equal i="+i)
            assert.strictEqual( part.getCall(i).args[2], 10
              , "every 'part' event third argument, framelen, should equal 10")
            assert.strictEqual( part.getCall(i).args[0].toString('ascii'), "X"
              , "every 'part' event first argument should equal 'X'")
          }

        }) //it
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
      before(function(){
        rdr = new FrapReader()
      })

      describe("#parse", function(){
        it("should not throw an exception", function(){
          assert.strictEqual(rdr.parsedq.length, 0
                , "rdr.parsedq.length  must equal 0; before parse()")
          rdr.parse(triple_frame)
          assert.strictEqual(rdr.parsedq.length, 6
                , "rdr.parsedq.length  must equal 6; after parse()")
        })
      })

      describe("#dispatch", function(){
        it("should emit 'header' & 'part'; 3 each", function(){
          var header = sinon.spy()
            , part = sinon.spy()
            , i

          rdr.on('header', header)
          rdr.on('part', part)

          rdr.dispatch() //calls all the stackedup events synchronously

          assert.ok(header.called, "'header' should be emitted")
          assert.strictEqual(header.callCount, 3
                            , "'header' should be emitted 3 times")

          for (i=0; i<3; i++) {
            assert.strictEqual(header.getCall(i).args.length, 1
                     , "'header' event should have only one argument")
            assert.strictEqual(header.getCall(i).args[0], 10
                     , "'header' event first/only argument should equal 10")
          }


          assert.ok(part.called, "should be called")
          assert.strictEqual(part.callCount, 3
                            , "'part' should be emitted 3 times")

          for (i=0; i<3; i++) {
            assert.ok( part.getCall(i).args.length === 3
                   , "'part' event should have 3 arguments")
            assert.ok( Buffer.isBuffer( part.getCall(i).args[0] )
                   , "'part' event first argument should be a Buffer")
            assert.ok( part.getCall(i).args[0].length === 10
                   , "'part' event first argument should have a .length of 10")
            assert.ok( part.getCall(i).args[1] === 0
                   , "'part' event second argument, pos, should equal 0")
            assert.ok( part.getCall(i).args[2] === 10
                   , "'part' event third argument, framelen, should equal 10")

            assert.strictEqual( part.getCall(i).args[0].toString('ascii')
                     , "XXXXXXXXXX"
                     , "'part' event first argument should equal 'XXXXXXXXXX'")
          }
        }) //it
      }) //describe #dispatch
    }) //describe parse all at once

    describe("parse byte at a time", function(){
      before(function(){
        rdr = new FrapReader()
      })

      describe("#parse", function(){
        it("should not throw an exception", function(){
          assert.strictEqual(rdr.parsedq.length, 0
                , "rdr.parsedq.length  must equal 0; before parse()")
          for (var i=0; i < triple_frame.length; i++) {
            rdr.parse( triple_frame.slice(i, i+1) )
          }
          assert.strictEqual(rdr.parsedq.length, 33
                , "rdr.parsedq.length  must equal 33; after parse() calls")
        })
      })

      describe("#dispatch", function(){
        it("should emit 1 'header' event & 10 'part' events length 1 each", function(){
          var header = sinon.spy()
            , part = sinon.spy()
            , i

          rdr.on('header', header)
          rdr.on('part', part)

          rdr.dispatch() //calls all the stackedup events synchronously

          assert.ok(header.called, "'header' should be emitted")
          assert.strictEqual(header.callCount, 3, "should be emitted 3 times")

          for (i=0; i<3; i++) {
            assert.strictEqual(header.getCall(i).args.length, 1
                     , "'header' event should have only one argument")
            assert.strictEqual(header.getCall(i).args[0], 10
                     , "'header' event first/only argument should equal 10")
          }

          assert.ok(part.called, "'part' should be emitted")
          assert.ok(part.callCount === 30
              , "'part' should be emitted 30 times")
          for (var j=0; j<30; j+=10)
            for (i=0; i<10; i++) {
              assert.strictEqual( part.getCall(i+j).args.length, 3
               , "every 'part' event should have 3 arguments")
              assert.ok( Buffer.isBuffer( part.getCall(i+j).args[0] )
                , "every 'part' event first argument should be a Buffer")
              assert.strictEqual( part.getCall(i+j).args[0].length, 1
               , "every 'part' event first argument should have a .length of 1")
              assert.strictEqual( part.getCall(i+j).args[1], i
               , "every 'part' event second argument, pos, should equal i="+i)
              assert.strictEqual( part.getCall(i+j).args[2], 10
               , "every 'part' event third argument, framelen, should equal 10")
              assert.strictEqual( part.getCall(i+j).args[0].toString('ascii'), "X"
               , "every 'part' event first argument should equal 'X'")
            }

        }) //it
      }) //describe #dispatch
    }) //describe byte at a time

  }) //describe single complete frame

}) //describe FrapReader
