var config = require("../../config.js"); var utils = require("../../utils.js");
if(!config['all'] && !config[__filename.split('\\').slice(-1)[0]]) {
	return;
}

var ethUtil = require("ethereumjs-util");

// var ethABI = require("ethereumjs-abi");
// waiting for Solidity pack Array support (vrolland did a pull request)
var ethABI = require("../../../lib/ethereumjs-abi-perso.js"); 

const BN = require('bn.js')

var RequestCore = artifacts.require("./core/RequestCore.sol");
var RequestEthereum = artifacts.require("./synchrone/RequestEthereum.sol");

// contract for test
var TestRequestSynchroneInterfaceContinue = artifacts.require("./test/synchrone/TestRequestSynchroneInterfaceContinue.sol");
var TestRequestSynchroneExtensionLauncher = artifacts.require("./test/synchrone/TestRequestSynchroneExtensionLauncher.sol");
var RequestBurnManagerSimple = artifacts.require("./collect/RequestBurnManagerSimple.sol");


var BigNumber = require('bignumber.js');

var abiUtils = require("web3-eth-abi");
var getEventFromReceipt = function(log, abi) {
	var event = null;

	for (var i = 0; i < abi.length; i++) {
	  var item = abi[i];
	  if (item.type != "event") continue;
	  var signature = item.name + "(" + item.inputs.map(function(input) {return input.type;}).join(",") + ")";
	  var hash = web3.sha3(signature);
	  if (hash == log.topics[0]) {
	    event = item;
	    break;
	  }
	}

	if (event != null) {
	  var inputs = event.inputs.map(function(input) {return input.type;});
	  var data = abiUtils.decodeParameters(inputs, log.data.replace("0x", ""));
	  // Do something with the data. Depends on the log and what you're using the data for.
	  return {name:event.name , data:data};
	}
	return null;
}

var hashRequest = function(contract, payee, payer, arbitraryAmount, extension, extParams, data) {
	const requestParts = [
        {value: contract, type: "address"},
        {value: payee, type: "address"},
        {value: payer, type: "address"},
        {value: arbitraryAmount, type: "int256"},
        {value: extension, type: "address"},
        {value: extParams, type: "bytes32[9]"},
        {value: data, type: "string"},
    ];
    var types = [];
    var values = [];
    requestParts.forEach(function(o,i) {
    	types.push(o.type);
    	values.push(o.value);
    });
    return ethABI.soliditySHA3(types, values);
}

var signHashRequest = function(hash,privateKey) {
	return ethUtil.ecsign(ethUtil.hashPersonalMessage(hash), privateKey);
}



