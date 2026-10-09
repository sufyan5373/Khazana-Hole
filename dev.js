// local harness that mimics Vercel: node dev.js -> http://localhost:3000
const http=require('http'),fs=require('fs'),path=require('path'),h=require('./api/download.js');
http.createServer((req,res)=>{
  if(req.url.startsWith('/api/download'))return h(req,res);
  res.writeHead(200,{'content-type':'text/html; charset=utf-8'});fs.createReadStream(path.join(__dirname,'public','index.html')).pipe(res);
}).listen(3000,()=>console.log('http://localhost:3000'));
