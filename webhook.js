#!/usr/bin/env node

const express 	= require('express');
const bodyParser = require('body-parser');
const Nexmo 	= require('nexmo');
const mkdirp 	= require('mkdirp');
const myServer 	= express();
const publicIp 	= require('public-ip');
const url 		= require('url');
const http 		= require('http');
const https  	= require('https');
const fs 		= require('fs');
const argv      = require('optimist').boolean('cors').argv;
const process 	= require('process');
const shell 	= require('shelljs');
const pt 		= require('promise-timeout');
const zipFolder = require('zip-folder');
const rimraf 	= require('rimraf');


myServer.use(bodyParser.json());
myServer.use(function(req, res, next) {
    res.header("Access-Control-Allow-Origin", "*");
    res.header("Access-Control-Allow-Headers", "Origin, X-Requested-With, Content-Type, Accept");
    next();
});

if (argv.h || argv.help) {
  console.log([
    'usage: http-server [path] [options]',
    '',
    'options:',
    '  --port		Port to use [8080]',
    '  --ssl     	Enable https.',
    '  --cert    	Full path to ssl cert file (default: cert.pem).',
    '  --key     	Full path to ssl key file (default: key.pem).',
    '  --passphrase the passphrase of the cert',
    '  --aqua 		the path to aqua script runner',
    ',' , 
    '  -h --help    Print this list and exit.'
  ].join('\n'));
  process.exit();
}

if(typeof voxipServer == 'undefined'){
	var voxipServer = {};
}

voxipServer.appname = 'voxip_test_ivr';
voxipServer.nexmoAppPath = '../nexmo/voxip_test_ivr/';
voxipServer.appRecordingPath = '/home/ubuntu/container_guy/nqt_webhook/records/';
voxipServer.mosRecordsPath = '/home/ubuntu/container_guy/nqt_webhook/mos_record/';
voxipServer.appTemp = '/home/ubuntu/container_guy/nqt_webhook/temp/';
voxipServer.appPath = '/home/ubuntu/container_guy/nqt_webhook/';
voxipServer.runningPath = require('path').dirname(require.main.filename);
voxipServer.ivrFilePath = voxipServer.runningPath + '/' + voxipServer.nexmoAppPath + '/ivr';

voxipServer.aqua = "";

voxipServer.ssl = false;
voxipServer.sslCertPath = "";
voxipServer.sslKeyPath = "";
voxipServer.sslPassphrase = "";

voxipServer.myPublicIp = "";
voxipServer.nexmo = null;

voxipServer.testNumbers = [];

voxipServer.httpServer = null;
voxipServer.httpsServer = null;

voxipServer.log = function(log, color){
	color = '';
	if(color == 'yellow'){
		console.log(log.yellow);
	}else if(color == 'cyan'){
		console.log(log.cyan);
	}else if(color == 'red'){
		console.log(log.red);
	}else if(color == 'green'){
		console.log(log.green);
	}
	else{
		console.log(log);
	}
}

voxipServer.createAnswerResponse = function(){
	var ret =[];

	var record = {};
	record.action = "record";
	record.format = "wav";
	record.split = "conversation";
	ret.push(record);

	var streamUrl = voxipServer.ssl ? 'https://' : 'http://' + voxipServer.myPublicIp + ':8080/ivr/female_aqua.wav';

	var stream = {};
	stream.action= "stream";
   	stream.streamUrl = [];
	stream.streamUrl.push(streamUrl);
	stream.loop = 1;
	ret.push(stream);

	voxipServer.log('ret=' + JSON.stringify(ret), 'cyan');
	return ret;
};

voxipServer.mkDirectory = function(directory, callback) {
	mkdirp(directory, function(err, folder){
		if (err) {
			voxipServer.log('error create:' + folder + ' error:' + err, 'red');
			if (callback) {
				return callback(err);
			}
			throw err;
		}

		if (callback) {
			return callback();			
		}
	});
}

