var http = require('http');
var fs = require('fs');
var config_file = './config.json';
var router;
var SERVER_PORT = 8080;

var TYPES = {
	'png': 'image/png',
	'gif': 'image/gif',
	'jpg': 'image/jpeg',
	'jpeg': 'image/jpeg',
	'json': 'application/json',
	'js': 'application/x-javascript',
	'css': 'text/css',
	'html': 'text/html',
	'htm': 'text/html',
	'ico': 'image/x-icon'
};

function loadConfig(){
	try {
		var data = fs.readFileSync(config_file, {encoding: 'utf-8'});
		//data = JSON.parse(data);
		data = (new Function('return ' + data))();
		router = data;
		return true;
	}catch (e){
		console.log('读取服务器配置错误', e);
	}
	return false;
}

if (loadConfig()){

	fs.watchFile(
		config_file,
		{ persistent: true, interval: 1000 },
		function (curr, prev) {
			// 监控配置文件的修改
			console.log('Reload config..');
			loadConfig();
		}
	);


	var server = http.createServer(function (req, res) {
		// console.log(req.headers);
		var config = null;
		var domain = req.headers.host.split(':').shift();
		if (domain){
			domain = domain.toLowerCase();
			config = router[domain] || null;
		}
		if (!config){
			// 检查别名与绑定默认第一个配置
			var first = null, i;
			for (config in router){
				config = router[config];
				if (!first){
					first = config;
				}

				// 匹配别名
				if (config.alias){
					for (i=config.alias.length; i>0;){
						if (config.alias[--i] == domain){
							i = true;
							break;
						}
					}
					if (i === true){
						break;
					}
				}
				config = null;
			}
			if (!config){
				config = first;
			}
		}
		if (!config){
			res.end('SunFeith Frontend HTTP Server Ready!');
			return;
		}

		// 检查是否本地目录
		for (var path in config.local){
			if (req.url.indexOf(path) === 0){
				path = req.url.replace(path, config.local[path]).split('?').shift();
				// 读取本地文件
				if (fs.existsSync(path) && fs.statSync(path).isFile()){
					var stream = fs.createReadStream(path);
					console.log('Local File: %s', path);

					// 生成对应的content-type
					var ext = path.split('.');
					ext = ext.length > 1 ? ext.pop().toLowerCase() : '';
					if (ext && TYPES[ext]){
						res.setHeader('content-type', TYPES[ext]);
					}

					stream.pipe(res);
					return;
				}else {
					console.log('Miss Local File: %s', req.url);
				}
			}
		}

		// 远程服务请求
		var options = {
			hostname: config.host,
			port: config.port || 80,
			path: req.url,
			method: req.method,
			headers: {}
		};
		var headers = req.headers;
		for (var name in headers){
			switch (name){
				case 'cookie':
				case 'content-length':
				case 'content-type':
					options.headers[name] = headers[name];
					break;
			}
		}

		var remote = http.request(options, function(remote_rep){
			var headers = remote_rep.headers;
			var res_headers = {};

			console.log('Remote URL: [%d] http://%s:%d%s', remote_rep.statusCode, config.host, config.port, req.url);

			// 转发HTTP头信息
			res_headers['X-REMOTE-INFO'] = domain + ':' + config.port + req.url;
			res_headers['content-type'] = headers['content-type'];
			if (headers['location']){
				res_headers['location'] = headers['location'].replace('http://'+config.host, '');
			}

			// 替换远程cookie
			var cookies = headers['set-cookie'];
			switch (typeof(cookies)){
				case 'string':
					res_headers['set-cookie'] = cookies.replace(config.host, domain);
					break;
				case 'object':
					var setCookie = [];
					for (var i in cookies){
						setCookie.push(cookies[i].replace(config.host, domain));
					}
					res_headers['set-cookie'] = setCookie;
					break;
			}

			var code = remote_rep.statusCode;
			res.writeHead(code == 404 ? 200 : code, res_headers);

			// 检查是否需要替换
			if (config.replace){
				for (var url in config.replace){
					if (req.url.indexOf(url) === 0){
						// 进入替换程序
						replaceResponse(config.replace[url], remote_rep, res);
						return;
					}
				}
			}
			remote_rep.pipe(res);
		});

		remote.on('error', function(){
			console.log('Remote URL: [ERROR] http://%s:%d%s', config.host, config.port, req.url);
			res.end('REMOTE SERVER ERROR!');
		});

		// 请求远端服务器文件
		req.pipe(remote);

	})

	server.on('error', function(){
		console.log('监听服务器地址失败 (PORT: %d}', SERVER_PORT);
		process.exit();
	})
	server.listen(SERVER_PORT);
}


function replaceResponse(config, remote, client){
	try {
		var data = fs.readFileSync(config.file, {encoding: 'utf-8'});
	}catch(e){
		console.log('Miss Local File: %s', config.file);
		remote.pipe(client);
		return;
	}

	var remote_data = '';
	remote.on('data', function(chunk){
		remote_data += chunk.toString();
	});
	remote.on('end', function(){
		data = data.split('\n');
		remote_data = remote_data.split('\n');

		// todo: 暂时替换<head>标记行
		for (var tar=0; tar<remote_data.length; tar++){
			if (remote_data[tar].toLowerCase().indexOf('<head>') !== -1){
				break;
			}
		}
		if (remote_data[tar]){
			data[config.search_lines] = remote_data[tar];
		}

		// 发送替换后的数据
		client.end(data.join('\n'));
	});
}

console.log('SunFeith Frontend HTTP Server Running.. (PORT: %d)\n========', SERVER_PORT);