contract('RequestEthereum broadcastSignedRequestAsPayer',  function(accounts) {
	var admin = accounts[0];
	var otherguy = accounts[1];
	var fakeContract = accounts[2];
	var payer = accounts[3];
	var payee = accounts[4];
	var privateKeyOtherGuy = "1ba414a85acdd19339dacd7febb40893458433bee01201b7ae8ca3d6f4e90994";
	var privateKeyPayer = "b383a09e0c750bcbfe094b9e17ee31c6a9bb4f2fcdc821d97a34cf3e5b7f5429";
	var privateKeyPayee = "5f1859eee362d44b90d4f3cdd14a8775f682e08d34ff7cdca7e903d7ee956b6a";

	// var creator = accounts[5];
	var fakeExtention1;
	var fakeExtention2;
	var fakeExtention3;
	var fakeExtention4Untrusted = accounts[9];
	var fakeExtentionLauncherAcceptFalse;

	var requestCore;
	var requestEthereum;

	var arbitraryAmount = 1000;
	var arbitraryAmount10percent = 100;

    beforeEach(async () => {
    	fakeExtention1 = await TestRequestSynchroneInterfaceContinue.new(1);
    	fakeExtention2 = await TestRequestSynchroneInterfaceContinue.new(2);
    	fakeExtention3 = await TestRequestSynchroneInterfaceContinue.new(3);
    	fakeExtentionLauncherAcceptFalse = await TestRequestSynchroneExtensionLauncher.new(21,true,false,true,true,true,true,true,true);

		requestCore = await RequestCore.new();
		var requestBurnManagerSimple = await RequestBurnManagerSimple.new(0); 
		await requestCore.setBurnManager(requestBurnManagerSimple.address, {from:admin});
		requestEthereum = await RequestEthereum.new(requestCore.address,{from:admin});

		await requestCore.adminAddTrustedCurrencyContract(requestEthereum.address, {from:admin});

		await requestCore.adminAddTrustedExtension(fakeExtention1.address, {from:admin});
		await requestCore.adminAddTrustedExtension(fakeExtention2.address, {from:admin});
		await requestCore.adminAddTrustedExtension(fakeExtention3.address, {from:admin});
		await requestCore.adminAddTrustedExtension(fakeExtentionLauncherAcceptFalse.address, {from:admin});
    });

	it("new quick request more than expectedAmount (with tips that make the new quick requestment under expected) OK", async function () {
		var extension = 0;
		var listParamsExtensions = [];

		var hash = hashRequest(requestEthereum.address, payee, payer, arbitraryAmount, extension, listParamsExtensions, "");
		var ecprivkey = Buffer.from(privateKeyPayee, 'hex');
		var sig = signHashRequest(hash,ecprivkey);

		var balancePayeeBefore = await web3.eth.getBalance(payee);
		var r = await requestEthereum.broadcastSignedRequestAsPayer(payee, arbitraryAmount, 
													extension,
													listParamsExtensions, 
													arbitraryAmount10percent, "", 
													sig.v, ethUtil.bufferToHex(sig.r), ethUtil.bufferToHex(sig.s),
													{from:payer, value:arbitraryAmount+1});

		assert.equal(r.receipt.logs.length,4,"Wrong number of events");

		var l = getEventFromReceipt(r.receipt.logs[0], requestCore.abi);
		assert.equal(l.name,"Created","Event Created is missing after broadcastSignedRequestAsPayer()");
		assert.equal(l.data[0],utils.getHashRequest(1),"Event Created wrong args requestId");
		assert.equal(l.data[1].toLowerCase(),payee,"Event Created wrong args payee");
		assert.equal(l.data[2].toLowerCase(),payer,"Event Created wrong args payer");

		var l = getEventFromReceipt(r.receipt.logs[1], requestCore.abi);
		assert.equal(l.name,"Accepted","Event Accepted is missing after broadcastSignedRequestAsPayer()");
		assert.equal(l.data[0],utils.getHashRequest(1),"Event Accepted wrong args requestId");

		var l = getEventFromReceipt(r.receipt.logs[2], requestCore.abi);
		assert.equal(l.name,"UpdateExpectedAmount","Event UpdateExpectedAmount is missing after broadcastSignedRequestAsPayer()");
		assert.equal(l.data[0],utils.getHashRequest(1),"Event UpdateExpectedAmount wrong args requestId");
		assert.equal(l.data[1],arbitraryAmount10percent,"Event UpdateExpectedAmount wrong args amount");

		var l = getEventFromReceipt(r.receipt.logs[3], requestCore.abi);
		assert.equal(l.name,"UpdateBalance","Event UpdateBalance is missing after broadcastSignedRequestAsPayer()");
		assert.equal(l.data[0],utils.getHashRequest(1),"Event UpdateBalance wrong args requestId");
		assert.equal(l.data[1],arbitraryAmount+1,"Event UpdateBalance wrong args amountPaid");

		var newReq = await requestCore.requests.call(utils.getHashRequest(1));
		assert.equal(newReq[0],payee,"new quick request wrong data : creator");
		assert.equal(newReq[1],payee,"new quick request wrong data : payee");
		assert.equal(newReq[2],payer,"new quick request wrong data : payer");		
		assert.equal(newReq[3],arbitraryAmount+arbitraryAmount10percent,"new quick request wrong data : expectedAmount");
		assert.equal(newReq[4],requestEthereum.address,"new quick request wrong data : currencyContract");
		assert.equal(newReq[5],arbitraryAmount+1,"new quick request wrong data : amountPaid");
		assert.equal(newReq[6],1,"new quick request wrong data : state");

		assert.equal((await web3.eth.getBalance(payee)).sub(balancePayeeBefore),arbitraryAmount+1,"new request wrong data : amount to withdraw payee");
	});

	it("new quick request pay more than expectedAmount (without tips) OK", async function () {
		var extension = 0;
		var listParamsExtensions = [];

		var hash = hashRequest(requestEthereum.address, payee, payer, arbitraryAmount, extension, listParamsExtensions, "");
		var ecprivkey = Buffer.from(privateKeyPayee, 'hex');
		var sig = signHashRequest(hash,ecprivkey);

		var r = await requestEthereum.broadcastSignedRequestAsPayer(payee, arbitraryAmount, 
													extension,
													listParamsExtensions, 
													0, "", 
													sig.v, ethUtil.bufferToHex(sig.r), ethUtil.bufferToHex(sig.s),
													{from:payer, value:arbitraryAmount+2});

		var newReq = await requestCore.requests.call(utils.getHashRequest(1));
		assert.equal(newReq[0],payee,"new quick request wrong data : creator");
		assert.equal(newReq[1],payee,"new quick request wrong data : payee");
		assert.equal(newReq[2],payer,"new quick request wrong data : payer");		
		assert.equal(newReq[3],arbitraryAmount,"new quick request wrong data : expectedAmount");
		assert.equal(newReq[4],requestEthereum.address,"new quick request wrong data : currencyContract");
		assert.equal(newReq[5],arbitraryAmount+2,"new quick request wrong data : amountPaid");
		assert.equal(newReq[6],1,"new quick request wrong data : state");

	});

	it("new quick request more than expectedAmount (with tips but still too much) Impossible", async function () {
		var extension = 0;
		var listParamsExtensions = [];

		var hash = hashRequest(requestEthereum.address, payee, payer, arbitraryAmount, extension, listParamsExtensions, "");
		var ecprivkey = Buffer.from(privateKeyPayee, 'hex');
		var sig = signHashRequest(hash,ecprivkey);

		var r = await requestEthereum.broadcastSignedRequestAsPayer(payee, arbitraryAmount, 
													extension,
													listParamsExtensions, 
													1, "", 
													sig.v, ethUtil.bufferToHex(sig.r), ethUtil.bufferToHex(sig.s),
													{from:payer, value:arbitraryAmount+2});

		var newReq = await requestCore.requests.call(utils.getHashRequest(1));
		assert.equal(newReq[0],payee,"new quick request wrong data : creator");
		assert.equal(newReq[1],payee,"new quick request wrong data : payee");
		assert.equal(newReq[2],payer,"new quick request wrong data : payer");		
		assert.equal(newReq[3],arbitraryAmount+1,"new quick request wrong data : expectedAmount");
		assert.equal(newReq[4],requestEthereum.address,"new quick request wrong data : currencyContract");
		assert.equal(newReq[5],arbitraryAmount+2,"new quick request wrong data : amountPaid");
		assert.equal(newReq[6],1,"new quick request wrong data : state");
	});


	it("new quick request with more tips than msg.value Impossible", async function () {
		var extension = 0;
		var listParamsExtensions = [];

		var hash = hashRequest(requestEthereum.address, payee, payer, arbitraryAmount, extension, listParamsExtensions, "");
		var ecprivkey = Buffer.from(privateKeyPayee, 'hex');
		var sig = signHashRequest(hash,ecprivkey);

		var r = await requestEthereum.broadcastSignedRequestAsPayer(payee, arbitraryAmount, 
													extension,
													listParamsExtensions, 
													arbitraryAmount10percent, "", 
													sig.v, ethUtil.bufferToHex(sig.r), ethUtil.bufferToHex(sig.s),
													{from:payer, value:0});

		var newReq = await requestCore.requests.call(utils.getHashRequest(1));
		assert.equal(newReq[0],payee,"new quick request wrong data : creator");
		assert.equal(newReq[1],payee,"new quick request wrong data : payee");
		assert.equal(newReq[2],payer,"new quick request wrong data : payer");		
		assert.equal(newReq[3],arbitraryAmount+arbitraryAmount10percent,"new quick request wrong data : expectedAmount");
		assert.equal(newReq[4],requestEthereum.address,"new quick request wrong data : currencyContract");
		assert.equal(newReq[5],0,"new quick request wrong data : amountPaid");
		assert.equal(newReq[6],1,"new quick request wrong data : state");
	});

	it("new quick request with tips OK", async function () {
		var extension = 0;
		var listParamsExtensions = [];

		var hash = hashRequest(requestEthereum.address, payee, payer, arbitraryAmount, extension, listParamsExtensions, "");
		var ecprivkey = Buffer.from(privateKeyPayee, 'hex');
		var sig = signHashRequest(hash,ecprivkey);

		var balancePayeeBefore = await web3.eth.getBalance(payee);
		var r = await requestEthereum.broadcastSignedRequestAsPayer(payee, arbitraryAmount, 
													extension,
													listParamsExtensions, 
													arbitraryAmount10percent, "", 
													sig.v, ethUtil.bufferToHex(sig.r), ethUtil.bufferToHex(sig.s),
													{from:payer, value:arbitraryAmount});

		assert.equal(r.receipt.logs.length,4,"Wrong number of events");

		var l = getEventFromReceipt(r.receipt.logs[0], requestCore.abi);
		assert.equal(l.name,"Created","Event Created is missing after broadcastSignedRequestAsPayer()");
		assert.equal(l.data[0],utils.getHashRequest(1),"Event Created wrong args requestId");
		assert.equal(l.data[1].toLowerCase(),payee,"Event Created wrong args payee");
		assert.equal(l.data[2].toLowerCase(),payer,"Event Created wrong args payer");

		var l = getEventFromReceipt(r.receipt.logs[1], requestCore.abi);
		assert.equal(l.name,"Accepted","Event Accepted is missing after broadcastSignedRequestAsPayer()");
		assert.equal(l.data[0],utils.getHashRequest(1),"Event Accepted wrong args requestId");

		var l = getEventFromReceipt(r.receipt.logs[2], requestCore.abi);
		assert.equal(l.name,"UpdateExpectedAmount","Event UpdateExpectedAmount is missing after broadcastSignedRequestAsPayer()");
		assert.equal(l.data[0],utils.getHashRequest(1),"Event UpdateExpectedAmount wrong args requestId");
		assert.equal(l.data[1],arbitraryAmount10percent,"Event UpdateExpectedAmount wrong args amount");

		var l = getEventFromReceipt(r.receipt.logs[3], requestCore.abi);
		assert.equal(l.name,"UpdateBalance","Event UpdateBalance is missing after broadcastSignedRequestAsPayer()");
		assert.equal(l.data[0],utils.getHashRequest(1),"Event UpdateBalance wrong args requestId");
		assert.equal(l.data[1],arbitraryAmount,"Event UpdateBalance wrong args amountPaid");

		var newReq = await requestCore.requests.call(utils.getHashRequest(1));
		assert.equal(newReq[0],payee,"new quick request wrong data : creator");
		assert.equal(newReq[1],payee,"new quick request wrong data : payee");
		assert.equal(newReq[2],payer,"new quick request wrong data : payer");
		assert.equal(newReq[3],arbitraryAmount+arbitraryAmount10percent,"new quick request wrong data : expectedAmount");
		assert.equal(newReq[4],requestEthereum.address,"new quick request wrong data : currencyContract");
		assert.equal(newReq[5],arbitraryAmount,"new quick request wrong data : amountPaid");
		assert.equal(newReq[6],1,"new quick request wrong data : state");

		assert.equal((await web3.eth.getBalance(payee)).sub(balancePayeeBefore),arbitraryAmount,"new request wrong data : amount to withdraw payee");
	});

	it("new quick request payee==payer impossible", async function () {
		var extension = 0;
		var listParamsExtensions = [];
		var hash = hashRequest(requestEthereum.address, payee, payee, arbitraryAmount, extension, listParamsExtensions, "");
		
		var ecprivkey = Buffer.from(privateKeyPayee, 'hex');
		var sig = signHashRequest(hash,ecprivkey);

		var r = await utils.expectThrow(requestEthereum.broadcastSignedRequestAsPayer(payer, arbitraryAmount, 
									extension,
									listParamsExtensions, 
									0, "", 
									sig.v, ethUtil.bufferToHex(sig.r), ethUtil.bufferToHex(sig.s),
									{from:payer, value:arbitraryAmount}));
	});

	it("new quick request payee==0 impossible", async function () {
		var extension = 0;
		var listParamsExtensions = [];
		var hash = hashRequest(requestEthereum.address, 0, payer, arbitraryAmount, extension, listParamsExtensions, "");
		
		var ecprivkey = Buffer.from(privateKeyPayee, 'hex');
		var sig = signHashRequest(hash,ecprivkey);

		var r = await utils.expectThrow(requestEthereum.broadcastSignedRequestAsPayer(0, arbitraryAmount, 
									extension,
									listParamsExtensions, 
									0, "", 
									sig.v, ethUtil.bufferToHex(sig.r), ethUtil.bufferToHex(sig.s),
									{from:payer, value:arbitraryAmount}));
	});


	it("new quick request msg.sender==payee impossible", async function () {
		var extension = 0;
		var listParamsExtensions = [];
		var hash = hashRequest(requestEthereum.address, payee, payer, arbitraryAmount, extension, listParamsExtensions, "");
		
		var ecprivkey = Buffer.from(privateKeyPayee, 'hex');
		var sig = signHashRequest(hash,ecprivkey);

		var r = await utils.expectThrow(requestEthereum.broadcastSignedRequestAsPayer(payee, arbitraryAmount, 
									extension,
									listParamsExtensions, 
									0, "", 
									sig.v, ethUtil.bufferToHex(sig.r), ethUtil.bufferToHex(sig.s),
									{from:payee, value:arbitraryAmount}));
	});

	it("new quick request msg.sender==otherguy impossible", async function () {
		var extension = 0;
		var listParamsExtensions = [];
		var hash = hashRequest(requestEthereum.address, payee, payer, arbitraryAmount, extension, listParamsExtensions, "");
		
		var ecprivkey = Buffer.from(privateKeyPayee, 'hex');
		var sig = signHashRequest(hash,ecprivkey);

		var r = await utils.expectThrow(requestEthereum.broadcastSignedRequestAsPayer(payee, arbitraryAmount, 
									extension,
									listParamsExtensions, 
									0, "", 
									sig.v, ethUtil.bufferToHex(sig.r), ethUtil.bufferToHex(sig.s),
									{from:otherguy, value:arbitraryAmount}));
	});

	it("impossible to createQuickquick request if Core Paused", async function () {
		await requestCore.pause({from:admin});

		var extension = 0;
		var listParamsExtensions = [];
		var hash = hashRequest(requestEthereum.address, payee, payer, arbitraryAmount, extension, listParamsExtensions, "");
		
		var ecprivkey = Buffer.from(privateKeyPayee, 'hex');
		var sig = signHashRequest(hash,ecprivkey);

		var r = await utils.expectThrow(requestEthereum.broadcastSignedRequestAsPayer(payee, arbitraryAmount, 
									extension,
									listParamsExtensions, 
									0, "", 
									sig.v, ethUtil.bufferToHex(sig.r), ethUtil.bufferToHex(sig.s),
									{from:payer, value:arbitraryAmount}));
	});

	it("new quick request msg.value > 0 OK", async function () {
		var extension = 0;
		var listParamsExtensions = [];

		var hash = hashRequest(requestEthereum.address, payee, payer, arbitraryAmount, extension, listParamsExtensions, "");
		var ecprivkey = Buffer.from(privateKeyPayee, 'hex');
		var sig = signHashRequest(hash,ecprivkey);

		var balancePayeeBefore = await web3.eth.getBalance(payee);
		var r = await requestEthereum.broadcastSignedRequestAsPayer(payee, arbitraryAmount, 
													extension,
													listParamsExtensions, 
													0, "", 
													sig.v, ethUtil.bufferToHex(sig.r), ethUtil.bufferToHex(sig.s),
													{from:payer, value:arbitraryAmount});

		assert.equal(r.receipt.logs.length,3,"Wrong number of events");

		var l = getEventFromReceipt(r.receipt.logs[0], requestCore.abi);
		assert.equal(l.name,"Created","Event Created is missing after broadcastSignedRequestAsPayer()");
		assert.equal(l.data[0],utils.getHashRequest(1),"Event Created wrong args requestId");
		assert.equal(l.data[1].toLowerCase(),payee,"Event Created wrong args payee");
		assert.equal(l.data[2].toLowerCase(),payer,"Event Created wrong args payer");

		var l = getEventFromReceipt(r.receipt.logs[1], requestCore.abi);
		assert.equal(l.name,"Accepted","Event Accepted is missing after broadcastSignedRequestAsPayer()");
		assert.equal(l.data[0],utils.getHashRequest(1),"Event Accepted wrong args requestId");

		var l = getEventFromReceipt(r.receipt.logs[2], requestCore.abi);
		assert.equal(l.name,"UpdateBalance","Event UpdateBalance is missing after broadcastSignedRequestAsPayer()");
		assert.equal(l.data[0],utils.getHashRequest(1),"Event UpdateBalance wrong args requestId");
		assert.equal(l.data[1],arbitraryAmount,"Event UpdateBalance wrong args amountPaid");

		var newReq = await requestCore.requests.call(utils.getHashRequest(1));
		assert.equal(newReq[0],payee,"new quick request wrong data : creator");
		assert.equal(newReq[1],payee,"new quick request wrong data : payee");
		assert.equal(newReq[2],payer,"new quick request wrong data : payer");
		assert.equal(newReq[3],arbitraryAmount,"new quick request wrong data : expectedAmount");
		assert.equal(newReq[4],requestEthereum.address,"new quick request wrong data : currencyContract");
		assert.equal(newReq[5],arbitraryAmount,"new quick request wrong data : amountPaid");
		assert.equal(newReq[6],1,"new quick request wrong data : state");

		assert.equal((await web3.eth.getBalance(payee)).sub(balancePayeeBefore),arbitraryAmount,"new request wrong data : amount to withdraw payee");
	});

	it("new quick request signed by payee and data match signature OK", async function () {
		var extension = 0;
		var listParamsExtensions = [];

		var hash = hashRequest(requestEthereum.address, payee, payer, arbitraryAmount, extension, listParamsExtensions, "");
		var ecprivkey = Buffer.from(privateKeyPayee, 'hex');
		var sig = signHashRequest(hash,ecprivkey);

		var balancePayeeBefore = await web3.eth.getBalance(payee);
		var r = await requestEthereum.broadcastSignedRequestAsPayer(payee, arbitraryAmount, 
													extension,
													listParamsExtensions, 
													0, "", 
													sig.v, ethUtil.bufferToHex(sig.r), ethUtil.bufferToHex(sig.s),
													{from:payer, value:0});

		assert.equal(r.receipt.logs.length,2,"Wrong number of events");

		var l = getEventFromReceipt(r.receipt.logs[0], requestCore.abi);
		assert.equal(l.name,"Created","Event Created is missing after broadcastSignedRequestAsPayer()");
		assert.equal(l.data[0],utils.getHashRequest(1),"Event Created wrong args requestId");
		assert.equal(l.data[1].toLowerCase(),payee,"Event Created wrong args payee");
		assert.equal(l.data[2].toLowerCase(),payer,"Event Created wrong args payer");

		var l = getEventFromReceipt(r.receipt.logs[1], requestCore.abi);
		assert.equal(l.name,"Accepted","Event Accepted is missing after broadcastSignedRequestAsPayer()");
		assert.equal(l.data[0],utils.getHashRequest(1),"Event Accepted wrong args requestId");

		var newReq = await requestCore.requests.call(utils.getHashRequest(1));
		assert.equal(newReq[0],payee,"new quick request wrong data : creator");
		assert.equal(newReq[1],payee,"new quick request wrong data : payee");
		assert.equal(newReq[2],payer,"new quick request wrong data : payer");
		assert.equal(newReq[3],arbitraryAmount,"new quick request wrong data : expectedAmount");
		assert.equal(newReq[4],requestEthereum.address,"new quick request wrong data : currencyContract");
		assert.equal(newReq[5],0,"new quick request wrong data : amountPaid");
		assert.equal(newReq[6],1,"new quick request wrong data : state");

		assert.equal((await web3.eth.getBalance(payee)).sub(balancePayeeBefore),0,"new request wrong data : amount to withdraw payee");
	});

	it("new quick request signed by payer Impossible", async function () {
		var extension = 0;
		var listParamsExtensions = [];
		var hash = hashRequest(requestEthereum.address, payee, payer, arbitraryAmount, extension, listParamsExtensions, "");
		
		var ecprivkey = Buffer.from(privateKeyPayer, 'hex');
		var sig = signHashRequest(hash,ecprivkey);

		var r = await utils.expectThrow(requestEthereum.broadcastSignedRequestAsPayer(payee, arbitraryAmount, 
									extension,
									listParamsExtensions, 
									0, "", 
									sig.v, ethUtil.bufferToHex(sig.r), ethUtil.bufferToHex(sig.s),
									{from:payer, value:arbitraryAmount}));
	});

	it("new quick request signed by otherguy Impossible", async function () {
		var extension = 0;
		var listParamsExtensions = [];
		var hash = hashRequest(requestEthereum.address, payee, payer, arbitraryAmount, extension, listParamsExtensions, "");
		
		var ecprivkey = Buffer.from(privateKeyOtherGuy, 'hex');
		var sig = signHashRequest(hash,ecprivkey);

		var r = await utils.expectThrow(requestEthereum.broadcastSignedRequestAsPayer(payee, arbitraryAmount, 
									extension,
									listParamsExtensions, 
									0, "", 
									sig.v, ethUtil.bufferToHex(sig.r), ethUtil.bufferToHex(sig.s),
									{from:payer, value:arbitraryAmount}));
	});

	it("new quick request signature doest match data impossible", async function () {
		var extension = 0;
		var listParamsExtensions = [];
		var hash = hashRequest(requestEthereum.address, payee, payer, arbitraryAmount, extension, listParamsExtensions, "");
		
		var ecprivkey = Buffer.from(privateKeyPayee, 'hex');
		var sig = signHashRequest(hash,ecprivkey);

		var r = await utils.expectThrow(requestEthereum.broadcastSignedRequestAsPayer(otherguy, arbitraryAmount, 
									extension,
									listParamsExtensions, 
									0, "", 
									sig.v, ethUtil.bufferToHex(sig.r), ethUtil.bufferToHex(sig.s),
									{from:payer, value:arbitraryAmount}));
	});


	// #####################################################################################
	// Extensions
	// #####################################################################################
// new quick request with 3 trustable extensions with parameters

	it("new quick request with 1 extension intercepting accept impossible", async function () {
		var extension = fakeExtentionLauncherAcceptFalse.address;
		var listParamsExtensions = [];

		var hash = hashRequest(requestEthereum.address, payee, payer, arbitraryAmount, extension, listParamsExtensions, "");
		var ecprivkey = Buffer.from(privateKeyPayee, 'hex');
		var sig = signHashRequest(hash,ecprivkey);

		await utils.expectThrow(requestEthereum.broadcastSignedRequestAsPayer(payee, arbitraryAmount, 
													extension,
													listParamsExtensions, 
													0, "", 
													sig.v, ethUtil.bufferToHex(sig.r), ethUtil.bufferToHex(sig.s),
													{from:payer, value:arbitraryAmount}));
	});

	// #####################################################################################
	// #####################################################################################
	// #####################################################################################


	it("new request when currencyContract not trusted Impossible", async function () {
		var requestEthereum2 = await RequestEthereum.new(requestCore.address,{from:admin});

		var extension = 0;
		var listParamsExtensions = [];

		var hash = hashRequest(requestEthereum2.address, payee, payer, arbitraryAmount, extension, listParamsExtensions, "");
		var ecprivkey = Buffer.from(privateKeyPayee, 'hex');
		var sig = signHashRequest(hash,ecprivkey);

		await utils.expectThrow(requestEthereum2.broadcastSignedRequestAsPayer(payee, arbitraryAmount, 
													extension,
													listParamsExtensions, 
													arbitraryAmount10percent, "", 
													sig.v, ethUtil.bufferToHex(sig.r), ethUtil.bufferToHex(sig.s),
													{from:payer, value:arbitraryAmount+1}));
	});

});