voxipServer.handleRecordingEvent = function(req){
	voxipServer.log('handleRecordingEvent:' + JSON.stringify(req), 'yellow');
	var recording_url = url.parse(req.recording_url);
	var ret = voxipServer.nexmo.files.get(req.recording_url, function(error, buffer){
		if(error != null){
			voxipServer.log('error get nexmo recording file: ' + error);
			return;
		}
		if(buffer.byteLength != req.size){
			voxipServer.log('error amout write buffer.byteLength=' + buffer.byteLength + ' req.size=' + req.size);
			return;
		}

		for (var i in voxipServer.testNumbers) 
		{
			if(voxipServer.testNumbers[i].conId === req.conversation_uuid)
			{
				voxipServer.log('conversation ' + req.conversation_uuid + ' was found');
				var record_path = voxipServer.appRecordingPath + voxipServer.testNumbers[i].sessionId + '/call_' + voxipServer.testNumbers[i].numberOfCalls;

				fs.exists(record_path, function(err, status){
					if(!status){
						voxipServer.mkDirectory(record_path, function(err){
							if(!err){
								var writeStream = fs.createWriteStream(record_path + '/vapi.wav');
								writeStream.end(Buffer.from(buffer));
							}
						});
					} else {
						var writeStream = fs.createWriteStream(record_path + '/vapi.wav');
						writeStream.end(Buffer.from(buffer));
					}
				});
				
			}
		}
	});
};


voxipServer.handleStatusEvent = function(req){

	voxipServer.log('handleStatusEvent:' + JSON.stringify(req), 'yellow');
	for (var i in voxipServer.testNumbers) 
	{
		if(voxipServer.testNumbers[i].number === req.to)
		{
			if(req.status === 'answered'){
		
				voxipServer.testNumbers[i].callAnswered = true;
				var record_path = voxipServer.appRecordingPath + voxipServer.testNumbers[i].sessionId + '/call_' + voxipServer.testNumbers[i].numberOfCalls;
				fs.exists(record_path, function(err, status){
					if(status){
						fs.rmdir(record_path, function() {
							voxipServer.mkDirectory(record_path);
						});
					} else {
						voxipServer.mkDirectory(record_path);
					}
				});
			}
			else if(req.status === 'completed'){
				clearTimeout(voxipServer.testNumbers[i].actionTimout);
				voxipServer.testNumbers[i].actionTimout = setTimeout(voxipServer.actionTimout, 480000, i, 'get_record');
			}
		}
	}
};

voxipServer.restNumber = function(index){
	voxipServer.testNumbers[index].occupied = false;
	voxipServer.testNumbers[index].sessionId = '';
	voxipServer.testNumbers[index].sessionNumberOfCalls = 0;
	voxipServer.testNumbers[index].remoteIp = '';
	voxipServer.testNumbers[index].conId = '';
	voxipServer.testNumbers[index].callAnswered = false;
}

voxipServer.actionTimout = function(index, stage){
	voxipServer.log('timeout for index:' + index + ' for stage:' + stage + ' sessionId:' + voxipServer.testNumbers[index].sessionId);
	voxipServer.restNumber(index);
};


myServer.get('/answer', function (req, res) {
	var ip = req.headers['x-forwarded-for'] || req.connection.remoteAddress;
	voxipServer.log('answer req method: remote IP:' + ip + ' req.query:' + JSON.stringify(req.query), 'yellow');
	
	if(voxipServer.myPublicIp == ""){
		voxipServer.log('error myPublicIp empty', 'red');
		res.writeHead(501, 'public ip not init', { 'Content-Type': 'text/plain' });
		res.end('');
		return;
	}

	for (var i in voxipServer.testNumbers) 
	{
		if(voxipServer.testNumbers[i].number ===  req.query.to)
		{
			if(voxipServer.testNumbers[i].occupied ===  false)
			{
				voxipServer.log('calling unset number ' + req.query.to);
				res.writeHead(501, 'number not set', { 'Content-Type': 'text/plain' });
				res.end('');
				return;
			}
			else
			{
				clearTimeout(voxipServer.testNumbers[i].actionTimout);
				voxipServer.testNumbers[i].actionTimout = setTimeout(voxipServer.actionTimout, 80000, i, 'complite_call');
				voxipServer.testNumbers[i].conId = req.query.conversation_uuid;
				res.writeHead(200, 'OK', { 'Content-Type': 'text/plain' });
				res.end(JSON.stringify(voxipServer.createAnswerResponse()));
				return;
			}
		}
	}

	res.writeHead(501, 'issue proccess the request', { 'Content-Type': 'text/plain' });
	res.end('');
});

myServer.get('/ivr/*', function (req, res) {
	voxipServer.log('static req method:' + req.method + ' rawHeaders:' + req.rawHeaders + ' url:' + req.url + ' httpVersion:' + req.httpVersion, 'yellow');
	
	var parsedUrl = url.parse(req.url);
	voxipServer.log('ivr request parsedUrl=' + JSON.stringify(parsedUrl) + ' path=' + voxipServer.runningPath + parsedUrl.pathname, 'yellow');

	if(!fs.existsSync(voxipServer.runningPath + parsedUrl.pathname)){
		voxipServer.log('error request none exist file', 'red');
		res.writeHead(501, 'file not found', { 'Content-Type': 'text/plain' });
		res.end('');
		return;
	}
	
	fs.stat(voxipServer.runningPath + parsedUrl.pathname, function(err, stat){
		if(err){
			return res.status(500).end('file not found');
		}
		var contentType = parsedUrl.pathname.includes(".wav") ? 'audio/x-wav' : 'audio/mpeg';
	    res.writeHead(200, {
	        'Content-Type': contentType,
	        'Content-Length': stat.size,
	        'Connection': 'keep-alive'
	    });

	    var readStream = fs.createReadStream(voxipServer.runningPath + parsedUrl.pathname);
	    readStream.pipe(res);	
	    readStream.on('end', function() {
		  voxipServer.log('streming was done', 'yello');
		  res.end('');
		});	
	});

	
});

myServer.post('/event', function (req, res) {
	var ip = req.headers['x-forwarded-for'] || req.connection.remoteAddress;
	voxipServer.log('post request from ip ' + ip + ' jsonBody=' + JSON.stringify(req.body));

   	if(typeof req.body.recording_url == 'string'){
    	setTimeout(voxipServer.handleRecordingEvent, 0, req.body);
    }
    else if(typeof req.body.status == 'string'){
    	setTimeout(voxipServer.handleStatusEvent, 0, req.body);
    }
    res.status(200).end('OK');
});


var initWebhook = function(){
	voxipServer.log('initWebhook running path=' + voxipServer.runningPath, 'green');

	voxipServer.ssl = argv.ssl || false;
	if(voxipServer.ssl){
		voxipServer.log('ssl enable', 'green');
		voxipServer.sslCertPath = argv.cert || "";
		voxipServer.sslKeyPath = argv.key || "";
		voxipServer.sslPassphrase = argv.passphrase || "";

		if(voxipServer.sslPassphrase == "" || voxipServer.sslKeyPath == "" || voxipServer.sslCertPath == ""){
			voxipServer.log('ssl with no cert or kry or passphrase', 'red');
			throw 'ssl with no cert or kry or passphrase';
		}

		if(!fs.existsSync(voxipServer.sslCertPath) || !fs.existsSync(voxipServer.sslKeyPath)){
			voxipServer.log('ssl with no cert and pem');
			throw 'ssl with no cert and pem';
		}
	}

	publicIp.v4().then(function(ip){
		voxipServer.myPublicIp = ip;
		voxipServer.log('pulic ip=' + voxipServer.myPublicIp);
	});

	

	var options = {};
	options.debug = true;

	if(!fs.existsSync(voxipServer.runningPath + '/config.json')) {
		voxipServer.log('config.json not exsit');
		throw 'config.json not exsit';
	}
	var config = JSON.parse(fs.readFileSync(voxipServer.runningPath + '/config.json', 'utf8'));

	voxipServer.nexmo = new Nexmo({
	    apiKey: '4b767df7',
    	apiSecret: 'QXJ9NmTkA0H5AsS3',
	    applicationId: "63e5f5e7-e29c-46d5-b20b-d4e76f1c9c5a",
	    privateKey: voxipServer.runningPath + "/private.key",
  	}, options );

	voxipServer.aqua = config.aqua || "";

	var port = argv.port || 8080;
	voxipServer.log('port=' + port, 'green');

	voxipServer.httpServer = http.createServer(myServer);

	voxipServer.httpServer.listen(8080);
};

initWebhook();
